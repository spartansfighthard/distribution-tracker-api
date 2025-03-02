// Script to test the Telegram bot locally
require('dotenv').config({ path: '.env.bot' });
const TelegramBot = require('node-telegram-bot-api');

// Telegram bot token
const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is not defined in .env.bot file');
  process.exit(1);
}

console.log('Starting Telegram bot test...');
console.log(`Using token: ${token.substring(0, 5)}...${token.substring(token.length - 5)}`);

// Create a bot instance with polling disabled (just for testing)
const bot = new TelegramBot(token, { polling: false });

// Test bot.getMe() to verify the token is valid
async function testBot() {
  try {
    console.log('Testing bot connection...');
    const me = await bot.getMe();
    console.log('✅ Bot connection successful!');
    console.log('Bot info:', JSON.stringify(me, null, 2));
    
    // Test sending a message to yourself (optional)
    // Uncomment and replace with your Telegram user ID if you want to test sending messages
    /*
    const chatId = YOUR_TELEGRAM_USER_ID;
    console.log(`Sending test message to chat ID: ${chatId}...`);
    await bot.sendMessage(chatId, 'This is a test message from the SOL Distribution Tracker Bot.');
    console.log('✅ Message sent successfully!');
    */
    
    console.log('\nAll tests passed! The bot is configured correctly.');
    console.log('\nTo run the bot with polling enabled, use:');
    console.log('node telegram-bot.js');
  } catch (error) {
    console.error('❌ Bot test failed:', error.message);
    
    // Provide troubleshooting advice
    console.log('\nTroubleshooting steps:');
    console.log('1. Check if your TELEGRAM_BOT_TOKEN is correct');
    console.log('2. Verify that the bot is active in BotFather');
    console.log('3. Check if Telegram API is accessible from your network');
  }
}

// Run the test
testBot(); 