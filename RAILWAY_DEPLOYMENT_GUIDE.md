# Railway Deployment Guide for SOL Distribution Tracker Bot

This guide provides detailed instructions for deploying the Telegram bot to Railway.

## Prerequisites

1. A [Railway account](https://railway.app/)
2. Your GitHub repository with the bot code
3. Your Telegram bot token (from BotFather)

## Step 1: Prepare Your Repository

Ensure your repository has the following files:

- `telegram-bot.js` - The main bot code
- `package.json` - With all required dependencies
- `Procfile` - With the command to start the bot (`web: node telegram-bot.js`)
- `.env.bot` - Environment variables (this will be configured in Railway)

## Step 2: Deploy to Railway

### Option 1: Deploy via Railway Dashboard (Recommended for Beginners)

1. Log in to [Railway](https://railway.app/)
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Choose your repository
5. Railway will automatically detect your `package.json` and `Procfile`
6. Click "Deploy"

### Option 2: Deploy via Railway CLI

1. Install the Railway CLI:
   ```bash
   npm i -g @railway/cli
   ```

2. Log in to Railway:
   ```bash
   railway login
   ```

3. Initialize a new project:
   ```bash
   railway init
   ```

4. Link your repository:
   ```bash
   railway link
   ```

5. Deploy your project:
   ```bash
   railway up
   ```

## Step 3: Configure Environment Variables

In the Railway dashboard:

1. Go to your project
2. Click on the "Variables" tab
3. Add the following variables:
   - `TELEGRAM_BOT_TOKEN`: Your Telegram bot token
   - `API_BASE_URL`: URL of your Vercel API (e.g., https://distribution-tracker-api.vercel.app)
   - `API_KEY`: Your API key (if required)

## Step 4: Verify Deployment

1. Check the logs in the Railway dashboard to ensure your bot is running
2. Send a message to your bot on Telegram to test if it's responding

## Troubleshooting

### Bot Not Starting

Check the logs in Railway for errors. Common issues include:

- Missing environment variables
- Dependency installation failures
- Syntax errors in your code

### Bot Not Responding

If the bot starts but doesn't respond to commands:

1. Verify your `TELEGRAM_BOT_TOKEN` is correct
2. Check if the bot is using polling mode correctly
3. Test the API connection using the `check-api-connection.js` script

### API Connection Issues

If the bot can't connect to your Vercel API:

1. Check if the API is running by visiting `{API_BASE_URL}/api/health`
2. Verify that CORS is properly configured on the API
3. Check for any rate limiting or timeout issues

## Maintenance

### Updating Your Bot

When you make changes to your code:

1. Push the changes to your GitHub repository
2. Railway will automatically redeploy your bot

### Monitoring

Monitor your bot's performance using:

1. Railway's built-in logs
2. Railway's metrics dashboard
3. Custom logging in your bot code

## Additional Resources

- [Railway Documentation](https://docs.railway.app/)
- [Node.js Telegram Bot API Documentation](https://github.com/yagop/node-telegram-bot-api)
- [Vercel Serverless Functions Documentation](https://vercel.com/docs/functions) 