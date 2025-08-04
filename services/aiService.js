const OpenAI = require('openai');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const { dbHelpers, supabaseAdmin } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { 
  buildSystemPrompt: createSystemPrompt, 
  buildExtractionPrompt: createExtractionPrompt, 
  buildInsightsPrompt: createInsightsPrompt 
} = require('./systemPrompt');

class AIService {
  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    
    this.model = process.env.OPENAI_MODEL || 'gpt-3.5-turbo-1106';
    this.maxTokens = parseInt(process.env.OPENAI_MAX_TOKENS) || 1000;
    this.temperature = parseFloat(process.env.OPENAI_TEMPERATURE) || 0.5;
  }

  /**
   * Extract user ID from JWT token
   */
  extractUserIdFromToken(userToken) {
    try {
      const payload = jwt.decode(userToken);
      if (!payload || !payload.sub) {
        throw new Error('Invalid token payload');
      }
      return payload.sub; // This is the user's UUID from Supabase auth
    } catch (error) {
      logger.error('Failed to extract user ID from token:', {
        error: error.message,
        tokenSample: userToken ? userToken.substring(0, 20) + '...' : 'none'
      });
      throw new Error('Invalid user token');
    }
  }

  /**
   * Main conversation handler - processes user input and returns AI response
   */
  async processConversation(userInput, userId, conversationContext = [], userToken = null) {
    const startTime = Date.now();
    
    try {
      // Validate token format
      if (userToken) {
        const tokenParts = userToken.split('.');
        if (tokenParts.length !== 3) {
          logger.error('AI Service received invalid JWT token:', {
            userId,
            tokenParts: tokenParts.length,
            tokenSample: userToken.substring(0, 50) + '...'
          });
          throw new Error(`Invalid JWT token format: Expected 3 parts, got ${tokenParts.length}`);
        }
      }

      // Extract authenticated user ID from token for database operations
      const authenticatedUserId = userToken ? this.extractUserIdFromToken(userToken) : userId;
      
      // Get user context using service role (bypasses RLS)
      let user;
      try {
        user = await dbHelpers.getUserById(authenticatedUserId);
      } catch (error) {
        logger.error('Failed to get user context for AI processing:', {
          userId: authenticatedUserId,
          error: error.message
        });
        throw new Error(`User context error: ${error.message}`);
      }

      const userProducts = await dbHelpers.getUserProducts(authenticatedUserId);
      const recentSales = await dbHelpers.getSalesWithDetails(authenticatedUserId, 5);
      const paymentMethods = await dbHelpers.getPaymentMethods();

      // Build system prompt with business context
      const systemPrompt = this.buildSystemPrompt(user, userProducts, paymentMethods, recentSales);
      
      // Check if input contains business data to extract
      const extractionResult = await this.extractBusinessData(userInput, authenticatedUserId, userProducts, paymentMethods);
      
      // Generate AI response
      const aiResponse = await this.generateResponse(
        systemPrompt, 
        userInput, 
        conversationContext,
        extractionResult
      );

      const processingTime = Date.now() - startTime;
      
      // Log interaction
      logger.logAIInteraction(
        authenticatedUserId, 
        userInput, 
        aiResponse.content, 
        processingTime, 
        aiResponse.tokensUsed
      );

      return {
        response: aiResponse.content,
        dataExtracted: extractionResult.extracted,
        processingTime,
        tokensUsed: aiResponse.tokensUsed
      };

    } catch (error) {
      logger.error('AI Service Error:', error);
      throw new Error('Failed to process conversation: ' + error.message);
    }
  }

  /**
   * Extract business data from natural language input
   */
  async extractBusinessData(input, userId, products, paymentMethods) {
    const extractionPrompt = createExtractionPrompt(input, products, paymentMethods);

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: extractionPrompt }],
        temperature: 0.1, // Low temperature for consistent extraction
        max_tokens: 800
      });

      const extractedData = JSON.parse(response.choices[0].message.content);
      
      // Log what was extracted for debugging
      logger.info('Data extraction result:', {
        userId,
        input: input.substring(0, 100) + '...',
        hasSaleData: extractedData.hasSaleData,
        hasExpenseData: extractedData.hasExpenseData,
        extractedTotal: extractedData.sale?.total || 0,
        itemCount: extractedData.sale?.items?.length || 0
      });
      
      // Validate extracted sale data before saving
      if (extractedData.hasSaleData && extractedData.sale) {
        // Validate that we have actual sale data
        if (!extractedData.sale.items || extractedData.sale.items.length === 0) {
          logger.warn('Sale extraction had no items, skipping save:', {
            userId,
            input: input.substring(0, 100) + '...'
          });
          return { extracted: false, reason: 'No items in sale' };
        }

        // Validate that all items have valid data
        const invalidItems = extractedData.sale.items.filter(item => 
          !item.quantity || item.quantity <= 0 || 
          !item.unit_price || item.unit_price <= 0 ||
          !item.product_name
        );

        if (invalidItems.length > 0) {
          logger.warn('Sale extraction had invalid items, skipping save:', {
            userId,
            invalidItems,
            input: input.substring(0, 100) + '...'
          });
          return { extracted: false, reason: 'Invalid item data' };
        }

        // Validate total
        if (!extractedData.sale.total || extractedData.sale.total <= 0) {
          logger.warn('Sale extraction had invalid total, skipping save:', {
            userId,
            total: extractedData.sale.total,
            input: input.substring(0, 100) + '...'
          });
          return { extracted: false, reason: 'Invalid total amount' };
        }

        const savedSale = await this.saveSaleData(extractedData.sale, userId);
        return {
          extracted: true,
          type: 'sale',
          data: extractedData.sale,
          savedSale
        };
      }

      // TODO: Handle expense data extraction and saving
      if (extractedData.hasExpenseData && extractedData.expense) {
        return {
          extracted: true,
          type: 'expense',
          data: extractedData.expense
        };
      }

      return { extracted: false };

    } catch (error) {
      logger.error('Data extraction error:', error);
      return { extracted: false, error: error.message };
    }
  }

  /**
   * Save extracted sale data to database
   */
  async saveSaleData(saleData, userId) {
    try {
      const saleId = uuidv4();
      
      // Cliente
      let clienteId = null;
      if (saleData.customer) {
        try {
          clienteId = await dbHelpers.getOrCreateCustomer(userId, saleData.customer);
        } catch (error) {
          logger.error('Failed to get/create customer:', {
            userId,
            customer: saleData.customer,
            error: error.message
          });
        }
      }

      // Prepare sale record
      const sale = {
        venta_id: saleId,
        usuario_id: userId,
        total_venta: saleData.total,
        fecha_hora: new Date().toISOString(),
        incompleta: false,
        anulada: false,
        cliente_id: clienteId
      };

      // Enhanced payment processing with method matching
      const paymentMethods = await dbHelpers.getPaymentMethods();
      const payments = saleData.payment_methods.map(payment => {
        let methodId = payment.method_id;
        
        // If method_id is null, try to match by name
        if (!methodId && payment.method_name) {
          methodId = this.matchPaymentMethod(payment.method_name, paymentMethods);
        }
        
        return {
          pago_id: uuidv4(),
          venta_id: saleId,
          metodo_id: methodId,
          monto: payment.amount
        };
      });

      logger.info('Preparing to save sale data with enhanced pricing:', {
        userId,
        saleId,
        total: saleData.total,
        itemCount: saleData.items.length,
        paymentCount: payments.length
      });

      // Create sale first
      const { data: createdSale, error: saleError } = await supabaseAdmin
        .from('Ventas')
        .insert(sale)
        .select()
        .single();

      if (saleError) {
        logger.error('Failed to create sale:', saleError);
        throw saleError;
      }

      // Process each item with enhanced pricing workflow
      const processedItems = [];
      for (const item of saleData.items) {
        try {
          const productId = await this.processSaleWithPricing(
            userId,
            item.product_name,
            item.unit_price,
            item.quantity,
            saleId,
            item.presentation || null
          );
          processedItems.push({ ...item, product_id: productId });
        } catch (error) {
          logger.error('Failed to process sale item with pricing:', {
            item,
            error: error.message
          });
          throw error;
        }
      }

      // Create payments
      if (payments.length > 0) {
        const { error: paymentsError } = await supabaseAdmin
          .from('Pagos_venta')
          .insert(payments);

        if (paymentsError) {
          logger.error('Failed to create sale payments:', paymentsError);
          throw paymentsError;
        }
      }

      logger.logDBOperation('CREATE', 'Ventas', userId, { 
        saleId, 
        total: saleData.total,
        itemCount: processedItems.length,
        paymentCount: payments.length
      });

      return createdSale;

    } catch (error) {
      logger.error('Failed to save sale data:', error);
      throw error;
    }
  }

  /**
   * Enhanced product auto-creation with price tracking
   */
  async autoCreateProduct(usuarioId, nombreProducto, precioVenta) {
    try {
      const productId = uuidv4();
      
      // 1. Create the product with auto_creado flag
      const { error: productError } = await supabaseAdmin
        .from('Productos')
        .insert({
          producto_id: productId,
          usuario_id: usuarioId,
          nombre: nombreProducto,
          auto_creado: true,
          descripcion: `Auto-created from sale`,
          disponible: true
        });

      if (productError) {
        logger.error('Failed to create product:', productError);
        return null;
      }

      // 2. Create the initial price record with vigente_desde
      const { error: priceError } = await supabaseAdmin
        .from('Precios_producto')
        .insert({
          producto_id: productId,
          precio_unitario: precioVenta,
          vigente_desde: new Date().toISOString()
          // vigente_hasta stays null (current price)
        });

      if (priceError) {
        logger.error('Failed to create product price:', priceError);
        // Don't fail the entire operation if price creation fails
      }

      logger.info('Auto-created product with price tracking:', {
        productId,
        nombreProducto,
        precioVenta,
        usuarioId
      });

      return productId;
    } catch (error) {
      logger.error('Error auto-creating product with price:', error);
      return null;
    }
  }

  /**
   * Update product price with historical tracking
   */
  async updateProductPrice(productoId, nuevoPrecio) {
    try {
      // 1. Close current price period
      const { error: closeError } = await supabaseAdmin
        .from('Precios_producto')
        .update({ vigente_hasta: new Date().toISOString() })
        .eq('producto_id', productoId)
        .is('vigente_hasta', null);

      if (closeError) {
        logger.error('Failed to close current price period:', closeError);
        return false;
      }

      // 2. Create new price record
      const { error: newPriceError } = await supabaseAdmin
        .from('Precios_producto')
        .insert({
          producto_id: productoId,
          precio_unitario: nuevoPrecio,
          vigente_desde: new Date().toISOString()
        });

      if (newPriceError) {
        logger.error('Failed to create new price record:', newPriceError);
        return false;
      }

      logger.info('Updated product price with historical tracking:', {
        productoId,
        nuevoPrecio
      });

      return true;
    } catch (error) {
      logger.error('Error updating product price:', error);
      return false;
    }
  }

  /**
   * Get current price for a product
   */
  async getCurrentPrice(productoId) {
    try {
      const { data, error } = await supabaseAdmin
        .from('Precios_producto')
        .select('precio_unitario')
        .eq('producto_id', productoId)
        .is('vigente_hasta', null)
        .single();
      
      if (error) {
        logger.error('Failed to get current price:', error);
        return null;
      }
      
      return data?.precio_unitario;
    } catch (error) {
      logger.error('Error getting current price:', error);
      return null;
    }
  }

  /**
   * Get price history for a product
   */
  async getPriceHistory(productoId) {
    try {
      const { data, error } = await supabaseAdmin
        .from('Precios_producto')
        .select('precio_unitario, vigente_desde, vigente_hasta')
        .eq('producto_id', productoId)
        .order('vigente_desde', { ascending: false });
      
      if (error) {
        logger.error('Failed to get price history:', error);
        return [];
      }
      
      return data || [];
    } catch (error) {
      logger.error('Error getting price history:', error);
      return [];
    }
  }

  /**
   * Enhanced sale processing with price management
   */
  async processSaleWithPricing(usuarioId, nombreProducto, precioVenta, cantidad, ventaId, presentation = null) {
    try {
      // 1. Check if product exists using database helper
      let producto = await dbHelpers.getProductByName(usuarioId, nombreProducto);

      if (!producto) {
        // Auto-create product with price
        const newProductId = await this.autoCreateProduct(usuarioId, nombreProducto, precioVenta);
        if (newProductId) {
          producto = { producto_id: newProductId, nombre: nombreProducto };
        } else {
          throw new Error(`Failed to auto-create product: ${nombreProducto}`);
        }
      } else {
        // Check if price changed for existing product
        const precioActual = await dbHelpers.getCurrentPrice(producto.producto_id);
        
        // Update price if it changed
        if (precioActual === null || precioActual !== precioVenta) {
          await this.updateProductPrice(producto.producto_id, precioVenta);
        }
      }

      // Create sale detail with producto_id (not producto_alt)
      const { error: detailError } = await supabaseAdmin
        .from('Detalle_ventas')
        .insert({
          detalle_id: uuidv4(),
          venta_id: ventaId,
          producto_id: producto.producto_id, // Use real product ID
          promo_id: null,
          precio_unitario: precioVenta,
          cantidad: cantidad,
          subtotal: precioVenta * cantidad,
          producto_alt: nombreProducto, // guardar descripción tal cual se mencionó
          presentacion: presentation
        });

      if (detailError) {
        logger.error('Failed to create sale detail:', detailError);
        throw detailError;
      }

      logger.info('Processed sale with pricing:', {
        productoId: producto.producto_id,
        nombreProducto,
        precioVenta,
        cantidad,
        ventaId
      });

      return producto.producto_id;
    } catch (error) {
      logger.error('Error processing sale with pricing:', error);
      throw error;
    }
  }

  /**
   * Create missing product when mentioned in sale (DEPRECATED - use autoCreateProduct instead)
   */
  async createMissingProduct(productName, price, userId) {
    try {
      const productId = uuidv4();
      
      // Create product
      const { error: productError } = await supabaseAdmin
        .from('Productos')
        .insert({
          producto_id: productId,
          usuario_id: userId,
          nombre: productName,
          descripcion: `Auto-created from sale`,
          disponible: true,
          creado_en: new Date().toISOString()
        });

      if (productError) {
        logger.error('Failed to create product:', productError);
        return null;
      }

      // Create default price
      const { error: priceError } = await supabaseAdmin
        .from('Precios_producto')
        .insert({
          precio_id: uuidv4(),
          producto_id: productId,
          precio: price,
          fecha_inicio: new Date().toISOString(),
          activo: true
        });

      if (priceError) {
        logger.error('Failed to create product price:', priceError);
      }

      logger.info('Auto-created product:', {
        productId,
        productName,
        price,
        userId
      });

      return productId;
    } catch (error) {
      logger.error('Error creating missing product:', error);
      return null;
    }
  }

  /**
   * Smart payment method matching for better payment detection
   */
  matchPaymentMethod(methodName, availableMethods) {
    if (!methodName) return null;
    
    const normalizedInput = methodName.toLowerCase().trim();
    
    // Direct matches
    const directMatch = availableMethods.find(method => 
      method.nombre.toLowerCase() === normalizedInput
    );
    if (directMatch) return directMatch.metodo_id;
    
    // Enhanced variations mapping
    const variations = {
      'mp': 'mercadopago',
      'mercado pago': 'mercadopago', 
      'efectivo': 'efectivo',
      'cash': 'efectivo',
      'tarjeta': 'tarjeta',
      'card': 'tarjeta',
      'debito': 'débito',
      'credito': 'crédito',
      'qr': 'billetera digital',
      'codigo qr': 'billetera digital',
      'billetera': 'billetera digital',
      'billetera digital': 'billetera digital',
      'transferencia': 'transferencia',
      'transfer': 'transferencia'
    };
    
    const variation = variations[normalizedInput];
    if (variation) {
      const varMatch = availableMethods.find(method => 
        method.nombre.toLowerCase().includes(variation)
      );
      if (varMatch) return varMatch.metodo_id;
    }
    
    // Partial matches
    const partialMatch = availableMethods.find(method => 
      method.nombre.toLowerCase().includes(normalizedInput) ||
      normalizedInput.includes(method.nombre.toLowerCase())
    );
    if (partialMatch) return partialMatch.metodo_id;
    
    return null;
  }

  /**
   * Generate AI response using OpenAI
   */
  async generateResponse(systemPrompt, userInput, context, extractionResult) {
    const messages = [
      { role: 'system', content: systemPrompt }
    ];

    // Add conversation context
    if (context && context.length > 0) {
      messages.push(...context.slice(-10)); // Keep last 10 messages for context
    }

    // Add current user input
    messages.push({ role: 'user', content: userInput });

    // If we extracted data, inform the AI
    if (extractionResult.extracted) {
      const dataPrompt = `
The user's message contained business data that has been automatically processed:
- Type: ${extractionResult.type}
- Data: ${JSON.stringify(extractionResult.data, null, 2)}
${extractionResult.savedSale ? `- Saved to database with ID: ${extractionResult.savedSale.venta_id}` : ''}

Acknowledge this transaction naturally and provide relevant business insights.
`;
      messages.push({ role: 'system', content: dataPrompt });
    }

    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages,
      temperature: this.temperature,
      max_tokens: this.maxTokens
    });

    return {
      content: response.choices[0].message.content,
      tokensUsed: response.usage.total_tokens
    };
  }

  /**
   * Build system prompt with user context
   */
  buildSystemPrompt(user, products, paymentMethods, recentSales) {
    return createSystemPrompt(user, products, paymentMethods, recentSales);
  }

  /**
   * Generate business insights
   */
  async generateInsights(userId, timeframe = '30 days') {
    try {
      const sales = await dbHelpers.getSalesWithDetails(userId, 100);
      
      // Calculate basic metrics
      const totalRevenue = sales.reduce((sum, sale) => sum + parseFloat(sale.total_venta), 0);
      const averageTransaction = totalRevenue / sales.length;
      const totalTransactions = sales.length;

      const insightPrompt = createInsightsPrompt(totalRevenue, totalTransactions, averageTransaction, timeframe);

      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: insightPrompt }],
        temperature: 0.8,
        max_tokens: 500
      });

      return response.choices[0].message.content;

    } catch (error) {
      logger.error('Failed to generate insights:', error);
      throw error;
    }
  }
}

module.exports = new AIService(); 