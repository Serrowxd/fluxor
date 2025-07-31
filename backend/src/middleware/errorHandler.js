const errorHandler = (err, req, res, next) => {
  console.error(err.stack);

  // Default error
  let status = err.status || 500;
  let message = err.message || 'Internal Server Error';

  // Validation errors
  if (err.name === 'ValidationError') {
    status = 400;
    message = 'Validation Error';
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    status = 401;
    message = 'Invalid token';
  }

  if (err.name === 'TokenExpiredError') {
    status = 401;
    message = 'Token expired';
  }

  // PostgreSQL errors
  if (err.code === '23505') {
    status = 409;
    message = 'Duplicate entry';
  }

  if (err.code === '23503') {
    status = 400;
    message = 'Foreign key constraint violation';
  }

  res.status(status).json({
    error: {
      message,
      status,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    },
  });
};

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = {
  errorHandler,
  ApiError,
};