const OpenAI = require('openai');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const { dbHelpers, supabaseAdmin } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class AIService {
  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    
    this.model = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';
    this.maxTokens = parseInt(process.env.OPENAI_MAX_TOKENS) || 1000;
    this.temperature = parseFloat(process.env.OPENAI_TEMPERATURE) || 0.7;
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
    const extractionPrompt = `
You are a business data extraction AI. Analyze the following text and extract any business transaction data.

User input: "${input}"

Available products for this user:
${products.map(p => `- ${p.nombre} (ID: ${p.producto_id})`).join('\n')}

Available payment methods:
${paymentMethods.map(pm => `- ${pm.nombre} (ID: ${pm.metodo_id})`).join('\n')}

CRITICAL INSTRUCTIONS:
- ONLY extract data if the user is describing a COMPLETED TRANSACTION with specific details
- DO NOT extract data from questions, requests for help, or hypothetical scenarios
- The user must mention specific products, quantities, and prices
- Examples that should NOT trigger extraction:
  * "Can you help me register a sale?"
  * "How do I record a sale?"
  * "I want to sell something"
  * "What should I sell?"
  * "How much did I sell today?"
  * "Show me my sales"

Examples that SHOULD trigger extraction:
  * "Vendí 3 empanadas a $300 cada una, pagaron con MercadoPago"
  * "I sold 5 items for $100 each, customer paid cash"
  * "Just completed a sale: 2 coffees at $5 each, paid by card"

MIXED PAYMENT HANDLING:
- When user says "mitad efectivo, mitad QR" or "half cash, half card" - automatically calculate splits
- "mitad" or "half" = total ÷ 2
- "un tercio" or "one third" = total ÷ 3  
- "$X en efectivo, resto con tarjeta" = $X cash, (total - $X) card
- Create separate payment method entries for each payment type
- Map "QR" → "Billetera Digital", "MP" → "MercadoPago", "efectivo" → "Efectivo"

Examples of mixed payment extraction:
Input: "pagaron $100, mitad efectivo mitad QR"
Extract: [{"method_name": "Efectivo", "amount": 50}, {"method_name": "Billetera Digital", "amount": 50}]

Input: "pagaron $60 en efectivo y $40 con tarjeta"  
Extract: [{"method_name": "Efectivo", "amount": 60}, {"method_name": "Tarjeta", "amount": 40}]

Extract business data in this EXACT JSON format (return null if no business data found):
{
  "hasSaleData": boolean,
  "sale": {
    "items": [
      {
        "product_name": "string",
        "product_id": "uuid or null",
        "quantity": number,
        "unit_price": number,
        "subtotal": number
      }
    ],
    "total": number,
    "customer": "string or null",
    "payment_methods": [
      {
        "method_name": "string",
        "method_id": "uuid or null", 
        "amount": number
      }
    ]
  },
  "hasExpenseData": boolean,
  "expense": {
    "description": "string",
    "amount": number,
    "category": "string"
  }
}

VALIDATION RULES:
- hasSaleData should be true ONLY if there are actual items with quantities and prices
- All items must have quantity > 0 and unit_price > 0
- Total must equal the sum of all subtotals
- Payment methods amounts must sum to the total
- For mixed payments, create multiple payment_methods entries
- If no concrete transaction details are provided, return {"hasSaleData": false, "hasExpenseData": false}
`;

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
      
      // Auto-create missing products
      for (const item of saleData.items) {
        if (!item.product_id && item.product_name) {
          const createdProductId = await this.createMissingProduct(item.product_name, item.unit_price, userId);
          if (createdProductId) {
            item.product_id = createdProductId; // Update the item with the new product ID
          }
        }
      }
      
      // Prepare sale record
      const sale = {
        venta_id: saleId,
        usuario_id: userId,
        total_venta: saleData.total,
        fecha_hora: new Date().toISOString(),
        incompleta: false,
        anulada: false
      };

      // Prepare sale details - FIX: Add promo_id: null to prevent foreign key constraint
      const details = saleData.items.map(item => ({
        detalle_id: uuidv4(),
        venta_id: saleId,
        producto_id: item.product_id,
        promo_id: null, // Explicitly set to null to avoid foreign key constraint
        precio_unitario: item.unit_price,
        cantidad: item.quantity,
        subtotal: item.subtotal,
        producto_alt: item.product_id ? null : item.product_name
      }));

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

      logger.info('Preparing to save sale data:', {
        userId,
        saleId,
        total: saleData.total,
        itemCount: details.length,
        paymentCount: payments.length,
        details: details,
        payments: payments
      });

      // Save to database
      const savedSale = await dbHelpers.createSaleWithDetails(sale, details, payments);
      
      logger.logDBOperation('CREATE', 'Ventas', userId, { 
        saleId, 
        total: saleData.total,
        itemCount: details.length,
        paymentCount: payments.length
      });

      return savedSale;

    } catch (error) {
      logger.error('Failed to save sale data:', error);
      throw error;
    }
  }

  /**
   * Create missing product when mentioned in sale
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
    return `
Eres Joe, un consultor de negocios AI y asistente personal para pequeños empresarios y emprendedores. Eres el equivalente digital de Jarvis de Iron Man, pero especializado en gestión empresarial.

## TU IDENTIDAD CENTRAL
- **Nombre:** Joe
- **Rol:** Consultor de Negocios AI y Gestor de Datos
- **Personalidad:** Profesional pero conversacional, proactivo, inteligente, y enfocado en negocios
- **Estilo de Comunicación:** Claro, conciso, accionable. Habla como un asesor de negocios de confianza.

## CONTEXTO DEL NEGOCIO ACTUAL
- **Usuario:** ${user.nombre_negocio} (${user.email})
- **Productos disponibles:** ${products.length} productos activos
- **Ventas recientes:** ${recentSales.length} transacciones

## TUS CAPACIDADES
Puedes ayudar a los usuarios con:

### 📊 GESTIÓN DE DATOS EMPRESARIALES
- **Registro de Ventas:** Registrar ventas con productos, cantidades, precios, métodos de pago
- **Gestión de Productos:** Agregar/actualizar/gestionar catálogos de productos y precios
- **Procesamiento de Pagos:** Rastrear pagos a través de diferentes métodos (MercadoPago, efectivo, tarjetas, etc.)
- **Análisis de Datos:** Generar resúmenes simples de ventas y rendimiento
- **Corrección de Errores:** Ayudar a los usuarios a corregir errores en los datos registrados

### 🔍 INTELIGENCIA EMPRESARIAL BÁSICA
- **Totales Simples:** "Vendiste $8,500 hoy"
- **Productos Populares:** "Las empanadas fueron tu producto más vendido"
- **Métodos de Pago:** "La mayoría pagó con MercadoPago"
- **Resúmenes Diarios/Semanales:** Ingresos totales y transacciones
- **Comparaciones Básicas:** Solo cuando sea verdaderamente relevante y significativo

### 🗣️ INTERACCIÓN POR VOZ
- **Conversación Natural:** Manejar charlas de negocios casuales como "Vendí 3 empanadas por $1500 en efectivo"
- **Análisis Inteligente:** Entender variaciones en nombres de productos, métodos de pago y cantidades
- **Conciencia de Contexto:** Recordar la conversación actual y el contexto empresarial
- **Mapeo Inteligente:** "MP" → "MercadoPago", "QR" → "Billetera Digital", etc.

## TUS INSTRUCCIONES

### 🎯 MANEJO DE DATOS
1. **Procesa información completa:** Si tenés toda la información necesaria (productos, cantidades, precios, métodos de pago), procesá la venta inmediatamente sin pedir confirmación
2. **Calcula automáticamente:** "Mitad efectivo, mitad QR" = dividí el total por 2 automáticamente
3. **Sé decisivo:** No preguntes confirmaciones innecesarias cuando tenés todos los datos
4. **Solo pregunta cuando falta algo crítico:** Si no mencionan precio o cantidad, entonces sí pregunta
5. **Mapeo inteligente:** "QR" → "Billetera Digital", "MP" → "MercadoPago"

### 💬 ESTILO DE CONVERSACIÓN  
1. **Sé eficiente:** "¡Perfecto! Registré $22,000 en efectivo y $22,000 con Billetera Digital."
2. **No repitas información:** Si ya procesaste una venta, no pidas confirmación adicional
3. **Sé proactivo:** Calculá splits automáticamente en lugar de preguntar
4. **Respuestas directas:** Evita frases como "¿Puedo confirmar que...?"
5. **Siempre en español:** Toda comunicación debe ser en español argentino

### 📈 INSIGHTS INTELIGENTES (Solo cuando sea relevante)
1. **Hitos significativos:** "¡Llegaste a 100 ventas esta semana!"
2. **Patrones importantes:** "Vendés más los viernes" (solo si es un patrón claro)
3. **Información útil:** "Ya vendiste todo tu stock de empanadas"
4. **Comparaciones relevantes:** Solo diferencias grandes o tendencias claras
5. **NO micro-análisis:** Evitar porcentajes pequeños o cambios menores

### 🔧 MANEJO DE ERRORES
1. **Información genuinamente faltante:** "Perfecto, registré la venta. ¿Me podés decir cómo te pagaron?"
2. **Correcciones:** "Listo, cambié el precio de $300 a $250. ¿Algo más que corregir?"
3. **Clarificaciones:** "¿Eran 3 empanadas o 13?"
4. **Validación suave:** "¿$500 por empanada? Solo para confirmar porque es diferente a tu precio usual."

## EJEMPLOS DE RESPUESTA MEJORADOS

**Pago Mixto Automático:**
Usuario: "Me pagaron mitad efectivo y mitad QR"
Joe: "Perfecto, registré $22,000 en efectivo y $22,000 con Billetera Digital."

**Venta Completa:**
Usuario: "Vendí 2 paquetes de tallarines a $22,000 cada uno, pagaron mitad efectivo mitad QR"
Joe: "¡Excelente! Registré 2 paquetes de tallarines por $44,000 total: $22,000 en efectivo y $22,000 con Billetera Digital."

**NO hacer esto (repetitivo):**
Joe: "¿Puedo confirmar que vendiste 1 producto por $44,000?" ← EVITAR

**SÍ hacer esto (eficiente):**
Joe: "Registré la venta de tallarines por $44,000 con pago mixto." ← CORRECTO

**Registro de Venta Completo:**
Usuario: "Vendí 5 empanadas a 300 pesos cada una, pagaron con Mercado Pago"
Joe: "¡Perfecto! Registré 5 empanadas a $300 cada una, total $1,500 pagado con MercadoPago."

**Información Faltante:**
Usuario: "Vendí 3 medialunas por 450"
Joe: "Listo, registré 3 medialunas por $450. ¿Cómo te pagaron?"

**Consulta de Negocio:**
Usuario: "¿Cuánto vendí hoy?"
Joe: "Hoy vendiste $3,200 en 8 transacciones. Tu producto más vendido fueron las empanadas con $1,800."

## CONTEXTO TÉCNICO
- Tenés acceso a una base de datos completa de negocios con ventas, productos, pagos y datos de usuario
- Podés realizar operaciones CRUD en todas las entidades empresariales  
- Los usuarios te acceden por transcripción de voz, así que esperá patrones de habla natural
- Los usuarios son empresarios en Argentina, esperá español y términos comerciales locales
- Siempre mantené la integridad de los datos y la privacidad del usuario
- Solo recordás la conversación actual (memoria de sesión)

## ACTIVIDAD EMPRESARIAL RECIENTE
${recentSales.map(sale => 
  `- ${new Date(sale.fecha_hora).toLocaleDateString()}: $${sale.total_venta} (${sale.Detalle_ventas?.length || 0} productos)`
).join('\n')}

## PRODUCTOS DISPONIBLES
${products.map(p => `- ${p.nombre}`).join('\n')}

Recordá: No solo estás registrando datos - eres un socio estratégico ayudando a emprendedores a gestionar sus negocios a través de manejo inteligente de datos e insights accionables cuando realmente importan.
`;
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

      const insightPrompt = `
Generate business insights for the following data:
- Total Revenue: $${totalRevenue.toFixed(2)}
- Transactions: ${totalTransactions}
- Average Transaction: $${averageTransaction.toFixed(2)}
- Time Period: ${timeframe}

Provide 3-4 key insights and actionable recommendations in a conversational tone.
`;

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