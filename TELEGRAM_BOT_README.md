# SOL Distribution Tracker Telegram Bot

This is a standalone Telegram bot for the SOL Distribution Tracker that connects to the production API hosted on Vercel.

## Features

- Get current distribution statistics
- Check current wallet balance
- View total distributed amount
- Get recent transaction count
- Force refresh transaction data

## Prerequisites

- Node.js 14 or higher
- npm or yarn
- A Telegram bot token (obtained from [@BotFather](https://t.me/BotFather))

## Setup

1. Clone this repository:
   ```
   git clone <repository-url>
   cd <repository-directory>
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env.bot` file in the root directory with the following content:
   ```
   # Telegram Bot Configuration
   TELEGRAM_BOT_TOKEN=your_telegram_bot_token

   # API Configuration
   API_BASE_URL=https://distribution-tracker-api.vercel.app
   ```

4. Replace `your_telegram_bot_token` with your actual Telegram bot token.

## Running the Bot

To start the bot in development mode:

```
node telegram-bot.js
```

To restart the bot and update commands:

```
node restart-bot.js
```

## Utility Scripts

This project includes several utility scripts to help manage the bot:

- `update-bot-commands.js` - Updates the bot commands in Telegram
- `stop-bot.js` - Stops any running bot instances
- `restart-bot.js` - Stops running instances, updates commands, and starts a new instance

## Deploying the Bot

### Option 1: Deploy on a VPS or Dedicated Server

1. SSH into your server
2. Clone the repository
3. Install dependencies
4. Create the `.env.bot` file
5. Start the bot using a process manager like PM2:
   ```
   npm install -g pm2
   pm2 start telegram-bot.js --name "sol-distribution-bot"
   pm2 save
   pm2 startup
   ```

### Option 2: Deploy on Heroku

1. Create a new Heroku app
2. Set the following config vars in the Heroku dashboard:
   - `TELEGRAM_BOT_TOKEN`: Your Telegram bot token
   - `API_BASE_URL`: The URL of your API
3. Deploy the code to Heroku
4. Ensure you have the Procfile with the following content:
   ```
   worker: node telegram-bot.js
   ```

## Commands

- `/start` - Start the bot and get a welcome message
- `/stats` - Get current distribution statistics
- `/balance` - Check current wallet balance
- `/distributed` - View total distributed amount
- `/transactions` - Get recent transaction count
- `/refresh` - Force refresh transaction data
- `/help` - Show help message

## Troubleshooting

- If the bot doesn't respond, check if the Telegram bot token is correct
- If the bot can't connect to the API, check if the API URL is correct and the API is running
- If the stats endpoint times out, this is likely due to Vercel's 15-second limit for serverless functions
- If you see "409 Conflict" errors, it means multiple instances of the bot are running. Use `node restart-bot.js` to fix this.

## License

This project is licensed under the MIT License - see the LICENSE file for details. 