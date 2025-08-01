class FulfillmentService {
  constructor(options) {
    this.database = options.database;
    this.eventBus = options.eventBus;
    this.inventory = options.inventory;
    this.queue = options.queue;
    this.enablePartialFulfillment = options.enablePartialFulfillment || false;
  }

  async initialize() {
    await this._ensureTablesExist();
  }

  async create(order, fulfillmentData = {}) {
    const fulfillmentId = this._generateFulfillmentId();
    
    const fulfillment = {
      id: fulfillmentId,
      order_id: order.id,
      warehouse_id: fulfillmentData.warehouseId || await this._selectWarehouse(order),
      status: 'pending',
      type: fulfillmentData.type || 'standard',
      priority: fulfillmentData.priority || this._calculatePriority(order),
      items: await this._prepareFulfillmentItems(order.items),
      assigned_to: null,
      notes: fulfillmentData.notes,
      metadata: fulfillmentData.metadata || {},
      created_at: new Date(),
      updated_at: new Date()
    };

    await this.database.transaction(async (trx) => {
      await trx.insert('fulfillments', fulfillment);
      
      for (const item of fulfillment.items) {
        await trx.insert('fulfillment_items', {
          fulfillment_id: fulfillment.id,
          ...item
        });
      }

      await this._createPickingList(trx, fulfillment);
    });

    if (this.queue) {
      await this.queue.enqueue('fulfillment-tasks', {
        type: 'assign-picker',
        fulfillmentId: fulfillment.id,
        priority: fulfillment.priority
      });
    }

    this.eventBus.emit('fulfillment:created', {
      fulfillmentId: fulfillment.id,
      orderId: order.id,
      warehouseId: fulfillment.warehouse_id
    });

    return this._formatFulfillment(fulfillment);
  }

  async updateStatus(fulfillmentId, status, metadata = {}) {
    const fulfillment = await this.getById(fulfillmentId);
    const previousStatus = fulfillment.status;
    
    if (!this._isValidStatusTransition(fulfillment.status, status)) {
      throw new Error(`Invalid status transition from ${fulfillment.status} to ${status}`);
    }

    await this.database.transaction(async (trx) => {
      await trx.update('fulfillments', {
        status,
        updated_at: new Date(),
        [`${status}_at`]: new Date()
      }, { id: fulfillmentId });

      await this._recordFulfillmentHistory(trx, fulfillmentId, 'status_changed', {
        from: previousStatus,
        to: status,
        ...metadata
      });
    });

    this.eventBus.emit('fulfillment:status:changed', {
      fulfillmentId,
      previousStatus,
      newStatus: status,
      metadata
    });

    return await this.getById(fulfillmentId);
  }

  async updatePickedItems(fulfillmentId, pickedItems) {
    const fulfillment = await this.getById(fulfillmentId);
    
    await this.database.transaction(async (trx) => {
      for (const pickedItem of pickedItems) {
        await trx.update('fulfillment_items', {
          picked_quantity: pickedItem.quantity,
          picked_at: new Date(),
          picked_by: pickedItem.pickedBy,
          bin_location: pickedItem.binLocation
        }, {
          fulfillment_id: fulfillmentId,
          product_id: pickedItem.productId,
          variant_id: pickedItem.variantId
        });

        if (pickedItem.serialNumbers) {
          for (const serialNumber of pickedItem.serialNumbers) {
            await trx.insert('fulfillment_serial_numbers', {
              fulfillment_id: fulfillmentId,
              product_id: pickedItem.productId,
              serial_number: serialNumber,
              scanned_at: new Date()
            });
          }
        }
      }

      await this._recordFulfillmentHistory(trx, fulfillmentId, 'items_picked', {
        items: pickedItems.map(item => ({
          productId: item.productId,
          quantity: item.quantity
        }))
      });
    });

    const updatedFulfillment = await this.getById(fulfillmentId);
    const allPicked = await this._checkAllItemsPicked(updatedFulfillment);
    
    if (allPicked) {
      updatedFulfillment.allItemsPicked = true;
    }

    return updatedFulfillment;
  }

  async pack(fulfillmentId, packingData) {
    const fulfillment = await this.getById(fulfillmentId);
    
    if (fulfillment.status !== 'ready_to_pack') {
      throw new Error('Fulfillment is not ready to pack');
    }

    const packages = await this._createPackages(fulfillment, packingData);
    
    await this.database.transaction(async (trx) => {
      for (const pkg of packages) {
        const packageId = await trx.insert('fulfillment_packages', {
          fulfillment_id: fulfillmentId,
          package_type: pkg.type,
          weight: pkg.weight,
          dimensions: JSON.stringify(pkg.dimensions),
          items: JSON.stringify(pkg.items),
          packing_materials: JSON.stringify(pkg.packingMaterials),
          packed_by: packingData.packedBy,
          packed_at: new Date()
        });

        if (pkg.photos) {
          for (const photo of pkg.photos) {
            await trx.insert('package_photos', {
              package_id: packageId,
              photo_url: photo.url,
              photo_type: photo.type
            });
          }
        }
      }

      await this.updateStatus(fulfillmentId, 'packed', {
        packageCount: packages.length,
        totalWeight: packages.reduce((sum, pkg) => sum + pkg.weight, 0)
      });
    });

    return await this.getById(fulfillmentId);
  }

  async ship(fulfillmentId) {
    const fulfillment = await this.getById(fulfillmentId);
    
    if (fulfillment.status !== 'ready_to_ship') {
      throw new Error('Fulfillment is not ready to ship');
    }

    await this.database.transaction(async (trx) => {
      await trx.update('fulfillments', {
        status: 'shipped',
        shipped_at: new Date(),
        updated_at: new Date()
      }, { id: fulfillmentId });

      await this._updateInventoryAfterShipment(trx, fulfillment);
      
      await this._recordFulfillmentHistory(trx, fulfillmentId, 'shipped', {
        packages: fulfillment.packages.length,
        carrier: fulfillment.shipping?.carrier
      });
    });

    this.eventBus.emit('fulfillment:shipped', {
      fulfillmentId,
      orderId: fulfillment.orderId,
      tracking: fulfillment.shipping?.trackingNumber
    });

    return await this.getById(fulfillmentId);
  }

  async assignPicker(fulfillmentId, pickerId) {
    await this.database.update('fulfillments', {
      assigned_to: pickerId,
      assigned_at: new Date(),
      status: 'assigned'
    }, { id: fulfillmentId });

    if (this.queue) {
      await this.queue.enqueue('notifications', {
        type: 'fulfillment-assigned',
        userId: pickerId,
        fulfillmentId
      });
    }

    return await this.getById(fulfillmentId);
  }

  async getById(fulfillmentId) {
    const fulfillment = await this.database.queryOne(
      'SELECT * FROM fulfillments WHERE id = $1',
      [fulfillmentId]
    );

    if (!fulfillment) {
      throw new Error(`Fulfillment not found: ${fulfillmentId}`);
    }

    fulfillment.items = await this.database.query(
      'SELECT * FROM fulfillment_items WHERE fulfillment_id = $1',
      [fulfillmentId]
    );

    fulfillment.packages = await this.database.query(
      'SELECT * FROM fulfillment_packages WHERE fulfillment_id = $1',
      [fulfillmentId]
    );

    return this._formatFulfillment(fulfillment);
  }

  async getByOrderId(orderId) {
    const fulfillments = await this.database.query(
      'SELECT * FROM fulfillments WHERE order_id = $1',
      [orderId]
    );

    return Promise.all(fulfillments.map(f => this.getById(f.id)));
  }

  async getMetrics(period = '30d') {
    const since = this._calculateSinceDate(period);
    
    const metrics = await this.database.queryOne(`
      SELECT 
        COUNT(*) as total_fulfillments,
        COUNT(CASE WHEN status = 'shipped' THEN 1 END) as shipped,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled,
        AVG(EXTRACT(EPOCH FROM (shipped_at - created_at))/3600) as avg_fulfillment_hours
      FROM fulfillments
      WHERE created_at >= $1
    `, [since]);

    const warehouseMetrics = await this.database.query(`
      SELECT 
        warehouse_id,
        COUNT(*) as fulfillments,
        AVG(EXTRACT(EPOCH FROM (shipped_at - created_at))/3600) as avg_hours
      FROM fulfillments
      WHERE created_at >= $1 AND shipped_at IS NOT NULL
      GROUP BY warehouse_id
    `, [since]);

    const pickerMetrics = await this.database.query(`
      SELECT 
        assigned_to as picker_id,
        COUNT(*) as fulfillments,
        AVG(EXTRACT(EPOCH FROM (packed_at - assigned_at))/60) as avg_pick_pack_minutes
      FROM fulfillments
      WHERE created_at >= $1 AND assigned_to IS NOT NULL
      GROUP BY assigned_to
    `, [since]);

    return {
      totalFulfillments: parseInt(metrics.total_fulfillments),
      shipped: parseInt(metrics.shipped),
      cancelled: parseInt(metrics.cancelled),
      completionRate: metrics.total_fulfillments > 0 
        ? (metrics.shipped / metrics.total_fulfillments * 100).toFixed(2)
        : 0,
      averageTime: parseFloat(metrics.avg_fulfillment_hours || 0),
      warehousePerformance: warehouseMetrics,
      pickerPerformance: pickerMetrics
    };
  }

  async _selectWarehouse(order) {
    // Simple warehouse selection - in production, use sophisticated algorithm
    const warehouses = await this.database.query(`
      SELECT w.*, 
        ST_Distance(w.location, ST_MakePoint($1, $2)) as distance
      FROM warehouses w
      WHERE w.active = true
      ORDER BY distance
      LIMIT 1
    `, [order.shippingAddress.longitude, order.shippingAddress.latitude]);

    if (warehouses.length === 0) {
      throw new Error('No available warehouse found');
    }

    // Check inventory availability
    for (const warehouse of warehouses) {
      const hasInventory = await this._checkWarehouseInventory(
        warehouse.id,
        order.items
      );
      
      if (hasInventory) {
        return warehouse.id;
      }
    }

    throw new Error('No warehouse has sufficient inventory');
  }

  async _checkWarehouseInventory(warehouseId, items) {
    for (const item of items) {
      const available = await this.inventory.getAvailable({
        productId: item.productId,
        variantId: item.variantId,
        warehouseId
      });

      if (available < item.quantity) {
        return false;
      }
    }
    return true;
  }

  async _prepareFulfillmentItems(orderItems) {
    return orderItems.map(item => ({
      product_id: item.productId,
      variant_id: item.variantId,
      sku: item.sku,
      name: item.name,
      quantity_ordered: item.quantity,
      quantity_to_pick: item.quantity,
      picked_quantity: 0,
      metadata: item.metadata || {}
    }));
  }

  async _createPickingList(trx, fulfillment) {
    const pickingList = [];
    
    for (const item of fulfillment.items) {
      const locations = await trx.query(
        `SELECT * FROM inventory_locations 
         WHERE warehouse_id = $1 AND product_id = $2 
         ORDER BY pick_priority, bin_location`,
        [fulfillment.warehouse_id, item.product_id]
      );

      pickingList.push({
        productId: item.product_id,
        sku: item.sku,
        name: item.name,
        quantity: item.quantity_to_pick,
        locations: locations.map(loc => ({
          bin: loc.bin_location,
          quantity: loc.quantity,
          zone: loc.zone
        }))
      });
    }

    await trx.insert('picking_lists', {
      fulfillment_id: fulfillment.id,
      items: JSON.stringify(pickingList),
      created_at: new Date()
    });
  }

  async _checkAllItemsPicked(fulfillment) {
    return fulfillment.items.every(item => 
      item.picked_quantity >= item.quantity_ordered
    );
  }

  async _createPackages(fulfillment, packingData) {
    // Simple packing algorithm - in production, use bin packing algorithm
    const packages = [];
    const maxWeight = packingData.maxPackageWeight || 50; // lbs
    
    let currentPackage = {
      type: 'standard_box',
      weight: 0,
      dimensions: { length: 12, width: 12, height: 8 },
      items: [],
      packingMaterials: ['bubble_wrap', 'packing_peanuts']
    };

    for (const item of fulfillment.items) {
      const itemWeight = await this._getItemWeight(item.product_id);
      
      if (currentPackage.weight + itemWeight > maxWeight) {
        packages.push(currentPackage);
        currentPackage = {
          type: 'standard_box',
          weight: 0,
          dimensions: { length: 12, width: 12, height: 8 },
          items: [],
          packingMaterials: ['bubble_wrap', 'packing_peanuts']
        };
      }

      currentPackage.items.push({
        productId: item.product_id,
        quantity: item.picked_quantity,
        weight: itemWeight
      });
      currentPackage.weight += itemWeight;
    }

    if (currentPackage.items.length > 0) {
      packages.push(currentPackage);
    }

    return packages;
  }

  async _getItemWeight(productId) {
    const product = await this.database.queryOne(
      'SELECT weight FROM products WHERE id = $1',
      [productId]
    );
    return product?.weight || 1; // Default 1 lb
  }

  async _updateInventoryAfterShipment(trx, fulfillment) {
    for (const item of fulfillment.items) {
      await this.inventory.deduct({
        productId: item.product_id,
        variantId: item.variant_id,
        quantity: item.picked_quantity,
        warehouseId: fulfillment.warehouse_id,
        reason: 'shipped',
        referenceId: fulfillment.id
      });
    }
  }

  _calculatePriority(order) {
    // Priority based on shipping method and customer tier
    const priorities = {
      'express': 1,
      'priority': 2,
      'standard': 3,
      'economy': 4
    };

    return priorities[order.shippingMethod] || 3;
  }

  _isValidStatusTransition(from, to) {
    const transitions = {
      pending: ['assigned', 'cancelled'],
      assigned: ['picking', 'cancelled'],
      picking: ['ready_to_pack', 'cancelled'],
      ready_to_pack: ['packed', 'cancelled'],
      packed: ['ready_to_ship', 'cancelled'],
      ready_to_ship: ['shipped', 'cancelled'],
      shipped: ['delivered'],
      delivered: [],
      cancelled: []
    };

    return transitions[from]?.includes(to) || false;
  }

  async _recordFulfillmentHistory(trx, fulfillmentId, event, data) {
    await trx.insert('fulfillment_history', {
      fulfillment_id: fulfillmentId,
      event,
      data: JSON.stringify(data),
      created_at: new Date()
    });
  }

  _generateFulfillmentId() {
    return `ful_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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

  _formatFulfillment(fulfillment) {
    return {
      id: fulfillment.id,
      orderId: fulfillment.order_id,
      warehouseId: fulfillment.warehouse_id,
      status: fulfillment.status,
      type: fulfillment.type,
      priority: fulfillment.priority,
      items: fulfillment.items,
      packages: fulfillment.packages,
      assignedTo: fulfillment.assigned_to,
      shipping: fulfillment.shipping,
      notes: fulfillment.notes,
      metadata: fulfillment.metadata,
      createdAt: fulfillment.created_at,
      updatedAt: fulfillment.updated_at,
      assignedAt: fulfillment.assigned_at,
      packedAt: fulfillment.packed_at,
      shippedAt: fulfillment.shipped_at
    };
  }

  async _ensureTablesExist() {
    // Table creation would be handled by migrations
  }
}

module.exports = FulfillmentService;