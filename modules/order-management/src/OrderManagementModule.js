const EventEmitter = require('events');
const OrderService = require('./services/OrderService');
const FulfillmentService = require('./services/FulfillmentService');
const ReturnsService = require('./services/ReturnsService');
const OrderSaga = require('./sagas/OrderSaga');
const PaymentIntegration = require('./integrations/PaymentIntegration');
const ShippingIntegration = require('./integrations/ShippingIntegration');

class OrderManagementModule extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      orderPrefix: options.orderPrefix || 'ORD',
      returnPrefix: options.returnPrefix || 'RMA',
      autoAllocateInventory: options.autoAllocateInventory !== false,
      autoCalculateTaxes: options.autoCalculateTaxes !== false,
      requirePaymentBeforeFulfillment: options.requirePaymentBeforeFulfillment !== false,
      enablePartialFulfillment: options.enablePartialFulfillment !== false,
      returnWindow: options.returnWindow || 30,
      ...options
    };

    this.dependencies = {
      eventBus: null,
      database: null,
      inventory: null,
      cache: null,
      queue: null
    };

    this.services = {};
    this.integrations = {};
    this.sagas = new Map();
  }

  async initialize(dependencies) {
    this.dependencies = {
      ...this.dependencies,
      ...dependencies
    };

    this._validateDependencies();

    this.services.order = new OrderService({
      database: this.dependencies.database,
      eventBus: this.dependencies.eventBus,
      cache: this.dependencies.cache,
      orderPrefix: this.options.orderPrefix,
      autoCalculateTaxes: this.options.autoCalculateTaxes
    });

    this.services.fulfillment = new FulfillmentService({
      database: this.dependencies.database,
      eventBus: this.dependencies.eventBus,
      inventory: this.dependencies.inventory,
      queue: this.dependencies.queue,
      enablePartialFulfillment: this.options.enablePartialFulfillment
    });

    this.services.returns = new ReturnsService({
      database: this.dependencies.database,
      eventBus: this.dependencies.eventBus,
      inventory: this.dependencies.inventory,
      returnPrefix: this.options.returnPrefix,
      returnWindow: this.options.returnWindow
    });

    this.integrations.payment = new PaymentIntegration({
      database: this.dependencies.database,
      eventBus: this.dependencies.eventBus,
      cache: this.dependencies.cache
    });

    this.integrations.shipping = new ShippingIntegration({
      database: this.dependencies.database,
      eventBus: this.dependencies.eventBus,
      queue: this.dependencies.queue
    });

    await this._initializeServices();
    await this._registerSagas();
    await this._registerEventHandlers();

    this.emit('initialized');
    return this;
  }

  async createOrder(orderData) {
    try {
      const order = await this.services.order.create(orderData);
      
      if (this.options.autoAllocateInventory) {
        await this._allocateInventory(order);
      }

      const saga = new OrderSaga({
        order,
        services: this.services,
        integrations: this.integrations,
        options: this.options
      });

      this.sagas.set(order.id, saga);
      await saga.start();

      this.emit('order:created', { orderId: order.id, order });
      
      return order;
    } catch (error) {
      this.emit('order:error', { error: error.message, operation: 'create' });
      throw error;
    }
  }

  async updateOrder(orderId, updates) {
    try {
      const order = await this.services.order.update(orderId, updates);
      
      const saga = this.sagas.get(orderId);
      if (saga) {
        await saga.handleUpdate(updates);
      }

      this.emit('order:updated', { orderId, updates, order });
      
      return order;
    } catch (error) {
      this.emit('order:error', { orderId, error: error.message, operation: 'update' });
      throw error;
    }
  }

  async cancelOrder(orderId, reason) {
    try {
      const order = await this.services.order.getById(orderId);
      
      if (!this._canCancelOrder(order)) {
        throw new Error('Order cannot be cancelled in current state');
      }

      const saga = this.sagas.get(orderId);
      if (saga) {
        await saga.cancel(reason);
      }

      const cancelledOrder = await this.services.order.updateStatus(
        orderId,
        'cancelled',
        { reason }
      );

      if (order.payment?.status === 'completed') {
        await this._initiateRefund(order);
      }

      await this._releaseInventory(order);

      this.emit('order:cancelled', { orderId, reason });
      
      return cancelledOrder;
    } catch (error) {
      this.emit('order:error', { orderId, error: error.message, operation: 'cancel' });
      throw error;
    }
  }

  async processPayment(orderId, paymentData) {
    try {
      const order = await this.services.order.getById(orderId);
      
      const payment = await this.integrations.payment.process(order, paymentData);
      
      await this.services.order.update(orderId, {
        payment: {
          ...payment,
          processedAt: new Date()
        }
      });

      const saga = this.sagas.get(orderId);
      if (saga) {
        await saga.handlePaymentComplete(payment);
      }

      this.emit('order:payment:completed', { orderId, payment });
      
      return payment;
    } catch (error) {
      this.emit('order:payment:failed', { orderId, error: error.message });
      throw error;
    }
  }

  async startFulfillment(orderId, fulfillmentData = {}) {
    try {
      const order = await this.services.order.getById(orderId);
      
      if (this.options.requirePaymentBeforeFulfillment && 
          order.payment?.status !== 'completed') {
        throw new Error('Payment required before fulfillment');
      }

      const fulfillment = await this.services.fulfillment.create(order, fulfillmentData);
      
      await this.services.order.updateStatus(orderId, 'fulfilling');

      this.emit('order:fulfillment:started', { orderId, fulfillmentId: fulfillment.id });
      
      return fulfillment;
    } catch (error) {
      this.emit('order:fulfillment:error', { orderId, error: error.message });
      throw error;
    }
  }

  async pickItems(fulfillmentId, pickedItems) {
    try {
      const fulfillment = await this.services.fulfillment.updatePickedItems(
        fulfillmentId,
        pickedItems
      );

      if (fulfillment.allItemsPicked) {
        await this.services.fulfillment.updateStatus(fulfillmentId, 'ready_to_pack');
      }

      this.emit('fulfillment:items:picked', { fulfillmentId, pickedItems });
      
      return fulfillment;
    } catch (error) {
      this.emit('fulfillment:error', { fulfillmentId, error: error.message });
      throw error;
    }
  }

  async packOrder(fulfillmentId, packingData) {
    try {
      const fulfillment = await this.services.fulfillment.pack(
        fulfillmentId,
        packingData
      );

      const shippingLabel = await this.integrations.shipping.createLabel(fulfillment);
      
      await this.services.fulfillment.update(fulfillmentId, {
        shipping: shippingLabel
      });

      this.emit('fulfillment:packed', { fulfillmentId, shippingLabel });
      
      return { fulfillment, shippingLabel };
    } catch (error) {
      this.emit('fulfillment:error', { fulfillmentId, error: error.message });
      throw error;
    }
  }

  async shipOrder(fulfillmentId) {
    try {
      const fulfillment = await this.services.fulfillment.ship(fulfillmentId);
      
      const tracking = await this.integrations.shipping.getTracking(
        fulfillment.shipping.trackingNumber
      );

      await this.services.order.updateStatus(fulfillment.orderId, 'shipped', {
        shippedAt: new Date(),
        tracking
      });

      const saga = this.sagas.get(fulfillment.orderId);
      if (saga) {
        await saga.handleShipmentComplete(fulfillment);
      }

      this.emit('order:shipped', { 
        orderId: fulfillment.orderId, 
        fulfillmentId,
        tracking 
      });
      
      return { fulfillment, tracking };
    } catch (error) {
      this.emit('fulfillment:error', { fulfillmentId, error: error.message });
      throw error;
    }
  }

  async initiateReturn(orderId, returnData) {
    try {
      const order = await this.services.order.getById(orderId);
      
      if (!this._canReturnOrder(order)) {
        throw new Error('Order is not eligible for return');
      }

      const rma = await this.services.returns.create(order, returnData);
      
      this.emit('return:initiated', { orderId, rmaId: rma.id });
      
      return rma;
    } catch (error) {
      this.emit('return:error', { orderId, error: error.message });
      throw error;
    }
  }

  async processReturn(rmaId, action) {
    try {
      const rma = await this.services.returns.process(rmaId, action);
      
      if (action.type === 'refund') {
        await this._processRefund(rma, action.amount);
      } else if (action.type === 'exchange') {
        await this._processExchange(rma, action.newItems);
      } else if (action.type === 'store_credit') {
        await this._issueStoreCredit(rma, action.amount);
      }

      await this._restockItems(rma);

      this.emit('return:completed', { rmaId, action });
      
      return rma;
    } catch (error) {
      this.emit('return:error', { rmaId, error: error.message });
      throw error;
    }
  }

  async getOrder(orderId) {
    return await this.services.order.getById(orderId);
  }

  async searchOrders(criteria) {
    return await this.services.order.search(criteria);
  }

  async getOrderMetrics(period = '30d') {
    const metrics = await this.services.order.getMetrics(period);
    const fulfillmentMetrics = await this.services.fulfillment.getMetrics(period);
    const returnMetrics = await this.services.returns.getMetrics(period);

    return {
      orders: metrics,
      fulfillment: fulfillmentMetrics,
      returns: returnMetrics,
      revenue: {
        total: metrics.totalRevenue,
        average: metrics.averageOrderValue,
        refunded: returnMetrics.totalRefunded
      },
      performance: {
        fulfillmentRate: fulfillmentMetrics.completionRate,
        averageFulfillmentTime: fulfillmentMetrics.averageTime,
        returnRate: returnMetrics.returnRate,
        customerSatisfaction: metrics.satisfactionScore
      }
    };
  }

  _validateDependencies() {
    const required = ['eventBus', 'database', 'inventory'];
    for (const dep of required) {
      if (!this.dependencies[dep]) {
        throw new Error(`${dep} dependency is required`);
      }
    }
  }

  async _initializeServices() {
    await Promise.all([
      this.services.order.initialize(),
      this.services.fulfillment.initialize(),
      this.services.returns.initialize(),
      this.integrations.payment.initialize(),
      this.integrations.shipping.initialize()
    ]);
  }

  async _registerSagas() {
    this.dependencies.eventBus.on('saga:completed', async ({ orderId }) => {
      this.sagas.delete(orderId);
    });

    this.dependencies.eventBus.on('saga:failed', async ({ orderId, error }) => {
      console.error(`Order saga failed for ${orderId}:`, error);
      await this.services.order.updateStatus(orderId, 'failed', { error });
    });
  }

  async _registerEventHandlers() {
    this.dependencies.eventBus.on('inventory:allocated', async (event) => {
      const saga = this.sagas.get(event.orderId);
      if (saga) {
        await saga.handleInventoryAllocated(event);
      }
    });

    this.dependencies.eventBus.on('payment:webhook', async (event) => {
      if (event.type === 'payment.confirmed') {
        await this.processPayment(event.orderId, event.payment);
      }
    });

    this.dependencies.eventBus.on('shipping:status:updated', async (event) => {
      await this.services.order.update(event.orderId, {
        shipping: { status: event.status, updatedAt: new Date() }
      });
    });
  }

  async _allocateInventory(order) {
    const allocations = [];
    
    for (const item of order.items) {
      const allocation = await this.dependencies.inventory.allocate({
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
        orderId: order.id,
        warehouseId: order.warehouseId
      });
      
      allocations.push(allocation);
    }

    return allocations;
  }

  async _releaseInventory(order) {
    for (const item of order.items) {
      await this.dependencies.inventory.release({
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
        orderId: order.id
      });
    }
  }

  async _restockItems(rma) {
    for (const item of rma.items) {
      if (item.condition === 'sellable') {
        await this.dependencies.inventory.restock({
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.quantity,
          warehouseId: rma.warehouseId,
          reason: 'return'
        });
      }
    }
  }

  async _initiateRefund(order) {
    return await this.integrations.payment.refund(
      order.payment.transactionId,
      order.payment.amount
    );
  }

  async _processRefund(rma, amount) {
    const order = await this.services.order.getById(rma.orderId);
    return await this.integrations.payment.refund(
      order.payment.transactionId,
      amount
    );
  }

  async _processExchange(rma, newItems) {
    const exchangeOrder = await this.createOrder({
      customerId: rma.customerId,
      items: newItems,
      isExchange: true,
      originalOrderId: rma.orderId,
      paymentRequired: false
    });
    
    return exchangeOrder;
  }

  async _issueStoreCredit(rma, amount) {
    await this.dependencies.database.insert('store_credits', {
      customer_id: rma.customerId,
      amount,
      reason: 'return',
      reference_id: rma.id,
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      created_at: new Date()
    });
  }

  _canCancelOrder(order) {
    const nonCancellableStatuses = ['shipped', 'delivered', 'cancelled', 'refunded'];
    return !nonCancellableStatuses.includes(order.status);
  }

  _canReturnOrder(order) {
    if (order.status !== 'delivered') return false;
    
    const deliveredAt = new Date(order.deliveredAt);
    const daysSinceDelivery = (Date.now() - deliveredAt) / (1000 * 60 * 60 * 24);
    
    return daysSinceDelivery <= this.options.returnWindow;
  }

  async shutdown() {
    for (const [orderId, saga] of this.sagas) {
      await saga.pause();
    }

    this.removeAllListeners();
  }
}

module.exports = OrderManagementModule;