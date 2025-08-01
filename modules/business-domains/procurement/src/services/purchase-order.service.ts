/**
 * Purchase Order Service
 * Handles creation, management, and processing of purchase orders
 */

import {
  PurchaseOrder,
  PurchaseOrderItem,
  PurchaseOrderStatus,
  PurchaseOrderTemplate,
  ApprovalStatus,
  PaymentTerms,
  DeliveryTerms
} from '../types';
import { SupplierService } from './supplier.service';
import { ApprovalWorkflowService } from './approval-workflow.service';

export class PurchaseOrderService {
  private database: any;
  private eventBus: any;
  private supplierService: SupplierService;
  private approvalWorkflowService: ApprovalWorkflowService;
  private orderCache: Map<string, PurchaseOrder> = new Map();

  constructor(
    database: any,
    eventBus: any,
    supplierService: SupplierService,
    approvalWorkflowService: ApprovalWorkflowService
  ) {
    this.database = database;
    this.eventBus = eventBus;
    this.supplierService = supplierService;
    this.approvalWorkflowService = approvalWorkflowService;
  }

  /**
   * Create a new purchase order
   */
  async createPurchaseOrder(
    orderData: Partial<PurchaseOrder>,
    userId: string
  ): Promise<PurchaseOrder> {
    try {
      // Validate supplier
      const supplier = await this.supplierService.getSupplier(orderData.supplierId!);
      if (!supplier || supplier.status !== 'active') {
        throw new Error('Invalid or inactive supplier');
      }

      // Generate order number
      const orderNumber = await this.generateOrderNumber();

      // Calculate totals
      const totals = this.calculateOrderTotals(orderData.items || []);

      // Create purchase order
      const purchaseOrder: PurchaseOrder = {
        id: `po-${Date.now()}`,
        orderNumber,
        supplierId: orderData.supplierId!,
        warehouseId: orderData.warehouseId!,
        status: 'draft',
        items: orderData.items || [],
        subtotal: totals.subtotal,
        tax: totals.tax,
        shipping: orderData.shipping || 0,
        totalAmount: totals.subtotal + totals.tax + (orderData.shipping || 0),
        currency: orderData.currency || 'USD',
        paymentTerms: orderData.paymentTerms || supplier.paymentTerms,
        deliveryTerms: orderData.deliveryTerms || supplier.deliveryTerms,
        expectedDeliveryDate: orderData.expectedDeliveryDate || this.calculateExpectedDelivery(supplier.leadTimeDays),
        notes: orderData.notes,
        attachments: orderData.attachments || [],
        approvalStatus: 'not_required',
        approvalHistory: [],
        createdBy: userId,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Check if approval is required
      const requiresApproval = await this.approvalWorkflowService.requiresApproval(
        'purchase_order',
        purchaseOrder
      );

      if (requiresApproval) {
        purchaseOrder.status = 'pending_approval';
        purchaseOrder.approvalStatus = 'pending';
      }

      // Save to database
      await this.savePurchaseOrder(purchaseOrder);

      // Cache the order
      this.orderCache.set(purchaseOrder.id, purchaseOrder);

      // Emit event
      await this.eventBus.emit('PurchaseOrderCreated', {
        orderId: purchaseOrder.id,
        supplierId: purchaseOrder.supplierId,
        totalAmount: purchaseOrder.totalAmount,
        requiresApproval
      });

      // Submit for approval if required
      if (requiresApproval) {
        await this.submitForApproval(purchaseOrder, userId);
      }

      return purchaseOrder;
    } catch (error) {
      console.error('Error creating purchase order:', error);
      throw error;
    }
  }

  /**
   * Update an existing purchase order
   */
  async updatePurchaseOrder(
    orderId: string,
    updates: Partial<PurchaseOrder>,
    userId: string
  ): Promise<PurchaseOrder> {
    try {
      const existingOrder = await this.getPurchaseOrder(orderId);
      if (!existingOrder) {
        throw new Error('Purchase order not found');
      }

      // Validate status allows updates
      if (!this.canUpdateOrder(existingOrder.status)) {
        throw new Error(`Cannot update order in ${existingOrder.status} status`);
      }

      // Recalculate totals if items changed
      if (updates.items) {
        const totals = this.calculateOrderTotals(updates.items);
        updates.subtotal = totals.subtotal;
        updates.tax = totals.tax;
        updates.totalAmount = totals.subtotal + totals.tax + (updates.shipping || existingOrder.shipping);
      }

      // Merge updates
      const updatedOrder: PurchaseOrder = {
        ...existingOrder,
        ...updates,
        updatedAt: new Date()
      };

      // Check if approval is required for changes
      if (existingOrder.approvalStatus === 'approved' && this.requiresReapproval(existingOrder, updatedOrder)) {
        updatedOrder.status = 'pending_approval';
        updatedOrder.approvalStatus = 'pending';
        updatedOrder.approvalHistory.push({
          id: `approval-${Date.now()}`,
          action: 'submitted',
          userId,
          userName: userId, // In production, would fetch user name
          timestamp: new Date(),
          comments: 'Resubmitted due to changes'
        });
      }

      // Save updates
      await this.savePurchaseOrder(updatedOrder);
      this.orderCache.set(orderId, updatedOrder);

      // Emit event
      await this.eventBus.emit('PurchaseOrderUpdated', {
        orderId: updatedOrder.id,
        changes: updates,
        userId
      });

      return updatedOrder;
    } catch (error) {
      console.error('Error updating purchase order:', error);
      throw error;
    }
  }

  /**
   * Get purchase order by ID
   */
  async getPurchaseOrder(orderId: string): Promise<PurchaseOrder | null> {
    // Check cache first
    if (this.orderCache.has(orderId)) {
      return this.orderCache.get(orderId)!;
    }

    // Query database
    const query = `
      SELECT * FROM purchase_orders
      WHERE id = $1
    `;

    const result = await this.database.query(query, [orderId]);
    
    if (result.rows.length === 0) {
      return null;
    }

    const order = this.mapDatabaseRowToOrder(result.rows[0]);
    this.orderCache.set(orderId, order);

    return order;
  }

  /**
   * Search purchase orders
   */
  async searchPurchaseOrders(criteria: {
    supplierId?: string;
    warehouseId?: string;
    status?: PurchaseOrderStatus[];
    dateFrom?: Date;
    dateTo?: Date;
    minAmount?: number;
    maxAmount?: number;
    limit?: number;
    offset?: number;
  }): Promise<{ orders: PurchaseOrder[]; total: number }> {
    let query = `
      SELECT po.*, COUNT(*) OVER() as total_count
      FROM purchase_orders po
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramIndex = 1;

    if (criteria.supplierId) {
      query += ` AND supplier_id = $${paramIndex++}`;
      params.push(criteria.supplierId);
    }

    if (criteria.warehouseId) {
      query += ` AND warehouse_id = $${paramIndex++}`;
      params.push(criteria.warehouseId);
    }

    if (criteria.status && criteria.status.length > 0) {
      query += ` AND status = ANY($${paramIndex++})`;
      params.push(criteria.status);
    }

    if (criteria.dateFrom) {
      query += ` AND created_at >= $${paramIndex++}`;
      params.push(criteria.dateFrom);
    }

    if (criteria.dateTo) {
      query += ` AND created_at <= $${paramIndex++}`;
      params.push(criteria.dateTo);
    }

    if (criteria.minAmount !== undefined) {
      query += ` AND total_amount >= $${paramIndex++}`;
      params.push(criteria.minAmount);
    }

    if (criteria.maxAmount !== undefined) {
      query += ` AND total_amount <= $${paramIndex++}`;
      params.push(criteria.maxAmount);
    }

    query += ` ORDER BY created_at DESC`;

    if (criteria.limit) {
      query += ` LIMIT $${paramIndex++}`;
      params.push(criteria.limit);
    }

    if (criteria.offset) {
      query += ` OFFSET $${paramIndex++}`;
      params.push(criteria.offset);
    }

    const result = await this.database.query(query, params);
    
    const orders = result.rows.map(row => this.mapDatabaseRowToOrder(row));
    const total = result.rows[0]?.total_count || 0;

    return { orders, total };
  }

  /**
   * Submit purchase order to supplier
   */
  async submitToSupplier(orderId: string, userId: string): Promise<void> {
    try {
      const order = await this.getPurchaseOrder(orderId);
      if (!order) {
        throw new Error('Purchase order not found');
      }

      // Validate order can be submitted
      if (order.status !== 'approved' && order.approvalStatus !== 'approved') {
        throw new Error('Order must be approved before submission');
      }

      // Update status
      order.status = 'sent';
      order.updatedAt = new Date();

      await this.savePurchaseOrder(order);

      // Send to supplier (in production, would integrate with email/EDI)
      await this.sendOrderToSupplier(order);

      // Emit event
      await this.eventBus.emit('PurchaseOrderSent', {
        orderId: order.id,
        supplierId: order.supplierId,
        sentBy: userId
      });

    } catch (error) {
      console.error('Error submitting purchase order:', error);
      throw error;
    }
  }

  /**
   * Acknowledge order receipt from supplier
   */
  async acknowledgeOrder(
    orderId: string,
    acknowledgment: {
      confirmed: boolean;
      expectedDeliveryDate?: Date;
      notes?: string;
    }
  ): Promise<void> {
    try {
      const order = await this.getPurchaseOrder(orderId);
      if (!order) {
        throw new Error('Purchase order not found');
      }

      if (acknowledgment.confirmed) {
        order.status = 'acknowledged';
        if (acknowledgment.expectedDeliveryDate) {
          order.expectedDeliveryDate = acknowledgment.expectedDeliveryDate;
        }
      } else {
        order.status = 'cancelled';
      }

      if (acknowledgment.notes) {
        order.notes = (order.notes || '') + '\n\nSupplier Notes: ' + acknowledgment.notes;
      }

      order.updatedAt = new Date();
      await this.savePurchaseOrder(order);

      // Emit event
      await this.eventBus.emit('PurchaseOrderAcknowledged', {
        orderId: order.id,
        confirmed: acknowledgment.confirmed,
        supplierId: order.supplierId
      });

    } catch (error) {
      console.error('Error acknowledging purchase order:', error);
      throw error;
    }
  }

  /**
   * Receive items from purchase order
   */
  async receiveItems(
    orderId: string,
    receivedItems: Array<{
      itemId: string;
      receivedQuantity: number;
      notes?: string;
    }>,
    userId: string
  ): Promise<void> {
    try {
      const order = await this.getPurchaseOrder(orderId);
      if (!order) {
        throw new Error('Purchase order not found');
      }

      // Validate order status
      if (!['acknowledged', 'partially_received'].includes(order.status)) {
        throw new Error('Order must be acknowledged before receiving items');
      }

      // Update received quantities
      let allItemsReceived = true;
      let anyItemsReceived = false;

      for (const receivedItem of receivedItems) {
        const orderItem = order.items.find(item => item.id === receivedItem.itemId);
        if (!orderItem) {
          throw new Error(`Item ${receivedItem.itemId} not found in order`);
        }

        orderItem.receivedQuantity = (orderItem.receivedQuantity || 0) + receivedItem.receivedQuantity;
        
        if (orderItem.receivedQuantity < orderItem.quantity) {
          allItemsReceived = false;
        }
        
        if (orderItem.receivedQuantity > 0) {
          anyItemsReceived = true;
        }

        if (receivedItem.notes) {
          orderItem.notes = (orderItem.notes || '') + '\n' + receivedItem.notes;
        }
      }

      // Update order status
      if (allItemsReceived) {
        order.status = 'received';
        order.actualDeliveryDate = new Date();
      } else if (anyItemsReceived) {
        order.status = 'partially_received';
      }

      order.updatedAt = new Date();
      await this.savePurchaseOrder(order);

      // Update inventory
      await this.updateInventory(order, receivedItems);

      // Emit event
      await this.eventBus.emit('PurchaseOrderItemsReceived', {
        orderId: order.id,
        supplierId: order.supplierId,
        receivedItems,
        fullyReceived: allItemsReceived,
        receivedBy: userId
      });

      // If fully received, trigger supplier performance update
      if (allItemsReceived) {
        await this.eventBus.emit('PurchaseOrderReceived', {
          orderId: order.id,
          supplierId: order.supplierId,
          expectedDate: order.expectedDeliveryDate,
          actualDate: order.actualDeliveryDate,
          onTime: order.actualDeliveryDate! <= order.expectedDeliveryDate
        });
      }

    } catch (error) {
      console.error('Error receiving items:', error);
      throw error;
    }
  }

  /**
   * Complete purchase order
   */
  async completePurchaseOrder(orderId: string, userId: string): Promise<void> {
    try {
      const order = await this.getPurchaseOrder(orderId);
      if (!order) {
        throw new Error('Purchase order not found');
      }

      if (order.status !== 'received') {
        throw new Error('All items must be received before completing order');
      }

      order.status = 'completed';
      order.updatedAt = new Date();

      await this.savePurchaseOrder(order);

      // Emit event
      await this.eventBus.emit('PurchaseOrderCompleted', {
        orderId: order.id,
        supplierId: order.supplierId,
        completedBy: userId
      });

    } catch (error) {
      console.error('Error completing purchase order:', error);
      throw error;
    }
  }

  /**
   * Cancel purchase order
   */
  async cancelPurchaseOrder(
    orderId: string,
    reason: string,
    userId: string
  ): Promise<void> {
    try {
      const order = await this.getPurchaseOrder(orderId);
      if (!order) {
        throw new Error('Purchase order not found');
      }

      // Validate cancellation is allowed
      if (!this.canCancelOrder(order.status)) {
        throw new Error(`Cannot cancel order in ${order.status} status`);
      }

      order.status = 'cancelled';
      order.notes = (order.notes || '') + `\n\nCancelled: ${reason}`;
      order.updatedAt = new Date();

      await this.savePurchaseOrder(order);

      // Notify supplier if order was sent
      if (['sent', 'acknowledged'].includes(order.status)) {
        await this.notifySupplierCancellation(order, reason);
      }

      // Emit event
      await this.eventBus.emit('PurchaseOrderCancelled', {
        orderId: order.id,
        supplierId: order.supplierId,
        reason,
        cancelledBy: userId
      });

    } catch (error) {
      console.error('Error cancelling purchase order:', error);
      throw error;
    }
  }

  /**
   * Create purchase order from template
   */
  async createFromTemplate(
    templateId: string,
    overrides: Partial<PurchaseOrder>,
    userId: string
  ): Promise<PurchaseOrder> {
    try {
      const template = await this.getTemplate(templateId);
      if (!template) {
        throw new Error('Template not found');
      }

      const orderData: Partial<PurchaseOrder> = {
        supplierId: template.supplierId,
        items: template.items.map(item => ({
          ...item,
          id: `item-${Date.now()}-${Math.random()}`,
        } as PurchaseOrderItem)),
        paymentTerms: template.paymentTerms,
        deliveryTerms: template.deliveryTerms,
        notes: template.notes,
        ...overrides
      };

      return this.createPurchaseOrder(orderData, userId);
    } catch (error) {
      console.error('Error creating from template:', error);
      throw error;
    }
  }

  /**
   * Helper methods
   */

  private async generateOrderNumber(): Promise<string> {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    
    // Get next sequence number
    const result = await this.database.query(
      `SELECT COUNT(*) + 1 as next_seq
       FROM purchase_orders
       WHERE order_number LIKE $1`,
      [`PO-${year}${month}%`]
    );

    const sequence = String(result.rows[0].next_seq).padStart(4, '0');
    return `PO-${year}${month}${sequence}`;
  }

  private calculateOrderTotals(items: PurchaseOrderItem[]): {
    subtotal: number;
    tax: number;
  } {
    let subtotal = 0;
    let tax = 0;

    for (const item of items) {
      const itemTotal = item.quantity * item.unitPrice * (1 - (item.discount || 0) / 100);
      const itemTax = itemTotal * (item.taxRate / 100);
      
      subtotal += itemTotal;
      tax += itemTax;
      
      item.totalPrice = itemTotal + itemTax;
    }

    return { subtotal, tax };
  }

  private calculateExpectedDelivery(leadTimeDays: number): Date {
    const date = new Date();
    date.setDate(date.getDate() + leadTimeDays);
    return date;
  }

  private canUpdateOrder(status: PurchaseOrderStatus): boolean {
    return ['draft', 'pending_approval', 'approved'].includes(status);
  }

  private canCancelOrder(status: PurchaseOrderStatus): boolean {
    return !['received', 'completed', 'cancelled'].includes(status);
  }

  private requiresReapproval(
    original: PurchaseOrder,
    updated: PurchaseOrder
  ): boolean {
    // Requires reapproval if total amount increased by more than 10%
    const amountChange = (updated.totalAmount - original.totalAmount) / original.totalAmount;
    return amountChange > 0.1;
  }

  private async submitForApproval(order: PurchaseOrder, userId: string): Promise<void> {
    await this.approvalWorkflowService.submitForApproval({
      entityType: 'purchase_order',
      entityId: order.id,
      entityData: order,
      submittedBy: userId
    });
  }

  private async savePurchaseOrder(order: PurchaseOrder): Promise<void> {
    const query = `
      INSERT INTO purchase_orders (
        id, order_number, supplier_id, warehouse_id, status,
        items, subtotal, tax, shipping, total_amount, currency,
        payment_terms, delivery_terms, expected_delivery_date,
        actual_delivery_date, notes, attachments, approval_status,
        approval_history, created_by, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
      ON CONFLICT (id) DO UPDATE SET
        status = $5,
        items = $6,
        subtotal = $7,
        tax = $8,
        shipping = $9,
        total_amount = $10,
        expected_delivery_date = $14,
        actual_delivery_date = $15,
        notes = $16,
        attachments = $17,
        approval_status = $18,
        approval_history = $19,
        updated_at = $22
    `;

    await this.database.query(query, [
      order.id,
      order.orderNumber,
      order.supplierId,
      order.warehouseId,
      order.status,
      JSON.stringify(order.items),
      order.subtotal,
      order.tax,
      order.shipping,
      order.totalAmount,
      order.currency,
      JSON.stringify(order.paymentTerms),
      JSON.stringify(order.deliveryTerms),
      order.expectedDeliveryDate,
      order.actualDeliveryDate,
      order.notes,
      JSON.stringify(order.attachments),
      order.approvalStatus,
      JSON.stringify(order.approvalHistory),
      order.createdBy,
      order.createdAt,
      order.updatedAt
    ]);
  }

  private mapDatabaseRowToOrder(row: any): PurchaseOrder {
    return {
      id: row.id,
      orderNumber: row.order_number,
      supplierId: row.supplier_id,
      warehouseId: row.warehouse_id,
      status: row.status,
      items: JSON.parse(row.items),
      subtotal: parseFloat(row.subtotal),
      tax: parseFloat(row.tax),
      shipping: parseFloat(row.shipping),
      totalAmount: parseFloat(row.total_amount),
      currency: row.currency,
      paymentTerms: JSON.parse(row.payment_terms),
      deliveryTerms: JSON.parse(row.delivery_terms),
      expectedDeliveryDate: row.expected_delivery_date,
      actualDeliveryDate: row.actual_delivery_date,
      notes: row.notes,
      attachments: JSON.parse(row.attachments),
      approvalStatus: row.approval_status,
      approvalHistory: JSON.parse(row.approval_history),
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private async sendOrderToSupplier(order: PurchaseOrder): Promise<void> {
    // In production, would integrate with email service or EDI
    console.log(`Sending order ${order.orderNumber} to supplier ${order.supplierId}`);
  }

  private async notifySupplierCancellation(order: PurchaseOrder, reason: string): Promise<void> {
    // In production, would send cancellation notice
    console.log(`Notifying supplier ${order.supplierId} of order ${order.orderNumber} cancellation`);
  }

  private async updateInventory(
    order: PurchaseOrder,
    receivedItems: Array<{ itemId: string; receivedQuantity: number }>
  ): Promise<void> {
    // In production, would update inventory through inventory module
    await this.eventBus.emit('InventoryReceived', {
      warehouseId: order.warehouseId,
      items: receivedItems.map(received => {
        const orderItem = order.items.find(i => i.id === received.itemId)!;
        return {
          productId: orderItem.productId,
          quantity: received.receivedQuantity,
          unitCost: orderItem.unitPrice
        };
      })
    });
  }

  private async getTemplate(templateId: string): Promise<PurchaseOrderTemplate | null> {
    const result = await this.database.query(
      'SELECT * FROM purchase_order_templates WHERE id = $1',
      [templateId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return {
      ...result.rows[0],
      items: JSON.parse(result.rows[0].items),
      paymentTerms: JSON.parse(result.rows[0].payment_terms),
      deliveryTerms: JSON.parse(result.rows[0].delivery_terms)
    };
  }

  isReady(): boolean {
    return true;
  }
}