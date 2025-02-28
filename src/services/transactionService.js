const axios = require('axios');
const heliusService = require('./heliusService');

// In-memory cache for serverless environment
let transactionCache = {
  lastUpdated: 0,
  transactions: [],
  stats: null
};

// Function to fetch complete transaction history from Helius API and save it
const fetchHeliusTransactions = async (walletAddress, forceRefresh = false) => {
  try {
    console.log(`Fetching complete transaction history for ${walletAddress} from Helius API...`);
    
    const heliusApiKey = process.env.HELIUS_API_KEY;
    if (!heliusApiKey) {
      throw new Error('HELIUS_API_KEY is not set in environment variables');
    }
    
    // Check if we have cached data
    if (!forceRefresh && transactionCache.lastUpdated > 0) {
      // If data is less than 1 hour old, use it
      const oneHourAgo = Date.now() - (60 * 60 * 1000);
      if (transactionCache.lastUpdated > oneHourAgo && transactionCache.stats) {
        console.log(`Using cached data from ${new Date(transactionCache.lastUpdated).toLocaleString()}`);
        return transactionCache.stats;
      }
    }
    
    // Get current SOL balance
    const balanceUrl = `https://api.helius.xyz/v0/addresses/${walletAddress}/balances?api-key=${heliusApiKey}`;
    const balanceResponse = await axios.get(balanceUrl, { timeout: 10000 });
    
    if (!balanceResponse.data || !balanceResponse.data.nativeBalance) {
      console.error('Invalid balance response from Helius:', balanceResponse.data);
      throw new Error('Failed to get wallet balance from Helius');
    }
    
    const currentBalance = balanceResponse.data.nativeBalance / 10**9; // Convert lamports to SOL
    console.log(`Current SOL balance from Helius: ${currentBalance} SOL`);
    
    // Fetch all transactions (paginated)
    let allTransactions = [];
    let hasMore = true;
    let before = '';
    const limit = 100; // Max per request
    
    while (hasMore) {
      console.log(`Fetching transactions from Helius: limit=${limit}${before ? ', before=' + before : ''}`);
      
      // Construct the URL with pagination parameters
      let url = `https://api.helius.xyz/v0/addresses/${walletAddress}/transactions?api-key=${heliusApiKey}&limit=${limit}`;
      if (before) {
        url += `&before=${before}`;
      }
      
      const response = await axios.get(url, { timeout: 15000 });
      
      if (response.data && Array.isArray(response.data) && response.data.length > 0) {
        console.log(`Received ${response.data.length} transactions from Helius`);
        allTransactions = [...allTransactions, ...response.data];
        
        // If we got fewer results than the limit, we've reached the end
        if (response.data.length < limit) {
          hasMore = false;
        } else {
          // Get the signature of the last transaction for pagination
          const lastTx = response.data[response.data.length - 1];
          before = lastTx.signature;
        }
        
        // Add a small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      } else {
        console.log('No more transactions received from Helius or invalid response');
        hasMore = false;
      }
      
      // Safety check - if we've fetched a lot of transactions, stop to avoid excessive API calls
      if (allTransactions.length >= 1000) {
        console.log('Reached maximum transaction fetch limit (1000)');
        hasMore = false;
      }
    }
    
    console.log(`Total transactions fetched from Helius: ${allTransactions.length}`);
    
    // Process transactions to calculate SOL transfers
    let totalSolSent = 0;
    let totalSolReceived = 0;
    let totalTaxReceived = 0;
    let outgoingTransactions = [];
    let taxIncomingTransactions = [];
    
    // Known system program addresses to exclude
    const systemAddresses = [
      '11111111111111111111111111111111', // System Program
      'SysvarRent111111111111111111111111111111111', // Rent Sysvar
      'SysvarC1ock11111111111111111111111111111111', // Clock Sysvar
      'Vote111111111111111111111111111111111111111', // Vote Program
      'Stake11111111111111111111111111111111111111', // Stake Program
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // Token Program
      'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // Associated Token Account Program
      'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s', // Metaplex Token Metadata Program
    ];
    
    // Get the tax contract address from environment variables
    const taxContractAddress = process.env.TAX_CONTRACT_ADDRESS || '';
    console.log(`Tax contract address: ${taxContractAddress || 'Not set'}`);
    
    for (const tx of allTransactions) {
      try {
        // Check if this transaction has account data
        if (tx.accountData && Array.isArray(tx.accountData)) {
          // Find the distribution wallet in the account data
          const walletAccountData = tx.accountData.find(acc => 
            acc.account === walletAddress && acc.nativeBalanceChange !== undefined
          );
          
          if (walletAccountData) {
            const changeInSol = walletAccountData.nativeBalanceChange / 10**9; // Convert lamports to SOL
            
            if (changeInSol < 0) {
              // Negative change means SOL was sent out
              // Find the recipient(s) of the SOL
              const recipients = tx.accountData.filter(acc => 
                acc.account !== walletAddress && 
                acc.nativeBalanceChange > 0 &&
                !systemAddresses.includes(acc.account)
              );
              
              // Calculate the total SOL sent to actual users (not system programs)
              let solSentToUsers = 0;
              let recipientAddresses = [];
              
              for (const recipient of recipients) {
                const solReceived = recipient.nativeBalanceChange / 10**9;
                solSentToUsers += solReceived;
                recipientAddresses.push(recipient.account);
              }
              
              // Only count if we actually sent SOL to users
              if (solSentToUsers > 0) {
                totalSolSent += solSentToUsers;
                
                // Add to outgoing transactions list
                outgoingTransactions.push({
                  signature: tx.signature,
                  solAmount: solSentToUsers,
                  timestamp: tx.timestamp ? new Date(tx.timestamp * 1000) : new Date(),
                  type: 'distribution',
                  recipients: recipientAddresses
                });
                
                console.log(`Found user distribution: ${solSentToUsers} SOL to ${recipientAddresses.join(', ')}`);
              } else {
                console.log(`Skipping transaction ${tx.signature} - no SOL sent to users (likely fees or system transaction)`);
              }
            } else if (changeInSol > 0) {
              // Positive change means SOL was received
              totalSolReceived += changeInSol;
              
              // Check if this is from the tax contract
              const sender = tx.accountData.find(acc => 
                acc.account !== walletAddress && 
                acc.nativeBalanceChange < 0
              );
              
              const isTaxTransaction = sender && taxContractAddress && 
                (sender.account === taxContractAddress || 
                 tx.description?.includes('tax') || 
                 tx.instructions?.some(inst => inst.programId === taxContractAddress));
              
              if (isTaxTransaction) {
                totalTaxReceived += changeInSol;
                
                // Add to tax incoming transactions list
                taxIncomingTransactions.push({
                  signature: tx.signature,
                  solAmount: changeInSol,
                  timestamp: tx.timestamp ? new Date(tx.timestamp * 1000) : new Date(),
                  type: 'tax_collection',
                  sender: sender.account
                });
                
                console.log(`Found tax income: ${changeInSol} SOL from ${sender.account}`);
              }
            }
          }
        }
      } catch (error) {
        console.error(`Error processing transaction ${tx.signature}:`, error.message);
        // Continue with next transaction
      }
    }
    
    console.log(`Calculated from Helius: Total SOL sent to users=${totalSolSent}, Total SOL received=${totalSolReceived}, Total tax received=${totalTaxReceived}`);
    
    // Sort transactions by timestamp (newest first)
    outgoingTransactions.sort((a, b) => b.timestamp - a.timestamp);
    taxIncomingTransactions.sort((a, b) => b.timestamp - a.timestamp);
    
    // Create stats object
    const stats = {
      totalSolSent,
      totalSolReceived,
      totalTaxReceived,
      currentBalance,
      transactionCount: allTransactions.length,
      outgoingTransactions: outgoingTransactions.slice(0, 10), // Get 10 most recent outgoing transactions
      taxIncomingTransactions: taxIncomingTransactions.slice(0, 10) // Get 10 most recent tax transactions
    };
    
    // Save to in-memory cache
    transactionCache = {
      lastUpdated: Date.now(),
      transactions: allTransactions,
      stats: stats
    };
    
    console.log(`Cached transaction data in memory`);
    
    return stats;
  } catch (error) {
    console.error('Error fetching from Helius API:', error.message);
    if (error.response) {
      console.error('Helius API response status:', error.response.status);
      console.error('Helius API response data:', error.response.data);
    }
    throw new Error(`Failed to fetch transaction history from Helius: ${error.message}`);
  }
};

// Get wallet statistics
const getWalletStats = async (walletAddress = process.env.DISTRIBUTION_WALLET_ADDRESS) => {
  try {
    return await fetchHeliusTransactions(walletAddress);
  } catch (error) {
    console.error('Error getting wallet stats:', error.message);
    throw error;
  }
};

// Get distribution transactions
const getDistributionTransactions = async (walletAddress = process.env.DISTRIBUTION_WALLET_ADDRESS) => {
  try {
    const stats = await fetchHeliusTransactions(walletAddress);
    return {
      totalSolSent: stats.totalSolSent,
      transactionCount: stats.transactionCount,
      transactions: stats.outgoingTransactions
    };
  } catch (error) {
    console.error('Error getting distribution transactions:', error.message);
    throw error;
  }
};

// Get tax transactions
const getTaxTransactions = async (walletAddress = process.env.DISTRIBUTION_WALLET_ADDRESS) => {
  try {
    const stats = await fetchHeliusTransactions(walletAddress);
    return {
      totalTaxReceived: stats.totalTaxReceived,
      transactionCount: stats.transactionCount,
      transactions: stats.taxIncomingTransactions
    };
  } catch (error) {
    console.error('Error getting tax transactions:', error.message);
    throw error;
  }
};

// Force refresh historical data
const refreshHistoricalData = async (walletAddress = process.env.DISTRIBUTION_WALLET_ADDRESS) => {
  try {
    return await fetchHeliusTransactions(walletAddress, true);
  } catch (error) {
    console.error('Error refreshing historical data:', error.message);
    throw error;
  }
};

module.exports = {
  fetchHeliusTransactions,
  getWalletStats,
  getDistributionTransactions,
  getTaxTransactions,
  refreshHistoricalData
}; 