class ShippingIntegration {
  constructor(options) {
    this.database = options.database;
    this.eventBus = options.eventBus;
    this.queue = options.queue;
    this.carriers = new Map();
    this.rateCache = new Map();
  }

  async initialize() {
    this._registerDefaultCarriers();
    await this._loadCarrierConfigs();
  }

  registerCarrier(name, carrier) {
    this.carriers.set(name, carrier);
  }

  async calculateRates(shipment) {
    const cacheKey = this._generateRateCacheKey(shipment);
    
    if (this.rateCache.has(cacheKey)) {
      return this.rateCache.get(cacheKey);
    }

    const rates = [];
    
    for (const [name, carrier] of this.carriers) {
      if (!carrier.isAvailable(shipment)) continue;
      
      try {
        const carrierRates = await carrier.getRates({
          origin: shipment.origin,
          destination: shipment.destination,
          packages: shipment.packages,
          options: shipment.options
        });

        rates.push(...carrierRates.map(rate => ({
          ...rate,
          carrier: name
        })));
      } catch (error) {
        console.error(`Failed to get rates from ${name}:`, error);
      }
    }

    // Sort by price
    rates.sort((a, b) => a.price - b.price);
    
    // Cache for 1 hour
    this.rateCache.set(cacheKey, rates);
    setTimeout(() => this.rateCache.delete(cacheKey), 3600000);

    return rates;
  }

  async createLabel(fulfillment) {
    const carrier = this._selectCarrier(fulfillment.shipping?.carrier);
    
    if (!carrier) {
      throw new Error(`Carrier not available: ${fulfillment.shipping?.carrier}`);
    }

    const shipment = await this._prepareShipment(fulfillment);
    
    try {
      const label = await carrier.createLabel(shipment);
      
      await this.database.insert('shipping_labels', {
        fulfillment_id: fulfillment.id,
        carrier: carrier.name,
        tracking_number: label.trackingNumber,
        label_url: label.labelUrl,
        label_format: label.format || 'PDF',
        cost: label.cost,
        service_type: shipment.service,
        created_at: new Date()
      });

      this.eventBus.emit('shipping:label:created', {
        fulfillmentId: fulfillment.id,
        trackingNumber: label.trackingNumber,
        carrier: carrier.name
      });

      // Schedule tracking updates
      if (this.queue) {
        await this.queue.schedule(
          'tracking-updates',
          '0 */4 * * *', // Every 4 hours
          {
            trackingNumber: label.trackingNumber,
            carrier: carrier.name,
            fulfillmentId: fulfillment.id
          }
        );
      }

      return {
        carrier: carrier.name,
        trackingNumber: label.trackingNumber,
        labelUrl: label.labelUrl,
        cost: label.cost,
        estimatedDelivery: label.estimatedDelivery
      };

    } catch (error) {
      await this.database.insert('shipping_errors', {
        fulfillment_id: fulfillment.id,
        carrier: carrier.name,
        error_type: 'label_creation',
        error_message: error.message,
        created_at: new Date()
      });

      throw new ShippingError(
        'Failed to create shipping label',
        'LABEL_CREATION_FAILED',
        { carrier: carrier.name, originalError: error.message }
      );
    }
  }

  async voidLabel(trackingNumber, carrier) {
    const carrierInstance = this.carriers.get(carrier);
    
    if (!carrierInstance || !carrierInstance.voidLabel) {
      throw new Error('Carrier does not support label voiding');
    }

    try {
      await carrierInstance.voidLabel(trackingNumber);
      
      await this.database.update('shipping_labels', {
        voided: true,
        voided_at: new Date()
      }, { tracking_number: trackingNumber });

      this.eventBus.emit('shipping:label:voided', {
        trackingNumber,
        carrier
      });

      return { voided: true };
    } catch (error) {
      throw new ShippingError(
        'Failed to void shipping label',
        'VOID_LABEL_FAILED',
        { trackingNumber, originalError: error.message }
      );
    }
  }

  async getTracking(trackingNumber, carrier = null) {
    if (!carrier) {
      carrier = await this._identifyCarrier(trackingNumber);
    }

    const carrierInstance = this.carriers.get(carrier);
    
    if (!carrierInstance) {
      throw new Error(`Carrier not available: ${carrier}`);
    }

    try {
      const tracking = await carrierInstance.track(trackingNumber);
      
      // Store tracking update
      await this.database.insert('tracking_updates', {
        tracking_number: trackingNumber,
        carrier,
        status: tracking.status,
        location: tracking.currentLocation,
        events: JSON.stringify(tracking.events),
        estimated_delivery: tracking.estimatedDelivery,
        delivered_at: tracking.deliveredAt,
        created_at: new Date()
      });

      // Emit events for significant status changes
      if (tracking.status === 'delivered') {
        this.eventBus.emit('shipping:delivered', {
          trackingNumber,
          deliveredAt: tracking.deliveredAt,
          signature: tracking.signature
        });
      } else if (tracking.status === 'exception') {
        this.eventBus.emit('shipping:exception', {
          trackingNumber,
          exception: tracking.exception
        });
      }

      return {
        trackingNumber,
        carrier,
        status: tracking.status,
        currentLocation: tracking.currentLocation,
        estimatedDelivery: tracking.estimatedDelivery,
        deliveredAt: tracking.deliveredAt,
        events: tracking.events,
        lastUpdate: new Date()
      };

    } catch (error) {
      throw new ShippingError(
        'Failed to get tracking information',
        'TRACKING_FAILED',
        { trackingNumber, originalError: error.message }
      );
    }
  }

  async schedulePickup(pickupData) {
    const carrier = this.carriers.get(pickupData.carrier);
    
    if (!carrier || !carrier.schedulePickup) {
      throw new Error('Carrier does not support pickup scheduling');
    }

    try {
      const pickup = await carrier.schedulePickup({
        address: pickupData.address,
        date: pickupData.date,
        timeWindow: pickupData.timeWindow,
        packages: pickupData.packages,
        specialInstructions: pickupData.instructions
      });

      await this.database.insert('scheduled_pickups', {
        carrier: pickupData.carrier,
        pickup_id: pickup.id,
        pickup_date: pickupData.date,
        time_window: pickupData.timeWindow,
        address: JSON.stringify(pickupData.address),
        packages_count: pickupData.packages.length,
        status: 'scheduled',
        created_at: new Date()
      });

      this.eventBus.emit('shipping:pickup:scheduled', {
        carrier: pickupData.carrier,
        pickupId: pickup.id,
        date: pickupData.date
      });

      return pickup;
    } catch (error) {
      throw new ShippingError(
        'Failed to schedule pickup',
        'PICKUP_SCHEDULING_FAILED',
        { carrier: pickupData.carrier, originalError: error.message }
      );
    }
  }

  async validateAddress(address) {
    // Try validation with multiple carriers
    const validations = [];
    
    for (const [name, carrier] of this.carriers) {
      if (carrier.validateAddress) {
        try {
          const result = await carrier.validateAddress(address);
          validations.push({
            carrier: name,
            valid: result.valid,
            normalized: result.normalized,
            suggestions: result.suggestions
          });
        } catch (error) {
          console.error(`Address validation failed with ${name}:`, error);
        }
      }
    }

    // Return the first valid result
    const valid = validations.find(v => v.valid);
    
    if (valid) {
      return {
        valid: true,
        normalized: valid.normalized,
        validatedBy: valid.carrier
      };
    }

    // Return suggestions if available
    const withSuggestions = validations.find(v => v.suggestions?.length > 0);
    
    if (withSuggestions) {
      return {
        valid: false,
        suggestions: withSuggestions.suggestions,
        validatedBy: withSuggestions.carrier
      };
    }

    return {
      valid: false,
      error: 'Address validation failed'
    };
  }

  async getManifest(date, carrier = null) {
    const query = `
      SELECT * FROM shipping_labels
      WHERE DATE(created_at) = $1
      AND voided = false
    `;
    const params = [date];

    if (carrier) {
      query += ' AND carrier = $2';
      params.push(carrier);
    }

    const labels = await this.database.query(query, params);
    
    const manifest = {
      date,
      carrier,
      shipments: labels.map(label => ({
        trackingNumber: label.tracking_number,
        carrier: label.carrier,
        service: label.service_type,
        cost: label.cost,
        createdAt: label.created_at
      })),
      totalShipments: labels.length,
      totalCost: labels.reduce((sum, label) => sum + parseFloat(label.cost), 0)
    };

    // Generate carrier-specific manifest if needed
    if (carrier) {
      const carrierInstance = this.carriers.get(carrier);
      if (carrierInstance && carrierInstance.generateManifest) {
        manifest.carrierManifest = await carrierInstance.generateManifest(
          labels.map(l => l.tracking_number)
        );
      }
    }

    return manifest;
  }

  async calculateCost(options) {
    const rates = await this.calculateRates({
      origin: options.origin || await this._getDefaultOrigin(),
      destination: options.address,
      packages: await this._estimatePackages(options.items),
      options: {
        service: options.method,
        signature: options.requireSignature,
        insurance: options.insurance
      }
    });

    const selectedRate = rates.find(r => r.service === options.method) || rates[0];
    
    return selectedRate ? selectedRate.price : 0;
  }

  async _prepareShipment(fulfillment) {
    const order = await this.database.queryOne(
      'SELECT * FROM orders WHERE id = $1',
      [fulfillment.orderId]
    );

    const packages = await this._getPackages(fulfillment.id);
    
    return {
      origin: await this._getWarehouseAddress(fulfillment.warehouseId),
      destination: order.shipping_address,
      packages: packages.map(pkg => ({
        weight: pkg.weight,
        dimensions: JSON.parse(pkg.dimensions),
        value: this._calculatePackageValue(pkg, order.items),
        reference: `${order.order_number}-${pkg.id}`
      })),
      service: order.shipping_method,
      options: {
        signature: order.metadata?.requireSignature || false,
        insurance: order.total_amount > 100,
        saturdayDelivery: order.metadata?.saturdayDelivery || false
      },
      reference: order.order_number,
      customsInfo: await this._getCustomsInfo(order, fulfillment)
    };
  }

  async _getPackages(fulfillmentId) {
    return await this.database.query(
      'SELECT * FROM fulfillment_packages WHERE fulfillment_id = $1',
      [fulfillmentId]
    );
  }

  _calculatePackageValue(pkg, orderItems) {
    const packageItems = JSON.parse(pkg.items);
    let value = 0;
    
    for (const item of packageItems) {
      const orderItem = orderItems.find(i => i.productId === item.productId);
      if (orderItem) {
        value += orderItem.unitPrice * item.quantity;
      }
    }
    
    return value;
  }

  async _getWarehouseAddress(warehouseId) {
    const warehouse = await this.database.queryOne(
      'SELECT * FROM warehouses WHERE id = $1',
      [warehouseId]
    );

    return {
      name: warehouse.name,
      company: warehouse.company,
      street1: warehouse.street1,
      street2: warehouse.street2,
      city: warehouse.city,
      state: warehouse.state,
      postalCode: warehouse.postal_code,
      country: warehouse.country,
      phone: warehouse.phone,
      email: warehouse.email
    };
  }

  async _getDefaultOrigin() {
    const defaultWarehouse = await this.database.queryOne(
      'SELECT * FROM warehouses WHERE is_default = true LIMIT 1'
    );

    return await this._getWarehouseAddress(defaultWarehouse.id);
  }

  async _estimatePackages(items) {
    // Simple package estimation - in production use bin packing algorithm
    const packages = [];
    let currentPackage = {
      weight: 0,
      dimensions: { length: 12, width: 12, height: 8 }
    };

    for (const item of items) {
      const product = await this.database.queryOne(
        'SELECT weight, dimensions FROM products WHERE id = $1',
        [item.productId]
      );

      const itemWeight = (product?.weight || 1) * item.quantity;
      
      if (currentPackage.weight + itemWeight > 50) {
        packages.push(currentPackage);
        currentPackage = {
          weight: 0,
          dimensions: { length: 12, width: 12, height: 8 }
        };
      }
      
      currentPackage.weight += itemWeight;
    }

    if (currentPackage.weight > 0) {
      packages.push(currentPackage);
    }

    return packages;
  }

  async _getCustomsInfo(order, fulfillment) {
    // Check if international shipment
    const origin = await this._getWarehouseAddress(fulfillment.warehouseId);
    
    if (origin.country === order.shipping_address.country) {
      return null;
    }

    const items = [];
    
    for (const item of order.items) {
      const product = await this.database.queryOne(
        'SELECT * FROM products WHERE id = $1',
        [item.productId]
      );

      items.push({
        description: product.name,
        quantity: item.quantity,
        value: item.unitPrice,
        weight: product.weight || 1,
        originCountry: product.origin_country || origin.country,
        hsCode: product.hs_code || '9999.99'
      });
    }

    return {
      contentsType: 'merchandise',
      contentsExplanation: 'E-commerce order',
      restrictionType: 'none',
      customsCertify: true,
      customsSigner: origin.name,
      items
    };
  }

  _selectCarrier(carrierName) {
    if (carrierName) {
      return this.carriers.get(carrierName);
    }

    // Return first available carrier
    return this.carriers.values().next().value;
  }

  async _identifyCarrier(trackingNumber) {
    // Try to identify carrier by tracking number format
    const patterns = {
      ups: /^1Z[0-9A-Z]{16}$/,
      fedex: /^[0-9]{12,14}$/,
      usps: /^(94|93|92|94|95)[0-9]{20}$/,
      dhl: /^[0-9]{10,11}$/
    };

    for (const [carrier, pattern] of Object.entries(patterns)) {
      if (pattern.test(trackingNumber)) {
        return carrier;
      }
    }

    // Check database for known tracking numbers
    const label = await this.database.queryOne(
      'SELECT carrier FROM shipping_labels WHERE tracking_number = $1',
      [trackingNumber]
    );

    return label?.carrier || null;
  }

  _generateRateCacheKey(shipment) {
    const key = [
      shipment.origin.postalCode,
      shipment.destination.postalCode,
      shipment.packages.map(p => `${p.weight}-${p.dimensions.length}x${p.dimensions.width}x${p.dimensions.height}`).join(','),
      shipment.options?.service || 'any'
    ].join(':');
    
    return key;
  }

  _registerDefaultCarriers() {
    // Register mock carriers for testing
    this.registerCarrier('ups', {
      name: 'ups',
      isAvailable: () => true,
      getRates: async (shipment) => [
        { service: 'ground', price: 12.50, days: 5 },
        { service: 'express', price: 45.00, days: 1 },
        { service: 'standard', price: 25.00, days: 3 }
      ],
      createLabel: async (shipment) => ({
        trackingNumber: '1Z' + Math.random().toString(36).substr(2, 16).toUpperCase(),
        labelUrl: 'https://labels.example.com/' + Date.now() + '.pdf',
        cost: 25.00,
        estimatedDelivery: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
      }),
      track: async (trackingNumber) => ({
        status: 'in_transit',
        currentLocation: 'Memphis, TN',
        estimatedDelivery: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        events: [
          { date: new Date(), location: 'Memphis, TN', description: 'In transit' }
        ]
      })
    });

    this.registerCarrier('fedex', {
      name: 'fedex',
      isAvailable: () => true,
      getRates: async (shipment) => [
        { service: 'ground', price: 15.00, days: 4 },
        { service: 'express', price: 50.00, days: 1 },
        { service: 'standard', price: 28.00, days: 2 }
      ],
      createLabel: async (shipment) => ({
        trackingNumber: Math.random().toString().substr(2, 12),
        labelUrl: 'https://labels.example.com/' + Date.now() + '.pdf',
        cost: 28.00,
        estimatedDelivery: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
      }),
      track: async (trackingNumber) => ({
        status: 'in_transit',
        currentLocation: 'Chicago, IL',
        estimatedDelivery: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000),
        events: [
          { date: new Date(), location: 'Chicago, IL', description: 'In transit' }
        ]
      })
    });
  }

  async _loadCarrierConfigs() {
    const configs = await this.database.query(
      'SELECT * FROM shipping_carrier_configs WHERE active = true'
    );

    for (const config of configs) {
      const carrier = this.carriers.get(config.carrier);
      if (carrier) {
        carrier.config = JSON.parse(config.configuration);
      }
    }
  }
}

class ShippingError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'ShippingError';
    this.code = code;
    this.details = details;
  }
}

module.exports = ShippingIntegration;