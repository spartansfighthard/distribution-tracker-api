const axios = require('axios');
const Transaction = require('../models/Transaction');
const { PublicKey } = require('@solana/web3.js');

// Constants
const HELIUS_RPC_URL = process.env.HELIUS_RPC_URL;
const DISTRIBUTION_WALLET = process.env.DISTRIBUTION_WALLET_ADDRESS;
const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';
const TAX_TOKEN_MINT = process.env.TAX_TOKEN_MINT || '';

// Helper function to determine if a transaction is a tax collection
const isTaxCollection = (transaction) => {
  // Check if this is an incoming transaction to the distribution wallet
  const isIncoming = transaction.tokenTransfers?.some(transfer => 
    transfer.toUserAccount === DISTRIBUTION_WALLET
  );
  
  // Check if this is a SOL transfer to the distribution wallet
  const isSolIncoming = transaction.nativeTransfers?.some(transfer => 
    transfer.toUserAccount === DISTRIBUTION_WALLET
  );
  
  // If we have a specific tax token mint, check if the incoming transfer is for that token
  if (TAX_TOKEN_MINT && isIncoming) {
    return transaction.tokenTransfers?.some(transfer => 
      transfer.toUserAccount === DISTRIBUTION_WALLET && 
      transfer.mint === TAX_TOKEN_MINT
    );
  }
  
  return isIncoming || isSolIncoming;
};

// Helper function to determine if a transaction is a tax distribution
const isTaxDistribution = (transaction) => {
  // Check if this is an outgoing transaction from the distribution wallet
  const isOutgoing = transaction.tokenTransfers?.some(transfer => 
    transfer.fromUserAccount === DISTRIBUTION_WALLET
  );
  
  // Check if this is a SOL transfer from the distribution wallet
  const isSolOutgoing = transaction.nativeTransfers?.some(transfer => 
    transfer.fromUserAccount === DISTRIBUTION_WALLET
  );
  
  // If we have a specific tax token mint, check if the outgoing transfer is for that token
  if (TAX_TOKEN_MINT && isOutgoing) {
    return transaction.tokenTransfers?.some(transfer => 
      transfer.fromUserAccount === DISTRIBUTION_WALLET && 
      transfer.mint === TAX_TOKEN_MINT
    );
  }
  
  return isOutgoing || isSolOutgoing;
};

// Helper function to detect if a transaction is a swap
const isSwapTransaction = (transaction) => {
  // Check for common swap program IDs
  const swapProgramIds = [
    'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter
    'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB', // Jupiter v4
    'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', // Orca Whirlpool
    '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP', // Raydium
    // Add other known swap program IDs here
  ];
  
  // Check if any of the accounts in the transaction match known swap programs
  return transaction.accountData?.some(account => 
    swapProgramIds.includes(account.account)
  ) || false;
};

// Helper function to process a transaction and save it to the database
const processTransaction = async (transaction) => {
  try {
    // Check if transaction already exists in the database
    const existingTransaction = Transaction.findOne({ signature: transaction.signature });
    if (existingTransaction) {
      return null; // Skip if already processed
    }
    
    // Determine transaction type
    let type = 'other';
    if (isTaxCollection(transaction)) {
      type = 'collection';
    } else if (isTaxDistribution(transaction)) {
      type = 'distribution';
    }
    
    // Check if this is a swap transaction
    const isSwap = isSwapTransaction(transaction);
    
    // Extract token amounts
    const tokenAmount = transaction.tokenTransfers?.reduce((total, transfer) => {
      if (transfer.toUserAccount === DISTRIBUTION_WALLET) {
        return total + parseFloat(transfer.tokenAmount);
      }
      if (transfer.fromUserAccount === DISTRIBUTION_WALLET) {
        return total - parseFloat(transfer.tokenAmount);
      }
      return total;
    }, 0) || 0;
    
    // Extract SOL amounts (in lamports, convert to SOL)
    const solAmount = transaction.nativeTransfers?.reduce((total, transfer) => {
      if (transfer.toUserAccount === DISTRIBUTION_WALLET) {
        return total + (parseFloat(transfer.amount) / 1_000_000_000); // Convert lamports to SOL
      }
      if (transfer.fromUserAccount === DISTRIBUTION_WALLET) {
        return total - (parseFloat(transfer.amount) / 1_000_000_000); // Convert lamports to SOL
      }
      return total;
    }, 0) || 0;
    
    // Determine token mint
    let tokenMint = null;
    if (transaction.tokenTransfers && transaction.tokenTransfers.length > 0) {
      // If we have a specific tax token mint and this is a tax transaction, prioritize that token
      if (TAX_TOKEN_MINT && (type === 'collection' || type === 'distribution')) {
        const taxTokenTransfer = transaction.tokenTransfers.find(transfer => 
          transfer.mint === TAX_TOKEN_MINT
        );
        
        if (taxTokenTransfer) {
          tokenMint = TAX_TOKEN_MINT;
        } else {
          tokenMint = transaction.tokenTransfers[0].mint;
        }
      } else {
        tokenMint = transaction.tokenTransfers[0].mint;
      }
    } else if (solAmount !== 0) {
      tokenMint = NATIVE_SOL_MINT; // Use native SOL mint address for SOL transfers
    }
    
    // Check if this is a tax token transaction
    const isTaxToken = tokenMint === TAX_TOKEN_MINT;
    
    // Safely handle timestamp conversion
    let timestamp;
    try {
      // Check if timestamp exists and is valid
      if (transaction.timestamp && !isNaN(transaction.timestamp)) {
        timestamp = new Date(transaction.timestamp * 1000).toISOString();
      } else {
        // Use current time if timestamp is invalid
        timestamp = new Date().toISOString();
      }
    } catch (error) {
      console.warn(`Invalid timestamp for transaction ${transaction.signature}, using current time`);
      timestamp = new Date().toISOString();
    }
    
    // Create new transaction record
    const newTransaction = {
      signature: transaction.signature,
      timestamp: timestamp,
      type,
      tokenAmount,
      tokenMint,
      solAmount,
      fromAddress: transaction.tokenTransfers?.[0]?.fromUserAccount || 
                  transaction.nativeTransfers?.[0]?.fromUserAccount || 
                  transaction.feePayer,
      toAddress: transaction.tokenTransfers?.[0]?.toUserAccount || 
                transaction.nativeTransfers?.[0]?.toUserAccount || 
                null,
      isSwap,
      isTaxToken,
      // Store minimal transaction data to save space
      rawData: {
        signature: transaction.signature,
        timestamp: transaction.timestamp,
        feePayer: transaction.feePayer,
        tokenTransfers: transaction.tokenTransfers,
        nativeTransfers: transaction.nativeTransfers
      }
    };
    
    // Save to database
    Transaction.save(newTransaction);
    return newTransaction;
  } catch (error) {
    console.error(`Error processing transaction ${transaction.signature}:`, error);
    return null;
  }
};

// Fetch transactions from Helius API
const fetchTransactions = async (limit = 100, beforeSignature = null) => {
  try {
    const response = await axios.post(HELIUS_RPC_URL, {
      jsonrpc: '2.0',
      id: 'my-id',
      method: 'getSignaturesForAddress',
      params: [
        DISTRIBUTION_WALLET,
        {
          limit,
          before: beforeSignature
        }
      ]
    });
    
    if (response.data.error) {
      throw new Error(`Helius API error: ${response.data.error.message}`);
    }
    
    return response.data.result || [];
  } catch (error) {
    console.error('Error fetching transactions from Helius:', error);
    throw error;
  }
};

// Fetch transaction details from Helius API
const fetchTransactionDetails = async (signature) => {
  try {
    const response = await axios.post(HELIUS_RPC_URL, {
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
    });
    
    if (response.data.error) {
      throw new Error(`Helius API error: ${response.data.error.message}`);
    }
    
    return response.data.result;
  } catch (error) {
    console.error(`Error fetching transaction details for ${signature}:`, error);
    return null; // Return null instead of throwing to allow processing to continue
  }
};

// Fetch and process transactions
const fetchAndProcessTransactions = async (limit = 50) => {
  try {
    // Get the most recent transaction we've processed
    const transactions = Transaction.find({}, { timestamp: -1 }, 1);
    const latestTransaction = transactions.length > 0 ? transactions[0] : null;
    const beforeSignature = latestTransaction ? latestTransaction.signature : null;
    
    console.log(`Looking for transactions ${beforeSignature ? 'before ' + beforeSignature : '(initial fetch)'}`);
    
    // Fetch transaction signatures
    const signatures = await fetchTransactions(limit, beforeSignature);
    console.log(`Fetched ${signatures.length} transaction signatures`);
    
    if (signatures.length === 0) {
      console.log('No new transaction signatures found');
      return 0;
    }
    
    // Process each transaction
    let processed = 0;
    let skipped = 0;
    let errors = 0;
    
    for (const sigData of signatures) {
      try {
        console.log(`Processing signature: ${sigData.signature}`);
        
        // Check if transaction already exists in the database
        const existingTransaction = Transaction.findOne({ signature: sigData.signature });
        if (existingTransaction) {
          console.log(`Transaction ${sigData.signature} already exists, skipping`);
          skipped++;
          continue;
        }
        
        const txDetails = await fetchTransactionDetails(sigData.signature);
        if (!txDetails) {
          console.log(`No transaction details found for ${sigData.signature}`);
          continue;
        }
        
        console.log(`Got transaction details for ${sigData.signature}, processing...`);
        
        // Create a simplified transaction object for processing
        const simplifiedTx = {
          signature: sigData.signature,
          timestamp: txDetails.blockTime || (Date.now() / 1000), // Use blockTime or current time
          feePayer: txDetails.transaction?.message?.accountKeys?.[0] || null,
          tokenTransfers: [],
          nativeTransfers: [],
          accountData: []
        };
        
        // Extract token transfers if available
        if (txDetails.meta?.postTokenBalances && txDetails.meta?.preTokenBalances) {
          const preBalances = txDetails.meta.preTokenBalances;
          const postBalances = txDetails.meta.postTokenBalances;
          
          // Map account indices to addresses
          const accountKeys = txDetails.transaction.message.accountKeys.map(key => 
            typeof key === 'string' ? key : key.pubkey
          );
          
          // Process token transfers
          for (const postBalance of postBalances) {
            const preBalance = preBalances.find(b => 
              b.accountIndex === postBalance.accountIndex && 
              b.mint === postBalance.mint
            );
            
            if (preBalance) {
              const preAmount = BigInt(preBalance.uiTokenAmount.amount || 0);
              const postAmount = BigInt(postBalance.uiTokenAmount.amount || 0);
              const diff = Number(postAmount - preAmount) / (10 ** (postBalance.uiTokenAmount.decimals || 0));
              
              if (diff !== 0) {
                const accountAddress = accountKeys[postBalance.accountIndex];
                
                simplifiedTx.tokenTransfers.push({
                  mint: postBalance.mint,
                  fromUserAccount: diff < 0 ? accountAddress : null,
                  toUserAccount: diff > 0 ? accountAddress : null,
                  tokenAmount: Math.abs(diff)
                });
              }
            }
          }
        }
        
        // Extract SOL transfers if available
        if (txDetails.meta?.preBalances && txDetails.meta?.postBalances) {
          const preBalances = txDetails.meta.preBalances;
          const postBalances = txDetails.meta.postBalances;
          const accountKeys = txDetails.transaction.message.accountKeys.map(key => 
            typeof key === 'string' ? key : key.pubkey
          );
          
          for (let i = 0; i < preBalances.length; i++) {
            const diff = postBalances[i] - preBalances[i];
            if (diff !== 0) {
              simplifiedTx.nativeTransfers.push({
                fromUserAccount: diff < 0 ? accountKeys[i] : null,
                toUserAccount: diff > 0 ? accountKeys[i] : null,
                amount: Math.abs(diff)
              });
            }
          }
        }
        
        // Extract account data
        if (txDetails.transaction?.message?.accountKeys) {
          simplifiedTx.accountData = txDetails.transaction.message.accountKeys.map((key, index) => {
            const address = typeof key === 'string' ? key : key.pubkey;
            return {
              account: address,
              index
            };
          });
        }
        
        console.log(`Simplified transaction: ${JSON.stringify(simplifiedTx, null, 2)}`);
        
        const result = await processTransaction(simplifiedTx);
        if (result) {
          processed++;
          console.log(`Successfully processed transaction ${sigData.signature}`);
        } else {
          skipped++;
          console.log(`Skipped transaction ${sigData.signature}`);
        }
      } catch (error) {
        console.error(`Error processing signature ${sigData.signature}:`, error);
        errors++;
        // Continue with next transaction
      }
    }
    
    console.log(`Processed ${processed} new transactions, skipped ${skipped}, errors ${errors}`);
    return processed;
  } catch (error) {
    console.error('Error in fetchAndProcessTransactions:', error);
    throw error;
  }
};

// Initialize the service
const init = async () => {
  console.log('Initializing Helius service...');
  
  // Check for required environment variables
  if (!process.env.HELIUS_API_KEY) {
    console.error('HELIUS_API_KEY is not set in environment variables');
    throw new Error('HELIUS_API_KEY is not set in environment variables');
  }
  
  if (!process.env.DISTRIBUTION_WALLET_ADDRESS) {
    console.error('DISTRIBUTION_WALLET_ADDRESS is not set in environment variables');
    throw new Error('DISTRIBUTION_WALLET_ADDRESS is not set in environment variables');
  }
  
  console.log('Helius service initialized');
};

// Get tax statistics (placeholder for API compatibility)
const getTaxStats = async () => {
  return {
    totalSolDistributed: 0,
    solBalance: 0
  };
};

// Get SOL statistics (placeholder for API compatibility)
const getSolStats = async () => {
  return {
    totalReceived: 0,
    totalSent: 0,
    balance: 0,
    recentTransactions: []
  };
};

// Get tax statistics
const getTaxStatsFull = async () => {
  try {
    // Get total collected
    const totalCollected = Transaction.aggregate([
      { $match: { type: 'collection' } },
      { $group: { _id: null, total: { $sum: 'tokenAmount' } } }
    ]);
    
    // Get total distributed
    const totalDistributed = Transaction.aggregate([
      { $match: { type: 'distribution' } },
      { $group: { _id: null, total: { $sum: 'tokenAmount' } } }
    ]);
    
    // Get total SOL distributed
    const totalSolDistributed = Transaction.aggregate([
      { $match: { type: 'distribution', tokenMint: NATIVE_SOL_MINT } },
      { $group: { _id: null, total: { $sum: 'solAmount' } } }
    ]);
    
    // Get tax token stats if configured
    let taxTokenStats = null;
    if (TAX_TOKEN_MINT) {
      const taxTokenCollected = Transaction.aggregate([
        { $match: { type: 'collection', tokenMint: TAX_TOKEN_MINT } },
        { $group: { _id: null, total: { $sum: 'tokenAmount' } } }
      ]);
      
      const taxTokenDistributed = Transaction.aggregate([
        { $match: { type: 'distribution', tokenMint: TAX_TOKEN_MINT } },
        { $group: { _id: null, total: { $sum: 'tokenAmount' } } }
      ]);
      
      taxTokenStats = {
        tokenMint: TAX_TOKEN_MINT,
        collected: taxTokenCollected[0]?.total || 0,
        distributed: taxTokenDistributed[0]?.total || 0,
        balance: (taxTokenCollected[0]?.total || 0) - (taxTokenDistributed[0]?.total || 0)
      };
    }
    
    // Get collection by token mint
    const collectionByMint = Transaction.aggregate([
      { $match: { type: 'collection' } },
      { $group: { 
          _id: 'tokenMint', 
          total: { $sum: 'tokenAmount' },
          count: { $count: 'tokenMint' }
        } 
      },
      { $sort: { total: -1 } }
    ]);
    
    // Get recent transactions
    const recentTransactions = Transaction.find({ 
      type: { $in: ['collection', 'distribution'] } 
    }, { timestamp: -1 }, 10);
    
    // Sort transactions by timestamp (newest first)
    const sortedRecentTransactions = recentTransactions.sort((a, b) => {
      return new Date(b.timestamp) - new Date(a.timestamp);
    });
    
    return {
      totalCollected: totalCollected[0]?.total || 0,
      totalDistributed: totalDistributed[0]?.total || 0,
      totalSolDistributed: Math.abs(totalSolDistributed[0]?.total || 0),
      balance: (totalCollected[0]?.total || 0) - (totalDistributed[0]?.total || 0),
      taxTokenStats,
      collectionByMint,
      recentTransactions: sortedRecentTransactions
    };
  } catch (error) {
    console.error('Error getting tax stats:', error);
    throw error;
  }
};

// Get stats for a specific token mint
const getTokenMintStats = async (tokenMint) => {
  try {
    // Get total collected for this mint
    const totalCollected = Transaction.aggregate([
      { $match: { type: 'collection', tokenMint } },
      { $group: { _id: null, total: { $sum: 'tokenAmount' } } }
    ]);
    
    // Get total distributed for this mint
    const totalDistributed = Transaction.aggregate([
      { $match: { type: 'distribution', tokenMint } },
      { $group: { _id: null, total: { $sum: 'tokenAmount' } } }
    ]);
    
    // Get recent transactions for this mint
    const recentTransactions = Transaction.find({ 
      tokenMint,
      type: { $in: ['collection', 'distribution'] } 
    }, { timestamp: -1 }, 10);
    
    // Sort transactions by timestamp (newest first)
    const sortedRecentTransactions = recentTransactions.sort((a, b) => {
      return new Date(b.timestamp) - new Date(a.timestamp);
    });
    
    // Check if this is the tax token
    const isTaxToken = tokenMint === TAX_TOKEN_MINT;
    
    return {
      tokenMint,
      isTaxToken,
      totalCollected: totalCollected[0]?.total || 0,
      totalDistributed: totalDistributed[0]?.total || 0,
      balance: (totalCollected[0]?.total || 0) - (totalDistributed[0]?.total || 0),
      recentTransactions: sortedRecentTransactions
    };
  } catch (error) {
    console.error(`Error getting stats for token mint ${tokenMint}:`, error);
    throw error;
  }
};

// Get tax token statistics
const getTaxTokenStats = async () => {
  if (!TAX_TOKEN_MINT) {
    throw new Error('TAX_TOKEN_MINT_ADDRESS is not set in environment variables');
  }
  
  return getTokenMintStats(TAX_TOKEN_MINT);
};

// Format number with commas and decimal places
const formatNumber = (num, decimals = 7) => {  // Changed from 6 to 7 decimals
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
};

module.exports = {
  fetchAndProcessTransactions,
  getTaxStats,
  getTokenMintStats,
  getTaxTokenStats,
  getSolStats,
  fetchTransactions,
  fetchTransactionDetails,
  NATIVE_SOL_MINT,
  TAX_TOKEN_MINT,
  init,
  getTaxStatsFull
}; 