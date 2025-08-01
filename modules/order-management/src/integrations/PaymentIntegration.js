class PaymentIntegration {
  constructor(options) {
    this.database = options.database;
    this.eventBus = options.eventBus;
    this.cache = options.cache;
    this.providers = new Map();
    this.webhookHandlers = new Map();
  }

  async initialize() {
    this._registerDefaultProviders();
    await this._loadProviderConfigs();
  }

  registerProvider(name, provider) {
    this.providers.set(name, provider);
    
    if (provider.webhookHandler) {
      this.webhookHandlers.set(name, provider.webhookHandler);
    }
  }

  async process(order, paymentData) {
    const provider = this._selectProvider(paymentData.method);
    
    if (!provider) {
      throw new Error(`No payment provider available for method: ${paymentData.method}`);
    }

    const transaction = {
      id: this._generateTransactionId(),
      order_id: order.id,
      provider: provider.name,
      method: paymentData.method,
      amount: paymentData.amount,
      currency: paymentData.currency,
      status: 'pending',
      metadata: paymentData.metadata || {},
      created_at: new Date()
    };

    await this.database.insert('payment_transactions', transaction);

    try {
      const result = await provider.charge({
        amount: paymentData.amount,
        currency: paymentData.currency,
        description: paymentData.description,
        customer: await this._getCustomerPaymentProfile(order.customerId),
        metadata: {
          orderId: order.id,
          transactionId: transaction.id,
          ...paymentData.metadata
        }
      });

      await this._updateTransaction(transaction.id, {
        status: 'completed',
        provider_reference: result.id,
        provider_response: JSON.stringify(result),
        completed_at: new Date()
      });

      this.eventBus.emit('payment:completed', {
        orderId: order.id,
        transactionId: transaction.id,
        amount: paymentData.amount
      });

      return {
        transactionId: transaction.id,
        providerReference: result.id,
        status: 'completed',
        amount: paymentData.amount,
        currency: paymentData.currency,
        processedAt: new Date()
      };

    } catch (error) {
      await this._updateTransaction(transaction.id, {
        status: 'failed',
        error_code: error.code,
        error_message: error.message,
        failed_at: new Date()
      });

      if (error.code === 'card_declined') {
        throw new PaymentError('Card was declined', 'CARD_DECLINED', { 
          declineCode: error.decline_code 
        });
      } else if (error.code === 'requires_action') {
        await this._updateTransaction(transaction.id, {
          status: 'requires_action',
          action_type: error.action_type,
          action_data: JSON.stringify(error.action_data)
        });

        throw new PaymentError('Payment requires action', 'PAYMENT_REQUIRES_ACTION', {
          action: error.action_data
        });
      }

      throw new PaymentError(
        'Payment processing failed',
        'PAYMENT_FAILED',
        { originalError: error.message }
      );
    }
  }

  async refund(transactionId, amount, reason = null) {
    const transaction = await this._getTransaction(transactionId);
    
    if (!transaction) {
      throw new Error(`Transaction not found: ${transactionId}`);
    }

    if (transaction.status !== 'completed') {
      throw new Error('Can only refund completed transactions');
    }

    const provider = this.providers.get(transaction.provider);
    if (!provider) {
      throw new Error(`Payment provider not available: ${transaction.provider}`);
    }

    const refund = {
      id: this._generateRefundId(),
      transaction_id: transactionId,
      amount: amount || transaction.amount,
      reason: reason,
      status: 'pending',
      created_at: new Date()
    };

    await this.database.insert('payment_refunds', refund);

    try {
      const result = await provider.refund({
        chargeId: transaction.provider_reference,
        amount: refund.amount,
        reason: reason,
        metadata: {
          refundId: refund.id,
          transactionId: transactionId
        }
      });

      await this._updateRefund(refund.id, {
        status: 'completed',
        provider_reference: result.id,
        provider_response: JSON.stringify(result),
        completed_at: new Date()
      });

      await this._updateTransaction(transactionId, {
        refunded_amount: (transaction.refunded_amount || 0) + refund.amount,
        last_refund_at: new Date()
      });

      this.eventBus.emit('payment:refunded', {
        transactionId,
        refundId: refund.id,
        amount: refund.amount,
        reason
      });

      return {
        refundId: refund.id,
        transactionId,
        amount: refund.amount,
        status: 'completed',
        processedAt: new Date()
      };

    } catch (error) {
      await this._updateRefund(refund.id, {
        status: 'failed',
        error_message: error.message,
        failed_at: new Date()
      });

      throw new PaymentError(
        'Refund processing failed',
        'REFUND_FAILED',
        { originalError: error.message }
      );
    }
  }

  async void(transactionId, reason = null) {
    const transaction = await this._getTransaction(transactionId);
    
    if (!transaction) {
      throw new Error(`Transaction not found: ${transactionId}`);
    }

    if (transaction.status === 'voided') {
      return { status: 'already_voided' };
    }

    const provider = this.providers.get(transaction.provider);
    if (!provider && provider.void) {
      throw new Error('Provider does not support void operation');
    }

    try {
      const result = await provider.void({
        chargeId: transaction.provider_reference,
        reason: reason
      });

      await this._updateTransaction(transactionId, {
        status: 'voided',
        voided_at: new Date(),
        void_reason: reason
      });

      this.eventBus.emit('payment:voided', {
        transactionId,
        reason
      });

      return {
        transactionId,
        status: 'voided',
        voidedAt: new Date()
      };

    } catch (error) {
      throw new PaymentError(
        'Void operation failed',
        'VOID_FAILED',
        { originalError: error.message }
      );
    }
  }

  async handleWebhook(provider, event, data, signature) {
    const handler = this.webhookHandlers.get(provider);
    
    if (!handler) {
      throw new Error(`No webhook handler for provider: ${provider}`);
    }

    // Verify webhook signature
    const isValid = await handler.verify(data, signature);
    if (!isValid) {
      throw new Error('Invalid webhook signature');
    }

    // Process webhook
    const parsed = await handler.parse(data);
    
    await this.database.insert('payment_webhooks', {
      provider,
      event_type: parsed.type,
      event_id: parsed.id,
      data: JSON.stringify(parsed.data),
      processed: false,
      received_at: new Date()
    });

    // Handle specific events
    switch (parsed.type) {
      case 'payment.confirmed':
        await this._handlePaymentConfirmed(parsed.data);
        break;
      case 'payment.failed':
        await this._handlePaymentFailed(parsed.data);
        break;
      case 'refund.completed':
        await this._handleRefundCompleted(parsed.data);
        break;
      case 'dispute.created':
        await this._handleDisputeCreated(parsed.data);
        break;
    }

    await this.database.update('payment_webhooks', {
      processed: true,
      processed_at: new Date()
    }, { event_id: parsed.id });

    return { processed: true };
  }

  async getPaymentMethods(customerId) {
    const customer = await this._getCustomerPaymentProfile(customerId);
    const methods = [];

    // Get saved payment methods from each provider
    for (const [name, provider] of this.providers) {
      if (provider.getCustomerMethods) {
        const providerMethods = await provider.getCustomerMethods(customer.provider_ids[name]);
        methods.push(...providerMethods.map(method => ({
          ...method,
          provider: name
        })));
      }
    }

    // Add default payment methods
    methods.push(
      { type: 'card', provider: 'stripe', name: 'Credit/Debit Card' },
      { type: 'bank_transfer', provider: 'manual', name: 'Bank Transfer' },
      { type: 'paypal', provider: 'paypal', name: 'PayPal' }
    );

    return methods;
  }

  async savePaymentMethod(customerId, method) {
    const provider = this.providers.get(method.provider);
    
    if (!provider || !provider.saveMethod) {
      throw new Error('Provider does not support saving payment methods');
    }

    const customer = await this._getCustomerPaymentProfile(customerId);
    
    const savedMethod = await provider.saveMethod({
      customerId: customer.provider_ids[method.provider],
      method: method.data
    });

    await this.database.insert('customer_payment_methods', {
      customer_id: customerId,
      provider: method.provider,
      method_type: savedMethod.type,
      method_id: savedMethod.id,
      last_four: savedMethod.last4,
      expires_at: savedMethod.expiresAt,
      is_default: method.isDefault || false,
      created_at: new Date()
    });

    return savedMethod;
  }

  async _selectProvider(paymentMethod) {
    // Map payment methods to providers
    const methodProviderMap = {
      'credit_card': 'stripe',
      'debit_card': 'stripe',
      'paypal': 'paypal',
      'bank_transfer': 'manual',
      'cash_on_delivery': 'manual',
      'invoice': 'manual'
    };

    const providerName = methodProviderMap[paymentMethod];
    return this.providers.get(providerName);
  }

  async _getCustomerPaymentProfile(customerId) {
    const cacheKey = `payment:customer:${customerId}`;
    
    if (this.cache) {
      const cached = await this.cache.get(cacheKey);
      if (cached) return cached;
    }

    let profile = await this.database.queryOne(
      'SELECT * FROM customer_payment_profiles WHERE customer_id = $1',
      [customerId]
    );

    if (!profile) {
      // Create payment profiles with each provider
      profile = {
        customer_id: customerId,
        provider_ids: {},
        created_at: new Date()
      };

      for (const [name, provider] of this.providers) {
        if (provider.createCustomer) {
          const providerCustomer = await provider.createCustomer({
            id: customerId
          });
          profile.provider_ids[name] = providerCustomer.id;
        }
      }

      await this.database.insert('customer_payment_profiles', {
        ...profile,
        provider_ids: JSON.stringify(profile.provider_ids)
      });
    } else {
      profile.provider_ids = JSON.parse(profile.provider_ids);
    }

    if (this.cache) {
      await this.cache.set(cacheKey, profile, { ttl: 3600 });
    }

    return profile;
  }

  async _getTransaction(transactionId) {
    return await this.database.queryOne(
      'SELECT * FROM payment_transactions WHERE id = $1',
      [transactionId]
    );
  }

  async _updateTransaction(transactionId, updates) {
    await this.database.update(
      'payment_transactions',
      { ...updates, updated_at: new Date() },
      { id: transactionId }
    );
  }

  async _updateRefund(refundId, updates) {
    await this.database.update(
      'payment_refunds',
      { ...updates, updated_at: new Date() },
      { id: refundId }
    );
  }

  async _handlePaymentConfirmed(data) {
    const transaction = await this.database.queryOne(
      'SELECT * FROM payment_transactions WHERE provider_reference = $1',
      [data.chargeId]
    );

    if (transaction && transaction.status === 'pending') {
      await this._updateTransaction(transaction.id, {
        status: 'completed',
        completed_at: new Date()
      });

      this.eventBus.emit('payment:confirmed:webhook', {
        transactionId: transaction.id,
        orderId: transaction.order_id
      });
    }
  }

  async _handlePaymentFailed(data) {
    const transaction = await this.database.queryOne(
      'SELECT * FROM payment_transactions WHERE provider_reference = $1',
      [data.chargeId]
    );

    if (transaction && transaction.status === 'pending') {
      await this._updateTransaction(transaction.id, {
        status: 'failed',
        error_code: data.failureCode,
        error_message: data.failureMessage,
        failed_at: new Date()
      });

      this.eventBus.emit('payment:failed:webhook', {
        transactionId: transaction.id,
        orderId: transaction.order_id,
        reason: data.failureMessage
      });
    }
  }

  async _handleRefundCompleted(data) {
    const refund = await this.database.queryOne(
      'SELECT * FROM payment_refunds WHERE provider_reference = $1',
      [data.refundId]
    );

    if (refund && refund.status === 'pending') {
      await this._updateRefund(refund.id, {
        status: 'completed',
        completed_at: new Date()
      });

      this.eventBus.emit('refund:completed:webhook', {
        refundId: refund.id,
        transactionId: refund.transaction_id
      });
    }
  }

  async _handleDisputeCreated(data) {
    await this.database.insert('payment_disputes', {
      transaction_id: data.transactionId,
      provider: data.provider,
      provider_reference: data.disputeId,
      amount: data.amount,
      reason: data.reason,
      status: 'needs_response',
      due_by: data.dueBy,
      created_at: new Date()
    });

    this.eventBus.emit('payment:dispute:created', {
      transactionId: data.transactionId,
      disputeId: data.disputeId,
      amount: data.amount,
      dueBy: data.dueBy
    });
  }

  _registerDefaultProviders() {
    // Register Stripe provider
    this.registerProvider('stripe', {
      name: 'stripe',
      charge: async (data) => {
        // Stripe implementation
        return { id: 'ch_' + Date.now() };
      },
      refund: async (data) => {
        // Stripe refund implementation
        return { id: 're_' + Date.now() };
      },
      createCustomer: async (data) => {
        // Stripe customer creation
        return { id: 'cus_' + Date.now() };
      },
      webhookHandler: {
        verify: async (data, signature) => true,
        parse: async (data) => ({ type: data.type, id: data.id, data })
      }
    });

    // Register PayPal provider
    this.registerProvider('paypal', {
      name: 'paypal',
      charge: async (data) => {
        // PayPal implementation
        return { id: 'PAY-' + Date.now() };
      },
      refund: async (data) => {
        // PayPal refund implementation
        return { id: 'REF-' + Date.now() };
      }
    });

    // Register manual provider for invoices/bank transfers
    this.registerProvider('manual', {
      name: 'manual',
      charge: async (data) => {
        // Create pending manual payment
        return { 
          id: 'MAN-' + Date.now(),
          requiresAction: true,
          actionType: 'manual_confirmation'
        };
      }
    });
  }

  async _loadProviderConfigs() {
    const configs = await this.database.query(
      'SELECT * FROM payment_provider_configs WHERE active = true'
    );

    for (const config of configs) {
      const provider = this.providers.get(config.provider);
      if (provider) {
        provider.config = JSON.parse(config.configuration);
      }
    }
  }

  _generateTransactionId() {
    return `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  _generateRefundId() {
    return `ref_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

class PaymentError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'PaymentError';
    this.code = code;
    this.details = details;
  }
}

module.exports = PaymentIntegration;