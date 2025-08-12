const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');

// Validate required environment variables
const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_KEY'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  logger.error('Missing required environment variables:', missingEnvVars);
  process.exit(1);
}

// Create Supabase clients
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

// Public client (for user operations like auth)
const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: false
  }
});

// Service role client (for database operations - bypasses RLS)
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

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

// Helper functions for common database operations (using service role)
const dbHelpers = {
  // Get user by ID (using service role)
  async getUserById(userId) {
    const { data, error } = await supabaseAdmin
      .from('Usuarios')
      .select('*')
      .eq('usuario_id', userId)
      .single();
    
    if (error) throw error;
    return data;
  },

  // Create a new sale with details (using service role)
  async createSaleWithDetails(saleData, details, payments) {
    try {
      logger.info('Creating sale with details:', {
        saleData,
        detailsCount: details?.length || 0,
        paymentsCount: payments?.length || 0
      });

      // Determine daily order number for the sale
      const saleDate = new Date(saleData.fecha_hora || new Date());
      const startOfDay = new Date(saleDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(saleDate);
      endOfDay.setHours(23, 59, 59, 999);

      const { data: lastOrderData, error: lastOrderError } = await supabaseAdmin
        .from('Ventas')
        .select('orden_diario')
        .eq('usuario_id', saleData.usuario_id)
        .gte('fecha_hora', startOfDay.toISOString())
        .lte('fecha_hora', endOfDay.toISOString())
        .order('orden_diario', { ascending: false })
        .limit(1);

      if (lastOrderError) {
        logger.error('Failed to fetch daily order:', {
          error: lastOrderError,
          userId: saleData.usuario_id,
          date: saleData.fecha_hora
        });
        throw lastOrderError;
      }

      const nextOrder = (lastOrderData && lastOrderData.length > 0
        ? lastOrderData[0].orden_diario
        : 0) + 1;
      saleData.orden_diario = nextOrder;


      const { data: sale, error: saleError } = await supabaseAdmin
        .from('Ventas')
        .insert(saleData)
        .select()
        .single();

      if (saleError) {
        logger.error('Failed to create sale:', {
          error: saleError,
          saleData
        });
        throw saleError;
      }

      logger.info('Sale created successfully:', {
        saleId: sale.venta_id,
        total: sale.total_venta
      });

      // Insert sale details
      if (details && details.length > 0) {
        const detailsWithSaleId = details.map(detail => ({
          ...detail,
          venta_id: sale.venta_id
        }));

        logger.info('Inserting sale details:', {
          saleId: sale.venta_id,
          detailsCount: detailsWithSaleId.length,
          details: detailsWithSaleId
        });

        const { error: detailsError } = await supabaseAdmin
          .from('Detalle_ventas')
          .insert(detailsWithSaleId);

        if (detailsError) {
          logger.error('Failed to create sale details:', {
            error: detailsError,
            details: detailsWithSaleId,
            saleId: sale.venta_id
          });
          throw detailsError;
        }

        logger.info('Sale details created successfully:', {
          saleId: sale.venta_id,
          detailsCount: detailsWithSaleId.length
        });
      }

      // Insert payments
      if (payments && payments.length > 0) {
        const paymentsWithSaleId = payments.map(payment => ({
          ...payment,
          venta_id: sale.venta_id
        }));

        logger.info('Inserting sale payments:', {
          saleId: sale.venta_id,
          paymentsCount: paymentsWithSaleId.length,
          payments: paymentsWithSaleId
        });

        const { error: paymentsError } = await supabaseAdmin
          .from('Pagos_venta')
          .insert(paymentsWithSaleId);

        if (paymentsError) {
          logger.error('Failed to create sale payments:', {
            error: paymentsError,
            payments: paymentsWithSaleId,
            saleId: sale.venta_id
          });
          throw paymentsError;
        }

        logger.info('Sale payments created successfully:', {
          saleId: sale.venta_id,
          paymentsCount: paymentsWithSaleId.length
        });
      }

      logger.info('Sale creation completed successfully:', {
        saleId: sale.venta_id,
        total: sale.total_venta,
        detailsCount: details?.length || 0,
        paymentsCount: payments?.length || 0
      });

      return sale;
    } catch (error) {
      logger.error('createSaleWithDetails failed:', {
        error: error.message,
        stack: error.stack,
        saleData,
        detailsCount: details?.length || 0,
        paymentsCount: payments?.length || 0
      });
      throw error;
    }
  },

  // Get sales with details for a user (using service role)
  async getSalesWithDetails(userId, limit = 50, offset = 0, includeCancelled = false) {
    let query = supabaseAdmin
      .from('Ventas')
      .select(`
        *,
        Clientes(nombre),
        Detalle_ventas(*,
          Productos(*),
          Promociones(*)
        ),
        Pagos_venta(*,
          Metodos_pago(*)
        )
      `)
      .eq('usuario_id', userId);

    if (!includeCancelled) {
      query = query.eq('anulada', false);
    }

    const { data, error } = await query
      .order('fecha_hora', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    return data;
  },

  // Get user's products (using service role)
  async getUserProducts(userId) {
    const { data, error } = await supabaseAdmin
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

  /**
   * Get sales for a specific date (YYYY-MM-DD) for a user, excluding cancelled, ascending by fecha_hora
   */
  async getSalesByDate(userId, dateISO) {
    const date = new Date(dateISO);
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid dateISO: ${dateISO}`);
    }
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const { data, error } = await supabaseAdmin
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
      .eq('anulada', false)
      .gte('fecha_hora', startOfDay.toISOString())
      .lte('fecha_hora', endOfDay.toISOString())
      .order('fecha_hora', { ascending: true });

    if (error) throw error;
    return data || [];
  },

  // Get all payment methods (using service role)
  async getPaymentMethods() {
    const { data, error } = await supabaseAdmin
      .from('Metodos_pago')
      .select('*')
      .order('nombre');

    if (error) throw error;
    return data;
  },

  // Get current price for a product
  async getCurrentPrice(productoId) {
    const { data, error } = await supabaseAdmin
      .from('Precios_producto')
      .select('precio_unitario')
      .eq('producto_id', productoId)
      .is('vigente_hasta', null)
      .single();
    
    if (error) throw error;
    return data?.precio_unitario;
  },

  // Get price history for a product
  async getPriceHistory(productoId) {
    const { data, error } = await supabaseAdmin
      .from('Precios_producto')
      .select('precio_unitario, vigente_desde, vigente_hasta')
      .eq('producto_id', productoId)
      .order('vigente_desde', { ascending: false });
    
    if (error) throw error;
    return data || [];
  },

  // Check if product exists by name for a user
  async getProductByName(userId, productName) {
    const { data, error } = await supabaseAdmin
      .from('Productos')
      .select('producto_id, nombre')
      .eq('usuario_id', userId)
      .eq('nombre', productName)
      .single();
    
    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      throw error;
    }
    return data;
  },

  // Get or create customer by name for a user
  async getOrCreateCustomer(userId, customerName) {
    if (!customerName) return null;

    // Buscar cliente existente (case-insensitive)
    const { data: existing, error: searchError } = await supabaseAdmin
      .from('Clientes')
      .select('cliente_id')
      .eq('usuario_id', userId)
      .ilike('nombre', customerName)
      .single();

    if (searchError && searchError.code !== 'PGRST116') {
      throw searchError;
    }

    if (existing) return existing.cliente_id;

    // Crear nuevo
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('Clientes')
      .insert({ usuario_id: userId, nombre: customerName })
      .select('cliente_id')
      .single();

    if (insertError) throw insertError;

    return inserted.cliente_id;
  },

  // Cancel a sale by marking it as anulada
  async cancelSale(userId, saleId) {
    // Verify sale ownership
    const { data: sale, error: fetchError } = await supabaseAdmin
      .from('Ventas')
      .select('venta_id, usuario_id, anulada')
      .eq('venta_id', saleId)
      .eq('usuario_id', userId)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        const err = new Error('Sale not found');
        err.code = 'NOT_FOUND';
        throw err;
      }
      throw fetchError;
    }

    if (sale.anulada) {
      const err = new Error('Sale already cancelled');
      err.code = 'ALREADY_CANCELLED';
      throw err;
    }

    const { data: updatedSale, error: updateError } = await supabaseAdmin
      .from('Ventas')
      .update({ anulada: true })
      .eq('venta_id', saleId)
      .select()
      .single();

    if (updateError) throw updateError;

    logger.logDBOperation('UPDATE', 'Ventas', userId, {
      saleId,
      action: 'cancelled'
    });

    return updatedSale;
  }
};

// Expose supabase client for routes that rely on it
dbHelpers.supabase = supabase;

module.exports = {
  supabase,
  supabaseAdmin,
  dbHelpers,
  testConnection
}; 