// Mock environment variables before requiring the service
process.env.OPENAI_API_KEY = 'test-key';

// Mock OpenAI
jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [{ message: { content: 'Test response' } }],
          usage: { total_tokens: 100 }
        })
      }
    }
  }));
});

// Mock database helpers
jest.mock('./config/database', () => ({
  dbHelpers: {
    getUserById: jest.fn(),
    getUserProducts: jest.fn(),
    getSalesWithDetails: jest.fn(),
    getPaymentMethods: jest.fn(),
    cancelSale: jest.fn(),
    getSalesByDate: jest.fn(),
  },
  supabaseAdmin: {},
}));

// Mock logger
jest.mock('./utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  logAIInteraction: jest.fn(),
  logDBOperation: jest.fn(),
}));

// Mock prompts
jest.mock('./prompts/perlaPrompt', () => ({
  buildPerlaPrompt: jest.fn().mockReturnValue('Mock system prompt')
}));

const { dbHelpers } = require('./config/database');
const aiService = require('./services/aiService');

describe('AI Service Context Management', () => {
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Mock all required database helpers
    dbHelpers.getUserById.mockResolvedValue({
      usuario_id: 'user1',
      nombre_negocio: 'Test Business',
      email: 'test@example.com'
    });
    dbHelpers.getUserProducts.mockResolvedValue([]);
    dbHelpers.getSalesWithDetails.mockResolvedValue([]);
    dbHelpers.getPaymentMethods.mockResolvedValue([]);
  });

  it('initializes conversation context correctly', async () => {
    const result = await aiService.processConversation('Hello', 'user1');
    
    expect(result).toHaveProperty('context');
    expect(result.context).toHaveProperty('messages');
    expect(result.context).toHaveProperty('lastSaleId');
    expect(result.context.messages).toEqual([]);
    expect(result.context.lastSaleId).toBeNull();
    expect(result).toHaveProperty('lastSaleId');
    expect(result.lastSaleId).toBeNull();
  });

  it('handles conversation context with existing data', async () => {
    const existingContext = {
      messages: [
        { role: 'user', content: 'Previous message' },
        { role: 'assistant', content: 'Previous response' }
      ],
      lastSaleId: '123e4567-e89b-12d3-a456-426614174000'
    };

    const result = await aiService.processConversation('Hello', 'user1', existingContext);
    
    expect(result.context).toEqual(existingContext);
    expect(result.lastSaleId).toBe('123e4567-e89b-12d3-a456-426614174000');
  });

  it('clears lastSaleId after sale cancellation via delete command', async () => {
    const existingContext = {
      messages: [],
      lastSaleId: '123e4567-e89b-12d3-a456-426614174000'
    };

    dbHelpers.cancelSale.mockResolvedValue({
      venta_id: '123e4567-e89b-12d3-a456-426614174000',
      anulada: true
    });

    const result = await aiService.processConversation('Anulá la última venta', 'user1', existingContext);
    
    expect(result.lastSaleId).toBeNull();
    expect(result.context.lastSaleId).toBeNull();
    expect(dbHelpers.cancelSale).toHaveBeenCalledWith('user1', '123e4567-e89b-12d3-a456-426614174000');
  });

  it('handles sale cancellation with specific UUID', async () => {
    const existingContext = {
      messages: [],
      lastSaleId: '123e4567-e89b-12d3-a456-426614174000'
    };

    const specificSaleId = '123e4567-e89b-12d3-a456-426614174001';
    dbHelpers.cancelSale.mockResolvedValue({
      venta_id: specificSaleId,
      anulada: true
    });

    const result = await aiService.processConversation(`Anulá la venta ${specificSaleId}`, 'user1', existingContext);
    
    expect(result.lastSaleId).toBeNull();
    expect(result.context.lastSaleId).toBeNull();
    expect(dbHelpers.cancelSale).toHaveBeenCalledWith('user1', specificSaleId);
  });

  it('preserves context structure in response', async () => {
    const existingContext = {
      messages: [
        { role: 'user', content: 'Test message' }
      ],
      lastSaleId: null
    };

    const result = await aiService.processConversation('Hello', 'user1', existingContext);
    
    expect(result).toHaveProperty('context');
    expect(result.context).toHaveProperty('messages');
    expect(result.context).toHaveProperty('lastSaleId');
    expect(Array.isArray(result.context.messages)).toBe(true);
    expect(typeof result.context.lastSaleId).toBe('object'); // null is an object in JS
  });

  it('handles empty context gracefully', async () => {
    const result = await aiService.processConversation('Hello', 'user1', {});
    
    expect(result).toHaveProperty('context');
    expect(result.context).toHaveProperty('messages');
    expect(result.context).toHaveProperty('lastSaleId');
    expect(Array.isArray(result.context.messages)).toBe(true);
    expect(result.context.lastSaleId).toBeNull();
  });

  it('handles null context gracefully', async () => {
    const result = await aiService.processConversation('Hello', 'user1', null);
    
    expect(result).toHaveProperty('context');
    expect(result.context).toHaveProperty('messages');
    expect(result.context).toHaveProperty('lastSaleId');
    expect(Array.isArray(result.context.messages)).toBe(true);
    expect(result.context.lastSaleId).toBeNull();
  });

  it('lists daily sales and sets pendingDeletion with mapping', async () => {
    // Mock DB daily sales
    dbHelpers.getSalesByDate = jest.fn().mockResolvedValue([
      {
        venta_id: 'uuid-1',
        total_venta: '10000',
        fecha_hora: '2025-08-12T09:00:00Z',
        Detalle_ventas: [ { cantidad: 3, Productos: { nombre: 'Cajas de sorrentinos' } } ],
        Pagos_venta: [ { Metodos_pago: { nombre: 'Efectivo' } } ]
      },
      {
        venta_id: 'uuid-2',
        total_venta: '8000',
        fecha_hora: '2025-08-12T10:00:00Z',
        Detalle_ventas: [ { cantidad: 1, Productos: { nombre: 'Tallarines' } }, { cantidad: 2, Productos: { nombre: 'Salsa de Tomate' } } ],
        Pagos_venta: [ { Metodos_pago: { nombre: 'QR' } } ]
      }
    ]);

    const result = await aiService.processConversation('necesito eliminar una venta', 'user1', { messages: [], lastSaleId: null });

    expect(result.response).toMatch(/ventas de hoy/i);
    expect(result.ui).toBeTruthy();
    expect(result.ui.table).toBeTruthy();
    expect(result.ui.table.rows).toHaveLength(2);
    expect(result.context.pendingDeletion).toBeTruthy();
    expect(result.context.pendingDeletion.indexToSaleId['1']).toBe('uuid-1');
    expect(result.context.pendingDeletion.indexToSaleId['2']).toBe('uuid-2');
    expect(result.context.lastSalesListShownAt).toBeDefined();
  });

  it('cancels sale by ordinal selection using pendingDeletion mapping', async () => {
    dbHelpers.getSalesByDate = jest.fn().mockResolvedValue([]);
    dbHelpers.cancelSale = jest.fn().mockResolvedValue({ venta_id: 'uuid-2', anulada: true });

    const context = {
      messages: [],
      lastSaleId: null,
      pendingDeletion: { dateISO: '2025-08-12', indexToSaleId: { '1': 'uuid-1', '2': 'uuid-2' } },
      lastSalesListShownAt: Date.now()
    };

    const result = await aiService.processConversation('La 2', 'user1', context);

    expect(dbHelpers.cancelSale).toHaveBeenCalledWith('user1', 'uuid-2');
    expect(result.response).toMatch(/venta eliminada/i);
    expect(result.lastSaleId).toBeNull();
    expect(result.context.pendingDeletion).toBeUndefined();
  });
});
