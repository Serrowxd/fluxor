/**
 * Analytics Service Tests
 */

import { AnalyticsService } from '../../services/analytics.service';
import { KPI, Dashboard, AnalyticsQuery } from '../../types';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let mockDatabase: any;
  let mockCache: any;
  let mockEventBus: any;

  beforeEach(() => {
    mockDatabase = {
      query: jest.fn()
    };

    mockCache = {
      get: jest.fn(),
      set: jest.fn(),
      increment: jest.fn(),
      incrementBy: jest.fn()
    };

    mockEventBus = {
      emit: jest.fn()
    };

    service = new AnalyticsService(mockDatabase, mockCache, mockEventBus);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('calculateDailyKPIs', () => {
    it('should calculate and return all KPIs', async () => {
      // Mock database responses
      mockDatabase.query.mockImplementation((query: string) => {
        if (query.includes('turnover_ratio')) {
          return { rows: [{ turnover_ratio: 5.2 }] };
        }
        if (query.includes('stockout_rate')) {
          return { rows: [{ stockout_rate: 3.5 }] };
        }
        if (query.includes('dead_stock_value')) {
          return { rows: [{ dead_stock_value: 50000 }] };
        }
        if (query.includes('AVG(total_amount)')) {
          return { rows: [{ aov: 125.50 }] };
        }
        if (query.includes('fill_rate')) {
          return { rows: [{ fill_rate: 95.5 }] };
        }
        if (query.includes('avg_lead_time')) {
          return { rows: [{ avg_lead_time: 3.2 }] };
        }
        if (query.includes('utilization_rate')) {
          return { rows: [{ utilization_rate: 78.5 }] };
        }
        if (query.includes('kpi_history')) {
          return { rows: [] };
        }
        return { rows: [] };
      });

      const kpis = await service.calculateDailyKPIs();

      expect(kpis).toHaveLength(7);
      expect(kpis.find(k => k.id === 'inventory-turnover')).toBeDefined();
      expect(kpis.find(k => k.id === 'stockout-rate')).toBeDefined();
      expect(kpis.find(k => k.id === 'dead-stock-value')).toBeDefined();
      expect(mockEventBus.emit).toHaveBeenCalledWith('KPIsCalculated', expect.any(Object));
    });

    it('should cache calculated KPIs', async () => {
      mockDatabase.query.mockResolvedValue({ rows: [{ turnover_ratio: 5.2 }] });

      await service.calculateDailyKPIs();

      expect(mockCache.set).toHaveBeenCalledTimes(7); // One for each KPI
      expect(mockCache.set).toHaveBeenCalledWith(
        expect.stringContaining('kpi:'),
        expect.any(Object),
        3600
      );
    });

    it('should handle database errors gracefully', async () => {
      mockDatabase.query.mockRejectedValue(new Error('Database error'));

      await expect(service.calculateDailyKPIs()).rejects.toThrow('Database error');
    });
  });

  describe('getKPI', () => {
    it('should return KPI from cache if available', async () => {
      const cachedKPI: KPI = {
        id: 'inventory-turnover',
        name: 'Inventory Turnover Ratio',
        value: 5.2,
        unit: 'times',
        trend: 'up',
        percentageChange: 4.5,
        lastUpdated: new Date(),
        category: 'inventory'
      };

      mockCache.get.mockResolvedValue(cachedKPI);

      const kpi = await service.getKPI('inventory-turnover');

      expect(kpi).toEqual(cachedKPI);
      expect(mockCache.get).toHaveBeenCalledWith('kpi:inventory-turnover');
    });

    it('should recalculate if KPI not found in cache', async () => {
      mockCache.get.mockResolvedValue(null);
      mockDatabase.query.mockResolvedValue({ rows: [{ turnover_ratio: 5.2 }] });

      const kpi = await service.getKPI('inventory-turnover');

      expect(kpi).toBeDefined();
      expect(mockDatabase.query).toHaveBeenCalled();
    });
  });

  describe('saveDashboard', () => {
    it('should save a new dashboard', async () => {
      const dashboard: Dashboard = {
        id: 'dashboard-1',
        name: 'Sales Dashboard',
        widgets: [],
        createdBy: 'user-1',
        lastModified: new Date(),
        isDefault: false
      };

      mockDatabase.query.mockResolvedValue({
        rows: [{
          ...dashboard,
          widgets: JSON.stringify(dashboard.widgets)
        }]
      });

      const saved = await service.saveDashboard(dashboard);

      expect(saved).toEqual(dashboard);
      expect(mockDatabase.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO dashboards'),
        expect.any(Array)
      );
      expect(mockCache.set).toHaveBeenCalledWith(
        'dashboard:dashboard-1',
        dashboard,
        3600
      );
    });

    it('should update an existing dashboard', async () => {
      const dashboard: Dashboard = {
        id: 'dashboard-1',
        name: 'Updated Dashboard',
        widgets: [],
        createdBy: 'user-1',
        lastModified: new Date(),
        isDefault: false
      };

      mockDatabase.query.mockResolvedValue({
        rows: [{
          ...dashboard,
          widgets: JSON.stringify(dashboard.widgets)
        }]
      });

      const saved = await service.saveDashboard(dashboard);

      expect(saved).toEqual(dashboard);
      expect(mockDatabase.query).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT (id) DO UPDATE'),
        expect.any(Array)
      );
    });
  });

  describe('executeQuery', () => {
    it('should execute analytics query and return results', async () => {
      const query: AnalyticsQuery = {
        metrics: ['revenue', 'order_count'],
        dimensions: ['product_category'],
        filters: [
          { field: 'date', operator: 'gte', value: '2024-01-01' }
        ],
        groupBy: ['product_category'],
        orderBy: [{ field: 'revenue', direction: 'desc' }],
        limit: 10
      };

      const mockResults = [
        { product_category: 'Electronics', revenue: 50000, order_count: 100 },
        { product_category: 'Clothing', revenue: 30000, order_count: 150 }
      ];

      mockDatabase.query.mockResolvedValue({ rows: mockResults });

      const result = await service.executeQuery(query);

      expect(result.data).toEqual(mockResults);
      expect(result.metadata.totalRows).toBe(2);
      expect(result.metadata.executionTime).toBeGreaterThan(0);
      expect(result.metadata.query).toEqual(query);
    });

    it('should handle query errors', async () => {
      const query: AnalyticsQuery = {
        metrics: ['invalid_metric']
      };

      mockDatabase.query.mockRejectedValue(new Error('Invalid query'));

      await expect(service.executeQuery(query)).rejects.toThrow('Invalid query');
    });
  });

  describe('updateRealTimeMetrics', () => {
    it('should update inventory metrics on inventory update event', async () => {
      const event = {
        type: 'InventoryUpdated',
        data: {
          productId: 'prod-1',
          warehouseId: 'warehouse-1',
          quantityChange: 50,
          unitCost: 10
        }
      };

      await service.updateRealTimeMetrics(event);

      expect(mockCache.incrementBy).toHaveBeenCalledWith(
        'metrics:inventory:value:warehouse-1',
        500 // 50 * 10
      );
      expect(mockEventBus.emit).toHaveBeenCalledWith('MetricsUpdated', expect.any(Object));
    });

    it('should update order metrics on order completed event', async () => {
      const event = {
        type: 'OrderCompleted',
        data: {
          orderId: 'order-1',
          totalAmount: 250.50
        }
      };

      mockCache.get.mockImplementation((key: string) => {
        if (key === 'metrics:daily:order_count') return 10;
        if (key === 'metrics:daily:revenue') return 2500;
        return null;
      });

      await service.updateOrderMetrics(event.data);

      expect(mockCache.increment).toHaveBeenCalledWith('metrics:daily:order_count');
      expect(mockCache.incrementBy).toHaveBeenCalledWith('metrics:daily:revenue', 250.50);
      expect(mockCache.set).toHaveBeenCalledWith('metrics:daily:aov', expect.any(Number));
    });
  });

  describe('getPerformanceMetrics', () => {
    it('should return comprehensive performance metrics', async () => {
      // Mock KPI cache
      const mockKPIs = {
        'inventory-turnover': { value: 5.2 },
        'stockout-rate': { value: 3.5 },
        'dead-stock-value': { value: 150000 },
        'order-fill-rate': { value: 95.5 },
        'average-lead-time': { value: 3.2 }
      };

      service.getKPI = jest.fn().mockImplementation((id: string) => 
        Promise.resolve(mockKPIs[id] || null)
      );

      mockDatabase.query.mockResolvedValue({ rows: [{ cost_per_order: 12.50, accuracy: 92 }] });

      const metrics = await service.getPerformanceMetrics();

      expect(metrics).toEqual({
        inventoryTurnover: 5.2,
        stockoutRate: 3.5,
        overStockRate: 15, // Based on dead stock value
        orderFillRate: 95.5,
        averageLeadTime: 3.2,
        forecastAccuracy: 92,
        costPerOrder: 12.50
      });
    });
  });

  describe('isReady', () => {
    it('should always return true', () => {
      expect(service.isReady()).toBe(true);
    });
  });
});