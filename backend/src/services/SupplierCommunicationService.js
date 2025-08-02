const db = require("../../config/database");
const nodemailer = require("nodemailer");
const fs = require("fs").promises;
const path = require("path");

/**
 * SupplierCommunicationService
 *
 * Handles all communication with suppliers including:
 * - Email notifications for purchase orders
 * - EDI integration for automated ordering
 * - Communication tracking and logging
 * - Template management for various communication types
 */
class SupplierCommunicationService {
  constructor() {
    this.emailTransporter = null;
    this.initializeEmailTransporter();
  }

  /**
   * Initialize email transporter
   */
  async initializeEmailTransporter() {
    try {
      // Validate required email configuration
      if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
        console.warn("Email configuration missing - email notifications will be disabled");
        this.emailTransporter = null;
        return;
      }

      // Validate port is a number
      const smtpPort = parseInt(process.env.SMTP_PORT || '587');
      if (isNaN(smtpPort)) {
        console.error("Invalid SMTP_PORT configuration");
        this.emailTransporter = null;
        return;
      }

      this.emailTransporter = nodemailer.createTransporter({
        host: process.env.SMTP_HOST || "smtp.gmail.com",
        port: smtpPort,
        secure: smtpPort === 465,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
        tls: {
          rejectUnauthorized: process.env.NODE_ENV === 'production'
        }
      });

      // Verify connection
      await this.emailTransporter.verify();
      console.log("Email transporter initialized successfully");
    } catch (error) {
      console.error("Failed to initialize email transporter:", error);
      this.emailTransporter = null;
    }
  }

  /**
   * Send purchase order to supplier via email
   * @param {string} poId - Purchase order ID
   * @param {Object} options - Email options
   * @returns {Promise<Object>} Communication result
   */
  async sendPurchaseOrderEmail(poId, options = {}) {
    try {
      const {
        includeAttachment = true,
        customMessage = "",
        urgentDelivery = false,
      } = options;

      // Get PO details
      const poResult = await db.query(
        `
        SELECT 
          po.*,
          s.supplier_name,
          s.email as supplier_email,
          s.contact_name,
          u.email as created_by_email,
          store.store_name
        FROM purchase_orders po
        JOIN suppliers s ON po.supplier_id = s.supplier_id
        JOIN users u ON po.created_by = u.user_id
        JOIN stores store ON po.store_id = store.store_id
        WHERE po.po_id = $1
      `,
        [poId]
      );

      if (poResult.rows.length === 0) {
        throw new Error("Purchase order not found");
      }

      const po = poResult.rows[0];

      if (!po.supplier_email) {
        throw new Error("Supplier email not found");
      }

      // Get PO items
      const itemsResult = await db.query(
        `
        SELECT 
          poi.*,
          p.product_name,
          p.sku,
          sp.supplier_sku
        FROM purchase_order_items poi
        JOIN products p ON poi.product_id = p.product_id
        LEFT JOIN supplier_products sp ON poi.supplier_product_id = sp.supplier_product_id
        WHERE poi.po_id = $1
        ORDER BY p.product_name
      `,
        [poId]
      );

      const items = itemsResult.rows;

      // Generate email content
      const emailContent = await this.generatePOEmailContent(
        po,
        items,
        customMessage,
        urgentDelivery
      );

      // Send email
      const emailOptions = {
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: po.supplier_email,
        cc: po.created_by_email,
        subject: `Purchase Order ${po.po_number} - ${po.store_name}`,
        html: emailContent.html,
        text: emailContent.text,
      };

      // Add PDF attachment if requested
      if (includeAttachment) {
        const pdfBuffer = await this.generatePOPDF(po, items);
        emailOptions.attachments = [
          {
            filename: `PO_${po.po_number}.pdf`,
            content: pdfBuffer,
            contentType: "application/pdf",
          },
        ];
      }

      let emailResult;
      if (this.emailTransporter) {
        emailResult = await this.emailTransporter.sendMail(emailOptions);
      } else {
        // Mock email sending for development/testing
        emailResult = {
          messageId: `mock-${Date.now()}`,
          response: "Mock email sent successfully",
        };
      }

      // Log communication
      const communicationLog = await this.logCommunication({
        supplier_id: po.supplier_id,
        po_id: poId,
        communication_type: "email",
        direction: "outbound",
        subject: emailOptions.subject,
        content: emailContent.text,
        status: "sent",
        metadata: {
          message_id: emailResult.messageId,
          recipients: [po.supplier_email],
          cc: [po.created_by_email],
          urgent: urgentDelivery,
          attachment_included: includeAttachment,
        },
      });

      return {
        success: true,
        communication_id: communicationLog.communication_id,
        message_id: emailResult.messageId,
        recipient: po.supplier_email,
        subject: emailOptions.subject,
        sent_at: new Date(),
      };
    } catch (error) {
      // Log failed communication
      try {
        await this.logCommunication({
          supplier_id: poResult?.rows[0]?.supplier_id,
          po_id: poId,
          communication_type: "email",
          direction: "outbound",
          subject: `Purchase Order ${poResult?.rows[0]?.po_number || poId}`,
          content: `Failed to send: ${error.message}`,
          status: "failed",
          metadata: { error: error.message },
        });
      } catch (logError) {
        console.error("Failed to log communication error:", logError);
      }

      throw new Error(`Failed to send purchase order email: ${error.message}`);
    }
  }

  /**
   * Send order status update to requester
   * @param {string} poId - Purchase order ID
   * @param {string} status - New status
   * @param {Object} details - Additional details
   * @returns {Promise<Object>} Communication result
   */
  async sendOrderStatusUpdate(poId, status, details = {}) {
    try {
      // Get PO and requester details
      const poResult = await db.query(
        `
        SELECT 
          po.*,
          s.supplier_name,
          u.email as requester_email,
          store.store_name
        FROM purchase_orders po
        JOIN suppliers s ON po.supplier_id = s.supplier_id
        JOIN users u ON po.created_by = u.user_id
        JOIN stores store ON po.store_id = store.store_id
        WHERE po.po_id = $1
      `,
        [poId]
      );

      if (poResult.rows.length === 0) {
        throw new Error("Purchase order not found");
      }

      const po = poResult.rows[0];

      // Generate status update email
      const emailContent = await this.generateStatusUpdateEmailContent(
        po,
        status,
        details
      );

      const emailOptions = {
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: po.requester_email,
        subject: `PO ${po.po_number} Status Update: ${status.toUpperCase()}`,
        html: emailContent.html,
        text: emailContent.text,
      };

      let emailResult;
      if (this.emailTransporter) {
        emailResult = await this.emailTransporter.sendMail(emailOptions);
      } else {
        emailResult = {
          messageId: `mock-status-${Date.now()}`,
          response: "Mock status update sent",
        };
      }

      // Log communication
      const communicationLog = await this.logCommunication({
        supplier_id: po.supplier_id,
        po_id: poId,
        communication_type: "email",
        direction: "outbound",
        subject: emailOptions.subject,
        content: emailContent.text,
        status: "sent",
        metadata: {
          message_id: emailResult.messageId,
          status_update: status,
          recipient_type: "requester",
        },
      });

      return {
        success: true,
        communication_id: communicationLog.communication_id,
        message_id: emailResult.messageId,
        recipient: po.requester_email,
        status_updated: status,
      };
    } catch (error) {
      throw new Error(`Failed to send status update: ${error.message}`);
    }
  }

  /**
   * Send reminder for overdue purchase orders
   * @param {string} storeId - Store ID
   * @param {Object} options - Reminder options
   * @returns {Promise<Object>} Reminder results
   */
  async sendOverdueReminders(storeId, options = {}) {
    try {
      const { gracePeriodDays = 2, maxReminders = 3 } = options;

      // Find overdue POs
      const overdueResult = await db.query(
        `
        SELECT 
          po.*,
          s.supplier_name,
          s.email as supplier_email,
          s.contact_name,
          u.email as requester_email,
          EXTRACT(DAY FROM (CURRENT_DATE - po.expected_delivery_date)) as days_overdue,
          -- Count previous reminders
          (SELECT COUNT(*) FROM supplier_communications sc 
           WHERE sc.po_id = po.po_id 
           AND sc.communication_type = 'email' 
           AND sc.subject ILIKE '%reminder%') as reminder_count
        FROM purchase_orders po
        JOIN suppliers s ON po.supplier_id = s.supplier_id
        JOIN users u ON po.created_by = u.user_id
        WHERE po.store_id = $1
        AND po.status IN ('approved', 'submitted')
        AND po.expected_delivery_date < CURRENT_DATE - INTERVAL '${gracePeriodDays} days'
        AND s.email IS NOT NULL
      `,
        [storeId]
      );

      const overdueOrders = overdueResult.rows.filter(
        (po) => po.reminder_count < maxReminders
      );

      const reminderResults = [];

      for (const po of overdueOrders) {
        try {
          const emailContent = await this.generateReminderEmailContent(po);

          const emailOptions = {
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: po.supplier_email,
            cc: po.requester_email,
            subject: `REMINDER: Overdue Purchase Order ${po.po_number} - ${po.days_overdue} days late`,
            html: emailContent.html,
            text: emailContent.text,
          };

          let emailResult;
          if (this.emailTransporter) {
            emailResult = await this.emailTransporter.sendMail(emailOptions);
          } else {
            emailResult = {
              messageId: `mock-reminder-${po.po_id}-${Date.now()}`,
              response: "Mock reminder sent",
            };
          }

          // Log reminder
          await this.logCommunication({
            supplier_id: po.supplier_id,
            po_id: po.po_id,
            communication_type: "email",
            direction: "outbound",
            subject: emailOptions.subject,
            content: emailContent.text,
            status: "sent",
            metadata: {
              message_id: emailResult.messageId,
              reminder_number: po.reminder_count + 1,
              days_overdue: po.days_overdue,
            },
          });

          reminderResults.push({
            po_id: po.po_id,
            po_number: po.po_number,
            supplier_email: po.supplier_email,
            days_overdue: po.days_overdue,
            reminder_sent: true,
            message_id: emailResult.messageId,
          });
        } catch (error) {
          reminderResults.push({
            po_id: po.po_id,
            po_number: po.po_number,
            supplier_email: po.supplier_email,
            reminder_sent: false,
            error: error.message,
          });
        }
      }

      return {
        total_overdue: overdueOrders.length,
        reminders_sent: reminderResults.filter((r) => r.reminder_sent).length,
        reminders_failed: reminderResults.filter((r) => !r.reminder_sent)
          .length,
        results: reminderResults,
      };
    } catch (error) {
      throw new Error(`Failed to send overdue reminders: ${error.message}`);
    }
  }

  /**
   * Process EDI message from supplier
   * @param {Object} ediData - EDI message data
   * @returns {Promise<Object>} Processing result
   */
  async processEDIMessage(ediData) {
    try {
      const { messageType, content, supplierId } = ediData;

      let processingResult;

      switch (messageType) {
        case "855": // Purchase Order Acknowledgment
          processingResult = await this.processPOAcknowledgment(
            content,
            supplierId
          );
          break;
        case "856": // Advance Ship Notice
          processingResult = await this.processAdvanceShipNotice(
            content,
            supplierId
          );
          break;
        case "810": // Invoice
          processingResult = await this.processEDIInvoice(content, supplierId);
          break;
        default:
          throw new Error(`Unsupported EDI message type: ${messageType}`);
      }

      // Log EDI communication
      await this.logCommunication({
        supplier_id: supplierId,
        communication_type: "edi",
        direction: "inbound",
        subject: `EDI ${messageType} - ${processingResult.description}`,
        content: JSON.stringify(content),
        status: processingResult.success ? "processed" : "failed",
        metadata: {
          message_type: messageType,
          processing_result: processingResult,
        },
      });

      return processingResult;
    } catch (error) {
      throw new Error(`Failed to process EDI message: ${error.message}`);
    }
  }

  /**
   * Get communication history for a supplier or PO
   * @param {Object} filters - Filter criteria
   * @returns {Promise<Array>} Communication history
   */
  async getCommunicationHistory(filters = {}) {
    try {
      let query = `
        SELECT 
          sc.*,
          s.supplier_name,
          po.po_number
        FROM supplier_communications sc
        JOIN suppliers s ON sc.supplier_id = s.supplier_id
        LEFT JOIN purchase_orders po ON sc.po_id = po.po_id
        WHERE 1=1
      `;

      const params = [];
      let paramIndex = 0;

      if (filters.supplier_id) {
        query += ` AND sc.supplier_id = $${++paramIndex}`;
        params.push(filters.supplier_id);
      }

      if (filters.po_id) {
        query += ` AND sc.po_id = $${++paramIndex}`;
        params.push(filters.po_id);
      }

      if (filters.communication_type) {
        query += ` AND sc.communication_type = $${++paramIndex}`;
        params.push(filters.communication_type);
      }

      if (filters.direction) {
        query += ` AND sc.direction = $${++paramIndex}`;
        params.push(filters.direction);
      }

      if (filters.start_date) {
        query += ` AND sc.sent_at >= $${++paramIndex}`;
        params.push(filters.start_date);
      }

      if (filters.end_date) {
        query += ` AND sc.sent_at <= $${++paramIndex}`;
        params.push(filters.end_date);
      }

      query += ` ORDER BY sc.sent_at DESC`;

      if (filters.limit) {
        query += ` LIMIT $${++paramIndex}`;
        params.push(filters.limit);
      }

      const result = await db.query(query, params);
      return result.rows;
    } catch (error) {
      throw new Error(`Failed to get communication history: ${error.message}`);
    }
  }

  /**
   * Log communication record
   * @param {Object} communicationData - Communication data
   * @returns {Promise<Object>} Created communication log
   */
  async logCommunication(communicationData) {
    try {
      const {
        supplier_id,
        po_id = null,
        communication_type,
        direction,
        subject,
        content,
        status = "sent",
        metadata = {},
      } = communicationData;

      const result = await db.query(
        `
        INSERT INTO supplier_communications (
          supplier_id, po_id, communication_type, direction,
          subject, content, status, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `,
        [
          supplier_id,
          po_id,
          communication_type,
          direction,
          subject,
          content,
          status,
          JSON.stringify(metadata),
        ]
      );

      return result.rows[0];
    } catch (error) {
      throw new Error(`Failed to log communication: ${error.message}`);
    }
  }

  // Helper methods for email content generation

  /**
   * Generate purchase order email content
   * @param {Object} po - Purchase order data
   * @param {Array} items - PO items
   * @param {string} customMessage - Custom message
   * @param {boolean} urgent - Urgent flag
   * @returns {Promise<Object>} Email content
   */
  async generatePOEmailContent(po, items, customMessage, urgent) {
    const urgentText = urgent ? "[URGENT] " : "";

    const text = `
${urgentText}Purchase Order: ${po.po_number}

Dear ${po.contact_name || po.supplier_name},

Please find attached our purchase order ${po.po_number} for the following items:

${items
  .map(
    (item) =>
      `- ${item.product_name} (SKU: ${item.sku || item.supplier_sku}) - Qty: ${
        item.quantity
      } @ $${item.unit_cost} = $${item.total_cost}`
  )
  .join("\n")}

Total Amount: $${po.total_amount}
Expected Delivery: ${po.expected_delivery_date || "TBD"}
Payment Terms: ${po.payment_terms || "Net 30"}

${customMessage ? `\nAdditional Notes:\n${customMessage}\n` : ""}

Please confirm receipt of this order and provide an estimated delivery date.

Best regards,
${po.store_name} Purchasing Department
    `.trim();

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">${urgentText}Purchase Order: ${
      po.po_number
    }</h2>
        
        <p>Dear ${po.contact_name || po.supplier_name},</p>
        
        <p>Please find attached our purchase order <strong>${
          po.po_number
        }</strong> for the following items:</p>
        
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <thead>
            <tr style="background-color: #f5f5f5;">
              <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Product</th>
              <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">SKU</th>
              <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">Qty</th>
              <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">Unit Cost</th>
              <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${items
              .map(
                (item) => `
              <tr>
                <td style="border: 1px solid #ddd; padding: 8px;">${
                  item.product_name
                }</td>
                <td style="border: 1px solid #ddd; padding: 8px;">${
                  item.sku || item.supplier_sku
                }</td>
                <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">${
                  item.quantity
                }</td>
                <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">$${
                  item.unit_cost
                }</td>
                <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">$${
                  item.total_cost
                }</td>
              </tr>
            `
              )
              .join("")}
          </tbody>
          <tfoot>
            <tr style="background-color: #f5f5f5; font-weight: bold;">
              <td colspan="4" style="border: 1px solid #ddd; padding: 8px; text-align: right;">Total Amount:</td>
              <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">$${
                po.total_amount
              }</td>
            </tr>
          </tfoot>
        </table>
        
        <div style="margin: 20px 0;">
          <p><strong>Expected Delivery:</strong> ${
            po.expected_delivery_date || "TBD"
          }</p>
          <p><strong>Payment Terms:</strong> ${po.payment_terms || "Net 30"}</p>
        </div>
        
        ${
          customMessage
            ? `<div style="background-color: #f9f9f9; padding: 15px; margin: 20px 0; border-left: 4px solid #007cba;">
          <h4>Additional Notes:</h4>
          <p>${customMessage}</p>
        </div>`
            : ""
        }
        
        <p>Please confirm receipt of this order and provide an estimated delivery date.</p>
        
        <p>Best regards,<br>
        <strong>${po.store_name} Purchasing Department</strong></p>
      </div>
    `;

    return { text, html };
  }

  /**
   * Generate status update email content
   * @param {Object} po - Purchase order data
   * @param {string} status - New status
   * @param {Object} details - Additional details
   * @returns {Promise<Object>} Email content
   */
  async generateStatusUpdateEmailContent(po, status, details) {
    const statusMessages = {
      approved: "Your purchase order has been approved and is being processed.",
      shipped: "Your purchase order has been shipped.",
      received: "Your purchase order has been received and processed.",
      cancelled: "Your purchase order has been cancelled.",
      delayed: "Your purchase order delivery has been delayed.",
    };

    const message =
      statusMessages[status] || `Purchase order status updated to: ${status}`;

    const text = `
Purchase Order Status Update: ${po.po_number}

${message}

Order Details:
- PO Number: ${po.po_number}
- Supplier: ${po.supplier_name}
- Total Amount: $${po.total_amount}
- Status: ${status.toUpperCase()}

${details.notes ? `Notes: ${details.notes}` : ""}
${details.tracking_number ? `Tracking Number: ${details.tracking_number}` : ""}
${
  details.expected_delivery
    ? `Expected Delivery: ${details.expected_delivery}`
    : ""
}

For questions about this order, please contact our purchasing department.

Best regards,
${po.store_name} Team
    `.trim();

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Purchase Order Status Update</h2>
        <h3 style="color: #007cba;">PO: ${po.po_number}</h3>
        
        <div style="background-color: #e8f4fd; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p style="margin: 0; font-size: 16px;">${message}</p>
        </div>
        
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>PO Number:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${
              po.po_number
            }</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Supplier:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${
              po.supplier_name
            }</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Total Amount:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">$${
              po.total_amount
            }</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Status:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong style="color: #007cba;">${status.toUpperCase()}</strong></td>
          </tr>
          ${
            details.tracking_number
              ? `
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Tracking Number:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${details.tracking_number}</td>
          </tr>`
              : ""
          }
          ${
            details.expected_delivery
              ? `
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Expected Delivery:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${details.expected_delivery}</td>
          </tr>`
              : ""
          }
        </table>
        
        ${
          details.notes
            ? `
        <div style="background-color: #f9f9f9; padding: 15px; border-left: 4px solid #007cba; margin: 20px 0;">
          <h4 style="margin: 0 0 10px 0;">Notes:</h4>
          <p style="margin: 0;">${details.notes}</p>
        </div>`
            : ""
        }
        
        <p>For questions about this order, please contact our purchasing department.</p>
        
        <p>Best regards,<br>
        <strong>${po.store_name} Team</strong></p>
      </div>
    `;

    return { text, html };
  }

  /**
   * Generate reminder email content
   * @param {Object} po - Purchase order data
   * @returns {Promise<Object>} Email content
   */
  async generateReminderEmailContent(po) {
    const text = `
REMINDER: Overdue Purchase Order ${po.po_number}

Dear ${po.contact_name || po.supplier_name},

This is a reminder that Purchase Order ${po.po_number} is now ${
      po.days_overdue
    } days overdue.

Original Expected Delivery: ${po.expected_delivery_date}
Total Amount: $${po.total_amount}

Please provide an updated delivery schedule or contact us immediately to discuss this order.

If you have already shipped this order, please provide tracking information.

This order is critical to our operations, and we appreciate your immediate attention.

Best regards,
${po.store_name} Purchasing Department
    `.trim();

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
          <h2 style="color: #856404; margin: 0;">⚠️ REMINDER: Overdue Purchase Order</h2>
        </div>
        
        <h3 style="color: #333;">PO: ${po.po_number} - ${
      po.days_overdue
    } Days Overdue</h3>
        
        <p>Dear ${po.contact_name || po.supplier_name},</p>
        
        <p>This is a reminder that Purchase Order <strong>${
          po.po_number
        }</strong> is now <strong style="color: #dc3545;">${
      po.days_overdue
    } days overdue</strong>.</p>
        
        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p><strong>Original Expected Delivery:</strong> ${
            po.expected_delivery_date
          }</p>
          <p><strong>Total Amount:</strong> $${po.total_amount}</p>
          <p><strong>Days Overdue:</strong> <span style="color: #dc3545; font-weight: bold;">${
            po.days_overdue
          }</span></p>
        </div>
        
        <p><strong>Please provide an updated delivery schedule or contact us immediately to discuss this order.</strong></p>
        
        <p>If you have already shipped this order, please provide tracking information.</p>
        
        <div style="background-color: #d1ecf1; border: 1px solid #bee5eb; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p style="margin: 0;"><strong>This order is critical to our operations, and we appreciate your immediate attention.</strong></p>
        </div>
        
        <p>Best regards,<br>
        <strong>${po.store_name} Purchasing Department</strong></p>
      </div>
    `;

    return { text, html };
  }

  /**
   * Generate PDF attachment for purchase order
   * @param {Object} po - Purchase order data
   * @param {Array} items - PO items
   * @returns {Promise<Buffer>} PDF buffer
   */
  async generatePOPDF(po, items) {
    // This is a simplified PDF generation
    // In a real implementation, you would use a library like puppeteer or pdfkit
    const pdfContent = `
Purchase Order: ${po.po_number}
Date: ${new Date(po.created_at).toLocaleDateString()}

Supplier: ${po.supplier_name}
Total: $${po.total_amount}

Items:
${items
  .map(
    (item) =>
      `${item.product_name} - Qty: ${item.quantity} @ $${item.unit_cost}`
  )
  .join("\n")}
    `;

    // Mock PDF generation - return text as buffer
    return Buffer.from(pdfContent, "utf8");
  }

  // EDI Processing Methods

  /**
   * Process Purchase Order Acknowledgment (EDI 855)
   * @param {Object} content - EDI content
   * @param {string} supplierId - Supplier ID
   * @returns {Promise<Object>} Processing result
   */
  async processPOAcknowledgment(content, supplierId) {
    // Process PO acknowledgment logic
    return {
      success: true,
      description: "Purchase Order Acknowledgment processed",
      po_number: content.po_number,
      acknowledged_items: content.items?.length || 0,
    };
  }

  /**
   * Process Advance Ship Notice (EDI 856)
   * @param {Object} content - EDI content
   * @param {string} supplierId - Supplier ID
   * @returns {Promise<Object>} Processing result
   */
  async processAdvanceShipNotice(content, supplierId) {
    // Process ASN logic
    return {
      success: true,
      description: "Advance Ship Notice processed",
      tracking_number: content.tracking_number,
      shipment_date: content.shipment_date,
    };
  }

  /**
   * Process EDI Invoice (EDI 810)
   * @param {Object} content - EDI content
   * @param {string} supplierId - Supplier ID
   * @returns {Promise<Object>} Processing result
   */
  async processEDIInvoice(content, supplierId) {
    // Process invoice logic
    return {
      success: true,
      description: "Invoice processed",
      invoice_number: content.invoice_number,
      amount: content.total_amount,
    };
  }
}

module.exports = SupplierCommunicationService;
