const { createClient } = require('@supabase/supabase-js');
const { supabase, supabaseAdmin } = require('../config/database');
const logger = require('../utils/logger');

/**
 * Middleware to validate authentication and extract user info
 */
const validateAuth = async (req, res, next) => {
  try {
    // Check for Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Please provide a valid Bearer token'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify token with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      logger.warn('Invalid authentication token attempt:', {
        error: error?.message,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      return res.status(401).json({
        error: 'Invalid token',
        message: 'Authentication token is invalid or expired'
      });
    }

    // Get user business data using service role (bypasses RLS)
    const { data: userData, error: userError } = await supabaseAdmin
      .from('Usuarios')
      .select('*')
      .eq('usuario_id', user.id)  // Use auth user ID from validated token
      .single();

    if (userError) {
      logger.error('Failed to fetch user data:', userError);
      return res.status(500).json({
        error: 'User data error',
        message: 'Failed to retrieve user information'
      });
    }

    if (!userData) {
      // User exists in auth but not in our business table
      return res.status(403).json({
        error: 'User not found',
        message: 'User account not properly configured'
      });
    }

    // Attach user info and token to request
    req.user = {
      ...userData,
      auth_id: user.id,
      email: user.email
    };
    req.userToken = token; // Preserve JWT token for user ID extraction

    next();

  } catch (error) {
    logger.error('Authentication middleware error:', error);
    res.status(500).json({
      error: 'Authentication error',
      message: 'Internal authentication error'
    });
  }
};

/**
 * Optional authentication - doesn't fail if no token provided
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.user = null;
      return next();
    }

    // If token provided, validate it
    await validateAuth(req, res, next);
    
  } catch (error) {
    // If optional auth fails, continue without user
    req.user = null;
    next();
  }
};

/**
 * Middleware to check if user owns a resource
 */
const checkResourceOwnership = (resourceUserIdField = 'usuario_id') => {
  return (req, res, next) => {
    const resourceUserId = req.params[resourceUserIdField] || req.body[resourceUserIdField];
    
    if (!resourceUserId) {
      return res.status(400).json({
        error: 'Missing user ID',
        message: 'Resource user ID is required'
      });
    }

    if (req.user.usuario_id !== resourceUserId) {
      logger.warn('Unauthorized resource access attempt:', {
        userId: req.user.usuario_id,
        attemptedResource: resourceUserId,
        ip: req.ip
      });
      
      return res.status(403).json({
        error: 'Access denied',
        message: 'You can only access your own resources'
      });
    }

    next();
  };
};

module.exports = {
  validateAuth,
  optionalAuth,
  checkResourceOwnership
}; 