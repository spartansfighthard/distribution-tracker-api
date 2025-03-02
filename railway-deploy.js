// Telegram Bot for SOL Distribution Tracker - Railway Deployment
// This script is the entry point for Railway deployment

require('dotenv').config({ path: '.env.bot' });
const express = require('express');
const fs = require('fs');
const path = require('path');

// Create Express app for health checks - FIRST PRIORITY
const app = express();
const PORT = process.env.PORT || 3000;

// Add instance ID for logging
const instanceId = Date.now().toString();
console.log(`Starting server with instance ID: ${instanceId} on Railway`);

// CRITICAL: Set up the simplest possible health check endpoint
// This ensures health checks can pass even if other parts of the app fail
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Simple root endpoint
app.get('/', (req, res) => {
  res.send(`Server is running! Instance ID: ${instanceId}`);
});

// Start Express server IMMEDIATELY
// This ensures health checks can pass even if the bot initialization fails
const server = app.listen(PORT, () => {
  console.log(`Health check server running on port ${PORT}`);
});

// Only load the rest of the dependencies after the server is running
const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');
const axios = require('axios');

// API base URL - can be overridden by Railway environment variables
const API_BASE_URL = process.env.API_BASE_URL || 'https://distro-tracker.vercel.app';
console.log(`Using API: ${API_BASE_URL}`);

// Add API stop endpoint with authentication
app.get('/api/stop', (req, res) => {
  const apiKey = req.headers['x-api-key'];
  const configuredApiKey = process.env.API_KEY;
  
  // Verify API key for security
  if (!configuredApiKey || apiKey !== configuredApiKey) {
    return res.status(401).json({ 
      success: false, 
      error: { message: 'Unauthorized. Invalid API key.' } 
    });
  }
  
  console.log('API stop command received. Shutting down...');
  
  // Send success response before shutting down
  res.status(200).json({ 
    success: true, 
    message: 'Stop command received. Bot is shutting down.' 
  });
  
  // Give time for the response to be sent before exiting
  setTimeout(() => {
    process.exit(0);
  }, 1000);
});

// Telegram bot token
const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is not defined in environment variables');
  // Don't exit - keep the health check server running
  console.error('Running in health-check-only mode');
} else {
  // Bot creator and admin configuration
  const CONFIG_DIR = path.join(__dirname, 'config');
  const ADMIN_CONFIG_FILE = path.join(CONFIG_DIR, 'admin.json');
  let botCreatorId = null;
  let isFirstRun = false;

  // Create config directory if it doesn't exist
  if (!fs.existsSync(CONFIG_DIR)) {
    try {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      isFirstRun = true;
      console.log(`Created config directory: ${CONFIG_DIR}`);
    } catch (error) {
      console.error(`Error creating config directory: ${error.message}`);
    }
  }

  // Load admin configuration
  let adminConfig = {
    creatorId: null,
    additionalAdmins: []
  };

  try {
    if (fs.existsSync(ADMIN_CONFIG_FILE)) {
      const configData = fs.readFileSync(ADMIN_CONFIG_FILE, 'utf8');
      adminConfig = JSON.parse(configData);
      botCreatorId = adminConfig.creatorId;
      console.log(`Loaded admin configuration. Creator ID: ${botCreatorId}`);
    } else {
      isFirstRun = true;
      console.log('Admin configuration file not found. Running in first-run mode.');
      // Create empty config file
      fs.writeFileSync(ADMIN_CONFIG_FILE, JSON.stringify(adminConfig, null, 2));
    }
  } catch (error) {
    console.error(`Error loading admin configuration: ${error.message}`);
  }

  // Admin configuration
  const ADMIN_USER_IDS = process.env.ADMIN_USER_IDS 
    ? process.env.ADMIN_USER_IDS.split(',').map(id => parseInt(id.trim())) 
    : adminConfig.additionalAdmins || [];
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'; // Default password if not set
  const adminSessions = new Map(); // Store authenticated admin sessions

  console.log(`First run mode: ${isFirstRun}`);

  // IMPORTANT: Delay bot initialization to prevent conflicts during deployment
  console.log('Waiting 10 seconds before initializing the Telegram bot to prevent conflicts...');

  // Initialize the bot with a delay to prevent conflicts during deployment
  setTimeout(() => {
    try {
      console.log(`Initializing bot instance with ID: ${instanceId}`);
      
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
          // Don't exit the process, just stop the bot polling
          bot.stopPolling();
          console.log('Bot polling stopped, but server remains running for health checks');
        }
      });

      // Helper function to save admin configuration
      function saveAdminConfig() {
        try {
          // Update the admin config object
          adminConfig.creatorId = botCreatorId;
          adminConfig.additionalAdmins = ADMIN_USER_IDS.filter(id => id !== botCreatorId);
          
          // Write to file
          fs.writeFileSync(ADMIN_CONFIG_FILE, JSON.stringify(adminConfig, null, 2));
          console.log('Admin configuration saved successfully');
          return true;
        } catch (error) {
          console.error(`Error saving admin configuration: ${error.message}`);
          return false;
        }
      }

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

      // Helper function to check if a user is an admin
      function isAdmin(userId) {
        // Check if user is the creator, in the admin list, or has an active admin session
        return userId === botCreatorId || ADMIN_USER_IDS.includes(userId) || adminSessions.has(userId);
      }

      // Helper function to require admin privileges for a command
      async function requireAdmin(msg, callback) {
        const userId = msg.from.id;
        const chatId = msg.chat.id;
        
        if (isAdmin(userId)) {
          // User is already an admin, execute the callback
          await callback();
        } else {
          // User is not an admin, send authentication message
          bot.sendMessage(
            chatId,
            "⚠️ *Admin Authentication Required*\n\n" +
            "This command requires admin privileges. Please use:\n" +
            "`/admin [password]`\n\n" +
            "If you are not an admin, you cannot use this command.",
            { parse_mode: 'Markdown' }
          );
        }
      }

      // First run setup command - only works if no creator is set
      bot.onText(/\/setup_creator/, (msg) => {
        const userId = msg.from.id;
        const chatId = msg.chat.id;
        
        if (botCreatorId === null) {
          // Set this user as the bot creator
          botCreatorId = userId;
          
          // Save the configuration
          if (saveAdminConfig()) {
            bot.sendMessage(
              chatId,
              "🎉 *Congratulations!*\n\n" +
              "You have been registered as the bot creator and administrator.\n" +
              "You now have full access to all admin commands.\n\n" +
              "Use `/help` to see available commands.",
              { parse_mode: 'Markdown' }
            );
          } else {
            bot.sendMessage(
              chatId,
              "❌ *Error*\n\n" +
              "Failed to save creator configuration. Please check server logs.",
              { parse_mode: 'Markdown' }
            );
          }
        } else {
          // Creator already set
          bot.sendMessage(
            chatId,
            "⚠️ *Setup Already Completed*\n\n" +
            "This bot already has a registered creator.\n" +
            "If you need admin access, please contact the bot creator.",
            { parse_mode: 'Markdown' }
          );
        }
      });

      // Admin authentication command
      bot.onText(/\/admin (.+)/, (msg, match) => {
        const userId = msg.from.id;
        const chatId = msg.chat.id;
        const password = match[1];
        
        if (password === ADMIN_PASSWORD) {
          // Store admin session for 1 hour
          adminSessions.set(userId, Date.now() + 3600000); // 1 hour expiry
          bot.sendMessage(chatId, "✅ Admin authentication successful. Your session will expire in 1 hour.");
          
          // Set a timeout to clear the session after 1 hour
          setTimeout(() => {
            if (adminSessions.has(userId)) {
              adminSessions.delete(userId);
              // Notify the user if they're still in a chat with the bot
              bot.sendMessage(chatId, "⏱️ Your admin session has expired. Please authenticate again if needed.")
                .catch(() => {}); // Ignore errors if message can't be sent
            }
          }, 3600000);
        } else {
          bot.sendMessage(chatId, "❌ Authentication failed. Incorrect password.");
        }
      });

      // Add admin command (creator only)
      bot.onText(/\/add_admin (\d+)/, (msg, match) => {
        const userId = msg.from.id;
        const chatId = msg.chat.id;
        const newAdminId = parseInt(match[1]);
        
        // Only the creator can add admins
        if (userId === botCreatorId) {
          if (!ADMIN_USER_IDS.includes(newAdminId)) {
            ADMIN_USER_IDS.push(newAdminId);
            
            // Save the updated configuration
            if (saveAdminConfig()) {
              bot.sendMessage(chatId, `✅ User ID ${newAdminId} has been added as an admin.`);
            } else {
              bot.sendMessage(chatId, "❌ Failed to save admin configuration. The admin was added for this session only.");
            }
          } else {
            bot.sendMessage(chatId, `ℹ️ User ID ${newAdminId} is already an admin.`);
          }
        } else {
          bot.sendMessage(chatId, "⚠️ Only the bot creator can add new admins.");
        }
      });

      // Remove admin command (creator only)
      bot.onText(/\/remove_admin (\d+)/, (msg, match) => {
        const userId = msg.from.id;
        const chatId = msg.chat.id;
        const adminIdToRemove = parseInt(match[1]);
        
        // Only the creator can remove admins
        if (userId === botCreatorId) {
          // Cannot remove the creator
          if (adminIdToRemove === botCreatorId) {
            bot.sendMessage(chatId, "⚠️ You cannot remove the bot creator from admins.");
            return;
          }
          
          const index = ADMIN_USER_IDS.indexOf(adminIdToRemove);
          if (index !== -1) {
            ADMIN_USER_IDS.splice(index, 1);
            
            // Save the updated configuration
            if (saveAdminConfig()) {
              bot.sendMessage(chatId, `✅ User ID ${adminIdToRemove} has been removed from admins.`);
            } else {
              bot.sendMessage(chatId, "❌ Failed to save admin configuration. The admin was removed for this session only.");
            }
          } else {
            bot.sendMessage(chatId, `ℹ️ User ID ${adminIdToRemove} is not an admin.`);
          }
        } else {
          bot.sendMessage(chatId, "⚠️ Only the bot creator can remove admins.");
        }
      });

      // List admins command (admin only)
      bot.onText(/\/list_admins/, (msg) => {
        const chatId = msg.chat.id;
        
        requireAdmin(msg, async () => {
          let message = "👑 *Bot Administrators*\n\n";
          
          if (botCreatorId) {
            message += `*Creator*: ${botCreatorId}\n\n`;
          }
          
          if (ADMIN_USER_IDS.length > 0) {
            message += "*Additional Admins*:\n";
            ADMIN_USER_IDS.forEach(adminId => {
              message += `• ${adminId}\n`;
            });
          } else {
            message += "*Additional Admins*: None\n";
          }
          
          message += "\nTemporary admin sessions are not listed.";
          
          bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        });
      });

      // Stop command (admin only)
      bot.onText(/\/stop/, (msg) => {
        const userId = msg.from.id;
        const chatId = msg.chat.id;
        
        // Check if user is admin
        if (!isAdmin(userId)) {
          return bot.sendMessage(chatId, '⛔ Sorry, this command is only available to admins.');
        }
        
        // Determine if we're running on Vercel or Railway
        const isVercel = API_BASE_URL.includes('vercel.app');
        const platformName = isVercel ? "Vercel" : "Railway";
        
        bot.sendMessage(chatId, `🛑 *Bot Shutdown Initiated*\n\nThe bot is shutting down. It will be restarted automatically by the ${platformName} deployment platform.`, { parse_mode: 'Markdown' });
        console.log(`Bot shutdown initiated by admin (User ID: ${userId}) on ${platformName} platform`);
        
        // Exit the process after a short delay
        setTimeout(() => {
          process.exit(0);
        }, 1000);
      });

      // Stop API data collection command (admin only)
      bot.onText(/\/stop_api/, (msg) => {
        const chatId = msg.chat.id;
        
        requireAdmin(msg, async () => {
          const statusMessage = await bot.sendMessage(chatId, "⏳ Stopping API data collection...");
          
          try {
            const response = await fetchFromAPI('/api/admin/stop-collection');
            
            if (response.success) {
              await bot.sendMessage(chatId, "✅ *API Data Collection Stopped*\n\n" + (response.message || "Data collection has been stopped successfully."), {
                parse_mode: 'Markdown'
              });
            } else {
              throw new Error(response.error?.message || 'Unknown error');
            }
          } catch (error) {
            console.error('Error stopping API data collection:', error.message);
            
            await bot.sendMessage(chatId, "❌ *Error Stopping Data Collection*\n\n" + error.message, {
              parse_mode: 'Markdown'
            });
          }
        });
      });

      // Force refresh command (admin only)
      bot.onText(/\/force_refresh/, (msg) => {
        const chatId = msg.chat.id;
        
        requireAdmin(msg, async () => {
          const statusMessage = await bot.sendMessage(chatId, "⏳ Forcing refresh of all transactions...");
          
          try {
            const response = await fetchFromAPI('/api/admin/force-refresh');
            
            if (response.success) {
              await bot.sendMessage(chatId, "✅ *Force Refresh Successful*\n\n" + response.message, {
                parse_mode: 'Markdown'
              });
            } else {
              throw new Error(response.error?.message || 'Unknown error');
            }
          } catch (error) {
            console.error('Error in force refresh command:', error.message);
            
            await bot.sendMessage(chatId, "❌ *Force Refresh Failed*\n\n" + error.message, {
              parse_mode: 'Markdown'
            });
          }
        });
      });

      // Force save command (admin only)
      bot.onText(/\/force_save/, (msg) => {
        const chatId = msg.chat.id;
        
        requireAdmin(msg, async () => {
          const statusMessage = await bot.sendMessage(chatId, "⏳ Forcing save of all data...");
          
          try {
            const response = await fetchFromAPI('/api/admin/force-save');
            
            if (response.success) {
              await bot.sendMessage(chatId, "✅ *Force Save Successful*\n\n" + response.message, {
                parse_mode: 'Markdown'
              });
            } else {
              throw new Error(response.error?.message || 'Unknown error');
            }
          } catch (error) {
            console.error('Error in force save command:', error.message);
            
            await bot.sendMessage(chatId, "❌ *Force Save Failed*\n\n" + error.message, {
              parse_mode: 'Markdown'
            });
          }
        });

      // Fetch all command (admin only)
      bot.onText(/\/fetch_all/, (msg) => {
        const chatId = msg.chat.id;
        
        requireAdmin(msg, async () => {
          const statusMessage = await bot.sendMessage(chatId, "⏳ Fetching all transactions (this may take a while)...");
          
          try {
            const response = await fetchFromAPI('/api/admin/fetch-all');
            
            if (response.success) {
              await bot.sendMessage(chatId, "✅ *Fetch All Successful*\n\n" + response.message, {
                parse_mode: 'Markdown'
              });
            } else {
              throw new Error(response.error?.message || 'Unknown error');
            }
          } catch (error) {
            console.error('Error in fetch all command:', error.message);
            
            await bot.sendMessage(chatId, "❌ *Fetch All Failed*\n\n" + error.message, {
              parse_mode: 'Markdown'
            });
          }
        });
      });

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
                await bot.sendMessage(chatId, '⏳ First attempt timed out, trying with minimal data...');
                
                // Try with minimal data
                return fetchFromAPI('/api/stats?limit=1&minimal=true');
              }
              throw error;
            });
          
          if (!data.success) {
            // If we have fallback stats data, use it instead of throwing an error
            if (data.stats) {
              const stats = data.stats;
              
              // Safely format values
              const balance = formatSol(stats.currentSolBalance || "0.00");
              const totalDistributed = formatSol(stats.totalSolDistributed || "0.00");
              
              const message = 
                `${stats.title || "SOL Distribution Tracker"} (Limited Data)\n\n` +
                `💰 *Current Balance*: ${balance} SOL\n` +
                `💸 *Total Distributed*: ${totalDistributed} SOL\n` +
                `📊 *Total Transactions*: ${stats.totalTransactions || "N/A"}\n\n` +
                `🔗 [View on Solscan](${stats.solscanLink || "https://solscan.io"})\n\n` +
                `⚠️ Note: Using fallback data due to API issues.`;
              
              await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
              return;
            }
            
            throw new Error(data.error?.message || 'Unknown error');
          }
          
          const stats = data.stats;
          const currentDate = new Date().toLocaleString();
          const address = process.env.DISTRIBUTION_WALLET_ADDRESS || 'HMDVj2Mhax9Kg68yTPo8qH1bcMQuCAqzDatV6d4Wqawv';
          const apiVersion = data.apiVersion || 'Vercel';
          const environment = data.environment || 'production';
          
          // Safely format values
          const totalDistributed = formatSol(stats.totalSolDistributed || "0.00");
          const totalReceived = formatSol(stats.totalReceived || "0.00");
          const balance = formatSol(stats.currentSolBalance || "0.00");
          const totalTx = stats.totalTransactions || "0";
          const sentTx = stats.sentTransactions || (stats.totalTransactions - (stats.receivedTransactions || 0)) || "0";
          const receivedTx = stats.receivedTransactions || "0";
          const solTx = stats.solTransactions || stats.totalTransactions || "0";
          const storedTx = stats.storedTransactions || stats.totalTransactions || "0";
          
          // Escape any special characters in the address
          const safeAddress = address.replace(/([_*[\]()~`>#+=|{}.!-])/g, '\\$1');
          
          const message = 
            `📊 *SOL DISTRIBUTION STATISTICS*\n\n` +
            `💰 *Financial Summary*\n` +
            `• Total Distributed: ${totalDistributed} SOL\n` +
            `• Total Received: ${totalReceived} SOL\n` +
            `• Current Balance: ${balance} SOL\n\n` +
            `📝 *Transaction Details*\n` +
            `• Total Transactions: ${totalTx}\n` +
            `• Sent Transactions: ${sentTx}\n` +
            `• Received Transactions: ${receivedTx}\n` +
            `• SOL Transactions: ${solTx}\n` +
            `• Stored Transactions: ${storedTx}\n\n` +
            `🔗 *Wallet Information*\n` +
            `• Address: ${safeAddress}\n` +
            `• [View on Solscan](https://solscan.io/account/${address})\n\n` +
            `🔄 *Last Updated*: ${currentDate}\n\n` +
            `Environment: ${environment} | API Version: ${apiVersion}`;
          
          await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
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
          let statusMessage = await bot.sendMessage(chatId, '⏳ Fetching balance data...');
          
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
                await bot.sendMessage(chatId, '⏳ First attempt timed out, trying with minimal data...');
                
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
              
              await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
              return;
            }
            
            throw new Error(data.error?.message || 'Unknown error');
          }
          
          let message;
          const currentDate = new Date().toLocaleString();
          
          if (walletAddress) {
            const walletData = data.wallet || data.stats;
            const address = walletAddress || process.env.DISTRIBUTION_WALLET_ADDRESS || 'HMDVj2Mhax9Kg68yTPo8qH1bcMQuCAqzDatV6d4Wqawv';
            
            // Safely format values to prevent Markdown parsing errors
            const balance = formatSol(walletData.balance || walletData.currentSolBalance);
            const totalDistributed = formatSol(walletData.totalDistributed || walletData.totalSolDistributed || "0.00");
            const totalReceived = formatSol(walletData.totalReceived || "0.00");
            
            // Escape any special characters in the address
            const safeAddress = address.replace(/([_*[\]()~`>#+=|{}.!-])/g, '\\$1');
            
            message = 
              `💼 *WALLET BALANCE SUMMARY*\n\n` +
              `💰 *Current Balance*: ${balance} SOL\n\n` +
              `📊 *Additional Information*\n` +
              `• Total Distributed: ${totalDistributed} SOL\n` +
              `• Total Received: ${totalReceived} SOL\n\n` +
              `🔗 *Wallet Details*\n` +
              `• Address: ${safeAddress}\n` +
              `• [View on Solscan](https://solscan.io/account/${address})\n\n` +
              `🔄 *Last Updated*: ${currentDate}\n\n` +
              `💡 Tip: Use \`/balance <wallet_address>\` to check any wallet's balance and rewards.`;
          } else {
            const stats = data.stats;
            const address = process.env.DISTRIBUTION_WALLET_ADDRESS || 'HMDVj2Mhax9Kg68yTPo8qH1bcMQuCAqzDatV6d4Wqawv';
            
            // Safely format values to prevent Markdown parsing errors
            const balance = formatSol(stats.currentSolBalance || "0.00");
            const totalDistributed = formatSol(stats.totalSolDistributed || "0.00");
            const totalReceived = formatSol(stats.totalReceived || "0.00");
            
            // Escape any special characters in the address
            const safeAddress = address.replace(/([_*[\]()~`>#+=|{}.!-])/g, '\\$1');
            
            message = 
              `💼 *WALLET BALANCE SUMMARY*\n\n` +
              `💰 *Current Balance*: ${balance} SOL\n\n` +
              `📊 *Additional Information*\n` +
              `• Total Distributed: ${totalDistributed} SOL\n` +
              `• Total Received: ${totalReceived} SOL\n\n` +
              `🔗 *Wallet Details*\n` +
              `• Address: ${safeAddress}\n` +
              `• [View on Solscan](https://solscan.io/account/${address})\n\n` +
              `🔄 *Last Updated*: ${currentDate}\n\n` +
              `💡 Tip: Use \`/balance <wallet_address>\` to check any wallet's balance and rewards.`;
          }
          
          await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
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

      // Distributed command - Shows total distributed amount and details
      bot.onText(/\/distributed/, async (msg) => {
        const chatId = msg.chat.id;
        
        try {
          const statusMessage = await bot.sendMessage(chatId, '⏳ Fetching distributed amount...');
          
          // Set a timeout for the API request
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Request timed out after 8 seconds')), 8000)
          );
          
          // Create the actual fetch promise
          const fetchPromise = fetchFromAPI('/api/distributed?limit=10');
          
          // Race the fetch against the timeout
          const data = await Promise.race([fetchPromise, timeoutPromise])
            .catch(async (error) => {
              // If the first attempt fails, try with minimal data
              if (error.message.includes('timeout') || error.message.includes('15s limit')) {
                await bot.sendMessage(chatId, '⏳ First attempt timed out, trying with minimal data...');
                
                // Try with minimal data
                return fetchFromAPI('/api/stats?limit=1&minimal=true');
              }
              throw error;
            });
          
          if (!data.success) {
            // If we have fallback stats data, use it
            if (data.stats) {
              const stats = data.stats;
              
              // Safely format values
              const totalDistributed = formatSol(stats.totalSolDistributed || "0.00");
              
              const message = 
                `💸 *Distribution Summary (Limited Data)*\n\n` +
                `Total Distributed: ${totalDistributed} SOL\n\n` +
                `⚠️ Note: Using fallback data due to API issues.`;
              
              await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
              return;
            }
            
            throw new Error(data.error?.message || 'Unknown error');
          }
          
          const currentDate = new Date().toLocaleString();
          const stats = data.stats || {};
          
          // Safely format values
          const totalDistributed = formatSol(stats.totalSolDistributed || "0.00");
          const sentTx = stats.totalDistributions || stats.sentTransactions || "N/A";
          const avgDistribution = formatSol(stats.averageDistribution || 
            (stats.totalSolDistributed / (stats.totalDistributions || stats.sentTransactions || 1)));
          const balance = formatSol(stats.currentSolBalance || "0.00");
          const totalReceived = formatSol(stats.totalReceived || "0.00");
          
          // Format the message with all available data
          const message = 
            `💸 *DISTRIBUTION SUMMARY*\n\n` +
            `💰 *Total Distributed*: ${totalDistributed} SOL\n\n` +
            `📊 *Distribution Details*\n` +
            `• Sent Transactions: ${sentTx}\n` +
            `• Average Per Transaction: ${avgDistribution} SOL\n\n` +
            `💼 *Wallet Status*\n` +
            `• Current Balance: ${balance} SOL\n` +
            `• Total Received: ${totalReceived} SOL\n\n` +
            `🔄 *Last Updated*: ${currentDate}`;
          
          await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        } catch (error) {
          console.error('Error fetching distributed amount:', error.message);
          
          // Provide a more helpful error message
          let errorMessage = '⏱️ *API Timeout Error*\n\n';
          
          if (error.message.includes('timeout') || error.message.includes('15s limit') || error.message.includes('high load')) {
            errorMessage += 'The API is currently experiencing high load. Try again later or check the stats command for a summary.';
          } else if (error.message.includes('rate limit')) {
            errorMessage += 'The API is currently rate limited. Please try again in a few minutes.';
          } else if (error.message.includes('server error')) {
            errorMessage += 'The API server is experiencing issues. Please try again later.';
          } else {
            errorMessage = '❌ Error fetching distributed amount: ' + error.message;
          }
          
          bot.sendMessage(chatId, errorMessage, { parse_mode: 'Markdown' });
        }
      });

      // Transactions command - Shows recent transactions
      bot.onText(/\/transactions/, async (msg) => {
        const chatId = msg.chat.id;
        
        try {
          const statusMessage = await bot.sendMessage(chatId, '⏳ Fetching recent transactions...');
          
          // Set a timeout for the API request
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Request timed out after 8 seconds')), 8000)
          );
          
          // Create the actual fetch promise
          const fetchPromise = fetchFromAPI('/api/transactions?limit=5');
          
          // Race the fetch against the timeout
          const data = await Promise.race([fetchPromise, timeoutPromise])
            .catch(async (error) => {
              // If the first attempt fails, try with minimal data
              if (error.message.includes('timeout') || error.message.includes('15s limit')) {
                await bot.sendMessage(chatId, '⏳ First attempt timed out, trying with minimal data...');
                
                // Try with minimal data
                return fetchFromAPI('/api/transactions?limit=3&minimal=true');
              }
              throw error;
            });
          
          if (!data.success) {
            throw new Error(data.error?.message || 'Unknown error');
          }
          
          const transactions = data.transactions?.allTransactions || [];
          const currentDate = new Date().toLocaleString();
          
          if (transactions.length === 0) {
            await bot.sendMessage(chatId, '📝 *No Transactions Found*\n\nNo recent transactions were found in the database.', { parse_mode: 'Markdown' });
            return;
          }
          
          // Format the message with transaction data
          let message = `📝 *RECENT TRANSACTIONS*\n\n`;
          
          transactions.forEach((tx, index) => {
            const date = new Date(tx.timestamp || tx.blockTime * 1000).toLocaleString();
            const type = tx.type === 'sent' ? '🔴 Sent' : '🟢 Received';
            const amount = formatSol(tx.amount || "0.00");
            const signature = tx.signature ? tx.signature.replace(/([_*[\]()~`>#+=|{}.!-])/g, '\\$1') : '';
            
            message += `*${index + 1}. ${type}*: ${amount} SOL\n`;
            message += `   📅 ${date}\n`;
            if (signature) {
              message += `   🔗 [View on Solscan](https://solscan.io/tx/${signature})\n`;
            }
            message += '\n';
          });
          
          message += `🔄 *Last Updated*: ${currentDate}\n\n`;
          message += `Total Transactions: ${data.transactions?.totalStoredTransactions || transactions.length}`;
          
          await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        } catch (error) {
          console.error('Error fetching transactions:', error.message);
          
          // Provide a more helpful error message
          let errorMessage = '⏱️ *API Timeout Error*\n\n';
          
          if (error.message.includes('timeout') || error.message.includes('15s limit') || error.message.includes('high load')) {
            errorMessage += 'The API is currently experiencing high load. Try again later or check the stats command for a summary.';
          } else if (error.message.includes('rate limit')) {
            errorMessage += 'The API is currently rate limited. Please try again in a few minutes.';
          } else if (error.message.includes('server error')) {
            errorMessage += 'The API server is experiencing issues. Please try again later.';
          } else {
            errorMessage = '❌ Error fetching transactions: ' + error.message;
          }
          
          bot.sendMessage(chatId, errorMessage, { parse_mode: 'Markdown' });
        }
      });

      // Start command
      bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        
        let message = 
          "👋 Welcome to the SOL Distribution Tracker Bot!\n\n" +
          "This bot allows you to check statistics about SOL distributions.\n\n" +
          "Available commands:\n" +
          "/stats - View distribution statistics\n" +
          "/balance - Check distribution wallet balance\n" +
          "/balance [address] - Check any wallet's balance\n" +
          "/distributed - View total distributed amount\n" +
          "/transactions - View recent transactions\n" +
          "/help - Show this help message";
        
        bot.sendMessage(chatId, message);
        
        // If this is first run and no creator is set, suggest setup
        if (isFirstRun && botCreatorId === null) {
          setTimeout(() => {
            bot.sendMessage(
              chatId,
              "🔧 *First Run Setup*\n\n" +
              "It looks like this is the first run of the bot and no creator has been set.\n\n" +
              "If you are the bot creator, please run:\n" +
              "`/setup_creator`\n\n" +
              "This will register you as the bot administrator with full access to admin commands.",
              { parse_mode: 'Markdown' }
            );
          }, 1000);
        }
      });

      // Help command
      bot.onText(/\/help/, (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        
        let message = 
          "📚 *SOL Distribution Tracker Bot Help*\n\n" +
          "Available commands:\n\n" +
          "*/stats* - View distribution statistics\n" +
          "*/balance* - Check distribution wallet balance\n" +
          "*/balance [address]* - Check any wallet's balance\n" +
          "*/distributed* - View total distributed amount\n" +
          "*/transactions* - View recent transactions\n" +
          "*/help* - Show this help message\n\n";
        
        // Add admin commands if the user is an admin
        if (isAdmin(userId)) {
          message += 
            "*Admin Commands:*\n\n" +
            "*/force_refresh* - Force refresh all transactions\n" +
            "*/force_save* - Force save all data\n" +
            "*/fetch_all* - Fetch all transactions\n" +
            "*/status* - Check data collection status\n" +
            "*/stop_api* - Stop API data collection\n" +
            "*/stop* - Stop the bot (will restart automatically)\n";
          
          // Add creator-only commands if the user is the creator
          if (userId === botCreatorId) {
            message += 
              "\n*Creator Commands:*\n\n" +
              "*/add_admin [user_id]* - Add a new admin\n" +
              "*/remove_admin [user_id]* - Remove an admin\n";
          }
          
          message += 
            "\n*/list_admins* - List all administrators\n" +
            "*/admin [password]* - Authenticate as admin temporarily\n\n";
        }
        
        // Add setup command if no creator is set
        if (botCreatorId === null) {
          message += 
            "\n*Setup Commands:*\n\n" +
            "*/setup_creator* - Register as the bot creator (first run only)\n\n";
        }
        
        message += "For any issues, please contact the administrator.";
        
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      });

      // Log startup
      console.log('Bot started successfully!');
      
    } catch (error) {
      console.error(`Error initializing bot: ${error.message}`);
      console.log('Server will continue running for health checks');
    }
  }, 10000); // 10 second delay before initializing the bot
}

// Keep the process running even if the bot fails
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  console.log('Server will continue running for health checks');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  console.log('Server will continue running for health checks');
}); 