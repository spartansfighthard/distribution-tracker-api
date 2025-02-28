// Telegram bot module for local development
// This file is not used in Vercel deployment

// Check if we're in Vercel environment
const isVercel = process.env.VERCEL || false;

// Create a dummy bot for Vercel environment
const dummyBot = {
  sendMessage: async (chatId, message, options = {}) => {
    console.log(`[DUMMY BOT] Would send to ${chatId}: ${message}`);
    return null;
  },
  getBot: () => null
};

// If we're in Vercel, export the dummy bot and exit early
if (isVercel) {
  console.log('Running in Vercel environment, using dummy Telegram bot');
  module.exports = dummyBot;
  return;
}

// Only try to load the Telegram bot API if we're not in Vercel
let TelegramBot;
let bot = null;

try {
  // Only require the module if we're not in Vercel
  TelegramBot = require('node-telegram-bot-api');
  
  // Initialize the bot if we have a token
  if (process.env.TELEGRAM_BOT_TOKEN) {
    bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
    console.log('Telegram bot initialized successfully');
    
    // Set bot commands
    bot.setMyCommands([
      { command: 'stats', description: 'Show overall SOL statistics' },
      { command: 'distributed', description: 'Show SOL distribution data' },
      { command: 'sol', description: 'Show detailed SOL transfer statistics' },
      { command: 'refresh', description: 'Force refresh historical transaction data' },
      { command: 'help', description: 'Show this help message' }
    ]).then(() => {
      console.log('Bot commands set successfully');
    }).catch(error => {
      console.error('Error setting bot commands:', error);
    });
    
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
        // Implement stats fetching here
      } catch (error) {
        bot.sendMessage(chatId, `Error fetching statistics: ${error.message}`);
      }
    });
    
    bot.onText(/\/distributed/, async (msg) => {
      const chatId = msg.chat.id;
      try {
        bot.sendMessage(chatId, 'Fetching SOL distribution data...');
        // Implement distribution data fetching here
      } catch (error) {
        bot.sendMessage(chatId, `Error fetching distribution data: ${error.message}`);
      }
    });
    
    bot.onText(/\/sol/, async (msg) => {
      const chatId = msg.chat.id;
      try {
        bot.sendMessage(chatId, 'Fetching detailed SOL transfer statistics...');
        // Implement SOL transfer stats fetching here
      } catch (error) {
        bot.sendMessage(chatId, `Error fetching SOL transfer statistics: ${error.message}`);
      }
    });
    
    bot.onText(/\/refresh/, async (msg) => {
      const chatId = msg.chat.id;
      try {
        bot.sendMessage(chatId, 'Refreshing historical transaction data...');
        // Implement data refresh here
      } catch (error) {
        bot.sendMessage(chatId, `Error refreshing data: ${error.message}`);
      }
    });
  } else {
    console.log('Telegram bot not initialized: TELEGRAM_BOT_TOKEN not set');
  }
} catch (error) {
  console.warn('Failed to initialize Telegram bot:', error.message);
}

// Safe method to send messages that won't crash if the bot isn't initialized
async function sendMessage(chatId, message, options = {}) {
  if (bot) {
    try {
      return await bot.sendMessage(chatId, message, options);
    } catch (error) {
      console.error('Error sending Telegram message:', error);
    }
  } else {
    console.log('Telegram message not sent (bot not initialized):', message);
  }
  return null;
}

// Export the bot interface
module.exports = {
  sendMessage,
  getBot: () => bot
}; 