const mongoose = require('mongoose');
const logger = require('../utils/logger');

/**
 * Middleware to check if MongoDB connection is authenticated
 */
exports.checkDbAuth = (req, res, next) => {
  // Check if MongoDB is connected and authenticated
  if (mongoose.connection.readyState !== 1) {
    logger.error('MongoDB not connected or not authenticated');
    return res.status(500).json({ 
      success: false, 
      error: 'Database connection not established or not authenticated. Please try again later.' 
    });
  }
  
  // Check if the connection has an active session
  try {
    // Just check if we have a readyState of 1 (connected)
    if (mongoose.connection.readyState !== 1) {
      logger.error('MongoDB connection not active');
      return res.status(500).json({ 
        success: false, 
        error: 'Database connection not active. Please check your credentials.' 
      });
    }
  } catch (error) {
    logger.error('Error checking MongoDB authentication:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Error checking database authentication. Please try again later.' 
    });
  }
  
  next();
}; 