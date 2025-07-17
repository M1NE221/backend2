const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');

// Validate required environment variables
const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  logger.error('Missing required environment variables:', missingEnvVars);
  process.exit(1);
}

// Create Supabase clients
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

// Public client (for user operations)
const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: false
  }
});

// Admin client (for system operations)
const supabaseAdmin = supabaseServiceKey 
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  : null;

// Database connection test
const testConnection = async () => {
  try {
    const { data, error } = await supabase
      .from('Usuarios')
      .select('count')
      .limit(1);
    
    if (error) {
      logger.error('Database connection test failed:', error);
      return false;
    }
    
    logger.info('✅ Database connection successful');
    return true;
  } catch (error) {
    logger.error('Database connection error:', error);
    return false;
  }
};

// Helper functions for common database operations
const dbHelpers = {
  // Get user by ID
  async getUserById(userId) {
    const { data, error } = await supabase
      .from('Usuarios')
      .select('*')
      .eq('usuario_id', userId)
      .single();
    
    if (error) throw error;
    return data;
  },

  // Create a new sale with details
  async createSaleWithDetails(saleData, details, payments) {
    const { data: sale, error: saleError } = await supabase
      .from('Ventas')
      .insert(saleData)
      .select()
      .single();

    if (saleError) throw saleError;

    // Insert sale details
    if (details && details.length > 0) {
      const detailsWithSaleId = details.map(detail => ({
        ...detail,
        venta_id: sale.venta_id
      }));

      const { error: detailsError } = await supabase
        .from('Detalle_ventas')
        .insert(detailsWithSaleId);

      if (detailsError) throw detailsError;
    }

    // Insert payments
    if (payments && payments.length > 0) {
      const paymentsWithSaleId = payments.map(payment => ({
        ...payment,
        venta_id: sale.venta_id
      }));

      const { error: paymentsError } = await supabase
        .from('Pagos_venta')
        .insert(paymentsWithSaleId);

      if (paymentsError) throw paymentsError;
    }

    return sale;
  },

  // Get sales with details for a user
  async getSalesWithDetails(userId, limit = 50, offset = 0) {
    const { data, error } = await supabase
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
      .eq('usuario_id', userId)
      .order('fecha_hora', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    return data;
  },

  // Get user's products
  async getUserProducts(userId) {
    const { data, error } = await supabase
      .from('Productos')
      .select(`
        *,
        Precios_producto(*) 
      `)
      .eq('usuario_id', userId)
      .eq('disponible', true)
      .order('nombre');

    if (error) throw error;
    return data;
  },

  // Get payment methods
  async getPaymentMethods() {
    const { data, error } = await supabase
      .from('Metodos_pago')
      .select('*')
      .eq('disponible', true)
      .order('nombre');

    if (error) throw error;
    return data;
  }
};

module.exports = {
  supabase,
  supabaseAdmin,
  testConnection,
  dbHelpers
}; 