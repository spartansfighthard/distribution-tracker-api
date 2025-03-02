# Bot Management Guide

This guide explains how to manage the Telegram bot using the `manage-bot.js` script.

## Prerequisites

- Node.js installed
- Bot configuration in `.env.bot` file

## Commands

The management script provides several commands to control the bot:

### Check Bot Status

```bash
node manage-bot.js status
```

This command will show if the bot is currently running and display its process ID.

### Start the Bot

```bash
node manage-bot.js start
```

This command will start the bot if it's not already running. The bot will run in the background.

### Stop the Bot

```bash
node manage-bot.js stop
```

This command will stop the running bot.

### Restart the Bot

```bash
node manage-bot.js restart
```

This command will stop the bot if it's running and then start a new instance.

### Help

```bash
node manage-bot.js help
```

This command will display help information about the available commands.

## Troubleshooting

### Multiple Bot Instances

If you encounter issues with multiple bot instances running simultaneously, you can:

1. Check running instances:
   ```bash
   node manage-bot.js status
   ```

2. Stop all Node.js processes (Windows):
   ```bash
   Get-Process -Name node | Stop-Process -Force
   ```

3. Start a fresh instance:
   ```bash
   node manage-bot.js start
   ```

### Bot Not Responding

If the bot is not responding to commands:

1. Check if the bot is running:
   ```bash
   node manage-bot.js status
   ```

2. Restart the bot:
   ```bash
   node manage-bot.js restart
   ```

3. Check the Telegram API status at [Telegram API Status](https://core.telegram.org/api/status)

## How It Works

The management script:

1. Maintains a PID file (`.bot.pid`) to track the running bot process
2. Uses platform-specific commands to check and manage processes
3. Ensures only one instance of the bot is running at a time

## Best Practices

- Always use the management script to start and stop the bot
- Avoid running multiple instances of the bot with the same token
- Restart the bot after making changes to the code 