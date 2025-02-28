// Load environment variables
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { setTimeout } = require('timers/promises');

// Updated configuration for better rate limiting (2025-02-28)
const CONFIG = {
  // API rate limiting
  rateLimits: {
    requestsPerSecond: 0.2,      // Ultra conservative: 1 request per 5 seconds
    retryDelay: 15000,           // 15 seconds base delay for retries
    maxRetries: 3,               // Maximum number of retries for failed requests
    batchSize: 1,                // Process only one transaction at a time
    batchDelay: 10000,           // 10 seconds between batches
    initialBackoff: 30000,       // 30 seconds initial backoff time
  },
  // Transaction fetching
  transactions: {
    maxTransactionsToFetch: 10,  // Only fetch 10 transactions at a time
    cacheExpiration: 30 * 60 * 1000, // Cache expiration time in ms (30 minutes)
    maxTransactionsPerRequest: 5, // Maximum number of transactions to process per API request
  }
};

// Rate limiter utility with proper queue
class RateLimiter {
  constructor(requestsPerSecond = CONFIG.rateLimits.requestsPerSecond) {
    this.requestsPerSecond = requestsPerSecond;
    this.queue = [];
    this.processing = false;
    this.lastRequestTime = 0;
    this.consecutiveErrors = 0;
    this.requestCount = 0;
    this.lastRateLimitTime = null;
    this.cooldownPeriod = 60000; // 1 minute cooldown after rate limit
  }

  async throttle() {
    const now = Date.now();
    
    // If we've hit a rate limit recently, enforce a longer cooldown
    if (this.lastRateLimitTime && (now - this.lastRateLimitTime) < this.cooldownPeriod) {
      const remainingCooldown = this.cooldownPeriod - (now - this.lastRateLimitTime);
      console.log(`In cooldown period after rate limit. Waiting ${remainingCooldown}ms before next request`);
      await setTimeout(remainingCooldown);
    }
    
    // Add extra delay if we've had consecutive errors
    const extraDelay = this.consecutiveErrors * 5000; // 5 seconds per consecutive error
    const baseDelay = Math.max(0, (1000 / this.requestsPerSecond) - (now - this.lastRequestTime));
    const timeToWait = baseDelay + extraDelay;
    
    if (timeToWait > 0) {
      console.log(`Rate limiting: waiting ${timeToWait}ms before next request (consecutive errors: ${this.consecutiveErrors})`);
      await setTimeout(timeToWait);
    }
    
    this.lastRequestTime = Date.now();
    this.requestCount++;
  }

  // Add request to queue and process
  async enqueue(requestFn) {
    return new Promise((resolve, reject) => {
      // Add to queue
      this.queue.push({ requestFn, resolve, reject });
      
      // Start processing if not already
      if (!this.processing) {
        this.processQueue();
      }
    });
  }

  // Process queue
  async processQueue() {
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }

    this.processing = true;
    const { requestFn, resolve, reject } = this.queue.shift();

    try {
      await this.throttle();
      const result = await requestFn();
      // Reset consecutive errors on success
      this.consecutiveErrors = 0;
      resolve(result);
    } catch (error) {
      // If we hit a rate limit, record the time and increment consecutive errors
      if (error.response && error.response.status === 429) {
        this.consecutiveErrors++;
        this.lastRateLimitTime = Date.now();
        
        const waitTime = CONFIG.rateLimits.initialBackoff * Math.pow(2, this.consecutiveErrors - 1);
        console.log(`Rate limit hit, waiting ${waitTime}ms before continuing (consecutive errors: ${this.consecutiveErrors})...`);
        await setTimeout(waitTime);
        
        // Put the request back at the front of the queue if we haven't exceeded max retries
        if (this.consecutiveErrors <= CONFIG.rateLimits.maxRetries) {
          console.log(`Retrying request after rate limit (attempt ${this.consecutiveErrors}/${CONFIG.rateLimits.maxRetries})`);
          this.queue.unshift({ requestFn, resolve, reject });
        } else {
          console.log(`Exceeded maximum retries (${CONFIG.rateLimits.maxRetries}) after rate limit`);
          reject(error);
        }
      } else {
        // For other errors, increment consecutive errors but don't retry
        this.consecutiveErrors++;
        reject(error);
      }
    } finally {
      // Continue processing queue after a delay
      setTimeout(() => this.processQueue(), 1000);
    }
  }

  // Send request through the queue
  async sendRequest(requestFn) {
    return this.enqueue(requestFn);
  }
}

// Create a rate limiter instance
const heliusRateLimiter = new RateLimiter(CONFIG.rateLimits.requestsPerSecond);

// Create Express app
const app = express();

// In-memory storage for transactions
const transactions = [];
let lastFetchTimestamp = null;

// Constants
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const HELIUS_RPC_URL = process.env.HELIUS_RPC_URL;
const DISTRIBUTION_WALLET_ADDRESS = process.env.DISTRIBUTION_WALLET_ADDRESS;
const TAX_TOKEN_MINT_ADDRESS = process.env.TAX_TOKEN_MINT_ADDRESS;

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

// Transaction class
class Transaction {
  constructor(data) {
    this.signature = data.signature;
    this.timestamp = data.timestamp || new Date().toISOString();
    this.type = data.type || 'unknown';
    this.amount = data.amount || 0;
    this.token = data.token || 'SOL';
    this.tokenMint = data.tokenMint || null;
    this.sender = data.sender || null;
    this.receiver = data.receiver || null;
    this.fee = data.fee || 0;
    this.status = data.status || 'success';
    this.blockTime = data.blockTime || Math.floor(Date.now() / 1000);
    this.slot = data.slot || 0;
    this.meta = data.meta || {};
  }

  // Save transaction to in-memory storage
  async save() {
    try {
      // Check if transaction already exists
      const existingIndex = transactions.findIndex(t => t.signature === this.signature);
      
      if (existingIndex >= 0) {
        // Update existing transaction
        transactions[existingIndex] = this;
        console.log(`Updated transaction: ${this.signature}`);
      } else {
        // Add new transaction
        transactions.push(this);
        console.log(`Saved new transaction: ${this.signature}`);
      }
      
      return this;
    } catch (error) {
      console.error('Error saving transaction:', error);
      throw error;
    }
  }
}

// Fetch transactions from Helius API
async function fetchTransactions() {
  try {
    console.log('Fetching transactions from Helius API...');
    
    if (!HELIUS_API_KEY || !HELIUS_RPC_URL || !DISTRIBUTION_WALLET_ADDRESS) {
      console.error('Missing required environment variables for Helius service');
      return [];
    }
    
    // Prepare request data
    const requestData = {
      jsonrpc: '2.0',
      id: 'my-id',
      method: 'getSignaturesForAddress',
      params: [
        DISTRIBUTION_WALLET_ADDRESS,
        {
          limit: CONFIG.transactions.maxTransactionsToFetch
        }
      ]
    };
    
    // Make request to Helius API
    const response = await heliusRateLimiter.sendRequest(async () => {
      return await axios.post(HELIUS_RPC_URL, requestData);
    });
    
    // Check if response is valid
    if (!response.data || !response.data.result) {
      console.error('Invalid response from Helius API:', response.data);
      return [];
    }
    
    // Get signatures from response
    const signatures = response.data.result;
    console.log(`Fetched ${signatures.length} signatures`);
    
    // Filter out signatures that we've already processed
    const newSignatures = signatures.filter(sig => 
      !transactions.some(tx => tx.signature === sig.signature)
    );
    console.log(`Found ${newSignatures.length} new signatures to process`);
    
    // Process signatures in smaller batches with longer delays
    const batchSize = CONFIG.rateLimits.batchSize;
    const newTransactions = [];
    
    // Only process a limited number of signatures to avoid overwhelming the API
    const maxSignaturesToProcess = Math.min(
      newSignatures.length, 
      CONFIG.transactions.maxTransactionsPerRequest
    );
    
    const signaturesToProcess = newSignatures.slice(0, maxSignaturesToProcess);
    
    if (signaturesToProcess.length < newSignatures.length) {
      console.log(`Limiting processing to ${maxSignaturesToProcess} signatures out of ${newSignatures.length} to avoid rate limits`);
    }
    
    // Process one signature at a time with significant delays between each
    for (const sig of signaturesToProcess) {
      try {
        console.log(`Processing signature: ${sig.signature}`);
        
        const txDetails = await getTransactionDetails(sig.signature);
        if (txDetails) {
          newTransactions.push(txDetails);
          console.log(`Successfully processed transaction: ${sig.signature}`);
        }
        
        // Add a significant delay between processing signatures
        if (signaturesToProcess.indexOf(sig) < signaturesToProcess.length - 1) {
          console.log(`Waiting ${CONFIG.rateLimits.batchDelay}ms before processing next signature...`);
          await setTimeout(CONFIG.rateLimits.batchDelay);
        }
      } catch (error) {
        console.error(`Error processing signature ${sig.signature}:`, error.message);
        // If we hit a rate limit, stop processing further signatures
        if (error.response && error.response.status === 429) {
          console.log('Rate limit hit, stopping further processing for this request');
          break;
        }
        // Continue with next signature
        continue;
      }
    }
    
    // Update last fetch timestamp
    lastFetchTimestamp = new Date().toISOString();
    
    console.log(`Successfully processed ${newTransactions.length} new transactions`);
    return newTransactions;
  } catch (error) {
    console.error('Error fetching transactions:', error);
    return [];
  }
}

// Get transaction details from Helius API
async function getTransactionDetails(signature) {
  let retries = 0;
  const maxRetries = CONFIG.rateLimits.maxRetries;
  
  while (retries <= maxRetries) {
    try {
      console.log(`Getting details for transaction: ${signature}`);
      
      // Prepare request data
      const requestData = {
        jsonrpc: '2.0',
        id: 'my-id',
        method: 'getTransaction',
        params: [
          signature,
          {
            encoding: 'jsonParsed',
            maxSupportedTransactionVersion: 0
          }
        ]
      };
      
      // Make request to Helius API
      const response = await heliusRateLimiter.sendRequest(async () => {
        return await axios.post(HELIUS_RPC_URL, requestData);
      });
      
      // Check if response is valid
      if (!response.data || !response.data.result) {
        console.error('Invalid response from Helius API:', response.data);
        return null;
      }
      
      // Get transaction data
      const txData = response.data.result;
      
      // Process transaction data
      const transaction = processTransaction(signature, txData);
      if (transaction) {
        // Save transaction to in-memory storage
        const txModel = new Transaction(transaction);
        await txModel.save();
        return transaction;
      }
      
      return null;
    } catch (error) {
      retries++;
      
      // If we've hit a rate limit and have retries left, wait and try again
      if (error.response && error.response.status === 429 && retries <= maxRetries) {
        const waitTime = Math.pow(2, retries) * CONFIG.rateLimits.retryDelay; // Exponential backoff
        console.log(`Rate limit hit, retrying in ${waitTime}ms (attempt ${retries}/${maxRetries})...`);
        await setTimeout(waitTime);
      } else if (retries <= maxRetries) {
        // For other errors, wait a bit less before retrying
        console.log(`Error fetching transaction, retrying in 5000ms (attempt ${retries}/${maxRetries})...`);
        await setTimeout(5000);
      } else {
        // We've exhausted our retries
        console.error(`Error getting transaction details for ${signature} after ${maxRetries} retries:`, error.message);
        return null;
      }
    }
  }
  
  return null;
}

// Process transaction data
function processTransaction(signature, txData) {
  try {
    // Check if transaction is valid
    if (!txData || !txData.meta || txData.meta.err) {
      console.log(`Skipping failed transaction: ${signature}`);
      return null;
    }
    
    // Basic transaction data
    const transaction = {
      signature,
      blockTime: txData.blockTime,
      slot: txData.slot,
      timestamp: new Date(txData.blockTime * 1000).toISOString(),
      meta: {}
    };
    
    // Determine transaction type and details
    const preBalances = txData.meta.preBalances;
    const postBalances = txData.meta.postBalances;
    const accountKeys = txData.transaction.message.accountKeys;
    
    if (preBalances && postBalances && accountKeys) {
      // Find index of distribution wallet
      const walletIndex = accountKeys.findIndex(key => 
        key.pubkey === DISTRIBUTION_WALLET_ADDRESS
      );
      
      if (walletIndex >= 0) {
        const preBal = preBalances[walletIndex];
        const postBal = postBalances[walletIndex];
        const diff = postBal - preBal;
        
        if (diff > 0) {
          // Received SOL
          transaction.type = 'received';
          transaction.amount = diff / 1e9; // Convert lamports to SOL
          transaction.token = 'SOL';
          transaction.receiver = DISTRIBUTION_WALLET_ADDRESS;
          
          // Try to determine sender
          const senderIndex = preBalances.findIndex((bal, i) => 
            i !== walletIndex && preBalances[i] > postBalances[i]
          );
          if (senderIndex >= 0) {
            transaction.sender = accountKeys[senderIndex].pubkey;
          }
        } else if (diff < 0) {
          // Sent SOL
          transaction.type = 'sent';
          transaction.amount = Math.abs(diff) / 1e9; // Convert lamports to SOL
          transaction.token = 'SOL';
          transaction.sender = DISTRIBUTION_WALLET_ADDRESS;
          
          // Try to determine receiver
          const receiverIndex = preBalances.findIndex((bal, i) => 
            i !== walletIndex && preBalances[i] < postBalances[i]
          );
          if (receiverIndex >= 0) {
            transaction.receiver = accountKeys[receiverIndex].pubkey;
          }
        }
      }
    }
    
    // If we couldn't determine the transaction type, mark as unknown
    if (!transaction.type) {
      transaction.type = 'unknown';
      transaction.meta.raw = txData;
    }
    
    return transaction;
  } catch (error) {
    console.error(`Error processing transaction ${signature}:`, error);
    return null;
  }
}

// Get transaction statistics
function getStats() {
  try {
    console.log('Getting transaction statistics...');
    
    // Calculate statistics
    const stats = {
      totalTransactions: transactions.length,
      transactionsByType: {},
      transactionsByToken: {},
      totalAmountByToken: {}
    };
    
    // Process each transaction
    for (const tx of transactions) {
      // Count by type
      stats.transactionsByType[tx.type] = (stats.transactionsByType[tx.type] || 0) + 1;
      
      // Count by token
      stats.transactionsByToken[tx.token] = (stats.transactionsByToken[tx.token] || 0) + 1;
      
      // Sum amount by token
      if (tx.amount) {
        stats.totalAmountByToken[tx.token] = (stats.totalAmountByToken[tx.token] || 0) + tx.amount;
      }
    }
    
    return stats;
  } catch (error) {
    console.error('Error getting transaction statistics:', error);
    return {
      totalTransactions: 0,
      transactionsByType: {},
      transactionsByToken: {},
      totalAmountByToken: {}
    };
  }
}

// Wrap API endpoints with error handling
const asyncHandler = fn => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Root route handler
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'SOL Distribution Tracker API is running',
    version: process.env.npm_package_version || '1.0.0',
    endpoints: [
      '/api/stats',
      '/api/distributed',
      '/api/sol',
      '/api/refresh',
      '/api/help'
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

// Help endpoint
app.get('/api/help', (req, res) => {
  res.status(200).json({
    success: true,
    timestamp: new Date().toISOString(),
    commands: [
      { command: '/stats', description: 'Show overall SOL statistics' },
      { command: '/distributed', description: 'Show SOL distribution data' },
      { command: '/sol', description: 'Show detailed SOL transfer statistics' },
      { command: '/refresh', description: 'Force refresh historical transaction data' },
      { command: '/help', description: 'Show this help message' }
    ]
  });
});

// Get overall SOL statistics
app.get('/api/stats', asyncHandler(async (req, res) => {
  console.log('Getting overall SOL statistics...');
  
  try {
    // If no transactions or cache expired, try to fetch some
    const cacheExpired = lastFetchTimestamp && 
      (new Date() - new Date(lastFetchTimestamp)) > CONFIG.transactions.cacheExpiration;
    
    // Only fetch new transactions if we have none or cache is expired
    if (transactions.length === 0 || cacheExpired) {
      await fetchTransactions();
    } else {
      console.log(`Using cached transactions (${transactions.length} transactions)`);
    }
    
    // Get transaction statistics
    const stats = getStats();
    
    // Return statistics
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      lastFetch: lastFetchTimestamp,
      cacheStatus: {
        transactionCount: transactions.length,
        cacheExpired: cacheExpired,
        cacheExpiresIn: cacheExpired ? 0 : 
          CONFIG.transactions.cacheExpiration - (new Date() - new Date(lastFetchTimestamp))
      },
      stats
    });
  } catch (error) {
    console.error('Error in /api/stats:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to get statistics',
        details: error.message
      }
    });
  }
}));

// Get SOL distribution data
app.get('/api/distributed', asyncHandler(async (req, res) => {
  console.log('Getting SOL distribution data...');
  
  // If no transactions or cache expired, try to fetch some
  const cacheExpired = lastFetchTimestamp && 
    (new Date() - new Date(lastFetchTimestamp)) > CONFIG.transactions.cacheExpiration;
  
  if (transactions.length === 0 || cacheExpired) {
    await fetchTransactions();
  }
  
  // Get transactions with type 'sent'
  const sentTransactions = transactions.filter(tx => tx.type === 'sent' && tx.token === 'SOL');
  
  // Calculate distribution statistics
  const stats = {
    totalTransactions: sentTransactions.length,
    totalDistributed: sentTransactions.reduce((sum, tx) => sum + tx.amount, 0),
    averageDistribution: sentTransactions.length > 0 
      ? sentTransactions.reduce((sum, tx) => sum + tx.amount, 0) / sentTransactions.length 
      : 0,
    largestDistribution: sentTransactions.length > 0 
      ? Math.max(...sentTransactions.map(tx => tx.amount)) 
      : 0,
    smallestDistribution: sentTransactions.length > 0 
      ? Math.min(...sentTransactions.map(tx => tx.amount)) 
      : 0,
    recentDistributions: sentTransactions.slice(0, 5)
  };
  
  // Return statistics
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    stats
  });
}));

// Get detailed SOL transfer statistics
app.get('/api/sol', asyncHandler(async (req, res) => {
  console.log('Getting detailed SOL transfer statistics...');
  
  // If no transactions or cache expired, try to fetch some
  const cacheExpired = lastFetchTimestamp && 
    (new Date() - new Date(lastFetchTimestamp)) > CONFIG.transactions.cacheExpiration;
  
  if (transactions.length === 0 || cacheExpired) {
    await fetchTransactions();
  }
  
  // Get transactions for SOL
  const solTransactions = transactions.filter(tx => tx.token === 'SOL');
  
  // Calculate statistics
  const received = solTransactions.filter(tx => tx.type === 'received');
  const sent = solTransactions.filter(tx => tx.type === 'sent');
  
  const stats = {
    totalTransactions: solTransactions.length,
    received: {
      count: received.length,
      total: received.reduce((sum, tx) => sum + tx.amount, 0),
      average: received.length > 0 
        ? received.reduce((sum, tx) => sum + tx.amount, 0) / received.length 
        : 0
    },
    sent: {
      count: sent.length,
      total: sent.reduce((sum, tx) => sum + tx.amount, 0),
      average: sent.length > 0 
        ? sent.reduce((sum, tx) => sum + tx.amount, 0) / sent.length 
        : 0
    },
    balance: received.reduce((sum, tx) => sum + tx.amount, 0) - sent.reduce((sum, tx) => sum + tx.amount, 0),
    recentTransactions: solTransactions.slice(0, 5)
  };
  
  // Return statistics
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    stats
  });
}));

// Force refresh historical transaction data
app.post('/api/refresh', asyncHandler(async (req, res) => {
  console.log('Refreshing historical transaction data...');
  
  try {
    // Check if we've fetched recently to avoid rate limits
    const lastFetchTime = lastFetchTimestamp ? new Date(lastFetchTimestamp) : null;
    const timeSinceLastFetch = lastFetchTime ? (new Date() - lastFetchTime) : Infinity;
    
    if (timeSinceLastFetch < 60000) { // 1 minute
      console.log(`Last fetch was ${Math.round(timeSinceLastFetch / 1000)} seconds ago. Skipping to avoid rate limits.`);
      
      return res.json({
        success: true,
        timestamp: new Date().toISOString(),
        message: 'Skipped refresh to avoid rate limits',
        lastFetch: lastFetchTimestamp,
        waitTime: 60000 - timeSinceLastFetch,
        totalTransactions: transactions.length,
        recentTransactions: transactions.slice(0, 5)
      });
    }
    
    // Fetch transactions
    const newTransactions = await fetchTransactions();
    
    // Return transactions
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      message: 'Historical transaction data refreshed successfully',
      count: newTransactions.length,
      totalTransactions: transactions.length,
      recentTransactions: transactions.slice(0, 5)
    });
  } catch (error) {
    console.error('Error in /api/refresh:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to refresh transaction data',
        details: error.message
      }
    });
  }
}));

// Add a sample transaction (for testing)
app.get('/api/add-sample', async (req, res) => {
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
      receiver: DISTRIBUTION_WALLET_ADDRESS,
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

// Initialize Telegram bot (only in local environment)
if (process.env.TELEGRAM_BOT_TOKEN && !process.env.VERCEL) {
  try {
    // Only require the Telegram bot module if we're not in Vercel
    const TelegramBot = require('node-telegram-bot-api');
    const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
    
    // Define bot commands
    bot.onText(/\/start/, (msg) => {
      const chatId = msg.chat.id;
      bot.sendMessage(chatId, 'Welcome to the SOL Distribution Tracker Bot! Use /help to see available commands.');
    });
    
    bot.onText(/\/help/, (msg) => {
      const chatId = msg.chat.id;
      bot.sendMessage(chatId, 'Available commands:\n/stats - Show overall SOL statistics\n/distributed - Show SOL distribution data\n/sol - Show detailed SOL transfer statistics\n/refresh - Force refresh historical transaction data\n/help - Show this help message');
    });
    
    bot.onText(/\/stats/, async (msg) => {
      const chatId = msg.chat.id;
      try {
        bot.sendMessage(chatId, 'Fetching overall SOL statistics...');
        
        // If no transactions, try to fetch some
        if (transactions.length === 0) {
          await fetchTransactions();
        }
        
        // Get transaction statistics
        const stats = getStats();
        
        // Format message
        let message = '📊 *SOL Statistics*\n\n';
        message += `Total Transactions: ${stats.totalTransactions}\n\n`;
        
        if (Object.keys(stats.transactionsByType).length > 0) {
          message += '*Transaction Types:*\n';
          for (const [type, count] of Object.entries(stats.transactionsByType)) {
            message += `- ${type}: ${count}\n`;
          }
          message += '\n';
        }
        
        if (Object.keys(stats.totalAmountByToken).length > 0) {
          message += '*Total Amount by Token:*\n';
          for (const [token, amount] of Object.entries(stats.totalAmountByToken)) {
            message += `- ${token}: ${amount.toFixed(4)}\n`;
          }
        }
        
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      } catch (error) {
        bot.sendMessage(chatId, `Error fetching statistics: ${error.message}`);
      }
    });
    
    bot.onText(/\/distributed/, async (msg) => {
      const chatId = msg.chat.id;
      try {
        bot.sendMessage(chatId, 'Fetching SOL distribution data...');
        
        // If no transactions, try to fetch some
        if (transactions.length === 0) {
          await fetchTransactions();
        }
        
        // Get transactions with type 'sent'
        const sentTransactions = transactions.filter(tx => tx.type === 'sent' && tx.token === 'SOL');
        
        // Calculate distribution statistics
        const stats = {
          totalTransactions: sentTransactions.length,
          totalDistributed: sentTransactions.reduce((sum, tx) => sum + tx.amount, 0),
          averageDistribution: sentTransactions.length > 0 
            ? sentTransactions.reduce((sum, tx) => sum + tx.amount, 0) / sentTransactions.length 
            : 0,
          largestDistribution: sentTransactions.length > 0 
            ? Math.max(...sentTransactions.map(tx => tx.amount)) 
            : 0,
          smallestDistribution: sentTransactions.length > 0 
            ? Math.min(...sentTransactions.map(tx => tx.amount)) 
            : 0
        };
        
        // Format message
        let message = '💸 *SOL Distribution Data*\n\n';
        message += `Total Distributions: ${stats.totalTransactions}\n`;
        message += `Total SOL Distributed: ${stats.totalDistributed.toFixed(4)}\n`;
        message += `Average Distribution: ${stats.averageDistribution.toFixed(4)}\n`;
        message += `Largest Distribution: ${stats.largestDistribution.toFixed(4)}\n`;
        message += `Smallest Distribution: ${stats.smallestDistribution.toFixed(4)}\n\n`;
        
        if (sentTransactions.length > 0) {
          message += '*Recent Distributions:*\n';
          for (let i = 0; i < Math.min(3, sentTransactions.length); i++) {
            const tx = sentTransactions[i];
            message += `- ${tx.amount.toFixed(4)} SOL to ${tx.receiver ? tx.receiver.substring(0, 8) + '...' : 'Unknown'}\n`;
          }
        }
        
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      } catch (error) {
        bot.sendMessage(chatId, `Error fetching distribution data: ${error.message}`);
      }
    });
    
    bot.onText(/\/sol/, async (msg) => {
      const chatId = msg.chat.id;
      try {
        bot.sendMessage(chatId, 'Fetching detailed SOL transfer statistics...');
        
        // If no transactions, try to fetch some
        if (transactions.length === 0) {
          await fetchTransactions();
        }
        
        // Get transactions for SOL
        const solTransactions = transactions.filter(tx => tx.token === 'SOL');
        
        // Calculate statistics
        const received = solTransactions.filter(tx => tx.type === 'received');
        const sent = solTransactions.filter(tx => tx.type === 'sent');
        
        const stats = {
          totalTransactions: solTransactions.length,
          received: {
            count: received.length,
            total: received.reduce((sum, tx) => sum + tx.amount, 0),
            average: received.length > 0 
              ? received.reduce((sum, tx) => sum + tx.amount, 0) / received.length 
              : 0
          },
          sent: {
            count: sent.length,
            total: sent.reduce((sum, tx) => sum + tx.amount, 0),
            average: sent.length > 0 
              ? sent.reduce((sum, tx) => sum + tx.amount, 0) / sent.length 
              : 0
          },
          balance: received.reduce((sum, tx) => sum + tx.amount, 0) - sent.reduce((sum, tx) => sum + tx.amount, 0)
        };
        
        // Format message
        let message = '🔍 *Detailed SOL Transfer Statistics*\n\n';
        message += `Total SOL Transactions: ${stats.totalTransactions}\n\n`;
        
        message += '*Received:*\n';
        message += `- Count: ${stats.received.count}\n`;
        message += `- Total: ${stats.received.total.toFixed(4)} SOL\n`;
        message += `- Average: ${stats.received.average.toFixed(4)} SOL\n\n`;
        
        message += '*Sent:*\n';
        message += `- Count: ${stats.sent.count}\n`;
        message += `- Total: ${stats.sent.total.toFixed(4)} SOL\n`;
        message += `- Average: ${stats.sent.average.toFixed(4)} SOL\n\n`;
        
        message += `*Current Balance:* ${stats.balance.toFixed(4)} SOL\n`;
        
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      } catch (error) {
        bot.sendMessage(chatId, `Error fetching SOL transfer statistics: ${error.message}`);
      }
    });
    
    bot.onText(/\/refresh/, async (msg) => {
      const chatId = msg.chat.id;
      try {
        bot.sendMessage(chatId, 'Refreshing historical transaction data...');
        
        // Fetch transactions
        const newTransactions = await fetchTransactions();
        
        // Format message
        let message = '🔄 *Transaction Data Refreshed*\n\n';
        message += `New Transactions: ${newTransactions.length}\n`;
        message += `Total Transactions: ${transactions.length}\n\n`;
        
        if (newTransactions.length > 0) {
          message += '*Recent Transactions:*\n';
          for (let i = 0; i < Math.min(3, newTransactions.length); i++) {
            const tx = newTransactions[i];
            if (tx.type === 'received') {
              message += `- Received ${tx.amount.toFixed(4)} SOL from ${tx.sender ? tx.sender.substring(0, 8) + '...' : 'Unknown'}\n`;
            } else if (tx.type === 'sent') {
              message += `- Sent ${tx.amount.toFixed(4)} SOL to ${tx.receiver ? tx.receiver.substring(0, 8) + '...' : 'Unknown'}\n`;
            } else {
              message += `- ${tx.type} transaction of ${tx.amount.toFixed(4)} SOL\n`;
            }
          }
        }
        
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      } catch (error) {
        bot.sendMessage(chatId, `Error refreshing data: ${error.message}`);
      }
    });
    
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