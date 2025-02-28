const TelegramBot = require('node-telegram-bot-api');
const heliusService = require('../services/heliusService');
const Transaction = require('../models/Transaction');
const axios = require('axios');
const transactionService = require('../services/transactionService');

// Bot token from environment variables
const token = process.env.TELEGRAM_BOT_TOKEN;
let bot;

// Format number with commas and decimal places
const formatNumber = (num, decimals = 7) => {
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
};

// Format date
const formatDate = (date) => {
  return new Date(date).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

// Format transaction for display
const formatTransaction = (tx) => {
  const type = tx.type === 'collection' ? '📥 Collected' : '📤 Distributed';
  const amount = formatNumber(Math.abs(tx.tokenAmount || tx.solAmount));
  const currency = tx.tokenMint === heliusService.NATIVE_SOL_MINT ? 'SOL' : 'tokens';
  const date = formatDate(tx.timestamp);
  
  return `${type}: ${amount} ${currency}\nDate: ${date}\nSignature: ${tx.signature.substring(0, 8)}...`;
};

// Format token mint for display (shorten if needed)
const formatTokenMint = (mint) => {
  if (!mint) return 'Unknown';
  
  if (mint === heliusService.NATIVE_SOL_MINT) {
    return 'Native SOL';
  }
  
  if (mint === heliusService.TAX_TOKEN_MINT) {
    return 'Tax Token';
  }
  
  return mint.length > 20 ? `${mint.substring(0, 8)}...${mint.substring(mint.length - 8)}` : mint;
};

// Initialize the bot
const init = () => {
  if (!token) {
    console.error('TELEGRAM_BOT_TOKEN is not set in environment variables');
    return;
  }
  
  // Create a bot instance
  bot = new TelegramBot(token, { polling: true });
  
  // Start command
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 
      'Welcome to the SOL Distribution Wallet Tracker Bot! 🚀\n\n' +
      'This bot helps you track SOL distribution from your wallet.\n\n' +
      'Use /help to see available commands.'
    );
  });
  
  // Help command
  bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    let helpMessage = 'Available commands:\n\n' +
      '/stats - Show overall SOL statistics\n' +
      '/distributed - Show SOL distribution data\n' +
      '/sol - Show detailed SOL transfer statistics\n' +
      '/tax - Show tax-related SOL transactions\n' +
      '/refresh - Force refresh historical transaction data\n' +
      '/help - Show this help message';
    
    bot.sendMessage(chatId, helpMessage);
  });
  
  // Stats command with Helius data
  bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
      bot.sendMessage(chatId, 'Fetching complete SOL statistics...');
      
      const walletAddress = process.env.DISTRIBUTION_WALLET_ADDRESS;
      const solscanWalletLink = `https://solscan.io/account/${walletAddress}`; // Still use Solscan for viewing
      
      // Get tracked stats from our database
      const trackedStats = await heliusService.getTaxStats();
      
      // Get complete stats from Helius
      let heliusStats;
      let heliusError = null;
      try {
        heliusStats = await transactionService.fetchHeliusTransactions(walletAddress);
        console.log('Helius stats:', JSON.stringify(heliusStats, null, 2));
      } catch (error) {
        console.error('Error fetching from Helius:', error.message);
        heliusStats = null;
        heliusError = error.message;
      }
      
      let message = '📊 *SOL Statistics* 📊\n\n';
      
      if (heliusStats) {
        message += `*Total SOL Distributed to Users (All Time)*: ${formatNumber(heliusStats.totalSolSent)} SOL\n`;
        message += `*Total SOL Received (All Time)*: ${formatNumber(heliusStats.totalSolReceived)} SOL\n`;
        message += `*Total Tax SOL Received (All Time)*: ${formatNumber(heliusStats.totalTaxReceived)} SOL\n`;
        message += `*Current SOL Balance*: ${formatNumber(heliusStats.currentBalance)} SOL\n`;
        message += `*Total Transactions*: ${heliusStats.transactionCount}\n\n`;
      } else {
        // Fallback to tracked stats if Helius fails
        message += `*Total SOL Distributed (Tracked)*: ${formatNumber(trackedStats.totalSolDistributed)} SOL\n`;
        message += `*Current SOL Balance*: ${formatNumber(trackedStats.solBalance || 0)} SOL\n\n`;
        message += `_Note: Showing only tracked transactions. Helius API request failed._\n`;
        message += `_Error: ${heliusError || 'Unknown error'}_\n\n`;
      }
      
      message += `Distribution Wallet: \`${walletAddress}\`\n\n`;
      message += `[View Complete Wallet History on Solscan](${solscanWalletLink})`;
      
      bot.sendMessage(chatId, message, { parse_mode: 'Markdown', disable_web_page_preview: true });
    } catch (error) {
      console.error('Error fetching stats for Telegram:', error);
      bot.sendMessage(chatId, `Error fetching statistics: ${error.message}. Please try again later.`);
    }
  });
  
  // Distributed transactions command with Helius data
  bot.onText(/\/distributed/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
      bot.sendMessage(chatId, 'Fetching complete SOL distribution data...');
      
      const walletAddress = process.env.DISTRIBUTION_WALLET_ADDRESS;
      const solscanWalletLink = `https://solscan.io/account/${walletAddress}`; // Still use Solscan for viewing
      
      // Get tracked transactions from our database
      const allTrackedTransactions = Transaction.find({ 
        type: 'distribution',
        tokenMint: heliusService.NATIVE_SOL_MINT
      });
      
      // Calculate total SOL distributed from tracked transactions
      const totalTrackedSolDistributed = allTrackedTransactions.reduce((sum, tx) => sum + Math.abs(tx.solAmount || 0), 0);
      
      // Get complete stats from Helius
      let heliusStats;
      let heliusError = null;
      try {
        heliusStats = await transactionService.fetchHeliusTransactions(walletAddress);
      } catch (error) {
        console.error('Error fetching from Helius:', error.message);
        heliusStats = null;
        heliusError = error.message;
      }
      
      // Sort tracked transactions by timestamp (newest first)
      const sortedTrackedTransactions = allTrackedTransactions.sort((a, b) => {
        return new Date(b.timestamp) - new Date(a.timestamp);
      });
      
      // Limit to 10 transactions for display
      const recentTrackedTransactions = sortedTrackedTransactions.slice(0, 10);
      
      let message = '📤 *SOL Distribution Transactions* 📤\n\n';
      
      if (heliusStats) {
        message += `*Total SOL Distributed to Users (All Time)*: ${formatNumber(heliusStats.totalSolSent)} SOL\n`;
        message += `*Total Transactions*: ${heliusStats.transactionCount}\n\n`;
        
        if (heliusStats.outgoingTransactions && heliusStats.outgoingTransactions.length > 0) {
          message += `_Showing ${Math.min(heliusStats.outgoingTransactions.length, 10)} recent outgoing transactions_\n\n`;
          
          heliusStats.outgoingTransactions.forEach(tx => {
            const date = new Date(tx.timestamp).toLocaleString();
            const amount = formatNumber(Math.abs(tx.solAmount || 0));
            const solscanLink = `https://solscan.io/tx/${tx.signature}`;
            const recipients = tx.recipients ? `To: ${tx.recipients.length} recipient(s)` : '';
            
            message += `Amount: ${amount} SOL\n`;
            message += `Date: ${date}\n`;
            message += `From: ${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}\n`;
            if (recipients) message += `${recipients}\n`;
            message += `Signature: ${tx.signature.slice(0, 8)}...\n`;
            message += `[View on Solscan](${solscanLink})\n\n`;
          });
        } else if (recentTrackedTransactions.length > 0) {
          message += `_No recent outgoing transactions found in Helius data. Showing tracked transactions instead._\n\n`;
          
          recentTrackedTransactions.forEach(tx => {
            const date = new Date(tx.timestamp).toLocaleString();
            const amount = formatNumber(Math.abs(tx.solAmount || 0));
            const solscanLink = `https://solscan.io/tx/${tx.signature}`;
            
            message += `Amount: ${amount} SOL\n`;
            message += `Date: ${date}\n`;
            message += `From: ${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}\n`;
            message += `Signature: ${tx.signature.slice(0, 8)}...\n`;
            message += `[View on Solscan](${solscanLink})\n\n`;
          });
        } else {
          message += 'No SOL distribution transactions found.\n\n';
        }
      } else {
        message += `*Total SOL Distributed (Tracked)*: ${formatNumber(totalTrackedSolDistributed)} SOL\n`;
        message += `*Tracked Transactions*: ${allTrackedTransactions.length}\n\n`;
        message += `_Note: Showing only tracked transactions. Helius API request failed._\n`;
        message += `_Error: ${heliusError || 'Unknown error'}_\n\n`;
        
        if (recentTrackedTransactions.length === 0) {
          message += 'No SOL distribution transactions found in tracked data.\n\n';
        } else {
          message += `_Showing ${Math.min(recentTrackedTransactions.length, 10)} recent tracked transactions_\n\n`;
          
          recentTrackedTransactions.forEach(tx => {
            const date = new Date(tx.timestamp).toLocaleString();
            const amount = formatNumber(Math.abs(tx.solAmount || 0));
            const solscanLink = `https://solscan.io/tx/${tx.signature}`;
            
            message += `Amount: ${amount} SOL\n`;
            message += `Date: ${date}\n`;
            message += `From: ${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}\n`;
            message += `Signature: ${tx.signature.slice(0, 8)}...\n`;
            message += `[View on Solscan](${solscanLink})\n\n`;
          });
        }
      }
      
      message += `[View Complete Wallet History on Solscan](${solscanWalletLink})`;
      
      bot.sendMessage(chatId, message, { parse_mode: 'Markdown', disable_web_page_preview: true });
    } catch (error) {
      console.error('Error fetching distribution transactions for Telegram:', error);
      bot.sendMessage(chatId, `Error fetching distribution transactions: ${error.message}. Please try again later.`);
    }
  });
  
  // SOL statistics command
  bot.onText(/\/sol/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
      bot.sendMessage(chatId, 'Fetching SOL statistics...');
      
      const stats = await heliusService.getSolStats();
      const walletAddress = process.env.DISTRIBUTION_WALLET_ADDRESS;
      const solscanWalletLink = `https://solscan.io/account/${walletAddress}`;
      
      let message = '💰 *SOL Transfer Statistics* 💰\n\n' +
                    `*Total SOL Received*: ${formatNumber(stats.totalReceived)} SOL\n` +
                    `*Total SOL Sent*: ${formatNumber(stats.totalSent)} SOL\n` +
                    `*Current SOL Balance*: ${formatNumber(stats.balance)} SOL\n` +
                    `*Total Transactions*: ${stats.totalTransactions || stats.recentTransactions.length}\n\n`;
      
      if (stats.recentTransactions.length === 0) {
        message += 'No recent SOL transactions found.';
      } else {
        if (stats.totalTransactions > 10) {
          message += `_Showing 10 of ${stats.totalTransactions} transactions_\n`;
          message += `_View all transactions on [Solscan](${solscanWalletLink})_\n\n`;
        }
        
        message += '*Recent SOL Transactions:*\n\n';
        
        stats.recentTransactions.forEach((tx, index) => {
          const type = tx.type === 'collection' ? '📥 Received' : '📤 Sent';
          const solscanLink = `https://solscan.io/tx/${tx.signature}`;
          
          message += `${index + 1}. ${type}: ${formatNumber(Math.abs(tx.solAmount))} SOL\n` +
                     `   Date: ${formatDate(tx.timestamp)}\n` +
                     `   ${tx.type === 'collection' ? 'From' : 'From'}: \`${walletAddress.substring(0, 8)}...\`\n` +
                     `   [View on Solscan](${solscanLink})\n\n`;
        });
      }
      
      message += `[View Wallet on Solscan](${solscanWalletLink})`;
      
      bot.sendMessage(chatId, message, { parse_mode: 'Markdown', disable_web_page_preview: true });
    } catch (error) {
      console.error('Error fetching SOL stats for Telegram:', error);
      bot.sendMessage(chatId, 'Error fetching SOL statistics. Please try again later.');
    }
  });
  
  // Add a command to force refresh the historical data
  bot.onText(/\/refresh/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
      bot.sendMessage(chatId, 'Refreshing historical transaction data from Helius API. This may take a while...');
      
      const walletAddress = process.env.DISTRIBUTION_WALLET_ADDRESS;
      
      // Force refresh the historical data
      await transactionService.fetchHeliusTransactions(walletAddress, true);
      
      bot.sendMessage(chatId, 'Historical transaction data has been refreshed successfully!');
    } catch (error) {
      console.error('Error refreshing historical data:', error);
      bot.sendMessage(chatId, `Error refreshing historical data: ${error.message}. Please try again later.`);
    }
  });
  
  // Add a new command to show tax-related transactions
  bot.onText(/\/tax/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
      bot.sendMessage(chatId, 'Fetching tax-related SOL transactions...');
      
      const walletAddress = process.env.DISTRIBUTION_WALLET_ADDRESS;
      const solscanWalletLink = `https://solscan.io/account/${walletAddress}`;
      
      // Get complete stats from Helius
      let heliusStats;
      let heliusError = null;
      try {
        heliusStats = await transactionService.fetchHeliusTransactions(walletAddress);
      } catch (error) {
        console.error('Error fetching from Helius:', error.message);
        heliusStats = null;
        heliusError = error.message;
      }
      
      let message = '💰 *Tax SOL Transactions* 💰\n\n';
      
      if (heliusStats) {
        message += `*Total Tax SOL Received*: ${formatNumber(heliusStats.totalTaxReceived)} SOL\n`;
        message += `*Total Transactions*: ${heliusStats.transactionCount}\n\n`;
        
        if (heliusStats.taxIncomingTransactions && heliusStats.taxIncomingTransactions.length > 0) {
          message += `_Showing ${Math.min(heliusStats.taxIncomingTransactions.length, 10)} recent tax transactions_\n\n`;
          
          heliusStats.taxIncomingTransactions.forEach(tx => {
            const date = new Date(tx.timestamp).toLocaleString();
            const amount = formatNumber(Math.abs(tx.solAmount || 0));
            const solscanLink = `https://solscan.io/tx/${tx.signature}`;
            
            message += `Amount: ${amount} SOL\n`;
            message += `Date: ${date}\n`;
            message += `From: ${tx.sender ? `${tx.sender.slice(0, 4)}...${tx.sender.slice(-4)}` : 'Unknown'}\n`;
            message += `Signature: ${tx.signature.slice(0, 8)}...\n`;
            message += `[View on Solscan](${solscanLink})\n\n`;
          });
        } else {
          message += 'No tax-related SOL transactions found.\n\n';
          message += 'Note: To track tax transactions, set the TAX_CONTRACT_ADDRESS environment variable.\n\n';
        }
      } else {
        message += `_Error fetching tax transactions: ${heliusError || 'Unknown error'}_\n\n`;
      }
      
      message += `[View Complete Wallet History on Solscan](${solscanWalletLink})`;
      
      bot.sendMessage(chatId, message, { parse_mode: 'Markdown', disable_web_page_preview: true });
    } catch (error) {
      console.error('Error fetching tax transactions for Telegram:', error);
      bot.sendMessage(chatId, `Error fetching tax transactions: ${error.message}. Please try again later.`);
    }
  });
  
  console.log('Telegram bot initialized');
};

module.exports = {
  init,
  formatNumber,
  formatDate
}; 