const express = require('express');
const request = require('supertest');

// Mock database helpers
jest.mock('./config/database', () => ({
  dbHelpers: {
    getSalesWithDetails: jest.fn(),
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
