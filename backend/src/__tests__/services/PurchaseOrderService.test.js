const PurchaseOrderService = require('../../services/PurchaseOrderService');
const { mockDb, resetMockDb, setupMockQuery } = require('../setup/testDb');

// Mock the database module
jest.mock('../../../../config/database', () => ({
  query: (...args) => mockDb.query(...args),
}));

// Mock Redis queue
jest.mock('../../../../config/redis', () => ({
  addJob: jest.fn().mockResolvedValue({ id: 'job-123' }),
}));

describe('PurchaseOrderService - Ticket #4', () => {
  beforeEach(() => {
    resetMockDb();
    jest.clearAllMocks();
  });

  describe('createPurchaseOrder', () => {
    it('should create a purchase order successfully', async () => {
      const storeId = 'test-store-id';
      const createdBy = 'user-123';
      const poData = {
        supplierId: 'supplier-1',
        items: [
          {
            productId: 'prod-1',
            supplierProductId: 'sp-1',
            quantity: 100,
            unitCost: 10.50,
          },
          {
            productId: 'prod-2',
            supplierProductId: 'sp-2',
            quantity: 50,
            unitCost: 25.00,
          },
        ],
        notes: 'Urgent restock needed',
        paymentTerms: 'Net 30',
      };

      // Mock supplier data
      const supplierData = [{
        supplier_id: 'supplier-1',
        supplier_name: 'Test Supplier',
        email: 'supplier@test.com',
      }];

      setupMockQuery([
        supplierData, // Get supplier
        [{ po_id: 'po-123', po_number: 'PO-2024-001' }], // Insert PO
        [{ po_item_id: 'item-1' }], // Insert item 1
        [{ po_item_id: 'item-2' }], // Insert item 2
      ]);

      const result = await PurchaseOrderService.createPurchaseOrder(
        storeId,
        createdBy,
        poData
      );

      expect(result.poId).toBe('po-123');
      expect(result.poNumber).toBe('PO-2024-001');
      expect(result.totalAmount).toBe(2300); // (100 * 10.50) + (50 * 25.00)
      expect(mockDb.query).toHaveBeenCalledTimes(4);
    });

    it('should validate required fields', async () => {
      const storeId = 'test-store-id';
      const createdBy = 'user-123';
      const invalidPoData = {
        supplierId: 'supplier-1',
        items: [], // Empty items array
      };

      await expect(
        PurchaseOrderService.createPurchaseOrder(storeId, createdBy, invalidPoData)
      ).rejects.toThrow('Purchase order must contain at least one item');
    });
  });

  describe('generateAutomaticPurchaseOrders', () => {
    it('should generate POs for products below reorder point', async () => {
      const storeId = 'test-store-id';
      const options = {
        dryRun: false,
        includeDisabled: false,
      };

      // Mock products needing reorder
      const reorderProducts = [
        {
          product_id: 'prod-1',
          product_name: 'Low Stock Product',
          current_stock: 10,
          reorder_point: 50,
          reorder_quantity: 100,
          supplier_id: 'supplier-1',
          supplier_name: 'Supplier A',
          unit_cost: 15.00,
        },
        {
          product_id: 'prod-2',
          product_name: 'Critical Stock Product',
          current_stock: 5,
          reorder_point: 20,
          reorder_quantity: 50,
          supplier_id: 'supplier-1',
          supplier_name: 'Supplier A',
          unit_cost: 25.00,
        },
      ];

      setupMockQuery([
        reorderProducts, // Get products needing reorder
        [{ po_id: 'po-auto-1', po_number: 'PO-AUTO-001' }], // Create PO
        [{ po_item_id: 'item-1' }], // Insert item 1
        [{ po_item_id: 'item-2' }], // Insert item 2
      ]);

      const redis = require('../../config/redis');
      const result = await PurchaseOrderService.generateAutomaticPurchaseOrders(
        storeId,
        options
      );

      expect(result.ordersGenerated).toBe(1);
      expect(result.totalProducts).toBe(2);
      expect(result.totalValue).toBe(2750); // (100 * 15) + (50 * 25)
      expect(redis.addJob).toHaveBeenCalled();
    });

    it('should respect dry run mode', async () => {
      const storeId = 'test-store-id';
      const options = {
        dryRun: true,
        includeDisabled: false,
      };

      const reorderProducts = [
        {
          product_id: 'prod-1',
          current_stock: 10,
          reorder_point: 50,
          reorder_quantity: 100,
          supplier_id: 'supplier-1',
          unit_cost: 15.00,
        },
      ];

      setupMockQuery([reorderProducts]);

      const result = await PurchaseOrderService.generateAutomaticPurchaseOrders(
        storeId,
        options
      );

      expect(result.dryRun).toBe(true);
      expect(result.ordersGenerated).toBe(0);
      expect(result.preview).toHaveLength(1);
      expect(mockDb.query).toHaveBeenCalledTimes(1); // Only query, no inserts
    });
  });

  describe('updatePurchaseOrderStatus', () => {
    it('should update PO status and track history', async () => {
      const poId = 'po-123';
      const storeId = 'test-store-id';
      const newStatus = 'approved';
      const userId = 'user-123';
      const additionalData = {
        approvedBy: 'user-123',
        approvalNotes: 'Budget approved',
      };

      const poData = [{
        po_id: 'po-123',
        status: 'pending',
        supplier_id: 'supplier-1',
      }];

      setupMockQuery([
        poData, // Get PO
        [], // Update status
        [{ history_id: 'hist-1' }], // Insert status history
      ]);

      const result = await PurchaseOrderService.updatePurchaseOrderStatus(
        poId,
        storeId,
        newStatus,
        userId,
        additionalData
      );

      expect(result.success).toBe(true);
      expect(result.previousStatus).toBe('pending');
      expect(result.newStatus).toBe('approved');
      expect(mockDb.query).toHaveBeenCalledTimes(3);
    });

    it('should prevent invalid status transitions', async () => {
      const poId = 'po-123';
      const storeId = 'test-store-id';
      const newStatus = 'pending'; // Invalid transition from completed
      const userId = 'user-123';

      const poData = [{
        po_id: 'po-123',
        status: 'completed',
      }];

      setupMockQuery([poData]);

      await expect(
        PurchaseOrderService.updatePurchaseOrderStatus(
          poId,
          storeId,
          newStatus,
          userId
        )
      ).rejects.toThrow('Invalid status transition');
    });
  });

  describe('receiveItems', () => {
    it('should receive items and update inventory', async () => {
      const poId = 'po-123';
      const storeId = 'test-store-id';
      const userId = 'user-123';
      const receivedItems = [
        {
          poItemId: 'item-1',
          quantityReceived: 100,
          notes: 'All items in good condition',
        },
        {
          poItemId: 'item-2',
          quantityReceived: 48, // Partial receipt
          notes: '2 items damaged',
        },
      ];

      const poData = [{
        po_id: 'po-123',
        status: 'ordered',
      }];

      const poItemsData = [
        {
          po_item_id: 'item-1',
          product_id: 'prod-1',
          quantity: 100,
          quantity_received: 0,
        },
        {
          po_item_id: 'item-2',
          product_id: 'prod-2',
          quantity: 50,
          quantity_received: 0,
        },
      ];

      setupMockQuery([
        poData, // Get PO
        poItemsData, // Get PO items
        [], // Update item 1
        [], // Update item 2
        [], // Update inventory for prod-1
        [], // Update inventory for prod-2
        [], // Check if all items received
        [], // Update PO status to partial
      ]);

      const result = await PurchaseOrderService.receiveItems(
        poId,
        storeId,
        receivedItems,
        userId
      );

      expect(result.success).toBe(true);
      expect(result.itemsReceived).toBe(2);
      expect(result.totalQuantityReceived).toBe(148);
      expect(result.status).toBe('partial');
      expect(mockDb.query).toHaveBeenCalledTimes(8);
    });

    it('should complete PO when all items are received', async () => {
      const poId = 'po-123';
      const storeId = 'test-store-id';
      const userId = 'user-123';
      const receivedItems = [
        {
          poItemId: 'item-1',
          quantityReceived: 100,
        },
      ];

      const poData = [{
        po_id: 'po-123',
        status: 'ordered',
      }];

      const poItemsData = [
        {
          po_item_id: 'item-1',
          product_id: 'prod-1',
          quantity: 100,
          quantity_received: 0,
        },
      ];

      const allReceivedCheck = [
        { all_received: true },
      ];

      setupMockQuery([
        poData, // Get PO
        poItemsData, // Get PO items
        [], // Update item
        [], // Update inventory
        allReceivedCheck, // Check if all items received
        [], // Update PO status to completed
      ]);

      const result = await PurchaseOrderService.receiveItems(
        poId,
        storeId,
        receivedItems,
        userId
      );

      expect(result.status).toBe('completed');
    });
  });

  describe('getPurchaseOrderAnalytics', () => {
    it('should calculate PO analytics correctly', async () => {
      const storeId = 'test-store-id';
      const filters = {
        period: 30,
        groupBy: 'supplier',
      };

      const analyticsData = [
        {
          supplier_id: 'supplier-1',
          supplier_name: 'Supplier A',
          total_orders: 15,
          total_value: 25000,
          avg_order_value: 1666.67,
          avg_lead_time_days: 5.2,
          on_time_delivery_rate: 0.93,
        },
        {
          supplier_id: 'supplier-2',
          supplier_name: 'Supplier B',
          total_orders: 10,
          total_value: 18000,
          avg_order_value: 1800,
          avg_lead_time_days: 7.5,
          on_time_delivery_rate: 0.80,
        },
      ];

      setupMockQuery([analyticsData]);

      const result = await PurchaseOrderService.getPurchaseOrderAnalytics(
        storeId,
        filters
      );

      expect(result).toHaveLength(2);
      expect(result[0].on_time_delivery_rate).toBe(0.93);
      expect(result[1].avg_lead_time_days).toBe(7.5);
    });
  });

  describe('cancelPurchaseOrder', () => {
    it('should cancel a pending purchase order', async () => {
      const poId = 'po-123';
      const storeId = 'test-store-id';
      const userId = 'user-123';
      const reason = 'Budget constraints';

      const poData = [{
        po_id: 'po-123',
        status: 'pending',
        supplier_id: 'supplier-1',
      }];

      setupMockQuery([
        poData, // Get PO
        [], // Update status to cancelled
        [{ history_id: 'hist-1' }], // Insert cancellation history
      ]);

      const redis = require('../../config/redis');
      const result = await PurchaseOrderService.cancelPurchaseOrder(
        poId,
        storeId,
        userId,
        reason
      );

      expect(result.success).toBe(true);
      expect(result.previousStatus).toBe('pending');
      expect(redis.addJob).toHaveBeenCalled(); // Email notification
    });

    it('should not cancel already shipped orders', async () => {
      const poId = 'po-123';
      const storeId = 'test-store-id';
      const userId = 'user-123';

      const poData = [{
        po_id: 'po-123',
        status: 'shipped',
      }];

      setupMockQuery([poData]);

      await expect(
        PurchaseOrderService.cancelPurchaseOrder(poId, storeId, userId)
      ).rejects.toThrow('Cannot cancel purchase order with status: shipped');
    });
  });
});