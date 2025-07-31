# Inventory Forecasting Dashboard

An AI-powered inventory management system for Shopify stores that helps SMEs optimize stock levels through demand forecasting and automated alerts.

## Features

- 📊 **Real-time Dashboard**: Visualize sales trends and inventory levels
- 🤖 **AI Forecasting**: Prophet-based demand prediction with intelligent fallbacks
- 🔔 **Smart Alerts**: Automated low-stock notifications with cooldown periods
- 🏪 **Shopify Integration**: Seamless connection with your Shopify store
- 📈 **Reorder Suggestions**: Data-driven recommendations for restocking
- 📱 **Responsive Design**: Works beautifully on desktop and mobile devices

## Tech Stack

- **Frontend**: Next.js 15, React 19, TypeScript, Tailwind CSS
- **Backend**: Node.js, Express.js, PostgreSQL, Redis
- **AI Service**: Python, Flask, Facebook Prophet
- **Authentication**: JWT with HTTP-only cookies
- **Charts**: Recharts
- **UI Components**: shadcn/ui

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Redis 6+
- Python 3.11+
- Shopify Partner Account (for API access)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd inventory-forecasting-dashboard
```

2. Install dependencies:
```bash
# Frontend dependencies
npm install

# Backend dependencies
cd backend && npm install

# Python dependencies
cd ../ai && pip install -r requirements.txt
```

3. Set up environment variables:
```bash
# Copy example env file
cp backend/.env.example backend/.env

# Edit backend/.env with your configuration
```

4. Run database migrations:
```bash
cd backend && npm run migrate
```

5. Start the development servers:
```bash
# Terminal 1: Frontend
npm run dev

# Terminal 2: Backend
cd backend && npm run dev

# Terminal 3: AI Service
cd ai && python src/app.py
```

The application will be available at:
- Frontend: http://localhost:3000
- Backend API: http://localhost:3001
- AI Service: http://localhost:5000

## Project Structure

```
.
├── app/                    # Next.js pages
├── backend/               # Express.js API
│   ├── src/
│   │   ├── controllers/   # Route handlers
│   │   ├── middleware/    # Auth, validation
│   │   ├── models/        # Database models
│   │   └── routes/        # API endpoints
│   └── config/            # Configuration
├── ai/                    # Python forecasting service
├── components/            # React components
│   ├── dashboard/         # Dashboard-specific
│   └── ui/               # Reusable UI components
└── lib/                   # Utilities and hooks
```

## Documentation

- [Design Specification](specs/design.md) - Detailed system design and architecture
- [Implementation Guide](IMPLEMENTATION_GUIDE.md) - Comprehensive development documentation

## Contributing

Please read our contributing guidelines before submitting pull requests.

## License

This project is licensed under the MIT License.
