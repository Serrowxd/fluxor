# Inventory Forecasting Dashboard Design and Implementation Guide

## Project Overview
The Inventory Forecasting Dashboard is a SaaS web application designed for small and medium-sized enterprises (SMEs) using Shopify. It leverages AI to forecast inventory needs and send automated restocking alerts, helping businesses optimize stock levels and reduce costs. This document updates the design for modifying an existing project, focusing on Shopify integration, basic forecasting, and essential features for the Minimum Viable Product (MVP) to validate the concept with users.

## Goals
- Deliver a user-friendly dashboard for inventory management, adhering to the project's existing styling.
- Integrate with Shopify to fetch sales and inventory data.
- Implement AI-driven demand forecasting using Facebook's Prophet.
- Send automated email alerts for low stock levels.
- Enable users to download inventory reports in CSV format.

## Scope (MVP)
- **Integration**: Shopify only.
- **Forecasting**: Basic demand predictions using Prophet.
- **Alerts**: Email notifications for low stock.
- **Dashboard**: Simple interface with charts and tables, following existing styling.
- **Reports**: Exportable CSV files.

## Technical Architecture
- **Frontend**: Next.js for a fast, responsive UI with server-side rendering, using the project's existing styling framework.
- **Backend**: Node.js with Express for a lightweight, flexible API.
- **Database**: PostgreSQL for structured data storage (scalable and reliable for MVP).
- **AI Model**: Python microservice using Prophet for forecasting.
- **Message Queue**: Redis to handle Shopify API rate limiting and async tasks.
- **APIs**:
  - **Shopify API**: Fetch sales and inventory data.
  - **Mailgun API**: Send email alerts.
- **Hosting**: Vercel for frontend and backend (serverless functions for API); Heroku for the Python microservice.

## Edge Cases and Mitigations
To ensure robustness, the following edge cases are addressed:

- **Shopify API Rate Limiting**:
  - **Issue**: Shopify limits API requests to 2 per second (REST API).
  - **Mitigation**: Use Redis to queue API requests, throttling them with a leaky bucket algorithm to stay within limits.
  
- **Data Inconsistencies**:
  - **Issue**: Sync interruptions or API failures could lead to outdated or incomplete data.
  - **Mitigation**: Use Shopify webhooks (`orders/create`, `inventory_levels/update`) for real-time updates. Implement a retry mechanism with exponential backoff (max 3 retries).

- **Forecasting with Limited Data**:
  - **Issue**: New products with <30 days of sales history may produce unreliable forecasts.
  - **Mitigation**: Fallback to a 7-day moving average for products with insufficient data. Display a warning in the UI for low-confidence forecasts, using existing styling for notifications.

- **Multiple Stores**:
  - **Issue**: MVP focuses on single-store integration, but future multi-store support is anticipated.
  - **Mitigation**: Design the database schema with foreign keys to support multiple stores per user, ensuring scalability.

- **Time Zones and Date Formats**:
  - **Issue**: Inconsistent time handling could skew forecasting or reporting.
  - **Mitigation**: Store all timestamps in UTC. Use `date-fns` for client-side time zone conversions based on user settings, integrated with existing UI components.

- **Alert Fatigue**:
  - **Issue**: Frequent alerts for the same product could annoy users.
  - **Mitigation**: Implement a 24-hour cooldown period per product for alerts. Allow users to set custom stock thresholds in Settings, using existing form components.

- **Data Privacy and Security**:
  - **Issue**: Shopify access tokens and user data are sensitive.
  - **Mitigation**: Encrypt tokens using Node.js `crypto` with AES-256. Use JWT for authentication. Restrict API access with role-based access control (RBAC).

- **User Input Errors**:
  - **Issue**: Invalid Shopify credentials or misconfigured settings could break integration.
  - **Mitigation**: Validate inputs during setup. Display error messages using existing error handling components.

## Data Model
The PostgreSQL schema is designed for scalability and efficient querying, compatible with the existing project.

### Tables
- **Users**:
  - `user_id` (UUID, Primary Key)
  - `email` (VARCHAR, Unique, Not Null)
  - `password` (VARCHAR, Hashed, Not Null)
- **Stores**:
  - `store_id` (UUID, Primary Key)
  - `user_id` (UUID, Foreign Key to `users.user_id`)
  - `store_name` (VARCHAR, Not Null)
  - `access_token` (VARCHAR, Encrypted, Not Null)
- **Products**:
  - `product_id` (UUID, Primary Key)
  - `store_id` (UUID, Foreign Key to `stores.store_id`)
  - `shopify_product_id` (VARCHAR, Not Null)
  - `product_name` (VARCHAR, Not Null)
  - `sku` (VARCHAR, Not Null)
- **Inventory**:
  - `inventory_id` (UUID, Primary Key)
  - `product_id` (UUID, Foreign Key to `products.product_id`)
  - `current_stock` (INTEGER, Not Null)
  - `last_updated` (TIMESTAMP, UTC, Not Null)
- **Sales**:
  - `sale_id` (UUID, Primary Key)
  - `product_id` (UUID, Foreign Key to `products.product_id`)
  - `quantity_sold` (INTEGER, Not Null)
  - `sale_date` (TIMESTAMP, UTC, Not Null)
- **Forecasts**:
  - `forecast_id` (UUID, Primary Key)
  - `product_id` (UUID, Foreign Key to `products.product_id`)
  - `forecast_date` (DATE, Not Null)
  - `predicted_demand` (FLOAT, Not Null)

### Schema SQL
```sql
CREATE TABLE users (
  user_id UUID PRIMARY KEY,
  email VARCHAR UNIQUE NOT NULL,
  password VARCHAR NOT NULL
);

CREATE TABLE stores (
  store_id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(user_id),
  store_name VARCHAR NOT NULL,
  access_token VARCHAR NOT NULL
);

CREATE TABLE products (
  product_id UUID PRIMARY KEY,
  store_id UUID REFERENCES stores(store_id),
  shopify_product_id VARCHAR NOT NULL,
  product_name VARCHAR NOT NULL,
  sku VARCHAR NOT NULL
);

CREATE TABLE inventory (
  inventory_id UUID PRIMARY KEY,
  product_id UUID REFERENCES products(product_id),
  current_stock INTEGER NOT NULL,
  last_updated TIMESTAMP NOT NULL
);

CREATE TABLE sales (
  sale_id UUID PRIMARY KEY,
  product_id UUID REFERENCES products(product_id),
  quantity_sold INTEGER NOT NULL,
  sale_date TIMESTAMP NOT NULL
);

CREATE TABLE forecasts (
  forecast_id UUID PRIMARY KEY,
  product_id UUID REFERENCES products(product_id),
  forecast_date DATE NOT NULL,
  predicted_demand FLOAT NOT NULL
);
```

## API Design
All endpoints are RESTful, secured with JWT, and return JSON with standard HTTP status codes (200, 400, 401, 500, etc.). APIs integrate with the existing project’s authentication and error handling.

### Authentication
- **`POST /api/auth/signup`**:
  - **Request**: `{ email: string, password: string }`
  - **Response**: `{ user_id: string, email: string }`
  - **Logic**: Validate email format and password strength (min 8 characters, mixed case, numbers). Hash password with `bcrypt`.
- **`POST /api/auth/login`**:
  - **Request**: `{ email: string, password: string }`
  - **Response**: `{ token: string }` (JWT in HTTP-only cookie)
  - **Logic**: Verify credentials, issue JWT with 24-hour expiry.
- **`GET /api/auth/me`**:
  - **Response**: `{ user_id: string, email: string }`
  - **Logic**: Protected route, validate JWT from cookie.

### Shopify Integration
- **`GET /api/shopify/authorize`**:
  - **Response**: Redirect to Shopify OAuth URL.
  - **Logic**: Generate OAuth URL with scopes (`read_orders`, `read_inventory`).
- **`GET /api/shopify/callback`**:
  - **Response**: Redirect to dashboard.
  - **Logic**: Validate HMAC, store encrypted access token in `stores` table.
- **`GET /api/shopify/stores`**:
  - **Response**: `[ { store_id: string, store_name: string } ]`
  - **Logic**: Fetch user’s connected stores from database.

### Inventory and Sales
- **`GET /api/inventory`**:
  - **Response**: `[ { product_id: string, product_name: string, current_stock: number, last_updated: string } ]`
  - **Logic**: Join `products` and `inventory` tables, filter by user’s `store_id`.
- **`POST /api/inventory/sync`**:
  - **Response**: `{ success: boolean }`
  - **Logic**: Enqueue sync task in Redis, fetch data via Shopify API.

### Forecasting
- **`GET /api/forecast`**:
  - **Response**: `[ { product_id: string, forecast_date: string, predicted_demand: number } ]`
  - **Logic**: Query `forecasts` table for user’s products.
- **`POST /api/forecast/run`**:
  - **Response**: `{ success: boolean }`
  - **Logic**: Trigger async forecast job, call Python microservice.

### Alerts
- **`GET /api/alerts`**:
  - **Response**: `[ { product_id: string, message: string, timestamp: string } ]`
  - **Logic**: Fetch recent alerts from database.
- **`POST /api/alerts/send`**:
  - **Request**: `{ product_id: string }`
  - **Response**: `{ success: boolean }`
  - **Logic**: Send test email via Mailgun (for debugging).

## Frontend Design
The frontend leverages the existing project’s styling and UI components, ensuring consistency with the established design system.

### Layout
```
[Navbar: Logo | Dashboard | Reports | Settings | Logout]
[Sidebar: Navigation Links (collapsible on mobile)]
[Main Content]
  [Chart: Sales Trends (Line Chart)]
  [Chart: Inventory Levels (Bar Chart)]
  [Table: Reorder Suggestions]
```

### Pages
- **Login**: Form with email/password fields, using existing form components and error handling.
- **Signup**: Registration form with email/password confirmation, reusing existing validation logic.
- **Dashboard**: Displays stock, forecasts, and reorder suggestions, using existing chart and table components.
- **Reports**: Table of downloadable CSV reports, integrated with existing download UI.
- **Settings**: Manage Shopify integration, alert thresholds, and time zone, using existing form components.

### Components
- **Charts**:
  - **Sales Trends**: Line chart (Chart.js) showing sales over time, styled per existing design.
  - **Inventory Levels**: Bar chart showing current stock per product, using existing chart styling.
- **Tables**:
  - **Reorder Suggestions**: Sortable table with columns (`product_name`, `current_stock`, `predicted_demand`, `reorder_amount`), styled per existing tables.
- **Alerts**:
  - Dismissible notification banners for recent alerts or sync status, using existing notification components.
- **Forms**:
  - Login/signup forms with client-side validation, reusing existing form components.
  - Settings form for alert thresholds and time zone, integrated with existing UI.

## Integrations
### Shopify
- **Authentication**: OAuth flow with scopes (`read_orders`, `read_inventory`). Encrypt access tokens with Node.js `crypto` (AES-256).
- **Data Fetching**:
  - REST API endpoints: `/admin/api/2023-10/orders.json`, `/admin/api/2023-10/inventory_levels.json`.
  - Handle pagination using `Link` header.
- **Webhooks**:
  - Register `orders/create` and `inventory_levels/update` for real-time updates.
  - Validate HMAC signatures for security.
- **Rate Limiting**: Use Redis `bull` queue to throttle requests, ensuring compliance with Shopify’s 2 requests/second limit.

### Mailgun
- **Setup**: Configure API key and domain in environment variables.
- **Templates**: Create reusable email templates for low-stock alerts (`Subject: Low Stock Alert for {product_name}`).
- **Implementation**: POST to `/messages` endpoint with recipient, template, and variables.

### Prophet Microservice
- **Framework**: Python Flask.
- **Endpoint**: `POST /forecast` (accepts sales data, returns predictions).
- **Logic**:
  - Input: Sales data formatted as `{ ds: date, y: quantity_sold }`.
  - Use Prophet for products with >30 days of data; fallback to 7-day moving average otherwise.
  - Cache results in Redis with 24-hour TTL.
- **Deployment**: Dockerize and deploy to Heroku.

## Detailed Implementation Guide
### 1. Project Setup
- **Monorepo Structure** (assuming existing project structure):
  ```
  /inventory-forecasting
  ├── /frontend (Next.js, using existing styling)
  ├── /backend (Node.js/Express)
  ├── /ai (Python/Flask)
  ```
- **Dependencies**:
  - Frontend: `next`, `chart.js`, `react-chartjs-2`, `swr`, `date-fns` (extend existing dependencies).
  - Backend: `express`, `jsonwebtoken`, `bcrypt`, `pg`, `bull`, `crypto`.
  - AI: `flask`, `fbprophet`, `pandas`, `redis`.
- **Environment Variables**:
  - `DATABASE_URL`: PostgreSQL connection string.
  - `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`: Shopify credentials.
  - `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`: Mailgun credentials.
  - `JWT_SECRET`: For token signing.
  - `REDIS_URL`: Redis connection.

### 2. Authentication
- Extend existing authentication system:
  - Use `jsonwebtoken` for JWT generation/validation.
  - Store hashed passwords with `bcrypt`.
  - Set HTTP-only, secure cookies for JWTs.
  - Add middleware to protect new routes, aligning with existing auth logic.

### 3. Shopify Integration
- **OAuth Flow**:
  - Generate OAuth URL with `shopify-api-node`.
  - Handle callback, validate HMAC, store encrypted token.
- **Webhooks**:
  - Register webhooks using Shopify Admin API.
  - Process webhook payloads in queued jobs, integrating with existing backend workers.
- **Data Sync**:
  - Use `bull` to queue sync tasks.
  - Fetch orders and inventory levels, store in `sales` and `inventory` tables.
  - Retry failed API calls with exponential backoff.

### 4. Data Syncing and Storage
- **Sync Process**:
  - Cron job (every 6 hours) triggers sync via `/api/inventory/sync`.
  - Use webhooks for real-time updates to minimize API calls.
- **Database**:
  - Use `pg` for PostgreSQL queries, extending existing database setup.
  - Index `sales.sale_date` and `inventory.last_updated` for performance.
- **Error Handling**:
  - Log sync failures to database, using existing logging system.
  - Notify users of persistent issues via email, styled with existing notification components.

### 5. Forecasting Microservice
- **Flask Setup**:
  - Expose `/forecast` endpoint accepting JSON payload.
  - Use `pandas` to preprocess sales data.
- **Prophet Logic**:
  - Filter sales by product, group by day.
  - Run Prophet for >30 days of data; else use moving average.
  - Cache results in Redis with 24-hour TTL.
- **Integration**:
  - Backend calls microservice via HTTP.
  - Store forecasts in `forecasts` table.

### 6. Dashboard and Alerts
- **Dashboard**:
  - Use SWR for optimistic data fetching, integrating with existing data hooks.
  - Render charts with `react-chartjs-2`, styled per existing charts.
  - Implement pagination for reorder suggestions table, using existing table components.
- **Alerts**:
  - Check stock levels against thresholds every 6 hours.
  - Use Mailgun to send emails with 24-hour cooldown.
  - Store alerts in database for audit trail, displayed via existing notification components.
- **Error States**:
  - Show loading states during sync, using existing spinners.
  - Display error banners for failed API calls, styled per existing error handling.

### 7. Reports
- **Generation**:
  - Use `csv-writer` to create CSV files from database queries.
  - Include columns: `product_name`, `sku`, `current_stock`, `predicted_demand`.
- **Download**:
  - Serve CSV via `/api/reports/download` endpoint.
  - Use temporary signed URLs for security, integrated with existing download logic.

## Testing Strategy
- **Unit Tests** (Jest):
  - Test authentication logic (signup, login), extending existing test suite.
  - Test data transformation for forecasting.
  - Test new component rendering.
- **Integration Tests** (Supertest):
  - Test API endpoints with mock Shopify responses.
  - Test webhook processing, using existing test mocks.
- **E2E Tests** (Cypress):
  - Test user flows: signup, Shopify connect, dashboard view, report download, using existing test setup.
- **Load Testing**:
  - Simulate 100 concurrent users syncing stores.
  - Test Redis queue under high load.

## Deployment
- **Frontend/Backend**: Vercel (serverless functions for API routes), aligning with existing deployment.
- **Microservice**: Heroku with Docker for Python app.
- **Database**: Managed PostgreSQL (e.g., Supabase), extending existing database.
- **CI/CD**: GitHub Actions for automated testing and deployment, integrated with existing pipeline.
- **Monitoring**:
  - Use Vercel logs for frontend/backend.
  - Monitor Heroku metrics for microservice.
  - Extend existing error tracking (e.g., Sentry) for new features.

## Improvements Over Previous Document
- **Edge Cases**: Added handling for user input errors, time zone issues, and alert fatigue.
- **Scalability**: Designed schema for multi-store support; added Redis for async tasks.
- **Security**: Emphasized token encryption and RBAC.
- **Reliability**: Introduced webhooks for real-time updates and retry mechanisms.
- **Testing**: Expanded testing strategy with load testing.
- **Performance**: Optimized database with indexes and caching.
- **Adaptation**: Removed styling details, leveraging existing project styling for seamless integration.

## Implementation Status and Changes

### Completed Features

#### 1. Backend Infrastructure ✅
- **Express.js API Server**: Set up at `/backend` with modular structure
- **PostgreSQL Database**: Schema created with all required tables
- **Database Models**: Created models for User, Store, Product, Sale, and Forecast
- **Redis Configuration**: Set up for caching and queue management
- **Migration Script**: Created at `/backend/src/utils/migrate.js`

#### 2. Authentication System ✅
- **JWT Authentication**: Implemented with HTTP-only cookies
- **Login Page**: Created at `/app/login/page.tsx` with form validation
- **Signup Page**: Created at `/app/signup/page.tsx` with password requirements
- **Auth Context**: Created authentication provider for state management
- **Protected Routes**: Implemented route protection wrapper

#### 3. Database Models ✅
- **User Model**: Handles user creation, authentication, and password management
- **Store Model**: Manages Shopify store connections with encrypted tokens
- **Product Model**: Tracks products and inventory levels
- **Sale Model**: Records sales data with aggregation capabilities
- **Forecast Model**: Stores demand predictions with confidence levels

#### 4. Forecasting Microservice ✅
- **Python Flask Service**: Created at `/ai` with Prophet integration
- **Smart Fallback**: Uses 7-day moving average for products with limited data
- **Redis Caching**: Implements 24-hour cache for forecast results
- **Dockerfile**: Prepared for containerized deployment

#### 5. Dashboard UI ✅
- **Sales Chart**: Line chart component showing sales trends
- **Inventory Chart**: Bar chart displaying current stock levels
- **Reorder Suggestions**: Sortable table with urgency indicators
- **Responsive Design**: Mobile-friendly layout using existing theme
- **Real-time Updates**: Sync button for manual data refresh

#### 6. Settings Page ✅
- **Shopify Integration**: UI for connecting/reconnecting stores
- **Alert Configuration**: Threshold and email preference settings
- **Timezone Selection**: Regional settings for accurate reporting
- **Persistent Storage**: Settings saved to user profile

### Pending Features

#### 1. Shopify Integration 🔄
- OAuth flow implementation needed
- Webhook registration for real-time updates
- API rate limiting with Redis queue

#### 2. Inventory Sync System 🔄
- Bull queue setup for background jobs
- Shopify API data fetching
- Retry mechanism with exponential backoff

#### 3. Email Alerts 🔄
- Mailgun integration
- Alert cooldown logic (24-hour per product)
- Email templates for low stock notifications

#### 4. Reports Export 🔄
- CSV generation functionality
- Temporary signed URLs for downloads
- Report history tracking

#### 5. Error Handling 🔄
- Comprehensive error boundaries in frontend
- API error standardization
- User-friendly error messages

### Key Architectural Decisions

1. **Monorepo Structure**: Kept frontend and backend in single repository for easier development
2. **Existing UI Components**: Leveraged the project's existing component library for consistency
3. **Mock Data**: Dashboard currently uses mock data for demonstration until Shopify integration is complete
4. **Modular Backend**: Organized code into models, controllers, routes, and middleware for maintainability
5. **Security First**: Implemented token encryption, HTTPS-only cookies, and input validation

### Next Steps

1. Complete Shopify OAuth implementation
2. Set up webhook endpoints for real-time inventory updates
3. Implement the inventory sync worker with rate limiting
4. Configure Mailgun and create email templates
5. Add comprehensive error handling and logging
6. Deploy services (Vercel for frontend/backend, Heroku for Python service)
7. Set up monitoring and alerting
8. Create user documentation and API reference

### Environment Setup

To run the project locally:

1. Install PostgreSQL and Redis
2. Copy `backend/.env.example` to `backend/.env` and fill in values
3. Run database migrations: `cd backend && npm run migrate`
4. Install dependencies: `npm install` and `cd backend && npm install`
5. Start services:
   - Frontend: `npm run dev`
   - Backend: `cd backend && npm run dev`
   - Python service: `cd ai && pip install -r requirements.txt && python src/app.py`

This implementation provides a solid foundation for the Inventory Forecasting Dashboard MVP, with core functionality in place and a clear path for completing the remaining features.

## Modular Refactor Status

### Overview
The project is currently undergoing a transition from monolithic architecture to a microservices-based modular architecture. This refactor aims to improve scalability, maintainability, and deployment flexibility.

### Module Structure
The new modular architecture is being implemented in the `/modules` directory with the following structure:

#### Business Domains
- **analytics-intelligence**: Analytics and intelligence services
- **channel-integration**: Multi-channel connector implementations
- **order-management**: Order processing and management
- **procurement-domain**: Procurement and supplier management
- **procurement**: Legacy procurement module (to be merged)

#### Core Platform
- **service-registry**: Service discovery and registration
- **tenant-management**: Multi-tenancy support

#### Infrastructure
- **cache**: Caching layer abstraction
- **monitoring**: Observability and monitoring
- **queue**: Message queue abstraction

#### Support Services
- **api-gateway**: API gateway and routing
- **configuration**: Centralized configuration management
- **notification**: Notification service (email, SMS, push)
- **shared**: Shared types and utilities

### Migration Strategy
1. **Phase 1**: Create module structure and interfaces (COMPLETED)
2. **Phase 2**: Extract services from monolith to modules (IN PROGRESS)
3. **Phase 3**: Implement inter-service communication
4. **Phase 4**: Deploy modules as separate services
5. **Phase 5**: Deprecate monolithic components

### Current Implementation Status
- ✅ Module directory structure created
- ✅ Base interfaces defined for each module
- 🔄 Service extraction in progress
- ⏳ Inter-service communication pending
- ⏳ Deployment configuration pending

### AI Agent Implementation Guidelines

#### For LLMs/AI Agents Working on This Project

##### Context Understanding
1. **Read CLAUDE.md first** - Contains essential commands and project conventions
2. **Check existing implementations** - Always review similar features before creating new ones
3. **Follow established patterns** - Maintain consistency with existing code style

##### Module Development
When implementing new features in the modular architecture:
1. Identify the appropriate module based on domain boundaries
2. Create interfaces before implementations
3. Use dependency injection for cross-module communication
4. Write comprehensive tests for module boundaries
5. Document module APIs and contracts

##### Code Organization
```typescript
// Module structure example
modules/
  [domain-name]/
    src/
      interfaces/     // Public contracts
      services/       // Business logic
      models/         // Domain models
      controllers/    // API endpoints
      __tests__/      // Unit tests
    package.json      // Module dependencies
    README.md         // Module documentation
```

##### Testing Requirements
- Unit tests: Minimum 90% coverage per module
- Integration tests: Test module boundaries
- Contract tests: Verify inter-module communication
- Performance tests: Ensure no degradation

##### Security Considerations
- All modules must implement authentication middleware
- Input validation at module boundaries
- Encrypted communication between modules
- Audit logging for all operations

##### Deployment Notes
- Each module should be independently deployable
- Use environment variables for configuration
- Implement health checks and readiness probes
- Support graceful shutdown

### Key Decisions for AI Implementation

#### Database Access
- Modules should not directly access other modules' databases
- Use API calls or events for cross-module data access
- Each module maintains its own data store if needed

#### State Management
- Stateless services preferred
- Use Redis for shared state when necessary
- Implement idempotent operations

#### Error Handling
- Standardized error format across all modules
- Circuit breakers for external service calls
- Proper error propagation and logging

#### Monitoring
- Structured logging with correlation IDs
- Metrics collection for all operations
- Distributed tracing support

### Development Workflow for AI Agents

1. **Understand the domain** - Read relevant module documentation
2. **Check existing patterns** - Review similar implementations
3. **Plan the implementation** - Use TodoWrite tool to track tasks
4. **Implement incrementally** - Small, testable changes
5. **Test thoroughly** - Unit, integration, and contract tests
6. **Document changes** - Update module README and API docs
7. **Validate conventions** - Run linters and formatters

### Common Pitfalls to Avoid
- Don't create tight coupling between modules
- Avoid shared databases across modules
- Don't skip error handling and validation
- Never hardcode configuration values
- Don't forget to update tests and documentation

This modular refactor represents a significant architectural evolution of Fluxor, transforming it from a monolithic application to a scalable, maintainable microservices architecture suitable for enterprise deployment.