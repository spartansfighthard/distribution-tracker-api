# Deploying the Telegram Bot to Railway

This guide will walk you through deploying your SOL Distribution Tracker Telegram bot to Railway.app.

## Prerequisites

- A [Railway.app](https://railway.app/) account
- Your GitHub repository connected to Railway
- Your Telegram bot token (from BotFather)
- Your API key for accessing the Distribution Tracker API

## Deployment Steps

### 1. Connect Your Repository to Railway

1. Log in to [Railway.app](https://railway.app/)
2. Click "New Project" and select "Deploy from GitHub repo"
3. Select your repository from the list
4. Railway will automatically detect your Procfile and package.json

### 2. Configure Environment Variables

Add the following environment variables in the Railway dashboard:

- `TELEGRAM_BOT_TOKEN`: Your Telegram bot token from BotFather
- `API_BASE_URL`: The URL of your API (e.g., https://distribution-tracker-api.vercel.app)
- `API_KEY`: Your API key for authentication

To add environment variables:
1. Go to your project in Railway
2. Click on the "Variables" tab
3. Add each variable with its corresponding value

### 3. Deploy Your Bot

1. Railway will automatically deploy your bot when you push changes to your repository
2. You can also manually trigger a deployment from the Railway dashboard

### 4. Verify Deployment

1. Check the logs in the Railway dashboard to ensure your bot is running correctly
2. Test your bot by sending commands to it in Telegram

## Troubleshooting

- **Bot not responding**: Check the logs in Railway for any errors
- **Connection issues**: Verify that your API_BASE_URL is correct and accessible
- **Authentication errors**: Ensure your API_KEY is correctly set in the environment variables

## Additional Information

- Railway automatically assigns a URL to your project, but for a Telegram bot, you don't need to use this URL
- The bot will run continuously as long as your Railway project is active
- Railway's free tier includes 500 hours of runtime per month, which is sufficient for a single bot

## Monitoring and Scaling

- Monitor your bot's performance in the Railway dashboard
- If needed, you can upgrade your Railway plan for additional resources 