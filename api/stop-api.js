// API endpoint to stop the entire API
const fs = require('fs');
const path = require('path');

// Environment variables
const API_KEY = process.env.API_KEY;
const API_SHUTDOWN_FLAG_FILE = path.join('/tmp', 'api_shutdown_flag.json');

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
    // Create a flag file to indicate API shutdown
    const flagData = {
      shutdown: true,
      timestamp: new Date().toISOString(),
      reason: 'Admin requested API shutdown'
    };
    
    fs.writeFileSync(API_SHUTDOWN_FLAG_FILE, JSON.stringify(flagData, null, 2));
    
    // Set global variables to indicate API shutdown
    global.API_SHUTDOWN = true;
    global.STOP_DATA_COLLECTION = true; // Also stop data collection
    
    console.log('API shutdown requested via endpoint');
    
    // Return success response before shutting down
    res.status(200).json({
      success: true,
      message: 'API shutdown initiated. The API will be unavailable until restarted.'
    });
    
    // Give time for the response to be sent before exiting
    setTimeout(() => {
      console.log('Shutting down API process...');
      process.exit(0);
    }, 1000);
  } catch (error) {
    console.error('Error shutting down API:', error);
    
    return res.status(500).json({
      success: false,
      error: {
        message: 'Failed to shut down API: ' + error.message
      }
    });
  }
}; 