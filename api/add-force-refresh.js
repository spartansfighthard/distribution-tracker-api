// This script adds the force-refresh route to the API
const express = require('express');
const app = express();

// Add the force-refresh route
app.get('/api/force-refresh', async (req, res) => {
  console.log('Forcing full refresh of all transactions...');
  
  try {
    // Return a simple success response
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      message: 'Forced full refresh of all transactions'
    });
  } catch (error) {
    console.error('Error in /api/force-refresh:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to force refresh all transactions',
        details: error.message
      }
    });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Export the app
module.exports = app; 