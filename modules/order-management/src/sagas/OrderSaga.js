const EventEmitter = require('events');

class OrderSaga extends EventEmitter {
  constructor(options) {
    super();
    
    this.order = options.order;
    this.services = options.services;
    this.integrations = options.integrations;
    this.options = options.options;
    
    this.state = 'created';
    this.steps = [];
    this.compensations = [];
    this.context = {
      orderId: this.order.id,
      startTime: Date.now()
    };
  }

  async start() {
    try {
      this.state = 'running';
      
      await this._executeStep('validate_order', async () => {
        await this._validateOrder();
      });

      await this._executeStep('reserve_inventory', async () => {
        await this._reserveInventory();
      }, async () => {
        await this._releaseInventory();
      });

      await this._executeStep('calculate_pricing', async () => {
        await this._calculateFinalPricing();
      });

      await this._executeStep('process_payment', async () => {
        if (this.order.paymentMethod !== 'invoice') {
          await this._processPayment();
        }
      }, async () => {
        await this._refundPayment();
      });

      await this._executeStep('confirm_order', async () => {
        await this._confirmOrder();
      });

      await this._executeStep('notify_customer', async () => {
        await this._sendOrderConfirmation();
      });

      await this._executeStep('initiate_fulfillment', async () => {
        if (this.options.autoStartFulfillment) {
          await this._initiateFulfillment();
        }
      });

      this.state = 'completed';
      this.emit('completed', { orderId: this.order.id, steps: this.steps });
      
    } catch (error) {
      this.state = 'failed';
      await this._compensate(error);
      this.emit('failed', { orderId: this.order.id, error: error.message });
      throw error;
    }
  }

  async handleUpdate(updates) {
    if (this.state !== 'running') {
      throw new Error('Saga is not in running state');
    }

    if (updates.items) {
      await this._handleItemsUpdate(updates.items);
    }

    if (updates.shippingAddress) {
      await this._handleAddressUpdate(updates.shippingAddress);
    }

    if (updates.shippingMethod) {
      await this._handleShippingMethodUpdate(updates.shippingMethod);
    }
  }

  async handlePaymentComplete(payment) {
    this.context.payment = payment;
    
    if (this.state === 'waiting_payment') {
      this.state = 'running';
      await this._continueAfterPayment();
    }
  }

  async handleInventoryAllocated(allocation) {
    this.context.inventoryAllocation = allocation;
    
    if (this.state === 'waiting_inventory') {
      this.state = 'running';
      await this._continueAfterInventory();
    }
  }

  async handleShipmentComplete(shipment) {
    this.context.shipment = shipment;
    
    await this._executeStep('complete_order', async () => {
      await this._completeOrder();
    });
  }

  async cancel(reason) {
    if (this.state === 'cancelled' || this.state === 'completed') {
      throw new Error('Cannot cancel saga in current state');
    }

    this.state = 'cancelling';
    this.context.cancellationReason = reason;
    
    await this._compensate(new Error(`Order cancelled: ${reason}`));
    
    this.state = 'cancelled';
    this.emit('cancelled', { orderId: this.order.id, reason });
  }

  async pause() {
    if (this.state === 'running') {
      this.state = 'paused';
      this.emit('paused', { orderId: this.order.id });
    }
  }

  async resume() {
    if (this.state === 'paused') {
      this.state = 'running';
      this.emit('resumed', { orderId: this.order.id });
      // Continue from last successful step
    }
  }

  async _executeStep(name, action, compensation = null) {
    const step = {
      name,
      startTime: Date.now(),
      status: 'running'
    };
    
    this.steps.push(step);
    
    try {
      const result = await action();
      
      step.status = 'completed';
      step.endTime = Date.now();
      step.duration = step.endTime - step.startTime;
      step.result = result;
      
      if (compensation) {
        this.compensations.push({
          step: name,
          action: compensation
        });
      }
      
      this.emit('step:completed', { orderId: this.order.id, step: name });
      
      return result;
    } catch (error) {
      step.status = 'failed';
      step.endTime = Date.now();
      step.duration = step.endTime - step.startTime;
      step.error = error.message;
      
      this.emit('step:failed', { orderId: this.order.id, step: name, error: error.message });
      
      throw error;
    }
  }

  async _compensate(error) {
    console.log(`Compensating saga for order ${this.order.id} due to: ${error.message}`);
    
    // Execute compensations in reverse order
    const compensations = [...this.compensations].reverse();
    
    for (const compensation of compensations) {
      try {
        await compensation.action();
        this.emit('compensation:completed', { 
          orderId: this.order.id, 
          step: compensation.step 
        });
      } catch (compensationError) {
        console.error(`Compensation failed for ${compensation.step}:`, compensationError);
        this.emit('compensation:failed', { 
          orderId: this.order.id, 
          step: compensation.step,
          error: compensationError.message
        });
      }
    }
  }

  async _validateOrder() {
    // Validate customer
    if (!this.order.customerId) {
      throw new Error('Customer ID is required');
    }

    // Validate items
    if (!this.order.items || this.order.items.length === 0) {
      throw new Error('Order must have at least one item');
    }

    // Validate addresses
    if (!this.order.shippingAddress) {
      throw new Error('Shipping address is required');
    }

    // Validate inventory availability
    for (const item of this.order.items) {
      const available = await this.integrations.inventory.checkAvailability({
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity
      });

      if (!available) {
        throw new Error(`Insufficient inventory for product ${item.productId}`);
      }
    }

    return { validated: true };
  }

  async _reserveInventory() {
    const reservations = [];
    
    for (const item of this.order.items) {
      const reservation = await this.integrations.inventory.reserve({
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
        orderId: this.order.id,
        expiresIn: 3600 // 1 hour
      });
      
      reservations.push(reservation);
    }

    this.context.inventoryReservations = reservations;
    return reservations;
  }

  async _releaseInventory() {
    if (!this.context.inventoryReservations) return;
    
    for (const reservation of this.context.inventoryReservations) {
      await this.integrations.inventory.release(reservation.id);
    }
  }

  async _calculateFinalPricing() {
    // Apply any dynamic pricing rules
    const pricingRules = await this._getApplicablePricingRules();
    
    let adjustments = 0;
    for (const rule of pricingRules) {
      if (rule.type === 'percentage_discount') {
        adjustments += this.order.subtotal * (rule.value / 100);
      } else if (rule.type === 'fixed_discount') {
        adjustments += rule.value;
      }
    }

    // Update order with final pricing
    if (adjustments > 0) {
      await this.services.order.update(this.order.id, {
        discount_amount: this.order.discountAmount + adjustments,
        total_amount: this.order.totalAmount - adjustments
      });
    }

    return { adjustments };
  }

  async _processPayment() {
    if (this.order.payment?.status === 'completed') {
      return this.order.payment;
    }

    const paymentData = {
      amount: this.order.totalAmount,
      currency: this.order.currency,
      method: this.order.paymentMethod,
      description: `Order ${this.order.orderNumber}`,
      metadata: {
        orderId: this.order.id,
        orderNumber: this.order.orderNumber
      }
    };

    try {
      const payment = await this.integrations.payment.process(
        this.order,
        paymentData
      );

      this.context.payment = payment;
      
      await this.services.order.update(this.order.id, {
        payment: {
          ...payment,
          processedAt: new Date()
        }
      });

      return payment;
    } catch (error) {
      if (error.code === 'PAYMENT_REQUIRES_ACTION') {
        this.state = 'waiting_payment';
        this.emit('payment:action_required', {
          orderId: this.order.id,
          action: error.action
        });
        throw new Error('Payment requires customer action');
      }
      throw error;
    }
  }

  async _refundPayment() {
    if (!this.context.payment) return;
    
    try {
      await this.integrations.payment.refund(
        this.context.payment.transactionId,
        this.context.payment.amount
      );
    } catch (error) {
      console.error('Failed to refund payment:', error);
      // Log for manual refund
    }
  }

  async _confirmOrder() {
    await this.services.order.updateStatus(this.order.id, 'confirmed', {
      confirmedBy: 'system',
      paymentStatus: this.context.payment?.status || 'pending'
    });

    // Convert reservations to allocations
    if (this.context.inventoryReservations) {
      for (const reservation of this.context.inventoryReservations) {
        await this.integrations.inventory.confirmReservation(reservation.id);
      }
    }
  }

  async _sendOrderConfirmation() {
    const customer = await this._getCustomer(this.order.customerId);
    
    await this.integrations.notification.send({
      type: 'email',
      template: 'order-confirmation',
      to: customer.email,
      data: {
        order: this.order,
        customer,
        estimatedDelivery: await this._calculateEstimatedDelivery()
      }
    });

    // Send SMS if enabled
    if (customer.phone && customer.preferences?.smsNotifications) {
      await this.integrations.notification.send({
        type: 'sms',
        to: customer.phone,
        message: `Your order ${this.order.orderNumber} has been confirmed. Track at: ${this._getTrackingUrl()}`
      });
    }
  }

  async _initiateFulfillment() {
    const fulfillment = await this.services.fulfillment.create(this.order, {
      priority: this._calculateFulfillmentPriority(),
      instructions: this.order.notes
    });

    this.context.fulfillmentId = fulfillment.id;
    
    await this.services.order.update(this.order.id, {
      fulfillment_id: fulfillment.id,
      status: 'processing'
    });
  }

  async _completeOrder() {
    await this.services.order.updateStatus(this.order.id, 'completed', {
      completedAt: new Date(),
      fulfillmentDuration: Date.now() - this.context.startTime
    });

    // Record metrics
    await this._recordOrderMetrics();
    
    // Request review after delivery
    if (this.options.requestReviews) {
      await this._scheduleReviewRequest();
    }
  }

  async _handleItemsUpdate(newItems) {
    // Validate new items
    for (const item of newItems) {
      const available = await this.integrations.inventory.checkAvailability({
        productId: item.productId,
        quantity: item.quantity
      });

      if (!available) {
        throw new Error(`Item ${item.productId} is not available`);
      }
    }

    // Update reservations
    await this._releaseInventory();
    this.order.items = newItems;
    await this._reserveInventory();

    // Recalculate pricing
    await this._calculateFinalPricing();
  }

  async _handleAddressUpdate(newAddress) {
    // Validate address
    const validation = await this.integrations.address.validate(newAddress);
    if (!validation.valid) {
      throw new Error('Invalid shipping address');
    }

    // Update shipping costs
    const shippingCost = await this.integrations.shipping.calculateCost({
      address: newAddress,
      items: this.order.items,
      method: this.order.shippingMethod
    });

    await this.services.order.update(this.order.id, {
      shipping_address: validation.normalized,
      shipping_amount: shippingCost
    });
  }

  async _handleShippingMethodUpdate(newMethod) {
    const shippingCost = await this.integrations.shipping.calculateCost({
      address: this.order.shippingAddress,
      items: this.order.items,
      method: newMethod
    });

    await this.services.order.update(this.order.id, {
      shipping_method: newMethod,
      shipping_amount: shippingCost
    });
  }

  async _continueAfterPayment() {
    // Continue saga execution after payment completion
    await this._confirmOrder();
    await this._sendOrderConfirmation();
    await this._initiateFulfillment();
  }

  async _continueAfterInventory() {
    // Continue saga execution after inventory allocation
    await this._calculateFinalPricing();
    await this._processPayment();
  }

  async _getApplicablePricingRules() {
    // Get customer-specific pricing rules
    // This is a placeholder - implement actual pricing rule engine
    return [];
  }

  async _getCustomer(customerId) {
    // Fetch customer details
    // This is a placeholder - implement actual customer service integration
    return {
      id: customerId,
      email: 'customer@example.com',
      phone: '+1234567890',
      preferences: {
        smsNotifications: true
      }
    };
  }

  async _calculateEstimatedDelivery() {
    const shippingMethod = this.order.shippingMethod;
    const businessDays = {
      'express': 1,
      'priority': 2,
      'standard': 5,
      'economy': 7
    };

    const days = businessDays[shippingMethod] || 5;
    const deliveryDate = new Date();
    deliveryDate.setDate(deliveryDate.getDate() + days);
    
    return deliveryDate;
  }

  _calculateFulfillmentPriority() {
    const priorities = {
      'express': 1,
      'priority': 2,
      'standard': 3,
      'economy': 4
    };

    return priorities[this.order.shippingMethod] || 3;
  }

  _getTrackingUrl() {
    return `https://example.com/track/${this.order.orderNumber}`;
  }

  async _recordOrderMetrics() {
    // Record order completion metrics for analytics
    const metrics = {
      orderId: this.order.id,
      totalDuration: Date.now() - this.context.startTime,
      steps: this.steps.map(s => ({
        name: s.name,
        duration: s.duration,
        status: s.status
      })),
      paymentMethod: this.order.paymentMethod,
      fulfillmentType: this.context.fulfillmentType,
      customerSegment: this.context.customerSegment
    };

    if (this.integrations.analytics) {
      await this.integrations.analytics.track('order_completed', metrics);
    }
  }

  async _scheduleReviewRequest() {
    const delayDays = 7; // Request review 7 days after delivery
    const scheduledDate = new Date();
    scheduledDate.setDate(scheduledDate.getDate() + delayDays);

    if (this.integrations.queue) {
      await this.integrations.queue.enqueue('review-requests', {
        orderId: this.order.id,
        customerId: this.order.customerId,
        scheduledFor: scheduledDate
      }, {
        delay: delayDays * 24 * 60 * 60 * 1000
      });
    }
  }
}

module.exports = OrderSaga;