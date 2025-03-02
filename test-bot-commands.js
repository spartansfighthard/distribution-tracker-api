/**
 * Test Bot Commands
 * 
 * This script tests the bot commands by sending messages to the bot and logging the responses.
 * It uses the Telegram Bot API directly to send messages to the bot.
 */

const fetch = require('node-fetch');
require('dotenv').config();

// Get the bot token from environment variables
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Your Telegram user ID (you can get this from @userinfobot on Telegram)
// Replace with your actual user ID
const YOUR_CHAT_ID = 'YOUR_CHAT_ID'; // Replace with your actual chat ID

// Commands to test
const commands = [
  '/start',
  '/stats',
  '/balance',
  '/distributed',
  '/transactions',
  '/help'
];

// Function to send a message to the bot
async function sendMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
    }),
  });
  
  return await response.json();
}

// Function to test all commands
async function testCommands() {
  console.log('Testing bot commands...');
  
  if (!TELEGRAM_BOT_TOKEN) {
    console.error('Error: TELEGRAM_BOT_TOKEN is not set in environment variables');
    return;
  }
  
  if (YOUR_CHAT_ID === 'YOUR_CHAT_ID') {
    console.error('Error: Please replace YOUR_CHAT_ID with your actual Telegram chat ID');
    console.log('You can get your chat ID by sending a message to @userinfobot on Telegram');
    return;
  }
  
  for (const command of commands) {
    console.log(`\nSending command: ${command}`);
    try {
      const result = await sendMessage(YOUR_CHAT_ID, command);
      if (result.ok) {
        console.log('✅ Message sent successfully');
      } else {
        console.error(`❌ Error sending message: ${result.description}`);
      }
    } catch (error) {
      console.error(`❌ Error: ${error.message}`);
    }
    
    // Wait 2 seconds between commands to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log('\nCommand testing complete!');
}

// Run the test
console.log('=== Bot Command Test ===');
console.log('This script will send test commands to your bot.');
console.log('Make sure the bot is running before executing this script.');
console.log('');

// Check if we should run the test
if (process.argv.includes('--run')) {
  testCommands();
} else {
  console.log('To run the test, use: node test-bot-commands.js --run');
  console.log('Before running, make sure to:');
  console.log('1. Replace YOUR_CHAT_ID with your actual Telegram chat ID');
  console.log('2. Ensure the TELEGRAM_BOT_TOKEN is set in your .env file');
  console.log('3. Make sure the bot is running');
} 