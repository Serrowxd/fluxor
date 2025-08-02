/**
 * Custom error classes for the application
 */

class ShopifyError extends Error {
  constructor(message, code, details = null) {
    super(message);
    this.name = 'ShopifyError';
    this.code = code;
    this.details = details;
    this.statusCode = this.getStatusCode(code);
  }

  getStatusCode(code) {
    const statusCodes = {
      'INVALID_SHOP_DOMAIN': 400,
      'OAUTH_PARAMS_MISSING': 400,
      'INVALID_HMAC': 401,
      'INVALID_STATE': 401,
      'SHOP_MISMATCH': 400,
      'TOKEN_EXCHANGE_FAILED': 500,
      'TOKEN_STORAGE_FAILED': 500,
      'TOKEN_NOT_FOUND': 404,
      'TOKEN_RETRIEVAL_FAILED': 500,
      'TOKEN_REVOCATION_FAILED': 500,
      'RATE_LIMIT_EXCEEDED': 429,
      'WEBHOOK_VALIDATION_FAILED': 401,
      'INSUFFICIENT_PERMISSIONS': 403
    };
    return statusCodes[code] || 500;
  }
}

class ValidationError extends Error {
  constructor(message, field = null) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
    this.statusCode = 400;
  }
}

class AuthenticationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthenticationError';
    this.statusCode = 401;
  }
}

class AuthorizationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthorizationError';
    this.statusCode = 403;
  }
}

class NotFoundError extends Error {
  constructor(message, resource = null) {
    super(message);
    this.name = 'NotFoundError';
    this.resource = resource;
    this.statusCode = 404;
  }
}

class ConflictError extends Error {
  constructor(message, conflictingResource = null) {
    super(message);
    this.name = 'ConflictError';
    this.conflictingResource = conflictingResource;
    this.statusCode = 409;
  }
}

class RateLimitError extends Error {
  constructor(message, retryAfter = null) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
    this.statusCode = 429;
  }
}

module.exports = {
  ShopifyError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError
};