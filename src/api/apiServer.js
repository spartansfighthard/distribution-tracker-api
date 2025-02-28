const express = require('express');
const cors = require('cors');
const transactionService = require('../services/transactionService');
const telegramBot = require('../bot/telegramBot');

// Create Express app
const app = express();
const PORT = process.env.API_PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Format response data for API
const formatApiResponse = (data) => {
  return {
    success: true,
    timestamp: new Date().toISOString(),
    data
  };
};

// Error handler middleware
const errorHandler = (err, req, res, next) => {
  console.error('API Error:', err);
  res.status(500).json({
    success: false,
    timestamp: new Date().toISOString(),
    error: {
      message: err.message || 'Internal server error',
      code: err.code || 500
    }
  });
};

// Routes

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    message: 'API is running',
    version: process.env.npm_package_version || '1.0.0'
  });
});

// Get wallet stats
app.get('/api/stats', async (req, res, next) => {
  try {
    const walletAddress = req.query.wallet || process.env.DISTRIBUTION_WALLET_ADDRESS;
    const stats = await transactionService.getWalletStats(walletAddress);
    
    // Format numbers for API response
    const formattedStats = {
      ...stats,
      totalSolSent: parseFloat(stats.totalSolSent.toFixed(9)),
      totalSolReceived: parseFloat(stats.totalSolReceived.toFixed(9)),
      totalTaxReceived: parseFloat(stats.totalTaxReceived.toFixed(9)),
      currentBalance: parseFloat(stats.currentBalance.toFixed(9)),
      outgoingTransactions: stats.outgoingTransactions.map(tx => ({
        ...tx,
        solAmount: parseFloat(tx.solAmount.toFixed(9)),
        timestamp: tx.timestamp.toISOString(),
        date: telegramBot.formatDate(tx.timestamp)
      })),
      taxIncomingTransactions: stats.taxIncomingTransactions.map(tx => ({
        ...tx,
        solAmount: parseFloat(tx.solAmount.toFixed(9)),
        timestamp: tx.timestamp.toISOString(),
        date: telegramBot.formatDate(tx.timestamp)
      }))
    };
    
    res.json(formatApiResponse(formattedStats));
  } catch (error) {
    next(error);
  }
});

// Get distribution transactions
app.get('/api/distributions', async (req, res, next) => {
  try {
    const walletAddress = req.query.wallet || process.env.DISTRIBUTION_WALLET_ADDRESS;
    const distributionData = await transactionService.getDistributionTransactions(walletAddress);
    
    // Format numbers for API response
    const formattedData = {
      ...distributionData,
      totalSolSent: parseFloat(distributionData.totalSolSent.toFixed(9)),
      transactions: distributionData.transactions.map(tx => ({
        ...tx,
        solAmount: parseFloat(tx.solAmount.toFixed(9)),
        timestamp: tx.timestamp.toISOString(),
        date: telegramBot.formatDate(tx.timestamp)
      }))
    };
    
    res.json(formatApiResponse(formattedData));
  } catch (error) {
    next(error);
  }
});

// Get tax transactions
app.get('/api/tax', async (req, res, next) => {
  try {
    const walletAddress = req.query.wallet || process.env.DISTRIBUTION_WALLET_ADDRESS;
    const taxData = await transactionService.getTaxTransactions(walletAddress);
    
    // Format numbers for API response
    const formattedData = {
      ...taxData,
      totalTaxReceived: parseFloat(taxData.totalTaxReceived.toFixed(9)),
      transactions: taxData.transactions.map(tx => ({
        ...tx,
        solAmount: parseFloat(tx.solAmount.toFixed(9)),
        timestamp: tx.timestamp.toISOString(),
        date: telegramBot.formatDate(tx.timestamp)
      }))
    };
    
    res.json(formatApiResponse(formattedData));
  } catch (error) {
    next(error);
  }
});

// Force refresh historical data
app.post('/api/refresh', async (req, res, next) => {
  try {
    const walletAddress = req.body.wallet || process.env.DISTRIBUTION_WALLET_ADDRESS;
    await transactionService.refreshHistoricalData(walletAddress);
    
    res.json(formatApiResponse({
      message: 'Historical data refreshed successfully',
      timestamp: new Date().toISOString()
    }));
  } catch (error) {
    next(error);
  }
});

// Apply error handler
app.use(errorHandler);

// Initialize the API server
const init = () => {
  app.listen(PORT, () => {
    console.log(`API server running on port ${PORT}`);
  });
};

module.exports = {
  init
}; 