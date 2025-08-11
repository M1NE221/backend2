const express = require('express');
const { body, validationResult } = require('express-validator');
const aiService = require('../services/aiService');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * POST /api/conversation
 * Main conversation endpoint - processes user input and returns AI response
 */
router.post(
  '/',
  [
    body('message')
      .notEmpty()
      .withMessage('Message is required')
      .isLength({ min: 1, max: 5000 })
      .withMessage('Message must be between 1 and 5000 characters'),
    body('context')
      .optional()
      .isArray()
      .withMessage('Context must be an array'),
    body('context.*.role')
      .optional()
      .isIn(['user', 'assistant'])
      .withMessage('Context role must be user or assistant'),
    body('context.*.content')
      .optional()
      .notEmpty()
      .withMessage('Context content cannot be empty')
  ],
  asyncHandler(async (req, res) => {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { message, context = [] } = req.body;
    const userId = req.user.usuario_id;

    // Debug token information
    const tokenParts = req.userToken ? req.userToken.split('.').length : 0;
    
    // Log conversation start with token debugging
    logger.info('Conversation started:', {
      userId,
      messageLength: message.length,
      contextLength: context.length,
      hasToken: !!req.userToken,
      tokenParts,
      tokenPrefix: req.userToken ? req.userToken.substring(0, 20) + '...' : 'none'
    });

    // Validate token format before processing
    if (req.userToken && tokenParts !== 3) {
      logger.error('Invalid JWT token format:', {
        userId,
        tokenParts,
        tokenLength: req.userToken.length,
        tokenSample: req.userToken.substring(0, 50) + '...'
      });
      return res.status(500).json({
        success: false,
        error: 'Invalid authentication token format',
        message: 'JWT token must have 3 parts separated by dots'
      });
    }

    try {
      // Process conversation with AI service (pass user token for RLS)
      const result = await aiService.processConversation(message, userId, context, req.userToken);

      // Return response
      res.json({
        success: true,
        data: {
          response: result.response,
          dataExtracted: result.dataExtracted,
          processingTime: result.processingTime,
          tokensUsed: result.tokensUsed,
          lastSaleId: result.lastSaleId,
          context: result.context
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Conversation processing failed:', {
        userId,
        error: error.message,
        stack: error.stack
      });

      res.status(500).json({
        success: false,
        error: 'Failed to process conversation',
        message: error.message
      });
    }
  })
);

/**
 * POST /api/conversation/insights
 * Generate business insights for the user
 */
router.post(
  '/insights',
  [
    body('timeframe')
      .optional()
      .isIn(['7 days', '30 days', '90 days', '1 year'])
      .withMessage('Invalid timeframe')
  ],
  asyncHandler(async (req, res) => {
    const { timeframe = '30 days' } = req.body;
    const userId = req.user.usuario_id;

    try {
      const insights = await aiService.generateInsights(userId, timeframe);

      res.json({
        success: true,
        data: {
          insights,
          timeframe,
          generatedAt: new Date().toISOString()
        }
      });

    } catch (error) {
      logger.error('Failed to generate insights:', {
        userId,
        timeframe,
        error: error.message
      });

      res.status(500).json({
        success: false,
        error: 'Failed to generate insights',
        message: error.message
      });
    }
  })
);

/**
 * GET /api/conversation/context
 * Get recent conversation context for continuity
 */
router.get(
  '/context',
  asyncHandler(async (req, res) => {
    const userId = req.user.usuario_id;
    const limit = parseInt(req.query.limit) || 10;

    try {
      // For now, return empty context - you could implement conversation storage here
      // This would involve storing conversation history in a separate table
      res.json({
        success: true,
        data: {
          context: [],
          userId,
          limit
        }
      });

    } catch (error) {
      logger.error('Failed to get conversation context:', {
        userId,
        error: error.message
      });

      res.status(500).json({
        success: false,
        error: 'Failed to get conversation context'
      });
    }
  })
);

module.exports = router; 