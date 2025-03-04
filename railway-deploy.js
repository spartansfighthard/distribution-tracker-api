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

      // Helper functions and command handlers would go here
      // ...

      // Start command
      bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        bot.sendMessage(
          chatId,
          "👋 *Welcome to the SOL Distribution Tracker Bot!*\n\n" +
          "This bot helps you track SOL distribution transactions.\n\n" +
          "Use /help to see available commands.",
          { parse_mode: 'Markdown' }
        );
      });

      // Help command
      bot.onText(/\/help/, (msg) => {
        const userId = msg.from.id;
        const chatId = msg.chat.id;
        
        let message = 
          "🤖 *SOL Distribution Tracker Bot*\n\n" +
          "*Available Commands:*\n\n" +
          "*/start* - Start the bot\n" +
          "*/help* - Show this help message\n" +
          "*/stats* - Show distribution statistics\n" +
          "*/refresh* - Refresh distribution data\n";
        
        // Add admin commands if the user is an admin
        if (isAdmin(userId)) {
          message += 
            "\n*Admin Commands:*\n\n" +
            "*/force_refresh* - Force refresh all data\n" +
            "*/force_save* - Force save current data\n" +
            "*/fetch_all* - Fetch all transactions\n";
          
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