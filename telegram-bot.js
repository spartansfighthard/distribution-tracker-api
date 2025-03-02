// Standalone Telegram Bot for SOL Distribution Tracker
// This bot connects to the Vercel-hosted API

require('dotenv').config({ path: '.env.bot' });
const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');

// API base URL
const API_BASE_URL = process.env.API_BASE_URL || 'https://distribution-tracker-api.vercel.app';

// Telegram bot token
const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is not defined in .env.bot file');
  process.exit(1);
}

// Add this near the top of the file, after the imports but before bot initialization
const instanceId = Date.now().toString();
console.log(`Starting bot instance with ID: ${instanceId}`);

// Create a bot instance
const bot = new TelegramBot(token, { 
  polling: {
    params: {
      timeout: 30,
      allowed_updates: ["message", "callback_query"],
      offset: -1
    }
  }
});

// Helper function to format SOL amounts
function formatSol(lamports) {
  // Handle string inputs (API returns strings)
  if (typeof lamports === 'string') {
    // Convert directly if it's already in SOL format (small decimal)
    if (lamports.includes('.')) {
      const solValue = parseFloat(lamports);
      return solValue.toLocaleString('en-US', { 
        minimumFractionDigits: 2,
        maximumFractionDigits: 9 
      });
    }
    // Convert from lamports if it's a large integer string
    lamports = parseInt(lamports, 10);
  }
  
  // Original conversion from lamports to SOL
  const sol = lamports / 1000000000;
  return sol.toLocaleString('en-US', { 
    minimumFractionDigits: 2,
    maximumFractionDigits: 9 
  });
}

// Helper function to fetch data from API
async function fetchFromAPI(endpoint) {
  try {
    // Add API key to the request if available
    const apiKey = process.env.API_KEY;
    const headers = {
      'User-Agent': 'TelegramBot',
    };
    
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
    }
    
    const response = await fetch(`${API_BASE_URL}${endpoint}`, { headers });
    if (!response.ok) {
      throw new Error(`API returned ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`Error fetching from ${endpoint}:`, error);
    throw error;
  }
}

// Fetch stats with a limit parameter to avoid timeouts
async function fetchStats() {
  try {
    // Add API key to the request if available
    const apiKey = process.env.API_KEY;
    const headers = {
      'User-Agent': 'TelegramBot',
    };
    
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
    }
    
    const response = await fetch(`${API_BASE_URL}/api/stats?limit=50`, { headers });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`API error: ${errorData.error?.message || 'Unknown error'}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching stats:', error.message);
    // Add more detailed error information
    if (error.message.includes('timeout') || error.message.includes('15s limit')) {
      throw new Error('The API is currently experiencing high load. Please try again later or use commands that don\'t require full statistics.');
    }
    throw error;
  }
}

// Update the fetchBalance function to include a limit parameter
async function fetchBalance() {
  try {
    // Add API key to the request if available
    const apiKey = process.env.API_KEY;
    const headers = {
      'User-Agent': 'TelegramBot',
    };
    
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
    }
    
    const response = await fetch(`${API_BASE_URL}/api/stats?limit=50`, { headers });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`API error: ${errorData.error?.message || 'Unknown error'}`);
    }
    const data = await response.json();
    return data.stats.currentSolBalance;
  } catch (error) {
    console.error('Error fetching balance:', error.message);
    throw error;
  }
}

// Update the fetchDistributed function to include a limit parameter
async function fetchDistributed() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/stats?limit=50`);
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`API error: ${errorData.error?.message || 'Unknown error'}`);
    }
    const data = await response.json();
    return data.stats.totalSolDistributed;
  } catch (error) {
    console.error('Error fetching distributed amount:', error.message);
    throw error;
  }
}

// Update the fetchTransactionCount function to include a limit parameter
async function fetchTransactionCount() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/stats?limit=50`);
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`API error: ${errorData.error?.message || 'Unknown error'}`);
    }
    const data = await response.json();
    return data.stats.totalTransactions;
  } catch (error) {
    console.error('Error fetching transaction count:', error.message);
    throw error;
  }
}

// Add a new function to fetch wallet data
async function fetchWalletData(walletAddress) {
  try {
    // Add API key to the request if available
    const apiKey = process.env.API_KEY;
    const headers = {
      'User-Agent': 'TelegramBot',
    };
    
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
    }
    
    const response = await fetch(`${API_BASE_URL}/api/wallet?address=${walletAddress}&limit=50`, { headers });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`API error: ${errorData.error?.message || 'Unknown error'}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching wallet data:', error.message);
    throw error;
  }
}

// Start command
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  
  bot.sendMessage(
    chatId,
    `👋 *Welcome to the SOL Distribution Tracker Bot!*\n\n` +
    `This bot helps you track SOL distributions from the main wallet.\n\n` +
    `📋 *Available commands:*\n` +
    `📊 /stats - Get current distribution statistics\n` +
    `💰 /balance - Check current wallet balance\n` +
    `👛 /balance <address> - Check any wallet's balance and rewards\n` +
    `💸 /distributed - View total distributed amount\n` +
    `📝 /transactions - Get recent transaction count\n` +
    `🔄 /refresh - Force refresh transaction data\n` +
    `❓ /help - Show this help message`,
    { parse_mode: 'Markdown' }
  );
});

// Help command
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  
  bot.sendMessage(
    chatId,
    `📚 *SOL Distribution Tracker Bot Commands*\n\n` +
    `📊 /stats - Get current distribution statistics\n` +
    `💰 /balance - Check current wallet balance\n` +
    `👛 /balance <address> - Check any wallet's balance and rewards\n` +
    `💸 /distributed - View total distributed amount\n` +
    `📝 /transactions - Get recent transaction count\n` +
    `🔄 /refresh - Force refresh transaction data\n` +
    `❓ /help - Show this help message\n\n` +
    `🌐 *Data Source:*\n` +
    `API URL: ${API_BASE_URL}`,
    { parse_mode: 'Markdown' }
  );
});

// Stats command
bot.onText(/\/stats/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    bot.sendMessage(chatId, '⏳ Fetching statistics...');
    
    const data = await fetchStats();
    
    if (!data.success) {
      throw new Error(data.error?.message || 'Unknown error');
    }
    
    const stats = data.stats;
    const counts = data.transactionCounts;
    
    const message = 
      `📊 *SOL DISTRIBUTION STATISTICS*\n\n` +
      `💸 *Financial Summary*\n` +
      `• 🔄 Total Distributed: ${formatSol(stats.totalSolDistributed)} SOL\n` +
      `• ⬇️ Total Received: ${formatSol(stats.totalSolReceived)} SOL\n` +
      `• 💎 Current Balance: ${formatSol(stats.currentSolBalance)} SOL\n\n` +
      `📝 *Transaction Summary*\n` +
      `• 🧮 Total Transactions: ${stats.totalTransactions}\n` +
      `• ↗️ Sent Transactions: ${counts.sentTransactions}\n` +
      `• ↘️ Received Transactions: ${counts.receivedTransactions}\n` +
      `• ⚡ SOL Transactions: ${counts.solTransactions}\n` +
      `• 💾 Stored Transactions: ${counts.totalStoredTransactions}\n\n` +
      `🔗 *Wallet Details*\n` +
      `• 🌐 [View Transactions on Solscan](${stats.solscanLink})\n\n` +
      `🔄 *Last Updated:* ${new Date(data.fetchedAt).toLocaleString()}`;
    
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown', disable_web_page_preview: true });
  } catch (error) {
    console.error('Error in stats command:', error.message);
    let errorMessage = '❌ Error fetching statistics. Please try again later.';
    
    // Provide more helpful message for timeout errors
    if (error.message.includes('high load') || error.message.includes('timeout') || error.message.includes('15s limit')) {
      errorMessage = '⏱️ *API Timeout Error*\n\nThe API is currently experiencing high load and reached the timeout limit. You can:\n\n• Try again later\n• Use simpler commands like /balance\n• Check the Solscan link directly';
    }
    
    bot.sendMessage(chatId, errorMessage, { parse_mode: 'Markdown' });
  }
});

// Update the Balance command to handle wallet address parameter
bot.onText(/\/balance(?:\s+([a-zA-Z0-9]{32,44}))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const walletAddress = match && match[1] ? match[1].trim() : null;
  
  try {
    bot.sendMessage(chatId, '⏳ Fetching balance data...');
    
    if (walletAddress) {
      // Fetch data for the specified wallet
      try {
        const walletData = await fetchWalletData(walletAddress);
        
        if (!walletData.success) {
          throw new Error(walletData.error?.message || 'Unknown error');
        }
        
        const data = walletData.data;
        const message = 
          `💼 *WALLET DETAILS: CUSTOM SEARCH*\n\n` +
          `🔍 *Searched Address*\n` +
          `• 👛 Address: \`${walletAddress}\`\n` +
          `• 🌐 [View on Solscan](https://solscan.io/account/${walletAddress})\n\n` +
          `💰 *Balance Information*\n` +
          `• ⚖️ Current Balance: ${formatSol(data.balance || "0")} SOL\n\n` +
          `📊 *Transaction Summary*\n` +
          `• ⬇️ Total Received: ${formatSol(data.totalReceived || "0")} SOL\n` +
          `• ↗️ Total Sent: ${formatSol(data.totalSent || "0")} SOL\n` +
          `• ✨ Total Rewards: ${formatSol(data.totalRewards || "0")} SOL\n\n` +
          `🔄 *Last Updated:* ${new Date().toLocaleString()}`;
        
        bot.sendMessage(chatId, message, { 
          parse_mode: 'Markdown',
          disable_web_page_preview: false
        });
      } catch (error) {
        // Check if the error is related to the API endpoint not being available
        if (error.message.includes('Route not found') || error.message.includes('404')) {
          bot.sendMessage(
            chatId, 
            `❌ *WALLET LOOKUP UNAVAILABLE*\n\n` +
            `The wallet lookup feature is currently unavailable. The API endpoint for wallet lookups has not been deployed yet.\n\n` +
            `Please try again later or use \`/balance\` without a wallet address to check the distribution wallet's balance.`,
            { parse_mode: 'Markdown' }
          );
        } else {
          bot.sendMessage(
            chatId, 
            `❌ Error fetching data for wallet ${walletAddress}: ${error.message}\n\nPlease verify the wallet address is correct.`
          );
        }
      }
    } else {
      // Fetch default stats (distribution wallet)
      const statsData = await fetchStats();
      
      if (!statsData.success) {
        throw new Error(statsData.error?.message || 'Unknown error');
      }
      
      const stats = statsData.stats;
      const message = 
        `💼 *WALLET BALANCE SUMMARY*\n\n` +
        `💰 *Current Balance:* ${formatSol(stats.currentSolBalance)} SOL\n\n` +
        `📊 *Additional Information*\n` +
        `• 🔄 Total Distributed: ${formatSol(stats.totalSolDistributed)} SOL\n` +
        `• ⬇️ Total Received: ${formatSol(stats.totalSolReceived)} SOL\n\n` +
        `🔗 *Wallet Details*\n` +
        `• 👛 Address: \`${stats.distributionWallet}\`\n` +
        `• 🌐 [View on Solscan](${stats.solscanLink})\n\n` +
        `🔄 *Last Updated:* ${new Date(statsData.fetchedAt).toLocaleString()}\n\n` +
        `💡 *Tip:* Use \`/balance <wallet_address>\` to check any wallet's balance and rewards.`;
      
      bot.sendMessage(chatId, message, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: false
      });
    }
  } catch (error) {
    bot.sendMessage(
      chatId, 
      `❌ Error fetching balance: ${error.message}\n\n` +
      `Usage: /balance [wallet_address]`
    );
  }
});

// Distributed command
bot.onText(/\/distributed/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    bot.sendMessage(chatId, '⏳ Fetching distributed amount...');
    
    const statsData = await fetchStats();
    
    if (!statsData.success) {
      throw new Error(statsData.error?.message || 'Unknown error');
    }
    
    const stats = statsData.stats;
    const counts = statsData.transactionCounts;
    
    // Calculate average distribution per transaction
    const avgDistribution = counts.sentTransactions > 0 
      ? parseFloat(stats.totalSolDistributed) / counts.sentTransactions 
      : 0;
    
    const message = 
      `💸 *DISTRIBUTION SUMMARY*\n\n` +
      `💰 *Total Distributed:* ${formatSol(stats.totalSolDistributed)} SOL\n\n` +
      `📊 *Distribution Details*\n` +
      `• ↗️ Sent Transactions: ${counts.sentTransactions}\n` +
      `• ⚖️ Average Per Transaction: ${formatSol(avgDistribution.toString())} SOL\n\n` +
      `💼 *Wallet Status*\n` +
      `• 💎 Current Balance: ${formatSol(stats.currentSolBalance)} SOL\n` +
      `• ⬇️ Total Received: ${formatSol(stats.totalSolReceived)} SOL\n\n` +
      `🔄 *Last Updated:* ${new Date(statsData.fetchedAt).toLocaleString()}`;
    
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (error) {
    bot.sendMessage(chatId, `❌ Error fetching distributed amount: ${error.message}`);
  }
});

// Transactions command
bot.onText(/\/transactions/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    bot.sendMessage(chatId, '⏳ Fetching transaction count...');
    
    const statsData = await fetchStats();
    
    if (!statsData.success) {
      throw new Error(statsData.error?.message || 'Unknown error');
    }
    
    const stats = statsData.stats;
    const counts = statsData.transactionCounts;
    
    // Calculate percentages
    const sentPercentage = counts.totalStoredTransactions > 0 
      ? (counts.sentTransactions / counts.totalStoredTransactions * 100).toFixed(1) 
      : 0;
    const receivedPercentage = counts.totalStoredTransactions > 0 
      ? (counts.receivedTransactions / counts.totalStoredTransactions * 100).toFixed(1) 
      : 0;
    
    const message = 
      `📝 *TRANSACTION SUMMARY*\n\n` +
      `📊 *Transaction Counts*\n` +
      `• 🧮 Total Transactions: ${stats.totalTransactions}\n` +
      `• ↗️ Sent Transactions: ${counts.sentTransactions} (${sentPercentage}%)\n` +
      `• ↘️ Received Transactions: ${counts.receivedTransactions} (${receivedPercentage}%)\n` +
      `• ⚡ SOL Transactions: ${counts.solTransactions}\n` +
      `• 💾 Stored Transactions: ${counts.totalStoredTransactions}\n\n` +
      `💰 *Financial Impact*\n` +
      `• 🔄 Total Distributed: ${formatSol(stats.totalSolDistributed)} SOL\n` +
      `• ⬇️ Total Received: ${formatSol(stats.totalSolReceived)} SOL\n` +
      `• 💎 Current Balance: ${formatSol(stats.currentSolBalance)} SOL\n\n` +
      `🔗 *Wallet Details*\n` +
      `• 🌐 [View Transactions on Solscan](${stats.solscanLink})\n\n` +
      `🔄 *Last Updated:* ${new Date(statsData.fetchedAt).toLocaleString()}`;
    
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (error) {
    bot.sendMessage(chatId, `❌ Error fetching transaction count: ${error.message}`);
  }
});

// Refresh command
bot.onText(/\/refresh/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    bot.sendMessage(chatId, '⏳ Forcing refresh of transaction data...');
    
    // Add API key to the request if available
    const apiKey = process.env.API_KEY;
    const headers = {
      'User-Agent': 'TelegramBot',
    };
    
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
    }
    
    // Call the force-refresh endpoint with a limit parameter
    const response = await fetch(`${API_BASE_URL}/api/force-refresh?limit=50`, { headers });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`API error: ${errorData.error?.message || 'Unknown error'}`);
    }
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error?.message || 'Unknown error');
    }
    
    // Get updated stats after refresh
    let statsMessage = '';
    try {
      const statsData = await fetchStats();
      if (statsData.success) {
        const stats = statsData.stats;
        const counts = statsData.transactionCounts;
        statsMessage = `\n\n📊 *Updated Statistics*\n` +
          `• 🧮 Total Transactions: ${stats.totalTransactions}\n` +
          `• ↗️ Sent Transactions: ${counts.sentTransactions}\n` +
          `• ↘️ Received Transactions: ${counts.receivedTransactions}\n` +
          `• 💎 Current Balance: ${formatSol(stats.currentSolBalance)} SOL`;
      }
    } catch (error) {
      console.error('Error fetching updated stats after refresh:', error);
      statsMessage = '\n\n⚠️ *Note:* Could not fetch updated statistics due to API timeout. The refresh was still successful.';
    }
    
    const message = `✅ *Refresh Complete!*\n\n` +
      `Successfully refreshed transaction data.\n` +
      `• 🔄 Transactions processed: ${data.processedCount}\n` +
      `• ⏱️ Processing time: ${data.processingTime}s${statsMessage}`;
    
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error in refresh command:', error.message);
    let errorMessage = '❌ Error refreshing data. Please try again later.';
    
    // Provide more helpful message for timeout errors
    if (error.message.includes('high load') || error.message.includes('timeout') || error.message.includes('15s limit')) {
      errorMessage = '⏱️ *API Timeout Error*\n\nThe refresh operation timed out due to high server load. The API has a 15-second execution limit.\n\nYou can try again later when the server load is lower.';
    }
    
    bot.sendMessage(chatId, errorMessage, { parse_mode: 'Markdown' });
  }
});

// Handle errors
bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});

// Log when bot is started
console.log(`Bot started! API URL: ${API_BASE_URL}`);
console.log('Press Ctrl+C to stop the bot'); 