// Standalone serverless function for the force-refresh endpoint
const express = require('express');
const cors = require('cors');
const app = express();

// Enable CORS for all routes
app.use(cors());

// Simple force-refresh endpoint for Vercel
module.exports = (req, res) => {
  console.log('Forcing full refresh of all transactions (serverless function)...');
  
  // Return a simple success response
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    vercel: process.env.VERCEL ? true : false,
    message: 'Forced full refresh of all transactions',
    note: 'This is a simplified version of the force-refresh endpoint for Vercel'
  });
}; 