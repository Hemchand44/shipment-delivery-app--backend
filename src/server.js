const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoose = require('mongoose');
const { connectDB } = require('./config/database');
const logger = require('./utils/logger');
const { errorHandler } = require('./middleware/error.middleware');
const { checkDbAuth } = require('./middleware/auth.middleware');
const shipmentRoutes = require('./routes/shipment.routes');

const app = express();

/* ================== Middleware ================== */
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url}`);
  next();
});

/* ================== Routes ================== */
app.use('/api/shipments', checkDbAuth, shipmentRoutes);

app.use('/shipments', (req, res) => {
  res.redirect(307, `/api${req.url}`);
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});

app.get('/', (req, res) => {
  res.json({ message: 'Shipment Tracker API is running' });
});

app.all('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use(errorHandler);

/* ================== Server Start ================== */
const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    await connectDB(); // ✅ connect once
    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
    });
  } catch (err) {
    logger.error('Failed to start server', err);
    process.exit(1);
  }
};

startServer();
