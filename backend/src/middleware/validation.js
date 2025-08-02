const Joi = require('joi');
const { ApiError } = require('./errorHandler');

const validate = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body);
    if (error) {
      const message = error.details[0].message;
      return next(new ApiError(400, message));
    }
    next();
  };
};

// Validation schemas
const schemas = {
  // Auth schemas
  signup: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(8).required()
      .pattern(new RegExp('^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])'))
      .message('Password must contain at least one uppercase letter, one lowercase letter, and one number'),
  }),

  login: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required(),
  }),

  // Settings schemas
  updateSettings: Joi.object({
    low_stock_threshold: Joi.number().integer().min(1).optional(),
    alert_email_enabled: Joi.boolean().optional(),
    time_zone: Joi.string().optional(),
  }),

  // Alert schemas
  testAlert: Joi.object({
    product_id: Joi.string().uuid().required(),
  }),

  // Shopify schemas
  shopifyAuth: Joi.object({
    shop: Joi.string()
      .pattern(/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/)
      .required()
      .messages({
        'string.pattern.base': 'Shop must be a valid Shopify domain ending with .myshopify.com'
      }),
  }),
};

// Shopify-specific validation middleware
const validateShopifyAuth = validate(schemas.shopifyAuth);

module.exports = {
  validate,
  schemas,
  validateShopifyAuth,
};