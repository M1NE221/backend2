const express = require('express');
const request = require('supertest');

// Mock database helpers
jest.mock('./config/database', () => ({
  dbHelpers: {
    getSalesWithDetails: jest.fn(),
    cancelSale: jest.fn(),
    getUserById: jest.fn(),
    getUserProducts: jest.fn(),
    getPaymentMethods: jest.fn(),
    getSalesByDate: jest.fn(),
  },
  supabaseAdmin: {},
}));

const { dbHelpers } = require('./config/database');
const salesRoutes = require('./routes/sales');

describe('GET /api/sales', () => {
  it('filters out cancelled sales before calculating metrics', async () => {
    const mockSales = [
      {
        venta_id: '1',
        anulada: false,
        total_venta: '100',
        fecha_hora: '2024-01-01T00:00:00Z',
      },
      {
        venta_id: '2',
        anulada: true,
        total_venta: '50',
        fecha_hora: '2024-01-02T00:00:00Z',
      },
      {
        venta_id: '3',
        anulada: false,
        total_venta: '30',
        fecha_hora: '2024-01-03T00:00:00Z',
      },
    ];

    dbHelpers.getSalesWithDetails.mockResolvedValue(mockSales);

    const app = express();
    app.use((req, res, next) => {
      req.user = { usuario_id: 'user1' };
      next();
    });
    app.use('/api/sales', salesRoutes);

    const res = await request(app).get('/api/sales');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.sales).toHaveLength(2);
    expect(res.body.data.sales.every(s => s.anulada === false)).toBe(true);
    expect(res.body.data.summary.transactionCount).toBe(2);
    expect(res.body.data.summary.totalRevenue).toBe(130);
    expect(res.body.data.summary.averageTransaction).toBe(65);
  });
});

describe('DELETE /api/sales/:saleId', () => {
  it('successfully cancels a sale', async () => {
    const mockCancelledSale = {
      venta_id: '123e4567-e89b-12d3-a456-426614174000',
      usuario_id: 'user1',
      anulada: true,
      total_venta: '100',
      fecha_hora: '2024-01-01T00:00:00Z',
    };

    dbHelpers.cancelSale.mockResolvedValue(mockCancelledSale);

    const app = express();
    app.use((req, res, next) => {
      req.user = { usuario_id: 'user1' };
      next();
    });
    app.use('/api/sales', salesRoutes);

    const res = await request(app).delete('/api/sales/123e4567-e89b-12d3-a456-426614174000');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.sale).toEqual(mockCancelledSale);
    expect(res.body.data.message).toBe('Sale cancelled successfully');
    expect(dbHelpers.cancelSale).toHaveBeenCalledWith('user1', '123e4567-e89b-12d3-a456-426614174000');
  });

  it('returns 404 when sale not found', async () => {
    const notFoundError = new Error('Sale not found');
    notFoundError.code = 'NOT_FOUND';
    dbHelpers.cancelSale.mockRejectedValue(notFoundError);

    const app = express();
    app.use((req, res, next) => {
      req.user = { usuario_id: 'user1' };
      next();
    });
    app.use('/api/sales', salesRoutes);

    const res = await request(app).delete('/api/sales/123e4567-e89b-12d3-a456-426614174001');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Sale not found');
  });

  it('returns 404 when sale already cancelled', async () => {
    const alreadyCancelledError = new Error('Sale already cancelled');
    alreadyCancelledError.code = 'ALREADY_CANCELLED';
    dbHelpers.cancelSale.mockRejectedValue(alreadyCancelledError);

    const app = express();
    app.use((req, res, next) => {
      req.user = { usuario_id: 'user1' };
      next();
    });
    app.use('/api/sales', salesRoutes);

    const res = await request(app).delete('/api/sales/123e4567-e89b-12d3-a456-426614174002');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Sale not found');
  });
});

describe('GET /api/sales/day', () => {
  it('returns daily sales with ordinal and UI fields', async () => {
    const mockSales = [
      {
        venta_id: 'uuid-1',
        total_venta: '10000',
        fecha_hora: '2025-08-12T09:00:00Z',
        Detalle_ventas: [
          { cantidad: 3, subtotal: 10000, Productos: { nombre: 'Cajas de sorrentinos' } }
        ],
        Pagos_venta: [
          { Metodos_pago: { nombre: 'Efectivo' } }
        ]
      },
      {
        venta_id: 'uuid-2',
        total_venta: '8000',
        fecha_hora: '2025-08-12T10:00:00Z',
        Detalle_ventas: [
          { cantidad: 1, subtotal: 4000, Productos: { nombre: 'Tallarines' } },
          { cantidad: 2, subtotal: 4000, Productos: { nombre: 'Salsa de Tomate' } }
        ],
        Pagos_venta: [
          { Metodos_pago: { nombre: 'QR' } }
        ]
      }
    ];

    dbHelpers.getSalesByDate = jest.fn().mockResolvedValue(mockSales);

    const app = express();
    app.use((req, res, next) => {
      req.user = { usuario_id: 'user1' };
      next();
    });
    app.use('/api/sales', salesRoutes);

    const res = await request(app).get('/api/sales/day?date=2025-08-12');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.date).toBe('2025-08-12');
    expect(res.body.data.rows).toHaveLength(2);
    expect(res.body.data.rows[0]).toEqual({
      ordinal: 1,
      venta_id: 'uuid-1',
      itemsLabel: 'Cajas de sorrentinos',
      cantidades: '3',
      medioPagoLabel: 'Efectivo',
      total: 10000
    });
    expect(res.body.data.rows[1]).toEqual({
      ordinal: 2,
      venta_id: 'uuid-2',
      itemsLabel: 'Tallarines - Salsa de Tomate',
      cantidades: '1 - 2',
      medioPagoLabel: 'QR',
      total: 8000
    });
  });
});
