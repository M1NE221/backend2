const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabase } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token
 */
router.post(
  '/refresh',
  [
    body('refresh_token')
      .notEmpty()
      .withMessage('Refresh token is required')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { refresh_token } = req.body;

    try {
      // Refresh the session using Supabase
      const { data: authData, error: refreshError } = await supabase.auth.refreshSession({
        refresh_token
      });

      if (refreshError) {
        logger.warn('Token refresh failed:', {
          error: refreshError.message,
          refreshTokenPrefix: refresh_token ? refresh_token.substring(0, 20) + '...' : 'none'
        });

        return res.status(401).json({
          success: false,
          error: 'Invalid refresh token',
          message: 'The provided refresh token is invalid or expired'
        });
      }

      if (!authData.session) {
        logger.error('Token refresh succeeded but no session returned');
        return res.status(500).json({
          success: false,
          error: 'Refresh failed',
          message: 'Failed to refresh session'
        });
      }

      logger.info('Token refresh successful:', {
        userId: authData.user?.id,
        email: authData.user?.email,
        expiresAt: authData.session.expires_at
      });

      // Return new tokens
      res.json({
        success: true,
        access_token: authData.session.access_token,
        refresh_token: authData.session.refresh_token,
        expires_at: authData.session.expires_at,
        expires_in: authData.session.expires_in,
        user: {
          id: authData.user.id,
          email: authData.user.email
        }
      });

    } catch (error) {
      logger.error('Token refresh error:', {
        error: error.message,
        stack: error.stack
      });

      res.status(500).json({
        success: false,
        error: 'Refresh failed',
        message: 'An error occurred while refreshing the token'
      });
    }
  })
);

module.exports = router; 