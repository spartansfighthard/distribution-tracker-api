// Telegram Bot for SOL Distribution Tracker - Railway Deployment
// This script is the entry point for Railway deployment

require('dotenv').config({ path: '.env.bot' });
const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');
const express = require('express');

// Create Express app for health checks
const app = express();
const PORT = process.env.PORT || 3000;

// API base URL - can be overridden by Railway environment variables
const API_BASE_URL = process.env.API_BASE_URL || 'https://distribution-tracker-api.vercel.app';

// Telegram bot token
const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is not defined in environment variables');
  process.exit(1);
}

// Add instance ID for logging
const instanceId = Date.now().toString();
console.log(`Starting bot instance with ID: ${instanceId} on Railway`);
console.log(`Using API: ${API_BASE_URL}`);

// Create a bot instance with proper error handling
const bot = new TelegramBot(token, { 
  polling: {
    params: {
      timeout: 30,
      allowed_updates: ["message", "callback_query"]
    }
  }
});

// Handle polling errors
bot.on('polling_error', (error) => {
  console.log(`Polling error: ${error.message}`);
  
  // If we detect another instance is running, exit gracefully
  if (error.message && error.message.includes('terminated by other getUpdates request')) {
    console.log('Another bot instance is already running. This instance will exit.');
    process.exit(0);
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
  
  // Convert from lamports to SOL
  const solValue = lamports / 1000000000;
  return solValue.toLocaleString('en-US', { 
    minimumFractionDigits: 2,
    maximumFractionDigits: 9 
  });
}

// Helper function to fetch data from API with error handling
async function fetchFromAPI(endpoint) {
  const url = `${API_BASE_URL}${endpoint}`;
  const apiKey = process.env.API_KEY;
  
  try {
    const headers = apiKey ? { 'X-API-KEY': apiKey } : {};
    
    // Add a shorter timeout for fetch to avoid long waiting times
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 second timeout
    
    const response = await fetch(url, { 
      headers, 
      signal: controller.signal 
    }).finally(() => clearTimeout(timeoutId));
    
    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('Rate limit exceeded. Please try again later.');
      } else if (response.status === 500) {
        throw new Error('API server error. The service may be experiencing issues.');
      } else {
        throw new Error(`API responded with status ${response.status}`);
      }
    }
    
    return await response.json();
  } catch (error) {
    console.error(`Error fetching from API (${url}):`, error.message);
    
    // If it's a timeout or abort error, provide a more specific message
    if (error.name === 'AbortError' || error.message.includes('timeout')) {
      return { 
        success: false, 
        error: { message: 'Request timed out. The API is experiencing high load.' },
        // Provide fallback data for stats endpoint
        stats: endpoint.includes('/api/stats') ? {
          title: "SOL Distribution Tracker (Fallback Data)",
          currentSolBalance: "0.5", // Fallback value
          totalSolDistributed: "10.0", // Fallback value
          totalTransactions: "Limited data available",
          solscanLink: "https://solscan.io/account/HMDVj2Mhax9Kg68yTPo8qH1bcMQuCAqzDatV6d4Wqawv"
        } : null
      };
    }
    
    return { 
      success: false, 
      error: { message: error.message } 
    };
  }
}

// Simplified stats command with better error handling and timeout management
bot.onText(/\/stats/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    const statusMessage = await bot.sendMessage(chatId, '⏳ Fetching statistics...');
    
    // Set a timeout for the API request
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Request timed out after 8 seconds')), 8000)
    );
    
    // Create the actual fetch promise with a small limit
    const fetchPromise = fetchFromAPI('/api/stats?limit=1');
    
    // Race the fetch against the timeout
    const data = await Promise.race([fetchPromise, timeoutPromise])
      .catch(async (error) => {
        // If the first attempt fails, try with an even smaller limit
        if (error.message.includes('timeout') || error.message.includes('15s limit')) {
          await bot.editMessageText('⏳ First attempt timed out, trying with minimal data...', {
            chat_id: chatId,
            message_id: statusMessage.message_id
          });
          
          // Try with minimal data
          return fetchFromAPI('/api/stats?limit=1&minimal=true');
        }
        throw error;
      });
    
    if (!data.success) {
      // If we have fallback stats data, use it instead of throwing an error
      if (data.stats) {
        const stats = data.stats;
        
        const message = 
          `${stats.title} (Limited Data)\n\n` +
          `💰 *Current Balance*: ${formatSol(stats.currentSolBalance)} SOL\n` +
          `💸 *Total Distributed*: ${formatSol(stats.totalSolDistributed)} SOL\n` +
          `📊 *Total Transactions*: ${stats.totalTransactions}\n\n` +
          `🔗 [View on Solscan](${stats.solscanLink})\n\n` +
          `⚠️ Note: Using fallback data due to API issues.`;
        
        await bot.editMessageText(message, {
          chat_id: chatId,
          message_id: statusMessage.message_id,
          parse_mode: 'Markdown'
        });
        return;
      }
      
      throw new Error(data.error?.message || 'Unknown error');
    }
    
    const stats = data.stats;
    
    const message = 
      `${stats.title}\n\n` +
      `💰 *Current Balance*: ${formatSol(stats.currentSolBalance)} SOL\n` +
      `💸 *Total Distributed*: ${formatSol(stats.totalSolDistributed)} SOL\n` +
      `📊 *Total Transactions*: ${stats.totalTransactions}\n\n` +
      `🔗 [View on Solscan](${stats.solscanLink})`;
    
    await bot.editMessageText(message, {
      chat_id: chatId,
      message_id: statusMessage.message_id,
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.error('Error fetching stats:', error.message);
    
    // Provide a more helpful error message
    let errorMessage = '⏱️ *API Timeout Error*\n\n';
    
    if (error.message.includes('timeout') || error.message.includes('15s limit') || error.message.includes('high load')) {
      errorMessage += 'The API is currently experiencing high load and reached the timeout limit. You can:\n\n' +
        '• Try again later\n' +
        '• Use simpler commands like /balance\n' +
        '• Check the Solscan link directly: https://solscan.io/account/' + 
        (process.env.DISTRIBUTION_WALLET_ADDRESS || 'HMDVj2Mhax9Kg68yTPo8qH1bcMQuCAqzDatV6d4Wqawv');
    } else if (error.message.includes('rate limit')) {
      errorMessage += 'The API is currently rate limited. Please try again in a few minutes.';
    } else if (error.message.includes('server error')) {
      errorMessage += 'The API server is experiencing issues. Please try again later.';
    } else {
      errorMessage = '❌ Error fetching statistics: ' + error.message;
    }
    
    bot.sendMessage(chatId, errorMessage, { parse_mode: 'Markdown' });
  }
});

// Balance command with improved error handling and timeout management
bot.onText(/\/balance(?:\s+([^\s]+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const walletAddress = match[1]; // Optional wallet address
  
  try {
    let statusMessage;
    if (walletAddress) {
      statusMessage = await bot.sendMessage(chatId, `⏳ Checking balance for wallet: ${walletAddress}...`);
    } else {
      statusMessage = await bot.sendMessage(chatId, '⏳ Checking distribution wallet balance...');
    }
    
    // Set a timeout for the API request
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Request timed out after 8 seconds')), 8000)
    );
    
    // Create the actual fetch promise with appropriate endpoint
    const fetchPromise = walletAddress 
      ? fetchFromAPI(`/api/wallet?address=${walletAddress}&limit=1`)
      : fetchFromAPI('/api/stats?limit=1');
    
    // Race the fetch against the timeout
    const data = await Promise.race([fetchPromise, timeoutPromise])
      .catch(async (error) => {
        // If the first attempt fails, try with an even smaller limit
        if (error.message.includes('timeout') || error.message.includes('15s limit')) {
          await bot.editMessageText('⏳ First attempt timed out, trying with minimal data...', {
            chat_id: chatId,
            message_id: statusMessage.message_id
          });
          
          // Try with minimal data
          return walletAddress 
            ? fetchFromAPI(`/api/wallet?address=${walletAddress}&limit=1&minimal=true`)
            : fetchFromAPI('/api/stats?limit=1&minimal=true');
        }
        throw error;
      });
    
    if (!data.success) {
      // If we have fallback stats data and no wallet address was provided, use it
      if (!walletAddress && data.stats) {
        const stats = data.stats;
        
        const message = 
          `💰 *Distribution Wallet Balance (Limited Data)*\n\n` +
          `Current Balance: ${formatSol(stats.currentSolBalance)} SOL\n` +
          `🔗 [View on Solscan](${stats.solscanLink})\n\n` +
          `⚠️ Note: Using fallback data due to API issues.`;
        
        await bot.editMessageText(message, {
          chat_id: chatId,
          message_id: statusMessage.message_id,
          parse_mode: 'Markdown'
        });
        return;
      }
      
      throw new Error(data.error?.message || 'Unknown error');
    }
    
    let message;
    if (walletAddress) {
      const walletData = data.wallet;
      
      message = 
        `👛 *Wallet Information*\n\n` +
        `💰 *Balance*: ${formatSol(walletData.balance)} SOL\n` +
        `💸 *Total Received*: ${formatSol(walletData.totalReceived)} SOL\n` +
        `🔗 [View on Solscan](https://solscan.io/account/${walletAddress})`;
    } else {
      const stats = data.stats;
      
      message = 
        `💰 *Distribution Wallet Balance*\n\n` +
        `Current Balance: ${formatSol(stats.currentSolBalance)} SOL\n` +
        `🔗 [View on Solscan](${stats.solscanLink})`;
    }
    
    await bot.editMessageText(message, {
      chat_id: chatId,
      message_id: statusMessage.message_id,
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.error('Error fetching balance:', error.message);
    
    // Provide a more helpful error message
    let errorMessage = '⏱️ *API Timeout Error*\n\n';
    
    if (error.message.includes('timeout') || error.message.includes('15s limit') || error.message.includes('high load')) {
      errorMessage += 'The API is currently experiencing high load. Try again later or check Solscan directly: ' +
        'https://solscan.io/account/' + (walletAddress || process.env.DISTRIBUTION_WALLET_ADDRESS || 'HMDVj2Mhax9Kg68yTPo8qH1bcMQuCAqzDatV6d4Wqawv');
    } else if (error.message.includes('rate limit')) {
      errorMessage += 'The API is currently rate limited. Please try again in a few minutes.';
    } else if (error.message.includes('server error')) {
      errorMessage += 'The API server is experiencing issues. Please try again later.';
    } else {
      errorMessage = '❌ Error fetching balance: ' + error.message;
    }
    
    bot.sendMessage(chatId, errorMessage, { parse_mode: 'Markdown' });
  }
});

// Start command
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const message = 
    "👋 Welcome to the SOL Distribution Tracker Bot!\n\n" +
    "This bot allows you to check statistics about SOL distributions.\n\n" +
    "Available commands:\n" +
    "/stats - View distribution statistics\n" +
    "/balance - Check distribution wallet balance\n" +
    "/balance [address] - Check any wallet's balance\n" +
    "/help - Show this help message";
  
  bot.sendMessage(chatId, message);
});

// Help command
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  const message = 
    "📚 *SOL Distribution Tracker Bot Help*\n\n" +
    "Available commands:\n\n" +
    "*/stats* - View distribution statistics\n" +
    "*/balance* - Check distribution wallet balance\n" +
    "*/balance [address]* - Check any wallet's balance\n" +
    "*/help* - Show this help message\n\n" +
    "For any issues, please contact the administrator.";
  
  bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// Set up Express routes for health checks
app.get('/', (req, res) => {
  res.send(`Bot is running! Instance ID: ${instanceId}`);
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', instance: instanceId });
});

// Start Express server
app.listen(PORT, () => {
  console.log(`Health check server running on port ${PORT}`);
});

// Log startup
console.log('Bot started successfully!'); 