const Joi = require('joi');

class ValidationMiddleware {
  constructor(config = {}) {
    this.config = config;
    this.defaultOptions = {
      abortEarly: false,
      stripUnknown: true,
      ...config.defaultOptions
    };
  }

  validate(request, validationConfig) {
    if (!validationConfig) {
      return { valid: true };
    }

    const errors = {};

    // Validate headers
    if (validationConfig.headers) {
      const result = this.validateSection(
        request.headers,
        validationConfig.headers,
        'headers'
      );
      if (!result.valid) {
        errors.headers = result.errors;
      }
    }

    // Validate query parameters
    if (validationConfig.query) {
      const result = this.validateSection(
        request.query || {},
        validationConfig.query,
        'query'
      );
      if (!result.valid) {
        errors.query = result.errors;
      }
    }

    // Validate path parameters
    if (validationConfig.params) {
      const result = this.validateSection(
        request.params || {},
        validationConfig.params,
        'params'
      );
      if (!result.valid) {
        errors.params = result.errors;
      }
    }

    // Validate request body
    if (validationConfig.body) {
      const result = this.validateSection(
        request.body,
        validationConfig.body,
        'body'
      );
      if (!result.valid) {
        errors.body = result.errors;
      }
    }

    // Check if there are any errors
    const hasErrors = Object.keys(errors).length > 0;

    return {
      valid: !hasErrors,
      errors: hasErrors ? errors : undefined,
      details: hasErrors ? this.formatErrors(errors) : undefined
    };
  }

  validateSection(data, schema, section) {
    try {
      // Handle both Joi schemas and plain objects
      const joiSchema = Joi.isSchema(schema) ? schema : Joi.object(schema);
      
      const options = {
        ...this.defaultOptions,
        ...schema.options
      };

      const result = joiSchema.validate(data, options);

      if (result.error) {
        return {
          valid: false,
          errors: this.extractErrors(result.error)
        };
      }

      // Update the data with validated/transformed values
      if (result.value !== undefined && options.stripUnknown) {
        Object.keys(data).forEach(key => delete data[key]);
        Object.assign(data, result.value);
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        errors: [{
          field: section,
          message: error.message
        }]
      };
    }
  }

  extractErrors(joiError) {
    return joiError.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message,
      type: detail.type,
      context: detail.context
    }));
  }

  formatErrors(errors) {
    const formatted = [];

    for (const [section, sectionErrors] of Object.entries(errors)) {
      for (const error of sectionErrors) {
        formatted.push({
          section,
          field: error.field,
          message: error.message,
          type: error.type
        });
      }
    }

    return formatted;
  }

  createMiddleware(validationConfig) {
    return (req, res, next) => {
      const result = this.validate(req, validationConfig);

      if (!result.valid) {
        return res.status(400).json({
          error: 'Validation failed',
          errors: result.errors,
          details: result.details
        });
      }

      next();
    };
  }

  // Common validation schemas
  static commonSchemas = {
    // UUID validation
    uuid: () => Joi.string().uuid(),

    // Email validation
    email: () => Joi.string().email(),

    // URL validation
    url: () => Joi.string().uri(),

    // Date validation
    date: () => Joi.date().iso(),

    // Pagination
    pagination: () => Joi.object({
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(100).default(20),
      sort: Joi.string(),
      order: Joi.string().valid('asc', 'desc').default('asc')
    }),

    // ID parameter
    idParam: () => Joi.object({
      id: Joi.alternatives().try(
        Joi.string().uuid(),
        Joi.number().integer().positive()
      ).required()
    }),

    // Search query
    searchQuery: () => Joi.object({
      q: Joi.string().min(1).max(200),
      fields: Joi.array().items(Joi.string()),
      filters: Joi.object()
    }),

    // API key header
    apiKeyHeader: () => Joi.object({
      'x-api-key': Joi.string().required()
    }).unknown(true),

    // Content type header
    contentTypeHeader: (types = ['application/json']) => Joi.object({
      'content-type': Joi.string().valid(...types).required()
    }).unknown(true)
  };

  // Validation builders
  static builders = {
    // Create a required string field
    requiredString: (min = 1, max = 255) => 
      Joi.string().min(min).max(max).required(),

    // Create an optional string field
    optionalString: (min = 1, max = 255) => 
      Joi.string().min(min).max(max).optional(),

    // Create an enum field
    enum: (values, required = true) => {
      const schema = Joi.string().valid(...values);
      return required ? schema.required() : schema.optional();
    },

    // Create a number range field
    numberRange: (min, max, required = true) => {
      const schema = Joi.number().min(min).max(max);
      return required ? schema.required() : schema.optional();
    },

    // Create an array field
    array: (itemSchema, min = 0, max = 100) => 
      Joi.array().items(itemSchema).min(min).max(max),

    // Create a conditional schema
    conditional: (field, value, thenSchema, elseSchema) =>
      Joi.when(field, {
        is: value,
        then: thenSchema,
        otherwise: elseSchema
      })
  };

  // Async validation support
  async validateAsync(request, validationConfig) {
    if (!validationConfig) {
      return { valid: true };
    }

    const errors = {};

    // Process async validators
    const validators = [];

    if (validationConfig.custom) {
      for (const [name, validator] of Object.entries(validationConfig.custom)) {
        validators.push(
          validator(request).then(result => {
            if (!result.valid) {
              errors[name] = result.errors;
            }
          }).catch(error => {
            errors[name] = [{
              message: error.message || 'Validation failed'
            }];
          })
        );
      }
    }

    // Wait for all async validations
    await Promise.all(validators);

    // Run standard validation
    const syncResult = this.validate(request, validationConfig);
    
    if (!syncResult.valid) {
      Object.assign(errors, syncResult.errors);
    }

    const hasErrors = Object.keys(errors).length > 0;

    return {
      valid: !hasErrors,
      errors: hasErrors ? errors : undefined
    };
  }

  // Sanitization support
  sanitize(data, sanitizationRules) {
    if (!sanitizationRules) {
      return data;
    }

    const sanitized = { ...data };

    for (const [field, rules] of Object.entries(sanitizationRules)) {
      if (!(field in sanitized)) {
        continue;
      }

      let value = sanitized[field];

      // Apply sanitization rules
      if (rules.trim && typeof value === 'string') {
        value = value.trim();
      }

      if (rules.lowercase && typeof value === 'string') {
        value = value.toLowerCase();
      }

      if (rules.uppercase && typeof value === 'string') {
        value = value.toUpperCase();
      }

      if (rules.escape && typeof value === 'string') {
        // Basic HTML escaping
        value = value
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      }

      if (rules.default !== undefined && (value === null || value === undefined)) {
        value = rules.default;
      }

      if (rules.transform && typeof rules.transform === 'function') {
        value = rules.transform(value);
      }

      sanitized[field] = value;
    }

    return sanitized;
  }
}

module.exports = ValidationMiddleware;