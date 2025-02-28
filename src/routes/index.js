const express = require('express');
const router = express.Router();
const Transaction = require('../models/Transaction');
const heliusService = require('../services/heliusService');

// Get overall tax statistics
router.get('/stats', async (req, res) => {
  try {
    const stats = await heliusService.getTaxStats();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// Get tax token statistics
router.get('/stats/tax-token', async (req, res) => {
  try {
    if (!heliusService.TAX_TOKEN_MINT) {
      return res.status(400).json({ error: 'TAX_TOKEN_MINT_ADDRESS is not set in environment variables' });
    }
    
    const stats = await heliusService.getTaxTokenStats();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching tax token stats:', error);
    res.status(500).json({ error: 'Failed to fetch tax token statistics' });
  }
});

// Get statistics for a specific token mint
router.get('/stats/token/:tokenMint', async (req, res) => {
  try {
    const { tokenMint } = req.params;
    const stats = await heliusService.getTokenMintStats(tokenMint);
    res.json(stats);
  } catch (error) {
    console.error(`Error fetching stats for token mint ${req.params.tokenMint}:`, error);
    res.status(500).json({ error: 'Failed to fetch token mint statistics' });
  }
});

// Get SOL transfer statistics
router.get('/stats/sol', async (req, res) => {
  try {
    const stats = await heliusService.getSolStats();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching SOL stats:', error);
    res.status(500).json({ error: 'Failed to fetch SOL statistics' });
  }
});

// Get all transactions with pagination
router.get('/transactions', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    const transactions = await Transaction.find()
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit);
    
    const total = await Transaction.countDocuments();
    
    res.json({
      transactions,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// Get tax token transactions
router.get('/transactions/tax-token', async (req, res) => {
  try {
    if (!heliusService.TAX_TOKEN_MINT) {
      return res.status(400).json({ error: 'TAX_TOKEN_MINT_ADDRESS is not set in environment variables' });
    }
    
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    const transactions = await Transaction.find({ 
      tokenMint: heliusService.TAX_TOKEN_MINT 
    })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit);
    
    const total = await Transaction.countDocuments({ 
      tokenMint: heliusService.TAX_TOKEN_MINT 
    });
    
    res.json({
      transactions,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching tax token transactions:', error);
    res.status(500).json({ error: 'Failed to fetch tax token transactions' });
  }
});

// Get transactions for a specific token mint
router.get('/transactions/token/:tokenMint', async (req, res) => {
  try {
    const { tokenMint } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    const transactions = await Transaction.find({ tokenMint })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit);
    
    const total = await Transaction.countDocuments({ tokenMint });
    
    res.json({
      transactions,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error(`Error fetching transactions for token mint ${req.params.tokenMint}:`, error);
    res.status(500).json({ error: 'Failed to fetch token transactions' });
  }
});

// Get SOL transactions
router.get('/transactions/sol', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    const transactions = await Transaction.find({ tokenMint: heliusService.NATIVE_SOL_MINT })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit);
    
    const total = await Transaction.countDocuments({ tokenMint: heliusService.NATIVE_SOL_MINT });
    
    res.json({
      transactions,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching SOL transactions:', error);
    res.status(500).json({ error: 'Failed to fetch SOL transactions' });
  }
});

// Get tax collection transactions
router.get('/transactions/collected', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    // Filter by tax token if specified in query
    const filter = { type: 'collection' };
    if (req.query.taxTokenOnly === 'true' && heliusService.TAX_TOKEN_MINT) {
      filter.tokenMint = heliusService.TAX_TOKEN_MINT;
    }
    
    const transactions = await Transaction.find(filter)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit);
    
    const total = await Transaction.countDocuments(filter);
    
    res.json({
      transactions,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching collection transactions:', error);
    res.status(500).json({ error: 'Failed to fetch collection transactions' });
  }
});

// Get tax distribution transactions
router.get('/transactions/distributed', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    // Filter by tax token if specified in query
    const filter = { type: 'distribution' };
    if (req.query.taxTokenOnly === 'true' && heliusService.TAX_TOKEN_MINT) {
      filter.tokenMint = heliusService.TAX_TOKEN_MINT;
    }
    
    const transactions = await Transaction.find(filter)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit);
    
    const total = await Transaction.countDocuments(filter);
    
    res.json({
      transactions,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching distribution transactions:', error);
    res.status(500).json({ error: 'Failed to fetch distribution transactions' });
  }
});

// Get swap transactions
router.get('/transactions/swaps', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    const transactions = await Transaction.find({ isSwap: true })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit);
    
    const total = await Transaction.countDocuments({ isSwap: true });
    
    res.json({
      transactions,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching swap transactions:', error);
    res.status(500).json({ error: 'Failed to fetch swap transactions' });
  }
});

// Manually trigger transaction fetch (protected endpoint)
router.post('/fetch-transactions', async (req, res) => {
  try {
    // In a production environment, you would add authentication here
    const limit = parseInt(req.query.limit) || 50;
    const processed = await heliusService.fetchAndProcessTransactions(limit);
    res.json({ success: true, processed });
  } catch (error) {
    console.error('Error in manual transaction fetch:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

module.exports = router; 