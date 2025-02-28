const axios = require('axios');
const Transaction = require('../models/Transaction');
const { PublicKey } = require('@solana/web3.js');
const fileStorage = require('./fileStorage');

// Constants
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const HELIUS_RPC_URL = process.env.HELIUS_RPC_URL;
const DISTRIBUTION_WALLET_ADDRESS = process.env.DISTRIBUTION_WALLET_ADDRESS;
const TAX_TOKEN_MINT_ADDRESS = process.env.TAX_TOKEN_MINT_ADDRESS;
const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';

// Log configuration for debugging
console.log(`Helius configuration:
  - API Key: ${HELIUS_API_KEY ? '✓ Set' : '✗ Not set'}
  - RPC URL: ${HELIUS_RPC_URL ? '✓ Set' : '✗ Not set'}
  - Distribution Wallet: ${DISTRIBUTION_WALLET_ADDRESS ? '✓ Set' : '✗ Not set'}
  - Tax Token Mint: ${TAX_TOKEN_MINT_ADDRESS ? '✓ Set' : '✗ Not set'}`
);

// Initialize service
async function initialize() {
  try {
    console.log('Initializing Helius service...');
    console.log(`Distribution wallet: ${DISTRIBUTION_WALLET_ADDRESS}`);
    console.log(`Tax token mint: ${TAX_TOKEN_MINT_ADDRESS || 'Not set'}`);
    
    // Check if we have the required environment variables
    if (!HELIUS_API_KEY || !HELIUS_RPC_URL || !DISTRIBUTION_WALLET_ADDRESS) {
      console.error('Missing required environment variables for Helius service');
      return false;
    }
    
    // Load last fetch timestamp from storage
    const lastFetchData = await fileStorage.readData('lastFetch.json');
    if (lastFetchData && lastFetchData.timestamp) {
      Transaction.setLastFetchTimestamp(lastFetchData.timestamp);
      console.log(`Loaded last fetch timestamp: ${lastFetchData.timestamp}`);
    } else {
      // Set default last fetch timestamp (24 hours ago)
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);
      Transaction.setLastFetchTimestamp(oneDayAgo.toISOString());
      console.log(`Set default last fetch timestamp: ${oneDayAgo.toISOString()}`);
    }
    
    return true;
  } catch (error) {
    console.error('Error initializing Helius service:', error);
    return false;
  }
}

// Fetch transactions from Helius API
async function fetchTransactions() {
  try {
    console.log('Fetching transactions from Helius API...');
    
    // Get last fetch timestamp
    const lastFetchTimestamp = Transaction.getLastFetchTimestamp();
    console.log(`Last fetch timestamp: ${lastFetchTimestamp}`);
    
    // Prepare request data
    const requestData = {
      jsonrpc: '2.0',
      id: 'my-id',
      method: 'getSignaturesForAddress',
      params: [
        DISTRIBUTION_WALLET_ADDRESS,
        {
          limit: 100
        }
      ]
    };
    
    // Make request to Helius API
    const response = await axios.post(HELIUS_RPC_URL, requestData);
    
    // Check if response is valid
    if (!response.data || !response.data.result) {
      console.error('Invalid response from Helius API:', response.data);
      return [];
    }
    
    // Get signatures from response
    const signatures = response.data.result;
    console.log(`Fetched ${signatures.length} signatures`);
    
    // Process each signature
    const transactions = [];
    for (const sig of signatures) {
      // Skip if transaction is already processed
      const existingTx = await Transaction.findOne({ signature: sig.signature });
      if (existingTx) {
        console.log(`Transaction already exists: ${sig.signature}`);
        continue;
      }
      
      // Get transaction details
      const txDetails = await getTransactionDetails(sig.signature);
      if (txDetails) {
        transactions.push(txDetails);
      }
    }
    
    // Update last fetch timestamp
    const now = new Date().toISOString();
    Transaction.setLastFetchTimestamp(now);
    await fileStorage.writeData('lastFetch.json', { timestamp: now });
    
    console.log(`Processed ${transactions.length} new transactions`);
    return transactions;
  } catch (error) {
    console.error('Error fetching transactions:', error);
    return [];
  }
}

// Get transaction details from Helius API
async function getTransactionDetails(signature) {
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
    const response = await axios.post(HELIUS_RPC_URL, requestData);
    
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
      // Save transaction to database
      const txModel = new Transaction(transaction);
      await txModel.save();
      return transaction;
    }
    
    return null;
  } catch (error) {
    console.error(`Error getting transaction details for ${signature}:`, error);
    return null;
  }
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
    // This is a simplified version - you'll need to implement the full logic
    // based on your specific requirements
    
    // Example: Check if transaction is a SOL transfer
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
async function getStats() {
  try {
    console.log('Getting transaction statistics...');
    
    // Get all transactions
    const allTransactions = await Transaction.getAll();
    
    // Calculate statistics
    const stats = {
      totalTransactions: allTransactions.length,
      transactionsByType: {},
      transactionsByToken: {},
      totalAmountByToken: {}
    };
    
    // Process each transaction
    for (const tx of allTransactions) {
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

// Get tax statistics
async function getTaxStats() {
  try {
    const allTransactions = await Transaction.find().exec();
    
    const collected = allTransactions.filter(tx => tx.type === 'collection');
    const distributed = allTransactions.filter(tx => tx.type === 'distribution');
    
    const totalCollected = collected.reduce((sum, tx) => sum + tx.amount, 0);
    const totalDistributed = distributed.reduce((sum, tx) => sum + tx.amount, 0);
    
    return {
      totalCollected,
      totalDistributed,
      balance: totalCollected - totalDistributed,
      collectionCount: collected.length,
      distributionCount: distributed.length,
      lastUpdated: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error getting tax stats:', error.message);
    throw error;
  }
}

// Get tax token statistics
async function getTaxTokenStats() {
  try {
    if (!TAX_TOKEN_MINT_ADDRESS) {
      throw new Error('TAX_TOKEN_MINT_ADDRESS is not set in environment variables');
    }
    
    const taxTokenTxs = await Transaction.find({ token: TAX_TOKEN_MINT_ADDRESS }).exec();
    
    const collected = taxTokenTxs.filter(tx => tx.type === 'collection');
    const distributed = taxTokenTxs.filter(tx => tx.type === 'distribution');
    
    const totalCollected = collected.reduce((sum, tx) => sum + tx.amount, 0);
    const totalDistributed = distributed.reduce((sum, tx) => sum + tx.amount, 0);
    
    return {
      token: TAX_TOKEN_MINT_ADDRESS,
      totalCollected,
      totalDistributed,
      balance: totalCollected - totalDistributed,
      collectionCount: collected.length,
      distributionCount: distributed.length,
      lastUpdated: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error getting tax token stats:', error.message);
    throw error;
  }
}

// Get token mint statistics
async function getTokenMintStats(tokenMint) {
  try {
    const tokenTxs = await Transaction.find({ token: tokenMint }).exec();
    
    const collected = tokenTxs.filter(tx => tx.type === 'collection');
    const distributed = tokenTxs.filter(tx => tx.type === 'distribution');
    
    const totalCollected = collected.reduce((sum, tx) => sum + tx.amount, 0);
    const totalDistributed = distributed.reduce((sum, tx) => sum + tx.amount, 0);
    
    return {
      tokenMint,
      totalCollected,
      totalDistributed,
      balance: totalCollected - totalDistributed,
      collectionCount: collected.length,
      distributionCount: distributed.length,
      lastUpdated: new Date().toISOString()
    };
  } catch (error) {
    console.error(`Error getting stats for token mint ${tokenMint}:`, error.message);
    throw error;
  }
}

// Get SOL statistics
async function getSolStats() {
  return getTokenMintStats(NATIVE_SOL_MINT);
}

// Export functions
module.exports = {
  initialize,
  fetchTransactions,
  getTransactionDetails,
  getStats,
  getTaxStats,
  getTaxTokenStats,
  getTokenMintStats,
  getSolStats
}; 