/**
 * Analytics Intelligence Module Tests
 */

import { AnalyticsIntelligenceModule } from '../index';
import { ModuleConfig } from '../../../../shared/interfaces/module.interface';

describe('AnalyticsIntelligenceModule', () => {
  let module: AnalyticsIntelligenceModule;
  let mockEventBus: any;
  let mockDatabase: any;
  let mockCache: any;

  beforeEach(() => {
    // Mock dependencies
    mockEventBus = {
      emit: jest.fn(),
      subscribe: jest.fn()
    };

    mockDatabase = {
      query: jest.fn()
    };

    mockCache = {
      get: jest.fn(),
      set: jest.fn(),
      increment: jest.fn(),
      incrementBy: jest.fn()
    };

    module = new AnalyticsIntelligenceModule();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Module Lifecycle', () => {
    it('should initialize successfully with all dependencies', async () => {
      const config: ModuleConfig = {
        dependencies: {
          'event-bus': {
            services: { eventBus: mockEventBus }
          },
          'database': {
            services: { database: mockDatabase }
          },
          'cache': {
            services: { cache: mockCache }
          }
        }
      };

      await expect(module.initialize(config)).resolves.not.toThrow();
      expect(module.isReady()).toBe(true);
    });

    it('should throw error if event bus dependency is missing', async () => {
      const config: ModuleConfig = {
        dependencies: {
          'database': {
            services: { database: mockDatabase }
          },
          'cache': {
            services: { cache: mockCache }
          }
        }
      };

      await expect(module.initialize(config)).rejects.toThrow('Event bus dependency not found');
    });

    it('should throw error if database dependency is missing', async () => {
      const config: ModuleConfig = {
        dependencies: {
          'event-bus': {
            services: { eventBus: mockEventBus }
          },
          'cache': {
            services: { cache: mockCache }
          }
        }
      };

      await expect(module.initialize(config)).rejects.toThrow('Database dependency not found');
    });

    it('should throw error if cache dependency is missing', async () => {
      const config: ModuleConfig = {
        dependencies: {
          'event-bus': {
            services: { eventBus: mockEventBus }
          },
          'database': {
            services: { database: mockDatabase }
          }
        }
      };

      await expect(module.initialize(config)).rejects.toThrow('Cache dependency not found');
    });
  });

  describe('Event Subscriptions', () => {
    it('should subscribe to relevant events during initialization', async () => {
      const config: ModuleConfig = {
        dependencies: {
          'event-bus': {
            services: { eventBus: mockEventBus }
          },
          'database': {
            services: { database: mockDatabase }
          },
          'cache': {
            services: { cache: mockCache }
          }
        }
      };

      await module.initialize(config);

      expect(mockEventBus.subscribe).toHaveBeenCalledWith('InventoryUpdated', expect.any(Function));
      expect(mockEventBus.subscribe).toHaveBeenCalledWith('OrderCompleted', expect.any(Function));
      expect(mockEventBus.subscribe).toHaveBeenCalledWith('ForecastRequested', expect.any(Function));
    });
  });

  describe('Module Exports', () => {
    it('should export all required services and controllers', async () => {
      const config: ModuleConfig = {
        dependencies: {
          'event-bus': {
            services: { eventBus: mockEventBus }
          },
          'database': {
            services: { database: mockDatabase }
          },
          'cache': {
            services: { cache: mockCache }
          }
        }
      };

      await module.initialize(config);
      const exports = module.getExports();

      expect(exports.services).toHaveProperty('analyticsService');
      expect(exports.services).toHaveProperty('forecastService');
      expect(exports.services).toHaveProperty('insightsService');
      expect(exports.services).toHaveProperty('reportGenerationService');
      expect(exports.services).toHaveProperty('dataExportService');
      expect(exports.controllers).toHaveProperty('analyticsController');
    });

    it('should throw error if getting exports before initialization', () => {
      expect(() => module.getExports()).toThrow('Module not initialized');
    });
  });

  describe('Health Check', () => {
    it('should report healthy when all services are ready', async () => {
      const config: ModuleConfig = {
        dependencies: {
          'event-bus': {
            services: { eventBus: mockEventBus }
          },
          'database': {
            services: { database: mockDatabase }
          },
          'cache': {
            services: { cache: mockCache }
          }
        }
      };

      await module.initialize(config);
      const health = await module.healthCheck();

      expect(health.status).toBe('healthy');
      expect(health.details.initialized).toBe(true);
      expect(health.details.analyticsServiceReady).toBe(true);
      expect(health.details.forecastServiceReady).toBe(true);
      expect(health.details.insightsServiceReady).toBe(true);
    });

    it('should report unhealthy when not initialized', async () => {
      const health = await module.healthCheck();

      expect(health.status).toBe('unhealthy');
      expect(health.details.initialized).toBe(false);
    });
  });

  describe('Shutdown', () => {
    it('should shutdown gracefully', async () => {
      const config: ModuleConfig = {
        dependencies: {
          'event-bus': {
            services: { eventBus: mockEventBus }
          },
          'database': {
            services: { database: mockDatabase }
          },
          'cache': {
            services: { cache: mockCache }
          }
        }
      };

      await module.initialize(config);
      await module.shutdown();

      expect(module.isReady()).toBe(false);
    });
  });
});