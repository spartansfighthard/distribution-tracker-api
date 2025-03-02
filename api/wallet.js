// API endpoint to fetch wallet data
// This endpoint allows querying data for any Solana wallet address

const { Connection, PublicKey } = require('@solana/web3.js');
const { getTransactions } = require('../src/transactions');
const { getEnvironment } = require('../src/utils');

module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');

  // Handle OPTIONS request for CORS preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // API Key Authentication
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  const validApiKey = process.env.API_KEY;
  
  // Skip API key validation for the Telegram bot
  const isTelegramBot = req.headers['user-agent']?.includes('TelegramBot');
  const isLocalRequest = req.headers['x-forwarded-for'] === '127.0.0.1' || req.connection.remoteAddress === '127.0.0.1';
  
  // Only validate API key if it's configured and not from the Telegram bot or local request
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
    // Get wallet address from query parameters
    const { address, limit = 50 } = req.query;

    if (!address) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Wallet address is required',
          code: 400
        }
      });
    }

    // Validate wallet address
    let publicKey;
    try {
      publicKey = new PublicKey(address);
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Invalid wallet address',
          code: 400
        }
      });
    }

    // Get environment info
    const environment = getEnvironment();
    const isVercel = process.env.VERCEL === '1';

    // Connect to Solana
    const connection = new Connection(
      process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
      'confirmed'
    );

    // Get wallet balance
    const balance = await connection.getBalance(publicKey);

    // Get transaction history (limited to avoid timeouts)
    const transactionLimit = parseInt(limit, 10);
    const transactions = await getTransactions(connection, publicKey.toString(), transactionLimit);

    // Calculate totals
    let totalReceived = 0;
    let totalSent = 0;
    let totalRewards = 0;

    transactions.forEach(tx => {
      if (tx.type === 'received') {
        totalReceived += parseFloat(tx.amount);
      } else if (tx.type === 'sent') {
        totalSent += parseFloat(tx.amount);
      } else if (tx.type === 'reward') {
        totalRewards += parseFloat(tx.amount);
      }
    });

    // Return wallet data
    res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      environment: environment,
      vercel: isVercel,
      data: {
        address: publicKey.toString(),
        balance: (balance / 1000000000).toFixed(9),
        totalReceived: totalReceived.toFixed(9),
        totalSent: totalSent.toFixed(9),
        totalRewards: totalRewards.toFixed(9),
        transactionCount: transactions.length,
        solscanLink: `https://solscan.io/account/${publicKey.toString()}`
      },
      fetchedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in wallet API:', error);
    
    res.status(500).json({
      success: false,
      error: {
        message: `Error fetching wallet data: ${error.message}`,
        code: 500
      }
    });
  }
}; 