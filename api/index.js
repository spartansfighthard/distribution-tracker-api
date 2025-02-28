// Load environment variables
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const routes = require('../src/routes');

// Create Express app
const app = express();

// Log environment variables for debugging (without exposing sensitive values)
console.log(`
API Environment:
- NODE_ENV: ${process.env.NODE_ENV || 'not set'}
- VERCEL: ${process.env.VERCEL ? 'true' : 'false'}
- DISTRIBUTION_WALLET_ADDRESS: ${process.env.DISTRIBUTION_WALLET_ADDRESS ? '✓ Set' : '✗ Not set'}
- HELIUS_API_KEY: ${process.env.HELIUS_API_KEY ? '✓ Set' : '✗ Not set'}
- HELIUS_RPC_URL: ${process.env.HELIUS_RPC_URL ? '✓ Set' : '✗ Not set'}
- TAX_TOKEN_MINT_ADDRESS: ${process.env.TAX_TOKEN_MINT_ADDRESS ? '✓ Set' : '✗ Not set'}
- TELEGRAM_BOT_TOKEN: ${process.env.TELEGRAM_BOT_TOKEN ? '✓ Set' : '✗ Not set'}
`);

// Middleware
app.use(cors({
  origin: '*', // Allow all origins for now, you can restrict this later
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Root route handler
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'SOL Distribution Tracker API is running',
    version: process.env.npm_package_version || '1.0.0',
    endpoints: [
      '/api/health',
      '/api/stats',
      '/api/stats/tax-token',
      '/api/stats/token/:tokenMint',
      '/api/stats/sol',
      '/api/transactions',
      '/api/transactions/tax-token',
      '/api/transactions/token/:tokenMint',
      '/api/transactions/sol',
      '/api/transactions/collected',
      '/api/transactions/distributed',
      '/api/transactions/swaps',
      '/api/fetch-transactions'
    ]
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    timestamp: new Date().toISOString(),
    message: 'API is running',
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    vercel: process.env.VERCEL ? true : false
  });
});

// Use routes from src/routes/index.js
app.use('/api', routes);

// Initialize Telegram bot only if token is provided and not in Vercel environment
// This prevents the API from crashing if the Telegram bot module is not available
if (process.env.TELEGRAM_BOT_TOKEN && process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  try {
    const telegramBot = require('../src/bot/telegramBot');
    console.log('Telegram bot initialized successfully');
  } catch (error) {
    console.warn('Failed to initialize Telegram bot:', error.message);
  }
}

// 404 handler
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    timestamp: new Date().toISOString(),
    error: {
      message: `Route not found: ${req.method} ${req.url}`,
      code: 404
    }
  });
});

// Error handler middleware
app.use((err, req, res, next) => {
  console.error('API Error:', err);
  res.status(500).json({
    success: false,
    timestamp: new Date().toISOString(),
    error: {
      message: err.message || 'Internal server error',
      code: err.code || 500
    }
  });
});

// For local development
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

// Export for Vercel serverless deployment
module.exports = app; 