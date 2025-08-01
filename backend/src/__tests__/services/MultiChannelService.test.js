const MultiChannelService = require("../../services/MultiChannelService");
const { mockDb, resetMockDb, setupMockQuery } = require("../setup/testDb");

// Mock the database module
jest.mock("../../../config/database", () => ({
  query: (...args) => mockDb.query(...args),
}));

// Mock the channel factory
jest.mock("../../services/channels/ChannelFactory", () => ({
  createConnector: jest.fn().mockImplementation((channelType) => ({
    channelType,
    authenticate: jest.fn().mockResolvedValue({ success: true }),
    syncInventory: jest.fn().mockResolvedValue({
      totalProcessed: 10,
      successful: 9,
      failed: 1,
    }),
    healthCheck: jest.fn().mockResolvedValue({ status: "healthy" }),
  })),
}));

// Mock Redis queue
jest.mock("../../../config/redis", () => ({
  addJob: jest.fn().mockResolvedValue({ id: "job-123" }),
}));

describe("MultiChannelService - Ticket #3", () => {
  beforeEach(() => {
    resetMockDb();
    jest.clearAllMocks();
  });

  describe("getActiveChannels", () => {
    it("should retrieve all active channels for a store", async () => {
      const storeId = "test-store-id";

      const channelsData = [
        {
          channel_id: "ch-1",
          channel_name: "Main Shopify Store",
          channel_type: "shopify",
          is_active: true,
          last_sync_at: new Date(),
          sync_status: "completed",
        },
        {
          channel_id: "ch-2",
          channel_name: "Amazon Seller",
          channel_type: "amazon",
          is_active: true,
          last_sync_at: new Date(),
          sync_status: "completed",
        },
      ];

      setupMockQuery([channelsData]);

      const result = await MultiChannelService.getActiveChannels(storeId);

      expect(result).toHaveLength(2);
      expect(result[0].channel_type).toBe("shopify");
      expect(result[1].channel_type).toBe("amazon");
    });
  });

  describe("connectChannel", () => {
    it("should connect a new channel successfully", async () => {
      const storeId = "test-store-id";
      const channelData = {
        channelType: "shopify",
        channelName: "Test Shopify Store",
        credentials: {
          apiKey: "test-key",
          apiSecret: "test-secret",
          shopUrl: "test.myshopify.com",
        },
      };

      setupMockQuery([
        [{ channel_id: "ch-new", channel_name: "Test Shopify Store" }], // Insert channel
        [{ credential_id: "cred-1" }], // Insert credentials
      ]);

      const result = await MultiChannelService.connectChannel(
        storeId,
        channelData
      );

      expect(result.success).toBe(true);
      expect(result.channelId).toBe("ch-new");
      expect(mockDb.query).toHaveBeenCalledTimes(2);
    });

    it("should handle connection failures gracefully", async () => {
      const storeId = "test-store-id";
      const channelData = {
        channelType: "shopify",
        channelName: "Test Shopify Store",
        credentials: {
          apiKey: "invalid-key",
        },
      };

      // Mock authentication failure
      const ChannelFactory = require("../../services/channels/ChannelFactory");
      ChannelFactory.createConnector.mockImplementationOnce(() => ({
        authenticate: jest
          .fn()
          .mockRejectedValue(new Error("Invalid credentials")),
      }));

      await expect(
        MultiChannelService.connectChannel(storeId, channelData)
      ).rejects.toThrow("Invalid credentials");
    });
  });

  describe("syncAllChannels", () => {
    it("should sync inventory across all active channels", async () => {
      const storeId = "test-store-id";

      const channelsData = [
        {
          channel_id: "ch-1",
          channel_type: "shopify",
          is_active: true,
        },
        {
          channel_id: "ch-2",
          channel_type: "amazon",
          is_active: true,
        },
      ];

      setupMockQuery([
        channelsData, // Get active channels
        [{ sync_id: "sync-1" }], // Create sync status for ch-1
        [{ sync_id: "sync-2" }], // Create sync status for ch-2
      ]);

      const redis = require("../../config/redis");
      const result = await MultiChannelService.syncAllChannels(storeId);

      expect(result.channelsQueued).toBe(2);
      expect(result.jobIds).toHaveLength(2);
      expect(redis.addJob).toHaveBeenCalledTimes(2);
    });
  });

  describe("syncSingleChannel", () => {
    it("should sync a specific channel", async () => {
      const storeId = "test-store-id";
      const channelId = "ch-1";

      const channelData = [
        {
          channel_id: "ch-1",
          channel_type: "shopify",
          channel_name: "Main Store",
        },
      ];

      const productsData = [
        { product_id: "prod-1", current_stock: 100 },
        { product_id: "prod-2", current_stock: 50 },
      ];

      setupMockQuery([
        channelData, // Get channel info
        productsData, // Get products to sync
        [{ sync_id: "sync-1" }], // Create sync status
      ]);

      const redis = require("../../config/redis");
      const result = await MultiChannelService.syncSingleChannel(
        storeId,
        channelId
      );

      expect(result.success).toBe(true);
      expect(result.productsQueued).toBe(2);
      expect(redis.addJob).toHaveBeenCalled();
    });
  });

  describe("handleInventoryConflict", () => {
    it("should detect and record inventory conflicts", async () => {
      const conflictData = {
        productId: "prod-1",
        channels: [
          { channelId: "ch-1", channelName: "Shopify", quantity: 100 },
          { channelId: "ch-2", channelName: "Amazon", quantity: 95 },
        ],
      };

      setupMockQuery([
        [{ conflict_id: "conflict-1" }], // Insert conflict
      ]);

      const result = await MultiChannelService.handleInventoryConflict(
        conflictData
      );

      expect(result.conflictId).toBe("conflict-1");
      expect(mockDb.query).toHaveBeenCalledTimes(1);
    });
  });

  describe("resolveConflict", () => {
    it("should resolve conflicts using specified strategy", async () => {
      const conflictId = "conflict-1";
      const resolution = {
        strategy: "source_priority",
        chosenChannelId: "ch-1",
        resolvedQuantity: 100,
        userId: "user-1",
      };

      const conflictData = [
        {
          conflict_id: "conflict-1",
          product_id: "prod-1",
          conflict_data: {
            channels: [
              { channelId: "ch-1", quantity: 100 },
              { channelId: "ch-2", quantity: 95 },
            ],
          },
        },
      ];

      setupMockQuery([
        conflictData, // Get conflict details
        [], // Update conflict status
        [], // Update inventory
      ]);

      const result = await MultiChannelService.resolveConflict(
        conflictId,
        resolution
      );

      expect(result.success).toBe(true);
      expect(mockDb.query).toHaveBeenCalledTimes(3);
    });
  });

  describe("getSyncStatus", () => {
    it("should retrieve sync status for all channels", async () => {
      const storeId = "test-store-id";

      const syncStatusData = [
        {
          channel_id: "ch-1",
          channel_name: "Shopify",
          sync_status: "completed",
          last_sync_at: new Date(),
          products_synced: 100,
          sync_duration: 45,
          error_count: 0,
        },
        {
          channel_id: "ch-2",
          channel_name: "Amazon",
          sync_status: "in_progress",
          last_sync_at: new Date(),
          products_synced: 50,
          sync_duration: null,
          error_count: 2,
        },
      ];

      setupMockQuery([syncStatusData]);

      const result = await MultiChannelService.getSyncStatus(storeId);

      expect(result).toHaveLength(2);
      expect(result[0].sync_status).toBe("completed");
      expect(result[1].sync_status).toBe("in_progress");
      expect(result[1].error_count).toBe(2);
    });
  });

  describe("getConflicts", () => {
    it("should retrieve pending conflicts", async () => {
      const storeId = "test-store-id";
      const status = "pending";

      const conflictsData = [
        {
          conflict_id: "conf-1",
          product_id: "prod-1",
          product_name: "Test Product",
          conflict_type: "stock_mismatch",
          detected_at: new Date(),
          channels_affected: 2,
        },
      ];

      setupMockQuery([conflictsData]);

      const result = await MultiChannelService.getConflicts(storeId, {
        status,
      });

      expect(result).toHaveLength(1);
      expect(result[0].conflict_type).toBe("stock_mismatch");
    });
  });

  describe("processWebhook", () => {
    it("should process channel webhooks correctly", async () => {
      const channelType = "shopify";
      const payload = {
        topic: "inventory_levels/update",
        shop_domain: "test.myshopify.com",
        inventory_item_id: "inv-123",
        available: 75,
      };

      const channelData = [
        {
          channel_id: "ch-1",
          channel_type: "shopify",
        },
      ];

      setupMockQuery([
        channelData, // Find channel by shop domain
        [{ log_id: "log-1" }], // Log webhook
      ]);

      const redis = require("../../config/redis");
      const result = await MultiChannelService.processWebhook(
        channelType,
        payload
      );

      expect(result.success).toBe(true);
      expect(redis.addJob).toHaveBeenCalled();
    });
  });
});
