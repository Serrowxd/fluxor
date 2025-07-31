# Inventory Forecasting Dashboard - Implementation Guide

## Overview

This document provides a detailed guide to the implementation of the Inventory Forecasting Dashboard, an AI-powered inventory management system for Shopify stores. The project has been built as an extension to an existing Next.js application, leveraging the existing UI components and styling.

## Project Structure

```
/workspace
├── app/                    # Next.js app directory
│   ├── login/             # Authentication pages
│   ├── signup/
│   ├── dashboard/         # Main dashboard
│   └── settings/          # User settings
├── backend/               # Express.js backend
│   ├── src/
│   │   ├── controllers/   # Request handlers
│   │   ├── middleware/    # Auth, validation, error handling
│   │   ├── models/        # Database models
│   │   ├── routes/        # API endpoints
│   │   ├── services/      # Business logic
│   │   └── utils/         # Helper functions
│   └── config/            # Database and Redis config
├── ai/                    # Python forecasting service
│   └── src/
│       └── app.py         # Flask application
├── components/
│   ├── dashboard/         # New dashboard components
│   │   ├── sales-chart.tsx
│   │   ├── inventory-chart.tsx
│   │   └── reorder-suggestions.tsx
│   └── fluxor/         # Existing UI components
└── lib/                   # Utility functions
    ├── auth-context.tsx   # Authentication provider
    └── protected-route.tsx # Route protection
```

## Completed Implementation

### 1. Backend Infrastructure

#### Express.js Server (`backend/src/index.js`)

- RESTful API with modular architecture
- CORS enabled for frontend communication
- Rate limiting to prevent abuse
- Comprehensive middleware stack (helmet, morgan, cookie-parser)

#### Database Schema (`backend/src/utils/migrate.js`)

- PostgreSQL with optimized indexes
- Tables: users, stores, products, inventory, sales, forecasts, alerts, user_settings
- UUID primary keys for better distribution
- Foreign key constraints for data integrity

#### Configuration

- Environment-based configuration
- Secure token encryption for Shopify credentials
- Redis for caching and queue management

### 2. Authentication System

#### Features Implemented

- JWT-based authentication with HTTP-only cookies
- Bcrypt password hashing
- Email/password validation with Joi
- Session management with 24-hour expiry

#### Frontend Components

- **Login Page**: Form validation, error handling, redirect on success
- **Signup Page**: Password strength requirements, confirmation matching
- **Auth Context**: Global state management for user authentication
- **Protected Routes**: Automatic redirect for unauthenticated users

### 3. Database Models

#### User Model (`backend/src/models/User.js`)

```javascript
- create(): Creates new user with hashed password
- findByEmail(): Retrieves user by email
- findById(): Retrieves user by ID
- verifyPassword(): Compares passwords securely
- updatePassword(): Updates user password
```

#### Store Model (`backend/src/models/Store.js`)

```javascript
- create(): Creates store with encrypted access token
- findByUserId(): Gets all stores for a user
- findById(): Retrieves store with decrypted token
- encryptToken()/decryptToken(): AES-256 encryption
```

#### Product Model (`backend/src/models/Product.js`)

```javascript
- create(): Upserts product information
- findByStoreId(): Lists all products for a store
- updateStock(): Updates inventory levels
- getLowStockProducts(): Identifies products needing reorder
```

#### Sale Model (`backend/src/models/Sale.js`)

```javascript
- create()/bulkCreate(): Records sales transactions
- getAggregatedSales(): Groups sales by time period
- getTotalSales(): Summarizes sales by product
```

#### Forecast Model (`backend/src/models/Forecast.js`)

```javascript
- create()/bulkCreate(): Stores predictions
- getLatestForecasts(): Retrieves upcoming predictions
- getReorderSuggestions(): Calculates reorder quantities
```

### 4. Forecasting Microservice

#### Python Flask Service (`ai/src/app.py`)

- Prophet integration for time series forecasting
- Intelligent fallback to moving average for limited data
- Redis caching with 24-hour TTL
- RESTful API endpoint for forecast generation

#### Key Features

- Handles seasonal patterns (daily, weekly)
- Confidence level calculation based on data quantity
- Non-negative demand predictions
- Dockerized for easy deployment

### 5. Dashboard UI

#### Sales Chart Component

- Recharts line chart implementation
- Responsive design with theme support
- Daily sales trend visualization

#### Inventory Chart Component

- Bar chart showing current stock vs thresholds
- Color-coded for easy identification
- Supports dark/light themes

#### Reorder Suggestions Table

- Sortable columns for all metrics
- Urgency badges (high/medium/low)
- Action buttons for quick reordering
- Pagination-ready structure

### 6. Settings Page

#### Features

- Shopify store connection management
- Alert threshold configuration
- Email notification preferences
- Timezone selection for reporting
- Real-time settings persistence

## Edge Cases Handled

### 1. Authentication

- Token expiration handling
- Invalid credentials feedback
- Password strength validation
- Session persistence across refreshes

### 2. Data Integrity

- Foreign key constraints
- Unique constraints on critical fields
- Transaction support for atomic operations
- Null value handling

### 3. Forecasting

- Insufficient data fallback
- Negative prediction prevention
- Cache invalidation strategy
- Error recovery mechanisms

### 4. UI/UX

- Loading states for all async operations
- Error messages with recovery actions
- Empty state handling
- Mobile responsiveness

## Security Measures

1. **Authentication**

   - JWT tokens with secure signing
   - HTTP-only cookies to prevent XSS
   - CSRF protection via SameSite cookies

2. **Data Protection**

   - AES-256 encryption for Shopify tokens
   - Bcrypt for password hashing
   - Input validation on all endpoints

3. **API Security**
   - Rate limiting per IP
   - CORS configuration
   - Helmet.js for security headers

## Performance Optimizations

1. **Database**

   - Indexes on frequently queried columns
   - Connection pooling
   - Query optimization with JOINs

2. **Caching**

   - Redis for forecast results
   - 24-hour cache TTL
   - Cache warming strategies

3. **Frontend**
   - Lazy loading of components
   - Optimistic UI updates
   - Debounced API calls

## Testing Considerations

### Unit Tests

- Model methods validation
- Authentication logic
- Forecast calculations

### Integration Tests

- API endpoint testing
- Database operations
- Authentication flow

### E2E Tests

- User signup/login flow
- Dashboard interactions
- Settings management

## Deployment Guide

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Redis 6+
- Python 3.11+

### Environment Variables

```env
# Database
DATABASE_URL=postgresql://user:password@host:5432/dbname

# JWT
JWT_SECRET=your-secret-key
JWT_EXPIRY=24h

# Shopify
SHOPIFY_API_KEY=your-api-key
SHOPIFY_API_SECRET=your-api-secret

# Redis
REDIS_URL=redis://localhost:6379

# Mailgun
MAILGUN_API_KEY=your-api-key
MAILGUN_DOMAIN=your-domain
```

### Local Development

```bash
# Install dependencies
npm install
cd backend && npm install
cd ../ai && pip install -r requirements.txt

# Run migrations
cd backend && npm run migrate

# Start services
npm run dev                    # Frontend (port 3000)
cd backend && npm run dev      # Backend (port 3001)
cd ai && python src/app.py     # AI service (port 5000)
```

### Production Deployment

#### Frontend & Backend (Vercel)

```bash
vercel --prod
```

#### Python Service (Heroku)

```bash
cd ai
heroku create your-app-name
heroku git:remote -a your-app-name
git push heroku main
```

## Remaining Work

### High Priority

1. **Shopify OAuth Implementation**

   - OAuth flow completion
   - Webhook registration
   - API client setup

2. **Inventory Sync Worker**

   - Bull queue implementation
   - Rate limiting logic
   - Error retry mechanism

3. **Email Alerts**
   - Mailgun integration
   - Template creation
   - Cooldown implementation

### Medium Priority

1. **Reports Module**

   - CSV generation
   - Download endpoints
   - Report scheduling

2. **Error Handling**
   - Global error boundary
   - User-friendly messages
   - Error logging

### Low Priority

1. **Performance Monitoring**

   - APM integration
   - Custom metrics
   - Alerting setup

2. **Documentation**
   - API documentation
   - User guide
   - Video tutorials

## Troubleshooting

### Common Issues

1. **Database Connection Failed**

   - Check DATABASE_URL format
   - Verify PostgreSQL is running
   - Check network connectivity

2. **Redis Connection Error**

   - Ensure Redis server is running
   - Verify REDIS_URL is correct
   - Check firewall settings

3. **Authentication Issues**

   - Clear browser cookies
   - Check JWT_SECRET matches
   - Verify token expiry settings

4. **Forecast Service Errors**
   - Check Python dependencies
   - Verify Redis connectivity
   - Review error logs

## Best Practices

1. **Code Organization**

   - Keep controllers thin
   - Business logic in models/services
   - Reusable utility functions

2. **Error Handling**

   - Always use try-catch blocks
   - Return meaningful error messages
   - Log errors for debugging

3. **Security**

   - Never commit secrets
   - Validate all inputs
   - Use prepared statements

4. **Performance**
   - Implement pagination
   - Use database indexes
   - Cache expensive operations

## Conclusion

This implementation provides a robust foundation for the Inventory Forecasting Dashboard. The modular architecture allows for easy extension and maintenance. Focus on completing the Shopify integration and worker processes to deliver a fully functional MVP.

For questions or support, refer to the inline code documentation or the design specification in `/specs/design.md`.
