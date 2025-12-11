const mongoose = require('mongoose');
const { mongoUri } = require('./config');
const logger = require('../utils/logger');

let isConnected = false;

const connectDB = async () => {
  if (isConnected) {
    return;
  }

  if (!mongoUri) {
    throw new Error('MongoDB URI not provided');
  }

  try {
    const conn = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      family: 4,
      maxPoolSize: 5,
      retryWrites: true,
      w: 'majority',
    });

    isConnected = true;
    logger.info(`MongoDB connected: ${conn.connection.host}`);
  } catch (error) {
    logger.error('MongoDB connection failed:', error.message);
    throw error;
  }
};

module.exports = { connectDB };
