# Deploying the Telegram Bot to Railway

This guide provides step-by-step instructions for deploying the SOL Distribution Tracker Telegram Bot to Railway.

## Prerequisites

1. A Railway account (https://railway.app/)
2. Git installed on your local machine
3. The Railway CLI (optional but recommended)

## Deployment Steps

### 1. Install Railway CLI (Optional)

```bash
npm i -g @railway/cli
```

### 2. Login to Railway

```bash
railway login
```

### 3. Initialize a New Project

```bash
railway init
```

### 4. Link Your Repository

```bash
railway link
```

### 5. Set Environment Variables

Set the following environment variables in the Railway dashboard:

- `TELEGRAM_BOT_TOKEN`: Your Telegram bot token from BotFather
- `API_BASE_URL`: The URL of your Vercel API (e.g., https://distribution-tracker-api.vercel.app)
- `API_KEY`: Your API key (if required)

### 6. Deploy the Bot

```bash
railway up
```

## Troubleshooting

### Bot Not Responding

1. Check the Railway logs for any errors
2. Verify that all environment variables are set correctly
3. Make sure the Vercel API is accessible from Railway

### Connection Issues

If the bot can't connect to the Vercel API:

1. Check if the API is running by visiting the health endpoint: `{API_BASE_URL}/api/health`
2. Verify that CORS is properly configured on the API
3. Check for any rate limiting or timeout issues

## Maintenance

### Updating the Bot

To update the bot with new changes:

1. Push your changes to the repository
2. Railway will automatically redeploy the bot

### Monitoring

Monitor the bot's performance using Railway's built-in metrics and logs.

## Additional Information

- Railway automatically assigns a URL to your project, but for a Telegram bot, you don't need to use this URL
- The bot will run continuously as long as your Railway project is active
- Railway's free tier includes 500 hours of runtime per month, which is sufficient for a single bot

## Monitoring and Scaling

- Monitor your bot's performance in the Railway dashboard
- If needed, you can upgrade your Railway plan for additional resources 