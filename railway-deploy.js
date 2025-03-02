// Simplified stats command with better error handling and timeout management
bot.onText(/\/stats/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    const statusMessage = await bot.sendMessage(chatId, '⏳ Fetching statistics...');
    
    // Set a timeout for the API request
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Request timed out after 10 seconds')), 10000)
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
    let errorMessage = '❌ Error fetching statistics: ';
    
    if (error.message.includes('timeout') || error.message.includes('15s limit')) {
      errorMessage += 'The API is experiencing high load. Here are some alternatives:\n\n' +
        '1. Try the /balance command instead\n' +
        '2. Try again later when the API is less busy\n' +
        '3. Check Solscan directly: https://solscan.io/account/' + 
        (process.env.DISTRIBUTION_WALLET_ADDRESS || 'HMDVj2Mhax9Kg68yTPo8qH1bcMQuCAqzDatV6d4Wqawv');
    } else {
      errorMessage += error.message;
    }
    
    bot.sendMessage(chatId, errorMessage);
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
      setTimeout(() => reject(new Error('Request timed out after 10 seconds')), 10000)
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
    let errorMessage = '❌ Error fetching balance: ';
    
    if (error.message.includes('timeout') || error.message.includes('15s limit')) {
      errorMessage += 'The API is experiencing high load. Try again later or check Solscan directly: ' +
        'https://solscan.io/account/' + (walletAddress || process.env.DISTRIBUTION_WALLET_ADDRESS || 'HMDVj2Mhax9Kg68yTPo8qH1bcMQuCAqzDatV6d4Wqawv');
    } else {
      errorMessage += error.message;
    }
    
    bot.sendMessage(chatId, errorMessage);
  }
}); 