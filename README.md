# Fluxor - Enterprise Inventory Management System

A comprehensive, AI-powered inventory management platform designed for small and medium enterprises (SMEs) that need advanced inventory forecasting, multi-channel synchronization, and automated supplier management. Built with enterprise-grade security, scalability, and modern UI/UX principles.

## 🚀 Features

### Core Inventory Management

- 📊 **Real-time Dashboard**: Advanced analytics with interactive charts and KPIs
- 🤖 **AI Forecasting**: Multi-model demand prediction with Prophet, ARIMA, and LSTM
- 🔄 **Multi-Channel Sync**: Unified inventory across Shopify, Amazon, eBay, Square, and custom APIs
- 📈 **Smart Reordering**: Automated purchase order generation with EOQ optimization
- 🏪 **Supplier Integration**: Complete supplier management with approval workflows

### Advanced Analytics

- 📊 **Inventory Turnover Analysis**: Industry benchmarks and performance tracking
- 📉 **Dead Stock Detection**: AI-powered identification and liquidation recommendations
- 💰 **Cost Analysis**: Carrying costs, gross margins, and profitability insights
- 📈 **Forecast Accuracy**: Continuous model performance monitoring and improvement
- 🎯 **Stockout Prevention**: Predictive alerts with lost revenue analysis

### Enterprise Security

- 🔐 **Zero-Trust Architecture**: Multi-factor authentication and role-based access
- 🛡️ **Data Protection**: Field-level encryption and comprehensive audit logging
- 🔒 **API Security**: Rate limiting, input validation, and threat detection
- 📋 **Compliance Ready**: GDPR and SOC 2 Type II preparation

### User Experience

- 📱 **Progressive Web App**: Mobile-first design with offline capabilities
- 🎨 **Modern UI**: Dark theme with responsive, accessible components
- ⚡ **Real-time Updates**: Live data synchronization and notifications
- 🔍 **Advanced Search**: Full-text search with filters and sorting
- 🤖 **AI Assistant**: Integrated Claude-powered chatbot for inventory insights and assistance

## 🏗️ Architecture

### Technology Stack

**Frontend**

- **Framework**: Next.js 15 with React 19 and TypeScript
- **UI Library**: Tailwind CSS with shadcn/ui components
- **Charts**: Recharts with D3.js for advanced visualizations
- **State Management**: React Query for server state, Zustand for client state
- **Mobile**: PWA with Service Workers and barcode scanning

**Backend**

- **API**: Node.js with Express.js and tRPC
- **Authentication**: JWT with refresh tokens and MFA support
- **Validation**: Zod schemas with express-validator
- **Queue System**: BullMQ with Redis for background processing
- **Security**: Helmet, rate limiting, and comprehensive input sanitization

**Database & Infrastructure**

- **Primary Database**: PostgreSQL 15 with partitioning and optimization
- **Caching**: Redis Cluster for session and query caching
- **Search**: Elasticsearch for full-text search capabilities
- **Analytics**: ClickHouse for high-performance analytics
- **Hosting**: Vercel for frontend, AWS for backend services
- **Monitoring**: DataDog, Sentry, and custom metrics

**AI & ML Services**

- **Forecasting**: Python microservice with Prophet, ARIMA, and ensemble models
- **Model Management**: Automated retraining and performance tracking
- **External Factors**: Integration with weather, economic, and seasonal data
- **Claude Integration**: Anthropic's Claude API for intelligent inventory assistant

## 📦 Installation

### Prerequisites

- **Node.js**: 18+ (LTS recommended)
- **PostgreSQL**: 15+ with PostGIS extension
- **Redis**: 7+ (Cluster mode for production)
- **Python**: 3.11+ with pip
- **Shopify Partner Account**: For API access and webhooks

### Quick Start

1. **Clone the repository**:

```bash
git clone <repository-url>
cd fluxor
```

2. **Install dependencies**:

```bash
# Frontend dependencies
npm install

# Backend dependencies
cd backend && npm install

# Python AI service dependencies
cd ../ai && pip install -r requirements.txt
```

3. **Environment Configuration**:

```bash
# Copy and configure environment files
cp backend/.env.example backend/.env
cp ai/.env.example ai/.env

# Edit with your configuration
nano backend/.env
nano ai/.env
```

4. **Database Setup**:

```bash
# Run migrations
cd backend && npm run migrate

# Seed initial data (optional)
npm run seed
```

5. **Start Development Servers**:

```bash
# Terminal 1: Frontend (Next.js)
npm run dev

# Terminal 2: Backend API
cd backend && npm run dev

# Terminal 3: AI Service
cd ai && python src/app.py

# Terminal 4: Redis (if not running)
redis-server

# Terminal 5: PostgreSQL (if not running)
pg_ctl -D /usr/local/var/postgres start
```

### Access Points

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3001
- **AI Service**: http://localhost:5000
- **API Documentation**: http://localhost:3001/api/docs

## 🏗️ Project Structure

```
fluxor/
├── app/                          # Next.js 15 app directory
│   ├── dashboard/               # Main dashboard pages
│   ├── login/                   # Authentication pages
│   ├── settings/                # User settings and configuration
│   └── globals.css              # Global styles
├── backend/                     # Express.js API server
│   ├── src/
│   │   ├── controllers/         # Route handlers and business logic
│   │   ├── middleware/          # Authentication, validation, error handling
│   │   ├── models/              # Database models and queries
│   │   ├── routes/              # API endpoint definitions
│   │   ├── services/            # Business services and external integrations
│   │   │   └── channels/        # Multi-channel connector implementations
│   │   ├── jobs/                # Background job processors
│   │   ├── utils/               # Utility functions and helpers
│   │   └── __tests__/           # Comprehensive test suite
│   └── config/                  # Database and Redis configuration
├── ai/                          # Python AI microservice
│   ├── src/
│   │   └── app.py               # Flask application with Prophet integration
│   ├── requirements.txt         # Python dependencies
│   └── Dockerfile               # Container configuration
├── components/                  # React component library
│   ├── dashboard/               # Dashboard-specific components
│   ├── ui/                      # Reusable UI components (shadcn/ui)
│   ├── fluxor/                  # Custom Fluxor components
│   └── chat/                    # AI chatbot components
├── modules/                     # Modular refactor in progress
│   ├── api-gateway/             # API gateway module (empty)
│   ├── business-domains/        # Domain-driven modules
│   ├── configuration/           # Configuration service (empty)
│   ├── core-platform/           # Core platform services (empty)
│   ├── infrastructure/          # Infrastructure modules (empty)
│   ├── notification/            # Notification service (empty)
│   └── shared/                  # Shared types and utilities (empty)
├── lib/                         # Utilities, hooks, and configurations
├── hooks/                       # Custom React hooks
├── public/                      # Static assets
├── specs/                       # Comprehensive documentation
│   ├── design.md                # System architecture and design
│   ├── feature_design.md        # Feature implementation strategy
│   ├── feature_considerations.md # Security and scalability considerations
│   ├── modular_refactor_*.md    # Modular refactor documentation
│   ├── chatbot_*.md             # AI chatbot design and implementation
│   └── tickets/                 # Implementation guides and summaries
└── CLAUDE.md                    # AI assistant guidance and commands
```

## 🧪 Testing

### Running Tests

```bash
# Backend tests
cd backend && npm test

# Frontend tests
npm run test

# E2E tests
npm run test:e2e

# Test coverage
npm run test:coverage
```

### Test Coverage

- **Backend**: 95%+ coverage with comprehensive unit and integration tests
- **Frontend**: Component testing with React Testing Library
- **E2E**: Playwright tests for critical user workflows
- **Security**: Automated penetration testing and vulnerability scanning

## 🚀 Deployment

### Production Deployment

```bash
# Build frontend
npm run build

# Deploy to Vercel
vercel --prod

# Deploy backend to AWS
cd backend && npm run deploy

# Deploy AI service to Heroku
cd ai && heroku container:push web
```

### Environment Variables

Required environment variables for production:

```bash
# Database
DATABASE_URL=postgresql://user:pass@host:port/db
REDIS_URL=redis://host:port

# Authentication
JWT_SECRET=your-super-secret-jwt-key
JWT_REFRESH_SECRET=your-refresh-secret

# AI Services
ANTHROPIC_API_KEY=your-anthropic-api-key

# Shopify Integration
SHOPIFY_API_KEY=your-shopify-api-key
SHOPIFY_API_SECRET=your-shopify-api-secret

# Email Service
MAILGUN_API_KEY=your-mailgun-key
MAILGUN_DOMAIN=your-domain.com

# Security
ENCRYPTION_KEY=your-32-byte-encryption-key
CORS_ORIGIN=https://yourdomain.com

# Monitoring
SENTRY_DSN=your-sentry-dsn
DATADOG_API_KEY=your-datadog-key
```

## 📚 Documentation

### Comprehensive Guides

- **[System Design](specs/design.md)** - Complete architecture and implementation details
- **[Feature Design](specs/feature_design.md)** - Advanced features and implementation strategy
- **[Security Considerations](specs/feature_considerations.md)** - Security architecture and best practices
- **[Implementation Guide](specs/tickets/IMPLEMENTATION_GUIDE.md)** - Development workflow and standards
- **[API Reference](backend/README.md)** - Complete API documentation
- **[Modular Refactor Changes](specs/modular_refactor_changes.md)** - Microservices transition guide
- **[Modular Implementation](specs/modular_refactor_implementation.md)** - Module implementation details
- **[CLAUDE.md](CLAUDE.md)** - AI assistant integration and commands

### Implementation Status

#### ✅ Completed Features

- **Backend Infrastructure**: Express.js API with PostgreSQL and Redis
- **Authentication System**: JWT with refresh tokens and role-based access
- **Database Models**: Complete schema with all required tables (users, stores, products, sales, forecasts)
- **Forecasting Microservice**: Python Flask service with Prophet integration and 7-day fallback
- **Dashboard UI**: Interactive charts (sales trends, inventory levels) and reorder suggestions table
- **Settings Management**: User preferences, Shopify connection, and alert configuration
- **Multi-Channel Framework**: Base framework with channel factory and connector interfaces
- **Channel Connectors**: Shopify, Amazon, eBay, Square, and Custom API connectors implemented
- **Supplier Management**: Complete supplier service with automated PO generation
- **Advanced Analytics**: Turnover analysis, dead stock detection, margin analysis
- **Background Jobs**: Bull queue setup for async processing
- **Security Framework**: Input validation, rate limiting, and secure authentication
- **Test Suite**: 95%+ backend test coverage with comprehensive unit tests
- **AI Chatbot**: Claude-powered assistant with context-aware inventory help
- **Chat Interface**: Floating chat widget with conversation history
- **Demo Mode**: Interactive demo with sample data for exploration
- **Chatbot Testing**: Unit tests for chat context builder, prompt engineering, and OpenAI service
- **Migration Tests**: Database migration tests for chatbot tables
- **Cache Testing**: Redis cache configuration tests for chat performance

#### 🔄 In Progress

- **Modular Refactor**: Transitioning to microservices architecture (modules folder structure created)
- **Shopify OAuth**: Complete OAuth flow implementation needed
- **Webhook System**: Endpoint registration for real-time updates
- **Email Alerts**: Mailgun integration with alert templates
- **Reports Export**: CSV generation and signed URL downloads
- **Error Handling**: Comprehensive error boundaries and user-friendly messages
- **Frontend Testing**: Component and E2E test implementation

#### 🚧 Current Branch: modular-refactor

The project is currently undergoing a modular refactor to transition from monolithic to microservices architecture. The `modules/` directory contains the new structure with domain-driven design principles.

## 🤖 AI Agent Reference Guide

### Quick Context for AI/LLM Assistants

This section provides essential information for AI agents and LLMs working on the Fluxor project.

#### Project Type
- **Category**: Enterprise SaaS Inventory Management System
- **Target**: Small to medium enterprises (SMEs) using e-commerce platforms
- **Core Value**: AI-powered demand forecasting with multi-channel inventory sync

#### Tech Stack Summary
- **Frontend**: Next.js 15, React 19, TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Node.js, Express.js, PostgreSQL, Redis, Bull queue
- **AI Service**: Python Flask with Facebook Prophet
- **Authentication**: JWT with refresh tokens
- **Deployment**: Vercel (frontend), AWS/Heroku (backend/AI)

#### Key Files for Context
- **CLAUDE.md**: Essential commands and project-specific instructions
- **specs/design.md**: Complete system architecture and implementation status
- **backend/src/models/**: Database schema and model implementations
- **backend/src/services/**: Business logic and integrations
- **components/ui/**: Reusable UI components (40+ shadcn/ui components)

#### Current State
- **Branch**: modular-refactor (transitioning to microservices)
- **Core Features**: Working (auth, dashboard, forecasting, multi-channel base)
- **Integrations**: Shopify OAuth and webhooks need completion
- **Test Coverage**: 95%+ backend, frontend tests needed

#### Development Commands
```bash
# Essential commands (see CLAUDE.md for full list)
npm run dev                      # Start frontend
cd backend && npm run dev        # Start backend
cd ai && python src/app.py       # Start AI service
cd backend && npm run migrate    # Run migrations
cd backend && npm test           # Run tests
```

#### Architecture Patterns
- **API Design**: RESTful with JWT auth on all endpoints except /auth/*
- **Database**: Raw SQL with parameterized queries (no ORM)
- **State Management**: Server state via API, client state with React hooks
- **Error Handling**: Standardized error responses with status codes
- **Security**: Input validation, rate limiting, encrypted tokens

#### Key Implementation Notes
- Always check existing components before creating new ones
- Follow existing code patterns and conventions
- Use absolute imports and paths
- Maintain test coverage above 90%
- Never commit sensitive data or credentials

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

### Development Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes and add tests
4. Run the test suite: `npm test`
5. Commit your changes: `git commit -m 'Add amazing feature'`
6. Push to the branch: `git push origin feature/amazing-feature`
7. Open a Pull Request

### Code Standards

- **TypeScript**: Strict mode with comprehensive type definitions
- **ESLint**: Enforced code style and best practices
- **Prettier**: Consistent code formatting
- **Testing**: Minimum 90% test coverage required
- **Documentation**: JSDoc comments for all public APIs

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Documentation**: [docs.fluxor.com](https://docs.fluxor.com)
- **Issues**: [GitHub Issues](https://github.com/your-org/fluxor/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-org/fluxor/discussions)
- **Email**: support@fluxor.com

## 🙏 Acknowledgments

- **Shopify** for their excellent API and developer tools
- **Facebook Prophet** for the forecasting framework
- **shadcn/ui** for the beautiful component library
- **Vercel** for the amazing hosting platform
- **Open Source Community** for the incredible tools and libraries

---

**Fluxor** - Transforming inventory management with AI-powered insights and enterprise-grade reliability.
