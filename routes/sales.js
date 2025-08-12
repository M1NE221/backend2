const express = require('express');
const { body, query, param, validationResult } = require('express-validator');
const { dbHelpers, supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { checkResourceOwnership } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * GET /api/sales
 * Get user's sales with pagination and filtering
 */
router.get(
  '/',
  [
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100'),
    query('offset')
      .optional()
      .isInt({ min: 0 })
      .withMessage('Offset must be a non-negative integer'),
    query('startDate')
      .optional()
      .isISO8601()
      .withMessage('Start date must be valid ISO8601 format'),
    query('endDate')
      .optional()
      .isISO8601()
      .withMessage('End date must be valid ISO8601 format')
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

    const {
      limit = 50,
      offset = 0,
      startDate,
      endDate
    } = req.query;

    const userId = req.user.usuario_id;

    try {
      let sales = await dbHelpers.getSalesWithDetails(
        userId,
        parseInt(limit),
        parseInt(offset)
      );

      // Exclude cancelled sales
      sales = sales.filter(sale => !sale.anulada);
      // Filter by date range if provided
      if (startDate || endDate) {
        sales = sales.filter(sale => {
          const saleDate = new Date(sale.fecha_hora);
          if (startDate && saleDate < new Date(startDate)) return false;
          if (endDate && saleDate > new Date(endDate)) return false;
          return true;
        });
      }

      // Calculate summary metrics
      const totalRevenue = sales.reduce((sum, sale) => sum + parseFloat(sale.total_venta), 0);
      const averageTransaction = sales.length > 0 ? totalRevenue / sales.length : 0;

      res.json({
        success: true,
        data: {
          sales,
          pagination: {
            limit: parseInt(limit),
            offset: parseInt(offset),
            total: sales.length
          },
          summary: {
            totalRevenue: parseFloat(totalRevenue.toFixed(2)),
            averageTransaction: parseFloat(averageTransaction.toFixed(2)),
            transactionCount: sales.length
          }
        }
      });

    } catch (error) {
      logger.error('Failed to fetch sales:', {
        userId,
        error: error.message
      });

      res.status(500).json({
        success: false,
        error: 'Failed to fetch sales'
      });
    }
  })
);

/**
 * GET /api/sales/day
 * Get sales for a specific day
 */
router.get(
  '/day',
  [
    query('date')
      .optional()
      .isISO8601()
      .withMessage('Date must be valid ISO8601 format (YYYY-MM-DD)')
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

    const userId = req.user.usuario_id;
    const dateISO = (req.query.date || new Date().toISOString().slice(0, 10));

    try {
      const sales = await dbHelpers.getSalesByDate(userId, dateISO);

      const rows = sales.map((sale, idx) => {
        const ordinal = idx + 1;
        const items = sale.Detalle_ventas || [];
        const itemsLabel = items
          .map(d => d.Productos?.nombre || d.producto_alt || 'Sin nombre')
          .join(' - ');
        const cantidades = items
          .map(d => String(d.cantidad))
          .join(' - ');

        const pagos = sale.Pagos_venta || [];
        const medioPagoLabel = pagos.length > 0
          ? pagos.map(p => p.Metodos_pago?.nombre || 'Desconocido').join(' / ')
          : 'N/D';

        const total = parseFloat(sale.total_venta);

        return {
          ordinal,
          venta_id: sale.venta_id,
          itemsLabel,
          cantidades,
          medioPagoLabel,
          total
        };
      });

      res.json({
        success: true,
        data: {
          date: dateISO,
          rows
        }
      });
    } catch (error) {
      logger.error('Failed to fetch daily sales:', {
        userId,
        dateISO,
        error: error.message
      });

      res.status(500).json({
        success: false,
        error: 'Failed to fetch daily sales'
      });
    }
  })
);

/**
 * GET /api/sales/:saleId
 * Get specific sale details
 */
router.get(
  '/:saleId',
  [
    param('saleId')
      .isUUID()
      .withMessage('Sale ID must be a valid UUID')
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

    const { saleId } = req.params;
    const userId = req.user.usuario_id;

    try {
      const { data: sale, error } = await dbHelpers.supabase
        .from('Ventas')
        .select(`
          *,
          Detalle_ventas(*,
            Productos(*),
            Promociones(*)
          ),
          Pagos_venta(*,
            Metodos_pago(*)
          )
        `)
        .eq('venta_id', saleId)
        .eq('usuario_id', userId)
        .eq('anulada', false)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return res.status(404).json({
            success: false,
            error: 'Sale not found'
          });
        }
        throw error;
      }

      res.json({
        success: true,
        data: { sale }
      });

    } catch (error) {
      logger.error('Failed to fetch sale:', {
        userId,
        saleId,
        error: error.message
      });

      res.status(500).json({
        success: false,
        error: 'Failed to fetch sale'
      });
    }
  })
);

/**
 * DELETE /api/sales/:saleId
 * Cancel/delete a sale (mark as anulada)
 */
router.delete(
  '/:saleId',
  [
    param('saleId')
      .isUUID()
      .withMessage('Sale ID must be a valid UUID')
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

    const { saleId } = req.params;
    const userId = req.user.usuario_id;

    try {
      const updatedSale = await dbHelpers.cancelSale(userId, saleId);

      res.json({
        success: true,
        data: {
          sale: updatedSale,
          message: 'Sale cancelled successfully'
        }
      });

    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({
          success: false,
          error: 'Sale not found'
        });
      }

      if (error.code === 'ALREADY_CANCELLED') {
        return res.status(404).json({
          success: false,
          error: 'Sale not found'
        });
      }

      logger.error('Failed to cancel sale:', {
        userId,
        saleId,
        error: error.message
      });

      res.status(500).json({
        success: false,
        error: 'Failed to cancel sale'
      });
    }
  })
);

/**
 * GET /api/sales/analytics/summary
 * Get sales analytics summary
 */
router.get(
  '/analytics/summary',
  [
    query('period')
      .optional()
      .isIn(['week', 'month', 'quarter', 'year'])
      .withMessage('Period must be week, month, quarter, or year')
  ],
  asyncHandler(async (req, res) => {
    const { period = 'month' } = req.query;
    const userId = req.user.usuario_id;

    try {
      // Calculate date range based on period
      const now = new Date();
      let startDate;
      
      switch (period) {
        case 'week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
        case 'quarter':
          const quarterStart = Math.floor(now.getMonth() / 3) * 3;
          startDate = new Date(now.getFullYear(), quarterStart, 1);
          break;
        case 'year':
          startDate = new Date(now.getFullYear(), 0, 1);
          break;
      }

      const sales = await dbHelpers.getSalesWithDetails(userId, 1000);
      const periodSales = sales.filter(sale => 
        new Date(sale.fecha_hora) >= startDate && !sale.anulada
      );

      // Calculate metrics
      const totalRevenue = periodSales.reduce((sum, sale) => 
        sum + parseFloat(sale.total_venta), 0
      );
      
      const totalTransactions = periodSales.length;
      const averageTransaction = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;

      // Product performance
      const productSales = {};
      periodSales.forEach(sale => {
        sale.Detalle_ventas?.forEach(detail => {
          const productName = detail.Productos?.nombre || detail.producto_alt || 'Unknown';
          if (!productSales[productName]) {
            productSales[productName] = {
              quantity: 0,
              revenue: 0
            };
          }
          productSales[productName].quantity += parseFloat(detail.cantidad);
          productSales[productName].revenue += parseFloat(detail.subtotal);
        });
      });

      const topProducts = Object.entries(productSales)
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5);

      res.json({
        success: true,
        data: {
          period,
          dateRange: {
            start: startDate.toISOString(),
            end: now.toISOString()
          },
          metrics: {
            totalRevenue: parseFloat(totalRevenue.toFixed(2)),
            totalTransactions,
            averageTransaction: parseFloat(averageTransaction.toFixed(2))
          },
          topProducts
        }
      });

    } catch (error) {
      logger.error('Failed to generate sales analytics:', {
        userId,
        period,
        error: error.message
      });

      res.status(500).json({
        success: false,
        error: 'Failed to generate sales analytics'
      });
    }
  })
);

/**
 * GET /api/sales/products/:productId/price-history
 * Get price history for a specific product
 */
router.get(
  '/products/:productId/price-history',
  [
    param('productId')
      .isUUID()
      .withMessage('Product ID must be a valid UUID')
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

    const { productId } = req.params;
    const userId = req.user.usuario_id;

    try {
      // Verify product ownership
      const { data: product, error } = await supabaseAdmin
        .from('Productos')
        .select('producto_id, nombre')
        .eq('producto_id', productId)
        .eq('usuario_id', userId)
        .single();

      if (error || !product) {
        return res.status(404).json({
          success: false,
          error: 'Product not found'
        });
      }

      const priceHistory = await dbHelpers.getPriceHistory(productId);

      res.json({
        success: true,
        data: {
          productId,
          productName: product.nombre,
          priceHistory: priceHistory.map(price => ({
            precio_unitario: parseFloat(price.precio_unitario),
            vigente_desde: price.vigente_desde,
            vigente_hasta: price.vigente_hasta,
            duration_days: price.vigente_hasta 
              ? Math.ceil((new Date(price.vigente_hasta) - new Date(price.vigente_desde)) / (1000 * 60 * 60 * 24))
              : null
          }))
        }
      });

    } catch (error) {
      logger.error('Failed to fetch price history:', {
        userId,
        productId,
        error: error.message
      });

      res.status(500).json({
        success: false,
        error: 'Failed to fetch price history'
      });
    }
  })
);

/**
 * GET /api/sales/products/:productId/current-price
 * Get current price for a specific product
 */
router.get(
  '/products/:productId/current-price',
  [
    param('productId')
      .isUUID()
      .withMessage('Product ID must be a valid UUID')
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

    const { productId } = req.params;
    const userId = req.user.usuario_id;

    try {
      // Verify product ownership
      const { data: product, error } = await supabaseAdmin
        .from('Productos')
        .select('producto_id, nombre')
        .eq('producto_id', productId)
        .eq('usuario_id', userId)
        .single();

      if (error || !product) {
        return res.status(404).json({
          success: false,
          error: 'Product not found'
        });
      }

      const currentPrice = await dbHelpers.getCurrentPrice(productId);

      res.json({
        success: true,
        data: {
          productId,
          productName: product.nombre,
          currentPrice: currentPrice ? parseFloat(currentPrice) : null
        }
      });

    } catch (error) {
      logger.error('Failed to fetch current price:', {
        userId,
        productId,
        error: error.message
      });

      res.status(500).json({
        success: false,
        error: 'Failed to fetch current price'
      });
    }
  })
);

module.exports = router; 