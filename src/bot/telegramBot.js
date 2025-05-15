// Telegram bot for tracking Solana distribution wallet
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

// Import global storage
require('./botGlobals');

// Import heliusService
const heliusService = require('../services/heliusService');

// Import fileStorage
const fileStorage = require('../services/fileStorage');

// Initialize fileStorage
fileStorage.initialize();

// Create a config object from environment variables
const config = {
  DISTRIBUTION_WALLET_ADDRESS: process.env.DISTRIBUTION_WALLET_ADDRESS,
  HELIUS_API_KEY: process.env.HELIUS_API_KEY,
  HELIUS_RPC_URL: process.env.HELIUS_RPC_URL,
  SOLANA_RPC_URL: process.env.SOLANA_RPC_URL,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN
};

// Helper function to validate dates
function isValidDate(dateString) {
  if (!dateString) return false;
  const date = new Date(dateString);
  return !isNaN(date.getTime());
}

// Check if we have a token
if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN not found in environment variables');
  module.exports = {
    sendMessage: async (chatId, message, options = {}) => {
      console.log(`[DUMMY BOT] Would send to ${chatId}: ${message}`);
      return null;
    }
  };
  return;
}

// Using the exact same pattern as our working echo-bot test
const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error('❌ TELEGRAM_BOT_TOKEN not found in environment variables');
  module.exports = {
    sendMessage: async (chatId, message, options = {}) => {
      console.log(`[DUMMY BOT] Would send to ${chatId}: ${message}`);
      return null;
    }
  };
  return;
}

// Command statistics tracking
const commandStats = {
  start: 0,
  help: 0,
  test: 0,
  stats: 0,
  balance: 0,
  distributed: 0,
  transactions: 0,
  refresh: 0,
  commandStats: 0, // Track usage of the commandStats command itself
  total: 0, // Total commands executed
  lastUsed: null,
  // Track unique users
  uniqueUsers: new Set()
};

// Ensure total property exists
if (typeof commandStats.total === 'undefined') {
  commandStats.total = 0;
}

// Function to update command stats
function updateCommandStats(command, userId) {
  try {
    if (!global.storage || !global.storage.data) {
      console.error('Storage not available for command stats');
      return;
    }
    
    // Initialize commandStats if it doesn't exist
    if (!global.storage.data.commandStats) {
      global.storage.data.commandStats = {};
    }
    
    // Initialize command entry if it doesn't exist
    if (!global.storage.data.commandStats[command]) {
      global.storage.data.commandStats[command] = {
        count: 0,
        users: {}
      };
    }
    
    // Update command count
    global.storage.data.commandStats[command].count = (global.storage.data.commandStats[command].count || 0) + 1;
    
    // Update user count if userId is provided
  if (userId) {
      if (!global.storage.data.commandStats[command].users) {
        global.storage.data.commandStats[command].users = {};
      }
      global.storage.data.commandStats[command].users[userId] = (global.storage.data.commandStats[command].users[userId] || 0) + 1;
    }
    
    // Save command stats to file
    const fs = require('fs');
    const path = require('path');
    const dataDir = path.join(process.cwd(), 'data');
    const commandStatsFile = path.join(dataDir, 'command_stats.json');
    
    // Ensure data directory exists
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    // Save command stats to file
    fs.writeFileSync(
      commandStatsFile,
      JSON.stringify(global.storage.data.commandStats, null, 2)
    );
    
    debugLog(`Command stats updated: ${command} (${global.storage.data.commandStats[command].count} times), total: ${Object.keys(global.storage.data.commandStats).length}`);
  } catch (error) {
    console.error('Error updating command stats:', error);
  }
}

// Create a bot that uses 'polling' to fetch new updates
const bot = new TelegramBot(token, { polling: true });

// Log startup
console.log('🤖 Telegram bot started');

// Check if we have the distribution wallet address
if (!process.env.DISTRIBUTION_WALLET_ADDRESS) {
  console.warn('⚠️ DISTRIBUTION_WALLET_ADDRESS not set in environment variables');
}

// Check if we have the Helius API key
if (!process.env.HELIUS_API_KEY) {
  console.warn('⚠️ HELIUS_API_KEY not set in environment variables');
}

// Add this near the top of the file with other global variables
let continuousRefreshEnabled = false;
let refreshInterval = null;
const REFRESH_INTERVAL_MINUTES = 5; // Run every 5 minutes
let currentRefreshProgress = {
  isRefreshing: false,
  percent: 0,
  processedCount: 0,
  totalCount: 0,
  statusMessage: ''
};

// Add this variable near the top of the file with other global variables
let progressUpdateInterval = null;
const PROGRESS_UPDATE_INTERVAL = 10000; // Send progress updates every 10 seconds

// Add these utility functions at the top of the file
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function retryWithBackoff(operation, maxRetries = 3, initialDelay = 1000) {
  let retries = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      retries++;
      if (retries > maxRetries) {
        throw error;
      }
      
      // Check if it's a timeout error
      if (error.message.includes('timeout') || error.message.includes('504')) {
        const delay = initialDelay * Math.pow(2, retries - 1);
        console.log(`Retry ${retries}/${maxRetries} after ${delay}ms due to timeout`);
        await sleep(delay);
        continue;
      }
      
      // For other errors, throw immediately
      throw error;
    }
  }
}

// Command handlers
bot.onText(/\/start/, handleStartCommand);
bot.onText(/\/help/, handleHelpCommand);
bot.onText(/\/stats/, handleStatsCommand);
bot.onText(/\/balance(?:\s+(.+))?/, handleBalanceCommand);
bot.onText(/\/refresh(?:\s+(.+))?/, handleRefreshCommand);
bot.onText(/\/cleardata/, handleClearDataCommand);
bot.onText(/\/search\s+(.+)/, handleSearchCommand);
bot.onText(/\/fixstats/, async (msg) => {
  try {
    const chatId = msg.chat.id;
    debugLog(`Handling /fixstats command from ${msg.from?.id} in chat ${chatId}`);
    
    // Update command stats
    updateCommandStats('/fixstats', msg.from?.id);
    
    // Fix the stats
    await fixStats(chatId);
  } catch (error) {
    console.error('Error in handleFixStatsCommand:', error);
    bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
  }
});

// Add a new command handler for fullstats
bot.onText(/\/fullstats/, async (msg) => {
  const chatId = msg.chat.id;
  await displayStats(chatId, true);
});

// Add a command handler for refreshstats
bot.onText(/\/refreshstats/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    // Send a loading message
    const loadingMessage = await bot.sendMessage(chatId, '🔄 Recalculating statistics...');
    
    // Fix stats but don't display them yet
    const stats = await fixStats(chatId, false);
    
    if (stats) {
      await bot.editMessageText('✅ Statistics have been recalculated successfully!', {
        chat_id: chatId,
        message_id: loadingMessage.message_id
      });
      
      // Display the stats
      await displayStats(chatId);
    } else {
      await bot.editMessageText('❌ Failed to recalculate statistics. Please check the logs.', {
        chat_id: chatId,
        message_id: loadingMessage.message_id
      });
    }
  } catch (error) {
    console.error('Error in refreshstats command:', error);
    await bot.sendMessage(chatId, `❌ Error recalculating statistics: ${error.message}`);
  }
});

// At the beginning of the file, add this debug function
function debugLog(message) {
  console.log(`[DEBUG] ${new Date().toISOString()}: ${message}`);
}

// Handle /start command
function handleStartCommand(msg) {
  try {
  const chatId = msg.chat.id;
    debugLog(`Handling /start command from ${msg.from?.id} in chat ${chatId}`);
  
  // Update command stats
  updateCommandStats('/start', msg.from?.id);
  
    bot.sendMessage(chatId, 'Welcome to the Solana Distribution Tracker Bot! Use /help to see available commands.')
      .then(() => {
        debugLog(`Sent welcome message to chat ${chatId}`);
        
        // Start automatic stats messages for this chat
        startAutomaticStatsMessages(chatId);
        
        // Notify user about automatic stats
        setTimeout(() => {
          bot.sendMessage(
            chatId,
            `📊 *Automatic Stats Update*\n\n` +
            `The bot will automatically send updated statistics every 15 minutes.\n\n` +
            `You can still request stats anytime with the /stats command.`,
            { parse_mode: 'Markdown' }
          ).catch(err => console.error(`Error sending stats notification: ${err.message}`));
        }, 2000);
      })
      .catch(err => console.error(`Error sending welcome message: ${err.message}`));
  } catch (error) {
    console.error('Error in handleStartCommand:', error);
  }
}

// Handle /help command
function handleHelpCommand(msg) {
  try {
  const chatId = msg.chat.id;
    debugLog(`Handling /help command from ${msg.from?.id} in chat ${chatId}`);
  
  // Update command stats
  updateCommandStats('/help', msg.from?.id);
  
    const helpText = `
🤖 *Solana Distribution Tracker Bot Commands*

📊 *Statistics Commands*
• /stats - Show basic transaction statistics
• /fullstats - Show detailed transaction statistics
• /balance [address] - Check balance of an address (defaults to distribution wallet)
• /search [address] - Search for transactions sent to a specific wallet

🔄 *Data Management*
• /refresh - Manually refresh transaction data
• /fixstats - Fix transaction statistics (with detailed messages)
• /fixstatsnow - Fix statistics silently
• /resetstats - Reset statistics and refresh (best fix for wrong counts)
• /cleardata - Clear all stored data and reset the bot

ℹ️ *Other Commands*
• /start - Start the bot
• /help - Show this help message

🔧 *Troubleshooting*
If you see incorrect transaction counts or statistics, try these steps:
1. Use /fixstatsnow to quickly recalculate statistics
2. If that doesn't work, use /resetstats to fix and refresh data
3. For persistent issues, use /cleardata to reset the bot completely

Thank you for using the Solana Distribution Tracker!
`;
    
    bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' })
      .then(() => debugLog(`Sent help message to chat ${chatId}`))
      .catch(err => console.error(`Error sending help message: ${err.message}`));
  } catch (error) {
    console.error('Error in handleHelpCommand:', error);
  }
}

// Handle /test command
function handleTestCommand(msg) {
  const chatId = msg.chat.id;
  console.log(`Handling /test command from ${msg.from?.id}`);
  
  // Update command stats
  updateCommandStats('/test', msg.from?.id);
  
  bot.sendMessage(chatId, 'Bot is working! 🎉');
}

// Handle /stats command
async function handleStatsCommand(msg) {
  try {
  const chatId = msg.chat.id;
    debugLog(`Handling /stats command from ${msg.from?.id} in chat ${chatId}`);
  
  // Update command stats
  updateCommandStats('/stats', msg.from?.id);
  
  try {
    await displayStats(chatId);
  } catch (error) {
    console.error('Error in /stats command:', error);
      bot.sendMessage(chatId, `❌ Error: ${error.message}`)
        .catch(err => console.error(`Error sending error message: ${err.message}`));
    }
  } catch (error) {
    console.error('Error in handleStatsCommand:', error);
  }
}

// Display statistics for transactions
async function displayStats(chatId, additionalInfo = false, inProgress = false) {
  try {
    // Enhanced error handling and logging
    if (!global.storage) {
      console.error('❌ global.storage is undefined or null');
      await bot.sendMessage(chatId, "❌ Storage is not initialized. Try restarting the bot.");
      return;
    }
    
    if (!global.storage.data) {
      console.error('❌ global.storage.data is undefined or null');
      await bot.sendMessage(chatId, "❌ No data available. Run /refresh first.");
      return;
    }
    
    // Initialize stats if needed
    if (!global.storage.data.stats) {
      console.log('Stats object missing, initializing');
      global.storage.data.stats = {
        totalTransactions: 0,
        processedTransactions: 0,
        sentCount: 0,
        receivedCount: 0,
        interactionCount: 0,
        unknownCount: 0,
        totalSent: 0,
        totalReceived: 0,
        currentBalance: 0,
        lastCalculated: new Date().toISOString(),
        lastUpdated: new Date().toISOString()
      };
    }
    
    const stats = global.storage.data.stats;
    const transactions = global.storage.data.transactions || [];
    
    console.log(`Displaying stats with ${transactions.length} transactions. Stats keys: ${Object.keys(stats).join(', ')}`);
    
    // Verify and correct transaction counts if needed
    if (transactions.length > 0) {
      // Ensure total transaction count matches actual transaction count
      if (stats.totalTransactions !== transactions.length) {
        console.log(`Fixing totalTransactions from ${stats.totalTransactions} to ${transactions.length}`);
        stats.totalTransactions = transactions.length;
        stats.processedTransactions = transactions.length;
      }
      
      // Check if we need to recalculate transaction counts
      const hasZeroCounts = 
        (stats.sentCount || 0) === 0 && 
        (stats.receivedCount || 0) === 0 && 
        (stats.interactionCount || 0) === 0 && 
        (stats.unknownCount || 0) === 0;
      
      // If counts are all zero but we have transactions, recalculate
      if (hasZeroCounts && transactions.length > 0 && !inProgress) {
        console.log('Transaction counts are zero but transactions exist, recalculating...');
        
        // Get heliusService
        const heliusService = require('../services/heliusService');
        
        // Recalculate stats
        const recalculatedStats = heliusService.calculateStatistics(transactions);
        
        // Preserve any existing fields not in recalculated stats
        const updatedStats = {...stats, ...recalculatedStats};
        global.storage.data.stats = updatedStats;
        
        // Save the updated stats
        try {
          await fileStorage.saveData(global.storage.data);
          console.log('Saved recalculated stats');
        } catch (saveError) {
          console.error('Error saving recalculated stats:', saveError);
        }
      }
    }
    
    // Build statistics message
    let statsMessage = "";
    
    // Add clear indication if stats are in-progress
    if (inProgress) {
      statsMessage += "🔄 *LIVE Transaction Statistics (Updating)*\n";
      statsMessage += "_Statistics are updating as transactions are processed_\n\n";
      } else {
      statsMessage += "📊 *Transaction Statistics:*\n\n";
    }
    
    // Add processing status
    statsMessage += "⚙️ *Processing Status:*\n";
    statsMessage += `• Processed Transactions: ${stats.processedTransactions || 0}\n`;
    statsMessage += `• Processing Rate: ${stats.processingRate || '100'}%\n\n`;
    
    // Transaction counts
    statsMessage += "📝 *Transaction Counts:*\n";
    statsMessage += `• Total Transactions: ${stats.totalTransactions || 0}\n`;
    statsMessage += `• Sent: ${stats.sentCount || 0}\n`;
    statsMessage += `• Received: ${stats.receivedCount || 0}\n`;
    statsMessage += `• Interaction: ${stats.interactionCount || 0}\n`;
    statsMessage += `• Unknown: ${stats.unknownCount || 0}\n`;
    
    // Financial statistics
    statsMessage += "\n💰 *Financial Summary:*\n";
    statsMessage += `• Total Sent: ${(stats.totalSent || 0).toFixed(9)} SOL\n`;
    statsMessage += `• Total Received: ${(stats.totalReceived || 0).toFixed(9)} SOL\n`;
    statsMessage += `• Current Balance: ${(stats.currentBalance || 0).toFixed(9)} SOL\n`;
    statsMessage += `• Net Change: ${((stats.totalReceived || 0) - (stats.totalSent || 0)).toFixed(9)} SOL\n`;
    
    // Find the most recent sent transaction
    let lastDistribution = null;
    if (transactions && transactions.length > 0) {
      // Filter sent transactions
      const sentTransactions = transactions.filter(tx => tx.type === 'sent');
      if (sentTransactions.length > 0) {
        // Sort by timestamp (newest first)
        const sortedSentTx = [...sentTransactions].sort((a, b) => {
          if (!a.timestamp) return 1;
          if (!b.timestamp) return -1;
          return new Date(b.timestamp) - new Date(a.timestamp);
        });
        
        // Get the most recent one
        lastDistribution = sortedSentTx[0];
      }
    }
    
    // Add last distribution if found - displayed above timestamps section
    if (lastDistribution && lastDistribution.timestamp) {
      statsMessage += `\n💸 *Last Distribution Sent:* ${new Date(lastDistribution.timestamp).toLocaleString()}\n`;
      
      // Add recipient address if available
      if (lastDistribution.receiver) {
        const shortAddr = `${lastDistribution.receiver.substring(0, 8)}...${lastDistribution.receiver.substring(lastDistribution.receiver.length - 8)}`;
        statsMessage += `• Sent to: \`${shortAddr}\`\n`;
      }
      
      // Add amount if available
      if (lastDistribution.amount) {
        statsMessage += `• Amount: ${formatSol(lastDistribution.amount)} SOL\n`;
      }
    }
    
    // Add timestamp information
    statsMessage += "\n🕒 *Timestamps:*\n";
    statsMessage += `• Last Updated: ${new Date().toLocaleString()} UTC\n`;
    
    // Add rate statistics
    statsMessage += "\n📈 *Transaction Rates:*\n";
    if (stats.lastCalculated && stats.initializedAt) {
      const timeSpan = (new Date(stats.lastCalculated) - new Date(stats.initializedAt)) / (1000 * 60 * 60 * 24); // days
      if (timeSpan > 0) {
        const dailyAverage = stats.totalTransactions / timeSpan;
        statsMessage += `• Daily Average: ${dailyAverage.toFixed(2)} transactions\n`;
      }
    }
    
    // Add error statistics if available
    if (stats.errorCount || stats.errorTypes) {
      statsMessage += "\n⚠️ *Error Statistics:*\n";
      statsMessage += `• Total Errors: ${stats.errorCount || 0}\n`;
      if (stats.errorTypes) {
        Object.entries(stats.errorTypes).forEach(([type, count]) => {
          statsMessage += `• ${type}: ${count}\n`;
        });
      }
    }
    
    // Add performance metrics
    if (additionalInfo) {
      statsMessage += "\n⚡ *Performance Metrics:*\n";
      statsMessage += `• Average Processing Time: ${stats.averageProcessingTime || 'N/A'} ms\n`;
      statsMessage += `• Success Rate: ${stats.successRate || '100'}%\n`;
    }
    
    // Add note about detailed statistics
    if (!additionalInfo) {
      statsMessage += "\n💡 Use /fullstats to see more detailed statistics";
    }
    
    // Add this at the top of the statistics message if in-progress
    if (inProgress) {
      statsMessage = "🔄 *In-Progress Transaction Statistics*\n" +
                     "These stats are continuously updating as transactions are processed.\n\n" + 
                     statsMessage;
    }
    
    // Add progress indicator if in-progress
    if (inProgress) {
      statsMessage += "\n🔄 *Current Progress:*\n";
      
      if (currentRefreshProgress) {
        if (currentRefreshProgress.phase) {
          statsMessage += `• Phase: ${currentRefreshProgress.phase.charAt(0).toUpperCase() + 
                          currentRefreshProgress.phase.slice(1)}\n`;
        }
        if (typeof currentRefreshProgress.processedCount === 'number') {
          statsMessage += `• Processed: ${currentRefreshProgress.processedCount}`;
          if (typeof currentRefreshProgress.totalCount === 'number') {
            statsMessage += `/${currentRefreshProgress.totalCount}`;
          }
          statsMessage += '\n';
        }
        if (typeof currentRefreshProgress.percent === 'number') {
          statsMessage += `• Progress: ${Math.round(currentRefreshProgress.percent)}%\n`;
        }
      }
      
      if (refreshStartTime) {
        const elapsed = formatTime(Math.floor((Date.now() - refreshStartTime) / 1000));
        statsMessage += `• Elapsed time: ${elapsed}\n`;
      }
    }
    
    // Send the message
    try {
      await bot.sendMessage(chatId, statsMessage, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });
    } catch (markdownError) {
      console.error('Error sending Markdown message, trying with HTML:', markdownError);
      // Try with HTML instead if Markdown fails
      const htmlStatsMessage = statsMessage
        .replace(/\*/g, '<b>')
        .replace(/\*/g, '</b>')
        .replace(/_/g, '<i>')
        .replace(/_/g, '</i>');
        
      try {
        await bot.sendMessage(chatId, htmlStatsMessage, {
          parse_mode: 'HTML',
          disable_web_page_preview: true
        });
      } catch (htmlError) {
        console.error('Error sending HTML message, trying without formatting:', htmlError);
        // Try without any formatting if HTML also fails
        await bot.sendMessage(chatId, statsMessage.replace(/[\*_]/g, ''), {
          disable_web_page_preview: true
        });
      }
    }
    
    } catch (error) {
    console.error('Error displaying statistics:', error);
    await bot.sendMessage(chatId, `❌ Error displaying statistics: ${error.message}`);
  }
}

// Handle /balance command
async function handleBalanceCommand(msg, match) {
  const chatId = msg.chat.id;
  console.log(`Handling /balance command from ${msg.from?.id}`);
  
  // Update command stats
  updateCommandStats('/balance', msg.from?.id);
  
  try {
    // Display balance for the specified address or the distribution wallet
    displayBalance(chatId, match);
  } catch (error) {
    console.error('Error in /balance command:', error);
    bot.sendMessage(chatId, `❌ Error: ${error.message}`);
  }
}

// Function to display balance
function displayBalance(chatId, match) {
  // Get the wallet address from the command
  const walletAddress = match[2] ? match[2].trim() : null;
  
  // If no address provided, show the distribution wallet balance
  if (!walletAddress) {
    // Get the distribution wallet balance
    global.getWalletBalance()
      .then(balance => {
        bot.sendMessage(chatId, `💰 Distribution wallet balance: ${balance.toFixed(12)} SOL`);
      })
      .catch(error => {
        console.error('Error getting distribution wallet balance:', error);
        bot.sendMessage(chatId, `❌ Error getting distribution wallet balance: ${error.message}`);
      });
    return;
  }
  
  // Show a loading message
  bot.sendMessage(chatId, `🔍 Checking balance for wallet: ${walletAddress}...`)
    .then(loadingMessage => {
      // Get the wallet balance
      global.getWalletBalance(walletAddress)
        .then(balance => {
          // Update the loading message with the balance
          bot.editMessageText(`💰 Wallet balance: ${balance.toFixed(12)} SOL\n\n🔄 Fetching transaction history...`, {
            chat_id: chatId,
            message_id: loadingMessage.message_id
          });
          
          // Get total sent to this wallet from the distribution wallet
          const heliusService = require('../services/heliusService');
          heliusService.getTotalSentToWallet(walletAddress)
            .then(result => {
              // Update the message with the full details
              bot.editMessageText(
                `💰 Wallet: ${walletAddress}\n\n` +
                `• Current balance: ${balance.toFixed(12)} SOL\n` +
                `• Total received from distribution: ${result.totalReceived.toFixed(12)} SOL\n` +
                `• Total sent to distribution: ${result.totalSent.toFixed(12)} SOL\n` +
                `• Number of transactions: ${result.transactionCount}`, {
                  chat_id: chatId,
                  message_id: loadingMessage.message_id
                });
            })
            .catch(error => {
              console.error('Error getting transaction history:', error);
              bot.editMessageText(
                `💰 Wallet balance: ${balance.toFixed(12)} SOL\n\n` +
                `❌ Error fetching transaction history: ${error.message}`, {
                  chat_id: chatId,
                  message_id: loadingMessage.message_id
                });
            });
        })
        .catch(error => {
          console.error('Error getting wallet balance:', error);
          bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        });
    })
    .catch(error => {
      console.error('Error sending loading message:', error);
      bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    });
}

// Handle /refresh command
function handleRefreshCommand(msg, match) {
  try {
  const chatId = msg.chat.id;
    debugLog(`Handling /refresh command from ${msg.from?.id} in chat ${chatId}`);
  
  // Update command stats
  updateCommandStats('/refresh', msg.from?.id);
    
    // Check if a refresh is already in progress
    if (global.storage && global.storage.isRefreshing) {
      return bot.sendMessage(chatId, '⏳ A refresh is already in progress. Please wait for it to complete.');
    }
    
    // Send initial loading message
    bot.sendMessage(
      chatId, 
      '🔄 Starting full transaction refresh...\n\nThis will fetch ALL transactions from the Solana blockchain and may take several minutes to complete.',
      { parse_mode: 'Markdown' }
    )
    .then(sentMsg => {
      // Start the refresh process with the message ID for updates
      refreshTransactionsDirectly(chatId, sentMsg.message_id, true);
    })
    .catch(error => {
      console.error('Error sending initial refresh message:', error);
      bot.sendMessage(chatId, `❌ Error: ${error.message}`);
      });
  } catch (error) {
    console.error('Error in handleRefreshCommand:', error);
    bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
  }
}

// Handle callback queries
bot.on('callback_query', async (callbackQuery) => {
  try {
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    const data = callbackQuery.data;
    
    // Handle other callback queries here
    // (Removed the refresh_solana_confirm and refresh_solana_cancel handlers as they're no longer needed)
    
    // Always answer the callback query to remove the loading state
    await bot.answerCallbackQuery(callbackQuery.id);
  } catch (error) {
    console.error('Error handling callback query:', error);
    
    // Try to answer the callback query even if there was an error
    try {
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: 'An error occurred. Please try again.',
        show_alert: true
      });
    } catch (answerError) {
      console.error('Error answering callback query:', answerError);
    }
  }
});

// Add this function to fix stats silently (without sending messages)
async function fixStatsQuietly() {
  try {
    if (!global.storage || !global.storage.data) {
      console.error("Storage not initialized");
      return null;
    }
    
    const transactions = global.storage.data.transactions || [];
    
    if (transactions.length === 0) {
      console.error("No transactions found in storage");
      return null;
    }
    
    console.log(`Silently fixing stats for ${transactions.length} transactions...`);
    
    // Get the wallet address
    const walletAddress = process.env.DISTRIBUTION_WALLET_ADDRESS;
    if (!walletAddress) {
      console.error("No wallet address configured");
      return null;
    }
    
    // Get heliusService
    const heliusService = require('../services/heliusService');
    
    // Use the heliusService's calculateStatistics function for more accurate statistics
    if (heliusService && typeof heliusService.calculateStatistics === 'function') {
      console.log(`Using heliusService.calculateStatistics for ${transactions.length} transactions`);
      const stats = heliusService.calculateStatistics(transactions);
      
      // Save the updated stats
      if (global.storage.data) {
        global.storage.data.stats = stats;
        console.log(`Updated stats with heliusService.calculateStatistics:`, {
          totalTransactions: stats.totalTransactions,
          processedTransactions: stats.processedTransactions,
          sentCount: stats.sentCount,
          receivedCount: stats.receivedCount,
          interactionCount: stats.interactionCount,
          unknownCount: stats.unknownCount,
          externalCount: stats.externalCount,
          totalSent: stats.totalSent,
          totalReceived: stats.totalReceived
        });
        
        // Get current balance from blockchain (if possible)
        try {
          const currentBalance = await heliusService.getWalletBalance(walletAddress);
          stats.currentBalance = currentBalance;
          console.log(`Got current balance from blockchain: ${currentBalance}`);
        } catch (error) {
          console.log(`Error fetching current balance: ${error.message}`);
          // Keep calculated balance as fallback
        }
        
        // Update the timestamps
        stats.lastCalculated = new Date().toISOString();
        stats.lastUpdated = new Date().toISOString();
        
        // If we have file storage methods, save to file
        if (fileStorage && typeof fileStorage.saveData === 'function') {
          try {
            await fileStorage.saveData(global.storage.data);
            console.log(`Saved updated stats to file`);
            return stats;
          } catch (saveError) {
            console.error(`Error saving stats to file:`, saveError);
            return null;
          }
        }
        return stats;
      }
    }
    return null;
  } catch (error) {
    console.error('Error in fixStatsQuietly:', error);
    return null;
  }
}

// Update the getProgressText function to make it more resilient
function getProgressText(progress, startTime) {
  try {
    if (!progress) return '🔄 Processing...';
    
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const elapsedText = formatTime(elapsed);
    
    let percentText = '';
    if (typeof progress.percent === 'number') {
      percentText = `${Math.round(progress.percent)}%`;
    }
    
    let phaseText = '';
    if (progress.phase) {
      phaseText = `${progress.phase.charAt(0).toUpperCase() + progress.phase.slice(1)}`;
    }
    
    let countText = '';
    if (typeof progress.processedCount === 'number' && typeof progress.totalCount === 'number') {
      countText = `${progress.processedCount}/${progress.totalCount}`;
    } else if (typeof progress.processedCount === 'number') {
      countText = `${progress.processedCount}`;
    }
    
    // Build the final progress text
    let text = `🔄 *${phaseText || 'Processing'}*\n\n`;
    
    if (percentText) {
      text += `• Progress: ${percentText}\n`;
    }
    
    if (countText) {
      text += `• Count: ${countText}\n`;
    }
    
    text += `• Elapsed: ${elapsedText}\n`;
    
    if (progress.message) {
      text += `• Status: ${progress.message}\n`;
    }
    
    return text;
      } catch (error) {
    console.error('Error generating progress text:', error);
    return '🔄 Processing...';
  }
}

// Modify refreshTransactionsDirectly to be more robust
async function refreshTransactionsDirectly(chatId, messageId, fullRefresh = false) {
  try {
    // Check if already refreshing
    if (global.storage.isRefreshing) {
      try {
        await bot.sendMessage(chatId, '⚠️ Refresh already in progress');
      } catch (sendError) {
        console.error('Error sending message:', sendError);
      }
      return;
    }

    // Set refreshing flag
    global.storage.isRefreshing = true;
    refreshStartTime = Date.now(); // Initialize refresh start time
    
    // Initialize refresh progress
    currentRefreshProgress = {
      isRefreshing: true,
      percent: 0,
      processedCount: 0,
      totalCount: 0,
      statusMessage: 'Starting refresh...'
    };

    // Send initial loading message if we don't have a messageId
    let loadingMessage;
    let loadingMessageId = messageId;
    if (!loadingMessageId) {
      try {
        loadingMessage = await bot.sendMessage(chatId, '🔍 Loading transactions...');
        loadingMessageId = loadingMessage.message_id;
      } catch (sendError) {
        console.error('Error sending loading message:', sendError);
      }
    }

    // Variables for tracking progress updates
    let lastProgressPercent = 0;
    let lastProgressPhase = '';
    let lastProgressUpdate = 0;
    let startTime = Date.now();
    let lastStatsDisplay = 0;

    // Set up refresh timeout (2 hours)
    const refreshTimeout = setTimeout(() => {
      console.log('Refresh timed out after 2 hours');
        global.storage.isRefreshing = false;
      try {
        bot.sendMessage(chatId, '⚠️ Refresh timed out after 2 hours. Please try again.');
      } catch (error) {
        console.error('Error sending timeout message:', error);
      }
    }, 2 * 60 * 60 * 1000);

    try {
      // Get the heliusService
      const heliusService = require('../services/heliusService');
      
      // Get the wallet address
      const walletAddress = process.env.DISTRIBUTION_WALLET_ADDRESS;
      if (!walletAddress) {
        throw new Error('No wallet address configured');
      }
      
      console.log(`Refreshing transactions for wallet: ${walletAddress}`);
      
      // Define a progress callback to update the loading message
    const progressCallback = async (progress) => {
      try {
          const progressPercent = Math.round(progress.percent * 100) / 100;
          
          // Update loading message with progress
          const progressText = getProgressText(progress, startTime);
          
          // Store progress globally
          currentRefreshProgress = {
          ...progress,
            statusMessage: progressText
          };
          
          // Display stats if they've been updated or on interval
          const now = Date.now();
          const shouldDisplayStats = 
            progress.forceStatsDisplay || 
            (progress.statsUpdated && (now - lastStatsDisplay > 30000)) ||
            (now - lastStatsDisplay > 60000); // Max 1 minute between updates
          
          if (shouldDisplayStats && global.storage?.data?.stats) {
            try {
              console.log('Displaying updated statistics based on processed transactions');
              await displayStats(chatId, false, true); // Show in-progress stats
              lastStatsDisplay = now;
            } catch (statsError) {
              console.error('Error showing in-progress stats:', statsError);
            }
          }
          
          // Only update the message if the percent changed significantly or enough time has passed
          if (loadingMessageId && 
              (Math.abs(progressPercent - lastProgressPercent) >= 5 || 
              progress.phase !== lastProgressPhase ||
              (Date.now() - lastProgressUpdate) > 5000)) {
            
            bot.editMessageText(progressText, {
              chat_id: chatId, 
              message_id: loadingMessageId,
              parse_mode: 'Markdown'
            }).catch(error => {
              console.error('Error updating progress message:', error.message);
            });
            
            lastProgressPercent = progressPercent;
            lastProgressPhase = progress.phase;
            lastProgressUpdate = Date.now();
          }
          
          // Add this block to process transactions in real-time
          if (progress.phase === 'signatures' && progress.processedCount > 0) {
            // Process transactions in batches during signature collection
            const startIdx = Math.max(0, progress.processedTransactions || 0);
            const endIdx = progress.processedCount;
            
            if (endIdx > startIdx && global.storage?.data?.signatures?.slice) {
              const batchSignatures = global.storage.data.signatures.slice(startIdx, endIdx);
              console.log(`Processing batch of ${batchSignatures.length} signatures (${startIdx}-${endIdx})`);
              
              try {
                // Process this batch of signatures
                const batchTransactions = await heliusService.processSignatureBatch(
                  batchSignatures, 
                  walletAddress,
                  { updateGlobalStats: true }
                );
                
                // Update progress tracking
                progress.processedTransactions = endIdx;
                progress.statsUpdated = true;
                
                // Force display stats update periodically
                if (endIdx % 500 === 0 || endIdx === progress.totalCount) {
                  progress.forceStatsDisplay = true;
                }
              } catch (batchError) {
                console.error(`Error processing signature batch ${startIdx}-${endIdx}:`, batchError);
              }
            }
          }
      } catch (error) {
        console.error('Error in progress callback:', error);
        }
      };
      
      // IMPORTANT - Configure fetch options for reliable retrieval
      const fetchOptions = {
        commitment: 'confirmed',
        maxTotalLimit: Number.MAX_SAFE_INTEGER, // No limit - process ALL transactions 
        batchSize: 25,
        maxRetries: 5,
        timeoutMs: 60000,
        progressCallback,
        fullRefresh: fullRefresh,
        updateStatsInRealTime: true, // Enable real-time stats updates
        displayInterval: 30000, // Update stats display every 30 seconds
        // For a full refresh, set lastFetchTimestamp to null
        lastFetchTimestamp: fullRefresh ? null : (await fileStorage.getLastFetchTimestamp()),
        until: null,
        ensureProcessing: true // Add this flag to ensure transaction processing
      };
      
      console.log(`Fetching transactions with options:`, fetchOptions);
      
      // Before fetching, clear transactions if doing a full refresh
      if (fullRefresh && global.storage && global.storage.data) {
        console.log('Full refresh requested - clearing existing transactions');
        global.storage.data.transactions = [];
        global.storage.data.stats = {
          totalTransactions: 0,
          processedTransactions: 0,
          sentCount: 0,
          receivedCount: 0,
          interactionCount: 0,
          unknownCount: 0,
          totalSent: 0,
          totalReceived: 0,
          currentBalance: 0,
          lastCalculated: new Date().toISOString(),
          lastUpdated: new Date().toISOString()
        };
      }
      
      // Fetch all transactions with the configured options
      let result;
      try {
        console.log('Calling heliusService.fetchAllTransactions with options', fetchOptions);
        result = await heliusService.fetchAllTransactions(walletAddress, fetchOptions);
        console.log('fetchAllTransactions returned result:', {
          hasTransactions: result && Array.isArray(result.transactions),
          transactionCount: result && Array.isArray(result.transactions) ? result.transactions.length : 0,
          hasStats: result && result.stats ? true : false,
          hasSignatureCount: result && typeof result.signatureCount === 'number'
        });
      } catch (fetchError) {
        console.error('Error in fetchAllTransactions:', fetchError);
        // Create a default result object to prevent undefined errors
        result = {
          transactions: [],
          transactionMap: new Map(),
          stats: initializeStats(),
          signatureCount: 0,
          error: fetchError.message
        };
      }
      
      // Verification after fetch to ensure data is processed
      console.log('VERIFICATION AFTER FETCH:');
      console.log(`- Signatures collected: ${result.signatureCount || 'unknown'}`);
      console.log(`- Transactions processed: ${result.transactions ? result.transactions.length : 'unknown'}`);
      console.log(`- Stats calculated: ${result.stats ? 'yes' : 'no'}`);
      
      // Ensure statistics are calculated even if the process didn't do it
      if (result.transactions && (!result.stats || Object.keys(result.stats).length === 0)) {
        console.log('Statistics missing - calculating from transactions');
        result.stats = heliusService.calculateStatistics(result.transactions);
      }
      
      // Save data to global storage with enhanced logging
      if (global.storage && global.storage.data) {
        console.log('BEFORE SAVING:');
        console.log(`- Transaction count: ${result && result.transactions ? result.transactions.length : 0}`);
        console.log(`- Signature count: ${result && result.signatureCount ? result.signatureCount : 0}`);
        console.log(`- Stats: ${result && result.stats ? 'available' : 'missing'}`);
        
        // Create safe reference to transactions
        const transactions = result && Array.isArray(result.transactions) ? result.transactions : [];
        
        if (transactions.length > 0) {
          console.log(`📊 Checking for duplicates before saving ${transactions.length} transactions`);
          
          // Create a map of existing transactions by signature for quick lookup
          const existingTransactionMap = new Map();
          if (global.storage.data.transactions && Array.isArray(global.storage.data.transactions)) {
            global.storage.data.transactions.forEach(tx => {
              if (tx && tx.signature) {
                existingTransactionMap.set(tx.signature, tx);
              }
            });
          } else {
            global.storage.data.transactions = [];
          }
          
          // Add new transactions, avoiding duplicates
          let newTransactionCount = 0;
          for (const tx of transactions) {
            if (tx && tx.signature && !existingTransactionMap.has(tx.signature)) {
              global.storage.data.transactions.push(tx);
              existingTransactionMap.set(tx.signature, tx);
              newTransactionCount++;
            }
          }
          
          console.log(`📊 Added ${newTransactionCount} new transactions (${transactions.length - newTransactionCount} duplicates skipped)`);
          
          // Update transactionMap in global storage
          global.storage.data.transactionMap = (result && result.transactionMap) ? result.transactionMap : existingTransactionMap;
        } else {
          console.warn('⚠️ No transactions to save to global storage');
        }
        
        // Always update stats, even if just with the current balance
        if (result && result.stats) {
          global.storage.data.stats = result.stats;
        }
        
      global.storage.data.lastUpdated = new Date().toISOString();
      
      // Calculate time taken
        const timeTaken = (Date.now() - startTime) / 1000;
        console.log(`Refresh completed in ${timeTaken.toFixed(2)} seconds`);
        
        // Enhanced saving with verification and retry
        try {
          // Log storage state before saving
          console.log(`Pre-save storage state: ${JSON.stringify({
            hasTransactions: Array.isArray(global.storage.data.transactions),
            transactionCount: Array.isArray(global.storage.data.transactions) ? 
              global.storage.data.transactions.length : 0,
            hasStats: Boolean(global.storage.data.stats),
            statsKeys: global.storage.data.stats ? Object.keys(global.storage.data.stats) : []
          })}`);
          
          // Try saving with retry logic
          let saveSuccess = false;
          let saveAttempts = 0;
          const MAX_SAVE_ATTEMPTS = 3;
          
          while (!saveSuccess && saveAttempts < MAX_SAVE_ATTEMPTS) {
            saveAttempts++;
            try {
              await fileStorage.saveData(global.storage.data);
              saveSuccess = true;
              console.log(`✅ Successfully saved data to file (attempt ${saveAttempts})`);
            } catch (saveError) {
              console.error(`❌ Error saving data (attempt ${saveAttempts}):`, saveError);
              if (saveAttempts < MAX_SAVE_ATTEMPTS) {
                console.log(`Retrying save in 1 second...`);
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
            }
          }
          
          if (saveSuccess) {
            // Verify data was saved properly
            try {
              const savedData = await fileStorage.loadData();
              console.log(`Post-save verification: ${JSON.stringify({
                loadedSuccessfully: Boolean(savedData),
                hasTransactions: savedData && Array.isArray(savedData.transactions),
                transactionCount: savedData && Array.isArray(savedData.transactions) ? 
                  savedData.transactions.length : 0,
                hasStats: savedData && Boolean(savedData.stats),
                statsKeys: savedData && savedData.stats ? Object.keys(savedData.stats) : []
              })}`);
            } catch (verifyError) {
              console.error('Error verifying saved data:', verifyError);
            }
          } else {
            console.error(`Failed to save data after ${MAX_SAVE_ATTEMPTS} attempts`);
          }
          
          try {
            await fileStorage.saveLastFetchTimestamp();
            console.log(`Saved last fetch timestamp: ${new Date().toISOString()}`);
          } catch (timeError) {
            console.error('Error saving timestamp:', timeError);
          }
        } catch (saveError) {
          console.error('❌ Error in save process:', saveError);
        }
        
        // Get the existing transactions count
        const existingTransactionsCount = Array.isArray(result.transactions) ? result.transactions.length : 0;
        
        // Send completion message
        try {
          const summaryMessage = `✅ Refresh complete!\n\n` +
            `• Transactions: ${existingTransactionsCount}\n` +
            `• Time taken: ${timeTaken.toFixed(2)}s\n` +
            `• Total sent: ${result.stats && result.stats.totalSent ? result.stats.totalSent.toFixed(9) : '0.000000000'} SOL\n` +
            `• Total received: ${result.stats && result.stats.totalReceived ? result.stats.totalReceived.toFixed(9) : '0.000000000'} SOL\n` +
            `• Current balance: ${result.stats && result.stats.currentBalance ? result.stats.currentBalance.toFixed(9) : '0.000000000'} SOL`;
          
          await bot.sendMessage(chatId, summaryMessage);
          
          // Display updated stats
          await displayStats(chatId);
        } catch (msgError) {
          console.error('Error sending completion message:', msgError);
        }
      }
      
      // Reset refreshing flag
      global.storage.isRefreshing = false;
      
      // Reset the global refresh progress
      currentRefreshProgress = {
        isRefreshing: false,
        percent: 100,
        processedCount: result.stats?.processedTransactions || 0,
        totalCount: result.stats?.totalTransactions || 0,
        statusMessage: 'Refresh complete'
      };
  } catch (error) {
      console.error('Error fetching transactions:', error);
      
      // Clear the timeout
      clearTimeout(refreshTimeout);
      
      // Reset refreshing flag
      global.storage.isRefreshing = false;
      
      // Send error message
      try {
        await bot.sendMessage(chatId, `❌ Error refreshing transactions: ${error.message}`);
    } catch (sendError) {
      console.error('Error sending error message:', sendError);
    }
    }
  } catch (outerError) {
    console.error('Critical error in refreshTransactionsDirectly:', outerError);
      global.storage.isRefreshing = false;
  } finally {
    // Reset start time when done
    refreshStartTime = null;
  }
}

// Helper function to format time
function formatTime(seconds) {
  if (seconds < 60) {
    return `${seconds}s`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
}

// Set up periodic transaction refresh
const REFRESH_INTERVAL = 3600000; // 1 hour in milliseconds

// Function to perform automatic refresh
async function performAutoRefresh() {
  try {
    debugLog('Performing auto refresh');
    
    if (!global.storage || !global.storage.data) {
      console.error('Storage not available for auto refresh');
      return;
    }
    
    // Check if a refresh is already in progress
    if (global.storage.isRefreshing) {
      debugLog('Refresh already in progress, skipping auto refresh');
      return;
    }
    
    // Set the refreshing flag
    global.storage.isRefreshing = true;
    
    try {
      // Get the last update time
      const lastUpdated = global.storage.data.stats?.lastUpdated 
        ? new Date(global.storage.data.stats.lastUpdated) 
        : new Date(0);
      
      // Calculate time since last update
      const now = new Date();
      const timeSinceLastUpdate = now - lastUpdated;
      const minutesSinceLastUpdate = Math.floor(timeSinceLastUpdate / (1000 * 60));
      
      debugLog(`Last update was ${minutesSinceLastUpdate} minutes ago`);
      
      // If continuous refresh is enabled or it's been more than 30 minutes since the last update
      if (continuousRefreshEnabled || minutesSinceLastUpdate >= 30) {
        debugLog('Starting auto refresh process');
        
        // Initialize counters for continuous scanning
        let totalNewTransactions = 0;
        let continueScanningForMore = true;
        let scanIteration = 0;
        const MAX_SCAN_ITERATIONS = 5; // Limit to prevent infinite loops (lower for auto refresh)
        let lastSignatureForPagination = null;
        
        // Continuously scan for new transactions until no more are found or max iterations reached
        while (continueScanningForMore && scanIteration < MAX_SCAN_ITERATIONS) {
          scanIteration++;
          debugLog(`Auto refresh scan iteration ${scanIteration}/${MAX_SCAN_ITERATIONS}`);
          
          // Load existing transactions, using the last signature for pagination if this isn't the first iteration
          const result = await global.storage.loadFromHelius(lastSignatureForPagination);
          
          const { newTransactions, isComplete, oldestSignature } = result;
          totalNewTransactions += newTransactions.length;
          
          debugLog(`Auto refresh scan #${scanIteration} found ${newTransactions.length} new transactions`);
          
          // If no new transactions were found or we've reached the end, stop scanning
          if (newTransactions.length === 0 || isComplete) {
            continueScanningForMore = false;
            debugLog(`Stopping auto refresh scan after iteration ${scanIteration}: ${newTransactions.length === 0 ? 'No new transactions found' : 'All transactions fetched'}`);
          } else {
            // Update the last signature for the next pagination request
            lastSignatureForPagination = oldestSignature;
            debugLog(`Continuing auto refresh scan after iteration ${scanIteration}: Found ${newTransactions.length} new transactions. Next pagination signature: ${lastSignatureForPagination}`);
            
            // Add a small delay between scans to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
        
        // Recalculate stats
        await global.storage.calculateStats();
        
        // Save to file
        await global.storage.saveToFile();
        
        // Update last update timestamp
        global.storage.updateLastFetchTimestamp();
        
        debugLog(`Auto refresh completed successfully. Found ${totalNewTransactions} new transactions in ${scanIteration} scan(s)`);
      } else {
        debugLog('Skipping auto refresh, last update was recent');
      }
    } catch (innerError) {
      console.error('Error during auto refresh process:', innerError);
      
      // Try to save what we have
      try {
        if (global.storage && global.storage.data) {
          await global.storage.saveToFile();
          debugLog('Saved partial data after auto refresh error');
        }
      } catch (saveError) {
        console.error('Error saving data after auto refresh error:', saveError);
      }
    } finally {
      // Always clear the refreshing flag in the inner try-catch
      if (global.storage) {
        global.storage.isRefreshing = false;
      }
    }
  } catch (error) {
    console.error('Error in performAutoRefresh:', error);
    
    // Make absolutely sure the refreshing flag is cleared
    if (global.storage) {
      global.storage.isRefreshing = false;
    }
  }
}

// Start periodic refresh
setInterval(performAutoRefresh, REFRESH_INTERVAL);
console.log(`Automatic refresh scheduled every ${REFRESH_INTERVAL / 60000} minutes`);

// Perform initial refresh after startup (wait 1 minute to ensure everything is initialized)
setTimeout(performAutoRefresh, 60000);
console.log('Initial auto-refresh scheduled in 1 minute');

// Register bot commands
async function registerBotCommands() {
  try {
    await bot.setMyCommands([
  { command: 'start', description: 'Start the bot' },
      { command: 'help', description: 'Show help message' },
      { command: 'refresh', description: 'Refresh transaction data' },
      { command: 'stats', description: 'Show transaction statistics' },
      { command: 'fullstats', description: 'Show detailed transaction statistics' },
      { command: 'fixstats', description: 'Fix transaction statistics (with messages)' },
      { command: 'fixstatsnow', description: 'Fix statistics silently' },
      { command: 'resetstats', description: 'Fix and refresh statistics - use if stats are wrong' },
      { command: 'balance', description: 'Show current balance' }
    ]);
    console.log('Bot commands registered successfully');
  } catch (error) {
    console.error('Error registering bot commands:', error);
  }
}

// Call this function to register commands when the bot starts
registerBotCommands();

// Add this after the bot initialization
console.log(`🤖 Telegram bot started at ${new Date().toLocaleString()}`);
console.log(`Bot username: ${bot.options.username || 'Unknown'}`);
console.log('Waiting for commands...');

// Export the bot for external use
module.exports = bot; 

// Add this new function to handle the clear data command
async function handleClearDataCommand(msg) {
  try {
    const chatId = msg.chat.id;
    debugLog(`Handling /cleardata command from ${msg.from?.id} in chat ${chatId}`);
    
    // Update command stats
    updateCommandStats('/cleardata', msg.from?.id);
    
    // Check if a refresh is already in progress
    if (global.storage && global.storage.isRefreshing) {
      return bot.sendMessage(chatId, '⏳ A refresh is already in progress. Please wait for it to complete before clearing data.');
    }
    
    // Send a confirmation message
    const confirmMsg = await bot.sendMessage(chatId, '⚠️ *WARNING*: This will completely delete all stored data and start fresh. Are you sure?\n\nReply with "YES" to confirm.', {
      parse_mode: 'Markdown'
    });
    
    // Set up a one-time listener for the confirmation
    const listenerId = bot.onReplyToMessage(chatId, confirmMsg.message_id, async (confirmReply) => {
      try {
        // Remove the listener to prevent memory leaks
        bot.removeReplyListener(listenerId);
        
        if (confirmReply.text && confirmReply.text.toUpperCase() === 'YES') {
          // User confirmed, proceed with clearing data
          const loadingMsg = await bot.sendMessage(chatId, '🗑️ Clearing all stored data...');
          
          try {
            // Set refreshing flag to prevent other operations during clear
            if (global.storage) {
              global.storage.isRefreshing = true;
            }
            
            const fs = require('fs');
            const path = require('path');
            
            // Get file paths
            const dataDir = path.join(process.cwd(), 'data');
            const statsFile = path.join(dataDir, 'stats.json');
            const transactionsFile = path.join(dataDir, 'transactions.json');
            const commandStatsFile = path.join(dataDir, 'command_stats.json');
            const lastFetchFile = path.join(dataDir, 'lastFetch.json');
            const settingsFile = path.join(dataDir, 'settings.json');
            const cacheFile = path.join(dataDir, 'cache.json');
            const userDataFile = path.join(dataDir, 'user_data.json');
            
            // Create empty objects
            const emptyStats = {
              totalSent: 0,
              totalReceived: 0,
              currentBalance: 0,
              totalTransactions: 0,
              processedTransactions: 0,
              sentTransactions: 0,
              receivedTransactions: 0,
              interactionTransactions: 0,
              unknownTransactions: 0,
              actualTransactionCount: 0,
              lastCalculated: new Date().toISOString(),
              lastUpdated: new Date().toISOString()
            };
            
            // Ensure data directory exists
            if (!fs.existsSync(dataDir)) {
              fs.mkdirSync(dataDir, { recursive: true });
            }
            
            // Create a backup before clearing data
            if (global.storage && typeof global.storage.createBackup === 'function') {
              try {
                await global.storage.createBackup('pre_clear');
                debugLog('Created backup before clearing data');
              } catch (backupError) {
                console.error('Error creating backup:', backupError);
              }
            }
            
            // DIRECT APPROACH: Write empty data directly to files
            debugLog('Writing empty data directly to files...');
            
            // Write empty transactions file
            fs.writeFileSync(transactionsFile, '[]', 'utf8');
            debugLog('Transactions file cleared');
            
            // Write empty stats file
            fs.writeFileSync(statsFile, JSON.stringify(emptyStats, null, 2), 'utf8');
            debugLog('Stats file cleared');
            
            // Write empty command stats file
            fs.writeFileSync(commandStatsFile, '{}', 'utf8');
            debugLog('Command stats file cleared');
            
            // Write empty last fetch file
            fs.writeFileSync(lastFetchFile, JSON.stringify({ timestamp: new Date().toISOString(), success: true }, null, 2), 'utf8');
            debugLog('Last fetch file cleared');
            
            // Clear settings file if it exists
            if (fs.existsSync(settingsFile)) {
              fs.writeFileSync(settingsFile, '{}', 'utf8');
              debugLog('Settings file cleared');
            }
            
            // Clear cache file if it exists
            if (fs.existsSync(cacheFile)) {
              fs.writeFileSync(cacheFile, '{}', 'utf8');
              debugLog('Cache file cleared');
            }
            
            // Clear user data file if it exists
            if (fs.existsSync(userDataFile)) {
              fs.writeFileSync(userDataFile, '{}', 'utf8');
              debugLog('User data file cleared');
            }
            
            // Clear any other data files in the data directory
            const dataFiles = fs.readdirSync(dataDir);
            for (const file of dataFiles) {
              if (!file.includes('backup') && 
                  !file.includes('stats.json') && 
                  !file.includes('transactions.json') && 
                  !file.includes('command_stats.json') && 
                  !file.includes('lastFetch.json') && 
                  !file.includes('settings.json') && 
                  !file.includes('cache.json') && 
                  !file.includes('user_data.json')) {
                const filePath = path.join(dataDir, file);
                fs.unlinkSync(filePath);
                debugLog(`Deleted additional data file: ${file}`);
              }
            }
            
            // Reset in-memory data
            if (global.storage) {
              global.storage.data = {
                transactions: [],
                stats: JSON.parse(JSON.stringify(emptyStats)),
                commandStats: {},
                lastUpdated: new Date().toISOString(),
                settings: {},
                cache: {},
                userData: {}
              };
              
              // Reset any other global storage properties
              global.storage.lastRefreshTime = null;
              global.storage.continuousRefreshEnabled = false;
              global.storage.refreshInterval = null;
              global.storage.lastSignature = null;
              global.storage.oldestSignature = null;
              
              // Reload from files to ensure consistency
              try {
                global.storage.load();
                debugLog('Reloaded storage from cleared files');
              } catch (reloadError) {
                console.error('Error reloading storage:', reloadError);
              }
            }
            
            // Update the message
            await bot.editMessageText('✅ All data has been completely cleared.\n\nUse /refresh to fetch all transactions from scratch.', {
              chat_id: chatId,
              message_id: loadingMsg.message_id
            });
            
            // Automatically start a refresh to fetch all transactions
            setTimeout(() => {
              try {
                bot.sendMessage(chatId, '🔄 Starting automatic refresh to fetch all transactions...')
                  .then(message => {
                    refreshTransactionsDirectly(chatId, message.message_id, true);
                  })
                  .catch(err => {
                    console.error('Error starting automatic refresh:', err);
                    bot.sendMessage(chatId, '❌ Error starting automatic refresh. Please run /refresh manually.');
                  });
              } catch (refreshError) {
                console.error('Error starting automatic refresh:', refreshError);
                bot.sendMessage(chatId, '❌ Error starting automatic refresh. Please run /refresh manually.');
              }
            }, 2000);
            
          } catch (error) {
            console.error('Error clearing data:', error);
            await bot.editMessageText(`❌ Error clearing data: ${error.message}`, {
              chat_id: chatId,
              message_id: loadingMsg.message_id
            });
          } finally {
            // Clear refreshing flag
            if (global.storage) {
              global.storage.isRefreshing = false;
            }
          }
        } else {
          // User did not confirm
          await bot.sendMessage(chatId, '❌ Data clearing cancelled.');
        }
      } catch (error) {
        console.error('Error in confirmation handler:', error);
        await bot.sendMessage(chatId, '❌ An error occurred while processing your confirmation.');
        
        // Clear refreshing flag in case of error
        if (global.storage) {
          global.storage.isRefreshing = false;
        }
      }
    });
    
    // Set a timeout to remove the listener after 60 seconds
    setTimeout(() => {
      try {
        bot.removeReplyListener(listenerId);
        bot.sendMessage(chatId, '⏱️ Confirmation timeout. Data clearing cancelled.');
      } catch (error) {
        console.error('Error removing reply listener:', error);
      }
    }, 60000);
  } catch (error) {
    console.error('Error in handleClearDataCommand:', error);
    try {
      await bot.sendMessage(msg.chat.id, '❌ Error processing clear data command. Please try again later.');
    } catch (sendError) {
      console.error('Error sending error message:', sendError);
    }
    
    // Clear refreshing flag in case of error
    if (global.storage) {
      global.storage.isRefreshing = false;
    }
  }
}

// Add this new function to handle the search command
async function handleSearchCommand(msg, match) {
  try {
    const chatId = msg.chat.id;
    
    // Get the wallet address from the command
    const walletAddress = match[1]?.trim();
    
    if (!walletAddress) {
      await bot.sendMessage(chatId, 
        "❌ Please provide a wallet address to search.\n" +
        "Example: `/search wallet_address`", 
        { parse_mode: 'Markdown' }
      );
      return;
    }
    
    // Validate the wallet address format
    try {
      // Import PublicKey from @solana/web3.js
      const { PublicKey } = require('@solana/web3.js');
      new PublicKey(walletAddress); // This will throw if invalid
    } catch (error) {
      await bot.sendMessage(chatId, `❌ Invalid wallet address format. Please check the address and try again.`);
      return;
    }
    
    // Send initial status message
    const statusMessage = await bot.sendMessage(
      chatId, 
      `🔍 Searching for transactions involving wallet: \`${walletAddress}\`...\n` +
      `This may take some time if you have a large transaction history.`,
      { parse_mode: 'Markdown' }
    );
    const statusMessageId = statusMessage.message_id;
    
    // Check if we have transactions to search through
    if (!global.storage?.data?.transactions || global.storage.data.transactions.length === 0) {
      await bot.editMessageText(
        `❌ No transactions to search through. Please run /refresh first to fetch transactions.`,
        { chat_id: chatId, message_id: statusMessageId }
      );
      return;
    }
    
    const transactions = global.storage.data.transactions;
    console.log(`Searching through ${transactions.length} transactions for wallet ${walletAddress}`);
    
    // Create or use an address index for faster lookups
    if (!global.storage.addressIndex) {
      await bot.editMessageText(
        `🔍 Building address index for faster searches (first-time only)...\n` +
        `0% complete (0/${transactions.length} transactions indexed)`,
        { chat_id: chatId, message_id: statusMessageId }
      );
      
      // Build an index of transactions by address
      global.storage.addressIndex = new Map();
      
      // Process transactions in batches to avoid blocking the main thread
      const batchSize = 500;
      const totalBatches = Math.ceil(transactions.length / batchSize);
      
      for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
        const start = batchNum * batchSize;
        const end = Math.min(start + batchSize, transactions.length);
        const batchTransactions = transactions.slice(start, end);
        
        for (const tx of batchTransactions) {
          // Index by 'from' address
          if (tx.from) {
            if (!global.storage.addressIndex.has(tx.from)) {
              global.storage.addressIndex.set(tx.from, []);
            }
            global.storage.addressIndex.get(tx.from).push(tx.signature);
          }
          
          // Index by 'to' address
          if (tx.to) {
            if (!global.storage.addressIndex.has(tx.to)) {
              global.storage.addressIndex.set(tx.to, []);
            }
            global.storage.addressIndex.get(tx.to).push(tx.signature);
          }
          
          // Index any other addresses in the transaction
          if (tx.otherAddresses && Array.isArray(tx.otherAddresses)) {
            for (const addr of tx.otherAddresses) {
              if (!global.storage.addressIndex.has(addr)) {
                global.storage.addressIndex.set(addr, []);
              }
              global.storage.addressIndex.get(addr).push(tx.signature);
            }
          }
        }
        
        // Update status every few batches
        if (batchNum % 5 === 0 || batchNum === totalBatches - 1) {
          const indexProgress = Math.round(((batchNum + 1) / totalBatches) * 100);
          await bot.editMessageText(
            `🔍 Building address index for faster searches (first-time only)...\n` +
            `${indexProgress}% complete (${(batchNum + 1) * batchSize > transactions.length ? transactions.length : (batchNum + 1) * batchSize}/${transactions.length} transactions indexed)`,
            { chat_id: chatId, message_id: statusMessageId }
          );
        }
        
        // Yield to event loop
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      
      console.log(`Built address index with ${global.storage.addressIndex.size} unique addresses`);
    }
    
    // Start the search with a timeout
    let matchedTransactions = [];
    const searchTimeout = 60000; // 60 seconds max
    const searchStartTime = Date.now();
    
    // Check if the address is in our index for quick lookup
    await bot.editMessageText(
      `🔍 Searching for transactions with wallet ${walletAddress}...`,
      { chat_id: chatId, message_id: statusMessageId }
    );
    
    // First try to use the index for a fast lookup
    if (global.storage.addressIndex && global.storage.addressIndex.has(walletAddress)) {
      const signatureSet = new Set(global.storage.addressIndex.get(walletAddress));
      
      // Find the full transactions that match these signatures
      matchedTransactions = transactions.filter(tx => signatureSet.has(tx.signature));
      
      console.log(`Found ${matchedTransactions.length} transactions via index lookup`);
    } else {
      // If not in index or we need a full search, process in batches
      console.log(`Address not found in index, performing full scan`);
      
      const isWalletMatch = (addr) => {
        if (!addr) return false;
        return addr.toLowerCase() === walletAddress.toLowerCase();
      };
      
      // Process in batches to provide progress updates and prevent timeout
      const batchSize = 500;
      const totalBatches = Math.ceil(transactions.length / batchSize);
      
      for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
        // Check if search timeout exceeded
        if (Date.now() - searchStartTime > searchTimeout) {
          await bot.editMessageText(
            `⚠️ Search timeout reached after examining ${batchNum * batchSize} transactions.\n` +
            `Showing partial results. Please try a more specific search.`,
            { chat_id: chatId, message_id: statusMessageId }
          );
          break;
        }
        
        const start = batchNum * batchSize;
        const end = Math.min(start + batchSize, transactions.length);
        const batchTransactions = transactions.slice(start, end);
        
        // Find matches in this batch
        const batchMatches = batchTransactions.filter(tx => {
          return isWalletMatch(tx.from) || 
                 isWalletMatch(tx.to) || 
                 (tx.otherAddresses && tx.otherAddresses.some(addr => isWalletMatch(addr)));
        });
        
        matchedTransactions.push(...batchMatches);
        
        // Update search progress
        const searchProgress = Math.round((batchNum + 1) / totalBatches * 100);
        
        await bot.editMessageText(
          `🔍 *Searching through ${transactions.length.toLocaleString()} transactions*\n` +
          `Progress: ${searchProgress}% (${(batchNum + 1) * batchSize > transactions.length ? transactions.length : (batchNum + 1) * batchSize}/${transactions.length})\n` +
          `Matches found so far: ${matchedTransactions.length}`,
          { chat_id: chatId, message_id: statusMessageId, parse_mode: 'Markdown' }
        );
        
        // Yield to event loop
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    
    // Sort transactions by date (newest first)
    matchedTransactions.sort((a, b) => b.blockTime - a.blockTime);
    
    // If no transactions found
    if (matchedTransactions.length === 0) {
      await bot.editMessageText(
        `❌ No transactions found for wallet address \`${walletAddress}\`.\n` +
        `This address may not have interacted with the distribution wallet.`,
        { chat_id: chatId, message_id: statusMessageId, parse_mode: 'Markdown' }
      );
      return;
    }
    
    // Calculate financial summary
    let totalSent = 0;
    let totalReceived = 0;
    let lastTransaction = null;
    
    for (const tx of matchedTransactions) {
      if (tx.from && tx.from.toLowerCase() === walletAddress.toLowerCase()) {
        totalSent += tx.amount || 0;
      }
      
      if (tx.to && tx.to.toLowerCase() === walletAddress.toLowerCase()) {
        totalReceived += tx.amount || 0;
      }
      
      if (!lastTransaction || tx.blockTime > lastTransaction.blockTime) {
        lastTransaction = tx;
      }
    }
    
    // Format the financial summary
    const formatNumber = (num) => {
      return typeof num === 'number' ? num.toLocaleString('en-US', { maximumFractionDigits: 9 }) : '0';
    };
    
    const escapeMarkdown = (text) => {
      if (!text) return '';
      return text
        .replace(/\_/g, '\\_')
        .replace(/\*/g, '\\*')
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)')
        .replace(/\~/g, '\\~')
        .replace(/\`/g, '\\`')
        .replace(/\>/g, '\\>')
        .replace(/\#/g, '\\#')
        .replace(/\+/g, '\\+')
        .replace(/\-/g, '\\-')
        .replace(/\=/g, '\\=')
        .replace(/\|/g, '\\|')
        .replace(/\{/g, '\\{')
        .replace(/\}/g, '\\}')
        .replace(/\./g, '\\.')
        .replace(/\!/g, '\\!');
    };
    
    // Create paginated results
    const maxTransactionsPerPage = 10;
    const totalPages = Math.ceil(matchedTransactions.length / maxTransactionsPerPage);
    
    // Prepare summary message
    const summaryMessage = 
      `🔍 *Search Results for ${escapeMarkdown(walletAddress)}*\n\n` +
      `📊 *Financial Summary:*\n` +
      `• Total Sent: ${formatNumber(totalSent)} SOL\n` +
      `• Total Received: ${formatNumber(totalReceived)} SOL\n` +
      `• Net: ${formatNumber(totalReceived - totalSent)} SOL\n\n` +
      `📝 *Transaction Summary:*\n` +
      `• Total Transactions: ${matchedTransactions.length}\n` +
      `• First Transaction: ${new Date(matchedTransactions[matchedTransactions.length - 1].blockTime * 1000).toLocaleString()}\n` +
      `• Last Transaction: ${new Date(matchedTransactions[0].blockTime * 1000).toLocaleString()}\n\n` +
      `${totalPages > 1 ? `Showing page 1 of ${totalPages}\n\n` : ''}`;
    
    // Send transactions in pages
    for (let page = 0; page < totalPages; page++) {
      const start = page * maxTransactionsPerPage;
      const end = Math.min(start + maxTransactionsPerPage, matchedTransactions.length);
      const pageTransactions = matchedTransactions.slice(start, end);
      
      let message = page === 0 ? summaryMessage : `🔍 *Search Results* (Page ${page + 1}/${totalPages})\n\n`;
      
      // Add transaction details
      pageTransactions.forEach((tx, index) => {
        const date = new Date(tx.blockTime * 1000).toLocaleString();
        const amount = typeof tx.amount === 'number' ? tx.amount.toLocaleString('en-US', { maximumFractionDigits: 9 }) : 'N/A';
        const type = tx.type || (tx.from === walletAddress ? 'Sent' : tx.to === walletAddress ? 'Received' : 'Interaction');
        
        message += `*${start + index + 1}. ${type}* - ${amount} SOL\n`;
        message += `📅 ${date}\n`;
        
        if (tx.type === 'sent' || tx.from === walletAddress) {
          message += `📤 From: \`${tx.from ? escapeMarkdown(tx.from.substring(0, 10)) + '...' : 'Unknown'}\`\n`;
          message += `📥 To: \`${tx.to ? escapeMarkdown(tx.to.substring(0, 10)) + '...' : 'Unknown'}\`\n`;
        } else {
          message += `📤 From: \`${tx.from ? escapeMarkdown(tx.from.substring(0, 10)) + '...' : 'Unknown'}\`\n`;
          message += `📥 To: \`${tx.to ? escapeMarkdown(tx.to.substring(0, 10)) + '...' : 'Unknown'}\`\n`;
        }
        
        message += `🔗 [Explorer](https://solscan.io/tx/${tx.signature})\n\n`;
      });
      
      // For larger result sets, suggest exporting to CSV
      if (page === totalPages - 1 && matchedTransactions.length > 20) {
        message += `\n💡 *Need more details?* Use \`/export ${walletAddress}\` to get a CSV file with all transactions.`;
      }
      
      // Send the message
      if (page === 0) {
        await bot.editMessageText(message, {
          chat_id: chatId,
          message_id: statusMessageId,
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        });
      } else {
        await bot.sendMessage(chatId, message, {
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        });
        
        // Small delay between messages to prevent rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  } catch (error) {
    console.error('Error in handleSearchCommand:', error);
    try {
      await bot.sendMessage(msg.chat.id, '❌ Error searching for transactions. Please try again later.');
    } catch (sendError) {
      console.error('Error sending error message:', sendError);
    }
  }
}

// Add this function to fix stats
async function fixStats(chatId, sendMessage = true) {
  try {
    if (!global.storage || !global.storage.data) {
      if (sendMessage) await bot.sendMessage(chatId, "❌ Storage not initialized");
      return;
    }
    
    const transactions = global.storage.data.transactions || [];
    
    if (transactions.length === 0) {
      if (sendMessage) await bot.sendMessage(chatId, "❌ No transactions found in storage");
      return;
    }
    
    if (sendMessage) await bot.sendMessage(chatId, `🔄 Fixing stats for ${transactions.length} transactions...`);
    console.log(`Fixing stats for ${transactions.length} transactions...`);
    
    // Get the wallet address
    const walletAddress = process.env.DISTRIBUTION_WALLET_ADDRESS;
    if (!walletAddress) {
      if (sendMessage) await bot.sendMessage(chatId, "❌ No wallet address configured");
      return;
    }
    
    // Get heliusService if available
    const heliusService = require('../services/heliusService');
    
    // Use the heliusService's calculateStatistics function for more accurate statistics
    if (heliusService && typeof heliusService.calculateStatistics === 'function') {
      console.log(`Using heliusService.calculateStatistics for ${transactions.length} transactions`);
      const stats = heliusService.calculateStatistics(transactions);
      
      // Save the updated stats
      if (global.storage.data) {
        global.storage.data.stats = stats;
        console.log(`Updated stats with heliusService.calculateStatistics:`, {
          totalTransactions: stats.totalTransactions,
          processedTransactions: stats.processedTransactions,
          sentCount: stats.sentCount,
          receivedCount: stats.receivedCount,
          interactionCount: stats.interactionCount,
          unknownCount: stats.unknownCount,
          externalCount: stats.externalCount,
          totalSent: stats.totalSent,
          totalReceived: stats.totalReceived
        });
        
        // Get current balance from blockchain (if possible)
        try {
          const currentBalance = await heliusService.getWalletBalance(walletAddress);
          stats.currentBalance = currentBalance;
          console.log(`Got current balance from blockchain: ${currentBalance}`);
        } catch (error) {
          console.log(`Error fetching current balance: ${error.message}`);
          // Keep calculated balance as fallback
        }
        
        // Update the timestamps
        stats.lastCalculated = new Date().toISOString();
        stats.lastUpdated = new Date().toISOString();
        
        if (sendMessage) {
          await bot.sendMessage(chatId, `✅ Stats fixed! Found ${stats.totalTransactions} transactions:\n` +
            `• Sent: ${stats.sentCount}\n` +
            `• Received: ${stats.receivedCount}\n` +
            `• Interaction: ${stats.interactionCount}\n` +
            `• Unknown: ${stats.unknownCount}\n` +
            `• External: ${stats.externalCount}\n` +
            `• Total Sent: ${stats.totalSent.toFixed(9)} SOL\n` +
            `• Total Received: ${stats.totalReceived.toFixed(9)} SOL\n` +
            `• Current Balance: ${stats.currentBalance.toFixed(9)} SOL`
          );
        }
        
        // If we have file storage methods, save to file
        if (fileStorage && typeof fileStorage.saveData === 'function') {
          try {
            await fileStorage.saveData(global.storage.data);
            console.log(`Saved updated stats to file`);
          } catch (saveError) {
            console.error(`Error saving stats to file:`, saveError);
          }
        }
        
        return stats;
      }
    } else {
      console.warn(`heliusService.calculateStatistics not available, using manual calculation`);
      
      // Rest of the original function (manual calculation) would go here
      // ... (omitted for brevity)
    }
  } catch (error) {
    console.error('Error in fixStats:', error);
    if (sendMessage) {
      await bot.sendMessage(chatId, `❌ Error fixing stats: ${error.message}`);
    }
  }
}

// Add command handler for silently fixing stats
bot.onText(/\/fixstatsnow/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    const loadingMsg = await bot.sendMessage(chatId, '🔄 Fixing statistics...');
    
    // Fix stats silently
    const stats = await fixStatsQuietly();
    
    if (stats) {
      // Edit message to show success
      await bot.editMessageText('✅ Statistics fixed successfully!', {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });
      
      // Display the updated stats
      await displayStats(chatId);
    } else {
      await bot.editMessageText('❌ Failed to fix statistics.', {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });
    }
  } catch (error) {
    console.error('Error in fixStatsnow command:', error);
    try {
      await bot.sendMessage(chatId, '❌ Error fixing statistics.');
    } catch (sendError) {
      console.error('Error sending error message:', sendError);
    }
  }
});

// Add a command handler for resetstats - combines fix and refresh
bot.onText(/\/resetstats/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    // Update command stats
    updateCommandStats('/resetstats', msg.from?.id);
    
    // Send initial message
    const loadingMsg = await bot.sendMessage(chatId, '🔄 Resetting statistics...');
    
    // First fix stats silently
    await bot.editMessageText('Step 1/3: Recalculating statistics...', {
      chat_id: chatId,
      message_id: loadingMsg.message_id
    });
    
    const stats = await fixStatsQuietly();
    
    if (stats) {
      // Now refresh transactions
      await bot.editMessageText('Step 2/3: Refreshing transactions...', {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });
      
      // Check if already refreshing
      if (global.storage.isRefreshing) {
        await bot.editMessageText('⚠️ Cannot refresh - refresh already in progress. Statistics have been fixed.', {
          chat_id: chatId,
          message_id: loadingMsg.message_id
        });
        
        // Display the updated stats
        await displayStats(chatId);
        return;
      }
      
      // Set refreshing flag to prevent concurrent refreshes
      global.storage.isRefreshing = true;
      
      try {
        // Get the heliusService
        const heliusService = require('../services/heliusService');
        const walletAddress = process.env.DISTRIBUTION_WALLET_ADDRESS;
        
        if (!walletAddress) {
          throw new Error('No wallet address configured');
        }
        
        // Fetch latest transactions - light refresh to update stats
        const fetchOptions = {
          maxTotalLimit: 100, // Just get the latest ones
          fullRefresh: false,
          progressCallback: (progress) => {
            try {
              // Update the message periodically to show progress
              const percent = Math.round(progress.percent || 0);
              if (percent % 20 === 0) { // Update at 0%, 20%, 40%, 60%, 80%, 100%
                bot.editMessageText(`Step 2/3: Refreshing transactions... ${percent}%`, {
                  chat_id: chatId,
                  message_id: loadingMsg.message_id
                }).catch(error => {
                  console.error('Error updating progress message:', error.message);
                });
              }
            } catch (error) {
              console.error('Error in progress callback:', error);
            }
          }
        };
        
        // Get last fetch timestamp safely
        try {
          fetchOptions.lastFetchTimestamp = await fileStorage.getLastFetchTimestamp();
        } catch (err) {
          console.log('Could not retrieve last fetch timestamp:', err.message);
          fetchOptions.lastFetchTimestamp = null;
        }
        
        console.log('Reset stats: Fetching transactions with options:', fetchOptions);
        
        // Perform the refresh
        const result = await heliusService.fetchAllTransactions(walletAddress, fetchOptions);
        
        // Save the results to storage
        if (result && result.transactions) {
          global.storage.data.transactions = result.transactions;
          global.storage.data.transactionMap = result.transactionMap;
          global.storage.data.stats = result.stats;
          global.storage.data.lastUpdated = new Date().toISOString();
          
          // Save to file with error handling
          try {
            await fileStorage.saveData(global.storage.data);
            console.log('Saved updated data to file during resetstats');
            
            try {
              await fileStorage.saveLastFetchTimestamp();
              console.log('Saved last fetch timestamp during resetstats');
            } catch (timestampError) {
              console.error('Error saving last fetch timestamp:', timestampError);
              // Continue despite error
            }
          } catch (saveError) {
            console.error('Error saving data to file:', saveError);
            // Continue despite error
          }
          
          // Update final message
          await bot.editMessageText('Step 3/3: Fixing stats again with fresh data...', {
            chat_id: chatId,
            message_id: loadingMsg.message_id
          });
          
          // Fix stats one more time with the fresh data
          await fixStatsQuietly();
          
          // Final success message
          await bot.editMessageText('✅ Statistics reset complete! All data has been refreshed.', {
            chat_id: chatId,
            message_id: loadingMsg.message_id
          });
          
          // Display the updated stats
          await displayStats(chatId);
        } else {
          throw new Error('Failed to fetch transactions');
        }
      } catch (error) {
        console.error('Error refreshing transactions:', error);
        await bot.editMessageText(`⚠️ Error during refresh: ${error.message}. Statistics may be partially updated.`, {
          chat_id: chatId,
          message_id: loadingMsg.message_id
        });
      } finally {
        // Always reset the refreshing flag
        global.storage.isRefreshing = false;
      }
    } else {
      await bot.editMessageText('❌ Failed to fix statistics. Please try /cleardata for a complete reset.', {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });
    }
  } catch (error) {
    console.error('Error in resetstats command:', error);
    try {
      await bot.sendMessage(chatId, `❌ Error resetting statistics: ${error.message}`);
    } catch (sendError) {
      console.error('Error sending error message:', sendError);
    }
    // Make sure refreshing flag is reset
    global.storage.isRefreshing = false;
  }
});

// Define a function to refresh transactions directly
const refreshTransactionsSimple = async () => {
  // Set refreshing status
  global.storage.isRefreshing = true;
  
  let errorMessage = null;
  try {
    console.log('Starting direct transaction refresh...');
    
    const walletAddress = process.env.DISTRIBUTION_WALLET_ADDRESS;
    if (!walletAddress) {
      throw new Error('DISTRIBUTION_WALLET_ADDRESS is not set in environment variables');
    }
    
    // Initialize counters
    let processedCount = 0;
    let totalCount = 0;
    let phase = 'starting';
    let lastUpdateTime = Date.now();
    let progressMessage = null;
    let lastProgressUpdate = Date.now();

    // Track refresh status      
    const progressCallback = (progress) => {
      processedCount = progress.processedCount;
      totalCount = progress.totalCount;
      phase = progress.phase;
      
      // Only update UI every 3 seconds to avoid flooding
      const now = Date.now();
      if (now - lastProgressUpdate > 3000) {
        lastProgressUpdate = now;

        // Calculate percent for progress bar
        const percent = progress.percent || 0;
        const progressBar = makeProgressBar(percent, 20);
        
        let statusMessage = `🔄 Refreshing transactions...\n\n`;
        statusMessage += `${progressBar} ${percent}%\n\n`;
        statusMessage += `Phase: ${capitalize(phase)}\n`;
        statusMessage += `Processed: ${processedCount}/${totalCount || '?'}\n`;
        
        if (progress.message) {
          statusMessage += `Status: ${progress.message}\n`;
        }
        
        progressMessage = statusMessage;
        
        // Update loading message if it exists
        if (loadingMessageId) {
          updateLoadingMessage(progressMessage);
        }
      }
    };
    
    // Call heliusService to fetch all transactions
    console.log('Fetching transactions from Helius service...');
    
    // Set options for transaction fetching
    const fetchOptions = {
      commitment: 'confirmed',
      maxTotalLimit: 1000, // Maximum number of transactions to fetch
      batchSize: 50,       // Number of transactions per batch/request
      maxRetries: 3,       // Maximum retries for failed requests
      timeoutMs: 60000,    // Timeout for requests
      progressCallback,    // Callback for progress updates
      fullRefresh: true,   // Force a full refresh
      lastFetchTimestamp: null // Start from the beginning
    };
    
    // Fetch transactions from heliusService
    const result = await heliusService.fetchAllTransactions(walletAddress, fetchOptions);
    
    // Save transactions to storage
    global.storage.data.transactions = result.transactions;
    global.storage.data.statistics = result.stats;
    global.storage.data.lastRefreshed = new Date().toISOString();
    
    // Write data to disk
    await fileStorage.ensureDataDir();
    await fileStorage.saveData();
    
    // Log summary
    const summary = {
      transactionCount: result.transactions.length,
      newTransactions: result.transactions.length - (global.storage.data.statistics?.previousTotal || 0),
      timeTaken: formatTime((Date.now() - lastUpdateTime) / 1000),
      totalSent: result.stats.totalSent.toFixed(6),
      totalReceived: result.stats.totalReceived.toFixed(6),
      currentBalance: result.stats.currentBalance.toFixed(9)
    };
    
    console.log('Refresh complete!', summary);
    
    // Create a nice summary message
    let summaryMessage = `✅ Refresh complete!\n\n`;
    summaryMessage += `📊 Transactions: ${summary.transactionCount}\n`;
    summaryMessage += `🆕 New transactions: ${summary.newTransactions}\n`;
    summaryMessage += `⏱ Time taken: ${summary.timeTaken}\n`;
    summaryMessage += `💸 Total sent: ${summary.totalSent} SOL\n`;
    summaryMessage += `💰 Total received: ${summary.totalReceived} SOL\n`;
    summaryMessage += `🏦 Current balance: ${summary.currentBalance} SOL`;
    
    progressMessage = summaryMessage;
  } catch (error) {
    console.error('❌ Error refreshing transactions:', error);
    errorMessage = `❌ Error refreshing transactions: ${error.message}`;
    progressMessage = errorMessage;
  } finally {
    // Reset refreshing flag
    global.storage.isRefreshing = false;
  }
  
  return { success: !errorMessage, message: progressMessage, error: errorMessage };
};

// Add this command to immediately fix your current statistics
bot.onText(/\/recategorize/, async (msg) => {
  const chatId = msg.chat.id;
  
  // Send initial message
  const loadingMsg = await bot.sendMessage(chatId, '🔄 Recategorizing transactions and fixing statistics...');
  
  try {
    if (!global.storage?.data?.transactions || global.storage.data.transactions.length === 0) {
      await bot.editMessageText('❌ No transactions found to recategorize. Run /refresh first.', {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });
      return;
    }
    
    const transactions = global.storage.data.transactions;
    const walletAddress = process.env.DISTRIBUTION_WALLET_ADDRESS;
    
    console.log(`Recategorizing ${transactions.length} transactions for ${walletAddress}`);
    
    // Initialize counters
    let sentCount = 0;
    let receivedCount = 0;
    let interactionCount = 0;
    let unknownCount = 0;
    let totalSent = 0;
    let totalReceived = 0;
    
    // Process each transaction
    for (let i = 0; i < transactions.length; i++) {
      const tx = transactions[i];
      
      // Recategorize and enhance
      tx.type = heliusService.parseTransactionType(tx, walletAddress);
      const enhanced = heliusService.enhanceTransactionWithWalletContext(tx, walletAddress);
      
      // Save enhanced transaction back to storage
      if (enhanced) {
        transactions[i] = enhanced;
      }
      
      // Update counters
      if (tx.type === 'sent') {
        sentCount++;
        if (typeof tx.amount === 'number' && !isNaN(tx.amount)) {
          totalSent += tx.amount;
        }
      } else if (tx.type === 'received') {
        receivedCount++;
        if (typeof tx.amount === 'number' && !isNaN(tx.amount)) {
          totalReceived += tx.amount;
        }
      } else if (tx.type === 'interaction') {
        interactionCount++;
    } else {
        unknownCount++;
      }
      
      // Update progress message periodically
      if (i % 100 === 0 || i === transactions.length - 1) {
        await bot.editMessageText(`🔄 Recategorizing transactions: ${i+1}/${transactions.length}\n\n` +
                                 `• Sent: ${sentCount} (${totalSent.toFixed(9)} SOL)\n` +
                                 `• Received: ${receivedCount} (${totalReceived.toFixed(9)} SOL)\n` +
                                 `• Interaction: ${interactionCount}\n` +
                                 `• Unknown: ${unknownCount}`, {
          chat_id: chatId,
          message_id: loadingMsg.message_id
        });
      }
    }
    
    // Update global stats
    global.storage.data.stats = {
      totalTransactions: transactions.length,
      processedTransactions: transactions.length,
      sentCount: sentCount,
      receivedCount: receivedCount,
      interactionCount: interactionCount,
      unknownCount: unknownCount,
      totalSent: totalSent,
      totalReceived: totalReceived,
      currentBalance: totalReceived - totalSent,
      lastCalculated: new Date().toISOString(),
      lastUpdated: new Date().toISOString()
    };
    
    // Save updated data
    await fileStorage.saveData(global.storage.data);
    
    // Display results
    await bot.editMessageText(`✅ Recategorization complete!\n\n` +
                             `📊 *Transaction Statistics:*\n` +
                             `• Total Transactions: ${transactions.length}\n` +
                             `• Sent: ${sentCount}\n` +
                             `• Received: ${receivedCount}\n` +
                             `• Interaction: ${interactionCount}\n` +
                             `• Unknown: ${unknownCount}\n\n` +
                             `💰 *Financial Summary:*\n` +
                             `• Total Sent: ${totalSent.toFixed(9)} SOL\n` +
                             `• Total Received: ${totalReceived.toFixed(9)} SOL\n` +
                             `• Current Balance: ${(totalReceived - totalSent).toFixed(9)} SOL`, {
      chat_id: chatId,
      message_id: loadingMsg.message_id,
      parse_mode: 'Markdown'
    });
    
    // Show updated stats
    await displayStats(chatId);
  } catch (error) {
    console.error('Error recategorizing transactions:', error);
    await bot.editMessageText(`❌ Error recategorizing transactions: ${error.message}`, {
      chat_id: chatId,
      message_id: loadingMsg.message_id
    });
  }
});

// Add this command to reprocess all transactions
bot.onText(/\/forcereprocess/, async (msg) => {
  const chatId = msg.chat.id;
  
  // Send initial message
  const loadingMsg = await bot.sendMessage(chatId, '🔄 Force reprocessing all transactions...');
  
  try {
    if (!global.storage?.data?.transactions || global.storage.data.transactions.length === 0) {
      await bot.editMessageText('❌ No transactions found to reprocess. Run /refresh first.', {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });
      return;
    }
    
    await bot.editMessageText('🔄 Reprocessing all transactions and rebuilding statistics...', {
      chat_id: chatId,
      message_id: loadingMsg.message_id
    });
    
    const transactions = global.storage.data.transactions;
    const walletAddress = process.env.DISTRIBUTION_WALLET_ADDRESS;
    
    // Initialize stats
    const stats = {
      totalTransactions: transactions.length,
      processedTransactions: transactions.length,
      sentCount: 0,
      receivedCount: 0,
      interactionCount: 0,
      unknownCount: 0,
      totalSent: 0,
      totalReceived: 0,
      currentBalance: 0,
      lastCalculated: new Date().toISOString(),
      lastUpdated: new Date().toISOString()
    };
    
    // Process each transaction
    for (let i = 0; i < transactions.length; i++) {
      const tx = transactions[i];
      
      // Determine transaction type
      tx.type = heliusService.parseTransactionType(tx, walletAddress);
      
      // Enhance transaction with amount info
      const enhanced = heliusService.enhanceTransactionWithWalletContext(tx, walletAddress);
      
      // Save enhanced transaction
      if (enhanced) {
        transactions[i] = enhanced;
      }
      
      // Update stats based on transaction type
      if (tx.type === 'sent') {
        stats.sentCount++;
        if (typeof tx.amount === 'number' && !isNaN(tx.amount)) {
          stats.totalSent += tx.amount;
        }
      } else if (tx.type === 'received') {
        stats.receivedCount++;
        if (typeof tx.amount === 'number' && !isNaN(tx.amount)) {
          stats.totalReceived += tx.amount;
        }
      } else if (tx.type === 'interaction') {
        stats.interactionCount++;
    } else {
        stats.unknownCount++;
      }
      
      // Update progress periodically
      if (i % 100 === 0 || i === transactions.length - 1) {
        await bot.editMessageText(`🔄 Reprocessing transactions: ${i+1}/${transactions.length}\n\n` +
                                 `• Sent: ${stats.sentCount} (${stats.totalSent.toFixed(9)} SOL)\n` +
                                 `• Received: ${stats.receivedCount} (${stats.totalReceived.toFixed(9)} SOL)\n` +
                                 `• Interaction: ${stats.interactionCount}\n` +
                                 `• Unknown: ${stats.unknownCount}`, {
          chat_id: chatId,
          message_id: loadingMsg.message_id
        });
      }
    }
    
    // Calculate current balance
    stats.currentBalance = stats.totalReceived - stats.totalSent;
    
    // Update global storage
    global.storage.data.transactions = transactions;
    global.storage.data.stats = stats;
    
    // Save to file
    await fileStorage.saveData(global.storage.data);
    
    // Show completion message
    await bot.editMessageText(`✅ Successfully reprocessed all ${transactions.length} transactions!\n\n` +
                             `📊 *Transaction Statistics:*\n` +
                             `• Total Transactions: ${stats.totalTransactions}\n` +
                             `• Sent: ${stats.sentCount}\n` +
                             `• Received: ${stats.receivedCount}\n` +
                             `• Interaction: ${stats.interactionCount}\n` +
                             `• Unknown: ${stats.unknownCount}\n\n` +
                             `💰 *Financial Summary:*\n` +
                             `• Total Sent: ${stats.totalSent.toFixed(9)} SOL\n` +
                             `• Total Received: ${stats.totalReceived.toFixed(9)} SOL\n` +
                             `• Current Balance: ${stats.currentBalance.toFixed(9)} SOL`, {
      chat_id: chatId,
      message_id: loadingMsg.message_id,
      parse_mode: 'Markdown'
    });
    
    // Display updated stats
    await displayStats(chatId);
  } catch (error) {
    console.error('Error reprocessing transactions:', error);
    await bot.editMessageText(`❌ Error reprocessing transactions: ${error.message}`, {
      chat_id: chatId,
      message_id: loadingMsg.message_id
    });
  }
});

// Export functions for testing
module.exports = {
  // Command handlers
  handleStartCommand,
  handleHelpCommand,
  handleTestCommand,
  handleStatsCommand,
  handleBalanceCommand,
  handleRefreshCommand,
  handleClearDataCommand,
  handleSearchCommand,
  
  // Helper functions
  displayStats,
  displayBalance,
  refreshTransactionsDirectly, refreshTransactionsSimple,
  performAutoRefresh,
  
  // The bot instance itself
  sendMessage: bot.sendMessage.bind(bot),
  editMessageText: bot.editMessageText.bind(bot)
};

// Add this to your command handlers
bot.onText(/\/updatestats/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    // Send loading message
    const loadingMsg = await bot.sendMessage(chatId, '🔄 Recalculating statistics from existing transactions...');
    
    if (!global.storage?.data?.transactions || global.storage.data.transactions.length === 0) {
      await bot.editMessageText('❌ No transactions found. Run /refresh first.', {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });
      return;
    }
    
    const transactions = global.storage.data.transactions;
    console.log(`Recalculating statistics for ${transactions.length} transactions`);
    
    // Get heliusService
    const heliusService = require('../services/heliusService');
    
    // Recalculate statistics using all transactions
    const stats = heliusService.calculateStatistics(transactions);
    
    // Update global storage
    global.storage.data.stats = stats;
    
    // Save to file
    try {
      await fileStorage.saveData(global.storage.data);
      console.log('Saved recalculated statistics');
    } catch (saveError) {
      console.error('Error saving statistics:', saveError);
    }
    
    // Update message to show success
    await bot.editMessageText(`✅ Successfully recalculated statistics from ${transactions.length} transactions.\n\nView updated stats with /stats`, {
      chat_id: chatId,
      message_id: loadingMsg.message_id
    });
    
    // Display updated stats
    await displayStats(chatId);
  } catch (error) {
    console.error('Error updating statistics:', error);
    await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
  }
});

// Add this command handler
bot.onText(/\/testendpoints/, async (msg) => {
  const chatId = msg.chat.id;
  
  const loadingMsg = await bot.sendMessage(chatId, '🔄 Testing RPC endpoints...');
  
  try {
    const heliusService = require('../services/heliusService');
    const results = await heliusService.testEndpoints();
    
    let resultMessage = '📊 *RPC Endpoint Test Results:*\n\n';
    
    results.forEach(result => {
      if (result.status === 'working') {
        resultMessage += `✅ *${result.endpoint}*\n`;
        resultMessage += `• Status: Working\n`;
        resultMessage += `• Signatures: ${result.count}\n\n`;
      } else {
        resultMessage += `❌ *${result.endpoint}*\n`;
        resultMessage += `• Status: Error\n`;
        resultMessage += `• Error: ${result.error}\n\n`;
      }
    });
    
    resultMessage += 'Use /refresh to update transactions with working endpoints.';
    
    await bot.editMessageText(resultMessage, {
      chat_id: chatId,
      message_id: loadingMsg.message_id,
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.error('Error testing endpoints:', error);
    await bot.editMessageText(`❌ Error testing endpoints: ${error.message}`, {
      chat_id: chatId,
      message_id: loadingMsg.message_id
    });
  }
});

// Add this after line 2659
// Add a command to update wallet balance only
bot.onText(/\/updatebalance/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    const loadingMsg = await bot.sendMessage(chatId, '🔄 Updating wallet balance from blockchain...');
    
    const heliusService = require('../services/heliusService');
    const walletAddress = process.env.DISTRIBUTION_WALLET_ADDRESS;
    
    // Get current balance directly from blockchain
    const currentBalance = await heliusService.getWalletBalance(walletAddress);
    
    // Update stats
    if (global.storage && global.storage.data && global.storage.data.stats) {
      global.storage.data.stats.currentBalance = currentBalance;
      global.storage.data.stats.lastUpdated = new Date().toISOString();
      
      // Save the updated stats
      await fileStorage.saveData(global.storage.data);
      
      await bot.editMessageText(`✅ Wallet balance updated successfully!\n\n` +
                               `Current balance: ${currentBalance.toFixed(9)} SOL`, {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });
      
      // Display updated stats
      await displayStats(chatId);
    } else {
      await bot.editMessageText(`⚠️ Storage not initialized or stats object missing.\n\n` +
                               `Current wallet balance: ${currentBalance.toFixed(9)} SOL`, {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });
    }
  } catch (error) {
    console.error('Error updating wallet balance:', error);
    await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
  }
});

// Add this command handler
bot.onText(/\/cleanduplicates/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    // Send initial message
    const loadingMsg = await bot.sendMessage(chatId, '🔍 Checking for duplicate transactions...');
    
    if (!global.storage?.data?.transactions || !Array.isArray(global.storage.data.transactions)) {
      await bot.editMessageText('No transactions found in storage.', {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });
      return;
    }
    
    const originalCount = global.storage.data.transactions.length;
    
    // Use the utility function to clean up transactions
    const success = await cleanupTransactions();
    
    if (!success) {
      await bot.editMessageText('❌ Error cleaning up transactions.', {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });
      return;
    }
    
    const newCount = global.storage.data.transactions.length;
    const removedCount = originalCount - newCount;
    
    // Update message
    if (removedCount > 0) {
      await bot.editMessageText(`✅ Removed ${removedCount} duplicate transactions!\n\n` +
                              `• Original count: ${originalCount}\n` +
                              `• New count: ${newCount}\n\n` +
                              `Statistics have been recalculated with the deduplicated data.`, {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });
    } else {
      await bot.editMessageText(`✅ No duplicate transactions found!\n\n` +
                              `Your transaction database is already optimized with ${newCount} unique transactions.`, {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });
    }
    
    // Display updated stats
    await displayStats(chatId);
  } catch (error) {
    console.error('Error cleaning duplicates:', error);
    await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
  }
});

// Add this utility function to safely deduplicate transactions
async function cleanupTransactions() {
  if (!global.storage?.data?.transactions) {
    console.log('No transactions to clean up');
    return false;
  }
  
  const originalCount = global.storage.data.transactions.length;
  console.log(`Cleaning up ${originalCount} transactions`);
  
  // Get heliusService
  const heliusService = require('../services/heliusService');
  
  // Create a new array with unique transactions
  const uniqueMap = new Map();
  for (const tx of global.storage.data.transactions) {
    if (tx && tx.signature) {
      uniqueMap.set(tx.signature, tx);
    }
  }
  
  // Create a new array from the unique transactions
  const uniqueTransactions = Array.from(uniqueMap.values());
  
  // Replace the transactions array
  global.storage.data.transactions = uniqueTransactions;
  
  const newCount = global.storage.data.transactions.length;
  console.log(`Cleanup complete: ${originalCount} → ${newCount} transactions (${originalCount - newCount} duplicates removed)`);
  
  // Recalculate statistics if needed
  try {
    global.storage.data.stats = heliusService.calculateStatistics(global.storage.data.transactions);
    await fileStorage.saveData(global.storage.data);
    return true;
  } catch (error) {
    console.error('Error saving cleaned transactions:', error);
    return false;
  }
}

// Add this new command in your commands section
bot.onText(/\/testconnection/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    await bot.sendMessage(chatId, 'Testing RPC connections...');
    
    const endpoints = [
      process.env.HELIUS_RPC_URL,
      'https://api.mainnet-beta.solana.com',
      'https://ssc-dao.genesysgo.net'
    ].filter(Boolean);
    
    for (const endpoint of endpoints) {
      try {
        const maskedEndpoint = endpoint.includes('api-key') ? 
          endpoint.split('?')[0] + '?api-key=***' : endpoint;
        
        await bot.sendMessage(chatId, `Testing connection to ${maskedEndpoint}...`);
        const connection = new Connection(endpoint, 'confirmed');
        const slot = await connection.getSlot();
        await bot.sendMessage(chatId, `✓ Successfully connected to ${maskedEndpoint} (slot: ${slot})`);
        
        // Try a basic wallet query
        const walletAddress = process.env.DISTRIBUTION_WALLET_ADDRESS;
        if (walletAddress) {
          const balance = await connection.getBalance(new PublicKey(walletAddress));
          await bot.sendMessage(chatId, `✓ Successfully retrieved wallet balance: ${balance / LAMPORTS_PER_SOL} SOL`);
          
          // Test signature retrieval
          const signatures = await connection.getSignaturesForAddress(
            new PublicKey(walletAddress),
            { limit: 5 }
          );
          await bot.sendMessage(chatId, `✓ Successfully retrieved ${signatures.length} signatures`);
        }
        
        // Success with this endpoint, stop testing
        break;
      } catch (error) {
        await bot.sendMessage(chatId, `✗ Failed to connect to ${endpoint.includes('api-key') ? endpoint.split('?')[0] : endpoint}: ${error.message}`);
      }
    }
  } catch (error) {
    await bot.sendMessage(chatId, `Error testing connections: ${error.message}`);
  }
});

// Add this command to recategorize and fix transaction amounts
bot.onText(/\/fixamounts/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    const loadingMsg = await bot.sendMessage(chatId, '🔄 Fixing transaction amounts with maximum precision...');
    
    const heliusService = require('../services/heliusService');
    
    // Run the fix
    const success = await heliusService.fixTransactionAmounts();
    
    if (success) {
      await bot.editMessageText('✅ Transaction amounts fixed successfully! Financial statistics updated with maximum precision.', {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });
      
      // Display the updated stats
      await displayStats(chatId);
    } else {
      await bot.editMessageText('❌ Failed to fix transaction amounts. Please check the logs for details.', {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });
    }
  } catch (error) {
    console.error('Error in fixAmounts command:', error);
    await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
  }
});

// Add this command to recategorize transactions using direct Solana RPC
bot.onText(/\/fixwithrpc/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    const loadingMsg = await bot.sendMessage(chatId, '🔄 Fixing transaction amounts using Solana RPC (this may take some time)...');
    
    const heliusService = require('../services/heliusService');
    
    // Run the RPC fix
    const success = await heliusService.fixTransactionAmountsWithRPC();
    
    if (success) {
      await bot.editMessageText('✅ Transaction amounts fixed successfully using Solana RPC!', {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });
      
      // Display the updated stats
      await displayStats(chatId);
    } else {
      await bot.editMessageText('❌ Failed to fix transaction amounts. Please check the logs for details.', {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });
    }
  } catch (error) {
    console.error('Error in fixWithRPC command:', error);
    await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
  }
});

// Add this command to reset only the statistics without reprocessing transactions
bot.onText(/\/cleanstats/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    const loadingMsg = await bot.sendMessage(chatId, '🔄 Performing clean recalculation of statistics...');
    
    if (!global.storage?.data?.transactions || !Array.isArray(global.storage.data.transactions)) {
      await bot.editMessageText('❌ No transactions found in storage.', {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });
      return;
    }
    
    const heliusService = require('../services/heliusService');
    
    // Get clean statistics
    const cleanStats = await heliusService.cleanRecalculateStats(global.storage.data.transactions);
    
    if (cleanStats) {
      // Update global stats
      global.storage.data.stats = cleanStats;
      
      // Save to disk
      try {
        await fileStorage.saveData(global.storage.data);
        console.log('Saved clean statistics to disk');
      } catch (saveError) {
        console.error('Error saving statistics:', saveError.message);
      }
      
      await bot.editMessageText('✅ Statistics have been recalculated successfully!', {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });
      
      // Display the updated stats
      await displayStats(chatId);
    } else {
      await bot.editMessageText('❌ Failed to recalculate statistics.', {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });
    }
  } catch (error) {
    console.error('Error in cleanStats command:', error);
    await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
  }
});

// Add command to fetch all transactions with higher limit
bot.onText(/\/fetchall/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    const loadingMsg = await bot.sendMessage(chatId, '🔄 Fetching ALL transactions (unlimited)...');
    
    const heliusService = require('../services/heliusService');
    const walletAddress = process.env.DISTRIBUTION_WALLET_ADDRESS;
    
    if (!walletAddress) {
      throw new Error('No wallet address configured');
    }
    
    // Use unlimited fetch
    const fetchOptions = {
      commitment: 'confirmed',
      maxTotalLimit: Number.MAX_SAFE_INTEGER, // No limit
      batchSize: 50,
      maxRetries: 5,
      fullRefresh: true,
      progressCallback: (progress) => {
        if (progress.percent % 10 === 0) {
          bot.editMessageText(
            `Fetching transactions: ${progress.processedCount}/${progress.totalCount || '?'} (${Math.round(progress.percent)}%)`, 
            { chat_id: chatId, message_id: loadingMsg.message_id }
          ).catch(err => console.error('Error updating progress:', err));
        }
      }
    };
    
    // Fetch all transactions
    await bot.editMessageText('🔍 Finding all transaction signatures...', 
      { chat_id: chatId, message_id: loadingMsg.message_id });
    
    const result = await heliusService.fetchAllTransactions(walletAddress, fetchOptions);
    
    // Save to storage
    if (result && result.transactions) {
      global.storage.data.transactions = result.transactions;
      global.storage.data.stats = result.stats;
      
      // Save to disk
      await fileStorage.saveData(global.storage.data);
      
      await bot.editMessageText(
        `✅ Successfully fetched ${result.transactions.length} transactions!\n\nNow run /cleanstats to ensure correct totals.`, 
        { chat_id: chatId, message_id: loadingMsg.message_id }
      );
    }
  } catch (error) {
    console.error('Error in fetchall command:', error);
    await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
  }
});

// Add these global variables after your other declarations
let autoRefreshEnabled = true;
let autoRefreshSchedule = '0 0 * * *'; // Default: midnight every day (cron format)
let globalFetchStats = null; // This will hold a reference to the fetchStats function
let autoRefreshInterval = null; // Global variable to store the auto-refresh interval
let statsIntervalId = null; // Global variable for the stats interval
let defaultStatsInterval = 15 * 60 * 1000; // 15 minutes in milliseconds

// Replace the previous startStatsPing and stopStatsPing functions with this:
function startAutomaticStatsMessages(chatId) {
  // Clear any existing interval
  if (statsIntervalId) {
    clearInterval(statsIntervalId);
  }

  console.log(`Starting automatic stats messages every 15 minutes to chat ${chatId}`);

  // Send initial stats immediately
  displayStats(chatId);

  // Set interval to send stats every 15 minutes
  statsIntervalId = setInterval(() => {
    console.log(`Sending scheduled stats to chat ${chatId}`);
    displayStats(chatId);
  }, defaultStatsInterval);
}

// Function to handle graceful shutdown
function setupGracefulShutdown() {
  // Handle SIGINT (Ctrl+C)
  process.on('SIGINT', () => {
    console.log('\nReceived SIGINT (Ctrl+C). Saving statistics before shutdown...');
    stopAutoSave(); // Stop auto-save before exit
    
    // Also stop the stats interval
    if (statsIntervalId) {
      clearInterval(statsIntervalId);
      statsIntervalId = null;
      console.log('Stopped automatic stats messages');
    }
    
    saveStatsBeforeExit();
  });
  
  // Handle SIGTERM
  process.on('SIGTERM', () => {
    console.log('\nReceived SIGTERM. Saving statistics before shutdown...');
    stopAutoSave(); // Stop auto-save before exit
    
    // Also stop the stats interval
    if (statsIntervalId) {
      clearInterval(statsIntervalId);
      statsIntervalId = null;
      console.log('Stopped automatic stats messages');
    }
    
    saveStatsBeforeExit();
  });
}

// ... existing code ...
