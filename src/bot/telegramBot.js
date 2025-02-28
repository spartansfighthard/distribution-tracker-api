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
    
    // Define bot commands
    bot.onText(/\/start/, (msg) => {
      const chatId = msg.chat.id;
      bot.sendMessage(chatId, 'Welcome to the SOL Distribution Tracker Bot!');
    });
    
    bot.onText(/\/help/, (msg) => {
      const chatId = msg.chat.id;
      bot.sendMessage(chatId, 'Available commands:\n/start - Start the bot\n/help - Show this help message\n/stats - Show distribution statistics');
    });
    
    bot.onText(/\/stats/, async (msg) => {
      const chatId = msg.chat.id;
      try {
        bot.sendMessage(chatId, 'Fetching statistics...');
        // You can implement actual stats fetching here
      } catch (error) {
        bot.sendMessage(chatId, `Error fetching statistics: ${error.message}`);
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