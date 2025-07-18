const OpenAI = require('openai');
const logger = require('../utils/logger');
const { dbHelpers } = require('../config/database');
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
   * Main conversation handler - processes user input and returns AI response
   */
  async processConversation(userInput, userId, conversationContext = [], userToken = null) {
    const startTime = Date.now();
    
    try {
      // Create RLS-compliant client with user token for database operations
      let userSupabase = null;
      if (userToken) {
        const { createClient } = require('@supabase/supabase-js');
        userSupabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
          global: { 
            headers: { 
              Authorization: `Bearer ${userToken}` 
            } 
          }
        });
      }
      
      // Get user context (use RLS-compliant client for user data)
      const user = userSupabase 
        ? await this.getUserByIdWithRLS(userId, userSupabase)
        : await dbHelpers.getUserById(userId);
      const userProducts = await dbHelpers.getUserProducts(userId);
      const recentSales = await dbHelpers.getSalesWithDetails(userId, 5);
      const paymentMethods = await dbHelpers.getPaymentMethods();

      // Build system prompt with business context
      const systemPrompt = this.buildSystemPrompt(user, userProducts, paymentMethods, recentSales);
      
      // Check if input contains business data to extract
      const extractionResult = await this.extractBusinessData(userInput, userId, userProducts, paymentMethods);
      
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
        userId, 
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

Rules:
- Only extract data if the user is clearly describing a completed transaction
- Match product names to existing products when possible
- Calculate subtotals and totals accurately
- If no business data is present, return {"hasSaleData": false, "hasExpenseData": false}
`;

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: extractionPrompt }],
        temperature: 0.1, // Low temperature for consistent extraction
        max_tokens: 800
      });

      const extractedData = JSON.parse(response.choices[0].message.content);
      
      // If we have sale data, save it to database
      if (extractedData.hasSaleData && extractedData.sale) {
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
      
      // Prepare sale record
      const sale = {
        venta_id: saleId,
        usuario_id: userId,
        total_venta: saleData.total,
        fecha_hora: new Date().toISOString(),
        incompleta: false,
        anulada: false
      };

      // Prepare sale details
      const details = saleData.items.map(item => ({
        detalle_id: uuidv4(),
        venta_id: saleId,
        producto_id: item.product_id,
        precio_unitario: item.unit_price,
        cantidad: item.quantity,
        subtotal: item.subtotal,
        producto_alt: item.product_id ? null : item.product_name
      }));

      // Prepare payments
      const payments = saleData.payment_methods.map(payment => ({
        pago_id: uuidv4(),
        venta_id: saleId,
        metodo_id: payment.method_id,
        monto: payment.amount
      }));

      // Save to database
      const savedSale = await dbHelpers.createSaleWithDetails(sale, details, payments);
      
      logger.logDBOperation('CREATE', 'Ventas', userId, { 
        saleId, 
        total: saleData.total,
        itemCount: details.length 
      });

      return savedSale;

    } catch (error) {
      logger.error('Failed to save sale data:', error);
      throw error;
    }
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
You are Joe, an intelligent AI business consultant and assistant. You help small business owners manage their operations through natural conversation.

BUSINESS CONTEXT:
- User: ${user.nombre_negocio} (${user.email})
- Products: ${products.length} active products
- Recent sales: ${recentSales.length} transactions

YOUR CAPABILITIES:
1. Process and log business transactions from natural language
2. Provide business insights and analytics  
3. Answer questions about sales, products, and performance
4. Help with business planning and decision making
5. Track expenses and revenue

PERSONALITY:
- Professional but friendly
- Proactive in offering insights
- Clear and concise in responses
- Business-focused but personable
- Ask clarifying questions when needed

IMPORTANT RULES:
- Always confirm when transactions are successfully logged
- Provide relevant business metrics when possible
- Be encouraging about business growth
- Offer actionable business advice
- Keep responses concise but helpful

Recent business activity:
${recentSales.map(sale => 
  `- ${new Date(sale.fecha_hora).toLocaleDateString()}: $${sale.total_venta} (${sale.Detalle_ventas?.length || 0} items)`
).join('\n')}

Available products:
${products.map(p => `- ${p.nombre}`).join('\n')}
`;
  }

  /**
   * Get user by ID using RLS-compliant client
   */
  async getUserByIdWithRLS(userId, userSupabase) {
    const { data, error } = await userSupabase
      .from('Usuarios')
      .select('*')
      .eq('usuario_id', userId)
      .single();
    
    if (error) throw error;
    return data;
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