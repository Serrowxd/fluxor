class OrderService {
  constructor(options) {
    this.database = options.database;
    this.eventBus = options.eventBus;
    this.cache = options.cache;
    this.orderPrefix = options.orderPrefix || 'ORD';
    this.autoCalculateTaxes = options.autoCalculateTaxes !== false;
  }

  async initialize() {
    await this._ensureTablesExist();
  }

  async create(orderData) {
    const orderId = this._generateOrderId();
    const orderNumber = await this._generateOrderNumber();
    
    const order = {
      id: orderId,
      order_number: orderNumber,
      customer_id: orderData.customerId,
      status: 'pending',
      items: await this._prepareOrderItems(orderData.items),
      subtotal: 0,
      tax_amount: 0,
      shipping_amount: orderData.shippingAmount || 0,
      discount_amount: 0,
      total_amount: 0,
      currency: orderData.currency || 'USD',
      billing_address: orderData.billingAddress,
      shipping_address: orderData.shippingAddress,
      payment_method: orderData.paymentMethod,
      shipping_method: orderData.shippingMethod,
      notes: orderData.notes,
      metadata: orderData.metadata || {},
      created_at: new Date(),
      updated_at: new Date()
    };

    order.subtotal = this._calculateSubtotal(order.items);
    
    if (orderData.discounts) {
      order.discount_amount = await this._calculateDiscounts(
        order.subtotal,
        orderData.discounts
      );
    }

    if (this.autoCalculateTaxes) {
      order.tax_amount = await this._calculateTaxes(order);
    } else {
      order.tax_amount = orderData.taxAmount || 0;
    }

    order.total_amount = order.subtotal + order.tax_amount + 
                        order.shipping_amount - order.discount_amount;

    await this.database.transaction(async (trx) => {
      await trx.insert('orders', order);
      
      for (const item of order.items) {
        await trx.insert('order_items', {
          order_id: order.id,
          ...item
        });
      }

      await this._recordOrderHistory(trx, order.id, 'created', {
        initial_status: 'pending'
      });
    });

    this.eventBus.emit('order:created', {
      orderId: order.id,
      customerId: order.customer_id,
      total: order.total_amount
    });

    if (this.cache) {
      await this.cache.set(`order:${order.id}`, order, { ttl: 3600 });
    }

    return this._formatOrder(order);
  }

  async update(orderId, updates) {
    const order = await this.getById(orderId);
    
    if (!this._canUpdateOrder(order)) {
      throw new Error('Order cannot be updated in current state');
    }

    const allowedUpdates = [
      'shipping_address',
      'billing_address',
      'notes',
      'metadata',
      'shipping_method',
      'payment_method'
    ];

    const filteredUpdates = {};
    for (const key of allowedUpdates) {
      if (updates[key] !== undefined) {
        filteredUpdates[key] = updates[key];
      }
    }

    filteredUpdates.updated_at = new Date();

    await this.database.transaction(async (trx) => {
      await trx.update('orders', filteredUpdates, { id: orderId });
      
      await this._recordOrderHistory(trx, orderId, 'updated', {
        updates: Object.keys(filteredUpdates)
      });
    });

    if (this.cache) {
      await this.cache.del(`order:${orderId}`);
    }

    const updatedOrder = await this.getById(orderId);
    
    this.eventBus.emit('order:updated', {
      orderId,
      updates: filteredUpdates
    });

    return updatedOrder;
  }

  async updateStatus(orderId, status, metadata = {}) {
    const order = await this.getById(orderId);
    const previousStatus = order.status;
    
    if (!this._isValidStatusTransition(order.status, status)) {
      throw new Error(`Invalid status transition from ${order.status} to ${status}`);
    }

    await this.database.transaction(async (trx) => {
      await trx.update('orders', {
        status,
        updated_at: new Date(),
        [`${status}_at`]: new Date()
      }, { id: orderId });

      await this._recordOrderHistory(trx, orderId, 'status_changed', {
        from: previousStatus,
        to: status,
        ...metadata
      });
    });

    if (this.cache) {
      await this.cache.del(`order:${orderId}`);
    }

    this.eventBus.emit('order:status:changed', {
      orderId,
      previousStatus,
      newStatus: status,
      metadata
    });

    return await this.getById(orderId);
  }

  async getById(orderId) {
    if (this.cache) {
      const cached = await this.cache.get(`order:${orderId}`);
      if (cached) return this._formatOrder(cached);
    }

    const order = await this.database.queryOne(
      'SELECT * FROM orders WHERE id = $1',
      [orderId]
    );

    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    order.items = await this.database.query(
      'SELECT * FROM order_items WHERE order_id = $1',
      [orderId]
    );

    if (this.cache) {
      await this.cache.set(`order:${orderId}`, order, { ttl: 3600 });
    }

    return this._formatOrder(order);
  }

  async search(criteria) {
    let query = 'SELECT * FROM orders WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (criteria.customerId) {
      query += ` AND customer_id = $${paramIndex++}`;
      params.push(criteria.customerId);
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

    if (criteria.search) {
      query += ` AND (order_number ILIKE $${paramIndex} OR metadata->>'search_terms' ILIKE $${paramIndex})`;
      params.push(`%${criteria.search}%`);
      paramIndex++;
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

    const orders = await this.database.query(query, params);
    
    return Promise.all(orders.map(order => this._formatOrder(order)));
  }

  async getMetrics(period = '30d') {
    const since = this._calculateSinceDate(period);
    
    const metrics = await this.database.queryOne(`
      SELECT 
        COUNT(*) as total_orders,
        COUNT(DISTINCT customer_id) as unique_customers,
        SUM(total_amount) as total_revenue,
        AVG(total_amount) as average_order_value,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_orders,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_orders,
        COUNT(CASE WHEN status = 'refunded' THEN 1 END) as refunded_orders
      FROM orders
      WHERE created_at >= $1
    `, [since]);

    const statusBreakdown = await this.database.query(`
      SELECT status, COUNT(*) as count
      FROM orders
      WHERE created_at >= $1
      GROUP BY status
    `, [since]);

    const dailyOrders = await this.database.query(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as orders,
        SUM(total_amount) as revenue
      FROM orders
      WHERE created_at >= $1
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `, [since]);

    return {
      totalOrders: parseInt(metrics.total_orders),
      uniqueCustomers: parseInt(metrics.unique_customers),
      totalRevenue: parseFloat(metrics.total_revenue || 0),
      averageOrderValue: parseFloat(metrics.average_order_value || 0),
      completedOrders: parseInt(metrics.completed_orders),
      cancelledOrders: parseInt(metrics.cancelled_orders),
      refundedOrders: parseInt(metrics.refunded_orders),
      conversionRate: metrics.total_orders > 0 
        ? (metrics.completed_orders / metrics.total_orders * 100).toFixed(2)
        : 0,
      statusBreakdown: statusBreakdown.reduce((acc, row) => {
        acc[row.status] = parseInt(row.count);
        return acc;
      }, {}),
      dailyTrend: dailyOrders,
      satisfactionScore: await this._calculateSatisfactionScore(since)
    };
  }

  async _prepareOrderItems(items) {
    const preparedItems = [];
    
    for (const item of items) {
      const product = await this._getProduct(item.productId);
      
      preparedItems.push({
        product_id: item.productId,
        variant_id: item.variantId,
        sku: item.sku || product.sku,
        name: item.name || product.name,
        quantity: item.quantity,
        unit_price: item.price || product.price,
        total_price: item.quantity * (item.price || product.price),
        tax_rate: item.taxRate || product.tax_rate || 0,
        metadata: item.metadata || {}
      });
    }

    return preparedItems;
  }

  async _getProduct(productId) {
    if (this.cache) {
      const cached = await this.cache.get(`product:${productId}`);
      if (cached) return cached;
    }

    const product = await this.database.queryOne(
      'SELECT * FROM products WHERE id = $1',
      [productId]
    );

    if (!product) {
      throw new Error(`Product not found: ${productId}`);
    }

    if (this.cache) {
      await this.cache.set(`product:${productId}`, product, { ttl: 3600 });
    }

    return product;
  }

  _calculateSubtotal(items) {
    return items.reduce((sum, item) => sum + item.total_price, 0);
  }

  async _calculateDiscounts(subtotal, discounts) {
    let totalDiscount = 0;
    
    for (const discount of discounts) {
      if (discount.type === 'percentage') {
        totalDiscount += subtotal * (discount.value / 100);
      } else if (discount.type === 'fixed') {
        totalDiscount += discount.value;
      } else if (discount.type === 'coupon') {
        const coupon = await this._validateCoupon(discount.code);
        if (coupon.type === 'percentage') {
          totalDiscount += subtotal * (coupon.value / 100);
        } else {
          totalDiscount += coupon.value;
        }
      }
    }

    return Math.min(totalDiscount, subtotal);
  }

  async _calculateTaxes(order) {
    const taxRates = await this._getTaxRates(order.shipping_address);
    let totalTax = 0;

    for (const item of order.items) {
      const itemTax = item.total_price * (item.tax_rate || taxRates.default) / 100;
      totalTax += itemTax;
    }

    if (taxRates.shipping && order.shipping_amount > 0) {
      totalTax += order.shipping_amount * taxRates.shipping / 100;
    }

    return totalTax;
  }

  async _getTaxRates(address) {
    // Simplified tax calculation - in production, integrate with tax service
    const defaultRates = {
      US: { default: 8.5, shipping: 8.5 },
      CA: { default: 13, shipping: 13 },
      UK: { default: 20, shipping: 20 },
      EU: { default: 21, shipping: 21 }
    };

    return defaultRates[address.country] || { default: 0, shipping: 0 };
  }

  async _validateCoupon(code) {
    const coupon = await this.database.queryOne(
      'SELECT * FROM coupons WHERE code = $1 AND active = true',
      [code]
    );

    if (!coupon) {
      throw new Error(`Invalid coupon code: ${code}`);
    }

    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
      throw new Error('Coupon has expired');
    }

    if (coupon.usage_limit && coupon.usage_count >= coupon.usage_limit) {
      throw new Error('Coupon usage limit exceeded');
    }

    return coupon;
  }

  async _recordOrderHistory(trx, orderId, event, data) {
    await trx.insert('order_history', {
      order_id: orderId,
      event,
      data: JSON.stringify(data),
      created_at: new Date()
    });
  }

  _generateOrderId() {
    return `ord_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async _generateOrderNumber() {
    const date = new Date();
    const year = date.getFullYear().toString().substr(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    
    const lastOrder = await this.database.queryOne(
      `SELECT order_number FROM orders 
       WHERE order_number LIKE $1 
       ORDER BY created_at DESC 
       LIMIT 1`,
      [`${this.orderPrefix}-${year}${month}%`]
    );

    let sequence = 1;
    if (lastOrder) {
      const match = lastOrder.order_number.match(/(\d+)$/);
      if (match) {
        sequence = parseInt(match[1]) + 1;
      }
    }

    return `${this.orderPrefix}-${year}${month}${sequence.toString().padStart(4, '0')}`;
  }

  _canUpdateOrder(order) {
    const nonUpdateableStatuses = ['shipped', 'delivered', 'cancelled', 'refunded'];
    return !nonUpdateableStatuses.includes(order.status);
  }

  _isValidStatusTransition(from, to) {
    const transitions = {
      pending: ['confirmed', 'cancelled'],
      confirmed: ['processing', 'cancelled'],
      processing: ['fulfilling', 'cancelled'],
      fulfilling: ['shipped', 'cancelled'],
      shipped: ['delivered', 'returned'],
      delivered: ['completed', 'returned'],
      returned: ['refunded'],
      cancelled: [],
      refunded: [],
      completed: []
    };

    return transitions[from]?.includes(to) || false;
  }

  async _calculateSatisfactionScore(since) {
    const reviews = await this.database.query(
      `SELECT AVG(rating) as avg_rating, COUNT(*) as total_reviews
       FROM order_reviews
       WHERE created_at >= $1`,
      [since]
    );

    return {
      score: parseFloat(reviews[0]?.avg_rating || 0),
      totalReviews: parseInt(reviews[0]?.total_reviews || 0)
    };
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

  _formatOrder(order) {
    return {
      id: order.id,
      orderNumber: order.order_number,
      customerId: order.customer_id,
      status: order.status,
      items: order.items,
      subtotal: parseFloat(order.subtotal),
      taxAmount: parseFloat(order.tax_amount),
      shippingAmount: parseFloat(order.shipping_amount),
      discountAmount: parseFloat(order.discount_amount),
      totalAmount: parseFloat(order.total_amount),
      currency: order.currency,
      billingAddress: order.billing_address,
      shippingAddress: order.shipping_address,
      paymentMethod: order.payment_method,
      shippingMethod: order.shipping_method,
      payment: order.payment,
      notes: order.notes,
      metadata: order.metadata,
      createdAt: order.created_at,
      updatedAt: order.updated_at,
      confirmedAt: order.confirmed_at,
      shippedAt: order.shipped_at,
      deliveredAt: order.delivered_at,
      cancelledAt: order.cancelled_at
    };
  }

  async _ensureTablesExist() {
    // Table creation would be handled by migrations
    // This is a placeholder for initialization checks
  }
}

module.exports = OrderService;