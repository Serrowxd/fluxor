const {
  supplierManagementQueue,
  purchaseOrderQueue,
  reorderPointQueue,
  approvalWorkflowQueue,
  supplierCommunicationQueue,
  automatedReorderQueue,
  supplierPerformanceQueue,
} = require("../../config/redis");

const SupplierManagementService = require("../services/SupplierManagementService");
const PurchaseOrderService = require("../services/PurchaseOrderService");
const ReorderPointEngine = require("../services/ReorderPointEngine");
const ApprovalWorkflowEngine = require("../services/ApprovalWorkflowEngine");
const SupplierCommunicationService = require("../services/SupplierCommunicationService");

/**
 * SupplierPurchaseOrderJobs
 *
 * Background job processors for supplier and purchase order operations:
 * - Automated reorder checks
 * - Purchase order generation
 * - Supplier notifications
 * - Performance tracking
 * - Approval workflow processing
 */
class SupplierPurchaseOrderJobs {
  constructor() {
    this.supplierService = new SupplierManagementService();
    this.purchaseOrderService = new PurchaseOrderService();
    this.reorderEngine = new ReorderPointEngine();
    this.approvalEngine = new ApprovalWorkflowEngine();
    this.communicationService = new SupplierCommunicationService();
  }

  /**
   * Set up all job processors
   */
  setupProcessors() {
    console.log("Setting up Supplier and Purchase Order job processors...");

    // Automated Reorder Queue
    automatedReorderQueue.process(
      "check-reorder-points",
      5,
      this.processReorderCheck.bind(this)
    );
    automatedReorderQueue.process(
      "generate-auto-pos",
      3,
      this.processAutoPOGeneration.bind(this)
    );
    automatedReorderQueue.process(
      "optimize-reorder-points",
      2,
      this.processReorderOptimization.bind(this)
    );

    // Purchase Order Queue
    purchaseOrderQueue.process(
      "send-po-email",
      10,
      this.processPOEmail.bind(this)
    );
    purchaseOrderQueue.process(
      "update-po-status",
      15,
      this.processPOStatusUpdate.bind(this)
    );
    purchaseOrderQueue.process(
      "process-po-receipt",
      10,
      this.processPOReceipt.bind(this)
    );

    // Approval Workflow Queue
    approvalWorkflowQueue.process(
      "start-approval",
      10,
      this.processStartApproval.bind(this)
    );
    approvalWorkflowQueue.process(
      "process-approval-decision",
      15,
      this.processApprovalDecision.bind(this)
    );
    approvalWorkflowQueue.process(
      "escalate-overdue",
      5,
      this.processApprovalEscalation.bind(this)
    );

    // Supplier Communication Queue
    supplierCommunicationQueue.process(
      "send-email",
      10,
      this.processSupplierEmail.bind(this)
    );
    supplierCommunicationQueue.process(
      "send-overdue-reminders",
      3,
      this.processOverdueReminders.bind(this)
    );
    supplierCommunicationQueue.process(
      "process-edi-message",
      5,
      this.processEDIMessage.bind(this)
    );

    // Supplier Performance Queue
    supplierPerformanceQueue.process(
      "record-performance",
      15,
      this.processPerformanceRecord.bind(this)
    );
    supplierPerformanceQueue.process(
      "update-ratings",
      5,
      this.processRatingUpdate.bind(this)
    );
    supplierPerformanceQueue.process(
      "generate-performance-report",
      2,
      this.processPerformanceReport.bind(this)
    );

    // Reorder Point Queue
    reorderPointQueue.process(
      "calculate-reorder-point",
      10,
      this.processReorderCalculation.bind(this)
    );
    reorderPointQueue.process(
      "bulk-optimize",
      3,
      this.processBulkOptimization.bind(this)
    );

    // Supplier Management Queue
    supplierManagementQueue.process(
      "sync-supplier-data",
      5,
      this.processSupplierSync.bind(this)
    );
    supplierManagementQueue.process(
      "validate-supplier-info",
      10,
      this.processSupplierValidation.bind(this)
    );

    // Set up error and completion handlers
    this.setupEventHandlers();

    console.log("Supplier and Purchase Order job processors setup complete");
  }

  // === AUTOMATED REORDER PROCESSORS ===

  /**
   * Process reorder point checks
   */
  async processReorderCheck(job) {
    const { storeId, productIds, supplierId } = job.data;

    try {
      console.log(`Processing reorder check for store ${storeId}`);

      // Check which products need reordering
      const reorderResult =
        await this.purchaseOrderService.generateAutomaticPurchaseOrders(
          storeId,
          {
            dryRun: true,
            supplierId,
            productIds,
          }
        );

      // If products need reordering, queue PO generation jobs
      if (reorderResult.generated_pos.length > 0) {
        for (const po of reorderResult.generated_pos) {
          await automatedReorderQueue.add(
            "generate-auto-pos",
            {
              storeId,
              supplierId: po.supplier.supplier_id,
              items: po.items,
              estimatedTotal: po.estimated_total,
            },
            {
              delay: 5000, // 5 second delay between PO generations
              attempts: 3,
            }
          );
        }
      }

      return {
        success: true,
        itemsNeedingReorder: reorderResult.reorder_items_found,
        posToGenerate: reorderResult.generated_pos.length,
      };
    } catch (error) {
      console.error("Error in reorder check job:", error);
      throw error;
    }
  }

  /**
   * Process automatic PO generation
   */
  async processAutoPOGeneration(job) {
    const { storeId, supplierId, items, estimatedTotal } = job.data;

    try {
      console.log(
        `Generating automatic PO for supplier ${supplierId}, estimated total: $${estimatedTotal}`
      );

      const po = await this.purchaseOrderService.createPurchaseOrder(
        storeId,
        "system",
        {
          supplier_id: supplierId,
          items,
          notes: "Auto-generated purchase order based on reorder rules",
        }
      );

      // Start approval process if required
      await approvalWorkflowQueue.add("start-approval", {
        poId: po.po_id,
        storeId,
        totalAmount: po.total_amount,
        supplierId,
      });

      return {
        success: true,
        poId: po.po_id,
        poNumber: po.po_number,
        totalAmount: po.total_amount,
      };
    } catch (error) {
      console.error("Error in auto PO generation job:", error);
      throw error;
    }
  }

  /**
   * Process reorder point optimization
   */
  async processReorderOptimization(job) {
    const { storeId, productIds, serviceLevel, updateRules } = job.data;

    try {
      console.log(`Optimizing reorder points for store ${storeId}`);

      const result = await this.reorderEngine.optimizeReorderPoints(storeId, {
        productIds,
        serviceLevel: serviceLevel || 0.95,
        updateRules: updateRules || false,
      });

      return {
        success: true,
        optimizedProducts: result.successful_optimizations,
        failedProducts: result.failed_optimizations,
      };
    } catch (error) {
      console.error("Error in reorder optimization job:", error);
      throw error;
    }
  }

  // === PURCHASE ORDER PROCESSORS ===

  /**
   * Process PO email sending
   */
  async processPOEmail(job) {
    const { poId, options = {} } = job.data;

    try {
      console.log(`Sending PO email for PO ${poId}`);

      const result = await this.communicationService.sendPurchaseOrderEmail(
        poId,
        options
      );

      return {
        success: true,
        communicationId: result.communication_id,
        messageId: result.message_id,
        recipient: result.recipient,
      };
    } catch (error) {
      console.error("Error in PO email job:", error);
      throw error;
    }
  }

  /**
   * Process PO status updates
   */
  async processPOStatusUpdate(job) {
    const { poId, storeId, status, userId, additionalData = {} } = job.data;

    try {
      console.log(`Updating PO ${poId} status to ${status}`);

      const updatedPO =
        await this.purchaseOrderService.updatePurchaseOrderStatus(
          poId,
          storeId,
          status,
          userId,
          additionalData
        );

      // Send status update notifications
      await supplierCommunicationQueue.add("send-email", {
        type: "status_update",
        poId,
        status,
        details: additionalData,
      });

      return {
        success: true,
        poId: updatedPO.po_id,
        newStatus: updatedPO.status,
      };
    } catch (error) {
      console.error("Error in PO status update job:", error);
      throw error;
    }
  }

  /**
   * Process PO receipt
   */
  async processPOReceipt(job) {
    const { poId, storeId, receivedItems, userId } = job.data;

    try {
      console.log(`Processing receipt for PO ${poId}`);

      const receiptSummary = await this.purchaseOrderService.receiveItems(
        poId,
        storeId,
        receivedItems,
        userId
      );

      // Record supplier performance metrics
      if (receiptSummary.received_items.length > 0) {
        await supplierPerformanceQueue.add("record-performance", {
          poId,
          receivedItems: receiptSummary.received_items,
          fullyReceived: receiptSummary.fully_received,
        });
      }

      return {
        success: true,
        totalReceived: receiptSummary.total_received,
        fullyReceived: receiptSummary.fully_received,
      };
    } catch (error) {
      console.error("Error in PO receipt job:", error);
      throw error;
    }
  }

  // === APPROVAL WORKFLOW PROCESSORS ===

  /**
   * Process approval workflow start
   */
  async processStartApproval(job) {
    const { poId, storeId, totalAmount, supplierId } = job.data;

    try {
      console.log(`Starting approval process for PO ${poId}`);

      const approvalProcess = await this.approvalEngine.startApprovalProcess(
        poId,
        storeId,
        {
          total_amount: totalAmount,
          supplier_id: supplierId,
        }
      );

      return {
        success: true,
        workflowApplied: approvalProcess.workflow_applied,
        status: approvalProcess.status,
      };
    } catch (error) {
      console.error("Error in approval start job:", error);
      throw error;
    }
  }

  /**
   * Process approval decisions
   */
  async processApprovalDecision(job) {
    const { approvalId, approverId, decision, comments } = job.data;

    try {
      console.log(
        `Processing approval decision ${decision} for approval ${approvalId}`
      );

      const result = await this.approvalEngine.processApprovalDecision(
        approvalId,
        approverId,
        decision,
        comments
      );

      // Send notification about approval decision
      await supplierCommunicationQueue.add("send-email", {
        type: "approval_decision",
        poId: result.po_id,
        decision,
        status: result.po_status,
      });

      return {
        success: true,
        decision,
        poStatus: result.po_status,
      };
    } catch (error) {
      console.error("Error in approval decision job:", error);
      throw error;
    }
  }

  /**
   * Process approval escalations
   */
  async processApprovalEscalation(job) {
    const { storeId } = job.data;

    try {
      console.log(`Processing approval escalations for store ${storeId}`);

      const escalationSummary = await this.approvalEngine.processEscalations(
        storeId
      );

      return {
        success: true,
        totalOverdue: escalationSummary.total_overdue,
        escalationsProcessed: escalationSummary.escalations.length,
      };
    } catch (error) {
      console.error("Error in approval escalation job:", error);
      throw error;
    }
  }

  // === SUPPLIER COMMUNICATION PROCESSORS ===

  /**
   * Process supplier email sending
   */
  async processSupplierEmail(job) {
    const { type, poId, status, details = {} } = job.data;

    try {
      console.log(`Sending supplier email of type ${type} for PO ${poId}`);

      let result;

      switch (type) {
        case "status_update":
          result = await this.communicationService.sendOrderStatusUpdate(
            poId,
            status,
            details
          );
          break;
        case "approval_decision":
          result = await this.communicationService.sendOrderStatusUpdate(
            poId,
            status,
            {
              notes: `Purchase order ${status}`,
            }
          );
          break;
        default:
          throw new Error(`Unknown email type: ${type}`);
      }

      return {
        success: true,
        communicationId: result.communication_id,
        recipient: result.recipient,
      };
    } catch (error) {
      console.error("Error in supplier email job:", error);
      throw error;
    }
  }

  /**
   * Process overdue reminder sending
   */
  async processOverdueReminders(job) {
    const { storeId, gracePeriodDays = 2, maxReminders = 3 } = job.data;

    try {
      console.log(`Sending overdue reminders for store ${storeId}`);

      const result = await this.communicationService.sendOverdueReminders(
        storeId,
        {
          gracePeriodDays,
          maxReminders,
        }
      );

      return {
        success: true,
        totalOverdue: result.total_overdue,
        remindersSent: result.reminders_sent,
        remindersFailed: result.reminders_failed,
      };
    } catch (error) {
      console.error("Error in overdue reminders job:", error);
      throw error;
    }
  }

  /**
   * Process EDI message
   */
  async processEDIMessage(job) {
    const { ediData } = job.data;

    try {
      console.log(`Processing EDI message type ${ediData.messageType}`);

      const result = await this.communicationService.processEDIMessage(ediData);

      return {
        success: result.success,
        messageType: ediData.messageType,
        description: result.description,
      };
    } catch (error) {
      console.error("Error in EDI message job:", error);
      throw error;
    }
  }

  // === SUPPLIER PERFORMANCE PROCESSORS ===

  /**
   * Process performance record
   */
  async processPerformanceRecord(job) {
    const { poId, receivedItems, fullyReceived } = job.data;

    try {
      console.log(`Recording performance for PO ${poId}`);

      // This would involve calculating delivery time performance and other metrics
      // For now, we'll return a success status

      return {
        success: true,
        poId,
        metricsRecorded: receivedItems.length,
      };
    } catch (error) {
      console.error("Error in performance record job:", error);
      throw error;
    }
  }

  /**
   * Process supplier rating updates
   */
  async processRatingUpdate(job) {
    const { supplierId } = job.data;

    try {
      console.log(`Updating rating for supplier ${supplierId}`);

      await this.supplierService.updateSupplierRating(supplierId);

      return {
        success: true,
        supplierId,
      };
    } catch (error) {
      console.error("Error in rating update job:", error);
      throw error;
    }
  }

  /**
   * Process performance report generation
   */
  async processPerformanceReport(job) {
    const { supplierId, filters } = job.data;

    try {
      console.log(`Generating performance report for supplier ${supplierId}`);

      const analytics =
        await this.supplierService.getSupplierPerformanceAnalytics(
          supplierId,
          filters
        );

      return {
        success: true,
        supplierId,
        reportGenerated: true,
        metricsCount: analytics.length,
      };
    } catch (error) {
      console.error("Error in performance report job:", error);
      throw error;
    }
  }

  // === REORDER POINT PROCESSORS ===

  /**
   * Process reorder point calculation
   */
  async processReorderCalculation(job) {
    const { productId, supplierId, options = {} } = job.data;

    try {
      console.log(`Calculating reorder point for product ${productId}`);

      const analysis = await this.reorderEngine.calculateReorderPoint(
        productId,
        {
          supplierId,
          ...options,
        }
      );

      return {
        success: true,
        productId,
        recommendedReorderPoint: analysis.recommended_reorder_point,
        confidenceScore: analysis.confidence_score,
      };
    } catch (error) {
      console.error("Error in reorder calculation job:", error);
      throw error;
    }
  }

  /**
   * Process bulk optimization
   */
  async processBulkOptimization(job) {
    const { storeId, options = {} } = job.data;

    try {
      console.log(`Processing bulk reorder optimization for store ${storeId}`);

      const result = await this.reorderEngine.optimizeReorderPoints(
        storeId,
        options
      );

      return {
        success: true,
        totalProducts: result.total_products,
        successfulOptimizations: result.successful_optimizations,
        failedOptimizations: result.failed_optimizations,
      };
    } catch (error) {
      console.error("Error in bulk optimization job:", error);
      throw error;
    }
  }

  // === SUPPLIER MANAGEMENT PROCESSORS ===

  /**
   * Process supplier data sync
   */
  async processSupplierSync(job) {
    const { supplierId, syncType } = job.data;

    try {
      console.log(`Syncing supplier data for ${supplierId}, type: ${syncType}`);

      // Placeholder for supplier data sync logic

      return {
        success: true,
        supplierId,
        syncType,
      };
    } catch (error) {
      console.error("Error in supplier sync job:", error);
      throw error;
    }
  }

  /**
   * Process supplier validation
   */
  async processSupplierValidation(job) {
    const { supplierId, validationType } = job.data;

    try {
      console.log(`Validating supplier ${supplierId}, type: ${validationType}`);

      // Placeholder for supplier validation logic

      return {
        success: true,
        supplierId,
        validationType,
        isValid: true,
      };
    } catch (error) {
      console.error("Error in supplier validation job:", error);
      throw error;
    }
  }

  // === EVENT HANDLERS ===

  /**
   * Set up event handlers for all queues
   */
  setupEventHandlers() {
    const queues = [
      automatedReorderQueue,
      purchaseOrderQueue,
      approvalWorkflowQueue,
      supplierCommunicationQueue,
      supplierPerformanceQueue,
      reorderPointQueue,
      supplierManagementQueue,
    ];

    queues.forEach((queue) => {
      queue.on("completed", (job, result) => {
        console.log(`Job ${job.id} completed successfully:`, result);
      });

      queue.on("failed", (job, err) => {
        console.error(`Job ${job.id} failed:`, err.message);
      });

      queue.on("stalled", (job) => {
        console.warn(`Job ${job.id} stalled`);
      });
    });
  }

  // === STATIC METHODS FOR ADDING JOBS ===

  /**
   * Add a job to the appropriate queue
   */
  static async addJob(queueName, jobType, data, options = {}) {
    const queues = {
      "automated-reorder": automatedReorderQueue,
      "purchase-order": purchaseOrderQueue,
      "approval-workflow": approvalWorkflowQueue,
      "supplier-communication": supplierCommunicationQueue,
      "supplier-performance": supplierPerformanceQueue,
      "reorder-point": reorderPointQueue,
      "supplier-management": supplierManagementQueue,
    };

    const queue = queues[queueName];
    if (!queue) {
      throw new Error(`Unknown queue: ${queueName}`);
    }

    const job = await queue.add(jobType, data, {
      attempts: 3,
      backoff: "exponential",
      ...options,
    });

    return job;
  }

  /**
   * Get queue statistics
   */
  static async getQueueStats() {
    const queues = {
      "automated-reorder": automatedReorderQueue,
      "purchase-order": purchaseOrderQueue,
      "approval-workflow": approvalWorkflowQueue,
      "supplier-communication": supplierCommunicationQueue,
      "supplier-performance": supplierPerformanceQueue,
      "reorder-point": reorderPointQueue,
      "supplier-management": supplierManagementQueue,
    };

    const stats = {};
    for (const [name, queue] of Object.entries(queues)) {
      stats[name] = {
        waiting: await queue.getWaiting().then((jobs) => jobs.length),
        active: await queue.getActive().then((jobs) => jobs.length),
        completed: await queue.getCompleted().then((jobs) => jobs.length),
        failed: await queue.getFailed().then((jobs) => jobs.length),
      };
    }

    return stats;
  }
}

module.exports = SupplierPurchaseOrderJobs;
