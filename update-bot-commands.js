require('dotenv').config({ path: '.env.bot' });
const TelegramBot = require('node-telegram-bot-api');

// Telegram bot token
const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is not defined in .env.bot file');
  process.exit(1);
}

// Create a bot instance without polling (just for admin commands)
const bot = new TelegramBot(token, { polling: false });

// Define the commands to set
const commands = [
  { command: 'start', description: 'Start the bot and get welcome message' },
  { command: 'stats', description: 'Get current distribution statistics' },
  { command: 'balance', description: 'Check wallet balance (use with address to check any wallet)' },
  { command: 'distributed', description: 'View total distributed amount' },
  { command: 'transactions', description: 'Get recent transaction count' },
  { command: 'refresh', description: 'Force refresh transaction data' },
  { command: 'help', description: 'Show help message' }
];

async function updateBotCommands() {
  try {
    console.log('Updating bot commands...');
    
    // Get bot info
    const botInfo = await bot.getMe();
    console.log(`Connected to bot: ${botInfo.first_name} (@${botInfo.username})`);
    
    // Set bot commands
    const result = await bot.setMyCommands(commands);
    
    if (result) {
      console.log('✅ Bot commands updated successfully!');
      console.log('New command list:');
      commands.forEach(cmd => {
        console.log(`/${cmd.command} - ${cmd.description}`);
      });
    } else {
      console.error('❌ Failed to update bot commands');
    }
  } catch (error) {
    console.error('Error updating bot commands:', error.message);
  }
}

// Run the update
updateBotCommands();