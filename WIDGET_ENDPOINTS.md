# Widget Endpoints Documentation

## Overview

The widget endpoints provide real-time data for the Perla desktop app's contextual widgets. These endpoints are designed to show users what's being registered during conversations, providing immediate feedback and business insights.

## Authentication

All widget endpoints require authentication via Bearer token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

## Endpoints

### 1. GET `/api/widgets/sales`

Returns recent sales data for the sales widget, including the most recent sale that was just registered.

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `limit` | integer | No | 10 | Number of recent sales to return (1-50) |
| `period` | string | No | week | Time period filter (today, week, month) |

#### Response Format

```json
{
  "success": true,
  "data": {
    "recentSales": [
      {
        "id": "sale_123",
        "customer": "Customer abc12345",
        "amount": 15000.00,
        "products": ["Consulting Package", "Training Session"],
        "timestamp": "2024-01-15T10:30:00Z",
        "status": "completed"
      }
    ],
    "monthlyTotal": 47250.00,
    "totalSales": 47
  }
}
```

#### Example Usage

```bash
# Get last 5 sales from this week
curl -H "Authorization: Bearer <token>" \
     "http://localhost:3000/api/widgets/sales?limit=5&period=week"

# Get today's sales
curl -H "Authorization: Bearer <token>" \
     "http://localhost:3000/api/widgets/sales?period=today"
```

### 2. GET `/api/widgets/payments`

Returns payment breakdown by payment method, showing total income and recent payments.

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `period` | string | No | month | Time period filter (today, week, month) |

#### Response Format

```json
{
  "success": true,
  "data": {
    "totalIncome": 47250.00,
    "paymentBreakdown": {
      "credit_card": 25000.00,
      "bank_transfer": 15000.00,
      "cash": 7250.00
    },
    "recentPayments": [
      {
        "id": "payment_123",
        "amount": 15000.00,
        "method": "bank_transfer",
        "customer": "Customer abc12345",
        "timestamp": "2024-01-15T10:30:00Z"
      }
    ]
  }
}
```

#### Example Usage

```bash
# Get monthly payment breakdown
curl -H "Authorization: Bearer <token>" \
     "http://localhost:3000/api/widgets/payments?period=month"

# Get today's payments
curl -H "Authorization: Bearer <token>" \
     "http://localhost:3000/api/widgets/payments?period=today"
```

### 3. GET `/api/widgets/products`

Returns available products inventory with current prices and stock levels.

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `category` | string | No | - | Filter by product category |
| `status` | string | No | available | Filter by status (available, unavailable, all) |

#### Response Format

```json
{
  "success": true,
  "data": {
    "products": [
      {
        "id": "prod_123",
        "name": "Consulting Package",
        "stock": 50,
        "price": 5000.00,
        "category": "services",
        "status": "available"
      }
    ],
    "totalProducts": 15,
    "lowStock": 3
  }
}
```

#### Example Usage

```bash
# Get all available products
curl -H "Authorization: Bearer <token>" \
     "http://localhost:3000/api/widgets/products?status=available"

# Get all products (including unavailable)
curl -H "Authorization: Bearer <token>" \
     "http://localhost:3000/api/widgets/products?status=all"
```

## Integration with Perla Desktop App

### Real-time Updates

The widget endpoints are designed to be called when specific conversation intents are detected:

1. **Sales Registration**: Call `/api/widgets/sales` after a sale is registered
2. **Payment Processing**: Call `/api/widgets/payments` after payment is processed
3. **Product Updates**: Call `/api/widgets/products` when products are modified

### Widget Triggers

| Conversation Intent | Widget to Update | Endpoint |
|-------------------|------------------|----------|
| "I just sold..." | Sales Widget | `/api/widgets/sales` |
| "Payment received..." | Payments Widget | `/api/widgets/payments` |
| "New product..." | Products Widget | `/api/widgets/products` |
| "Inventory check..." | Products Widget | `/api/widgets/products` |

### Performance Optimization

- **Fast Response Times**: All endpoints optimized for < 500ms response
- **Caching**: Consider implementing client-side caching for static data
- **Pagination**: Large datasets are automatically limited
- **Error Handling**: Graceful degradation with proper error messages

## Error Handling

### Common Error Responses

#### 400 Bad Request
```json
{
  "success": false,
  "error": "Validation failed",
  "details": [
    {
      "param": "limit",
      "msg": "Limit must be between 1 and 50",
      "value": "1000"
    }
  ]
}
```

#### 401 Unauthorized
```json
{
  "success": false,
  "error": "Authentication required"
}
```

#### 500 Internal Server Error
```json
{
  "success": false,
  "error": "Failed to fetch sales data"
}
```

### Error Handling Best Practices

1. **Always check `success` field** in response
2. **Handle network errors** gracefully
3. **Implement retry logic** for transient failures
4. **Show user-friendly messages** for errors
5. **Log errors** for debugging

## CORS Support

The endpoints support CORS for desktop app requests:

```javascript
// CORS configuration in server.js
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:8080',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-User-ID']
}));
```

## Testing

### Manual Testing

Run the test script to verify functionality:

```bash
# Set test environment variables
export BASE_URL="http://localhost:3000"
export TEST_TOKEN="your-test-token"

# Run tests
node test-widgets.js
```

### Test Scenarios

1. **Valid Requests**: Test with proper authentication and parameters
2. **Invalid Parameters**: Test validation error handling
3. **Authentication**: Test with missing/invalid tokens
4. **Empty Data**: Test when no data is available
5. **Large Datasets**: Test with maximum limits

## Security Considerations

### Authentication
- All endpoints require valid JWT tokens
- Tokens are validated on every request
- User ownership is enforced for all data

### Data Access
- Users can only access their own data
- RLS policies enforced at database level
- Service role used for efficient queries

### Input Validation
- All parameters are validated
- SQL injection prevention
- Rate limiting applied

## Performance Metrics

### Response Times
- **Target**: < 500ms for all endpoints
- **Average**: ~200ms for typical requests
- **Peak**: < 1s for complex queries

### Throughput
- **Rate Limit**: 100 requests per 15 minutes per IP
- **Concurrent**: Supports multiple desktop app instances
- **Scalability**: Designed for multi-tenant architecture

## Future Enhancements

### Planned Features
1. **Real-time WebSocket Support**: Live updates without polling
2. **Advanced Filtering**: More granular data filtering options
3. **Export Functionality**: CSV/Excel export for widget data
4. **Custom Widgets**: User-defined widget configurations
5. **Analytics Integration**: Advanced business intelligence features

### API Extensions
1. **Bulk Operations**: Update multiple widgets at once
2. **Subscription Model**: Subscribe to real-time updates
3. **Webhook Support**: Push notifications for data changes
4. **GraphQL Support**: More flexible data querying

## Troubleshooting

### Common Issues

#### Slow Response Times
- Check database connection
- Verify indexes are properly set
- Monitor server resources

#### Authentication Errors
- Verify token is valid and not expired
- Check token format (Bearer <token>)
- Ensure user exists in database

#### Data Not Updating
- Check if new data was actually saved
- Verify user ownership of data
- Check database permissions

#### CORS Errors
- Verify origin is in allowed list
- Check credentials setting
- Ensure proper headers are sent

### Debug Information

Enable debug logging by setting environment variable:

```bash
export DEBUG=true
```

This will provide detailed request/response logging for troubleshooting.

## Conclusion

The widget endpoints provide a robust foundation for real-time data display in the Perla desktop app. They are designed to be:

- **Fast**: Optimized for sub-500ms response times
- **Reliable**: Comprehensive error handling and validation
- **Secure**: Proper authentication and data isolation
- **Scalable**: Designed for multi-tenant architecture
- **Extensible**: Easy to add new widgets and features

The endpoints integrate seamlessly with the existing Perla AI conversation system and provide immediate feedback to users about their business operations.