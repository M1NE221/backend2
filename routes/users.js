const express = require('express');
const { body, validationResult } = require('express-validator');
const { createClient } = require('@supabase/supabase-js');
const { supabase, supabaseAdmin, dbHelpers } = require('../config/database');
const { validateAuth, optionalAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

/**
 * POST /api/users/register
 * Register a new user and create business profile
 */
router.post(
  '/register',
  [
    body('email')
      .isEmail()
      .normalizeEmail()
      .withMessage('Valid email is required'),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters long'),
    body('nombre_negocio')
      .notEmpty()
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage('Business name must be between 2 and 100 characters')
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

    const { email, password, nombre_negocio } = req.body;

    try {
      // Create user in Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password
      });

      if (authError) {
        if (authError.message.includes('already registered')) {
          return res.status(409).json({
            success: false,
            error: 'User already exists',
            message: 'Email is already registered'
          });
        }
        throw authError;
      }

      // Create business profile in our database (requires service_role for RLS)
      const userId = uuidv4();
      const { data: userData, error: dbError } = await supabaseAdmin
        .from('Usuarios')
        .insert({
          usuario_id: userId,
          email,
          nombre_negocio,
          creado_en: new Date().toISOString()
        })
        .select()
        .single();

      if (dbError) throw dbError;

      logger.info('New user registered:', {
        userId,
        email,
        businessName: nombre_negocio
      });

      res.status(201).json({
        success: true,
        data: {
          user: {
            usuario_id: userData.usuario_id,
            email: userData.email,
            nombre_negocio: userData.nombre_negocio,
            creado_en: userData.creado_en
          },
          message: 'User registered successfully'
        }
      });

    } catch (error) {
      logger.error('User registration failed:', {
        email,
        error: error.message
      });

      res.status(500).json({
        success: false,
        error: 'Registration failed',
        message: error.message
      });
    }
  })
);

/**
 * POST /api/users/login
 * Authenticate user and return session
 */
router.post(
  '/login',
  [
    body('email')
      .isEmail()
      .normalizeEmail()
      .withMessage('Valid email is required'),
    body('password')
      .notEmpty()
      .withMessage('Password is required')
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

    const { email, password } = req.body;

    try {
      // Authenticate with Supabase
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (authError) {
        return res.status(401).json({
          success: false,
          error: 'Authentication failed',
          message: 'Invalid email or password'
        });
      }

      // Get user business data (login context, use service role for RLS)
      const { data: userData, error: userError } = await supabaseAdmin
        .from('Usuarios')
        .select('*')
        .eq('email', authData.user.email)
        .single();

      if (userError) throw userError;

      if (!userData) {
        return res.status(403).json({
          success: false,
          error: 'User profile not found',
          message: 'Business profile is not properly configured'
        });
      }

      logger.info('User logged in:', {
        userId: userData.usuario_id,
        email: userData.email
      });

      res.json({
        success: true,
        data: {
          user: {
            usuario_id: userData.usuario_id,
            email: userData.email,
            nombre_negocio: userData.nombre_negocio,
            creado_en: userData.creado_en
          },
          session: {
            access_token: authData.session.access_token,
            refresh_token: authData.session.refresh_token,
            expires_at: authData.session.expires_at,
            expires_in: authData.session.expires_in
          }
        }
      });

    } catch (error) {
      logger.error('Login failed:', {
        email,
        error: error.message
      });

      res.status(500).json({
        success: false,
        error: 'Login failed',
        message: error.message
      });
    }
  })
);

/**
 * GET /api/users/profile
 * Get current user profile
 */
router.get(
  '/profile',
  validateAuth,
  asyncHandler(async (req, res) => {
    const user = req.user;

    try {
      // Get additional profile stats
      const recentSales = await dbHelpers.getSalesWithDetails(user.usuario_id, 10);
      const products = await dbHelpers.getUserProducts(user.usuario_id);

      const totalRevenue = recentSales.reduce((sum, sale) => 
        sum + parseFloat(sale.total_venta), 0
      );

      res.json({
        success: true,
        data: {
          user: {
            usuario_id: user.usuario_id,
            email: user.email,
            nombre_negocio: user.nombre_negocio,
            creado_en: user.creado_en
          },
          stats: {
            totalProducts: products.length,
            recentSalesCount: recentSales.length,
            totalRevenue: parseFloat(totalRevenue.toFixed(2))
          }
        }
      });

    } catch (error) {
      logger.error('Failed to fetch user profile:', {
        userId: user.usuario_id,
        error: error.message
      });

      res.status(500).json({
        success: false,
        error: 'Failed to fetch profile'
      });
    }
  })
);

/**
 * PUT /api/users/profile
 * Update user profile
 */
router.put(
  '/profile',
  validateAuth,
  [
    body('nombre_negocio')
      .optional()
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage('Business name must be between 2 and 100 characters')
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

    const { nombre_negocio } = req.body;
    const userId = req.user.usuario_id;

    try {
      const updateData = {};
      if (nombre_negocio) updateData.nombre_negocio = nombre_negocio;

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No valid fields to update'
        });
      }

      // Use user's JWT token for RLS-compliant update operation
      const userSupabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
        global: { 
          headers: { 
            Authorization: `Bearer ${req.userToken}` 
          } 
        }
      });
      
      const { data: updatedUser, error } = await userSupabase
        .from('Usuarios')
        .update(updateData)
        .eq('usuario_id', userId)
        .select()
        .single();

      if (error) throw error;

      logger.info('User profile updated:', {
        userId,
        updatedFields: Object.keys(updateData)
      });

      res.json({
        success: true,
        data: {
          user: updatedUser,
          message: 'Profile updated successfully'
        }
      });

    } catch (error) {
      logger.error('Failed to update profile:', {
        userId: req.user.usuario_id,
        error: error.message
      });

      res.status(500).json({
        success: false,
        error: 'Failed to update profile'
      });
    }
  })
);

/**
 * POST /api/users/logout
 * Logout user (invalidate session)
 */
router.post(
  '/logout',
  validateAuth,
  asyncHandler(async (req, res) => {
    try {
      const { error } = await supabase.auth.signOut();
      
      if (error) throw error;

      logger.info('User logged out:', {
        userId: req.user.usuario_id
      });

      res.json({
        success: true,
        message: 'Logged out successfully'
      });

    } catch (error) {
      logger.error('Logout failed:', {
        userId: req.user?.usuario_id,
        error: error.message
      });

      res.status(500).json({
        success: false,
        error: 'Logout failed'
      });
    }
  })
);

module.exports = router; 