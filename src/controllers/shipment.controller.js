const Shipment = require('../models/shipment.model');
const logger = require('../utils/logger');
const { validationResult } = require('express-validator');
const mongoose = require('mongoose');

// Helper function to generate a tracking number
const generateTrackingNumber = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
    if ((i + 1) % 4 === 0 && i < 11) result += '-';
  }
  return result;
};

// Calculate estimated delivery date (simple implementation - could be enhanced with distance calculation)
const calculateEstimatedDelivery = () => {
  const deliveryDate = new Date();
  deliveryDate.setDate(deliveryDate.getDate() + 3); // Default 3 days from now
  return deliveryDate;
};

// Create a new shipment
exports.createShipment = async (req, res) => {
  try {
    // Check MongoDB connection first
    if (mongoose.connection.readyState !== 1) {
      logger.warn('MongoDB not connected during shipment creation, attempting to reconnect...');
      try {
        // Try to reconnect
        const { connectDB } = require('../config/database');
        await connectDB();
        logger.info('MongoDB reconnected successfully for shipment creation');
      } catch (connError) {
        logger.error('Failed to reconnect to MongoDB for shipment creation:', connError);
        return res.status(500).json({
          success: false,
          error: 'Database connection error. Please try again later.'
        });
      }
    }

    const { origin, destination, checkpoints, customer, items } = req.body;
    
    // Validate required fields
    if (!origin || !origin.coordinates || !origin.address) {
      return res.status(400).json({
        success: false,
        error: 'Origin with coordinates and address is required'
      });
    }
    
    if (!destination || !destination.coordinates || !destination.address) {
      return res.status(400).json({
        success: false,
        error: 'Destination with coordinates and address is required'
      });
    }
    
    if (!customer || !customer.name || !customer.email) {
      return res.status(400).json({
        success: false,
        error: 'Customer with name and email is required'
      });
    }
    
    // Process checkpoints if provided
    let validatedCheckpoints = [];
    if (checkpoints && Array.isArray(checkpoints) && checkpoints.length > 0) {
      // Validate each checkpoint
      for (const checkpoint of checkpoints) {
        if (!checkpoint.location || !checkpoint.location.coordinates || !checkpoint.location.address) {
          return res.status(400).json({
            success: false,
            error: 'Each checkpoint must have location with coordinates and address'
          });
        }
        
        if (!checkpoint.name) {
          return res.status(400).json({
            success: false,
            error: 'Each checkpoint must have a name'
          });
        }
        
        validatedCheckpoints.push({
          location: {
            type: 'Point',
            coordinates: checkpoint.location.coordinates,
            address: checkpoint.location.address,
            timestamp: new Date()
          },
          name: checkpoint.name,
          estimatedArrival: checkpoint.estimatedArrival || null,
          reached: false,
          notes: checkpoint.notes || ''
        });
      }
    }
    
    // Create new shipment
    const shipment = new Shipment({
      trackingNumber: generateTrackingNumber(),
      origin: {
        type: 'Point',
        coordinates: origin.coordinates,
        address: origin.address,
        timestamp: new Date()
      },
      destination: {
        type: 'Point',
        coordinates: destination.coordinates,
        address: destination.address,
        timestamp: new Date()
      },
      checkpoints: validatedCheckpoints,
      currentLocation: {
        type: 'Point',
        coordinates: origin.coordinates,
        address: origin.address,
        timestamp: new Date()
      },
      status: 'pending',
      estimatedDelivery: req.body.estimatedDelivery || calculateEstimatedDelivery(),
      customer: {
        name: customer.name,
        email: customer.email,
        phone: customer.phone || ''
      },
      items: items || [],
      history: [{
        location: {
          type: 'Point',
          coordinates: origin.coordinates,
          address: origin.address,
          timestamp: new Date()
        },
        status: 'pending',
        description: 'Shipment created',
        timestamp: new Date()
      }]
    });

    // Save with retry mechanism
    let savedShipment;
    try {
      savedShipment = await shipment.save();
    } catch (saveError) {
      // If first save fails, try one more time
      if (saveError.name === 'MongoNetworkError' || 
          saveError.name === 'MongoTimeoutError' ||
          (saveError.message && saveError.message.includes('connection'))) {
        
        logger.warn('MongoDB save error, attempting to reconnect and retry:', saveError);
        
        try {
          // Try to reconnect
          const { connectDB } = require('../config/database');
          await connectDB();
          
          // Try saving again
          savedShipment = await shipment.save();
          logger.info('Shipment saved successfully after retry');
        } catch (retryError) {
          throw retryError; // Will be caught by outer catch block
        }
      } else {
        throw saveError; // Will be caught by outer catch block
      }
    }
    
    logger.info(`New shipment created: ${savedShipment.trackingNumber}`);
    
    res.status(201).json({
      success: true,
      data: savedShipment,
      message: 'Shipment created successfully'
    });
  } catch (error) {
    logger.error('Error creating shipment:', error);
    
    // Provide more specific error messages based on the error type
    let errorMessage = 'Failed to create shipment';
    
    if (error.name === 'ValidationError') {
      errorMessage = 'Invalid shipment data: ' + Object.values(error.errors).map(e => e.message).join(', ');
    } else if (error.name === 'MongoServerError' && error.code === 11000) {
      errorMessage = 'Duplicate tracking number. Please try again.';
    } else if (error.name === 'MongoNetworkError') {
      errorMessage = 'Network error connecting to database. Please try again later.';
    }
    
    res.status(error.name === 'ValidationError' ? 400 : 500).json({
      success: false,
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get shipment by tracking number
exports.getShipmentByTrackingNumber = async (req, res) => {
  try {
    const { trackingNumber } = req.params;
    
    const shipment = await Shipment.findOne({ trackingNumber });
    
    if (!shipment) {
      return res.status(404).json({
        success: false,
        error: 'Shipment not found'
      });
    }
    
    res.status(200).json({
      success: true,
      data: shipment
    });
  } catch (error) {
    logger.error('Error fetching shipment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch shipment',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Update shipment location
exports.updateShipmentLocation = async (req, res) => {
  try {
    const { trackingNumber } = req.params;
    const { coordinates, address, status, description } = req.body;
    
    const shipment = await Shipment.findOne({ trackingNumber });
    
    if (!shipment) {
      return res.status(404).json({
        success: false,
        error: 'Shipment not found'
      });
    }
    
    // Update location and status
    await shipment.updateLocation(
      {
        longitude: coordinates[0],
        latitude: coordinates[1],
        address: address
      },
      status,
      description
    );
    
    logger.info(`Shipment ${trackingNumber} location updated`);
    
    // Get updated shipment
    const updatedShipment = await Shipment.findOne({ trackingNumber });
    
    res.status(200).json({
      success: true,
      data: updatedShipment,
      message: 'Shipment location updated successfully'
    });
  } catch (error) {
    logger.error('Error updating shipment location:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update shipment location',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get shipment history
exports.getShipmentHistory = async (req, res) => {
  try {
    const { trackingNumber } = req.params;
    
    const shipment = await Shipment.findOne({ trackingNumber }, 'history');
    
    if (!shipment) {
      return res.status(404).json({
        success: false,
        error: 'Shipment not found'
      });
    }
    
    res.status(200).json({
      success: true,
      data: shipment.history
    });
  } catch (error) {
    logger.error('Error fetching shipment history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch shipment history',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get nearby shipments
exports.getNearbyShipments = async (req, res) => {
  try {
    const { longitude, latitude, maxDistance = 10000 } = req.query; // Default 10km
    
    const shipments = await Shipment.find({
      'currentLocation.coordinates': {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [parseFloat(longitude), parseFloat(latitude)]
          },
          $maxDistance: parseInt(maxDistance)
        }
      }
    });

    res.status(200).json({
      success: true,
      data: shipments
    });
  } catch (error) {
    logger.error('Error fetching nearby shipments:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch nearby shipments',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get all shipments with filtering and sorting
exports.getAllShipments = async (req, res) => {
  try {
    // Check MongoDB connection first
    if (mongoose.connection.readyState !== 1) {
      logger.warn('MongoDB not connected when fetching shipments, attempting to reconnect...');
      try {
        // Try to reconnect
        const { connectDB } = require('../config/database');
        await connectDB();
        logger.info('MongoDB reconnected successfully for fetching shipments');
      } catch (connError) {
        logger.error('Failed to reconnect to MongoDB for fetching shipments:', connError);
        return res.status(500).json({ 
          success: false, 
          error: 'Database connection error. Please try again later.' 
        });
      }
    }
    
    const { status, sortBy, sortOrder, limit = 50, page = 1 } = req.query;
    const query = {};
    
    // Apply filters
    if (status) {
      query.status = status;
    }
    
    // Apply sorting
    const sortOptions = {};
    if (sortBy) {
      sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;
    } else {
      // Default sort by createdAt in descending order (newest first)
      sortOptions.createdAt = -1;
    }
    
    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const limitValue = parseInt(limit);
    
    // Fetch shipments with retry mechanism
    let shipments;
    try {
      shipments = await Shipment.find(query)
        .sort(sortOptions)
        .skip(skip)
        .limit(limitValue)
        .select('-__v');
    } catch (fetchError) {
      // If first fetch fails, try one more time
      if (fetchError.name === 'MongoNetworkError' || 
          fetchError.name === 'MongoTimeoutError' ||
          (fetchError.message && fetchError.message.includes('connection'))) {
        
        logger.warn('MongoDB fetch error, attempting to reconnect and retry:', fetchError);
        
        try {
          // Try to reconnect
          const { connectDB } = require('../config/database');
          await connectDB();
          
          // Try fetching again
          shipments = await Shipment.find(query)
            .sort(sortOptions)
            .skip(skip)
            .limit(limitValue)
            .select('-__v');
            
          logger.info('Shipments fetched successfully after retry');
        } catch (retryError) {
          throw retryError; // Will be caught by outer catch block
        }
      } else {
        throw fetchError; // Will be caught by outer catch block
      }
    }
    
    // Get total count for pagination info
    const totalCount = await Shipment.countDocuments(query);
    
    res.status(200).json({
      success: true,
      data: shipments,
      pagination: {
        total: totalCount,
        page: parseInt(page),
        limit: limitValue,
        pages: Math.ceil(totalCount / limitValue)
      }
    });
  } catch (error) {
    logger.error('Error fetching shipments:', error);
    
    // Provide more specific error messages based on the error type
    let errorMessage = 'Failed to fetch shipments';
    
    if (error.name === 'MongoNetworkError') {
      errorMessage = 'Network error connecting to database. Please try again later.';
    } else if (error.name === 'MongoServerError') {
      errorMessage = 'Database server error. Please try again later.';
    }
    
    res.status(500).json({ 
      success: false, 
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get shipment ETA
exports.getShipmentETA = async (req, res) => {
  try {
    const { trackingNumber } = req.params;
    const shipment = await Shipment.findOne({ trackingNumber });
    
    if (!shipment) {
      return res.status(404).json({ error: 'Shipment not found' });
    }
    
    // Calculate remaining distance and time
    const currentLocation = shipment.currentLocation.coordinates;
    const destination = shipment.destination.coordinates;
    
    // Calculate distance using Haversine formula
    const distance = calculateDistance(currentLocation, destination);
    
    // Assume average speed of 50 km/h for ground transport
    const averageSpeed = 50; // km/h
    const estimatedTimeHours = distance / averageSpeed;
    
    const eta = new Date();
    eta.setHours(eta.getHours() + estimatedTimeHours);
    
    res.json({
      trackingNumber: shipment.trackingNumber,
      currentLocation: shipment.currentLocation,
      destination: shipment.destination,
      distance: distance.toFixed(2), // km
      estimatedTimeHours: estimatedTimeHours.toFixed(2),
      eta: eta,
      status: shipment.status
    });
  } catch (error) {
    logger.error('Error calculating ETA:', error);
    res.status(500).json({ error: 'Failed to calculate ETA' });
  }
};

// Helper function to calculate distance between two points using Haversine formula
function calculateDistance(point1, point2) {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(point2[1] - point1[1]);
  const dLon = toRad(point2[0] - point1[0]);
  const lat1 = toRad(point1[1]);
  const lat2 = toRad(point2[1]);

  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.sin(dLon/2) * Math.sin(dLon/2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function toRad(degrees) {
  return degrees * Math.PI / 180;
}

// Update shipment status
exports.updateShipmentStatus = async (req, res) => {
  try {
    const { trackingNumber } = req.params;
    const { status, description } = req.body;
    
    if (!status) {
      return res.status(400).json({
        success: false,
        error: 'Status is required'
      });
    }
    
    const shipment = await Shipment.findOne({ trackingNumber });
    
    if (!shipment) {
      return res.status(404).json({
        success: false,
        error: 'Shipment not found'
      });
    }
    
    // Update status
    shipment.status = status;
    
    // Add to history
    shipment.history.push({
      location: shipment.currentLocation,
      status,
      description: description || `Status updated to ${status}`,
      timestamp: new Date()
    });
    
    await shipment.save();
    
    logger.info(`Shipment ${trackingNumber} status updated to ${status}`);
    
    res.status(200).json({
      success: true,
      data: shipment,
      message: 'Shipment status updated successfully'
    });
  } catch (error) {
    logger.error('Error updating shipment status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update shipment status',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get shipment route distance
exports.getShipmentRouteDistance = async (req, res) => {
  try {
    const { trackingNumber } = req.params;
    const shipment = await Shipment.findOne({ trackingNumber });
    
    if (!shipment) {
      return res.status(404).json({ 
        success: false,
        error: 'Shipment not found' 
      });
    }
    
    // Calculate distance from origin to current location
    let distanceTraveled = calculateDistance(
      shipment.origin.coordinates,
      shipment.currentLocation.coordinates
    );
    
    // Calculate distance from current location to destination
    const remainingDistance = calculateDistance(
      shipment.currentLocation.coordinates,
      shipment.destination.coordinates
    );
    
    // Calculate total route distance (origin to destination)
    let totalDistance = calculateDistance(
      shipment.origin.coordinates,
      shipment.destination.coordinates
    );
    
    // Include checkpoints in distance calculation if they exist
    let checkpointDistances = [];
    if (shipment.checkpoints && shipment.checkpoints.length > 0) {
      // Add origin as the first point
      let routePoints = [shipment.origin.coordinates];
      
      // Add all checkpoints in order
      shipment.checkpoints.forEach(checkpoint => {
        routePoints.push(checkpoint.location.coordinates);
      });
      
      // Add destination as the last point
      routePoints.push(shipment.destination.coordinates);
      
      // Calculate total distance with checkpoints
      totalDistance = 0;
      for (let i = 0; i < routePoints.length - 1; i++) {
        const segmentDistance = calculateDistance(routePoints[i], routePoints[i + 1]);
        totalDistance += segmentDistance;
        
        // If this is a checkpoint segment, add to checkpoint distances
        if (i > 0 && i < routePoints.length - 2) {
          checkpointDistances.push({
            checkpointName: shipment.checkpoints[i - 1].name,
            distance: segmentDistance.toFixed(2)
          });
        }
      }
      
      // Recalculate distance traveled considering checkpoints
      let traveled = 0;
      let currentFound = false;
      
      for (let i = 0; i < routePoints.length - 1; i++) {
        const segmentDistance = calculateDistance(routePoints[i], routePoints[i + 1]);
        
        // If we haven't found the current location yet, add this segment's distance
        if (!currentFound) {
          // Check if current location is between these two points
          const distanceToStart = calculateDistance(routePoints[i], shipment.currentLocation.coordinates);
          const distanceToEnd = calculateDistance(shipment.currentLocation.coordinates, routePoints[i + 1]);
          
          if (distanceToStart + distanceToEnd <= segmentDistance * 1.1) { // 10% margin for error
            traveled += distanceToStart;
            currentFound = true;
          } else {
            traveled += segmentDistance;
          }
        }
      }
      
      // Update distanceTraveled if we found the current location along the route
      if (currentFound) {
        distanceTraveled = traveled;
      }
    }
    
    res.status(200).json({
      success: true,
      data: {
        trackingNumber: shipment.trackingNumber,
        distanceTraveled: distanceTraveled.toFixed(2), // km
        remainingDistance: remainingDistance.toFixed(2), // km
        totalDistance: totalDistance.toFixed(2), // km
        progress: Math.min(Math.round((distanceTraveled / totalDistance) * 100), 99), // percentage
        checkpoints: shipment.checkpoints.map(cp => ({
          name: cp.name,
          address: cp.location.address,
          reached: cp.reached,
          estimatedArrival: cp.estimatedArrival
        })),
        checkpointDistances: checkpointDistances
      }
    });
  } catch (error) {
    logger.error('Error calculating route distance:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to calculate route distance',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Update shipment location manually
exports.updateShipmentLocationManually = async (req, res) => {
  try {
    const { trackingNumber } = req.params;
    const { coordinates, address, status, description } = req.body;
    
    // Validate coordinates
    if (!coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
      return res.status(400).json({
        success: false,
        error: 'Valid coordinates [longitude, latitude] are required'
      });
    }
    
    // Validate address
    if (!address) {
      return res.status(400).json({
        success: false,
        error: 'Address is required'
      });
    }
    
    const shipment = await Shipment.findOne({ trackingNumber });
    
    if (!shipment) {
      return res.status(404).json({
        success: false,
        error: 'Shipment not found'
      });
    }
    
    // Update current location
    shipment.currentLocation = {
      type: 'Point',
      coordinates: coordinates,
      address: address,
      timestamp: new Date()
    };
    
    // Update status if provided
    if (status) {
      shipment.status = status;
    }
    
    // Add to history
    shipment.history.push({
      location: shipment.currentLocation,
      status: status || shipment.status,
      description: description || 'Location updated manually',
      timestamp: new Date()
    });
    
    await shipment.save();
    
    logger.info(`Shipment ${trackingNumber} location updated manually`);
    
    res.status(200).json({
      success: true,
      data: shipment,
      message: 'Shipment location updated successfully'
    });
  } catch (error) {
    logger.error('Error updating shipment location manually:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update shipment location',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Add a checkpoint to shipment
exports.addCheckpoint = async (req, res) => {
  try {
    const { trackingNumber } = req.params;
    const { location, name, estimatedArrival, notes } = req.body;
    
    // Validate required fields
    if (!location || !location.coordinates || !location.address) {
      return res.status(400).json({
        success: false,
        error: 'Location with coordinates and address is required'
      });
    }
    
    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Checkpoint name is required'
      });
    }
    
    const shipment = await Shipment.findOne({ trackingNumber });
    
    if (!shipment) {
      return res.status(404).json({
        success: false,
        error: 'Shipment not found'
      });
    }
    
    // Create new checkpoint
    const newCheckpoint = {
      location: {
        type: 'Point',
        coordinates: location.coordinates,
        address: location.address,
        timestamp: new Date()
      },
      name,
      estimatedArrival: estimatedArrival || null,
      reached: false,
      notes: notes || ''
    };
    
    // Add to checkpoints array
    shipment.checkpoints.push(newCheckpoint);
    
    await shipment.save();
    
    logger.info(`Checkpoint added to shipment ${trackingNumber}`);
    
    res.status(200).json({
      success: true,
      data: shipment,
      message: 'Checkpoint added successfully'
    });
  } catch (error) {
    logger.error('Error adding checkpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add checkpoint',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Update a checkpoint
exports.updateCheckpoint = async (req, res) => {
  try {
    const { trackingNumber, checkpointId } = req.params;
    const { name, estimatedArrival, reached, notes, location } = req.body;
    
    const shipment = await Shipment.findOne({ trackingNumber });
    
    if (!shipment) {
      return res.status(404).json({
        success: false,
        error: 'Shipment not found'
      });
    }
    
    // Find the checkpoint
    const checkpoint = shipment.checkpoints.id(checkpointId);
    
    if (!checkpoint) {
      return res.status(404).json({
        success: false,
        error: 'Checkpoint not found'
      });
    }
    
    // Update fields if provided
    if (name) checkpoint.name = name;
    if (estimatedArrival !== undefined) checkpoint.estimatedArrival = estimatedArrival;
    if (reached !== undefined) checkpoint.reached = reached;
    if (notes !== undefined) checkpoint.notes = notes;
    
    // Update location if provided
    if (location && location.coordinates && location.address) {
      checkpoint.location = {
        type: 'Point',
        coordinates: location.coordinates,
        address: location.address,
        timestamp: new Date()
      };
    }
    
    // If checkpoint is marked as reached, add to history
    if (reached && !checkpoint.reached) {
      shipment.history.push({
        location: shipment.currentLocation,
        status: shipment.status,
        description: `Checkpoint reached: ${checkpoint.name}`,
        timestamp: new Date()
      });
      
      checkpoint.reached = true;
    }
    
    await shipment.save();
    
    logger.info(`Checkpoint ${checkpointId} updated for shipment ${trackingNumber}`);
    
    res.status(200).json({
      success: true,
      data: shipment,
      message: 'Checkpoint updated successfully'
    });
  } catch (error) {
    logger.error('Error updating checkpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update checkpoint',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Delete a checkpoint
exports.deleteCheckpoint = async (req, res) => {
  try {
    const { trackingNumber, checkpointId } = req.params;
    
    const shipment = await Shipment.findOne({ trackingNumber });
    
    if (!shipment) {
      return res.status(404).json({
        success: false,
        error: 'Shipment not found'
      });
    }
    
    // Find and remove the checkpoint
    const checkpoint = shipment.checkpoints.id(checkpointId);
    
    if (!checkpoint) {
      return res.status(404).json({
        success: false,
        error: 'Checkpoint not found'
      });
    }
    
    checkpoint.remove();
    
    await shipment.save();
    
    logger.info(`Checkpoint ${checkpointId} deleted from shipment ${trackingNumber}`);
    
    res.status(200).json({
      success: true,
      data: shipment,
      message: 'Checkpoint deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting checkpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete checkpoint',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
