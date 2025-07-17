const express = require('express');
const { query, validationResult } = require('express-validator');
const { dbHelpers } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * GET /api/analytics/dashboard
 * Get main dashboard analytics
 */
router.get(
  '/dashboard',
  [
    query('period')
      .optional()
      .isIn(['today', 'week', 'month', 'quarter', 'year'])
      .withMessage('Period must be today, week, month, quarter, or year')
  ],
  asyncHandler(async (req, res) => {
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
        case 'quarter':
          const quarterStart = Math.floor(now.getMonth() / 3) * 3;
          startDate = new Date(now.getFullYear(), quarterStart, 1);
          break;
        case 'year':
          startDate = new Date(now.getFullYear(), 0, 1);
          break;
      }

      // Get sales data
      const allSales = await dbHelpers.getSalesWithDetails(userId, 1000);
      const periodSales = allSales.filter(sale => 
        new Date(sale.fecha_hora) >= startDate && !sale.anulada
      );

      // Calculate key metrics
      const totalRevenue = periodSales.reduce((sum, sale) => 
        sum + parseFloat(sale.total_venta), 0
      );
      
      const totalTransactions = periodSales.length;
      const averageTransaction = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;

      // Calculate growth vs previous period
      const previousPeriodStart = new Date(startDate.getTime() - (now.getTime() - startDate.getTime()));
      const previousPeriodSales = allSales.filter(sale => {
        const saleDate = new Date(sale.fecha_hora);
        return saleDate >= previousPeriodStart && saleDate < startDate && !sale.anulada;
      });

      const previousRevenue = previousPeriodSales.reduce((sum, sale) => 
        sum + parseFloat(sale.total_venta), 0
      );
      
      const revenueGrowth = previousRevenue > 0 
        ? ((totalRevenue - previousRevenue) / previousRevenue) * 100 
        : 0;

      const transactionGrowth = previousPeriodSales.length > 0 
        ? ((totalTransactions - previousPeriodSales.length) / previousPeriodSales.length) * 100 
        : 0;

      // Top products analysis
      const productSales = {};
      periodSales.forEach(sale => {
        sale.Detalle_ventas?.forEach(detail => {
          const productName = detail.Productos?.nombre || detail.producto_alt || 'Unknown';
          if (!productSales[productName]) {
            productSales[productName] = {
              quantity: 0,
              revenue: 0,
              transactions: 0
            };
          }
          productSales[productName].quantity += parseFloat(detail.cantidad);
          productSales[productName].revenue += parseFloat(detail.subtotal);
          productSales[productName].transactions += 1;
        });
      });

      const topProducts = Object.entries(productSales)
        .map(([name, data]) => ({ 
          name, 
          ...data,
          averagePrice: data.quantity > 0 ? data.revenue / data.quantity : 0
        }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5);

      // Payment methods analysis
      const paymentMethods = {};
      periodSales.forEach(sale => {
        sale.Pagos_venta?.forEach(payment => {
          const methodName = payment.Metodos_pago?.nombre || 'Unknown';
          if (!paymentMethods[methodName]) {
            paymentMethods[methodName] = {
              amount: 0,
              transactions: 0
            };
          }
          paymentMethods[methodName].amount += parseFloat(payment.monto);
          paymentMethods[methodName].transactions += 1;
        });
      });

      const paymentMethodsData = Object.entries(paymentMethods)
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.amount - a.amount);

      // Sales trend (daily breakdown for the period)
      const salesTrend = [];
      const dayMs = 24 * 60 * 60 * 1000;
      for (let d = new Date(startDate); d <= now; d.setTime(d.getTime() + dayMs)) {
        const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const dayEnd = new Date(dayStart.getTime() + dayMs);
        
        const daySales = periodSales.filter(sale => {
          const saleDate = new Date(sale.fecha_hora);
          return saleDate >= dayStart && saleDate < dayEnd;
        });

        const dayRevenue = daySales.reduce((sum, sale) => 
          sum + parseFloat(sale.total_venta), 0
        );

        salesTrend.push({
          date: dayStart.toISOString().split('T')[0],
          revenue: parseFloat(dayRevenue.toFixed(2)),
          transactions: daySales.length
        });
      }

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
            averageTransaction: parseFloat(averageTransaction.toFixed(2)),
            revenueGrowth: parseFloat(revenueGrowth.toFixed(2)),
            transactionGrowth: parseFloat(transactionGrowth.toFixed(2))
          },
          topProducts,
          paymentMethods: paymentMethodsData,
          salesTrend
        }
      });

    } catch (error) {
      logger.error('Failed to generate dashboard analytics:', {
        userId,
        period,
        error: error.message
      });

      res.status(500).json({
        success: false,
        error: 'Failed to generate dashboard analytics'
      });
    }
  })
);

/**
 * GET /api/analytics/products
 * Get detailed product analytics
 */
router.get(
  '/products',
  [
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100'),
    query('sortBy')
      .optional()
      .isIn(['revenue', 'quantity', 'transactions'])
      .withMessage('Sort by must be revenue, quantity, or transactions')
  ],
  asyncHandler(async (req, res) => {
    const { limit = 20, sortBy = 'revenue' } = req.query;
    const userId = req.user.usuario_id;

    try {
      const sales = await dbHelpers.getSalesWithDetails(userId, 1000);
      const activeSales = sales.filter(sale => !sale.anulada);

      // Analyze product performance
      const productAnalysis = {};
      
      activeSales.forEach(sale => {
        sale.Detalle_ventas?.forEach(detail => {
          const productId = detail.producto_id;
          const productName = detail.Productos?.nombre || detail.producto_alt || 'Unknown';
          
          const key = productId || productName;
          
          if (!productAnalysis[key]) {
            productAnalysis[key] = {
              product_id: productId,
              name: productName,
              totalRevenue: 0,
              totalQuantity: 0,
              totalTransactions: 0,
              averagePrice: 0,
              lastSold: null,
              priceHistory: []
            };
          }

          const analysis = productAnalysis[key];
          analysis.totalRevenue += parseFloat(detail.subtotal);
          analysis.totalQuantity += parseFloat(detail.cantidad);
          analysis.totalTransactions += 1;
          
          if (!analysis.lastSold || new Date(sale.fecha_hora) > new Date(analysis.lastSold)) {
            analysis.lastSold = sale.fecha_hora;
          }

          analysis.priceHistory.push({
            price: parseFloat(detail.precio_unitario),
            date: sale.fecha_hora,
            quantity: parseFloat(detail.cantidad)
          });
        });
      });

      // Calculate final metrics
      const productStats = Object.values(productAnalysis).map(product => {
        product.averagePrice = product.totalQuantity > 0 
          ? product.totalRevenue / product.totalQuantity 
          : 0;
        
        // Sort price history by date
        product.priceHistory.sort((a, b) => new Date(a.date) - new Date(b.date));
        
        return {
          ...product,
          totalRevenue: parseFloat(product.totalRevenue.toFixed(2)),
          averagePrice: parseFloat(product.averagePrice.toFixed(2))
        };
      });

      // Sort by requested criteria
      productStats.sort((a, b) => {
        switch (sortBy) {
          case 'revenue':
            return b.totalRevenue - a.totalRevenue;
          case 'quantity':
            return b.totalQuantity - a.totalQuantity;
          case 'transactions':
            return b.totalTransactions - a.totalTransactions;
          default:
            return b.totalRevenue - a.totalRevenue;
        }
      });

      const limitedResults = productStats.slice(0, parseInt(limit));

      res.json({
        success: true,
        data: {
          products: limitedResults,
          totalProducts: productStats.length,
          sortBy,
          limit: parseInt(limit)
        }
      });

    } catch (error) {
      logger.error('Failed to generate product analytics:', {
        userId,
        error: error.message
      });

      res.status(500).json({
        success: false,
        error: 'Failed to generate product analytics'
      });
    }
  })
);

/**
 * GET /api/analytics/trends
 * Get sales trends and forecasting data
 */
router.get(
  '/trends',
  [
    query('period')
      .optional()
      .isIn(['week', 'month', 'quarter', 'year'])
      .withMessage('Period must be week, month, quarter, or year'),
    query('granularity')
      .optional()
      .isIn(['day', 'week', 'month'])
      .withMessage('Granularity must be day, week, or month')
  ],
  asyncHandler(async (req, res) => {
    const { period = 'month', granularity = 'day' } = req.query;
    const userId = req.user.usuario_id;

    try {
      const sales = await dbHelpers.getSalesWithDetails(userId, 1000);
      const activeSales = sales.filter(sale => !sale.anulada);

      // Calculate date range
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

      const periodSales = activeSales.filter(sale => 
        new Date(sale.fecha_hora) >= startDate
      );

      // Generate trend data based on granularity
      const trends = [];
      let intervalMs;
      let formatString;

      switch (granularity) {
        case 'day':
          intervalMs = 24 * 60 * 60 * 1000;
          formatString = 'YYYY-MM-DD';
          break;
        case 'week':
          intervalMs = 7 * 24 * 60 * 60 * 1000;
          formatString = 'YYYY-[W]WW';
          break;
        case 'month':
          intervalMs = 30 * 24 * 60 * 60 * 1000; // Approximate
          formatString = 'YYYY-MM';
          break;
      }

      for (let d = new Date(startDate); d <= now; d.setTime(d.getTime() + intervalMs)) {
        const periodStart = new Date(d);
        const periodEnd = new Date(d.getTime() + intervalMs);
        
        const periodSalesData = periodSales.filter(sale => {
          const saleDate = new Date(sale.fecha_hora);
          return saleDate >= periodStart && saleDate < periodEnd;
        });

        const revenue = periodSalesData.reduce((sum, sale) => 
          sum + parseFloat(sale.total_venta), 0
        );

        trends.push({
          period: periodStart.toISOString().split('T')[0],
          revenue: parseFloat(revenue.toFixed(2)),
          transactions: periodSalesData.length,
          averageTransaction: periodSalesData.length > 0 
            ? parseFloat((revenue / periodSalesData.length).toFixed(2)) 
            : 0
        });
      }

      // Calculate trend direction (simple linear regression)
      const revenues = trends.map(t => t.revenue);
      const n = revenues.length;
      const sumX = n * (n - 1) / 2; // 0 + 1 + 2 + ... + (n-1)
      const sumY = revenues.reduce((sum, rev) => sum + rev, 0);
      const sumXY = revenues.reduce((sum, rev, i) => sum + i * rev, 0);
      const sumX2 = n * (n - 1) * (2 * n - 1) / 6; // 0² + 1² + 2² + ... + (n-1)²

      const slope = n > 1 ? (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX) : 0;
      const trendDirection = slope > 0 ? 'up' : slope < 0 ? 'down' : 'flat';

      res.json({
        success: true,
        data: {
          period,
          granularity,
          dateRange: {
            start: startDate.toISOString(),
            end: now.toISOString()
          },
          trends,
          trendDirection,
          summary: {
            totalPeriods: trends.length,
            averageRevenue: n > 0 ? parseFloat((sumY / n).toFixed(2)) : 0,
            maxRevenue: Math.max(...revenues),
            minRevenue: Math.min(...revenues)
          }
        }
      });

    } catch (error) {
      logger.error('Failed to generate trend analytics:', {
        userId,
        period,
        granularity,
        error: error.message
      });

      res.status(500).json({
        success: false,
        error: 'Failed to generate trend analytics'
      });
    }
  })
);

module.exports = router; 