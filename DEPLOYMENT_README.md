# Deployment Configuration for Distribution Tracker

This project has two separate deployments:

1. **API on Vercel**: The backend API that handles data processing and storage
2. **Telegram Bot on Railway**: The Telegram bot that interacts with users

## Package.json Files

Because these deployments have different dependencies, we maintain separate package.json files:

- `package.json`: Used for the Telegram bot deployment on Railway
- `vercel-package.json`: Used for the API deployment on Vercel

## Deployment Instructions

### Vercel API Deployment

1. Before deploying to Vercel, rename the files:
   ```
   copy vercel-package.json package.json
   ```

2. Deploy to Vercel:
   ```
   vercel --prod
   ```

3. After deployment, restore the Railway package.json:
   ```
   git checkout package.json
   ```

### Railway Bot Deployment

1. Make sure `package.json` contains only the dependencies needed for the Telegram bot
2. Deploy to Railway using the Railway dashboard or CLI

## Environment Variables

### Vercel API Environment Variables

- `MONGODB_URI`: MongoDB connection string
- `DISTRIBUTION_WALLET_ADDRESS`: The main wallet address to track
- `HELIUS_API_KEY`: Your Helius API key
- `HELIUS_RPC_URL`: Helius RPC URL
- `API_KEY`: Your generated API key for authentication

### Railway Bot Environment Variables

- `TELEGRAM_BOT_TOKEN`: Your Telegram bot token from BotFather
- `API_BASE_URL`: The URL of your Vercel API (e.g., https://distribution-tracker-api.vercel.app)
- `API_KEY`: The same API key used in your Vercel deployment

## Troubleshooting

### Common Vercel Errors

- **Missing dependencies**: If you see errors like "Cannot find module 'express'", make sure you're using the correct package.json with all required dependencies.
- **Timeout errors**: Vercel has a 15-second execution limit for serverless functions. Consider optimizing your API or implementing caching.

### Common Railway Errors

- **Connection issues**: If the bot can't connect to the API, check that the API_BASE_URL is correct and the API is running.
- **Authentication errors**: Ensure the API_KEY is correctly set in both environments. 