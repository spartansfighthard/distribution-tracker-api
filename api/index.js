// Load environment variables
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { setTimeout: setTimeoutPromise } = require('timers/promises');
const fs = require('fs').promises;
const path = require('path');
const nodeSetTimeout = global.setTimeout;

// API Shutdown flag check
const API_SHUTDOWN_FLAG_FILE = path.join('/tmp', 'api_shutdown_flag.json');
let isApiShutdown = false;

// Function to check if API is shut down
async function checkApiShutdown() {
  try {
    // Check global variable first
    if (global.API_SHUTDOWN) {
      isApiShutdown = true;
      return true;
    }
    
    // Check for flag file
    try {
      const flagData = await fs.readFile(API_SHUTDOWN_FLAG_FILE, 'utf8');
      const parsedData = JSON.parse(flagData);
      if (parsedData.shutdown) {
        isApiShutdown = true;
        global.API_SHUTDOWN = true;
        console.log('API shutdown flag detected. API is in maintenance mode.');
        return true;
      }
    } catch (err) {
      // File doesn't exist or can't be read, API is not shut down
      if (err.code !== 'ENOENT') {
        console.error('Error checking API shutdown flag:', err);
      }
    }
    
    isApiShutdown = false;
    return false;
  } catch (error) {
    console.error('Error in checkApiShutdown:', error);
    return false;
  }
}

// Storage configuration
const STORAGE_CONFIG = {
  localFilePath: path.join(process.cwd(), 'data', 'transactions.json'),
  vercelKVEnabled: process.env.VERCEL_KV_URL ? true : false,
  vercelBlobEnabled: true, // Always enable Blob storage
  storageKey: 'transactions_data',
  blobStoragePath: 'transactions/data.json',
  maxStoredTransactions: 1000000, // Store up to 1 million transactions (effectively unlimited)
  storageInterval: 5 * 1000, // How often to save data (5 seconds)
  lastStorageTime: null
};

// Stop collection configuration
const STOP_COLLECTION_CONFIG = {
  flagFilePath: path.join(process.cwd(), 'data', 'stop_collection.flag'),
  checkInterval: 30 * 1000, // Check for stop flag every 30 seconds
  isStopRequested: false,
  lastCheckTime: null
};

// Updated configuration for better rate limiting and timeout handling
const CONFIG = {
  // API rate limiting
  rateLimits: {
    requestsPerSecond: process.env.RATE_LIMIT_REQUESTS_PER_SECOND ? parseFloat(process.env.RATE_LIMIT_REQUESTS_PER_SECOND) : 0.1,  // Ultra conservative: 1 request per 10 seconds
    retryDelay: process.env.RATE_LIMIT_RETRY_DELAY ? parseInt(process.env.RATE_LIMIT_RETRY_DELAY) : 15000,  // 15 seconds base delay for retries
    maxRetries: process.env.MAX_RETRIES ? parseInt(process.env.MAX_RETRIES) : 3,  // Maximum number of retries for failed requests
    maxQueueSize: process.env.MAX_QUEUE_SIZE ? parseInt(process.env.MAX_QUEUE_SIZE) : 5,  // Reduced queue size
    errorCooldownPeriod: process.env.ERROR_COOLDOWN_PERIOD ? parseInt(process.env.ERROR_COOLDOWN_PERIOD) : 300000, // 5 minute cooldown after consecutive errors
    maxConsecutiveErrors: process.env.MAX_CONSECUTIVE_ERRORS ? parseInt(process.env.MAX_CONSECUTIVE_ERRORS) : 3 // Max consecutive errors before cooldown
  },

  // API Security
  security: {
    apiKeyRequired: process.env.API_KEY ? true : false,
    apiKey: process.env.API_KEY,
    // List of paths that don't require API key authentication
    publicPaths: ['/api/stats', '/api/health', '/']
  },
  
  // Transaction fetching
  transactions: {
    maxTransactionsToFetch: process.env.MAX_TRANSACTIONS_TO_FETCH ? parseInt(process.env.MAX_TRANSACTIONS_TO_FETCH) : 5,  // Reduced from 10 to 5 to prevent timeouts
    cacheExpiration: 30 * 60 * 1000, // Cache expiration time in ms (30 minutes)
    maxTransactionsPerRequest: process.env.MAX_TRANSACTIONS_PER_REQUEST ? parseInt(process.env.MAX_TRANSACTIONS_PER_REQUEST) : 1, // Reduced to 1
  },
  // Background jobs
  backgroundJobs: {
    enabled: process.env.DISABLE_BACKGROUND_JOBS !== 'true',
    autoFetchInterval: process.env.AUTO_FETCH_INTERVAL ? parseInt(process.env.AUTO_FETCH_INTERVAL) : 120 * 1000, // Increased to 2 minutes
    maxConsecutiveErrors: process.env.MAX_CONSECUTIVE_ERRORS ? parseInt(process.env.MAX_CONSECUTIVE_ERRORS) : 3,
    errorBackoffMultiplier: process.env.ERROR_BACKOFF_MULTIPLIER ? parseInt(process.env.ERROR_BACKOFF_MULTIPLIER) : 2,
    maxBackoffInterval: process.env.MAX_BACKOFF_INTERVAL ? parseInt(process.env.MAX_BACKOFF_INTERVAL) : 30 * 60 * 1000 // Maximum backoff of 30 minutes
  },
  // Vercel optimization
  vercel: {
    maxProcessingTime: process.env.VERCEL_MAX_PROCESSING_TIME ? parseInt(process.env.VERCEL_MAX_PROCESSING_TIME) : 3000,  // Reduced to 3 seconds
    maxTransactionsPerServerlessRequest: process.env.MAX_TRANSACTIONS_PER_SERVERLESS_REQUEST ? parseInt(process.env.MAX_TRANSACTIONS_PER_SERVERLESS_REQUEST) : 1, // Keep at 1
    skipRateLimiting: process.env.SKIP_RATE_LIMITING === 'true',  // Default to false
    skipDetailedProcessing: process.env.SKIP_DETAILED_PROCESSING !== 'false',  // Default to true
    incrementalFetching: process.env.INCREMENTAL_FETCHING !== 'false',  // Default to true
    maxSignaturesPerBatch: process.env.MAX_SIGNATURES_PER_BATCH ? parseInt(process.env.MAX_SIGNATURES_PER_BATCH) : 3  // Reduced from 5 to 3
  }
};

// Rate limiter utility with proper queue and circuit breaker
class RateLimiter {
  constructor(requestsPerSecond = CONFIG.rateLimits.requestsPerSecond) {
    this.requestsPerSecond = requestsPerSecond;
    this.queue = [];
    this.processing = false;
    this.lastRequestTime = 0;
    this.consecutiveErrors = 0;
    this.requestCount = 0;
    this.cooldownUntil = 0;
    this.cooldownPeriod = 60000; // 1 minute default cooldown
  }

  // Check if we're in cooldown mode
  isInCooldown() {
    if (this.cooldownUntil > Date.now()) {
      const remainingCooldown = Math.ceil((this.cooldownUntil - Date.now()) / 1000);
      console.log(`Still in cooldown mode for ${remainingCooldown} seconds`);
      return true;
    }
    return false;
  }

  // Enter cooldown mode
  enterCooldown(duration = null) {
    // If duration is provided, use it, otherwise use exponential backoff
    const cooldownTime = duration || Math.min(
      this.cooldownPeriod * Math.pow(2, this.consecutiveErrors),
      300000 // Max 5 minutes
    );
    
    this.cooldownUntil = Date.now() + cooldownTime;
    console.log(`Entering cooldown mode for ${cooldownTime / 1000} seconds until ${new Date(this.cooldownUntil).toISOString()}`);
    return cooldownTime;
  }

  async throttle() {
    // Check if we're in cooldown mode
    if (this.isInCooldown()) {
      throw new Error('Rate limiter is in cooldown mode');
    }
    
    const now = Date.now();
    // Add extra delay if we've had consecutive errors
    const extraDelay = this.consecutiveErrors * 2000; // 2 seconds per consecutive error
    const timeToWait = Math.max(0, (1000 / this.requestsPerSecond) - (now - this.lastRequestTime)) + extraDelay;
    
    if (timeToWait > 0) {
      console.log(`Rate limiting: waiting ${timeToWait}ms before next request (consecutive errors: ${this.consecutiveErrors})`);
      await new Promise(resolve => setTimeout(resolve, timeToWait));
    }
    
    this.lastRequestTime = Date.now();
    this.requestCount++;
  }

  // Add request to queue and process
  async enqueue(requestFn) {
    return new Promise((resolve, reject) => {
      // Check if we're in cooldown mode
      if (this.isInCooldown()) {
        return reject(new Error('Rate limiter is in cooldown mode'));
      }
      
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
      // Increment consecutive errors
      this.consecutiveErrors++;
      
      // If we hit a rate limit, enter cooldown mode
      if (error.response && error.response.status === 429) {
        const cooldownTime = this.enterCooldown();
        reject(new Error(`Rate limit hit, entering cooldown for ${cooldownTime / 1000} seconds`));
      } else {
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

// Initialize Express for Vercel serverless function
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// Middleware to check for API shutdown
app.use(async (req, res, next) => {
  // Skip shutdown check for the stop-api endpoint itself
  if (req.path === '/api/admin/stop-api') {
    return next();
  }
  
  // Check if API is shut down
  await checkApiShutdown();
  if (isApiShutdown) {
    return res.status(503).json({
      success: false,
      error: {
        message: 'API is currently in maintenance mode. Please try again later.',
        code: 503
      },
      maintenance: true,
      timestamp: new Date().toISOString()
    });
  }
  
  next();
});

// API Key Authentication Middleware
function authenticateApiKey(req, res, next) {
  // Skip authentication for public paths
  if (CONFIG.security.publicPaths.includes(req.path)) {
    return next();
  }
  
  // Skip API key validation if not configured
  if (!CONFIG.security.apiKeyRequired) {
    return next();
  }
  
  // Get API key from headers or query parameters
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  
  // Skip API key validation for the Telegram bot
  const isTelegramBot = req.headers['user-agent']?.includes('TelegramBot');
  const isLocalRequest = req.headers['x-forwarded-for'] === '127.0.0.1' || req.connection.remoteAddress === '127.0.0.1';
  
  if (isTelegramBot || isLocalRequest) {
    return next();
  }
  
  // Validate API key
  if (!apiKey || apiKey !== CONFIG.security.apiKey) {
    return res.status(401).json({
      success: false,
      error: {
        message: 'Unauthorized: Invalid or missing API key',
        code: 401
      }
    });
  }
  
  next();
}

// Apply authentication middleware
app.use(authenticateApiKey);

// In-memory storage for transactions - NOTE: This won't persist between serverless function invocations
// For Vercel, we'll need to fetch fresh data on each request
const transactions = [];
let lastFetchTimestamp = null;

// Background job state
const backgroundJobState = {
  isRunning: false,
  lastRunTime: null,
  consecutiveErrors: 0,
  currentInterval: CONFIG.backgroundJobs.autoFetchInterval,
  timerId: null,
  isStopped: false // Add flag to track if collection is stopped
};

// Constants
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const HELIUS_RPC_URL = process.env.HELIUS_RPC_URL;
let DISTRIBUTION_WALLET_ADDRESS = process.env.DISTRIBUTION_WALLET_ADDRESS;
const TAX_TOKEN_MINT_ADDRESS = process.env.TAX_TOKEN_MINT_ADDRESS;

// Track additional wallets and user wallets
const trackedWallets = new Set();
const userWallets = new Map();
const lastNotifiedTimes = new Map();
if (DISTRIBUTION_WALLET_ADDRESS) {
  trackedWallets.add(DISTRIBUTION_WALLET_ADDRESS);
}

// Make functions available globally for the Telegram bot
global.trackedWallets = trackedWallets;
global.userWallets = userWallets;
global.lastNotifiedTimes = lastNotifiedTimes;
global.getRewardsForWallet = getRewardsForWallet;
// We'll set global.storage after the storage object is defined

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

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Storage functions for transaction persistence
const storage = {
  // Initialize storage
  async init() {
    try {
      if (process.env.VERCEL) {
        console.log('Initializing Vercel storage...');
        // For Vercel, we'll check if we can use KV storage or Blob storage
        if (STORAGE_CONFIG.vercelKVEnabled) {
          console.log('Vercel KV storage is enabled');
          // We'll initialize KV storage when needed
        } else if (STORAGE_CONFIG.vercelBlobEnabled) {
          console.log('Vercel Blob storage is enabled');
          // We'll initialize Blob storage when needed
        } else {
          console.log('No Vercel storage is enabled, using in-memory storage only');
        }
      } else {
        console.log('Initializing local file storage...');
        // For local development, ensure the data directory exists
        const dataDir = path.dirname(STORAGE_CONFIG.localFilePath);
        try {
          await fs.mkdir(dataDir, { recursive: true });
          console.log(`Created data directory: ${dataDir}`);
        } catch (err) {
          if (err.code !== 'EEXIST') {
            console.error('Error creating data directory:', err);
          }
        }
        
        // Try to load existing data
        await this.load();
      }
    } catch (error) {
      console.error('Error initializing storage:', error);
    }
  },
  
  // Load transactions from storage
  async load() {
    try {
      console.log('Attempting to load from Vercel Blob storage...');
      
      // Check if we're in Vercel environment
      if (!process.env.VERCEL) {
        console.log('Not in Vercel environment, skipping blob storage load');
        return false;
      }
      
      // Initialize Vercel Blob if needed
      if (!this.blobClient) {
        await this.init();
      }
      
      // List available blobs
      const { blobs } = await this.blobClient.list({ prefix: 'transactions/' });
      console.log(`Available blobs: ${blobs.length}`);
      
      if (blobs.length === 0) {
        console.log('No transaction data found in Vercel Blob storage');
        return false;
      }
      
      // Find the most recent blob
      const sortedBlobs = blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
      const latestBlob = sortedBlobs[0];
      console.log(`Found data blob: ${latestBlob.pathname}, size: ${latestBlob.size} bytes, uploaded at: ${latestBlob.uploadedAt}`);
      
      // Download the blob
      const data = await this.blobClient.get(latestBlob.url);
      if (!data) {
        console.log('Failed to download blob data');
        return false;
      }
      
      // Parse the data
      const jsonData = await data.json();
      if (!jsonData || !jsonData.transactions || !Array.isArray(jsonData.transactions)) {
        console.log('Invalid data format in blob storage');
        return false;
      }
      
      // Update transactions array
      transactions.length = 0; // Clear existing transactions
      jsonData.transactions.forEach(txData => {
        transactions.push(new Transaction(txData));
      });
      
      // Update last fetch time
      if (jsonData.lastFetchTime) {
        this.lastFetchTime = new Date(jsonData.lastFetchTime).getTime();
        storage.lastFetchTime = this.lastFetchTime;
      } else {
        this.lastFetchTime = new Date(latestBlob.uploadedAt).getTime();
        storage.lastFetchTime = this.lastFetchTime;
      }
      
      console.log(`Loaded ${transactions.length} transactions from Vercel Blob storage`);
      console.log(`Last fetch timestamp: ${new Date(this.lastFetchTime).toISOString()}`);
      
      // Log transaction breakdown
      const sent = transactions.filter(tx => tx.type === 'sent').length;
      const received = transactions.filter(tx => tx.type === 'received').length;
      console.log(`Transaction breakdown: ${transactions.length} SOL transactions (${sent} sent, ${received} received)`);
      
      if (transactions.length < CONFIG.transactions.minTransactionsToLoad) {
        console.log(`Only loaded ${transactions.length} transactions, attempting to fetch more...`);
      }
      
      return true;
    } catch (error) {
      console.error('Error loading from Vercel Blob storage:', error);
      return false;
    }
  },
  
  // Save transactions to storage
  async save() {
    try {
      // Check if we're in Vercel environment
      if (!process.env.VERCEL) {
        console.log('Not in Vercel environment, skipping blob storage save');
        return false;
      }
      
      // Initialize Vercel Blob if needed
      if (!this.blobClient) {
        await this.init();
      }
      
      // Prepare data to save
      const dataToSave = {
        transactions: transactions.map(tx => tx.toJSON()),
        lastFetchTime: storage.lastFetchTime || Date.now(),
        savedAt: new Date().toISOString()
      };
      
      // Generate a unique filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '');
      const filename = `transactions/data-${timestamp.substring(0, 6)}.json`;
      
      // Upload to Vercel Blob
      console.log(`Saving ${transactions.length} transactions to Vercel Blob storage as ${filename}...`);
      const blob = await this.blobClient.put(filename, JSON.stringify(dataToSave), {
        contentType: 'application/json',
        access: 'public'
      });
      
      console.log(`Saved to Vercel Blob: ${blob.url}`);
      
      // Update the last save time
      this.lastSaveTime = Date.now();
      
      return true;
    } catch (error) {
      console.error('Error saving to Vercel Blob storage:', error);
      return false;
    }
  }
};

// Now make the storage object available globally for the Telegram bot
global.storage = storage;

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
        
        // Always try to persist to storage after adding a new transaction
        if (process.env.VERCEL) {
          console.log('Saving transaction to persistent storage...');
          storage.save().catch(err => console.error('Error saving transaction to storage:', err));
        } else {
          // For local environment, save less frequently
          if (transactions.length % 5 === 0) {
            storage.save().catch(err => console.error('Error auto-saving transactions:', err));
          }
        }
      }
      
      return this;
    } catch (error) {
      console.error('Error saving transaction:', error);
      throw error;
    }
  }
}

// Simplified direct fetch for Vercel environment
async function fetchTransactionsVercel(limit = 5) { // Reduced from 10 to 5 to prevent timeouts
  try {
    // Check if API is shut down
    if (await checkApiShutdown()) {
      console.log('[Vercel] API is shut down, skipping transaction fetch');
      return [];
    }
    
    // Check if we're in cooldown mode
    if (heliusRateLimiter.isInCooldown && heliusRateLimiter.isInCooldown()) {
      console.log('[Vercel] API is in cooldown mode, skipping transaction fetch');
      return [];
    }
    
    console.log(`[Vercel] Fetching transactions directly (limit: ${limit})...`);
    
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
          limit: limit,
          before: null, // Fetch from the most recent
          until: null   // No end point
        }
      ]
    };
    
    // Add retry logic for rate limiting
    let retryCount = 0;
    let success = false;
    let response;
    
    while (!success && retryCount < 5) {
      try {
        // Make direct request to Helius API with proper headers
        response = await axios.post(HELIUS_RPC_URL, requestData, {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': HELIUS_API_KEY
          },
          timeout: 5000 // Reduced from 10s to 5s timeout
        });
        
        success = true;
      } catch (error) {
        retryCount++;
        const waitTime = Math.min(2000 * Math.pow(2, retryCount), 30000); // Exponential backoff, max 30 seconds
        
        if (error.response && error.response.status === 429) {
          console.log(`[Vercel] Rate limit hit (429), retrying after ${waitTime}ms (attempt ${retryCount}/5)`);
          // Enter cooldown mode if we hit rate limits
          if (heliusRateLimiter.enterCooldown) {
            heliusRateLimiter.enterCooldown();
          }
        } else {
          console.log(`[Vercel] Request error: ${error.message}, retrying after ${waitTime}ms (attempt ${retryCount}/5)`);
        }
        
        if (retryCount < 5) {
          await new Promise(resolve => setTimeout(resolve, waitTime));
        } else {
          console.log('[Vercel] Max retries reached, returning empty result');
          return [];
        }
      }
    }
    
    // Check if response is valid
    if (!success || !response || !response.data || !response.data.result) {
      console.error('Invalid response from Helius API:', response?.data);
      return [];
    }
    
    // Get signatures from response
    const signatures = response.data.result;
    console.log(`[Vercel] Fetched ${signatures.length} signatures`);
    
    // Process each signature
    const newTransactions = [];
    
    // Only process a limited number of signatures to avoid timeouts
    const maxSignaturesToProcess = Math.min(signatures.length, limit);
    console.log(`[Vercel] Processing ${maxSignaturesToProcess} out of ${signatures.length} signatures`);
    
    for (let i = 0; i < maxSignaturesToProcess; i++) {
      const sig = signatures[i];
      
      // Skip if transaction is already processed
      const existingTx = transactions.find(tx => tx.signature === sig.signature);
      if (existingTx) {
        console.log(`[Vercel] Transaction already exists: ${sig.signature}`);
        continue;
      }
      
      try {
        // Get transaction details
        const txDetails = await getTransactionDetails(sig.signature);
        if (txDetails) {
          newTransactions.push(txDetails);
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

// Get transaction details from Helius API - Optimized for serverless
async function getTransactionDetails(signature) {
  // Skip detailed processing in Vercel environment if configured
  if (process.env.VERCEL && CONFIG.vercel.skipDetailedProcessing) {
    return {
      signature,
      timestamp: new Date().toISOString(),
      type: 'unknown',
      amount: 0,
      token: 'SOL'
    };
  }

  let retries = 0;
  const maxRetries = process.env.VERCEL ? 0 : CONFIG.rateLimits.maxRetries; // No retries on Vercel
  
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
        return await axios.post(HELIUS_RPC_URL, requestData, {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': HELIUS_API_KEY
          },
          timeout: 10000 // 10 second timeout
        });
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
      
      // If we're on Vercel, we need to be more aggressive about giving up to avoid timeouts
      if (process.env.VERCEL) {
        console.error(`Error getting transaction details for ${signature} on Vercel:`, error.message);
        return null;
      }
      
      // If we've hit a rate limit and have retries left, wait and try again
      if (error.response && error.response.status === 429 && retries <= maxRetries) {
        const waitTime = Math.pow(2, retries) * CONFIG.rateLimits.retryDelay; // Exponential backoff
        console.log(`Rate limit hit, retrying in ${waitTime}ms (attempt ${retries}/${maxRetries})...`);
        await setTimeoutPromise(waitTime);
      } else if (retries <= maxRetries) {
        // For other errors, wait a bit less before retrying
        console.log(`Error fetching transaction, retrying in 5000ms (attempt ${retries}/${maxRetries})...`);
        await setTimeoutPromise(5000);
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
    
    // Check for SPL token transfers
    if (txData.meta.postTokenBalances && txData.meta.preTokenBalances) {
      // SPL token transfer processing can be added here if needed
    }
    
    // Continue with existing SOL transfer logic
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
      totalAmountByToken: {},
      trackedWallets: {
        count: trackedWallets.size,
        addresses: Array.from(trackedWallets),
        mainWallet: DISTRIBUTION_WALLET_ADDRESS
      },
      transactionsByWallet: {}
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
      
      // Count transactions by wallet (sender or receiver)
      if (tx.sender) {
        stats.transactionsByWallet[tx.sender] = stats.transactionsByWallet[tx.sender] || { sent: 0, received: 0, total: 0 };
        stats.transactionsByWallet[tx.sender].sent++;
        stats.transactionsByWallet[tx.sender].total++;
      }
      
      if (tx.receiver) {
        stats.transactionsByWallet[tx.receiver] = stats.transactionsByWallet[tx.receiver] || { sent: 0, received: 0, total: 0 };
        stats.transactionsByWallet[tx.receiver].received++;
        stats.transactionsByWallet[tx.receiver].total++;
      }
    }
    
    return stats;
  } catch (error) {
    console.error('Error getting transaction statistics:', error);
    return {
      totalTransactions: 0,
      transactionsByType: {},
      transactionsByToken: {},
      totalAmountByToken: {},
      trackedWallets: {
        count: trackedWallets.size,
        addresses: Array.from(trackedWallets),
        mainWallet: DISTRIBUTION_WALLET_ADDRESS
      },
      transactionsByWallet: {}
    };
  }
}

// Get rewards for a specific wallet
async function getRewardsForWallet(walletAddress) {
  try {
    console.log(`Getting rewards for wallet: ${walletAddress}`);
    
    // Filter transactions where this wallet is the receiver and the sender is the distribution wallet
    const receivedTransactions = transactions.filter(tx => 
      tx.token === 'SOL' && 
      tx.type === 'sent' && 
      tx.receiver === walletAddress && 
      tx.sender === DISTRIBUTION_WALLET_ADDRESS
    );
    
    // Calculate total amount received
    const totalReceived = receivedTransactions.reduce((sum, tx) => sum + (tx.amount || 0), 0);
    
    // Sort transactions by blockTime (most recent first)
    const sortedTransactions = [...receivedTransactions].sort((a, b) => 
      (b.blockTime || 0) - (a.blockTime || 0)
    );
    
    // Return wallet rewards data
    return {
      walletAddress,
      transactionCount: receivedTransactions.length,
      totalReceived,
      recentTransactions: sortedTransactions.slice(0, 10)
    };
  } catch (error) {
    console.error(`Error getting rewards for wallet ${walletAddress}:`, error);
    return {
      walletAddress,
      transactionCount: 0,
      totalReceived: 0,
      recentTransactions: []
    };
  }
}

// Check for new rewards and notify users
async function checkAndNotifyNewRewards() {
  try {
    console.log('Checking for new rewards to notify users...');
    
    // Skip if no Telegram bot token or if in Vercel environment
    if (!process.env.TELEGRAM_BOT_TOKEN || process.env.VERCEL) {
      console.log('Skipping reward notifications: Telegram bot not available or running in Vercel');
      return;
    }
    
    // Initialize Telegram bot
    const TelegramBot = require('node-telegram-bot-api');
    const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
    
    // Get user wallets
    if (!global.userWallets || global.userWallets.size === 0) {
      console.log('No user wallets registered for notifications');
      return;
    }
    
    // Check each user wallet for new rewards
    for (const [chatId, walletAddress] of global.userWallets.entries()) {
      // Get last notified time for this wallet
      const lastNotifiedTime = global.lastNotifiedTimes?.get(chatId) || 0;
      
      // Get transactions where this wallet is the receiver and the sender is the distribution wallet
      const newTransactions = transactions.filter(tx => 
        tx.token === 'SOL' && 
        tx.type === 'sent' && 
        tx.receiver === walletAddress && 
        tx.sender === DISTRIBUTION_WALLET_ADDRESS &&
        tx.blockTime > lastNotifiedTime
      );
      
      if (newTransactions.length > 0) {
        // Calculate total new rewards
        const totalNewRewards = newTransactions.reduce((sum, tx) => sum + (tx.amount || 0), 0);
        
        // Format notification message
        let message = `🎉 *New Rewards Received!* 🎉\n\n`;
        message += `You've received ${totalNewRewards.toFixed(7)} SOL in ${newTransactions.length} transaction(s).\n\n`;
        
        if (newTransactions.length <= 5) {
          // Show details for each transaction if there are 5 or fewer
          message += `*Transaction Details:*\n`;
          newTransactions.forEach((tx, i) => {
            const date = new Date(tx.timestamp).toLocaleString();
            message += `${i+1}. ${tx.amount.toFixed(7)} SOL on ${date}\n`;
          });
        } else {
          // Just show the most recent transaction if there are more than 5
          const mostRecent = newTransactions.sort((a, b) => (b.blockTime || 0) - (a.blockTime || 0))[0];
          const date = new Date(mostRecent.timestamp).toLocaleString();
          message += `Most recent: ${mostRecent.amount.toFixed(7)} SOL on ${date}\n`;
          message += `Use /myrewards to see all transactions.`;
        }
        
        // Send notification
        try {
          await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
          console.log(`Sent reward notification to chat ${chatId} for wallet ${walletAddress}`);
          
          // Update last notified time
          if (!global.lastNotifiedTimes) {
            global.lastNotifiedTimes = new Map();
          }
          global.lastNotifiedTimes.set(chatId, Date.now());
        } catch (error) {
          console.error(`Error sending notification to chat ${chatId}:`, error);
        }
      }
    }
  } catch (error) {
    console.error('Error checking for new rewards:', error);
  }
}

// Wrap API endpoints with error handling and timeout protection
const asyncHandler = fn => async (req, res, next) => {
  try {
    // Set a timeout for Vercel functions
    if (process.env.VERCEL) {
      const timeoutPromise = new Promise((_, reject) => {
        nodeSetTimeout(() => {
          reject(new Error('Request processing timeout - approaching Vercel 15s limit'));
        }, CONFIG.vercel.maxProcessingTime);
      });
      
      // Race between the actual handler and the timeout
      await Promise.race([
        Promise.resolve(fn(req, res, next)),
        timeoutPromise
      ]);
    } else {
      await fn(req, res, next);
    }
  } catch (error) {
    next(error);
  }
};

// Root route handler
app.get('/', (req, res) => {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Distribution Tracker API</title>
  
  <!-- Favicon references -->
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
  <link rel="manifest" href="/site.webmanifest">
  
  <style>
    body {
      font-family: Arial, sans-serif;
      line-height: 1.6;
      margin: 0;
      padding: 20px;
      color: #333;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
    }
    h1 {
      color: #2c3e50;
    }
    ul {
      list-style-type: none;
      padding: 0;
    }
    li {
      margin-bottom: 10px;
      padding: 10px;
      background-color: #f8f9fa;
      border-radius: 4px;
    }
    a {
      color: #3498db;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Distribution Tracker API</h1>
    <p>Version: 1.1.0</p>
    <h2>Available Endpoints:</h2>
    <ul>
      <li><a href="/api/stats">/api/stats</a> - Get distribution statistics</li>
      <li><a href="/api/distributed">/api/distributed</a> - Get distributed SOL information</li>
      <li><a href="/api/sol">/api/sol</a> - Get SOL transaction information</li>
      <li><a href="/api/refresh">/api/refresh</a> - Refresh transaction data</li>
      <li><a href="/api/fetch-all">/api/fetch-all</a> - Fetch all historical transactions</li>
      <li><a href="/api/fetch-status">/api/fetch-status</a> - Check fetch status</li>
      <li><a href="/api/force-save">/api/force-save</a> - Force save current transactions</li>
      <li><a href="/api/force-refresh">/api/force-refresh</a> - Force refresh transaction data</li>
      <li><a href="/api/help">/api/help</a> - Get API help information</li>
    </ul>
  </div>
</body>
</html>
  `;
  
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    timestamp: new Date().toISOString(),
    message: 'API is running',
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    vercel: process.env.VERCEL ? true : false,
    storage: {
      vercelKVEnabled: STORAGE_CONFIG.vercelKVEnabled,
      vercelBlobEnabled: STORAGE_CONFIG.vercelBlobEnabled,
      blobStoragePath: STORAGE_CONFIG.blobStoragePath
    }
  });
});

// Add a diagnostic endpoint for Blob Storage
app.get('/api/storage-check', async (req, res) => {
  try {
    const storageStatus = {
      timestamp: new Date().toISOString(),
      vercelBlobEnabled: STORAGE_CONFIG.vercelBlobEnabled,
      blobStoragePath: STORAGE_CONFIG.blobStoragePath,
      environment: process.env.NODE_ENV || 'development',
      vercel: process.env.VERCEL ? true : false
    };
    
    // If Blob Storage is enabled, try to access it
    if (STORAGE_CONFIG.vercelBlobEnabled) {
      try {
        const { list } = await import('@vercel/blob');
        const blobs = await list();
        storageStatus.blobList = blobs;
        storageStatus.message = 'Blob Storage is properly configured';
      } catch (error) {
        storageStatus.error = error.message;
        storageStatus.message = 'Error accessing Blob Storage';
      }
    } else {
      storageStatus.message = 'Blob Storage is not enabled';
    }
    
    res.status(200).json(storageStatus);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error checking storage',
      error: error.message
    });
  }
});

// Help endpoint
app.get('/api/help', (req, res) => {
  res.json({
    name: 'Distribution Tracker API',
    version: '1.0.0',
    endpoints: {
      '/api/stats': 'Get distribution statistics',
      '/api/distributed': 'Get all distributed transactions',
      '/api/sol': 'Get SOL transactions',
      '/api/refresh': 'Refresh transaction data',
      '/api/fetch-all': 'Fetch all historical transactions',
      '/api/fetch-status': 'Check transaction fetch status',
      '/api/force-save': 'Force save transactions to storage',
      '/api/force-refresh': 'Force a full refresh of all transactions',
      '/': 'This help information'
    }
  });
});

// Get overall SOL statistics - Simplified for Vercel
app.get('/api/stats', asyncHandler(async (req, res) => {
  console.log('Getting overall SOL statistics...');
  
  try {
    // Get limit parameter from request, default to 5
    const limit = parseInt(req.query.limit) || 5;
    console.log(`Using limit of ${limit} transactions`);
    
    // For Vercel, use a simplified approach
    if (process.env.VERCEL) {
      // Try to load from storage first
      let fetchedTransactions = [];
      const loadedFromStorage = await storage.load();
      
      if (loadedFromStorage && transactions.length > 0) {
        console.log(`Using ${transactions.length} transactions from storage`);
        fetchedTransactions = transactions;
      } else {
        // If no stored data, fetch fresh data with limited transactions
        fetchedTransactions = await fetchTransactionsVercel(limit);
        
        // Save the fetched transactions to storage
        if (fetchedTransactions.length > 0) {
          transactions.length = 0;
          transactions.push(...fetchedTransactions);
          lastFetchTimestamp = new Date().toISOString();
          await storage.save();
        }
      }
      
      // Calculate statistics from ALL stored transactions
      const solTransactions = transactions.filter(tx => tx.token === 'SOL');
      const sentTransactions = solTransactions.filter(tx => tx.type === 'sent');
      const receivedTransactions = solTransactions.filter(tx => tx.type === 'received');
      
      const totalSent = sentTransactions.reduce((sum, tx) => sum + tx.amount, 0);
      const totalReceived = receivedTransactions.reduce((sum, tx) => sum + tx.amount, 0);
      const currentBalance = totalReceived - totalSent;
      
      // Format the statistics in the requested format
      const formattedStats = {
        title: "📊 SOL Statistics 📊",
        totalSolDistributed: totalSent.toFixed(7),
        totalSolReceived: totalReceived.toFixed(7),
        currentSolBalance: currentBalance.toFixed(7),
        totalTransactions: transactions.length,
        distributionWallet: DISTRIBUTION_WALLET_ADDRESS,
        solscanLink: `https://solscan.io/account/${DISTRIBUTION_WALLET_ADDRESS}`
      };
      
      // Return statistics only (no transaction lists)
      return res.json({
        success: true,
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        vercel: true,
        note: "Running in optimized mode for Vercel serverless environment",
        stats: formattedStats,
        transactionCounts: {
          totalStoredTransactions: transactions.length,
          solTransactions: solTransactions.length,
          receivedTransactions: receivedTransactions.length,
          sentTransactions: sentTransactions.length
        },
        fetchedAt: new Date().toISOString()
      });
    }
    
    // For non-Vercel environments, use the full implementation
    if (transactions.length === 0) {
      await fetchTransactions();
    } else {
      // Check cache expiration
      const cacheExpired = lastFetchTimestamp && 
        (new Date() - new Date(lastFetchTimestamp)) > CONFIG.transactions.cacheExpiration;
      
      if (cacheExpired) {
        await fetchTransactions();
      } else {
        console.log(`Using cached transactions (${transactions.length} transactions)`);
      }
    }
    
    // Get transaction statistics
    const stats = getStats();
    
    // Return statistics
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      lastFetch: lastFetchTimestamp,
      environment: process.env.NODE_ENV || 'development',
      vercel: false,
      cacheStatus: {
        transactionCount: transactions.length,
        note: "Using cached data when available"
      },
      stats
    });
    
    // Return statistics with tracked wallet info prominently displayed
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      lastFetch: lastFetchTimestamp,
      environment: process.env.NODE_ENV || 'development',
      vercel: process.env.VERCEL ? true : false,
      trackedWallets: {
        count: trackedWallets.size,
        addresses: Array.from(trackedWallets),
        mainWallet: DISTRIBUTION_WALLET_ADDRESS
      },
      cacheStatus: {
        transactionCount: transactions.length,
        note: "Using cached data when available"
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

// Get SOL distribution data - Simplified for Vercel
app.get('/api/distributed', asyncHandler(async (req, res) => {
  console.log('Getting SOL distribution data...');
  
  // For Vercel, use a simplified approach
  if (process.env.VERCEL) {
    // Try to load from storage first
    let fetchedTransactions = [];
    const loadedFromStorage = await storage.load();
    
    if (loadedFromStorage && transactions.length > 0) {
      console.log(`Using ${transactions.length} transactions from storage`);
      fetchedTransactions = transactions;
      
      // If we have fewer than expected transactions, try to fetch more
      if (transactions.length < 40) {
        console.log(`Only loaded ${transactions.length} transactions, attempting to fetch more...`);
        // Trigger a fetch of more transactions in the background
        fetchAllHistoricalTransactions().catch(err => 
          console.error('Error fetching additional historical transactions:', err)
        );
      }
    } else {
      // If no stored data, fetch fresh data and then trigger historical fetch
      fetchedTransactions = await fetchTransactionsVercel(100); // Increased from 20 to 100
      
      // Save the fetched transactions to storage
      if (fetchedTransactions.length > 0) {
        transactions.length = 0;
        transactions.push(...fetchedTransactions);
        lastFetchTimestamp = new Date().toISOString();
        await storage.save();
        
        // After saving initial transactions, fetch historical data
        console.log('Triggering historical transaction fetch after initial load...');
        fetchAllHistoricalTransactions().catch(err => 
          console.error('Error fetching historical transactions after initial load:', err)
        );
      }
    }
    
    // Get transactions with type 'sent' from ALL stored transactions
    const sentTransactions = transactions.filter(tx => tx.type === 'sent' && tx.token === 'SOL');
    
    // Calculate distribution statistics
    const totalDistributed = sentTransactions.reduce((sum, tx) => sum + tx.amount, 0);
    const averageDistribution = sentTransactions.length > 0 
      ? totalDistributed / sentTransactions.length 
      : 0;
    const largestDistribution = sentTransactions.length > 0 
      ? Math.max(...sentTransactions.map(tx => tx.amount)) 
      : 0;
    const smallestDistribution = sentTransactions.length > 0 
      ? Math.min(...sentTransactions.map(tx => tx.amount)) 
      : 0;
    
    // Format the statistics in the requested format
    const formattedStats = {
      title: "💸 SOL Distribution Data 💸",
      totalSolDistributed: totalDistributed.toFixed(7),
      totalDistributions: sentTransactions.length,
      averageDistribution: averageDistribution.toFixed(7),
      largestDistribution: largestDistribution.toFixed(7),
      smallestDistribution: smallestDistribution.toFixed(7),
      distributionWallet: DISTRIBUTION_WALLET_ADDRESS,
      solscanLink: `https://solscan.io/account/${DISTRIBUTION_WALLET_ADDRESS}`
    };
    
    // Return statistics and ALL transactions
    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      vercel: true,
      note: "Running in optimized mode for Vercel serverless environment",
      stats: formattedStats,
      transactions: {
        totalStoredTransactions: transactions.length,
        totalDistributions: sentTransactions.length,
        allTransactions: transactions, // Include ALL transactions
        allDistributions: sentTransactions // Include ALL distributions
      },
      fetchedAt: new Date().toISOString()
    });
  }
  
  // For non-Vercel environments, use the full implementation
  if (transactions.length === 0) {
    await fetchTransactions();
  } else {
    // Check cache expiration
    const cacheExpired = lastFetchTimestamp && 
      (new Date() - new Date(lastFetchTimestamp)) > CONFIG.transactions.cacheExpiration;
    
    if (cacheExpired) {
      await fetchTransactions();
    }
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
    recentDistributions: sentTransactions.slice(0, 3)
  };
  
  // Return statistics
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    vercel: false,
    stats,
    allTransactions: transactions,
    allDistributions: sentTransactions
  });
}));

// Get detailed SOL transfer statistics - Simplified for Vercel
app.get('/api/sol', asyncHandler(async (req, res) => {
  console.log('Getting detailed SOL transfer statistics...');
  
  // For Vercel, use a simplified approach
  if (process.env.VERCEL) {
    // Try to load from storage first
    let fetchedTransactions = [];
    const loadedFromStorage = await storage.load();
    
    if (loadedFromStorage && transactions.length > 0) {
      console.log(`Using ${transactions.length} transactions from storage`);
      fetchedTransactions = transactions;
      
      // If we have fewer than expected transactions, try to fetch more
      if (transactions.length < 40) {
        console.log(`Only loaded ${transactions.length} transactions, attempting to fetch more...`);
        // Trigger a fetch of more transactions in the background
        fetchAllHistoricalTransactions().catch(err => 
          console.error('Error fetching additional historical transactions:', err)
        );
      }
    } else {
      // If no stored data, fetch fresh data and then trigger historical fetch
      fetchedTransactions = await fetchTransactionsVercel(100); // Increased from 20 to 100
      
      // Save the fetched transactions to storage
      if (fetchedTransactions.length > 0) {
        transactions.length = 0;
        transactions.push(...fetchedTransactions);
        lastFetchTimestamp = new Date().toISOString();
        await storage.save();
        
        // After saving initial transactions, fetch historical data
        console.log('Triggering historical transaction fetch after initial load...');
        fetchAllHistoricalTransactions().catch(err => 
          console.error('Error fetching historical transactions after initial load:', err)
        );
      }
    }
    
    // Get transactions for SOL from ALL stored transactions
    const solTransactions = transactions.filter(tx => tx.token === 'SOL');
    
    // Calculate statistics
    const received = solTransactions.filter(tx => tx.type === 'received');
    const sent = solTransactions.filter(tx => tx.type === 'sent');
    
    const totalReceived = received.reduce((sum, tx) => sum + tx.amount, 0);
    const totalSent = sent.reduce((sum, tx) => sum + tx.amount, 0);
    const currentBalance = totalReceived - totalSent;
    
    // Format the statistics in the requested format
    const formattedStats = {
      title: "🔍 Detailed SOL Transfer Statistics 🔍",
      totalSolDistributed: totalSent.toFixed(7),
      totalSolReceived: totalReceived.toFixed(7),
      currentSolBalance: currentBalance.toFixed(7),
      totalTransactions: solTransactions.length,
      receivedTransactions: received.length,
      sentTransactions: sent.length,
      distributionWallet: DISTRIBUTION_WALLET_ADDRESS,
      solscanLink: `https://solscan.io/account/${DISTRIBUTION_WALLET_ADDRESS}`
    };
    
    // Return statistics and ALL SOL transactions
    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      vercel: true,
      note: "Running in optimized mode for Vercel serverless environment",
      stats: formattedStats,
      transactions: {
        totalStoredTransactions: transactions.length,
        totalSolTransactions: solTransactions.length,
        allTransactions: solTransactions, // Include ALL SOL transactions
        receivedTransactions: received,    // Include ALL received transactions
        sentTransactions: sent            // Include ALL sent transactions
      },
      fetchedAt: new Date().toISOString()
    });
  }
  
  // For non-Vercel environments, use the full implementation
  if (transactions.length === 0) {
    await fetchTransactions();
  } else {
    // Check cache expiration
    const cacheExpired = lastFetchTimestamp && 
      (new Date() - new Date(lastFetchTimestamp)) > CONFIG.transactions.cacheExpiration;
    
    if (cacheExpired) {
      await fetchTransactions();
    }
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
  
  // Return statistics and ALL SOL transactions
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    vercel: true,
    note: "Running in optimized mode for Vercel serverless environment",
    stats,
    allTransactions: solTransactions,
    receivedTransactions: received,
    sentTransactions: sent,
    fetchedAt: new Date().toISOString()
  });
}));

// Force refresh historical transaction data - Simplified for Vercel
app.post('/api/refresh', asyncHandler(async (req, res) => {
  console.log('Refreshing historical transaction data...');
  
  try {
    // For Vercel, use a simplified approach
    if (process.env.VERCEL) {
      // Try to load from storage first
      let fetchedTransactions = [];
      const loadedFromStorage = await storage.load();
      
      if (loadedFromStorage && transactions.length > 0) {
        console.log(`Using ${transactions.length} transactions from storage`);
        fetchedTransactions = transactions;
      } else {
        // If no stored data, fetch fresh data
        fetchedTransactions = await fetchTransactionsVercel(20);
        
        // Save the fetched transactions to storage
        if (fetchedTransactions.length > 0) {
          transactions.length = 0;
          transactions.push(...fetchedTransactions);
          lastFetchTimestamp = new Date().toISOString();
          await storage.save();
        }
      }
      
      // Return simplified response
      return res.json({
        success: true,
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        vercel: true,
        note: "Running in optimized mode for Vercel serverless environment",
        message: 'Fetched transaction data with details',
        count: fetchedTransactions.length,
        totalStoredTransactions: transactions.length,
        recentTransactions: fetchedTransactions.slice(0, 10),
        allTransactions: transactions,
        fetchedAt: new Date().toISOString()
      });
    }
    
    // For non-Vercel environments, use the full implementation
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
        recentTransactions: transactions.slice(0, 3)
      });
    }
    
    // Fetch transactions
    const newTransactions = await fetchTransactions();
    
    // Return transactions
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      vercel: false,
      message: 'Historical transaction data refreshed successfully',
      count: newTransactions.length,
      totalTransactions: transactions.length,
      recentTransactions: transactions.slice(0, 3)
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

// Add GET endpoint for /api/refresh to handle browser requests
app.get('/api/refresh', asyncHandler(async (req, res) => {
  console.log('GET: Refreshing historical transaction data...');
  
  try {
    // For Vercel, use a simplified approach
    if (process.env.VERCEL) {
      // Try to load from storage first
      let fetchedTransactions = [];
      const loadedFromStorage = await storage.load();
      
      if (loadedFromStorage && transactions.length > 0) {
        console.log(`Using ${transactions.length} transactions from storage`);
        fetchedTransactions = transactions;
      } else {
        // If no stored data, fetch fresh data
        fetchedTransactions = await fetchTransactionsVercel(20);
        
        // Save the fetched transactions to storage
        if (fetchedTransactions.length > 0) {
          transactions.length = 0;
          transactions.push(...fetchedTransactions);
          lastFetchTimestamp = new Date().toISOString();
          await storage.save();
        }
      }
      
      // Return simplified response
      return res.json({
        success: true,
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        vercel: true,
        note: "Running in optimized mode for Vercel serverless environment",
        message: 'Fetched transaction data with details',
        count: fetchedTransactions.length,
        totalStoredTransactions: transactions.length,
        recentTransactions: fetchedTransactions.slice(0, 10),
        allTransactions: transactions,
        fetchedAt: new Date().toISOString()
      });
    }
    
    // For non-Vercel environments, use the full implementation
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
        recentTransactions: transactions.slice(0, 3)
      });
    }
    
    // Fetch transactions
    const newTransactions = await fetchTransactions();
    
    // Return transactions
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      vercel: false,
      message: 'Historical transaction data refreshed successfully',
      count: newTransactions.length,
      totalTransactions: transactions.length,
      recentTransactions: transactions.slice(0, 3)
    });
  } catch (error) {
    console.error('Error in GET /api/refresh:', error);
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
          balance: received.reduce((sum, tx) => sum + tx.amount, 0) - sent.reduce((sum, tx) => sum + tx.amount, 0),
          recentTransactions: solTransactions.slice(0, 5)
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

// Add a function to fetch historical transactions with pagination
async function fetchAllHistoricalTransactions() {
  try {
    // Check if API is shut down
    if (await checkApiShutdown()) {
      console.log('[Vercel] API is shut down, skipping historical transaction fetch');
      return [];
    }
    
    // Check if we're in cooldown mode
    if (heliusRateLimiter.isInCooldown && heliusRateLimiter.isInCooldown()) {
      console.log('[Vercel] API is in cooldown mode, skipping historical transaction fetch');
      return [];
    }
    
    // Remove the time-based check to allow continuous scanning
    // We'll still use rate limiting to prevent API abuse
    
    console.log('[Vercel] Starting historical transaction fetch...');
    
    if (!HELIUS_API_KEY || !HELIUS_RPC_URL) {
      console.error('Missing required environment variables for Helius service');
      return [];
    }
    
    // Check if we have any wallets to track
    if (trackedWallets.size === 0) {
      console.log('No wallets to track. Please add a wallet first.');
      return [];
    }
    
    // First, load any existing transactions
    await storage.load();
    const existingSignatures = new Set(transactions.map(tx => tx.signature));
    console.log(`[Vercel] Loaded ${existingSignatures.size} existing transaction signatures`);
    
    let allNewTransactions = [];
    let hasMore = true;
    let beforeSignature = null;
    const batchSize = 10; // Keep batch size at 10 signatures at a time
    let batchCount = 0;
    // Remove the maxBatches limit to allow continuous scanning
    // const maxBatches = 1; 
    
    // Start time tracking - still keep time limit for each serverless function execution
    const startTime = Date.now();
    const timeLimit = 13000; // Keep the same time limit for serverless function
    
    // Track if we've found any new transactions in this run
    let foundNewTransactions = false;
    
    // while (hasMore && batchCount < maxBatches) {
    while (hasMore) {
      // Check if we're approaching the time limit
      if (Date.now() - startTime > timeLimit) {
        console.log(`[Vercel] Approaching time limit, stopping after processing ${batchCount} batches`);
        break;
      }
      
      batchCount++;
      console.log(`[Vercel] Fetching batch ${batchCount} of signatures (before: ${beforeSignature || 'none'})...`);
      
      // Prepare request data
      const requestData = {
        jsonrpc: '2.0',
        id: 'my-id',
        method: 'getSignaturesForAddress',
        params: [
          DISTRIBUTION_WALLET_ADDRESS,
          {
            limit: batchSize,
            before: beforeSignature
          }
        ]
      };
      
      // Add exponential backoff for rate limiting
      let retryCount = 0;
      let success = false;
      let response;
      
      while (!success && retryCount < 5) {
        try {
          // Make direct request to Helius API
          response = await axios.post(HELIUS_RPC_URL, requestData, {
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': HELIUS_API_KEY
            },
            timeout: 10000 // 10 second timeout
          });
          
          success = true;
        } catch (error) {
          retryCount++;
          const waitTime = Math.min(2000 * Math.pow(2, retryCount), 30000); // Exponential backoff, max 30 seconds
          
          if (error.response && error.response.status === 429) {
            console.log(`[Vercel] Rate limit hit (429), retrying after ${waitTime}ms (attempt ${retryCount}/5)`);
            // Enter cooldown mode if we hit rate limits
            if (heliusRateLimiter.enterCooldown) {
              heliusRateLimiter.enterCooldown();
            }
          } else {
            console.log(`[Vercel] Request error: ${error.message}, retrying after ${waitTime}ms (attempt ${retryCount}/5)`);
          }
          
          if (retryCount < 5) {
            await new Promise(resolve => setTimeout(resolve, waitTime));
          } else {
            console.log('[Vercel] Max retries reached, continuing to next batch');
            break;
          }
        }
      }
      
      // Check if response is valid
      if (!success || !response || !response.data || !response.data.result || response.data.result.length === 0) {
        console.log('[Vercel] No more signatures found or invalid response');
        hasMore = false;
        break;
      }
      
      // Get signatures from response
      const signatures = response.data.result;
      console.log(`[Vercel] Fetched ${signatures.length} signatures in batch ${batchCount}`);
      
      // Update beforeSignature for next batch
      if (signatures.length > 0) {
        beforeSignature = signatures[signatures.length - 1].signature;
      } else {
        hasMore = false;
      }
      
      // Filter out signatures we already have
      const newSignatures = signatures.filter(sig => !existingSignatures.has(sig.signature));
      console.log(`[Vercel] Found ${newSignatures.length} new signatures in batch ${batchCount}`);
      
      if (newSignatures.length === 0) {
        // If we've reached signatures we already have, we can stop for this run
        // but we'll continue in the next run
        if (signatures.length > 0 && existingSignatures.has(signatures[0].signature)) {
          console.log('[Vercel] Reached signatures that are already in storage, stopping this run');
          hasMore = false;
          break;
        }
        
        // Otherwise continue to next batch
        continue;
      }
      
      // We found new transactions in this run
      foundNewTransactions = true;
      
      // Process new signatures - OPTIMIZED VERSION
      // Process up to 10 signatures per run to avoid timeouts
      const maxSignaturesToProcess = Math.min(newSignatures.length, 10);
      const batchProcessedTransactions = [];
      const batchStartTime = Date.now();
      
      console.log(`[Vercel] Processing ${maxSignaturesToProcess} out of ${newSignatures.length} signatures to avoid timeouts`);
      
      for (let i = 0; i < maxSignaturesToProcess; i++) {
        // Check if we're approaching the time limit
        if (Date.now() - startTime > timeLimit - 2000) { // Leave 2 seconds for cleanup
          console.log(`[Vercel] Approaching overall time limit, stopping signature processing`);
          break;
        }
        
        const sig = newSignatures[i];
        try {
          // Add to existing signatures set to avoid reprocessing in future runs
          existingSignatures.add(sig.signature);
          
          // Prepare request for transaction details
          const txRequestData = {
            jsonrpc: '2.0',
            id: 'tx-details',
            method: 'getTransaction',
            params: [
              sig.signature,
              {
                encoding: 'jsonParsed',
                maxSupportedTransactionVersion: 0
              }
            ]
          };
          
          // Add retry logic for transaction details
          let txRetryCount = 0;
          let txSuccess = false;
          let txResponse;
          
          while (!txSuccess && txRetryCount < 3) {
            try {
              // Make direct request to Helius API
              txResponse = await axios.post(HELIUS_RPC_URL, txRequestData, {
                headers: {
                  'Content-Type': 'application/json',
                  'x-api-key': HELIUS_API_KEY
                },
                timeout: 5000 // 5 second timeout for transaction details
              });
              
              txSuccess = true;
            } catch (error) {
              txRetryCount++;
              const waitTime = Math.min(1000 * Math.pow(2, txRetryCount), 8000); // Shorter backoff for tx details
              
              console.log(`[Vercel] Transaction details error: ${error.message}, retrying after ${waitTime}ms (attempt ${txRetryCount}/3)`);
              
              if (txRetryCount < 3) {
                await new Promise(resolve => setTimeout(resolve, waitTime));
              } else {
                console.log(`[Vercel] Max retries reached for transaction ${sig.signature}, skipping`);
                break;
              }
            }
          }
          
          // Check if response is valid
          if (!txSuccess || !txResponse || !txResponse.data || !txResponse.data.result) {
            console.log(`[Vercel] Invalid transaction details response for ${sig.signature}, skipping`);
            continue;
          }
          
          // Process transaction
          const txData = txResponse.data.result;
          const processedTx = processTransaction(sig.signature, txData);
          
          if (processedTx) {
            // Create and save transaction
            const tx = new Transaction(processedTx);
            await tx.save();
            batchProcessedTransactions.push(tx);
            allNewTransactions.push(tx);
          }
        } catch (error) {
          console.error(`[Vercel] Error processing transaction ${sig.signature}:`, error.message);
          // Continue with next signature
        }
      }
      
      console.log(`[Vercel] Processed ${batchProcessedTransactions.length} transactions in ${Date.now() - batchStartTime}ms`);
      
      // Save after each batch to ensure we don't lose data
      if (batchProcessedTransactions.length > 0) {
        try {
          await storage.save();
          console.log(`[Vercel] Saved ${batchProcessedTransactions.length} new transactions to storage`);
        } catch (saveError) {
          console.error('[Vercel] Error saving transactions to storage:', saveError.message);
        }
      }
      
      // Add a small delay between batches to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log(`[Vercel] Historical fetch complete. Added ${allNewTransactions.length} new transactions in ${batchCount} batches.`);
    
    // Update last fetch time only if we found new transactions
    if (foundNewTransactions) {
      storage.lastFetchTime = Date.now();
    }
    
    return allNewTransactions;
  } catch (error) {
    console.error('[Vercel] Error in historical transaction fetch:', error.message);
    return [];
  }
}

// Add a new endpoint to trigger historical fetch
app.get('/api/fetch-all', asyncHandler(async (req, res) => {
  console.log('Starting full historical transaction fetch...');
  
  try {
    // Start the historical fetch
    const newTransactions = await fetchAllHistoricalTransactions();
    
    // Return response
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      vercel: process.env.VERCEL ? true : false,
      message: 'Historical transaction fetch completed',
      newTransactionsCount: newTransactions.length,
      totalTransactionsCount: transactions.length,
      note: 'This process fetches transactions in batches and may not get all transactions in a single run due to serverless time constraints.'
    });
  } catch (error) {
    console.error('Error in /api/fetch-all:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to fetch all historical transactions',
        details: error.message
      }
    });
  }
}));

// Add a new endpoint to trigger historical fetch
app.get('/api/fetch-all', asyncHandler(async (req, res) => {
  console.log('Starting continuous transaction fetch...');
  
  try {
    // Start the historical fetch
    const newTransactions = await fetchAllHistoricalTransactions();
    
    // Return response
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      vercel: process.env.VERCEL ? true : false,
      message: 'Continuous transaction fetch completed',
      newTransactionsCount: newTransactions.length,
      totalTransactionsCount: transactions.length,
      note: 'This endpoint will always attempt to fetch new transactions regardless of when it was last called. Call it repeatedly to continuously collect all transactions.'
    });
  } catch (error) {
    console.error('Error in /api/fetch-all:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to fetch all historical transactions',
        details: error.message
      }
    });
  }
}));

// Add a new endpoint to trigger continuous transaction fetch
app.get('/api/fetch-all', asyncHandler(async (req, res) => {
  console.log('Starting continuous transaction fetch...');
  
  try {
    // Start the historical fetch
    const newTransactions = await fetchAllHistoricalTransactions();
    
    // Return response
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      vercel: process.env.VERCEL ? true : false,
      message: 'Continuous transaction fetch completed',
      newTransactionsCount: newTransactions.length,
      totalTransactionsCount: transactions.length,
      note: 'This endpoint will always attempt to fetch new transactions regardless of when it was last called. Call it repeatedly to continuously collect all transactions.'
    });
  } catch (error) {
    console.error('Error in /api/fetch-all:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to fetch all historical transactions',
        details: error.message
      }
    });
  }
}));

// Add a new endpoint to check transaction fetch status
app.get('/api/fetch-status', asyncHandler(async (req, res) => {
  console.log('Checking transaction fetch status...');
  
  try {
    // Load transactions from storage to get the latest count
    await storage.load();
    
    // Get transaction statistics
    const solTransactions = transactions.filter(tx => tx.token === 'SOL');
    const sentTransactions = solTransactions.filter(tx => tx.type === 'sent');
    const receivedTransactions = solTransactions.filter(tx => tx.type === 'received');
    
    // Get the most recent transaction timestamp
    const mostRecentTransaction = transactions.length > 0 
      ? transactions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0]
      : null;
    
    // Get background job status
    const backgroundJobStatus = {
      enabled: CONFIG.backgroundJobs.enabled,
      isRunning: backgroundJobState.isRunning,
      lastRunTime: backgroundJobState.lastRunTime,
      nextRunTime: backgroundJobState.lastRunTime 
        ? new Date(backgroundJobState.lastRunTime.getTime() + backgroundJobState.currentInterval)
        : null,
      currentInterval: `${backgroundJobState.currentInterval / 1000} seconds`,
      consecutiveErrors: backgroundJobState.consecutiveErrors
    };
    
    // Return response
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      vercel: process.env.VERCEL ? true : false,
      status: {
        totalTransactions: transactions.length,
        solTransactions: solTransactions.length,
        sentTransactions: sentTransactions.length,
        receivedTransactions: receivedTransactions.length,
        mostRecentTransaction: mostRecentTransaction ? {
          signature: mostRecentTransaction.signature,
          timestamp: mostRecentTransaction.timestamp,
          type: mostRecentTransaction.type,
          amount: mostRecentTransaction.amount
        } : null,
        lastFetchTimestamp: lastFetchTimestamp,
        backgroundJob: backgroundJobStatus
      }
    });
  } catch (error) {
    console.error('Error in /api/fetch-status:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to get transaction fetch status',
        details: error.message
      }
    });
  }
}));

// Add a new endpoint to control background jobs
app.get('/api/background-job/:action', asyncHandler(async (req, res) => {
  const action = req.params.action;
  console.log(`Background job control: ${action}`);
  
  try {
    let message = '';
    let success = true;
    
    switch (action) {
      case 'start':
        if (!CONFIG.backgroundJobs.enabled) {
          CONFIG.backgroundJobs.enabled = true;
          startBackgroundJobs();
          message = 'Background jobs started successfully';
        } else if (backgroundJobState.timerId) {
          message = 'Background jobs are already running';
        } else {
          startBackgroundJobs();
          message = 'Background jobs restarted successfully';
        }
        break;
        
      case 'stop':
        if (backgroundJobState.timerId) {
          clearTimeout(backgroundJobState.timerId);
          backgroundJobState.timerId = null;
          backgroundJobState.isRunning = false;
          CONFIG.backgroundJobs.enabled = false;
          message = 'Background jobs stopped successfully';
        } else {
          message = 'Background jobs are not running';
        }
        break;
        
      case 'run-now':
        // Trigger a fetch job immediately
        fetchAllHistoricalTransactions()
          .then(newTransactions => {
            console.log(`Manual job run completed: fetched ${newTransactions.length} new transactions`);
          })
          .catch(err => {
            console.error('Error in manual job run:', err);
          });
        
        message = 'Manual job run triggered';
        break;
        
      case 'reset':
        // Reset the background job state
        if (backgroundJobState.timerId) {
          clearTimeout(backgroundJobState.timerId);
        }
        
        backgroundJobState.isRunning = false;
        backgroundJobState.lastRunTime = null;
        backgroundJobState.consecutiveErrors = 0;
        backgroundJobState.currentInterval = CONFIG.backgroundJobs.autoFetchInterval;
        backgroundJobState.timerId = null;
        
        // Restart if enabled
        if (CONFIG.backgroundJobs.enabled) {
          startBackgroundJobs();
        }
        
        message = 'Background job state reset successfully';
        break;
        
      default:
        success = false;
        message = `Unknown action: ${action}. Valid actions are: start, stop, run-now, reset`;
    }
    
    // Return response
    res.json({
      success,
      timestamp: new Date().toISOString(),
      action,
      message,
      backgroundJobStatus: {
        enabled: CONFIG.backgroundJobs.enabled,
        isRunning: backgroundJobState.isRunning,
        lastRunTime: backgroundJobState.lastRunTime,
        nextRunTime: backgroundJobState.lastRunTime 
          ? new Date(backgroundJobState.lastRunTime.getTime() + backgroundJobState.currentInterval)
          : null,
        currentInterval: `${backgroundJobState.currentInterval / 1000} seconds`,
        consecutiveErrors: backgroundJobState.consecutiveErrors
      }
    });
  } catch (error) {
    console.error(`Error in /api/background-job/${action}:`, error);
    res.status(500).json({
      success: false,
      error: {
        message: `Failed to ${action} background job`,
        details: error.message
      }
    });
  }
}));

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

// Initialize the app
async function initializeApp() {
  try {
    // Initialize storage
    await storage.init();
    
    // Start background jobs if enabled
    if (CONFIG.backgroundJobs.enabled) {
      startBackgroundJobs();
    }
    
    // Start the server
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Error initializing app:', error);
  }
}

// Function to check if data collection should be stopped
async function checkStopCollectionFlag() {
  try {
    // Check if the flag file exists
    try {
      await fs.access(STOP_COLLECTION_CONFIG.flagFilePath);
      
      // If we reach here, the file exists
      // Read the file to get the reason
      const flagData = await fs.readFile(STOP_COLLECTION_CONFIG.flagFilePath, 'utf8');
      let stopReason = 'Unknown reason';
      
      try {
        const parsedData = JSON.parse(flagData);
        stopReason = parsedData.reason || stopReason;
      } catch (parseError) {
        console.warn('Could not parse stop flag file data:', parseError);
      }
      
      // Set the global stop flag
      if (!STOP_COLLECTION_CONFIG.isStopRequested) {
        console.log(`Data collection stop requested: ${stopReason}`);
        STOP_COLLECTION_CONFIG.isStopRequested = true;
        backgroundJobState.isStopped = true;
      }
      
      return true;
    } catch (accessError) {
      // File doesn't exist, collection should continue
      return false;
    }
  } catch (error) {
    console.error('Error checking stop collection flag:', error);
    return false;
  } finally {
    STOP_COLLECTION_CONFIG.lastCheckTime = new Date();
  }
}

// Function to start background jobs
function startBackgroundJobs() {
  console.log('Starting background jobs...');
  
  // Auto-fetch job
  let autoFetchJobRunning = false;
  let autoFetchInterval = 120000; // 2 minutes between runs by default
  
  async function runAutoFetchJob() {
    try {
      // Prevent multiple instances from running simultaneously
      if (autoFetchJobRunning) {
        console.log('Auto-fetch job already running, skipping this run');
        return;
      }
      
      // Check if API is shut down
      if (await checkApiShutdown()) {
        console.log('API is shut down, skipping auto-fetch job');
        return;
      }
      
      // Check if data collection is disabled
      if (process.env.DISABLE_DATA_COLLECTION === 'true') {
        console.log('Data collection is disabled, skipping auto-fetch job');
        return;
      }
      
      // Mark job as running
      autoFetchJobRunning = true;
      
      console.log('Running auto-fetch job...');
      
      // Load existing transactions
      await storage.load();
      
      // Fetch new transactions
      try {
        // Use the historical fetch function to get all transactions
        // This will now scan continuously due to our modifications
        await fetchAllHistoricalTransactions();
        console.log('Auto-fetch job completed successfully');
      } catch (fetchError) {
        console.error('Error in auto-fetch job:', fetchError.message);
        
        // If we hit rate limits, increase the interval temporarily
        if (fetchError.response && fetchError.response.status === 429) {
          autoFetchInterval = 300000; // 5 minutes if rate limited
          console.log(`Rate limit hit, increasing interval to ${autoFetchInterval}ms`);
        }
      }
      
      // Mark job as complete
      autoFetchJobRunning = false;
      
      // Always schedule the next run, regardless of success or failure
      // This ensures continuous scanning
      console.log(`Scheduling next auto-fetch job in ${autoFetchInterval}ms`);
      nodeSetTimeout(runAutoFetchJob, autoFetchInterval);
      
      // Gradually reduce the interval back to normal if it was increased
      if (autoFetchInterval > 120000) {
        autoFetchInterval = Math.max(120000, autoFetchInterval - 60000);
      }
    } catch (error) {
      console.error('Unexpected error in auto-fetch job:', error);
      
      // Mark job as complete even if there was an error
      autoFetchJobRunning = false;
      
      // Always reschedule, even after errors
      console.log(`Rescheduling auto-fetch job after error in ${autoFetchInterval}ms`);
      nodeSetTimeout(runAutoFetchJob, autoFetchInterval);
    }
  }
  
  // Start the auto-fetch job immediately
  runAutoFetchJob().catch(err => console.error('Error starting auto-fetch job:', err));
  
  // Also start the stop collection flag check job
  nodeSetTimeout(checkStopCollectionFlag, STOP_COLLECTION_CONFIG.checkInterval);
}

// Initialize the app
initializeApp();

// Add a new endpoint to force save to Blob storage
app.get('/api/force-save', asyncHandler(async (req, res) => {
  console.log('Forcing save to Blob storage...');
  
  try {
    // Temporarily bypass the storage interval check
    const originalInterval = STORAGE_CONFIG.storageInterval;
    STORAGE_CONFIG.storageInterval = 0;
    STORAGE_CONFIG.lastStorageTime = null;
    
    // Force save
    const saveResult = await storage.save();
    
    // Restore original interval
    STORAGE_CONFIG.storageInterval = originalInterval;
    
    // Return response
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      vercel: process.env.VERCEL ? true : false,
      message: saveResult ? 'Successfully forced save to Blob storage' : 'Failed to save to Blob storage',
      transactionCount: transactions.length,
      savedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in /api/force-save:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to force save to Blob storage',
        details: error.message
      }
    });
  }
}));

// Add an endpoint to check the status of data collection
app.get('/api/collection-status', asyncHandler(async (req, res) => {
  console.log('Checking data collection status...');
  
  try {
    // Check the stop flag
    const isStopped = await checkStopCollectionFlag();
    
    // Return the status
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      vercel: process.env.VERCEL ? true : false,
      collectionStatus: {
        isRunning: !isStopped && !backgroundJobState.isStopped,
        isStopped: isStopped || backgroundJobState.isStopped,
        lastRunTime: backgroundJobState.lastRunTime,
        nextRunTime: backgroundJobState.lastRunTime && !backgroundJobState.isStopped
          ? new Date(backgroundJobState.lastRunTime.getTime() + backgroundJobState.currentInterval)
          : null,
        consecutiveErrors: backgroundJobState.consecutiveErrors,
        currentInterval: `${backgroundJobState.currentInterval / 1000} seconds`
      }
    });
  } catch (error) {
    console.error('Error in /api/collection-status:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to check data collection status',
        details: error.message
      }
    });
  }
}));

// Add a new endpoint to force a full refresh of all transactions
app.get('/api/force-refresh', asyncHandler(async (req, res) => {
  console.log('Forcing full refresh of all transactions...');
  
  try {
    // Clear existing transactions from both in-memory and MongoDB
    try {
      // Try to use MongoDB if available
      try {
        const Transaction = require('../src/models/Transaction');
        await Transaction.clearAll();
        console.log('Cleared all transactions from MongoDB');
      } catch (error) {
        console.warn('MongoDB clearAll failed:', error.message);
      }
    } catch (error) {
      console.warn('Error importing Transaction model:', error.message);
    }
    
    // Clear in-memory transactions
    transactions.length = 0;
    lastFetchTimestamp = null;
    console.log('Cleared all in-memory transactions');
    
    // Fetch fresh transactions - limited to 10
    const fetchedTransactions = await fetchTransactionsVercel(10);
    
    // Save the fetched transactions to storage
    if (fetchedTransactions.length > 0) {
      transactions.push(...fetchedTransactions);
      lastFetchTimestamp = new Date().toISOString();
      
      // Force save to storage
      const originalInterval = STORAGE_CONFIG.storageInterval;
      STORAGE_CONFIG.storageInterval = 0;
      STORAGE_CONFIG.lastStorageTime = null;
      await storage.save();
      STORAGE_CONFIG.storageInterval = originalInterval;
      
      // Trigger historical fetch automatically after a short delay
      console.log('Scheduling historical transaction fetch after force refresh...');
      setTimeout(() => {
        fetchAllHistoricalTransactions().catch(err => 
          console.error('Error fetching historical transactions after force refresh:', err)
        );
      }, 5000); // Wait 5 seconds before starting historical fetch
    }
    
    // Return response
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      vercel: process.env.VERCEL ? true : false,
      message: 'Forced full refresh of all transactions (without historical fetch)',
      transactionCount: transactions.length,
      fetchedTransactions: fetchedTransactions.length,
      note: 'Only the most recent transactions have been fetched. Use /api/fetch-all to get historical transactions.'
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
}));

// Add a redirect for malformed URLs
app.get('/api/force-refresh/*', (req, res) => {
  console.log(`Redirecting malformed URL: ${req.originalUrl} to /api/force-refresh`);
  res.redirect('/api/force-refresh');
});

// Add a catch-all route for API endpoints
app.get('/api/*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    availableEndpoints: [
      '/api/stats',
      '/api/distributed',
      '/api/sol',
      '/api/refresh',
      '/api/fetch-all',
      '/api/fetch-status',
      '/api/force-save',
      '/api/force-refresh',
      '/api/background-job/:action',
      '/api/test-fetch',
      '/api/test-all',
      '/api/wallet/track',
      '/api/wallet/tracked',
      '/api/wallet/track/:address',
      '/track-wallet',
      '/'
    ]
  });
});

// Add a test endpoint to verify transaction fetching and storage
app.get('/api/test-fetch', asyncHandler(async (req, res) => {
  console.log('Testing transaction fetching and storage...');
  
  try {
    // Get current transaction count
    const initialCount = transactions.length;
    console.log(`Initial transaction count: ${initialCount}`);
    
    // Fetch exactly 10 transactions
    const fetchedTransactions = await fetchTransactionsVercel(10);
    console.log(`Fetched ${fetchedTransactions.length} transactions`);
    
    // Check if we're storing all transactions
    const afterFetchCount = transactions.length;
    console.log(`After fetch transaction count: ${afterFetchCount}`);
    
    // Return test results
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      testResults: {
        initialTransactionCount: initialCount,
        fetchedTransactionCount: fetchedTransactions.length,
        afterFetchTransactionCount: afterFetchCount,
        transactionsAdded: afterFetchCount - initialCount,
        fetchLimitWorking: fetchedTransactions.length <= 10,
        allTransactionsStored: afterFetchCount >= initialCount + fetchedTransactions.length - 5, // Allow for duplicates
        storageConfig: {
          maxStoredTransactions: STORAGE_CONFIG.maxStoredTransactions
        },
        fetchConfig: {
          maxTransactionsToFetch: CONFIG.transactions.maxTransactionsToFetch
        }
      }
    });
  } catch (error) {
    console.error('Error in test-fetch endpoint:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Test failed',
        details: error.message
      }
    });
  }
}));

// Add endpoints for wallet tracking
app.post('/api/wallet/track', express.json(), asyncHandler(async (req, res) => {
  try {
    const { walletAddress } = req.body;
    
    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Wallet address is required'
        }
      });
    }
    
    // Validate wallet address (basic check for Solana address)
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(walletAddress)) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Invalid Solana wallet address format'
        }
      });
    }
    
    // Add to tracked wallets
    trackedWallets.add(walletAddress);
    
    // If this is the first wallet, set it as the main distribution wallet
    if (!DISTRIBUTION_WALLET_ADDRESS) {
      DISTRIBUTION_WALLET_ADDRESS = walletAddress;
      console.log(`Set main distribution wallet to: ${walletAddress}`);
    }
    
    console.log(`Added wallet to tracking: ${walletAddress}`);
    console.log(`Currently tracking ${trackedWallets.size} wallets`);
    
    // Start fetching transactions for this wallet
    setTimeout(() => {
      fetchTransactionsForWallet(walletAddress).catch(err => 
        console.error(`Error fetching initial transactions for wallet ${walletAddress}:`, err)
      );
    }, 100);
    
    res.json({
      success: true,
      message: 'Wallet added to tracking',
      walletAddress,
      isMainWallet: walletAddress === DISTRIBUTION_WALLET_ADDRESS,
      trackedWalletCount: trackedWallets.size,
      trackedWallets: Array.from(trackedWallets)
    });
  } catch (error) {
    console.error('Error adding wallet for tracking:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to add wallet for tracking',
        details: error.message
      }
    });
  }
}));

app.delete('/api/wallet/track/:address', asyncHandler(async (req, res) => {
  try {
    const { address } = req.params;
    
    if (!address) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Wallet address is required'
        }
      });
    }
    
    // Remove from tracked wallets
    const wasTracked = trackedWallets.has(address);
    trackedWallets.delete(address);
    
    // If this was the main distribution wallet, set a new one if available
    if (address === DISTRIBUTION_WALLET_ADDRESS) {
      const remainingWallets = Array.from(trackedWallets);
      if (remainingWallets.length > 0) {
        DISTRIBUTION_WALLET_ADDRESS = remainingWallets[0];
        console.log(`Set new main distribution wallet to: ${DISTRIBUTION_WALLET_ADDRESS}`);
      } else {
        DISTRIBUTION_WALLET_ADDRESS = null;
        console.log('No main distribution wallet set');
      }
    }
    
    console.log(`Removed wallet from tracking: ${address}`);
    console.log(`Currently tracking ${trackedWallets.size} wallets`);
    
    res.json({
      success: true,
      message: wasTracked ? 'Wallet removed from tracking' : 'Wallet was not being tracked',
      walletAddress: address,
      currentMainWallet: DISTRIBUTION_WALLET_ADDRESS,
      trackedWalletCount: trackedWallets.size,
      trackedWallets: Array.from(trackedWallets)
    });
  } catch (error) {
    console.error('Error removing wallet from tracking:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to remove wallet from tracking',
        details: error.message
      }
    });
  }
}));

app.get('/api/wallet/tracked', asyncHandler(async (req, res) => {
  try {
    res.json({
      success: true,
      mainWallet: DISTRIBUTION_WALLET_ADDRESS,
      trackedWalletCount: trackedWallets.size,
      trackedWallets: Array.from(trackedWallets)
    });
  } catch (error) {
    console.error('Error getting tracked wallets:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to get tracked wallets',
        details: error.message
      }
    });
  }
}));

// Add a comprehensive test endpoint
app.get('/api/test-all', asyncHandler(async (req, res) => {
  console.log('Running comprehensive system test...');
  
  try {
    const testResults = {
      timestamp: new Date().toISOString(),
      tests: {}
    };
    
    // Test 1: Configuration
    testResults.tests.configuration = {
      heliusApiKey: !!HELIUS_API_KEY,
      heliusRpcUrl: !!HELIUS_RPC_URL,
      distributionWalletAddress: !!DISTRIBUTION_WALLET_ADDRESS,
      taxTokenMintAddress: !!TAX_TOKEN_MINT_ADDRESS,
      trackedWalletCount: trackedWallets.size,
      maxStoredTransactions: STORAGE_CONFIG.maxStoredTransactions,
      maxTransactionsToFetch: CONFIG.transactions.maxTransactionsToFetch,
      backgroundJobsEnabled: CONFIG.backgroundJobs.enabled,
      autoFetchInterval: CONFIG.backgroundJobs.autoFetchInterval
    };
    
    // Test 2: Storage
    const initialTransactionCount = transactions.length;
    testResults.tests.storage = {
      initialTransactionCount,
      inMemoryStorageWorking: Array.isArray(transactions)
    };
    
    // Test 3: Transaction fetching
    console.log('Testing transaction fetching...');
    const fetchStartTime = Date.now();
    const fetchedTransactions = await fetchTransactionsVercel(5); // Fetch just 5 for testing
    const fetchDuration = Date.now() - fetchStartTime;
    
    testResults.tests.transactionFetching = {
      fetchedCount: fetchedTransactions.length,
      fetchDurationMs: fetchDuration,
      fetchSuccessful: fetchedTransactions.length > 0,
      fetchLimitWorking: fetchedTransactions.length <= 5,
      sampleTransaction: fetchedTransactions.length > 0 ? {
        signature: fetchedTransactions[0].signature,
        blockTime: fetchedTransactions[0].blockTime,
        type: fetchedTransactions[0].type
      } : null
    };
    
    // Test 4: Background job status
    testResults.tests.backgroundJobs = {
      enabled: CONFIG.backgroundJobs.enabled,
      isRunning: backgroundJobState.isRunning,
      lastRunTime: backgroundJobState.lastRunTime,
      consecutiveErrors: backgroundJobState.consecutiveErrors,
      currentInterval: backgroundJobState.currentInterval
    };
    
    // Test 5: Refresh functionality
    console.log('Testing refresh functionality...');
    const preRefreshCount = transactions.length;
    
    // Clear transactions
    transactions.length = 0;
    
    // Fetch a small batch
    const refreshedTransactions = await fetchTransactionsVercel(3);
    const postRefreshCount = transactions.length;
    
    testResults.tests.refreshFunctionality = {
      preRefreshCount,
      postRefreshCount,
      clearingWorked: preRefreshCount > 0 && postRefreshCount < preRefreshCount,
      fetchAfterClearWorked: postRefreshCount > 0
    };
    
    // Restore original transactions if needed
    if (preRefreshCount > 0 && postRefreshCount < preRefreshCount) {
      console.log('Restoring original transaction count...');
      await fetchTransactionsVercel(10);
    }
    
    // Return all test results
    res.json({
      success: true,
      message: 'Comprehensive system test completed',
      testResults
    });
  } catch (error) {
    console.error('Error in comprehensive test:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Comprehensive test failed',
        details: error.message
      }
    });
  }
}));

// Add a function to fetch transactions for a specific wallet
async function fetchTransactionsForWallet(walletAddress, limit = 10) {
  try {
    console.log(`Fetching transactions for wallet: ${walletAddress} (limit: ${limit})...`);
    
    if (!HELIUS_API_KEY || !HELIUS_RPC_URL) {
      console.error('Missing required environment variables for Helius service');
      return [];
    }
    
    // Prepare request data
    const requestData = {
      jsonrpc: '2.0',
      id: 'my-id',
      method: 'getSignaturesForAddress',
      params: [
        walletAddress,
        {
          limit: limit,
          before: null, // Fetch from the most recent
          until: null   // No end point
        }
      ]
    };
    
    // Add retry logic for rate limiting
    let retryCount = 0;
    let success = false;
    let response;
    
    while (!success && retryCount < 5) {
      try {
        // Make direct request to Helius API with proper headers
        response = await axios.post(HELIUS_RPC_URL, requestData, {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': HELIUS_API_KEY
          },
          timeout: 10000 // 10 second timeout
        });
        
        success = true;
      } catch (error) {
        retryCount++;
        console.error(`Error fetching transactions for wallet (attempt ${retryCount}/5):`, error.message);
        
        if (retryCount < 5) {
          // Exponential backoff
          const backoffTime = Math.pow(2, retryCount) * 1000;
          console.log(`Retrying in ${backoffTime / 1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, backoffTime));
        } else {
          console.error('Max retries reached, giving up');
          return [];
        }
      }
    }
    
    // Check if response is valid
    if (!response || !response.data || !response.data.result) {
      console.error('Invalid response from Helius API:', response?.data);
      return [];
    }
    
    // Get signatures from response
    const signatures = response.data.result;
    console.log(`Got ${signatures.length} signatures for wallet ${walletAddress}`);
    
    // Process each signature to get transaction details
    const newTransactions = [];
    
    for (const item of signatures) {
      try {
        // Check if we already have this transaction
        const existingTransaction = transactions.find(t => t.signature === item.signature);
        if (existingTransaction) {
          console.log(`Transaction ${item.signature} already exists, skipping`);
          continue;
        }
        
        // Get transaction details
        const txData = await getTransactionDetails(item.signature);
        
        if (txData) {
          newTransactions.push(txData);
        }
      } catch (error) {
        console.error(`Error processing transaction ${item.signature}:`, error.message);
      }
    }
    
    console.log(`Processed ${newTransactions.length} new transactions for wallet ${walletAddress}`);
    return newTransactions;
  } catch (error) {
    console.error(`Error fetching transactions for wallet ${walletAddress}:`, error);
    return [];
  }
}

// Add a simple HTML form for users to enter their wallet
app.get('/track-wallet', (req, res) => {
  const html = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Track Your Wallet</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        line-height: 1.6;
        margin: 0 auto;
        padding: 20px;
        color: #333;
        max-width: 800px;
        background-color: #f5f5f5;
      }
      h1 {
        color: #2c3e50;
        text-align: center;
        margin-bottom: 30px;
      }
      .container {
        background-color: white;
        padding: 30px;
        border-radius: 8px;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
      }
      .form-group {
        margin-bottom: 20px;
      }
      label {
        display: block;
        margin-bottom: 8px;
        font-weight: bold;
      }
      input[type="text"] {
        width: 100%;
        padding: 10px;
        border: 1px solid #ddd;
        border-radius: 4px;
        font-size: 16px;
      }
      button {
        background-color: #3498db;
        color: white;
        border: none;
        padding: 12px 20px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 16px;
        display: block;
        width: 100%;
      }
      button:hover {
        background-color: #2980b9;
      }
      .result {
        margin-top: 20px;
        padding: 15px;
        border-radius: 4px;
        display: none;
      }
      .success {
        background-color: #d4edda;
        color: #155724;
        border: 1px solid #c3e6cb;
      }
      .error {
        background-color: #f8d7da;
        color: #721c24;
        border: 1px solid #f5c6cb;
      }
      .info {
        background-color: #e2f0fb;
        color: #0c5460;
        border: 1px solid #bee5eb;
      }
      .tracked-wallets {
        margin-top: 30px;
      }
      .wallet-item {
        background-color: #f8f9fa;
        padding: 10px 15px;
        margin-bottom: 10px;
        border-radius: 4px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .remove-btn {
        background-color: #dc3545;
        color: white;
        border: none;
        padding: 5px 10px;
        border-radius: 4px;
        cursor: pointer;
      }
      .remove-btn:hover {
        background-color: #c82333;
      }
    </style>
    <!-- Favicon references -->
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
    <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
    <link rel="manifest" href="/site.webmanifest">
  </head>
  <body>
    <div class="container">
      <h1>Track Your Solana Wallet</h1>
      <p>Enter your Solana wallet address below to track rewards and distributions.</p>
      
      <div class="form-group">
        <label for="walletAddress">Solana Wallet Address:</label>
        <input type="text" id="walletAddress" name="walletAddress" placeholder="Enter your Solana wallet address" required>
      </div>
      
      <button id="trackWalletBtn">Track Wallet</button>
      
      <div id="result" class="result"></div>
      
      <div class="tracked-wallets">
        <h2>Your Tracked Wallets</h2>
        <div id="walletsList"></div>
      </div>
    </div>
    
    <script>
      document.addEventListener('DOMContentLoaded', function() {
        // Load tracked wallets when page loads
        fetchTrackedWallets();
        
        // Handle form submission
        document.getElementById('trackWalletBtn').addEventListener('click', function() {
          const walletAddress = document.getElementById('walletAddress').value.trim();
          
          if (!walletAddress) {
            showResult('Please enter a wallet address', 'error');
            return;
          }
          
          // Validate Solana wallet address format (base58, 32-44 chars)
          if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(walletAddress)) {
            showResult('Invalid Solana wallet address format', 'error');
            return;
          }
          
          // Send request to track wallet
          fetch('/api/wallet/track', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ walletAddress })
          })
          .then(response => response.json())
          .then(data => {
            if (data.success) {
              showResult('Wallet successfully tracked!', 'success');
              document.getElementById('walletAddress').value = '';
              fetchTrackedWallets(); // Refresh the list
            } else {
              showResult('Error: ' + (data.error?.message || 'Unknown error'), 'error');
            }
          })
          .catch(error => {
            showResult('Error: ' + error.message, 'error');
          });
        });
        
        function showResult(message, type) {
          const resultElement = document.getElementById('result');
          resultElement.textContent = message;
          resultElement.className = 'result ' + type;
          resultElement.style.display = 'block';
        }
        
        function fetchTrackedWallets() {
          fetch('/api/wallet/tracked')
          .then(response => response.json())
          .then(data => {
            const walletsList = document.getElementById('walletsList');
            walletsList.innerHTML = '';
            
            if (data.success && data.wallets && data.wallets.length > 0) {
              data.wallets.forEach(wallet => {
                const walletItem = document.createElement('div');
                walletItem.className = 'wallet-item';
                
                const walletText = document.createElement('span');
                walletText.textContent = wallet;
                walletItem.appendChild(walletText);
                
                const removeBtn = document.createElement('button');
                removeBtn.className = 'remove-btn';
                removeBtn.textContent = 'Remove';
                removeBtn.onclick = function() {
                  removeWallet(wallet);
                };
                walletItem.appendChild(removeBtn);
                
                walletsList.appendChild(walletItem);
              });
            } else {
              walletsList.innerHTML = '<p>No wallets currently tracked. Add one above.</p>';
            }
          })
          .catch(error => {
            console.error('Error fetching tracked wallets:', error);
          });
        }
        
        function removeWallet(walletAddress) {
          fetch('/api/wallet/track/' + walletAddress, {
            method: 'DELETE'
          })
          .then(response => response.json())
          .then(data => {
            if (data.success) {
              showResult('Wallet removed from tracking', 'info');
              fetchTrackedWallets(); // Refresh the list
            } else {
              showResult('Error removing wallet: ' + (data.error?.message || 'Unknown error'), 'error');
            }
          })
          .catch(error => {
            showResult('Error: ' + error.message, 'error');
          });
        }
      });
    </script>
  </body>
  </html>
  `;
  
  res.send(html);
});

// Initialize the app is already called earlier in the file
// initializeApp();

// Export for Vercel serverless deployment
module.exports = app; 