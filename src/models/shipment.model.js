const mongoose = require('mongoose');

const locationSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['Point'],
    default: 'Point',
    required: true
  },
  coordinates: {
    type: [Number], // [longitude, latitude]
    required: true,
    validate: {
      validator: function(v) {
        return v.length === 2 && 
               v[0] >= -180 && v[0] <= 180 && 
               v[1] >= -90 && v[1] <= 90;
      },
      message: props => `${props.value} is not a valid coordinate [longitude, latitude]`
    }
  },
  address: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

const checkpointSchema = new mongoose.Schema({
  location: {
    type: locationSchema,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  estimatedArrival: {
    type: Date
  },
  reached: {
    type: Boolean,
    default: false
  },
  notes: String
});

const shipmentSchema = new mongoose.Schema({
  trackingNumber: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  origin: {
    type: locationSchema,
    required: true
  },
  destination: {
    type: locationSchema,
    required: true
  },
  checkpoints: [checkpointSchema],
  currentLocation: {
    type: locationSchema,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'in_transit', 'out_for_delivery', 'delivered', 'exception'],
    default: 'pending',
    required: true
  },
  estimatedDelivery: {
    type: Date,
    required: true
  },
  history: [{
    location: locationSchema,
    status: {
      type: String,
      required: true
    },
    description: String,
    timestamp: {
      type: Date,
      default: Date.now
    }
  }],
  customer: {
    name: {
      type: String,
      required: true
    },
    email: {
      type: String,
      required: true
    },
    phone: String
  },
  items: [{
    description: String,
    quantity: {
      type: Number,
      min: 1
    },
    weight: Number,
    dimensions: {
      length: Number,
      width: Number,
      height: Number
    }
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Index for geospatial queries
shipmentSchema.index({ 'currentLocation.coordinates': '2dsphere' });

// Add a method to update location
shipmentSchema.methods.updateLocation = async function(locationData, status, description) {
  this.currentLocation = {
    type: 'Point',
    coordinates: [locationData.longitude, locationData.latitude],
    address: locationData.address,
    timestamp: new Date()
  };
  
  if (status) this.status = status;
  
  this.history.push({
    location: this.currentLocation,
    status: status || this.status,
    description: description || 'Location updated',
    timestamp: new Date()
  });
  
  // Check if we've reached any checkpoints
  if (this.checkpoints && this.checkpoints.length > 0) {
    const currentCoords = this.currentLocation.coordinates;
    
    // Check each checkpoint to see if we're close enough to mark it as reached
    this.checkpoints.forEach(checkpoint => {
      if (!checkpoint.reached) {
        const checkpointCoords = checkpoint.location.coordinates;
        
        // Calculate distance between current location and checkpoint (simplified)
        const distance = calculateDistance(currentCoords, checkpointCoords);
        
        // If within 0.5 km, mark as reached
        if (distance < 0.5) {
          checkpoint.reached = true;
          
          // Add to history
          this.history.push({
            location: this.currentLocation,
            status: this.status,
            description: `Reached checkpoint: ${checkpoint.name}`,
            timestamp: new Date()
          });
        }
      }
    });
  }
  
  return this.save();
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

const Shipment = mongoose.model('Shipment', shipmentSchema);

module.exports = Shipment;
