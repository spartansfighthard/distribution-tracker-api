// API endpoint to stop data collection
const fs = require('fs');
const path = require('path');

// Environment variables
const API_KEY = process.env.API_KEY;
const DATA_COLLECTION_FLAG_FILE = path.join('/tmp', 'stop_collection_flag.json');

module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-API-KEY, Content-Type');
  
  // Handle OPTIONS request (preflight)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Verify API key for security
  const requestApiKey = req.headers['x-api-key'];
  if (API_KEY && (!requestApiKey || requestApiKey !== API_KEY)) {
    return res.status(401).json({
      success: false,
      error: {
        message: 'Unauthorized. Invalid API key.'
      }
    });
  }
  
  try {
    // Create a flag file to indicate data collection should stop
    const flagData = {
      stopped: true,
      timestamp: new Date().toISOString(),
      reason: 'Admin requested stop via API'
    };
    
    fs.writeFileSync(DATA_COLLECTION_FLAG_FILE, JSON.stringify(flagData, null, 2));
    
    // Set a global variable to indicate data collection should stop
    global.STOP_DATA_COLLECTION = true;
    
    console.log('Data collection stop requested via API');
    
    // Return success response
    return res.status(200).json({
      success: true,
      message: 'Data collection has been stopped. The API will no longer fetch new data until restarted.'
    });
  } catch (error) {
    console.error('Error stopping data collection:', error);
    
    return res.status(500).json({
      success: false,
      error: {
        message: 'Failed to stop data collection: ' + error.message
      }
    });
  }
}; 