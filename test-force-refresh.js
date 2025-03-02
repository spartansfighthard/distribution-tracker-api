const express = require('express');
const app = express();
const port = 3002;

// Add the force-refresh endpoint
app.get('/api/force-refresh', async (req, res) => {
  console.log('Forcing full refresh of all transactions...');
  
  // Return a simple response
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    message: 'Forced full refresh of all transactions (test endpoint)',
    note: 'This is a test endpoint'
  });
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
}); 