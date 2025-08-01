const jsonpath = require('jsonpath');
const _ = require('lodash');

class RequestTransformer {
  constructor(config = {}) {
    this.config = config;
    this.customTransformers = new Map();
    
    // Register default transformers
    this.registerDefaultTransformers();
  }

  registerDefaultTransformers() {
    // Add header
    this.registerTransformer('addHeader', (request, rule) => {
      request.headers[rule.target] = this.resolveValue(rule.value, request);
    });

    // Remove header
    this.registerTransformer('removeHeader', (request, rule) => {
      delete request.headers[rule.target];
    });

    // Rename header
    this.registerTransformer('renameHeader', (request, rule) => {
      if (request.headers[rule.source]) {
        request.headers[rule.target] = request.headers[rule.source];
        delete request.headers[rule.source];
      }
    });

    // Add query parameter
    this.registerTransformer('addQuery', (request, rule) => {
      if (!request.query) request.query = {};
      request.query[rule.target] = this.resolveValue(rule.value, request);
    });

    // Remove query parameter
    this.registerTransformer('removeQuery', (request, rule) => {
      if (request.query) {
        delete request.query[rule.target];
      }
    });

    // Add body field
    this.registerTransformer('addBodyField', (request, rule) => {
      if (request.body && typeof request.body === 'object') {
        _.set(request.body, rule.target, this.resolveValue(rule.value, request));
      }
    });

    // Remove body field
    this.registerTransformer('removeBodyField', (request, rule) => {
      if (request.body && typeof request.body === 'object') {
        _.unset(request.body, rule.target);
      }
    });

    // Rename body field
    this.registerTransformer('renameBodyField', (request, rule) => {
      if (request.body && typeof request.body === 'object') {
        const value = _.get(request.body, rule.source);
        if (value !== undefined) {
          _.set(request.body, rule.target, value);
          _.unset(request.body, rule.source);
        }
      }
    });

    // Transform body using JSONPath
    this.registerTransformer('jsonpathTransform', (request, rule) => {
      if (request.body && typeof request.body === 'object') {
        const matches = jsonpath.query(request.body, rule.source);
        if (matches.length > 0) {
          const transformedValue = rule.transform 
            ? this.applyTransform(matches[0], rule.transform)
            : matches[0];
          
          if (rule.target) {
            _.set(request.body, rule.target, transformedValue);
          }
        }
      }
    });

    // Replace path parameter
    this.registerTransformer('replacePathParam', (request, rule) => {
      if (request.params && request.params[rule.source]) {
        request.params[rule.target] = request.params[rule.source];
        if (rule.source !== rule.target) {
          delete request.params[rule.source];
        }
      }
    });

    // Set method
    this.registerTransformer('setMethod', (request, rule) => {
      request.method = rule.value;
    });

    // Set path
    this.registerTransformer('setPath', (request, rule) => {
      request.path = this.resolveValue(rule.value, request);
    });

    // Base64 encode/decode
    this.registerTransformer('base64Encode', (request, rule) => {
      const value = _.get(request, rule.source);
      if (value) {
        const encoded = Buffer.from(value).toString('base64');
        _.set(request, rule.target || rule.source, encoded);
      }
    });

    this.registerTransformer('base64Decode', (request, rule) => {
      const value = _.get(request, rule.source);
      if (value) {
        const decoded = Buffer.from(value, 'base64').toString('utf8');
        _.set(request, rule.target || rule.source, decoded);
      }
    });

    // Template transformation
    this.registerTransformer('template', (request, rule) => {
      const rendered = this.renderTemplate(rule.template, request);
      _.set(request, rule.target, rendered);
    });

    // Conditional transformation
    this.registerTransformer('conditional', (request, rule) => {
      if (this.evaluateCondition(rule.condition, request)) {
        this.applyTransformation(request, rule.then);
      } else if (rule.else) {
        this.applyTransformation(request, rule.else);
      }
    });
  }

  registerTransformer(name, transformer) {
    this.customTransformers.set(name, transformer);
  }

  async transform(request, transformations) {
    if (!transformations || !transformations.request) {
      return request;
    }

    const transformedRequest = this.cloneRequest(request);

    for (const rule of transformations.request) {
      await this.applyTransformation(transformedRequest, rule);
    }

    return transformedRequest;
  }

  async applyTransformation(request, rule) {
    // Check condition if present
    if (rule.condition && !this.evaluateCondition(rule.condition, request)) {
      return;
    }

    const transformer = this.customTransformers.get(rule.action);
    if (!transformer) {
      console.warn(`Unknown transformation action: ${rule.action}`);
      return;
    }

    try {
      await transformer.call(this, request, rule);
    } catch (error) {
      console.error(`Transformation error (${rule.action}):`, error);
      if (this.config.throwOnError) {
        throw error;
      }
    }
  }

  resolveValue(value, request) {
    if (typeof value === 'string') {
      // Check if it's a reference
      if (value.startsWith('${') && value.endsWith('}')) {
        const path = value.slice(2, -1);
        return _.get(request, path);
      }
      
      // Check if it contains template variables
      if (value.includes('${')) {
        return this.renderTemplate(value, request);
      }
    }
    
    return value;
  }

  renderTemplate(template, context) {
    return template.replace(/\${([^}]+)}/g, (match, path) => {
      const value = _.get(context, path);
      return value !== undefined ? value : match;
    });
  }

  evaluateCondition(condition, request) {
    if (typeof condition === 'string') {
      // Simple path evaluation
      return !!_.get(request, condition);
    }

    if (typeof condition === 'object') {
      const { path, operator, value } = condition;
      const actualValue = _.get(request, path);
      
      switch (operator) {
        case 'equals':
        case '==':
          return actualValue == value;
        
        case 'strictEquals':
        case '===':
          return actualValue === value;
        
        case 'notEquals':
        case '!=':
          return actualValue != value;
        
        case 'contains':
          return String(actualValue).includes(value);
        
        case 'startsWith':
          return String(actualValue).startsWith(value);
        
        case 'endsWith':
          return String(actualValue).endsWith(value);
        
        case 'matches':
          return new RegExp(value).test(String(actualValue));
        
        case 'in':
          return Array.isArray(value) && value.includes(actualValue);
        
        case 'exists':
          return actualValue !== undefined;
        
        case 'notExists':
          return actualValue === undefined;
        
        case 'greaterThan':
        case '>':
          return Number(actualValue) > Number(value);
        
        case 'lessThan':
        case '<':
          return Number(actualValue) < Number(value);
        
        case 'and':
          return value.every(subCondition => 
            this.evaluateCondition(subCondition, request)
          );
        
        case 'or':
          return value.some(subCondition => 
            this.evaluateCondition(subCondition, request)
          );
        
        default:
          console.warn(`Unknown condition operator: ${operator}`);
          return false;
      }
    }

    return false;
  }

  applyTransform(value, transform) {
    switch (transform) {
      case 'uppercase':
        return String(value).toUpperCase();
      
      case 'lowercase':
        return String(value).toLowerCase();
      
      case 'trim':
        return String(value).trim();
      
      case 'number':
        return Number(value);
      
      case 'string':
        return String(value);
      
      case 'boolean':
        return Boolean(value);
      
      case 'json':
        return typeof value === 'string' ? JSON.parse(value) : value;
      
      case 'stringify':
        return JSON.stringify(value);
      
      default:
        if (typeof transform === 'function') {
          return transform(value);
        }
        return value;
    }
  }

  cloneRequest(request) {
    return {
      method: request.method,
      path: request.path,
      headers: { ...request.headers },
      query: request.query ? { ...request.query } : undefined,
      params: request.params ? { ...request.params } : undefined,
      body: request.body ? _.cloneDeep(request.body) : undefined,
      ..._.pick(request, ['host', 'protocol', 'originalUrl', 'baseUrl'])
    };
  }

  validateTransformations(transformations) {
    if (!transformations || !Array.isArray(transformations)) {
      return { valid: false, error: 'Transformations must be an array' };
    }

    for (const rule of transformations) {
      if (!rule.action) {
        return { valid: false, error: 'Transformation rule must have an action' };
      }

      if (!this.customTransformers.has(rule.action)) {
        return { valid: false, error: `Unknown transformation action: ${rule.action}` };
      }
    }

    return { valid: true };
  }
}

module.exports = RequestTransformer;