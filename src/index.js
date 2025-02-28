require('dotenv').config();
const express = require('express');
const cron = require('cron');

// Import components
const heliusService = require('./services/heliusService');
const telegramBot = require('./bot/telegramBot');
const routes = require('./routes');
const apiServer = require('./api/apiServer');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// API Routes
app.use('/api', routes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  
  // Initialize Telegram bot
  telegramBot.init();
  
  // Set up cron job to fetch transactions every 15 minutes
  const transactionJob = new cron.CronJob('*/15 * * * *', async () => {
    console.log('Running scheduled transaction fetch...');
    try {
      await heliusService.fetchAndProcessTransactions();
    } catch (error) {
      console.error('Error in scheduled transaction fetch:', error);
    }
  });
  
  // Start cron job
  transactionJob.start();
  
  // Initial fetch of transactions
  heliusService.fetchAndProcessTransactions()
    .then(() => console.log('Initial transaction fetch completed'))
    .catch(err => console.error('Error in initial transaction fetch:', err));
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Initialize the application
const init = async () => {
  try {
    console.log('Starting SOL Distribution Tracker...');
    
    // Initialize Helius service
    await heliusService.init();
    
    // Initialize Telegram bot
    telegramBot.init();
    
    // Initialize API server
    apiServer.init();
    
    console.log('Application initialized successfully');
  } catch (error) {
    console.error('Error initializing application:', error);
    process.exit(1);
  }
};

// Start the application
init(); 