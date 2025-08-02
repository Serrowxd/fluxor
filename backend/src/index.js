const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

// Validate environment variables before starting the application
const EnvValidator = require("./utils/envValidator");
EnvValidator.init();

// Import routes
const authRoutes = require("./routes/auth");
const shopifyRoutes = require("./routes/shopify");
const inventoryRoutes = require("./routes/inventory");
const forecastRoutes = require("./routes/forecast");
const alertRoutes = require("./routes/alerts");
const reportRoutes = require("./routes/reports");
const settingsRoutes = require("./routes/settings");
const analyticsRoutes = require("./routes/analytics");
const multiChannelRoutes = require("./routes/multi-channel");
const healthRoutes = require("./routes/health");

// Supplier and Purchase Order routes (Ticket #4)
const supplierRoutes = require("./routes/suppliers");
const purchaseOrderRoutes = require("./routes/purchase-orders");
const approvalWorkflowRoutes = require("./routes/approval-workflows");

// Chat routes
const chatRoutes = require("./routes/chat");

// Import middleware
const { errorHandler } = require("./middleware/errorHandler");

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet());

// CORS configuration
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
  })
);

// Rate limiting
const { redisClient } = require("../config/redis");
const RedisStore = require("rate-limit-redis");

// Configure rate limiter
const limiterConfig = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
};

// Use Redis store for distributed rate limiting if available
if (redisClient && redisClient.isOpen) {
  limiterConfig.store = new RedisStore({
    client: redisClient,
    prefix: "rl:",
  });
}

const limiter = rateLimit(limiterConfig);
app.use("/api/", limiter);

// Logging
app.use(morgan("combined"));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Health check endpoints
app.use("/api/health", healthRoutes);
// Legacy health endpoint for backward compatibility
app.get("/health", (req, res) => {
  res.status(200).json({ status: "OK", timestamp: new Date().toISOString() });
});

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/shopify", shopifyRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/forecast", forecastRoutes);
app.use("/api/alerts", alertRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/multi-channel", multiChannelRoutes);

// Supplier and Purchase Order API routes (Ticket #4)
app.use("/api/suppliers", supplierRoutes);
app.use("/api/purchase-orders", purchaseOrderRoutes);
app.use("/api/approval-workflows", approvalWorkflowRoutes);

// Chat API routes
app.use("/api/v1/chat", chatRoutes);

// Error handling middleware (must be last)
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM signal received: closing HTTP server");
  app.close(() => {
    console.log("HTTP server closed");
  });
});

module.exports = app;
