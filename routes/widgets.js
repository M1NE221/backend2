const express = require('express');
const { query, validationResult } = require('express-validator');
const { dbHelpers, supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * GET /api/widgets/sales
 * Returns recent sales data for the sales widget
 */
router.get(
  '/sales',
  [
    query('limit')
      .optional()
      .isInt({ min: 1, max: 50 })
      .withMessage('Limit must be between 1 and 50'),
    query('period')
      .optional()
      .isIn(['today', 'week', 'month'])
      .withMessage('Period must be today, week, or month')
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

    const { limit = 10, period = 'week' } = req.query;
    const userId = req.user.usuario_id;

    try {
      // Calculate date range based on period
      const now = new Date();
      let startDate;
      
      switch (period) {
        case 'today':
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case 'week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
      }

      // Get recent sales with details
      const sales = await dbHelpers.getSalesWithDetails(userId, parseInt(limit));
      
      // Filter by period and format for widget
      const recentSales = sales
        .filter(sale => {
          if (period === 'today') {
            const saleDate = new Date(sale.fecha_hora);
            return saleDate >= startDate && !sale.anulada;
          }
          return !sale.anulada;
        })
        .map(sale => {
          // Extract products from sale details
          const products = sale.Detalle_ventas?.map(detail => 
            detail.Productos?.nombre || detail.producto_alt || 'Unknown Product'
          ) || [];

          return {
            id: sale.venta_id,
            customer: `Customer ${sale.venta_id.substring(0, 8)}`, // Placeholder - could be enhanced with customer data
            amount: parseFloat(sale.total_venta),
            products: products,
            timestamp: sale.fecha_hora,
            status: sale.anulada ? 'cancelled' : 'completed'
          };
        });

      // Calculate monthly total
      const monthlyStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthlySales = sales.filter(sale => {
        const saleDate = new Date(sale.fecha_hora);
        return saleDate >= monthlyStart && !sale.anulada;
      });
      
      const monthlyTotal = monthlySales.reduce((sum, sale) => 
        sum + parseFloat(sale.total_venta), 0
      );

      // Get total sales count
      const totalSales = sales.filter(sale => !sale.anulada).length;

      res.json({
        success: true,
        data: {
          recentSales,
          monthlyTotal: parseFloat(monthlyTotal.toFixed(2)),
          totalSales
        }
      });

    } catch (error) {
      logger.error('Failed to fetch sales widget data:', {
        userId,
        error: error.message
      });

      res.status(500).json({
        success: false,
        error: 'Failed to fetch sales data'
      });
    }
  })
);

/**
 * GET /api/widgets/payments
 * Returns payment breakdown by payment method
 */
router.get(
  '/payments',
  [
    query('period')
      .optional()
      .isIn(['today', 'week', 'month'])
      .withMessage('Period must be today, week, or month')
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

    const { period = 'month' } = req.query;
    const userId = req.user.usuario_id;

    try {
      // Calculate date range
      const now = new Date();
      let startDate;
      
      switch (period) {
        case 'today':
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case 'week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
      }

      // Get sales with payment details
      const sales = await dbHelpers.getSalesWithDetails(userId, 1000);
      
      // Filter by period
      const periodSales = sales.filter(sale => {
        const saleDate = new Date(sale.fecha_hora);
        return saleDate >= startDate && !sale.anulada;
      });

      // Calculate payment breakdown
      const paymentBreakdown = {};
      const recentPayments = [];

      periodSales.forEach(sale => {
        sale.Pagos_venta?.forEach(payment => {
          const methodName = payment.Metodos_pago?.nombre || 'Unknown';
          const methodKey = methodName.toLowerCase().replace(/\s+/g, '_');
          
          // Add to breakdown
          if (!paymentBreakdown[methodKey]) {
            paymentBreakdown[methodKey] = 0;
          }
          paymentBreakdown[methodKey] += parseFloat(payment.monto);

          // Add to recent payments
          recentPayments.push({
            id: payment.pago_id,
            amount: parseFloat(payment.monto),
            method: methodKey,
            customer: `Customer ${sale.venta_id.substring(0, 8)}`,
            timestamp: sale.fecha_hora
          });
        });
      });

      // Calculate total income
      const totalIncome = Object.values(paymentBreakdown).reduce((sum, amount) => sum + amount, 0);

      // Sort recent payments by timestamp (most recent first)
      recentPayments.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      res.json({
        success: true,
        data: {
          totalIncome: parseFloat(totalIncome.toFixed(2)),
          paymentBreakdown,
          recentPayments: recentPayments.slice(0, 10) // Limit to 10 most recent
        }
      });

    } catch (error) {
      logger.error('Failed to fetch payments widget data:', {
        userId,
        error: error.message
      });

      res.status(500).json({
        success: false,
        error: 'Failed to fetch payments data'
      });
    }
  })
);

/**
 * GET /api/widgets/products
 * Returns available products inventory
 */
router.get(
  '/products',
  [
    query('category')
      .optional()
      .isString()
      .withMessage('Category must be a string'),
    query('status')
      .optional()
      .isIn(['available', 'unavailable', 'all'])
      .withMessage('Status must be available, unavailable, or all')
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

    const { category, status = 'available' } = req.query;
    const userId = req.user.usuario_id;

    try {
      // Get user's products with current prices
      const userProducts = await dbHelpers.getUserProducts(userId);
      
      // Filter products based on status
      let filteredProducts = userProducts;
      if (status !== 'all') {
        filteredProducts = userProducts.filter(product => 
          status === 'available' ? product.disponible : !product.disponible
        );
      }

      // Format products for widget
      const products = filteredProducts.map(product => {
        // Get current price
        const currentPrice = product.Precios_producto?.find(price => 
          price.vigente_hasta === null
        )?.precio_unitario || 0;

        return {
          id: product.producto_id,
          name: product.nombre,
          stock: product.disponible ? 50 : 0, // Placeholder - could be enhanced with actual stock tracking
          price: parseFloat(currentPrice),
          category: 'services', // Placeholder - could be enhanced with category field
          status: product.disponible ? 'available' : 'unavailable'
        };
      });

      // Filter by category if specified
      if (category) {
        const categoryProducts = products.filter(product => 
          product.category === category
        );
        filteredProducts = categoryProducts;
      }

      // Calculate metrics
      const totalProducts = products.length;
      const lowStock = products.filter(product => product.stock < 10).length;

      res.json({
        success: true,
        data: {
          products: filteredProducts,
          totalProducts,
          lowStock
        }
      });

    } catch (error) {
      logger.error('Failed to fetch products widget data:', {
        userId,
        error: error.message
      });

      res.status(500).json({
        success: false,
        error: 'Failed to fetch products data'
      });
    }
  })
);

module.exports = router; 