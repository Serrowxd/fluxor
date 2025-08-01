class ReturnsService {
  constructor(options) {
    this.database = options.database;
    this.eventBus = options.eventBus;
    this.inventory = options.inventory;
    this.returnPrefix = options.returnPrefix || 'RMA';
    this.returnWindow = options.returnWindow || 30; // days
  }

  async initialize() {
    await this._ensureTablesExist();
  }

  async create(order, returnData) {
    const rmaId = this._generateRMAId();
    const rmaNumber = await this._generateRMANumber();
    
    const rma = {
      id: rmaId,
      rma_number: rmaNumber,
      order_id: order.id,
      customer_id: order.customerId,
      status: 'initiated',
      reason: returnData.reason,
      reason_details: returnData.reasonDetails,
      type: returnData.type || 'return', // return, exchange, warranty
      items: await this._prepareReturnItems(returnData.items, order.items),
      shipping_method: returnData.shippingMethod || 'customer_ship',
      return_label_sent: false,
      inspection_required: this._requiresInspection(returnData.reason),
      refund_amount: 0,
      restocking_fee: 0,
      warehouse_id: returnData.warehouseId || order.warehouseId,
      notes: returnData.notes,
      metadata: returnData.metadata || {},
      created_at: new Date(),
      updated_at: new Date()
    };

    rma.estimated_refund = await this._calculateEstimatedRefund(rma, order);

    await this.database.transaction(async (trx) => {
      await trx.insert('returns', rma);
      
      for (const item of rma.items) {
        await trx.insert('return_items', {
          return_id: rma.id,
          ...item
        });
      }

      if (returnData.images) {
        for (const image of returnData.images) {
          await trx.insert('return_images', {
            return_id: rma.id,
            image_url: image.url,
            image_type: image.type || 'damage',
            uploaded_at: new Date()
          });
        }
      }

      await this._recordReturnHistory(trx, rma.id, 'created', {
        reason: rma.reason,
        items: rma.items.map(i => ({ 
          productId: i.product_id, 
          quantity: i.quantity 
        }))
      });
    });

    if (rma.shipping_method === 'prepaid_label') {
      await this._generateReturnLabel(rma);
    }

    this.eventBus.emit('return:created', {
      rmaId: rma.id,
      orderId: order.id,
      customerId: order.customerId
    });

    return this._formatReturn(rma);
  }

  async process(rmaId, action) {
    const rma = await this.getById(rmaId);
    
    if (!this._canProcessReturn(rma)) {
      throw new Error('Return cannot be processed in current state');
    }

    await this.database.transaction(async (trx) => {
      switch (action.type) {
        case 'approve':
          await this._approveReturn(trx, rma, action);
          break;
        case 'reject':
          await this._rejectReturn(trx, rma, action);
          break;
        case 'receive':
          await this._receiveReturn(trx, rma, action);
          break;
        case 'inspect':
          await this._inspectReturn(trx, rma, action);
          break;
        case 'complete':
          await this._completeReturn(trx, rma, action);
          break;
        default:
          throw new Error(`Unknown return action: ${action.type}`);
      }
    });

    return await this.getById(rmaId);
  }

  async updateStatus(rmaId, status, metadata = {}) {
    const rma = await this.getById(rmaId);
    const previousStatus = rma.status;
    
    if (!this._isValidStatusTransition(rma.status, status)) {
      throw new Error(`Invalid status transition from ${rma.status} to ${status}`);
    }

    await this.database.transaction(async (trx) => {
      await trx.update('returns', {
        status,
        updated_at: new Date(),
        [`${status}_at`]: new Date()
      }, { id: rmaId });

      await this._recordReturnHistory(trx, rmaId, 'status_changed', {
        from: previousStatus,
        to: status,
        ...metadata
      });
    });

    this.eventBus.emit('return:status:changed', {
      rmaId,
      previousStatus,
      newStatus: status,
      metadata
    });

    return await this.getById(rmaId);
  }

  async getById(rmaId) {
    const rma = await this.database.queryOne(
      'SELECT * FROM returns WHERE id = $1',
      [rmaId]
    );

    if (!rma) {
      throw new Error(`Return not found: ${rmaId}`);
    }

    rma.items = await this.database.query(
      'SELECT * FROM return_items WHERE return_id = $1',
      [rmaId]
    );

    rma.images = await this.database.query(
      'SELECT * FROM return_images WHERE return_id = $1',
      [rmaId]
    );

    rma.history = await this.database.query(
      'SELECT * FROM return_history WHERE return_id = $1 ORDER BY created_at DESC',
      [rmaId]
    );

    return this._formatReturn(rma);
  }

  async searchReturns(criteria) {
    let query = 'SELECT * FROM returns WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (criteria.customerId) {
      query += ` AND customer_id = $${paramIndex++}`;
      params.push(criteria.customerId);
    }

    if (criteria.orderId) {
      query += ` AND order_id = $${paramIndex++}`;
      params.push(criteria.orderId);
    }

    if (criteria.status) {
      if (Array.isArray(criteria.status)) {
        query += ` AND status IN (${criteria.status.map(() => `$${paramIndex++}`).join(',')})`;
        params.push(...criteria.status);
      } else {
        query += ` AND status = $${paramIndex++}`;
        params.push(criteria.status);
      }
    }

    if (criteria.dateFrom) {
      query += ` AND created_at >= $${paramIndex++}`;
      params.push(criteria.dateFrom);
    }

    if (criteria.dateTo) {
      query += ` AND created_at <= $${paramIndex++}`;
      params.push(criteria.dateTo);
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

    const returns = await this.database.query(query, params);
    
    return Promise.all(returns.map(rma => this.getById(rma.id)));
  }

  async getMetrics(period = '30d') {
    const since = this._calculateSinceDate(period);
    
    const metrics = await this.database.queryOne(`
      SELECT 
        COUNT(*) as total_returns,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_returns,
        COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected_returns,
        SUM(refund_amount) as total_refunded,
        AVG(refund_amount) as average_refund,
        COUNT(DISTINCT order_id) as unique_orders
      FROM returns
      WHERE created_at >= $1
    `, [since]);

    const reasonBreakdown = await this.database.query(`
      SELECT reason, COUNT(*) as count
      FROM returns
      WHERE created_at >= $1
      GROUP BY reason
      ORDER BY count DESC
    `, [since]);

    const productReturns = await this.database.query(`
      SELECT 
        ri.product_id,
        p.name as product_name,
        COUNT(DISTINCT r.id) as return_count,
        SUM(ri.quantity) as total_quantity
      FROM returns r
      JOIN return_items ri ON r.id = ri.return_id
      JOIN products p ON ri.product_id = p.id
      WHERE r.created_at >= $1
      GROUP BY ri.product_id, p.name
      ORDER BY return_count DESC
      LIMIT 10
    `, [since]);

    const totalOrders = await this.database.queryOne(
      'SELECT COUNT(*) as count FROM orders WHERE created_at >= $1',
      [since]
    );

    return {
      totalReturns: parseInt(metrics.total_returns),
      completedReturns: parseInt(metrics.completed_returns),
      rejectedReturns: parseInt(metrics.rejected_returns),
      totalRefunded: parseFloat(metrics.total_refunded || 0),
      averageRefund: parseFloat(metrics.average_refund || 0),
      returnRate: totalOrders.count > 0 
        ? (metrics.unique_orders / totalOrders.count * 100).toFixed(2)
        : 0,
      reasonBreakdown: reasonBreakdown.reduce((acc, row) => {
        acc[row.reason] = parseInt(row.count);
        return acc;
      }, {}),
      topReturnedProducts: productReturns
    };
  }

  async _prepareReturnItems(requestedItems, orderItems) {
    const preparedItems = [];
    
    for (const reqItem of requestedItems) {
      const orderItem = orderItems.find(
        item => item.productId === reqItem.productId && 
                item.variantId === reqItem.variantId
      );

      if (!orderItem) {
        throw new Error(`Product not found in order: ${reqItem.productId}`);
      }

      if (reqItem.quantity > orderItem.quantity) {
        throw new Error(`Return quantity exceeds ordered quantity for product: ${reqItem.productId}`);
      }

      preparedItems.push({
        product_id: reqItem.productId,
        variant_id: reqItem.variantId,
        sku: orderItem.sku,
        name: orderItem.name,
        quantity: reqItem.quantity,
        unit_price: orderItem.unitPrice,
        reason: reqItem.reason,
        condition: 'unknown', // Will be updated after inspection
        metadata: reqItem.metadata || {}
      });
    }

    return preparedItems;
  }

  async _calculateEstimatedRefund(rma, order) {
    let refundAmount = 0;
    
    for (const item of rma.items) {
      refundAmount += item.quantity * item.unit_price;
    }

    // Apply restocking fee if applicable
    const restockingFee = this._calculateRestockingFee(rma.reason, refundAmount);
    refundAmount -= restockingFee;

    // Include shipping refund if applicable
    if (this._shouldRefundShipping(rma.reason)) {
      refundAmount += order.shippingAmount;
    }

    return {
      subtotal: refundAmount + restockingFee,
      restockingFee,
      shippingRefund: this._shouldRefundShipping(rma.reason) ? order.shippingAmount : 0,
      total: refundAmount
    };
  }

  _calculateRestockingFee(reason, amount) {
    const restockingFees = {
      'changed_mind': 0.15, // 15%
      'found_better_price': 0.20, // 20%
      'no_longer_needed': 0.15, // 15%
      'defective': 0, // No fee for defective items
      'damaged': 0,
      'wrong_item': 0,
      'not_as_described': 0
    };

    const feePercentage = restockingFees[reason] || 0;
    return amount * feePercentage;
  }

  _shouldRefundShipping(reason) {
    const shippingRefundReasons = [
      'defective',
      'damaged',
      'wrong_item',
      'not_as_described'
    ];
    
    return shippingRefundReasons.includes(reason);
  }

  _requiresInspection(reason) {
    const noInspectionReasons = ['unopened', 'wrong_item'];
    return !noInspectionReasons.includes(reason);
  }

  async _generateReturnLabel(rma) {
    // Integration with shipping provider to generate return label
    // This is a placeholder - implement actual shipping integration
    
    const label = {
      carrier: 'USPS',
      trackingNumber: `RET${Date.now()}`,
      labelUrl: `https://labels.example.com/${rma.id}`,
      cost: 0 // Prepaid by merchant
    };

    await this.database.update('returns', {
      return_label: JSON.stringify(label),
      return_label_sent: true,
      return_label_sent_at: new Date()
    }, { id: rma.id });

    // Send email with return label
    if (this.eventBus) {
      this.eventBus.emit('email:send', {
        template: 'return-label',
        to: rma.customer_email,
        data: { rma, label }
      });
    }

    return label;
  }

  async _approveReturn(trx, rma, action) {
    await trx.update('returns', {
      status: 'approved',
      approved_at: new Date(),
      approved_by: action.approvedBy,
      updated_at: new Date()
    }, { id: rma.id });

    await this._recordReturnHistory(trx, rma.id, 'approved', {
      approvedBy: action.approvedBy,
      notes: action.notes
    });

    if (rma.shipping_method === 'prepaid_label' && !rma.return_label_sent) {
      await this._generateReturnLabel(rma);
    }
  }

  async _rejectReturn(trx, rma, action) {
    await trx.update('returns', {
      status: 'rejected',
      rejected_at: new Date(),
      rejected_by: action.rejectedBy,
      rejection_reason: action.reason,
      updated_at: new Date()
    }, { id: rma.id });

    await this._recordReturnHistory(trx, rma.id, 'rejected', {
      rejectedBy: action.rejectedBy,
      reason: action.reason,
      notes: action.notes
    });
  }

  async _receiveReturn(trx, rma, action) {
    await trx.update('returns', {
      status: 'received',
      received_at: new Date(),
      received_by: action.receivedBy,
      tracking_number: action.trackingNumber,
      updated_at: new Date()
    }, { id: rma.id });

    for (const item of action.receivedItems || []) {
      await trx.update('return_items', {
        received_quantity: item.quantity,
        initial_condition: item.condition,
        received_at: new Date()
      }, {
        return_id: rma.id,
        product_id: item.productId
      });
    }

    await this._recordReturnHistory(trx, rma.id, 'received', {
      receivedBy: action.receivedBy,
      trackingNumber: action.trackingNumber,
      items: action.receivedItems
    });
  }

  async _inspectReturn(trx, rma, action) {
    const inspectionResults = action.results || [];
    let totalRefund = 0;
    let restockableItems = [];

    for (const result of inspectionResults) {
      await trx.update('return_items', {
        inspected_quantity: result.quantity,
        final_condition: result.condition,
        inspection_notes: result.notes,
        restockable: result.restockable,
        refund_percentage: result.refundPercentage || 100,
        inspected_at: new Date()
      }, {
        return_id: rma.id,
        product_id: result.productId
      });

      const item = rma.items.find(i => i.product_id === result.productId);
      const itemRefund = (item.unit_price * result.quantity) * (result.refundPercentage / 100);
      totalRefund += itemRefund;

      if (result.restockable) {
        restockableItems.push({
          productId: result.productId,
          quantity: result.quantity
        });
      }
    }

    await trx.update('returns', {
      status: 'inspected',
      inspected_at: new Date(),
      inspected_by: action.inspectedBy,
      inspection_passed: action.passed,
      final_refund_amount: totalRefund,
      updated_at: new Date()
    }, { id: rma.id });

    await this._recordReturnHistory(trx, rma.id, 'inspected', {
      inspectedBy: action.inspectedBy,
      passed: action.passed,
      results: inspectionResults,
      refundAmount: totalRefund
    });
  }

  async _completeReturn(trx, rma, action) {
    await trx.update('returns', {
      status: 'completed',
      completed_at: new Date(),
      completed_by: action.completedBy,
      resolution_type: action.resolutionType,
      refund_amount: action.refundAmount || rma.final_refund_amount,
      updated_at: new Date()
    }, { id: rma.id });

    await this._recordReturnHistory(trx, rma.id, 'completed', {
      completedBy: action.completedBy,
      resolutionType: action.resolutionType,
      refundAmount: action.refundAmount
    });

    this.eventBus.emit('return:completed', {
      rmaId: rma.id,
      orderId: rma.order_id,
      resolutionType: action.resolutionType,
      refundAmount: action.refundAmount
    });
  }

  _canProcessReturn(rma) {
    const processableStatuses = ['initiated', 'approved', 'received', 'inspected'];
    return processableStatuses.includes(rma.status);
  }

  _isValidStatusTransition(from, to) {
    const transitions = {
      initiated: ['approved', 'rejected'],
      approved: ['received', 'cancelled'],
      received: ['inspected', 'completed'],
      inspected: ['completed'],
      completed: [],
      rejected: [],
      cancelled: []
    };

    return transitions[from]?.includes(to) || false;
  }

  async _recordReturnHistory(trx, returnId, event, data) {
    await trx.insert('return_history', {
      return_id: returnId,
      event,
      data: JSON.stringify(data),
      created_at: new Date()
    });
  }

  _generateRMAId() {
    return `rma_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async _generateRMANumber() {
    const date = new Date();
    const year = date.getFullYear().toString().substr(-2);
    
    const lastRMA = await this.database.queryOne(
      `SELECT rma_number FROM returns 
       WHERE rma_number LIKE $1 
       ORDER BY created_at DESC 
       LIMIT 1`,
      [`${this.returnPrefix}${year}%`]
    );

    let sequence = 1;
    if (lastRMA) {
      const match = lastRMA.rma_number.match(/(\d+)$/);
      if (match) {
        sequence = parseInt(match[1]) + 1;
      }
    }

    return `${this.returnPrefix}${year}${sequence.toString().padStart(5, '0')}`;
  }

  _calculateSinceDate(period) {
    const match = period.match(/^(\d+)([dhm])$/);
    if (!match) {
      throw new Error(`Invalid period format: ${period}`);
    }
    
    const [, value, unit] = match;
    const now = new Date();
    
    switch (unit) {
      case 'd':
        now.setDate(now.getDate() - parseInt(value));
        break;
      case 'h':
        now.setHours(now.getHours() - parseInt(value));
        break;
      case 'm':
        now.setMinutes(now.getMinutes() - parseInt(value));
        break;
    }
    
    return now;
  }

  _formatReturn(rma) {
    return {
      id: rma.id,
      rmaNumber: rma.rma_number,
      orderId: rma.order_id,
      customerId: rma.customer_id,
      status: rma.status,
      reason: rma.reason,
      reasonDetails: rma.reason_details,
      type: rma.type,
      items: rma.items,
      images: rma.images,
      shippingMethod: rma.shipping_method,
      returnLabel: rma.return_label ? JSON.parse(rma.return_label) : null,
      returnLabelSent: rma.return_label_sent,
      inspectionRequired: rma.inspection_required,
      estimatedRefund: rma.estimated_refund,
      finalRefundAmount: rma.final_refund_amount,
      refundAmount: rma.refund_amount,
      restockingFee: rma.restocking_fee,
      warehouseId: rma.warehouse_id,
      notes: rma.notes,
      metadata: rma.metadata,
      history: rma.history,
      createdAt: rma.created_at,
      updatedAt: rma.updated_at,
      approvedAt: rma.approved_at,
      receivedAt: rma.received_at,
      inspectedAt: rma.inspected_at,
      completedAt: rma.completed_at
    };
  }

  async _ensureTablesExist() {
    // Table creation would be handled by migrations
  }
}

module.exports = ReturnsService;