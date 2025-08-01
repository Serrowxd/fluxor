const ConflictResolutionEngine = require('../../services/ConflictResolutionEngine');
const { mockDb, resetMockDb, setupMockQuery } = require('../setup/testDb');

// Mock the database module
jest.mock('../../../../config/database', () => ({
  query: (...args) => mockDb.query(...args),
}));

describe('ConflictResolutionEngine - Ticket #3', () => {
  beforeEach(() => {
    resetMockDb();
  });

  describe('detectConflicts', () => {
    it('should detect stock mismatches between channels', async () => {
      const productId = 'prod-1';
      
      const channelInventoryData = [
        {
          channel_id: 'ch-1',
          channel_name: 'Shopify',
          channel_type: 'shopify',
          quantity: 100,
          last_updated: new Date(),
        },
        {
          channel_id: 'ch-2',
          channel_name: 'Amazon',
          channel_type: 'amazon',
          quantity: 95,
          last_updated: new Date(Date.now() - 3600000), // 1 hour ago
        },
        {
          channel_id: 'ch-3',
          channel_name: 'eBay',
          channel_type: 'ebay',
          quantity: 100,
          last_updated: new Date(),
        },
      ];

      setupMockQuery([channelInventoryData]);

      const conflicts = await ConflictResolutionEngine.detectConflicts(productId);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].type).toBe('stock_mismatch');
      expect(conflicts[0].channels).toHaveLength(3);
      expect(conflicts[0].discrepancy).toBe(5); // 100 - 95
    });

    it('should not detect conflicts when all quantities match', async () => {
      const productId = 'prod-1';
      
      const channelInventoryData = [
        {
          channel_id: 'ch-1',
          channel_name: 'Shopify',
          quantity: 100,
          last_updated: new Date(),
        },
        {
          channel_id: 'ch-2',
          channel_name: 'Amazon',
          quantity: 100,
          last_updated: new Date(),
        },
      ];

      setupMockQuery([channelInventoryData]);

      const conflicts = await ConflictResolutionEngine.detectConflicts(productId);

      expect(conflicts).toHaveLength(0);
    });
  });

  describe('resolveConflict', () => {
    it('should resolve using last_write_wins strategy', async () => {
      const conflict = {
        conflictId: 'conf-1',
        productId: 'prod-1',
        type: 'stock_mismatch',
        channels: [
          {
            channelId: 'ch-1',
            channelName: 'Shopify',
            quantity: 100,
            lastUpdated: new Date(Date.now() - 7200000), // 2 hours ago
          },
          {
            channelId: 'ch-2',
            channelName: 'Amazon',
            quantity: 95,
            lastUpdated: new Date(), // Now
          },
        ],
      };

      const resolution = await ConflictResolutionEngine.resolveConflict(
        conflict,
        'last_write_wins'
      );

      expect(resolution.strategy).toBe('last_write_wins');
      expect(resolution.resolvedValue).toBe(95); // Amazon's value (most recent)
      expect(resolution.sourceChannel).toBe('ch-2');
    });

    it('should resolve using source_priority strategy', async () => {
      const conflict = {
        conflictId: 'conf-1',
        productId: 'prod-1',
        type: 'stock_mismatch',
        channels: [
          {
            channelId: 'ch-1',
            channelName: 'Shopify',
            channelType: 'shopify',
            quantity: 100,
            lastUpdated: new Date(),
          },
          {
            channelId: 'ch-2',
            channelName: 'Amazon',
            channelType: 'amazon',
            quantity: 95,
            lastUpdated: new Date(),
          },
        ],
      };

      const priorityOrder = ['shopify', 'amazon', 'ebay'];
      const resolution = await ConflictResolutionEngine.resolveConflict(
        conflict,
        'source_priority',
        { priorityOrder }
      );

      expect(resolution.strategy).toBe('source_priority');
      expect(resolution.resolvedValue).toBe(100); // Shopify's value (higher priority)
      expect(resolution.sourceChannel).toBe('ch-1');
    });

    it('should resolve using conservative_approach strategy', async () => {
      const conflict = {
        conflictId: 'conf-1',
        productId: 'prod-1',
        type: 'stock_mismatch',
        channels: [
          {
            channelId: 'ch-1',
            quantity: 100,
          },
          {
            channelId: 'ch-2',
            quantity: 95,
          },
          {
            channelId: 'ch-3',
            quantity: 98,
          },
        ],
      };

      const resolution = await ConflictResolutionEngine.resolveConflict(
        conflict,
        'conservative_approach'
      );

      expect(resolution.strategy).toBe('conservative_approach');
      expect(resolution.resolvedValue).toBe(95); // Minimum value to prevent overselling
    });

    it('should resolve using aggregate_approach strategy', async () => {
      const conflict = {
        conflictId: 'conf-1',
        productId: 'prod-1',
        type: 'stock_mismatch',
        channels: [
          {
            channelId: 'ch-1',
            quantity: 100,
          },
          {
            channelId: 'ch-2',
            quantity: 95,
          },
          {
            channelId: 'ch-3',
            quantity: 98,
          },
        ],
      };

      const resolution = await ConflictResolutionEngine.resolveConflict(
        conflict,
        'aggregate_approach',
        { method: 'average' }
      );

      expect(resolution.strategy).toBe('aggregate_approach');
      expect(resolution.resolvedValue).toBe(98); // Average: (100 + 95 + 98) / 3 ≈ 98
      expect(resolution.method).toBe('average');
    });

    it('should flag for manual review when strategy is manual_review', async () => {
      const conflict = {
        conflictId: 'conf-1',
        productId: 'prod-1',
        type: 'stock_mismatch',
        channels: [
          { channelId: 'ch-1', quantity: 100 },
          { channelId: 'ch-2', quantity: 50 }, // Large discrepancy
        ],
      };

      const resolution = await ConflictResolutionEngine.resolveConflict(
        conflict,
        'manual_review'
      );

      expect(resolution.strategy).toBe('manual_review');
      expect(resolution.requiresManualIntervention).toBe(true);
      expect(resolution.resolvedValue).toBeUndefined();
    });
  });

  describe('getResolutionHistory', () => {
    it('should retrieve conflict resolution history', async () => {
      const productId = 'prod-1';
      const days = 30;

      const historyData = [
        {
          conflict_id: 'conf-1',
          conflict_type: 'stock_mismatch',
          resolution_strategy: 'last_write_wins',
          resolved_value: 100,
          resolved_at: new Date(),
          resolved_by: 'system',
        },
        {
          conflict_id: 'conf-2',
          conflict_type: 'stock_mismatch',
          resolution_strategy: 'manual_review',
          resolved_value: 95,
          resolved_at: new Date(Date.now() - 86400000), // 1 day ago
          resolved_by: 'user-123',
        },
      ];

      setupMockQuery([historyData]);

      const history = await ConflictResolutionEngine.getResolutionHistory(productId, days);

      expect(history).toHaveLength(2);
      expect(history[0].resolution_strategy).toBe('last_write_wins');
      expect(history[1].resolved_by).toBe('user-123');
    });
  });

  describe('analyzeConflictPatterns', () => {
    it('should identify conflict patterns for optimization', async () => {
      const storeId = 'test-store-id';
      const period = 30;

      const patternData = [
        {
          product_id: 'prod-1',
          product_name: 'High Conflict Product',
          conflict_count: 15,
          avg_discrepancy: 8.5,
          most_common_type: 'stock_mismatch',
          channels_involved: ['shopify', 'amazon'],
        },
        {
          product_id: 'prod-2',
          product_name: 'Medium Conflict Product',
          conflict_count: 5,
          avg_discrepancy: 3.2,
          most_common_type: 'stock_mismatch',
          channels_involved: ['shopify', 'ebay'],
        },
      ];

      setupMockQuery([patternData]);

      const patterns = await ConflictResolutionEngine.analyzeConflictPatterns(storeId, period);

      expect(patterns).toHaveLength(2);
      expect(patterns[0].conflict_count).toBe(15);
      expect(patterns[0].avg_discrepancy).toBe(8.5);
    });
  });

  describe('intelligent merge resolution', () => {
    it('should use weighted resolution based on channel reliability', async () => {
      const conflict = {
        conflictId: 'conf-1',
        productId: 'prod-1',
        type: 'stock_mismatch',
        channels: [
          {
            channelId: 'ch-1',
            channelType: 'shopify',
            quantity: 100,
            reliability_score: 0.95, // High reliability
          },
          {
            channelId: 'ch-2',
            channelType: 'amazon',
            quantity: 95,
            reliability_score: 0.85, // Medium reliability
          },
          {
            channelId: 'ch-3',
            channelType: 'custom_api',
            quantity: 90,
            reliability_score: 0.70, // Lower reliability
          },
        ],
      };

      const resolution = await ConflictResolutionEngine.resolveConflict(
        conflict,
        'intelligent_merge'
      );

      // Weighted average: (100*0.95 + 95*0.85 + 90*0.70) / (0.95 + 0.85 + 0.70)
      // = (95 + 80.75 + 63) / 2.5 = 238.75 / 2.5 = 95.5
      expect(resolution.strategy).toBe('intelligent_merge');
      expect(resolution.resolvedValue).toBeCloseTo(96, 0);
      expect(resolution.confidence).toBeGreaterThan(0.8);
    });
  });
});