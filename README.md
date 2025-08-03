# Perla AI Backend - Voice-First Business Consultant

An intelligent AI backend service that transforms natural conversation into structured business data. Built for small businesses to manage operations through voice interaction.

## 🚀 Features

- **AI-Powered Conversation**: OpenAI-powered natural language processing
- **Automatic Data Extraction**: Converts speech to structured business data
- **Multi-Tenant Architecture**: Secure user isolation with Supabase Auth
- **Real-Time Analytics**: Business intelligence and insights generation
- **Production Ready**: Comprehensive logging, error handling, and rate limiting
- **Railway Deployment**: One-click deployment to Railway

## 📋 Prerequisites

- Node.js 18+ 
- Supabase project (database + auth)
- OpenAI API key
- Railway account (for deployment)

## 🛠️ Installation

### 1. Clone and Install Dependencies

```bash
git clone <your-repo>
cd backend-2
npm install
```

### 2. Environment Setup

Copy the environment template:
```bash
cp env.example .env
```

Configure your `.env` file:
```env
# Server Configuration
NODE_ENV=development
PORT=3000
FRONTEND_URL=http://localhost:8080

# Supabase Configuration
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_KEY=your_supabase_service_role_key

# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-3.5-turbo
OPENAI_MAX_TOKENS=1000
OPENAI_TEMPERATURE=0.7

# Logging
LOG_LEVEL=info
```

### 3. Database Setup

Your Supabase database should already have the required schema. The backend automatically validates the connection on startup.

### 4. Start Development Server

```bash
npm run dev
```

The server will start on `http://localhost:3000`

## 🔑 API Endpoints

### Authentication
- `POST /api/users/register` - Register new user
- `POST /api/users/login` - User login
- `POST /api/users/logout` - User logout
- `GET /api/users/profile` - Get user profile
- `PUT /api/users/profile` - Update user profile

### AI Conversation
- `POST /api/conversation` - Main AI conversation endpoint
- `POST /api/conversation/insights` - Generate business insights
- `GET /api/conversation/context` - Get conversation context

### Sales Management
- `GET /api/sales` - Get user sales (with pagination)
- `GET /api/sales/:saleId` - Get specific sale details
- `DELETE /api/sales/:saleId` - Cancel a sale
- `GET /api/sales/analytics/summary` - Sales analytics summary

### Business Analytics
- `GET /api/analytics/dashboard` - Main dashboard analytics
- `GET /api/analytics/products` - Product performance analytics
- `GET /api/analytics/trends` - Sales trends and forecasting

### Health Check
- `GET /health` - Server health status

## 🤖 AI Conversation API

### Main Conversation Endpoint

**POST** `/api/conversation`

Process user input with AI and extract business data.

**Headers:**
```
Authorization: Bearer <supabase_access_token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "message": "I just sold 3 consulting packages to ABC Corp for $5K each, paid by transfer",
  "context": [
    {
      "role": "user",
      "content": "Previous user message"
    },
    {
      "role": "assistant", 
      "content": "Previous AI response"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "response": "Great! I've logged $15K from ABC Corp. Your monthly total is now $47K.",
    "dataExtracted": true,
    "processingTime": 1250,
    "tokensUsed": 450
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### Data Extraction

The AI automatically extracts and stores:
- **Sales Data**: Products, quantities, prices, customers
- **Payment Information**: Payment methods and amounts
- **Business Metrics**: Revenue, transaction counts

Example extraction from: *"Sold 2 coffee machines to Hotel Plaza for $800 each, paid half cash half card"*

Automatically creates:
- Sale record in `Ventas` table
- Line items in `Detalle_ventas` table  
- Payment records in `Pagos_venta` table

## 🔐 Authentication

Uses Supabase Auth with JWT tokens:

1. **Register/Login** via `/api/users/login`
2. **Include Bearer token** in Authorization header
3. **Token validation** on protected routes

## 📊 Business Intelligence

### Dashboard Analytics
Get comprehensive business metrics:
- Revenue and transaction counts
- Growth comparisons
- Top products and payment methods
- Daily sales trends

### Product Analytics
Detailed product performance:
- Revenue per product
- Quantity sold
- Price history
- Transaction frequency

### Trend Analysis
Sales forecasting and patterns:
- Historical trends
- Growth direction
- Seasonal patterns

## 🚀 Railway Deployment

### Quick Deploy

1. **Connect Repository** to Railway
2. **Set Environment Variables** in Railway dashboard
3. **Deploy** - Railway auto-detects and builds

### Environment Variables for Railway

Set these in your Railway project settings:

```
NODE_ENV=production
PORT=8080
FRONTEND_URL=https://your-frontend-domain.com
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_KEY=your_service_key
OPENAI_API_KEY=your_openai_key
LOG_LEVEL=info
```

## 🏗️ Architecture

```
Frontend (Electron)
    ↓ Speech-to-Text (Azure)
    ↓ HTTP Request
Backend (Node.js/Express)
    ↓ AI Processing (OpenAI)
    ↓ Data Extraction
    ↓ Storage
Database (Supabase)
```

### Key Components

- **AI Service**: OpenAI integration with data extraction
- **Database Layer**: Supabase connection and helpers
- **Authentication**: JWT validation middleware
- **Error Handling**: Comprehensive error management
- **Logging**: Winston-based structured logging
- **Rate Limiting**: API protection and throttling

## 🛡️ Security Features

- **JWT Authentication** with Supabase
- **Rate Limiting** (100 requests/15min, 20 AI requests/min)
- **Input Validation** with express-validator
- **CORS Protection** with configurable origins
- **Error Sanitization** (no sensitive data leaks)
- **Request Logging** for audit trails

## 📝 Logging

Structured logging with Winston:
- **Console Output** (development)
- **File Logging** (production)
- **AI Interaction Tracking**
- **Database Operation Logs**
- **Error Stack Traces**

Log files stored in `logs/` directory:
- `combined.log` - All logs
- `error.log` - Error logs only

## 🧪 Testing

```bash
# Run tests
npm test

# Run with coverage
npm run test:coverage
```

## 📈 Monitoring

Health check endpoint provides:
- Server status
- Uptime
- Environment
- Database connectivity

Example: `GET /health`
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 3600,
  "environment": "production"
}
```

## 🔧 Development

### Local Development
```bash
npm run dev  # Nodemon with auto-restart
```

### Production
```bash
npm start    # Standard Node.js start
```

### Environment Variables
- Development: Use `.env` file
- Production: Set via Railway dashboard

## 📚 API Documentation

Full API documentation available at: `/api/docs` (when implemented)

For detailed request/response examples, see the route files in `/routes/` directory.

## 🤝 Contributing

1. Fork the repository
2. Create feature branch
3. Commit changes
4. Push to branch  
5. Create Pull Request

## 📄 License

ISC License - see LICENSE file for details.

---

**Built for the future of voice-first business management** 🎯 