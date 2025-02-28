const express = require('express');
const router = express.Router();
const Transaction = require('../models/Transaction');
const heliusService = require('../services/heliusService');
const fileStorage = require('../services/fileStorage');

// Initialize services
let servicesInitialized = false;

async function initializeServices() {
  if (servicesInitialized) {
    return true;
  }
  
  try {
    console.log('Initializing services...');
    
    // Initialize file storage
    await fileStorage.initialize();
    
    // Initialize Helius service
    await heliusService.initialize();
    
    servicesInitialized = true;
    console.log('Services initialized successfully');
    return true;
  } catch (error) {
    console.error('Error initializing services:', error);
    return false;
  }
}

// Middleware to ensure services are initialized
router.use(async (req, res, next) => {
  try {
    await initializeServices();
    next();
  } catch (error) {
    console.error('Error in initialization middleware:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to initialize services',
        details: error.message
      }
    });
  }
});

// Get statistics
router.get('/stats', async (req, res) => {
  try {
    console.log('Getting statistics...');
    
    // Get transaction statistics
    const stats = await heliusService.getStats();
    
    // Return statistics
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      stats
    });
  } catch (error) {
    console.error('Error getting statistics:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to get statistics',
        details: error.message
      }
    });
  }
});

// Get tax token statistics
router.get('/stats/tax-token', async (req, res) => {
  try {
    console.log('Getting tax token statistics...');
    
    // Check if tax token mint is set
    const taxTokenMint = process.env.TAX_TOKEN_MINT_ADDRESS;
    if (!taxTokenMint) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Tax token mint address not set'
        }
      });
    }
    
    // Get transactions for tax token
    const transactions = await Transaction.getByTokenMint(taxTokenMint);
    
    // Calculate statistics
    const stats = {
      totalTransactions: transactions.length,
      transactionsByType: {},
      totalAmount: 0
    };
    
    // Process each transaction
    for (const tx of transactions) {
      // Count by type
      stats.transactionsByType[tx.type] = (stats.transactionsByType[tx.type] || 0) + 1;
      
      // Sum amount
      if (tx.amount) {
        stats.totalAmount += tx.amount;
      }
    }
    
    // Return statistics
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      tokenMint: taxTokenMint,
      stats
    });
  } catch (error) {
    console.error('Error getting tax token statistics:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to get tax token statistics',
        details: error.message
      }
    });
  }
});

// Get token statistics by mint
router.get('/stats/token/:tokenMint', async (req, res) => {
  try {
    const { tokenMint } = req.params;
    console.log(`Getting statistics for token: ${tokenMint}`);
    
    // Get transactions for token
    const transactions = await Transaction.getByTokenMint(tokenMint);
    
    // Calculate statistics
    const stats = {
      totalTransactions: transactions.length,
      transactionsByType: {},
      totalAmount: 0
    };
    
    // Process each transaction
    for (const tx of transactions) {
      // Count by type
      stats.transactionsByType[tx.type] = (stats.transactionsByType[tx.type] || 0) + 1;
      
      // Sum amount
      if (tx.amount) {
        stats.totalAmount += tx.amount;
      }
    }
    
    // Return statistics
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      tokenMint,
      stats
    });
  } catch (error) {
    console.error(`Error getting statistics for token ${req.params.tokenMint}:`, error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to get token statistics',
        details: error.message
      }
    });
  }
});

// Get SOL statistics
router.get('/stats/sol', async (req, res) => {
  try {
    console.log('Getting SOL statistics...');
    
    // Get transactions for SOL
    const transactions = await Transaction.getByToken('SOL');
    
    // Calculate statistics
    const stats = {
      totalTransactions: transactions.length,
      transactionsByType: {},
      totalAmount: 0
    };
    
    // Process each transaction
    for (const tx of transactions) {
      // Count by type
      stats.transactionsByType[tx.type] = (stats.transactionsByType[tx.type] || 0) + 1;
      
      // Sum amount
      if (tx.amount) {
        stats.totalAmount += tx.amount;
      }
    }
    
    // Return statistics
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      stats
    });
  } catch (error) {
    console.error('Error getting SOL statistics:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to get SOL statistics',
        details: error.message
      }
    });
  }
});

// Get all transactions
router.get('/transactions', async (req, res) => {
  try {
    console.log('Getting all transactions...');
    
    // Get all transactions
    const transactions = await Transaction.getAll();
    
    // Return transactions
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      count: transactions.length,
      transactions
    });
  } catch (error) {
    console.error('Error getting transactions:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to get transactions',
        details: error.message
      }
    });
  }
});

// Get tax token transactions
router.get('/transactions/tax-token', async (req, res) => {
  try {
    console.log('Getting tax token transactions...');
    
    // Check if tax token mint is set
    const taxTokenMint = process.env.TAX_TOKEN_MINT_ADDRESS;
    if (!taxTokenMint) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Tax token mint address not set'
        }
      });
    }
    
    // Get transactions for tax token
    const transactions = await Transaction.getByTokenMint(taxTokenMint);
    
    // Return transactions
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      tokenMint: taxTokenMint,
      count: transactions.length,
      transactions
    });
  } catch (error) {
    console.error('Error getting tax token transactions:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to get tax token transactions',
        details: error.message
      }
    });
  }
});

// Get token transactions by mint
router.get('/transactions/token/:tokenMint', async (req, res) => {
  try {
    const { tokenMint } = req.params;
    console.log(`Getting transactions for token: ${tokenMint}`);
    
    // Get transactions for token
    const transactions = await Transaction.getByTokenMint(tokenMint);
    
    // Return transactions
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      tokenMint,
      count: transactions.length,
      transactions
    });
  } catch (error) {
    console.error(`Error getting transactions for token ${req.params.tokenMint}:`, error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to get token transactions',
        details: error.message
      }
    });
  }
});

// Get SOL transactions
router.get('/transactions/sol', async (req, res) => {
  try {
    console.log('Getting SOL transactions...');
    
    // Get transactions for SOL
    const transactions = await Transaction.getByToken('SOL');
    
    // Return transactions
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      count: transactions.length,
      transactions
    });
  } catch (error) {
    console.error('Error getting SOL transactions:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to get SOL transactions',
        details: error.message
      }
    });
  }
});

// Get collected transactions
router.get('/transactions/collected', async (req, res) => {
  try {
    console.log('Getting collected transactions...');
    
    // Get transactions with type 'received'
    const transactions = await Transaction.find({ type: 'received' });
    
    // Return transactions
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      count: transactions.length,
      transactions
    });
  } catch (error) {
    console.error('Error getting collected transactions:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to get collected transactions',
        details: error.message
      }
    });
  }
});

// Get distributed transactions
router.get('/transactions/distributed', async (req, res) => {
  try {
    console.log('Getting distributed transactions...');
    
    // Get transactions with type 'sent'
    const transactions = await Transaction.find({ type: 'sent' });
    
    // Return transactions
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      count: transactions.length,
      transactions
    });
  } catch (error) {
    console.error('Error getting distributed transactions:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to get distributed transactions',
        details: error.message
      }
    });
  }
});

// Get swap transactions
router.get('/transactions/swaps', async (req, res) => {
  try {
    console.log('Getting swap transactions...');
    
    // Get transactions with type 'swap'
    const transactions = await Transaction.find({ type: 'swap' });
    
    // Return transactions
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      count: transactions.length,
      transactions
    });
  } catch (error) {
    console.error('Error getting swap transactions:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to get swap transactions',
        details: error.message
      }
    });
  }
});

// Fetch transactions from Helius API
router.post('/fetch-transactions', async (req, res) => {
  try {
    console.log('Fetching transactions from Helius API...');
    
    // Fetch transactions
    const transactions = await heliusService.fetchTransactions();
    
    // Return transactions
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      count: transactions.length,
      transactions
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to fetch transactions',
        details: error.message
      }
    });
  }
});

// Add a sample transaction (for testing)
router.get('/add-sample', async (req, res) => {
  try {
    console.log('Adding sample transaction...');
    
    // Create sample transaction
    const transaction = new Transaction({
      signature: `sample-${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'received',
      amount: 1.0,
      token: 'SOL',
      sender: 'SampleSender123456789',
      receiver: process.env.DISTRIBUTION_WALLET_ADDRESS,
      fee: 0.000005,
      status: 'success',
      blockTime: Math.floor(Date.now() / 1000),
      slot: 123456789
    });
    
    // Save transaction
    await transaction.save();
    
    // Return transaction
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      transaction
    });
  } catch (error) {
    console.error('Error adding sample transaction:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to add sample transaction',
        details: error.message
      }
    });
  }
});

module.exports = router; 