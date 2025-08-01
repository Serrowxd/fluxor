class ChannelAdapterRegistry {
  constructor() {
    this.adapters = new Map();
  }

  register(type, AdapterClass) {
    if (!type || typeof type !== 'string') {
      throw new Error('Adapter type must be a non-empty string');
    }

    if (typeof AdapterClass !== 'function') {
      throw new Error('Adapter must be a class or constructor function');
    }

    this.adapters.set(type.toLowerCase(), AdapterClass);
  }

  get(type) {
    if (!type) return null;
    return this.adapters.get(type.toLowerCase());
  }

  has(type) {
    if (!type) return false;
    return this.adapters.has(type.toLowerCase());
  }

  list() {
    return Array.from(this.adapters.keys());
  }

  clear() {
    this.adapters.clear();
  }
}

module.exports = ChannelAdapterRegistry;