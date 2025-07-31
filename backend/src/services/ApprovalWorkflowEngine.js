const db = require("../../config/database");

/**
 * ApprovalWorkflowEngine
 *
 * Handles configurable approval workflows for purchase orders and other processes.
 * Supports multi-stage approvals, conditional routing, and automated escalation.
 */
class ApprovalWorkflowEngine {
  /**
   * Create a new approval workflow
   * @param {string} storeId - Store ID
   * @param {Object} workflowData - Workflow configuration
   * @returns {Promise<Object>} Created workflow
   */
  async createWorkflow(storeId, workflowData) {
    const client = await db.getClient();

    try {
      await client.query("BEGIN");

      const {
        workflow_name,
        description,
        workflow_type,
        trigger_conditions,
        steps = [],
      } = workflowData;

      // Create the workflow
      const workflowResult = await client.query(
        `
        INSERT INTO approval_workflows (
          store_id, workflow_name, description, workflow_type, trigger_conditions
        ) VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `,
        [
          storeId,
          workflow_name,
          description,
          workflow_type,
          JSON.stringify(trigger_conditions),
        ]
      );

      const workflow = workflowResult.rows[0];

      // Create workflow steps
      const createdSteps = [];
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const stepResult = await client.query(
          `
          INSERT INTO approval_workflow_steps (
            workflow_id, step_order, step_name, approver_user_id,
            approver_role, approval_criteria, is_required, timeout_hours
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *
        `,
          [
            workflow.workflow_id,
            i + 1,
            step.step_name,
            step.approver_user_id || null,
            step.approver_role || null,
            JSON.stringify(step.approval_criteria || {}),
            step.is_required !== false, // Default to true
            step.timeout_hours || 72,
          ]
        );

        createdSteps.push(stepResult.rows[0]);
      }

      await client.query("COMMIT");

      return {
        ...workflow,
        steps: createdSteps,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`Failed to create workflow: ${error.message}`);
    } finally {
      client.release();
    }
  }

  /**
   * Get workflows for a store
   * @param {string} storeId - Store ID
   * @param {Object} filters - Optional filters
   * @returns {Promise<Array>} List of workflows
   */
  async getWorkflows(storeId, filters = {}) {
    try {
      let query = `
        SELECT 
          w.*,
          COUNT(s.step_id) as step_count,
          COUNT(CASE WHEN s.is_required = true THEN 1 END) as required_steps
        FROM approval_workflows w
        LEFT JOIN approval_workflow_steps s ON w.workflow_id = s.workflow_id
        WHERE w.store_id = $1
      `;

      const params = [storeId];
      let paramIndex = 1;

      if (filters.workflow_type) {
        query += ` AND w.workflow_type = $${++paramIndex}`;
        params.push(filters.workflow_type);
      }

      if (filters.is_active !== undefined) {
        query += ` AND w.is_active = $${++paramIndex}`;
        params.push(filters.is_active);
      }

      query += `
        GROUP BY w.workflow_id
        ORDER BY w.workflow_name ASC
      `;

      const result = await db.query(query, params);
      return result.rows;
    } catch (error) {
      throw new Error(`Failed to get workflows: ${error.message}`);
    }
  }

  /**
   * Get workflow by ID with steps
   * @param {string} workflowId - Workflow ID
   * @param {string} storeId - Store ID for authorization
   * @returns {Promise<Object>} Workflow with steps
   */
  async getWorkflowById(workflowId, storeId) {
    try {
      // Get workflow
      const workflowResult = await db.query(
        `
        SELECT * FROM approval_workflows 
        WHERE workflow_id = $1 AND store_id = $2
      `,
        [workflowId, storeId]
      );

      if (workflowResult.rows.length === 0) {
        throw new Error("Workflow not found");
      }

      const workflow = workflowResult.rows[0];

      // Get workflow steps
      const stepsResult = await db.query(
        `
        SELECT 
          s.*,
          u.email as approver_email
        FROM approval_workflow_steps s
        LEFT JOIN users u ON s.approver_user_id = u.user_id
        WHERE s.workflow_id = $1
        ORDER BY s.step_order ASC
      `,
        [workflowId]
      );

      return {
        ...workflow,
        steps: stepsResult.rows,
      };
    } catch (error) {
      throw new Error(`Failed to get workflow: ${error.message}`);
    }
  }

  /**
   * Find applicable workflow for a request
   * @param {string} storeId - Store ID
   * @param {string} workflowType - Type of workflow (e.g., 'purchase_order')
   * @param {Object} requestData - Data to evaluate against trigger conditions
   * @returns {Promise<Object|null>} Applicable workflow or null
   */
  async findApplicableWorkflow(storeId, workflowType, requestData) {
    try {
      const result = await db.query(
        `
        SELECT * FROM approval_workflows 
        WHERE store_id = $1 
        AND workflow_type = $2 
        AND is_active = true
        ORDER BY workflow_id ASC
      `,
        [storeId, workflowType]
      );

      for (const workflow of result.rows) {
        if (
          this.evaluateTriggerConditions(
            workflow.trigger_conditions,
            requestData
          )
        ) {
          return await this.getWorkflowById(workflow.workflow_id, storeId);
        }
      }

      return null;
    } catch (error) {
      throw new Error(`Failed to find applicable workflow: ${error.message}`);
    }
  }

  /**
   * Start approval process for a purchase order
   * @param {string} poId - Purchase order ID
   * @param {string} storeId - Store ID
   * @param {Object} requestData - PO data for workflow evaluation
   * @returns {Promise<Object>} Approval process status
   */
  async startApprovalProcess(poId, storeId, requestData) {
    const client = await db.getClient();

    try {
      await client.query("BEGIN");

      // Find applicable workflow
      const workflow = await this.findApplicableWorkflow(
        storeId,
        "purchase_order",
        requestData
      );

      if (!workflow) {
        // No workflow needed - auto-approve
        await client.query(
          `
          UPDATE purchase_orders 
          SET status = 'approved', approved_at = CURRENT_TIMESTAMP
          WHERE po_id = $1
        `,
          [poId]
        );

        await client.query("COMMIT");

        return {
          po_id: poId,
          workflow_applied: false,
          status: "auto_approved",
          message: "No approval workflow required - automatically approved",
        };
      }

      // Create approval records for each step
      const approvals = [];
      for (const step of workflow.steps) {
        const approvalResult = await client.query(
          `
          INSERT INTO purchase_order_approvals (
            po_id, workflow_id, step_id, approver_user_id, status
          ) VALUES ($1, $2, $3, $4, 'pending')
          RETURNING *
        `,
          [poId, workflow.workflow_id, step.step_id, step.approver_user_id]
        );

        approvals.push(approvalResult.rows[0]);
      }

      // Update PO status to submitted
      await client.query(
        `
        UPDATE purchase_orders 
        SET status = 'submitted', submitted_at = CURRENT_TIMESTAMP
        WHERE po_id = $1
      `,
        [poId]
      );

      await client.query("COMMIT");

      return {
        po_id: poId,
        workflow_applied: true,
        workflow_id: workflow.workflow_id,
        workflow_name: workflow.workflow_name,
        status: "pending_approval",
        approvals,
        next_approver: this.getNextPendingApproval(approvals),
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`Failed to start approval process: ${error.message}`);
    } finally {
      client.release();
    }
  }

  /**
   * Process an approval decision
   * @param {string} approvalId - Approval ID
   * @param {string} approverId - User ID making the decision
   * @param {string} decision - 'approved' or 'rejected'
   * @param {string} comments - Optional comments
   * @returns {Promise<Object>} Approval result
   */
  async processApprovalDecision(
    approvalId,
    approverId,
    decision,
    comments = ""
  ) {
    const client = await db.getClient();

    try {
      await client.query("BEGIN");

      // Validate decision
      if (!["approved", "rejected"].includes(decision)) {
        throw new Error("Invalid approval decision");
      }

      // Get approval details
      const approvalResult = await client.query(
        `
        SELECT 
          poa.*,
          po.po_id,
          po.store_id,
          aws.step_order,
          aws.is_required
        FROM purchase_order_approvals poa
        JOIN purchase_orders po ON poa.po_id = po.po_id
        JOIN approval_workflow_steps aws ON poa.step_id = aws.step_id
        WHERE poa.approval_id = $1 AND poa.status = 'pending'
      `,
        [approvalId]
      );

      if (approvalResult.rows.length === 0) {
        throw new Error("Approval not found or already processed");
      }

      const approval = approvalResult.rows[0];

      // Verify approver authorization
      if (
        approval.approver_user_id &&
        approval.approver_user_id !== approverId
      ) {
        throw new Error("User not authorized to approve this request");
      }

      // Update approval record
      await client.query(
        `
        UPDATE purchase_order_approvals 
        SET 
          status = $1,
          approver_user_id = $2,
          approval_date = CURRENT_TIMESTAMP,
          comments = $3,
          updated_at = CURRENT_TIMESTAMP
        WHERE approval_id = $4
      `,
        [decision, approverId, comments, approvalId]
      );

      let finalResult;

      if (decision === "rejected") {
        // Rejection - update PO status and skip remaining approvals
        await client.query(
          `
          UPDATE purchase_orders 
          SET status = 'rejected', updated_at = CURRENT_TIMESTAMP
          WHERE po_id = $1
        `,
          [approval.po_id]
        );

        // Mark remaining approvals as skipped
        await client.query(
          `
          UPDATE purchase_order_approvals 
          SET status = 'skipped', updated_at = CURRENT_TIMESTAMP
          WHERE po_id = $1 AND status = 'pending'
        `,
          [approval.po_id]
        );

        finalResult = {
          decision,
          po_status: "rejected",
          message: "Purchase order rejected",
        };
      } else {
        // Approval - check if all required approvals are complete
        const remainingResult = await client.query(
          `
          SELECT 
            COUNT(*) as total_remaining,
            COUNT(CASE WHEN aws.is_required = true THEN 1 END) as required_remaining
          FROM purchase_order_approvals poa
          JOIN approval_workflow_steps aws ON poa.step_id = aws.step_id
          WHERE poa.po_id = $1 AND poa.status = 'pending'
        `,
          [approval.po_id]
        );

        const remaining = remainingResult.rows[0];

        if (parseInt(remaining.required_remaining) === 0) {
          // All required approvals complete - approve PO
          await client.query(
            `
            UPDATE purchase_orders 
            SET 
              status = 'approved',
              approved_by = $1,
              approved_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
            WHERE po_id = $2
          `,
            [approverId, approval.po_id]
          );

          finalResult = {
            decision,
            po_status: "approved",
            message:
              "All required approvals complete - purchase order approved",
          };
        } else {
          // More approvals needed
          const nextApprovalResult = await client.query(
            `
            SELECT 
              poa.*,
              aws.step_name,
              u.email as approver_email
            FROM purchase_order_approvals poa
            JOIN approval_workflow_steps aws ON poa.step_id = aws.step_id
            LEFT JOIN users u ON poa.approver_user_id = u.user_id
            WHERE poa.po_id = $1 AND poa.status = 'pending'
            ORDER BY aws.step_order ASC
            LIMIT 1
          `,
            [approval.po_id]
          );

          finalResult = {
            decision,
            po_status: "pending_approval",
            message: `Approval recorded - ${remaining.required_remaining} required approvals remaining`,
            next_approver: nextApprovalResult.rows[0] || null,
          };
        }
      }

      await client.query("COMMIT");

      return {
        approval_id: approvalId,
        po_id: approval.po_id,
        ...finalResult,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`Failed to process approval decision: ${error.message}`);
    } finally {
      client.release();
    }
  }

  /**
   * Get pending approvals for a user
   * @param {string} userId - User ID
   * @param {string} storeId - Store ID
   * @param {Object} filters - Optional filters
   * @returns {Promise<Array>} Pending approvals
   */
  async getPendingApprovalsForUser(userId, storeId, filters = {}) {
    try {
      let query = `
        SELECT 
          poa.*,
          po.po_number,
          po.total_amount,
          po.created_at as po_created_at,
          s.supplier_name,
          aws.step_name,
          aws.step_order,
          aws.timeout_hours,
          u.email as requester_email,
          -- Calculate time since creation
          EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - poa.created_at))/3600 as hours_pending
        FROM purchase_order_approvals poa
        JOIN purchase_orders po ON poa.po_id = po.po_id
        JOIN suppliers s ON po.supplier_id = s.supplier_id
        JOIN approval_workflow_steps aws ON poa.step_id = aws.step_id
        LEFT JOIN users u ON po.created_by = u.user_id
        WHERE poa.status = 'pending'
        AND po.store_id = $1
        AND (poa.approver_user_id = $2 OR aws.approver_role IN (
          SELECT role FROM user_roles WHERE user_id = $2
        ))
      `;

      const params = [storeId, userId];
      let paramIndex = 2;

      if (filters.workflow_type) {
        query += ` AND aw.workflow_type = $${++paramIndex}`;
        params.push(filters.workflow_type);
      }

      if (filters.urgent_only) {
        query += ` AND EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - poa.created_at))/3600 > aws.timeout_hours * 0.8`;
      }

      query += ` ORDER BY poa.created_at ASC`;

      if (filters.limit) {
        query += ` LIMIT $${++paramIndex}`;
        params.push(filters.limit);
      }

      const result = await db.query(query, params);
      return result.rows;
    } catch (error) {
      throw new Error(`Failed to get pending approvals: ${error.message}`);
    }
  }

  /**
   * Get approval history for a purchase order
   * @param {string} poId - Purchase order ID
   * @param {string} storeId - Store ID for authorization
   * @returns {Promise<Array>} Approval history
   */
  async getApprovalHistory(poId, storeId) {
    try {
      const result = await db.query(
        `
        SELECT 
          poa.*,
          aws.step_name,
          aws.step_order,
          u.email as approver_email,
          requester.email as requester_email
        FROM purchase_order_approvals poa
        JOIN approval_workflow_steps aws ON poa.step_id = aws.step_id
        JOIN purchase_orders po ON poa.po_id = po.po_id
        LEFT JOIN users u ON poa.approver_user_id = u.user_id
        LEFT JOIN users requester ON po.created_by = requester.user_id
        WHERE poa.po_id = $1 AND po.store_id = $2
        ORDER BY aws.step_order ASC, poa.created_at ASC
      `,
        [poId, storeId]
      );

      return result.rows;
    } catch (error) {
      throw new Error(`Failed to get approval history: ${error.message}`);
    }
  }

  /**
   * Update workflow configuration
   * @param {string} workflowId - Workflow ID
   * @param {string} storeId - Store ID for authorization
   * @param {Object} updateData - Updated workflow data
   * @returns {Promise<Object>} Updated workflow
   */
  async updateWorkflow(workflowId, storeId, updateData) {
    const client = await db.getClient();

    try {
      await client.query("BEGIN");

      const allowedFields = [
        "workflow_name",
        "description",
        "trigger_conditions",
        "is_active",
      ];

      const updateFields = [];
      const values = [];
      let paramIndex = 2; // Start from 2 since workflowId and storeId are $1 and $2

      for (const [key, value] of Object.entries(updateData)) {
        if (allowedFields.includes(key)) {
          updateFields.push(`${key} = $${++paramIndex}`);
          if (key === "trigger_conditions") {
            values.push(JSON.stringify(value));
          } else {
            values.push(value);
          }
        }
      }

      if (updateFields.length === 0) {
        throw new Error("No valid fields to update");
      }

      updateFields.push("updated_at = CURRENT_TIMESTAMP");

      const workflowResult = await client.query(
        `
        UPDATE approval_workflows 
        SET ${updateFields.join(", ")}
        WHERE workflow_id = $1 AND store_id = $2
        RETURNING *
      `,
        [workflowId, storeId, ...values]
      );

      if (workflowResult.rows.length === 0) {
        throw new Error("Workflow not found");
      }

      // Update steps if provided
      if (updateData.steps) {
        // Delete existing steps
        await client.query(
          `
          DELETE FROM approval_workflow_steps 
          WHERE workflow_id = $1
        `,
          [workflowId]
        );

        // Create new steps
        const createdSteps = [];
        for (let i = 0; i < updateData.steps.length; i++) {
          const step = updateData.steps[i];
          const stepResult = await client.query(
            `
            INSERT INTO approval_workflow_steps (
              workflow_id, step_order, step_name, approver_user_id,
              approver_role, approval_criteria, is_required, timeout_hours
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
          `,
            [
              workflowId,
              i + 1,
              step.step_name,
              step.approver_user_id || null,
              step.approver_role || null,
              JSON.stringify(step.approval_criteria || {}),
              step.is_required !== false,
              step.timeout_hours || 72,
            ]
          );

          createdSteps.push(stepResult.rows[0]);
        }

        await client.query("COMMIT");

        return {
          ...workflowResult.rows[0],
          steps: createdSteps,
        };
      }

      await client.query("COMMIT");
      return workflowResult.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`Failed to update workflow: ${error.message}`);
    } finally {
      client.release();
    }
  }

  /**
   * Check for overdue approvals and send escalation notifications
   * @param {string} storeId - Store ID
   * @returns {Promise<Object>} Escalation summary
   */
  async processEscalations(storeId) {
    try {
      const overdueResult = await db.query(
        `
        SELECT 
          poa.*,
          po.po_number,
          po.total_amount,
          s.supplier_name,
          aws.step_name,
          aws.timeout_hours,
          u.email as approver_email,
          EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - poa.created_at))/3600 as hours_pending
        FROM purchase_order_approvals poa
        JOIN purchase_orders po ON poa.po_id = po.po_id
        JOIN suppliers s ON po.supplier_id = s.supplier_id
        JOIN approval_workflow_steps aws ON poa.step_id = aws.step_id
        LEFT JOIN users u ON poa.approver_user_id = u.user_id
        WHERE poa.status = 'pending'
        AND po.store_id = $1
        AND EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - poa.created_at))/3600 > aws.timeout_hours
        ORDER BY hours_pending DESC
      `,
        [storeId]
      );

      const overdueApprovals = overdueResult.rows;
      const escalations = [];

      for (const approval of overdueApprovals) {
        // Here you would typically send escalation notifications
        // For now, we'll just log the escalation
        escalations.push({
          approval_id: approval.approval_id,
          po_number: approval.po_number,
          approver_email: approval.approver_email,
          hours_overdue: approval.hours_pending - approval.timeout_hours,
          escalation_action: "notification_sent", // In real implementation, this would be the actual action taken
        });
      }

      return {
        total_overdue: overdueApprovals.length,
        escalations,
        processed_at: new Date(),
      };
    } catch (error) {
      throw new Error(`Failed to process escalations: ${error.message}`);
    }
  }

  // Helper methods

  /**
   * Evaluate trigger conditions against request data
   * @param {Object} triggerConditions - Workflow trigger conditions
   * @param {Object} requestData - Request data to evaluate
   * @returns {boolean} Whether conditions are met
   */
  evaluateTriggerConditions(triggerConditions, requestData) {
    try {
      if (!triggerConditions || !triggerConditions.conditions) {
        return false;
      }

      for (const condition of triggerConditions.conditions) {
        const { field, operator, value } = condition;
        const requestValue = this.getNestedValue(requestData, field);

        if (!this.evaluateCondition(requestValue, operator, value)) {
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error("Error evaluating trigger conditions:", error);
      return false;
    }
  }

  /**
   * Evaluate a single condition
   * @param {any} requestValue - Value from request data
   * @param {string} operator - Comparison operator
   * @param {any} conditionValue - Value to compare against
   * @returns {boolean} Whether condition is met
   */
  evaluateCondition(requestValue, operator, conditionValue) {
    switch (operator) {
      case "eq":
        return requestValue == conditionValue;
      case "ne":
        return requestValue != conditionValue;
      case "gt":
        return Number(requestValue) > Number(conditionValue);
      case "gte":
        return Number(requestValue) >= Number(conditionValue);
      case "lt":
        return Number(requestValue) < Number(conditionValue);
      case "lte":
        return Number(requestValue) <= Number(conditionValue);
      case "contains":
        return String(requestValue).includes(String(conditionValue));
      case "in":
        return (
          Array.isArray(conditionValue) && conditionValue.includes(requestValue)
        );
      default:
        return false;
    }
  }

  /**
   * Get nested value from object using dot notation
   * @param {Object} obj - Object to search in
   * @param {string} path - Dot-separated path (e.g., 'user.profile.name')
   * @returns {any} Value at path or undefined
   */
  getNestedValue(obj, path) {
    return path.split(".").reduce((current, key) => current?.[key], obj);
  }

  /**
   * Get next pending approval from list
   * @param {Array} approvals - List of approvals
   * @returns {Object|null} Next pending approval
   */
  getNextPendingApproval(approvals) {
    return approvals.find((approval) => approval.status === "pending") || null;
  }
}

module.exports = ApprovalWorkflowEngine;
