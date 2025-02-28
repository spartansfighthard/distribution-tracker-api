// Load environment variables
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { setTimeout: setTimeoutPromise } = require('timers/promises');
const fs = require('fs').promises;
const path = require('path');
const nodeSetTimeout = global.setTimeout;

// Storage configuration
const STORAGE_CONFIG = {
  localFilePath: path.join(process.cwd(), 'data', 'transactions.json'),
  vercelKVEnabled: process.env.VERCEL_KV_URL ? true : false,
  vercelBlobEnabled: true, // Always enable Blob storage
  storageKey: 'transactions_data',
  blobStoragePath: 'transactions/data.json',
  maxStoredTransactions: 10000, // Store up to 10,000 transactions
  storageInterval: 10 * 1000, // How often to save data (10 seconds)
  lastStorageTime: null
};

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
    maxTransactionsToFetch: 5,   // Reduced from 10 to 5 to speed up processing
    cacheExpiration: 30 * 60 * 1000, // Cache expiration time in ms (30 minutes)
    maxTransactionsPerRequest: 2, // Reduced from 5 to 2 to avoid timeouts
  },
  // Vercel optimization
  vercel: {
    maxProcessingTime: 5000,     // Reduced from 10s to 5s to be more conservative
    maxTransactionsPerServerlessRequest: 1, // Reduced from 2 to 1
    skipRateLimiting: true,      // Skip rate limiting in Vercel environment
    skipDetailedProcessing: true // Skip detailed transaction processing in Vercel
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

  // Modified to bypass rate limiting in Vercel environment
  async throttle() {
    // Skip rate limiting in Vercel environment
    if (process.env.VERCEL && CONFIG.vercel.skipRateLimiting) {
      this.lastRequestTime = Date.now();
      this.requestCount++;
      return;
    }

    const now = Date.now();
    
    // If we've hit a rate limit recently, enforce a longer cooldown
    if (this.lastRateLimitTime && (now - this.lastRateLimitTime) < this.cooldownPeriod) {
      const remainingCooldown = this.cooldownPeriod - (now - this.lastRateLimitTime);
      console.log(`In cooldown period after rate limit. Waiting ${remainingCooldown}ms before next request`);
      await setTimeoutPromise(remainingCooldown);
    }
    
    // Add extra delay if we've had consecutive errors
    const extraDelay = this.consecutiveErrors * 5000; // 5 seconds per consecutive error
    const baseDelay = Math.max(0, (1000 / this.requestsPerSecond) - (now - this.lastRequestTime));
    const timeToWait = baseDelay + extraDelay;
    
    if (timeToWait > 0) {
      console.log(`Rate limiting: waiting ${timeToWait}ms before next request (consecutive errors: ${this.consecutiveErrors})`);
      await setTimeoutPromise(timeToWait);
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
        await setTimeoutPromise(waitTime);
        
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
      // Use Node's standard setTimeout for callback-style usage
      nodeSetTimeout(() => this.processQueue(), 1000);
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

// In-memory storage for transactions - NOTE: This won't persist between serverless function invocations
// For Vercel, we'll need to fetch fresh data on each request
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
      if (process.env.VERCEL) {
        // Always try Blob storage in Vercel
        try {
          console.log('Attempting to load from Vercel Blob storage...');
          const { list, get } = await import('@vercel/blob');
          
          // List blobs to check if our data exists
          const blobs = await list();
          console.log('Available blobs:', blobs);
          
          // Try to get our data blob
          try {
            const blob = await get(STORAGE_CONFIG.blobStoragePath);
            
            if (blob) {
              const text = await blob.text();
              const storedData = JSON.parse(text);
              
              if (storedData.transactions && Array.isArray(storedData.transactions)) {
                // Clear existing transactions and add loaded ones
                transactions.length = 0;
                transactions.push(...storedData.transactions);
                lastFetchTimestamp = storedData.lastFetchTimestamp || new Date().toISOString();
                console.log(`Loaded ${transactions.length} transactions from Vercel Blob storage`);
                return true;
              }
            }
          } catch (getBlobError) {
            console.log('Blob not found or error getting blob:', getBlobError.message);
          }
        } catch (blobError) {
          console.error('Error loading from Vercel Blob:', blobError);
        }
        
        // If Blob storage failed, we'll use fresh data
        return false;
      } else {
        // For local development, load from file
        try {
          const data = await fs.readFile(STORAGE_CONFIG.localFilePath, 'utf8');
          const parsedData = JSON.parse(data);
          if (parsedData.transactions && Array.isArray(parsedData.transactions)) {
            // Clear existing transactions and add loaded ones
            transactions.length = 0;
            transactions.push(...parsedData.transactions);
            lastFetchTimestamp = parsedData.lastFetchTimestamp || new Date().toISOString();
            console.log(`Loaded ${transactions.length} transactions from local file storage`);
            return true;
          }
        } catch (fileError) {
          if (fileError.code !== 'ENOENT') {
            console.error('Error loading from file:', fileError);
          } else {
            console.log('No existing transaction file found, starting fresh');
          }
        }
        return false;
      }
    } catch (error) {
      console.error('Error loading transactions:', error);
      return false;
    }
  },
  
  // Save transactions to storage
  async save() {
    try {
      // Only save if we have transactions
      if (transactions.length === 0) {
        console.log('No transactions to save');
        return false;
      }
      
      const now = Date.now();
      if (STORAGE_CONFIG.lastStorageTime && 
          (now - STORAGE_CONFIG.lastStorageTime) < STORAGE_CONFIG.storageInterval) {
        console.log('Skipping save, not enough time has passed since last save');
        return false;
      }
      
      // Limit the number of transactions we store
      const transactionsToStore = transactions.slice(0, STORAGE_CONFIG.maxStoredTransactions);
      
      // Prepare data to store
      const dataToStore = {
        transactions: transactionsToStore,
        lastFetchTimestamp,
        savedAt: new Date().toISOString()
      };
      
      if (process.env.VERCEL) {
        // Always use Blob storage in Vercel
        try {
          console.log('Attempting to save to Vercel Blob storage...');
          const { put } = await import('@vercel/blob');
          
          // Convert data to JSON string
          const jsonData = JSON.stringify(dataToStore);
          
          // Create a Blob from the JSON string
          const blob = new Blob([jsonData], { type: 'application/json' });
          
          // Upload to Vercel Blob Storage
          const { url } = await put(STORAGE_CONFIG.blobStoragePath, blob, {
            access: 'public',
          });
          
          STORAGE_CONFIG.lastStorageTime = now;
          console.log(`Saved ${transactionsToStore.length} transactions to Vercel Blob storage at ${url}`);
          return true;
        } catch (blobError) {
          console.error('Error saving to Vercel Blob:', blobError);
          return false;
        }
      } else {
        // For local development, save to file
        try {
          await fs.writeFile(
            STORAGE_CONFIG.localFilePath, 
            JSON.stringify(dataToStore, null, 2), 
            'utf8'
          );
          STORAGE_CONFIG.lastStorageTime = now;
          console.log(`Saved ${transactionsToStore.length} transactions to local file storage`);
          return true;
        } catch (fileError) {
          console.error('Error saving to file:', fileError);
          return false;
        }
      }
    } catch (error) {
      console.error('Error saving transactions:', error);
      return false;
    }
  }
};

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
async function fetchTransactionsVercel(limit = 20) { // Changed back to 20 from 100
  try {
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
    
    // Make direct request to Helius API without rate limiting
    const response = await axios.post(HELIUS_RPC_URL, requestData);
    
    // Check if response is valid
    if (!response.data || !response.data.result) {
      console.error('Invalid response from Helius API:', response.data);
      return [];
    }
    
    // Get signatures from response
    const signatures = response.data.result;
    console.log(`[Vercel] Fetched ${signatures.length} signatures`);
    
    // For Vercel, we'll fetch transaction details for a limited number of transactions
    const maxToProcess = Math.min(signatures.length, 10); // Changed back to 10 from 50
    const processedTransactions = [];
    
    // Start time tracking
    const startTime = Date.now();
    const timeLimit = 10000; // 10 seconds max processing time
    
    // Process signatures one by one
    for (let i = 0; i < maxToProcess; i++) {
      // Check if we're approaching the time limit
      if (Date.now() - startTime > timeLimit) {
        console.log(`[Vercel] Approaching time limit, stopping after processing ${i} transactions`);
        break;
      }
      
      const sig = signatures[i];
      try {
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
        
        // Make direct request without rate limiting
        const txResponse = await axios.post(HELIUS_RPC_URL, txRequestData);
        
        if (!txResponse.data || !txResponse.data.result) {
          console.log(`[Vercel] Invalid response for transaction ${sig.signature}`);
          continue;
        }
        
        const txData = txResponse.data.result;
        
        // Basic transaction data
        const transaction = {
          signature: sig.signature,
          blockTime: txData.blockTime || sig.blockTime,
          slot: txData.slot || sig.slot,
          timestamp: new Date((txData.blockTime || sig.blockTime) * 1000).toISOString(),
          type: 'unknown',
          amount: 0,
          token: 'SOL'
        };
        
        // Try to determine transaction type and details
        if (txData && txData.meta && !txData.meta.err) {
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
        }
        
        processedTransactions.push(transaction);
        
      } catch (error) {
        console.error(`[Vercel] Error processing transaction ${sig.signature}:`, error.message);
        // Continue with next signature
        continue;
      }
    }
    
    console.log(`[Vercel] Successfully processed ${processedTransactions.length} transactions in ${Date.now() - startTime}ms`);
    
    // Store the processed transactions in memory
    if (processedTransactions.length > 0) {
      // Load existing transactions from storage first
      await storage.load();
      
      // Add new transactions, avoiding duplicates
      const existingSignatures = new Set(transactions.map(tx => tx.signature));
      const newUniqueTransactions = processedTransactions.filter(tx => !existingSignatures.has(tx.signature));
      
      if (newUniqueTransactions.length > 0) {
        console.log(`[Vercel] Adding ${newUniqueTransactions.length} new unique transactions to storage`);
        transactions.push(...newUniqueTransactions);
        
        // Sort transactions by blockTime (newest first)
        transactions.sort((a, b) => b.blockTime - a.blockTime);
        
        lastFetchTimestamp = new Date().toISOString();
        
        // Save to persistent storage
        console.log('[Vercel] Saving all transactions to Blob storage...');
        await storage.save();
      } else {
        console.log('[Vercel] No new unique transactions to add');
      }
    }
    
    return processedTransactions;
  } catch (error) {
    console.error('[Vercel] Error fetching transactions:', error.message);
    return [];
  }
}

// Fetch transactions from Helius API - Optimized for serverless
async function fetchTransactions(limit = CONFIG.transactions.maxTransactionsToFetch) {
  // For Vercel, use the simplified direct fetch
  if (process.env.VERCEL) {
    // Try to load from storage first
    const loadedFromStorage = await storage.load();
    if (loadedFromStorage && transactions.length > 0) {
      console.log(`Using ${transactions.length} transactions from storage`);
      return transactions;
    }
    
    // If no stored data, fetch fresh data
    return fetchTransactionsVercel(limit);
  }
  
  try {
    console.log(`Fetching transactions from Helius API (limit: ${limit})...`);
    
    if (!HELIUS_API_KEY || !HELIUS_RPC_URL || !DISTRIBUTION_WALLET_ADDRESS) {
      console.error('Missing required environment variables for Helius service');
      return [];
    }
    
    // For Vercel, we need to be mindful of the 15-second timeout
    const startTime = Date.now();
    
    // Prepare request data
    const requestData = {
      jsonrpc: '2.0',
      id: 'my-id',
      method: 'getSignaturesForAddress',
      params: [
        DISTRIBUTION_WALLET_ADDRESS,
        {
          limit: limit
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
    
    // For Vercel, limit the number of signatures we process to avoid timeouts
    const maxSignaturesToProcess = process.env.VERCEL 
      ? Math.min(newSignatures.length, CONFIG.vercel.maxTransactionsPerServerlessRequest)
      : Math.min(newSignatures.length, CONFIG.transactions.maxTransactionsPerRequest);
    
    const signaturesToProcess = newSignatures.slice(0, maxSignaturesToProcess);
    
    if (signaturesToProcess.length < newSignatures.length) {
      console.log(`Limiting processing to ${maxSignaturesToProcess} signatures out of ${newSignatures.length} to avoid timeouts`);
    }
    
    const newTransactions = [];
    
    // Process one signature at a time with significant delays between each
    for (const sig of signaturesToProcess) {
      try {
        // Check if we're approaching the Vercel timeout
        if (process.env.VERCEL && (Date.now() - startTime) > CONFIG.vercel.maxProcessingTime) {
          console.log(`Approaching Vercel timeout limit, stopping processing after ${newTransactions.length} transactions`);
          break;
        }
        
        console.log(`Processing signature: ${sig.signature}`);
        
        const txDetails = await getTransactionDetails(sig.signature);
        if (txDetails) {
          newTransactions.push(txDetails);
          console.log(`Successfully processed transaction: ${sig.signature}`);
        }
        
        // Add a delay between processing signatures, but only if not on Vercel
        if (!process.env.VERCEL && signaturesToProcess.indexOf(sig) < signaturesToProcess.length - 1) {
          console.log(`Waiting ${CONFIG.rateLimits.batchDelay}ms before processing next signature...`);
          await setTimeoutPromise(CONFIG.rateLimits.batchDelay);
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
  res.status(200).json({
    success: true,
    message: 'SOL Distribution Tracker API is running',
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    vercel: process.env.VERCEL ? true : false,
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

// Get overall SOL statistics - Simplified for Vercel
app.get('/api/stats', asyncHandler(async (req, res) => {
  console.log('Getting overall SOL statistics...');
  
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
      
      // Calculate basic statistics
      const stats = {
        totalTransactions: fetchedTransactions.length,
        transactionsByType: {},
        transactionsByToken: {},
        totalAmountByToken: {}
      };
      
      // Process each transaction
      for (const tx of fetchedTransactions) {
        // Count by type
        stats.transactionsByType[tx.type] = (stats.transactionsByType[tx.type] || 0) + 1;
        
        // Count by token
        stats.transactionsByToken[tx.token] = (stats.transactionsByToken[tx.token] || 0) + 1;
        
        // Sum amount by token
        if (tx.amount) {
          stats.totalAmountByToken[tx.token] = (stats.totalAmountByToken[tx.token] || 0) + tx.amount;
        }
      }
      
      // Return simplified statistics
      return res.json({
        success: true,
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        vercel: true,
        note: "Running in optimized mode for Vercel serverless environment",
        stats: {
          ...stats,
          totalStoredTransactions: transactions.length,
          displayedTransactions: fetchedTransactions.length,
          recentTransactions: fetchedTransactions.slice(0, 10),
          allTransactions: transactions,
          fetchedAt: new Date().toISOString()
        }
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
    // Fetch a minimal set of transactions
    const fetchedTransactions = await fetchTransactionsVercel(20);
    
    // Get transactions with type 'sent'
    const sentTransactions = fetchedTransactions.filter(tx => tx.type === 'sent' && tx.token === 'SOL');
    
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
    
    // Return simplified statistics
    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      vercel: true,
      note: "Running in optimized mode for Vercel serverless environment",
      stats: {
        ...stats,
        totalStoredTransactions: transactions.length,
        displayedTransactions: sentTransactions.length,
        recentDistributions: sentTransactions.slice(0, 10),
        allDistributions: transactions.filter(tx => tx.type === 'sent' && tx.token === 'SOL')
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
    stats
  });
}));

// Get detailed SOL transfer statistics - Simplified for Vercel
app.get('/api/sol', asyncHandler(async (req, res) => {
  console.log('Getting detailed SOL transfer statistics...');
  
  // For Vercel, use a simplified approach
  if (process.env.VERCEL) {
    // Fetch a minimal set of transactions
    const fetchedTransactions = await fetchTransactionsVercel(20);
    
    // Get transactions for SOL
    const solTransactions = fetchedTransactions.filter(tx => tx.token === 'SOL');
    
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
    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      vercel: true,
      note: "Running in optimized mode for Vercel serverless environment",
      serverlessNote: "Due to serverless constraints, each request fetches fresh data. This shows only the most recent transactions.",
      stats,
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
  
  // Return statistics
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    vercel: false,
    stats
  });
}));

// Force refresh historical transaction data - Simplified for Vercel
app.post('/api/refresh', asyncHandler(async (req, res) => {
  console.log('Refreshing historical transaction data...');
  
  try {
    // For Vercel, use a simplified approach
    if (process.env.VERCEL) {
      // Fetch a minimal set of transactions
      const fetchedTransactions = await fetchTransactionsVercel(20);
      
      // Return simplified response
      return res.json({
        success: true,
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        vercel: true,
        note: "Running in optimized mode for Vercel serverless environment",
        serverlessNote: "Due to serverless constraints, each request fetches fresh data. This shows only the most recent transactions.",
        message: 'Fetched transaction data with details',
        count: fetchedTransactions.length,
        recentTransactions: fetchedTransactions,
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
    console.log('[Vercel] Starting historical transaction fetch...');
    
    if (!HELIUS_API_KEY || !HELIUS_RPC_URL || !DISTRIBUTION_WALLET_ADDRESS) {
      console.error('Missing required environment variables for Helius service');
      return [];
    }
    
    // First, load any existing transactions
    await storage.load();
    const existingSignatures = new Set(transactions.map(tx => tx.signature));
    console.log(`[Vercel] Loaded ${existingSignatures.size} existing transaction signatures`);
    
    let allNewTransactions = [];
    let hasMore = true;
    let beforeSignature = null;
    const batchSize = 20; // Changed from 50 to 20
    let batchCount = 0;
    const maxBatches = 10; // Limit to 10 batches (200 transactions) per run to avoid timeouts
    
    // Start time tracking
    const startTime = Date.now();
    const timeLimit = 12000; // 12 seconds max processing time
    
    while (hasMore && batchCount < maxBatches) {
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
      
      // Make direct request to Helius API
      const response = await axios.post(HELIUS_RPC_URL, requestData);
      
      // Check if response is valid
      if (!response.data || !response.data.result || response.data.result.length === 0) {
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
        // If we've reached signatures we already have, we can stop
        if (signatures.length > 0 && existingSignatures.has(signatures[0].signature)) {
          console.log('[Vercel] Reached signatures that are already in storage, stopping');
          hasMore = false;
          break;
        }
        
        // Otherwise continue to next batch
        continue;
      }
      
      // Process new signatures
      const batchProcessedTransactions = [];
      const batchStartTime = Date.now();
      
      for (let i = 0; i < newSignatures.length; i++) {
        // Check if we're approaching the time limit
        if (Date.now() - startTime > timeLimit) {
          console.log(`[Vercel] Approaching overall time limit, stopping signature processing`);
          break;
        }
        
        const sig = newSignatures[i];
        try {
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
          
          // Make direct request without rate limiting
          const txResponse = await axios.post(HELIUS_RPC_URL, txRequestData);
          
          if (!txResponse.data || !txResponse.data.result) {
            console.log(`[Vercel] Invalid response for transaction ${sig.signature}`);
            continue;
          }
          
          const txData = txResponse.data.result;
          
          // Basic transaction data
          const transaction = {
            signature: sig.signature,
            blockTime: txData.blockTime || sig.blockTime,
            slot: txData.slot || sig.slot,
            timestamp: new Date((txData.blockTime || sig.blockTime) * 1000).toISOString(),
            type: 'unknown',
            amount: 0,
            token: 'SOL'
          };
          
          // Try to determine transaction type and details
          if (txData && txData.meta && !txData.meta.err) {
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
          }
          
          batchProcessedTransactions.push(transaction);
          existingSignatures.add(transaction.signature); // Add to our tracking set
          
        } catch (error) {
          console.error(`[Vercel] Error processing transaction ${sig.signature}:`, error.message);
          // Continue with next signature
          continue;
        }
      }
      
      console.log(`[Vercel] Processed ${batchProcessedTransactions.length} transactions in batch ${batchCount} (${Date.now() - batchStartTime}ms)`);
      allNewTransactions = [...allNewTransactions, ...batchProcessedTransactions];
      
      // Save after each batch to avoid losing progress
      if (batchProcessedTransactions.length > 0) {
        transactions.push(...batchProcessedTransactions);
        
        // Sort transactions by blockTime (newest first)
        transactions.sort((a, b) => b.blockTime - a.blockTime);
        
        lastFetchTimestamp = new Date().toISOString();
        
        // Save to persistent storage
        console.log(`[Vercel] Saving batch ${batchCount} to Blob storage (${transactions.length} total transactions)...`);
        await storage.save();
      }
    }
    
    console.log(`[Vercel] Historical fetch complete. Added ${allNewTransactions.length} new transactions in ${batchCount} batches.`);
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
  app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    // Initialize storage
    await storage.init();
  });
} else {
  // For production, initialize storage when the module is loaded
  storage.init().catch(err => console.error('Error initializing storage:', err));
}

// Export for Vercel serverless deployment
module.exports = app; 