const { LoadBalancingStrategy } = require('../types');

class LoadBalancer {
  constructor(config = {}) {
    this.config = config;
    this.strategies = new Map();
    this.serviceStates = new Map();
    
    // Register default strategies
    this.registerDefaultStrategies();
  }

  registerDefaultStrategies() {
    // Round Robin
    this.registerStrategy(LoadBalancingStrategy.ROUND_ROBIN, {
      init: (service) => ({
        index: 0,
        servers: [...service.urls]
      }),
      
      select: (state, service) => {
        if (state.servers.length === 0) {
          return null;
        }
        
        const server = state.servers[state.index];
        state.index = (state.index + 1) % state.servers.length;
        
        return server;
      }
    });

    // Random
    this.registerStrategy(LoadBalancingStrategy.RANDOM, {
      init: (service) => ({
        servers: [...service.urls]
      }),
      
      select: (state, service) => {
        if (state.servers.length === 0) {
          return null;
        }
        
        const index = Math.floor(Math.random() * state.servers.length);
        return state.servers[index];
      }
    });

    // Weighted
    this.registerStrategy(LoadBalancingStrategy.WEIGHTED, {
      init: (service) => ({
        servers: service.urls.map((url, index) => ({
          url,
          weight: service.weights?.[index] || 1,
          currentWeight: 0
        })),
        totalWeight: service.weights?.reduce((sum, w) => sum + w, 0) || service.urls.length
      }),
      
      select: (state, service) => {
        if (state.servers.length === 0) {
          return null;
        }
        
        // Weighted round robin algorithm
        let selectedServer = null;
        let bestWeight = -1;
        
        for (const server of state.servers) {
          server.currentWeight += server.weight;
          
          if (server.currentWeight > bestWeight) {
            bestWeight = server.currentWeight;
            selectedServer = server;
          }
        }
        
        if (selectedServer) {
          selectedServer.currentWeight -= state.totalWeight;
          return selectedServer.url;
        }
        
        return state.servers[0].url;
      }
    });

    // Least Connections
    this.registerStrategy(LoadBalancingStrategy.LEAST_CONNECTIONS, {
      init: (service) => ({
        servers: service.urls.map(url => ({
          url,
          connections: 0
        }))
      }),
      
      select: (state, service, context) => {
        if (state.servers.length === 0) {
          return null;
        }
        
        // Find server with least connections
        let selectedServer = state.servers[0];
        
        for (const server of state.servers) {
          if (server.connections < selectedServer.connections) {
            selectedServer = server;
          }
        }
        
        // Track connection
        if (context?.trackConnection) {
          selectedServer.connections++;
          
          // Set up connection release
          if (context.onComplete) {
            context.onComplete(() => {
              selectedServer.connections--;
            });
          }
        }
        
        return selectedServer.url;
      }
    });

    // IP Hash
    this.registerStrategy(LoadBalancingStrategy.IP_HASH, {
      init: (service) => ({
        servers: [...service.urls]
      }),
      
      select: (state, service, context) => {
        if (state.servers.length === 0) {
          return null;
        }
        
        const ip = context?.clientIp || '127.0.0.1';
        const hash = this.hashString(ip);
        const index = Math.abs(hash) % state.servers.length;
        
        return state.servers[index];
      }
    });
  }

  registerStrategy(name, strategy) {
    this.strategies.set(name, strategy);
  }

  selectServer(service, context = {}) {
    const strategyName = service.loadBalancing || LoadBalancingStrategy.ROUND_ROBIN;
    const strategy = this.strategies.get(strategyName);
    
    if (!strategy) {
      throw new Error(`Unknown load balancing strategy: ${strategyName}`);
    }

    // Get or initialize service state
    const serviceKey = this.getServiceKey(service);
    if (!this.serviceStates.has(serviceKey)) {
      this.serviceStates.set(serviceKey, {
        strategy: strategyName,
        state: strategy.init(service)
      });
    }

    const serviceState = this.serviceStates.get(serviceKey);
    
    // Check if strategy changed
    if (serviceState.strategy !== strategyName) {
      serviceState.strategy = strategyName;
      serviceState.state = strategy.init(service);
    }

    // Filter healthy servers
    const healthyUrls = await this.getHealthyServers(service);
    if (healthyUrls.length === 0) {
      throw new Error('No healthy servers available');
    }

    // Update state with healthy servers
    const originalUrls = service.urls;
    service.urls = healthyUrls;
    
    try {
      // Select server using strategy
      const selectedUrl = strategy.select(serviceState.state, service, context);
      
      if (!selectedUrl) {
        throw new Error('Failed to select server');
      }
      
      return selectedUrl;
    } finally {
      // Restore original URLs
      service.urls = originalUrls;
    }
  }

  async getHealthyServers(service) {
    if (!service.healthCheck || !this.config.healthChecker) {
      // If no health checking, assume all servers are healthy
      return service.urls;
    }

    const healthyUrls = [];
    
    for (const url of service.urls) {
      const isHealthy = await this.config.healthChecker.isHealthy(url, service.healthCheck);
      if (isHealthy) {
        healthyUrls.push(url);
      }
    }

    return healthyUrls;
  }

  getServiceKey(service) {
    return service.service || service.urls.join(',');
  }

  hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash;
  }

  reset(service = null) {
    if (service) {
      const serviceKey = this.getServiceKey(service);
      this.serviceStates.delete(serviceKey);
    } else {
      this.serviceStates.clear();
    }
  }

  getMetrics() {
    const metrics = {
      strategies: Array.from(this.strategies.keys()),
      services: {}
    };

    for (const [key, state] of this.serviceStates) {
      metrics.services[key] = {
        strategy: state.strategy,
        state: { ...state.state }
      };
    }

    return metrics;
  }

  // Health check integration
  async markServerUnhealthy(service, url) {
    if (this.config.healthChecker) {
      await this.config.healthChecker.markUnhealthy(url);
    }
  }

  async markServerHealthy(service, url) {
    if (this.config.healthChecker) {
      await this.config.healthChecker.markHealthy(url);
    }
  }
}

module.exports = LoadBalancer;