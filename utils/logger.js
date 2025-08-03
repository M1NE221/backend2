const winston = require('winston');

const logLevel = process.env.LOG_LEVEL || 'info';

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.prettyPrint()
);

// Create logger instance
const logger = winston.createLogger({
  level: logLevel,
  format: logFormat,
  defaultMeta: { service: 'perla-ai-backend' },
  transports: [
    // Write all logs to console
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    
    // Write error logs to error.log
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    
    // Write all logs to combined.log
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ]
});

// Create logs directory if it doesn't exist
const fs = require('fs');
const path = require('path');
const logsDir = path.join(__dirname, '../logs');

if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Add request logging helper
logger.logRequest = (req, res, responseTime) => {
  logger.info('HTTP Request', {
    method: req.method,
    url: req.originalUrl,
    userAgent: req.get('User-Agent'),
    ip: req.ip,
    userId: req.user?.usuario_id,
    responseTime: `${responseTime}ms`,
    statusCode: res.statusCode
  });
};

// Add AI interaction logging
logger.logAIInteraction = (userId, input, output, processingTime, tokensUsed) => {
  logger.info('AI Interaction', {
    userId,
    inputLength: input.length,
    outputLength: output.length,
    processingTime: `${processingTime}ms`,
    tokensUsed,
    timestamp: new Date().toISOString()
  });
};

// Add database operation logging
logger.logDBOperation = (operation, table, userId, details = {}) => {
  logger.info('Database Operation', {
    operation,
    table,
    userId,
    details,
    timestamp: new Date().toISOString()
  });
};

module.exports = logger; 