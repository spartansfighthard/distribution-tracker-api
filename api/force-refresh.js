// Standalone serverless function for the force-refresh endpoint
const express = require('express');
const cors = require('cors');
const app = express();

// Enable CORS for all routes
app.use(cors());

// Simple force-refresh endpoint for Vercel
module.exports = async (req, res) => {
  console.log('Forcing full refresh of all transactions (serverless function)...');
  
  // API Key Authentication
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  const validApiKey = process.env.API_KEY;
  
  // Skip API key validation for the Telegram bot
  const isTelegramBot = req.headers['user-agent']?.includes('TelegramBot');
  const isLocalRequest = req.headers['x-forwarded-for'] === '127.0.0.1' || req.connection.remoteAddress === '127.0.0.1';
  
  // Force-refresh is a sensitive operation, so always require authentication if API key is configured
  if (validApiKey && !isTelegramBot && !isLocalRequest) {
    if (!apiKey || apiKey !== validApiKey) {
      return res.status(401).json({
        success: false,
        error: {
          message: 'Unauthorized: Invalid or missing API key',
          code: 401
        }
      });
    }
  }
  
  try {
    // Clear transactions by storing an empty array in Vercel Blob storage
    const emptyTransactions = [];
    
    // Save empty array to Vercel Blob storage
    if (process.env.VERCEL) {
      try {
        // Path should match what's used in the main API
        const blobStoragePath = 'transactions/data.json';
        
        // Import the Vercel Blob SDK properly
        const { put } = await import('@vercel/blob');
        
        // Generate a random ID to avoid caching issues
        const randomId = Math.random().toString(36).substring(2, 15);
        const uniquePath = blobStoragePath.replace('.json', `-${randomId}.json`);
        
        // Upload empty array to Vercel Blob storage
        const { url } = await put(uniquePath, JSON.stringify(emptyTransactions), {
          access: 'public',
          addRandomSuffix: false, // Use exact path
        });
        
        console.log(`Successfully cleared all transactions in Vercel Blob storage at ${url}`);
      } catch (error) {
        console.error('Error clearing Vercel Blob storage:', error);
        throw new Error(`Failed to clear Vercel Blob storage: ${error.message}`);
      }
    }
    
    // Return success response
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      vercel: process.env.VERCEL ? true : false,
      message: 'Forced full refresh of all transactions',
      transactionCount: 0,
      note: 'All transactions have been cleared from storage. New transactions will be fetched on the next auto-fetch cycle.'
    });
  } catch (error) {
    console.error('Error in force-refresh endpoint:', error);
    res.status(500).json({
      success: false,
      timestamp: new Date().toISOString(),
      error: {
        message: 'Failed to force refresh all transactions',
        details: error.message
      }
    });
  }
}; 