const jsonpath = require('jsonpath');
const _ = require('lodash');

class ResponseTransformer {
  constructor(config = {}) {
    this.config = config;
    this.customTransformers = new Map();
    
    // Register default transformers
    this.registerDefaultTransformers();
  }

  registerDefaultTransformers() {
    // Add response header
    this.registerTransformer('addHeader', (response, rule) => {
      if (!response.headers) response.headers = {};
      response.headers[rule.target] = this.resolveValue(rule.value, response);
    });

    // Remove response header
    this.registerTransformer('removeHeader', (response, rule) => {
      if (response.headers) {
        delete response.headers[rule.target];
      }
    });

    // Set status code
    this.registerTransformer('setStatus', (response, rule) => {
      response.statusCode = rule.value;
    });

    // Transform response body
    this.registerTransformer('transformBody', (response, rule) => {
      if (response.body && typeof response.body === 'object') {
        if (rule.mapping) {
          response.body = this.applyMapping(response.body, rule.mapping);
        }
      }
    });

    // Filter response fields
    this.registerTransformer('filterFields', (response, rule) => {
      if (response.body && typeof response.body === 'object') {
        if (rule.include) {
          response.body = _.pick(response.body, rule.include);
        } else if (rule.exclude) {
          response.body = _.omit(response.body, rule.exclude);
        }
      }
    });

    // Rename fields
    this.registerTransformer('renameFields', (response, rule) => {
      if (response.body && typeof response.body === 'object' && rule.mapping) {
        const renamed = {};
        
        for (const [oldKey, newKey] of Object.entries(rule.mapping)) {
          const value = _.get(response.body, oldKey);
          if (value !== undefined) {
            _.set(renamed, newKey, value);
          }
        }
        
        // Merge with fields not in mapping
        for (const [key, value] of Object.entries(response.body)) {
          if (!rule.mapping[key] && !Object.values(rule.mapping).includes(key)) {
            renamed[key] = value;
          }
        }
        
        response.body = renamed;
      }
    });

    // Wrap response
    this.registerTransformer('wrapResponse', (response, rule) => {
      if (rule.wrapper) {
        const wrapped = {};
        _.set(wrapped, rule.wrapper, response.body);
        
        // Add metadata if specified
        if (rule.metadata) {
          for (const [key, value] of Object.entries(rule.metadata)) {
            _.set(wrapped, key, this.resolveValue(value, response));
          }
        }
        
        response.body = wrapped;
      }
    });

    // Unwrap response
    this.registerTransformer('unwrapResponse', (response, rule) => {
      if (response.body && typeof response.body === 'object' && rule.path) {
        const unwrapped = _.get(response.body, rule.path);
        if (unwrapped !== undefined) {
          response.body = unwrapped;
        }
      }
    });

    // Pagination transformation
    this.registerTransformer('transformPagination', (response, rule) => {
      if (response.body && typeof response.body === 'object') {
        const transformed = {
          data: _.get(response.body, rule.dataPath || 'data', []),
          pagination: {}
        };
        
        // Map pagination fields
        const paginationMapping = rule.mapping || {
          total: 'total',
          page: 'page',
          pageSize: 'pageSize',
          totalPages: 'totalPages'
        };
        
        for (const [key, path] of Object.entries(paginationMapping)) {
          const value = _.get(response.body, path);
          if (value !== undefined) {
            transformed.pagination[key] = value;
          }
        }
        
        response.body = transformed;
      }
    });

    // Error transformation
    this.registerTransformer('transformError', (response, rule) => {
      if (response.statusCode >= 400 && response.body) {
        const error = {
          error: true,
          code: rule.code || 'ERROR',
          message: _.get(response.body, rule.messagePath || 'message', 'An error occurred'),
          details: rule.includeDetails ? response.body : undefined,
          timestamp: new Date().toISOString()
        };
        
        response.body = error;
      }
    });

    // JSONPath query
    this.registerTransformer('jsonpathQuery', (response, rule) => {
      if (response.body && typeof response.body === 'object') {
        const results = jsonpath.query(response.body, rule.query);
        
        if (rule.target) {
          _.set(response.body, rule.target, results);
        } else {
          response.body = results;
        }
      }
    });

    // Template response
    this.registerTransformer('template', (response, rule) => {
      if (rule.template) {
        const rendered = this.renderTemplate(rule.template, {
          response: response.body,
          status: response.statusCode,
          headers: response.headers
        });
        
        try {
          response.body = JSON.parse(rendered);
        } catch (e) {
          response.body = rendered;
        }
      }
    });

    // Aggregate responses (for batch operations)
    this.registerTransformer('aggregate', (response, rule) => {
      if (Array.isArray(response.body) && rule.aggregation) {
        const aggregated = {};
        
        for (const [key, config] of Object.entries(rule.aggregation)) {
          switch (config.type) {
            case 'sum':
              aggregated[key] = response.body.reduce((sum, item) => 
                sum + (_.get(item, config.field) || 0), 0
              );
              break;
              
            case 'average':
              const values = response.body.map(item => _.get(item, config.field) || 0);
              aggregated[key] = values.reduce((a, b) => a + b, 0) / values.length;
              break;
              
            case 'count':
              aggregated[key] = response.body.length;
              break;
              
            case 'min':
              aggregated[key] = Math.min(...response.body.map(item => 
                _.get(item, config.field) || Infinity
              ));
              break;
              
            case 'max':
              aggregated[key] = Math.max(...response.body.map(item => 
                _.get(item, config.field) || -Infinity
              ));
              break;
          }
        }
        
        if (rule.includeOriginal) {
          response.body = {
            data: response.body,
            aggregations: aggregated
          };
        } else {
          response.body = aggregated;
        }
      }
    });

    // Cache control headers
    this.registerTransformer('setCacheControl', (response, rule) => {
      if (!response.headers) response.headers = {};
      
      const directives = [];
      
      if (rule.public) directives.push('public');
      if (rule.private) directives.push('private');
      if (rule.noCache) directives.push('no-cache');
      if (rule.noStore) directives.push('no-store');
      if (rule.mustRevalidate) directives.push('must-revalidate');
      if (rule.maxAge !== undefined) directives.push(`max-age=${rule.maxAge}`);
      if (rule.sMaxAge !== undefined) directives.push(`s-maxage=${rule.sMaxAge}`);
      
      response.headers['Cache-Control'] = directives.join(', ');
    });
  }

  registerTransformer(name, transformer) {
    this.customTransformers.set(name, transformer);
  }

  async transform(response, transformations) {
    if (!transformations || !transformations.response) {
      return response;
    }

    const transformedResponse = this.cloneResponse(response);

    for (const rule of transformations.response) {
      await this.applyTransformation(transformedResponse, rule);
    }

    return transformedResponse;
  }

  async applyTransformation(response, rule) {
    // Check condition if present
    if (rule.condition && !this.evaluateCondition(rule.condition, response)) {
      return;
    }

    const transformer = this.customTransformers.get(rule.action);
    if (!transformer) {
      console.warn(`Unknown transformation action: ${rule.action}`);
      return;
    }

    try {
      await transformer.call(this, response, rule);
    } catch (error) {
      console.error(`Transformation error (${rule.action}):`, error);
      if (this.config.throwOnError) {
        throw error;
      }
    }
  }

  applyMapping(data, mapping) {
    const result = {};
    
    for (const [targetPath, sourceConfig] of Object.entries(mapping)) {
      let value;
      
      if (typeof sourceConfig === 'string') {
        // Simple path mapping
        value = _.get(data, sourceConfig);
      } else if (typeof sourceConfig === 'object') {
        // Complex mapping
        if (sourceConfig.path) {
          value = _.get(data, sourceConfig.path);
        } else if (sourceConfig.value !== undefined) {
          value = sourceConfig.value;
        } else if (sourceConfig.template) {
          value = this.renderTemplate(sourceConfig.template, data);
        }
        
        // Apply transformation
        if (value !== undefined && sourceConfig.transform) {
          value = this.applyTransform(value, sourceConfig.transform);
        }
        
        // Apply default
        if (value === undefined && sourceConfig.default !== undefined) {
          value = sourceConfig.default;
        }
      }
      
      if (value !== undefined) {
        _.set(result, targetPath, value);
      }
    }
    
    return result;
  }

  resolveValue(value, response) {
    if (typeof value === 'string') {
      // Check if it's a reference
      if (value.startsWith('${') && value.endsWith('}')) {
        const path = value.slice(2, -1);
        return _.get(response, path);
      }
      
      // Check if it contains template variables
      if (value.includes('${')) {
        return this.renderTemplate(value, response);
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

  evaluateCondition(condition, response) {
    if (typeof condition === 'object') {
      const { statusCode, hasField, header } = condition;
      
      if (statusCode) {
        if (typeof statusCode === 'number') {
          return response.statusCode === statusCode;
        }
        if (statusCode.min && response.statusCode < statusCode.min) {
          return false;
        }
        if (statusCode.max && response.statusCode > statusCode.max) {
          return false;
        }
      }
      
      if (hasField) {
        return _.has(response.body, hasField);
      }
      
      if (header) {
        const headerValue = response.headers?.[header.name];
        if (header.value) {
          return headerValue === header.value;
        }
        return headerValue !== undefined;
      }
    }
    
    return true;
  }

  applyTransform(value, transform) {
    // Same as RequestTransformer
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

  cloneResponse(response) {
    return {
      statusCode: response.statusCode,
      headers: response.headers ? { ...response.headers } : {},
      body: response.body ? _.cloneDeep(response.body) : undefined
    };
  }
}

module.exports = ResponseTransformer;