const express = require('express');
const router = express.Router();
const { body, param, query, validationResult } = require('express-validator');
const shipmentController = require('../controllers/shipment.controller');
const { check } = require('express-validator');
const logger = require('../utils/logger');

// Validation middleware
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// Get all shipments
router.get('/', shipmentController.getAllShipments);

// Get shipments near a location
router.get(
  '/nearby',
  [
    query('longitude').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude is required'),
    query('latitude').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude is required'),
    query('maxDistance').optional().isInt({ min: 1, max: 100000 }).withMessage('Max distance must be between 1 and 100,000 meters'),
    validate
  ],
  shipmentController.getNearbyShipments
);

// Create a new shipment
router.post(
  '/',
  [
    body('origin').isObject().withMessage('Origin is required'),
    body('origin.coordinates').isArray({ min: 2, max: 2 }).withMessage('Invalid coordinates'),
    body('origin.address').isString().notEmpty().withMessage('Origin address is required'),
    body('destination').isObject().withMessage('Destination is required'),
    body('destination.coordinates').isArray({ min: 2, max: 2 }).withMessage('Invalid coordinates'),
    body('destination.address').isString().notEmpty().withMessage('Destination address is required'),
    body('customer.name').isString().notEmpty().withMessage('Customer name is required'),
    body('customer.email').isEmail().withMessage('Valid customer email is required'),
    body('estimatedDelivery').isISO8601().withMessage('Valid estimated delivery date is required'),
    validate
  ],
  shipmentController.createShipment
);

// Get shipment by tracking number
router.get(
  '/:trackingNumber',
  [
    param('trackingNumber').isString().notEmpty().withMessage('Valid tracking number is required'),
    validate
  ],
  shipmentController.getShipmentByTrackingNumber
);

// Update shipment location
router.patch(
  '/:trackingNumber/location',
  [
    param('trackingNumber').isString().notEmpty().withMessage('Valid tracking number is required'),
    body('coordinates').isArray({ min: 2, max: 2 }).withMessage('Invalid coordinates'),
    body('address').isString().notEmpty().withMessage('Address is required'),
    body('status').optional().isIn(['pending', 'in_transit', 'out_for_delivery', 'delivered', 'exception']),
    body('description').optional().isString(),
    validate
  ],
  shipmentController.updateShipmentLocation
);

// Update shipment status
router.patch('/:trackingNumber/status', shipmentController.updateShipmentStatus);

// Get shipment history
router.get(
  '/:trackingNumber/history',
  [
    param('trackingNumber').isString().notEmpty().withMessage('Valid tracking number is required'),
    validate
  ],
  shipmentController.getShipmentHistory
);

// Get shipment ETA
router.get(
  '/:trackingNumber/eta',
  [
    param('trackingNumber').isString().notEmpty().withMessage('Valid tracking number is required'),
    validate
  ],
  shipmentController.getShipmentETA
);

// Get shipment route distance
router.get(
  '/:trackingNumber/distance',
  [
    param('trackingNumber').isString().notEmpty().withMessage('Valid tracking number is required'),
    validate
  ],
  shipmentController.getShipmentRouteDistance
);

// Update shipment location manually
router.patch(
  '/:trackingNumber/location/manual',
  [
    param('trackingNumber').isString().notEmpty().withMessage('Valid tracking number is required'),
    body('coordinates').isArray({ min: 2, max: 2 }).withMessage('Invalid coordinates'),
    body('address').isString().notEmpty().withMessage('Address is required'),
    body('status').optional().isIn(['pending', 'in_transit', 'out_for_delivery', 'delivered', 'exception']),
    body('description').optional().isString(),
    validate
  ],
  shipmentController.updateShipmentLocationManually
);

// Add a checkpoint to shipment
router.post(
  '/:trackingNumber/checkpoints',
  [
    param('trackingNumber').isString().notEmpty().withMessage('Valid tracking number is required'),
    body('location').isObject().withMessage('Location is required'),
    body('location.coordinates').isArray({ min: 2, max: 2 }).withMessage('Invalid coordinates'),
    body('location.address').isString().notEmpty().withMessage('Address is required'),
    body('name').isString().notEmpty().withMessage('Checkpoint name is required'),
    validate
  ],
  shipmentController.addCheckpoint
);

// Update a checkpoint
router.patch(
  '/:trackingNumber/checkpoints/:checkpointId',
  [
    param('trackingNumber').isString().notEmpty().withMessage('Valid tracking number is required'),
    param('checkpointId').isString().notEmpty().withMessage('Valid checkpoint ID is required'),
    validate
  ],
  shipmentController.updateCheckpoint
);

// Delete a checkpoint
router.delete(
  '/:trackingNumber/checkpoints/:checkpointId',
  [
    param('trackingNumber').isString().notEmpty().withMessage('Valid tracking number is required'),
    param('checkpointId').isString().notEmpty().withMessage('Valid checkpoint ID is required'),
    validate
  ],
  shipmentController.deleteCheckpoint
);

module.exports = router;
