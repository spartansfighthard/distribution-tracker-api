/**
 * Bot Management Script
 * 
 * This script provides commands to:
 * 1. Start the bot
 * 2. Stop the bot
 * 3. Restart the bot
 * 4. Check bot status
 */

require('dotenv').config({ path: '.env.bot' });
const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const BOT_SCRIPT = path.join(__dirname, 'telegram-bot.js');
const PID_FILE = path.join(__dirname, '.bot.pid');
const LOG_FILE = path.join(__dirname, 'bot.log');

// Command line arguments
const command = process.argv[2] || 'help';

// Helper functions
function savePid(pid) {
  fs.writeFileSync(PID_FILE, pid.toString());
  console.log(`PID ${pid} saved to ${PID_FILE}`);
}

function getPid() {
  try {
    if (fs.existsSync(PID_FILE)) {
      return parseInt(fs.readFileSync(PID_FILE, 'utf8').trim());
    }
  } catch (err) {
    console.error('Error reading PID file:', err.message);
  }
  return null;
}

function isProcessRunning(pid) {
  try {
    // Different check based on platform
    if (process.platform === 'win32') {
      const result = require('child_process').spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH']);
      return result.stdout.toString().includes(pid.toString());
    } else {
      process.kill(pid, 0);
      return true;
    }
  } catch (err) {
    return false;
  }
}

function stopBot() {
  return new Promise((resolve) => {
    console.log('Stopping bot...');
    const pid = getPid();
    
    if (!pid) {
      console.log('No PID file found. Bot may not be running.');
      return resolve(false);
    }
    
    if (!isProcessRunning(pid)) {
      console.log(`Process with PID ${pid} is not running.`);
      if (fs.existsSync(PID_FILE)) {
        fs.unlinkSync(PID_FILE);
      }
      return resolve(false);
    }
    
    try {
      if (process.platform === 'win32') {
        exec(`taskkill /PID ${pid} /F`, (error) => {
          if (error) {
            console.error(`Error stopping bot: ${error.message}`);
            return resolve(false);
          }
          
          console.log(`Bot with PID ${pid} stopped successfully.`);
          if (fs.existsSync(PID_FILE)) {
            fs.unlinkSync(PID_FILE);
          }
          resolve(true);
        });
      } else {
        process.kill(pid, 'SIGTERM');
        console.log(`Bot with PID ${pid} stopped successfully.`);
        if (fs.existsSync(PID_FILE)) {
          fs.unlinkSync(PID_FILE);
        }
        resolve(true);
      }
    } catch (err) {
      console.error(`Error stopping bot: ${err.message}`);
      resolve(false);
    }
  });
}

function startBot() {
  return new Promise((resolve) => {
    console.log('Starting bot...');
    
    // Start the bot process with proper stdio handling
    const botProcess = spawn('node', [BOT_SCRIPT], {
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore']
    });
    
    botProcess.on('error', (err) => {
      console.error(`Failed to start bot: ${err.message}`);
      resolve(false);
    });
    
    // Save the PID
    savePid(botProcess.pid);
    
    // Unref the process to allow this script to exit
    botProcess.unref();
    
    console.log(`Bot started with PID: ${botProcess.pid}`);
    console.log(`Bot is now running in the background.`);
    
    resolve(true);
  });
}

function checkStatus() {
  const pid = getPid();
  
  if (!pid) {
    console.log('Bot status: NOT RUNNING (No PID file found)');
    return false;
  }
  
  if (isProcessRunning(pid)) {
    console.log(`Bot status: RUNNING (PID: ${pid})`);
    return true;
  } else {
    console.log(`Bot status: NOT RUNNING (PID ${pid} not found)`);
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
    }
    return false;
  }
}

// Main function
async function main() {
  switch (command.toLowerCase()) {
    case 'start':
      if (checkStatus()) {
        console.log('Bot is already running. Use "restart" to restart it.');
      } else {
        await startBot();
      }
      break;
      
    case 'stop':
      await stopBot();
      break;
      
    case 'restart':
      console.log('Restarting bot...');
      await stopBot();
      // Wait a moment to ensure the process is fully stopped
      await new Promise(resolve => setTimeout(resolve, 2000));
      await startBot();
      break;
      
    case 'status':
      checkStatus();
      break;
      
    case 'help':
    default:
      console.log(`
Bot Management Script
Usage: node manage-bot.js [command]

Commands:
  start    - Start the bot if not already running
  stop     - Stop the running bot
  restart  - Restart the bot (stop and start)
  status   - Check if the bot is running
  help     - Show this help message
      `);
      break;
  }
}

// Run the main function
main(); 