const mongoose = require('mongoose');
const { mongoUri } = require('./config');
const logger = require('../utils/logger');

const connectDB = async () => {
  try {
    // Check if MongoDB URI is properly formatted with authentication credentials
    if (!mongoUri || !mongoUri.includes('@')) {
      logger.error('MongoDB URI is missing or does not contain authentication credentials');
      throw new Error('Invalid MongoDB URI: Missing authentication credentials');
    }

    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      family: 4,
      maxPoolSize: 10,
      minPoolSize: 5,
      retryWrites: true,
      w: 'majority',
      authSource: 'admin' // Specify the authentication database
    });
    
    // Skip command verification as it might cause issues
    logger.info('MongoDB Atlas connected successfully');
  } catch (error) {
    logger.error('MongoDB Atlas connection error:', error);
    
    // Provide more specific error messages based on the error type
    if (error.name === 'MongoServerSelectionError') {
      logger.error('Could not select a MongoDB server. Check network connectivity and server status.');
    } else if (error.name === 'MongoNetworkError') {
      logger.error('Network error connecting to MongoDB. Check your internet connection.');
    } else if (error.message && error.message.includes('Authentication failed')) {
      logger.error('MongoDB authentication failed. Check your username and password.');
    }
    
    // Don't exit the process, let the application handle reconnection
    throw error;
  }
};

const closeDB = async () => {
  try {
    await mongoose.connection.close();
    logger.info('MongoDB Atlas connection closed');
  } catch (error) {
    logger.error('Error closing MongoDB Atlas connection:', error);
  }
};

module.exports = {
  connectDB,
  closeDB,
};
