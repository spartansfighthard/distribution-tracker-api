// Transaction data collector script
// This script fetches transaction data from Helius API and stores it locally
// Run this script periodically (e.g., using cron) to keep transaction data up to date

// Load environment variables
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { setTimeout } = require('timers/promises');

// Configuration
const CONFIG = {
  // API rate limiting
  rateLimits: {
    requestsPerSecond: 0.5,      // Very conservative: 1 request per 2 seconds
    retryDelay: 10000,           // 10 seconds base delay for retries
    maxRetries: 5,               // Maximum number of retries for failed requests
    batchSize: 2,                // Very small batch size
    batchDelay: 10000,           // 10 seconds between batches
    initialBackoff: 30000,       // 30 seconds initial backoff time
    maxRequestsPerRun: 20,       // Maximum requests per script run
  },
  // Data storage
  storage: {
    dataDir: path.join(__dirname, '../data'),
    transactionsFile: 'transactions.json',
    lastFetchFile: 'last-fetch.json',
    backupInterval: 5,           // Create a backup every 5 new transactions
  }
};

// Constants
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const HELIUS_RPC_URL = process.env.HELIUS_RPC_URL;
const DISTRIBUTION_WALLET_ADDRESS = process.env.DISTRIBUTION_WALLET_ADDRESS;

// Ensure data directory exists
if (!fs.existsSync(CONFIG.storage.dataDir)) {
  fs.mkdirSync(CONFIG.storage.dataDir, { recursive: true });
  console.log(`Created data directory: ${CONFIG.storage.dataDir}`);
}

// Rate limiter utility
class RateLimiter {
  constructor(requestsPerSecond = CONFIG.rateLimits.requestsPerSecond) {
    this.requestsPerSecond = requestsPerSecond;
    this.queue = [];
    this.processing = false;
    this.lastRequestTime = 0;
    this.consecutiveErrors = 0;
    this.requestCount = 0;
  }

  async throttle() {
    const now = Date.now();
    // Add extra delay if we've had consecutive errors
    const extraDelay = this.consecutiveErrors * 2000; // 2 seconds per consecutive error
    const timeToWait = Math.max(0, (1000 / this.requestsPerSecond) - (now - this.lastRequestTime)) + extraDelay;
    
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
      // Check if we've reached the maximum requests for this run
      if (this.requestCount >= CONFIG.rateLimits.maxRequestsPerRun) {
        return reject(new Error('Maximum request limit reached for this run'));
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
      
      // If we hit a rate limit, wait longer and retry
      if (error.response && error.response.status === 429) {
        const waitTime = CONFIG.rateLimits.initialBackoff * Math.pow(2, this.consecutiveErrors - 1);
        console.log(`Rate limit hit, waiting ${waitTime}ms before continuing (consecutive errors: ${this.consecutiveErrors})...`);
        await setTimeout(waitTime);
        
        // Put the request back at the front of the queue
        this.queue.unshift({ requestFn, resolve, reject });
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
}

// Load transactions from file
function loadTransactions() {
  const filePath = path.join(CONFIG.storage.dataDir, CONFIG.storage.transactionsFile);
  
  if (fs.existsSync(filePath)) {
    try {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error loading transactions from file:', error);
      return [];
    }
  }
  
  return [];
}

// Save transactions to file
function saveTransactions(transactions) {
  const filePath = path.join(CONFIG.storage.dataDir, CONFIG.storage.transactionsFile);
  
  try {
    fs.writeFileSync(filePath, JSON.stringify(transactions, null, 2), 'utf8');
    console.log(`Saved ${transactions.length} transactions to ${filePath}`);
    
    // Create a backup if needed
    if (transactions.length % CONFIG.storage.backupInterval === 0) {
      const backupPath = path.join(CONFIG.storage.dataDir, `transactions-backup-${Date.now()}.json`);
      fs.writeFileSync(backupPath, JSON.stringify(transactions, null, 2), 'utf8');
      console.log(`Created backup at ${backupPath}`);
    }
  } catch (error) {
    console.error('Error saving transactions to file:', error);
  }
}

// Load last fetch data
function loadLastFetch() {
  const filePath = path.join(CONFIG.storage.dataDir, CONFIG.storage.lastFetchFile);
  
  if (fs.existsSync(filePath)) {
    try {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error loading last fetch data:', error);
      return { timestamp: null, until: null };
    }
  }
  
  return { timestamp: null, until: null };
}

// Save last fetch data
function saveLastFetch(data) {
  const filePath = path.join(CONFIG.storage.dataDir, CONFIG.storage.lastFetchFile);
  
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`Saved last fetch data to ${filePath}`);
  } catch (error) {
    console.error('Error saving last fetch data:', error);
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
    
    // Load existing transactions
    const transactions = loadTransactions();
    console.log(`Loaded ${transactions.length} existing transactions`);
    
    // Load last fetch data
    const lastFetch = loadLastFetch();
    console.log(`Last fetch: ${lastFetch.timestamp || 'never'}`);
    
    // Prepare request data
    const requestData = {
      jsonrpc: '2.0',
      id: 'my-id',
      method: 'getSignaturesForAddress',
      params: [
        DISTRIBUTION_WALLET_ADDRESS,
        {
          limit: CONFIG.rateLimits.maxRequestsPerRun
        }
      ]
    };
    
    // Add until parameter if we have a previous signature
    if (lastFetch.until) {
      requestData.params[1].until = lastFetch.until;
    }
    
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
    
    // Save the last signature for pagination in future runs
    if (signatures.length > 0) {
      lastFetch.until = signatures[signatures.length - 1].signature;
    }
    
    // Filter out signatures that we've already processed
    const existingSignatures = new Set(transactions.map(tx => tx.signature));
    const newSignatures = signatures.filter(sig => !existingSignatures.has(sig.signature));
    console.log(`Found ${newSignatures.length} new signatures to process`);
    
    // Process signatures in smaller batches with longer delays
    const batchSize = CONFIG.rateLimits.batchSize;
    const newTransactions = [];
    
    // Only process a limited number of signatures to avoid overwhelming the API
    const maxSignaturesToProcess = Math.min(newSignatures.length, CONFIG.rateLimits.maxRequestsPerRun);
    const signaturesToProcess = newSignatures.slice(0, maxSignaturesToProcess);
    
    if (signaturesToProcess.length < newSignatures.length) {
      console.log(`Limiting processing to ${maxSignaturesToProcess} signatures out of ${newSignatures.length} to avoid rate limits`);
    }
    
    for (let i = 0; i < signaturesToProcess.length; i += batchSize) {
      console.log(`Processing batch ${Math.floor(i/batchSize) + 1} of ${Math.ceil(signaturesToProcess.length/batchSize)}`);
      
      const batch = signaturesToProcess.slice(i, i + batchSize);
      
      // Process one signature at a time to better control rate limiting
      for (const sig of batch) {
        try {
          const txDetails = await getTransactionDetails(sig.signature);
          if (txDetails) {
            newTransactions.push(txDetails);
            
            // Update transactions array and save to file
            transactions.push(txDetails);
            saveTransactions(transactions);
          }
          // Add a small delay between each signature in the batch
          await setTimeout(2000);
        } catch (error) {
          console.error(`Error processing signature ${sig.signature}:`, error.message);
          // Continue with next signature
          continue;
        }
      }
      
      // Add a longer delay between batches
      if (i + batchSize < signaturesToProcess.length) {
        console.log(`Waiting ${CONFIG.rateLimits.batchDelay}ms between batches to respect rate limits...`);
        await setTimeout(CONFIG.rateLimits.batchDelay);
      }
    }
    
    // Update last fetch timestamp
    lastFetch.timestamp = new Date().toISOString();
    saveLastFetch(lastFetch);
    
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
    const transaction = new Transaction({
      signature,
      blockTime: txData.blockTime,
      slot: txData.slot,
      timestamp: new Date(txData.blockTime * 1000).toISOString(),
      meta: {}
    });
    
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

// Main function
async function main() {
  console.log('Starting transaction data collection...');
  
  try {
    // Fetch and process transactions
    await fetchTransactions();
    
    console.log('Transaction data collection completed successfully');
  } catch (error) {
    console.error('Error in transaction data collection:', error);
  }
}

// Run the main function
main().catch(console.error); 