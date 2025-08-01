class BaseAdapter {
  constructor(config) {
    this.config = config;
    this.connected = false;
    this.client = null;
  }

  async connect() {
    throw new Error('connect() method must be implemented by adapter');
  }

  async disconnect() {
    throw new Error('disconnect() method must be implemented by adapter');
  }

  async checkHealth() {
    throw new Error('checkHealth() method must be implemented by adapter');
  }

  async fetchResources(resource, options) {
    throw new Error('fetchResources() method must be implemented by adapter');
  }

  async createResource(resource, data) {
    throw new Error('createResource() method must be implemented by adapter');
  }

  async updateResource(resource, id, data) {
    throw new Error('updateResource() method must be implemented by adapter');
  }

  async deleteResource(resource, id) {
    throw new Error('deleteResource() method must be implemented by adapter');
  }

  async setupWebhooks(webhookUrl) {
    throw new Error('setupWebhooks() method must be implemented by adapter');
  }

  async removeWebhooks() {
    throw new Error('removeWebhooks() method must be implemented by adapter');
  }

  validateConfig() {
    throw new Error('validateConfig() method must be implemented by adapter');
  }

  normalizeError(error) {
    return {
      code: error.code || 'UNKNOWN_ERROR',
      message: error.message || 'An unknown error occurred',
      details: error.response?.data || error.details || {},
      statusCode: error.response?.status || error.statusCode || 500
    };
  }

  async retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
    let lastError;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        
        if (attempt < maxRetries - 1) {
          const delay = baseDelay * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError;
  }
}

module.exports = BaseAdapter;