# Telegram Bot Deployment Guide

This guide explains how to deploy the standalone Telegram bot for the SOL Distribution Tracker. The bot connects to the Vercel-hosted API to provide real-time information about SOL distributions and transactions.

## Prerequisites

1. Node.js (v14 or higher) installed on your server
2. A Telegram bot token (obtained from [@BotFather](https://t.me/botfather))
3. The SOL Distribution Tracker API deployed on Vercel

## Setup Instructions

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/DistroTracker.git
cd DistroTracker
```

### 2. Install Dependencies

```bash
npm install dotenv node-telegram-bot-api node-fetch
```

### 3. Configure Environment Variables

Create a `.env` file in the root directory with the following content:

```
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
```

Replace `your_telegram_bot_token_here` with the token you received from BotFather.

### 4. Update API URL (if needed)

Open `telegram-bot.js` and update the `API_BASE_URL` constant if your API is hosted at a different URL:

```javascript
const API_BASE_URL = 'https://your-api-url.vercel.app';
```

### 5. Run the Bot

```bash
node telegram-bot.js
```

You should see the message "Telegram bot initialized successfully" and "Bot is running..." if everything is set up correctly.

## Deploying to a Server

For 24/7 operation, you should deploy the bot to a server. Here are some options:

### Option 1: Run with PM2 (Recommended)

[PM2](https://pm2.keymetrics.io/) is a process manager for Node.js applications that keeps your bot running and restarts it if it crashes.

```bash
# Install PM2 globally
npm install -g pm2

# Start the bot with PM2
pm2 start telegram-bot.js --name "sol-tracker-bot"

# Make PM2 start the bot on system restart
pm2 startup
pm2 save
```

### Option 2: Deploy to a VPS

You can deploy the bot to a Virtual Private Server (VPS) like DigitalOcean, AWS, or Linode.

1. Set up a VPS with Ubuntu or another Linux distribution
2. Install Node.js on the server
3. Clone your repository to the server
4. Follow the setup instructions above
5. Use PM2 to keep the bot running

### Option 3: Deploy to Heroku

1. Create a `Procfile` in the root directory with the content:
   ```
   worker: node telegram-bot.js
   ```

2. Create a new Heroku app and push your code:
   ```bash
   heroku create
   git push heroku main
   ```

3. Set the environment variable:
   ```bash
   heroku config:set TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
   ```

4. Ensure the worker is running:
   ```bash
   heroku ps:scale worker=1
   ```

## Bot Commands

The bot supports the following commands:

- `/start` - Welcome message and introduction
- `/help` - Show available commands
- `/stats` - Show overall SOL statistics
- `/distributed` - Show SOL distribution data
- `/sol` - Show detailed SOL transfer statistics
- `/refresh` - Force refresh historical transaction data
- `/register <wallet>` - Register your wallet for tracking
- `/myrewards` - Show your personal rewards

## Troubleshooting

- **Bot not responding**: Check if the bot is running and if the Telegram token is correct.
- **API connection issues**: Verify that the API URL is correct and the API is running.
- **Error messages**: Check the console output for error messages that might help identify the issue.

## Maintaining User Data

The current implementation stores user wallet registrations in memory, which means they will be lost if the bot restarts. For a production environment, consider implementing a database solution (MongoDB, SQLite, etc.) to persist user data.

## Security Considerations

- Keep your `.env` file secure and never commit it to a public repository
- Consider implementing authentication for sensitive commands
- Regularly update dependencies to patch security vulnerabilities

## Support

If you encounter any issues or have questions, please open an issue on the GitHub repository. 