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

// Create a bot instance
const bot = new TelegramBot(token, { polling: true });

// Helper function to format SOL amounts
function formatSol(lamports) {
  const sol = lamports / 1000000000;
  return sol.toLocaleString('en-US', { 
    minimumFractionDigits: 2,
    maximumFractionDigits: 9 
  });
}

// Helper function to fetch data from API
async function fetchFromAPI(endpoint) {
  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`);
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
    const response = await fetch(`${API_BASE_URL}/api/stats?limit=50`);
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`API error: ${errorData.error?.message || 'Unknown error'}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching stats:', error.message);
    throw error;
  }
}

// Update the fetchBalance function to include a limit parameter
async function fetchBalance() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/stats?limit=50`);
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

// Start command
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  
  bot.sendMessage(
    chatId,
    `👋 Welcome to the SOL Distribution Tracker Bot!\n\n` +
    `This bot helps you track SOL distributions from the main wallet.\n\n` +
    `Available commands:\n` +
    `/stats - Get current distribution statistics\n` +
    `/balance - Check current wallet balance\n` +
    `/distributed - View total distributed amount\n` +
    `/transactions - Get recent transaction count\n` +
    `/refresh - Force refresh transaction data\n` +
    `/help - Show this help message`
  );
});

// Help command
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  
  bot.sendMessage(
    chatId,
    `📚 *SOL Distribution Tracker Bot Commands*\n\n` +
    `/stats - Get current distribution statistics\n` +
    `/balance - Check current wallet balance\n` +
    `/distributed - View total distributed amount\n` +
    `/transactions - Get recent transaction count\n` +
    `/refresh - Force refresh transaction data\n` +
    `/help - Show this help message\n\n` +
    `Data is sourced from the production API at:\n` +
    `${API_BASE_URL}`,
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
      `📊 *SOL Distribution Statistics*\n\n` +
      `💰 *Total Distributed:* ${formatSol(stats.totalSolDistributed)} SOL\n` +
      `📥 *Total Received:* ${formatSol(stats.totalSolReceived)} SOL\n` +
      `💼 *Current Balance:* ${formatSol(stats.currentSolBalance)} SOL\n\n` +
      `📝 *Transactions:* ${stats.totalTransactions}\n` +
      `↗️ *Sent:* ${counts.sentTransactions}\n` +
      `↘️ *Received:* ${counts.receivedTransactions}\n\n` +
      `🔄 *Last Updated:* ${new Date(data.fetchedAt).toLocaleString()}\n\n` +
      `[View Wallet on Solscan](${stats.solscanLink})`;
    
    bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: false
    });
  } catch (error) {
    bot.sendMessage(
      chatId, 
      `❌ Error fetching statistics: ${error.message}\n\nThe stats endpoint might be timing out due to Vercel's 15-second limit for serverless functions.`
    );
  }
});

// Balance command
bot.onText(/\/balance/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    bot.sendMessage(chatId, '⏳ Fetching balance...');
    
    const statsData = await fetchStats();
    
    if (!statsData.success) {
      throw new Error(statsData.error?.message || 'Unknown error');
    }
    
    const stats = statsData.stats;
    const message = 
      `💼 *Current Wallet Balance*\n\n` +
      `${formatSol(stats.currentSolBalance)} SOL\n\n` +
      `[View Wallet on Solscan](${stats.solscanLink})`;
    
    bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: false
    });
  } catch (error) {
    bot.sendMessage(chatId, `❌ Error fetching balance: ${error.message}`);
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
    const message = 
      `💸 *Total SOL Distributed*\n\n` +
      `${formatSol(stats.totalSolDistributed)} SOL\n\n` +
      `Across ${statsData.transactionCounts.sentTransactions} transactions`;
    
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
    
    const message = 
      `📝 *Transaction Statistics*\n\n` +
      `*Total Transactions:* ${stats.totalTransactions}\n` +
      `↗️ *Sent:* ${counts.sentTransactions}\n` +
      `↘️ *Received:* ${counts.receivedTransactions}\n\n` +
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
    
    // Call the force-refresh endpoint with a limit parameter
    const response = await fetch(`${API_BASE_URL}/api/force-refresh?limit=50`);
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`API error: ${errorData.error?.message || 'Unknown error'}`);
    }
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error?.message || 'Unknown error');
    }
    
    bot.sendMessage(
      chatId, 
      `✅ Successfully refreshed transaction data!\n\n` +
      `Updated at: ${new Date(data.timestamp).toLocaleString()}\n\n` +
      `Use /stats to see the latest statistics.`
    );
  } catch (error) {
    bot.sendMessage(
      chatId, 
      `❌ Error refreshing data: ${error.message}\n\nThe refresh endpoint might be timing out due to Vercel's 15-second limit for serverless functions.`
    );
  }
});

// Handle errors
bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});

// Log when bot is started
console.log(`Bot started! API URL: ${API_BASE_URL}`);
console.log('Press Ctrl+C to stop the bot'); 