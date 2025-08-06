const express = require('express');
const { body, query, param, validationResult } = require('express-validator');
const { dbHelpers, supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { checkResourceOwnership } = require('../middleware/auth');
const { updateSale, deleteSale } = require('../services/salesService');
const { validate: validateUuid } = require('uuid');
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
      let sales = await dbHelpers.getSalesWithDetails(userId, parseInt(limit), parseInt(offset));

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
 * DELETE /api/sales/:venta_id
 * Elimina una venta de forma permanente
 */
router.delete('/:venta_id', async (req, res) => {
  const usuarioId = req.user.usuario_id;
  const { venta_id } = req.params;

  try {
    const { data, error } = await deleteSale(venta_id, usuarioId);
    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Venta no encontrada' });
      }
      return res.status(500).json({ error: 'Error al eliminar la venta' });
    }

    if (!data) {
      return res.status(404).json({ error: 'Venta no encontrada' });
    }

    return res.status(204).send();
  } catch (err) {
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

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

// Campos permitidos para actualización de ventas
const CAMPOS_PERMITIDOS = ['total_venta', 'incompleta', 'anulada', 'fecha_hora', 'cliente_id', 'notas'];

/**
 * PUT /api/sales/:venta_id
 * Editar una venta existente
 */
router.put('/:venta_id', async (req, res) => {
  const usuarioId = req.user.usuario_id;
  const { venta_id } = req.params;
  const body = req.body || {};

  // Validar que solo se envían campos permitidos
  const camposInvalidos = Object.keys(body).filter(k => !CAMPOS_PERMITIDOS.includes(k));
  if (camposInvalidos.length > 0) {
    return res.status(400).json({ error: `Campos no permitidos: ${camposInvalidos.join(', ')}` });
  }

  // Validaciones básicas de tipos de datos
  if (body.total_venta !== undefined) {
    if (typeof body.total_venta !== 'number' || body.total_venta < 0) {
      return res.status(400).json({ error: 'total_venta debe ser un número positivo' });
    }
  }
  if (body.incompleta !== undefined && typeof body.incompleta !== 'boolean') {
    return res.status(400).json({ error: 'incompleta debe ser boolean' });
  }
  if (body.anulada !== undefined && typeof body.anulada !== 'boolean') {
    return res.status(400).json({ error: 'anulada debe ser boolean' });
  }
  if (body.fecha_hora !== undefined) {
    const fechaValida = !isNaN(Date.parse(body.fecha_hora));
    if (!fechaValida) {
      return res.status(400).json({ error: 'fecha_hora debe ser fecha ISO válida' });
    }
  }
  if (body.cliente_id !== undefined && !validateUuid(body.cliente_id)) {
    return res.status(400).json({ error: 'cliente_id debe ser UUID válido' });
  }
  if (body.notas !== undefined && typeof body.notas !== 'string') {
    return res.status(400).json({ error: 'notas debe ser string' });
  }

  if (Object.keys(body).length === 0) {
    return res.status(400).json({ error: 'No hay campos para actualizar' });
  }

  try {
    const { data, error } = await updateSale(venta_id, usuarioId, body);

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Venta no encontrada' });
      }
      return res.status(500).json({ error: 'Error al actualizar la venta' });
    }

    if (!data) {
      return res.status(404).json({ error: 'Venta no encontrada' });
    }

    return res.status(200).json({
      success: true,
      data: {
        sale: data,
        message: 'Venta actualizada correctamente'
      }
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router; 