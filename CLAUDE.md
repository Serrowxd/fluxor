# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Fluxor is an enterprise-grade inventory management system with AI-powered forecasting capabilities. It consists of:
- **Frontend**: Next.js 15 app with React 19, TypeScript, and shadcn/ui components
- **Backend**: Express.js API with PostgreSQL, Redis, and comprehensive testing
- **AI Service**: Python Flask microservice using Facebook Prophet for demand forecasting

## Essential Commands

### Development Workflow

```bash
# Start all services (run in separate terminals)
npm run dev                      # Frontend on http://localhost:3000
cd backend && npm run dev        # Backend API on http://localhost:3001
cd ai && python src/app.py       # AI service on http://localhost:5000

# Database operations
cd backend && npm run migrate    # Run database migrations

# Testing
cd backend && npm test           # Run backend tests
cd backend && npm run test:coverage  # Generate coverage report

# Linting
npm run lint                     # Lint frontend code
```

### Single Test Execution

```bash
# Run a specific test file
cd backend && npm test -- src/__tests__/services/analyticsService.test.js

# Run tests matching a pattern
cd backend && npm test -- --testNamePattern="should calculate inventory turnover"

# Run tests in watch mode for a specific file
cd backend && npm test -- --watch src/__tests__/services/forecastService.test.js
```

## Code Architecture

### Frontend Structure
- **app/**: Next.js 15 app router pages using server and client components
- **components/dashboard/**: Dashboard-specific components (MetricsCard, InventoryChart, etc.)
- **components/ui/**: shadcn/ui reusable components (40+ components)
- **lib/utils.ts**: Utility functions including `cn()` for className merging
- **contexts/**: AuthContext for authentication, ThemeContext for dark mode

### Backend Architecture
- **Controllers**: Business logic in `backend/src/controllers/` - each handles specific API endpoints
- **Services**: Core business services in `backend/src/services/` including:
  - `analyticsService.js`: Metrics calculations and dead stock detection
  - `forecastService.js`: Integration with AI microservice
  - `channelConnectorService.js`: Multi-channel inventory sync
  - `purchaseOrderService.js`: Automated PO generation
- **Models**: Database queries in `backend/src/models/` - using raw SQL with PostgreSQL
- **Middleware**: Auth (`authMiddleware.js`), validation, error handling
- **Jobs**: Background processing with Bull queue in `backend/src/jobs/`

### AI Service Structure
- **Flask app**: `ai/src/app.py` - RESTful API for forecasting
- **Prophet integration**: Multi-model ensemble with external factor support
- **Redis caching**: Forecast results cached for performance

### Testing Architecture
- **Backend tests**: Comprehensive unit tests in `backend/src/__tests__/`
- **Test coverage**: 95%+ target with mocked dependencies
- **Test patterns**: Service layer testing with mocked models and external services

## Key Development Patterns

### Authentication Flow
- JWT tokens with refresh token rotation
- Tokens stored in httpOnly cookies
- AuthContext manages client-side auth state
- Protected routes use `authMiddleware` on backend

### Database Patterns
- Raw SQL queries with parameterized statements
- Transaction support for complex operations
- Audit trails on all critical tables
- Optimistic locking for inventory updates

### API Conventions
- RESTful endpoints: `/api/v1/{resource}`
- Consistent error responses with status codes
- Input validation using Joi schemas
- Rate limiting on all endpoints

### Component Patterns
- Server components by default in app directory
- Client components marked with "use client"
- Consistent prop interfaces with TypeScript
- shadcn/ui components for all UI elements

### State Management
- Server state: Direct fetching in server components
- Client state: React hooks and context
- Form state: react-hook-form with Zod validation
- Theme state: next-themes integration

## Security Considerations

- All API endpoints require authentication except auth routes
- Input validation on all user inputs
- SQL injection prevention through parameterized queries
- XSS protection via React's built-in escaping
- CORS configured for production domains only
- Rate limiting to prevent abuse
- Secrets in environment variables only

## Common Tasks

### Adding a New API Endpoint
1. Create route in `backend/src/routes/`
2. Add controller method in `backend/src/controllers/`
3. Implement business logic in `backend/src/services/`
4. Add model queries if needed in `backend/src/models/`
5. Write tests in `backend/src/__tests__/`

### Creating a New Dashboard Component
1. Create component in `components/dashboard/`
2. Use shadcn/ui components from `components/ui/`
3. Follow existing patterns for data fetching
4. Add proper TypeScript types
5. Ensure responsive design with Tailwind

### Modifying Database Schema
1. Create migration script in `backend/src/migrations/`
2. Update relevant models in `backend/src/models/`
3. Run migration: `cd backend && npm run migrate`
4. Update tests to reflect changes