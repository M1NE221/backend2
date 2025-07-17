const logger = require('../utils/logger');

/**
 * Global error handling middleware
 */
const errorHandler = (err, req, res, next) => {
  // Default error
  let error = {
    statusCode: err.statusCode || 500,
    message: err.message || 'Internal server error',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  };

  // Log error details
  logger.error('Application Error:', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.usuario_id,
    body: req.body,
    query: req.query,
    params: req.params
  });

  // Supabase errors
  if (err.code) {
    switch (err.code) {
      case '23505': // Unique violation
        error.statusCode = 409;
        error.message = 'Resource already exists';
        break;
      case '23503': // Foreign key violation
        error.statusCode = 400;
        error.message = 'Invalid reference to related resource';
        break;
      case '23502': // Not null violation
        error.statusCode = 400;
        error.message = 'Required field is missing';
        break;
      case 'PGRST116': // No rows found
        error.statusCode = 404;
        error.message = 'Resource not found';
        break;
      default:
        if (err.code.startsWith('23')) {
          error.statusCode = 400;
          error.message = 'Database constraint violation';
        }
    }
  }

  // OpenAI API errors
  if (err.type === 'insufficient_quota') {
    error.statusCode = 503;
    error.message = 'AI service temporarily unavailable';
  } else if (err.type === 'invalid_request_error') {
    error.statusCode = 400;
    error.message = 'Invalid AI request';
  } else if (err.status === 429) {
    error.statusCode = 429;
    error.message = 'AI service rate limit exceeded';
  }

  // Validation errors
  if (err.name === 'ValidationError') {
    error.statusCode = 400;
    error.message = 'Validation failed';
    error.details = err.details;
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    error.statusCode = 401;
    error.message = 'Invalid authentication token';
  } else if (err.name === 'TokenExpiredError') {
    error.statusCode = 401;
    error.message = 'Authentication token expired';
  }

  // Mongoose/Database connection errors
  if (err.name === 'MongoNetworkError' || err.name === 'MongooseServerSelectionError') {
    error.statusCode = 503;
    error.message = 'Database connection error';
  }

  // Syntax errors in JSON
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    error.statusCode = 400;
    error.message = 'Invalid JSON format';
  }

  // Rate limiting errors
  if (err.message && err.message.includes('Too many requests')) {
    error.statusCode = 429;
    error.message = 'Rate limit exceeded';
  }

  // File upload errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    error.statusCode = 413;
    error.message = 'File size too large';
  }

  // Network/timeout errors
  if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
    error.statusCode = 503;
    error.message = 'Service temporarily unavailable';
  }

  // Don't leak error details in production
  if (process.env.NODE_ENV === 'production') {
    // Only send generic message for 500 errors in production
    if (error.statusCode === 500) {
      error.message = 'Internal server error';
      delete error.stack;
    }
  }

  res.status(error.statusCode).json({
    success: false,
    error: {
      message: error.message,
      statusCode: error.statusCode,
      ...(error.details && { details: error.details }),
      ...(error.stack && { stack: error.stack })
    },
    timestamp: new Date().toISOString(),
    path: req.originalUrl
  });
};

/**
 * 404 Not Found handler
 */
const notFoundHandler = (req, res) => {
  const message = `Route ${req.originalUrl} not found`;
  
  logger.warn('404 - Route not found:', {
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  res.status(404).json({
    success: false,
    error: {
      message,
      statusCode: 404
    },
    timestamp: new Date().toISOString(),
    path: req.originalUrl
  });
};

/**
 * Async error wrapper
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

module.exports = {
  errorHandler,
  notFoundHandler,
  asyncHandler
}; 