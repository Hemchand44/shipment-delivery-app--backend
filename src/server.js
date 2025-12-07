const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoose = require('mongoose');
const { port } = require('./config/config');
const { connectDB } = require('./config/database');
const logger = require('./utils/logger');
const { errorHandler } = require('./middleware/error.middleware');
const { checkDbAuth } = require('./middleware/auth.middleware');
const shipmentRoutes = require('./routes/shipment.routes');

const app = express();

// Security middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url}`);
  next();
});

// Database connection check
app.use(async (req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    try {
      logger.warn('MongoDB not connected, attempting to reconnect...');
      await connectDB();
      logger.info('MongoDB reconnected successfully');
      next();
    } catch (err) {
      logger.error('Failed to reconnect to MongoDB:', err);
      return res.status(500).json({ success: false, error: 'Database connection error' });
    }
  } else {
    next();
  }
});

// Routes
app.use('/api/shipments', checkDbAuth, shipmentRoutes);

// Redirect /shipments → /api/shipments
app.use('/shipments', (req, res) => {
  res.redirect(307, `/api${req.url}`);
});

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});

// Root
app.get('/', (req, res) => {
  res.status(200).json({
    message: 'Shipment Tracker API is running',
    endpoints: {
      health: '/health',
      api: '/api/shipments',
    },
  });
});

// Fallback for undefined routes
app.all('*', (req, res, next) => {
  next(new Error(`Can't find ${req.originalUrl} on this server!`));
});

app.use(errorHandler);

module.exports = app; // ✅ Important for Vercel

// Local run only
if (require.main === module) {
  const startServer = async () => {
    try {
      await connectDB();
      const server = app.listen(port, () => {
        logger.info(`Server running on http://localhost:${port}`);
      });

      const gracefulShutdown = async () => {
        logger.info('Shutting down server...');
        server.close(async () => {
          await mongoose.connection.close();
          logger.info('MongoDB connection closed');
          process.exit(0);
        });
      };

      process.on('SIGTERM', gracefulShutdown);
      process.on('SIGINT', gracefulShutdown);
    } catch (error) {
      logger.error('Failed to start server:', error);
      process.exit(1);
    }
  };

  startServer();
}
