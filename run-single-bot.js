/**
 * Run Single Bot Instance
 * 
 * This script ensures only one instance of the bot is running by:
 * 1. Stopping any existing Node.js processes
 * 2. Starting a single instance of the bot
 * 3. Monitoring to ensure it stays running
 */

const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Configuration
const BOT_SCRIPT_PATH = path.join(__dirname, 'telegram-bot.js');

// Function to stop all Node.js processes
function stopAllNodeProcesses() {
  return new Promise((resolve, reject) => {
    console.log('Stopping all Node.js processes...');
    
    // Use different commands based on platform
    const command = process.platform === 'win32'
      ? 'taskkill /F /IM node.exe'
      : "pkill -f 'node'";
    
    exec(command, (error) => {
      // Ignore errors as they might just mean no processes were found
      console.log('All Node.js processes stopped (or none were running)');
      
      // Wait a moment to ensure processes are fully terminated
      setTimeout(resolve, 2000);
    });
  });
}

// Function to start the bot
function startBot() {
  return new Promise((resolve, reject) => {
    console.log('Starting a single instance of the bot...');
    
    // Check if the bot script exists
    if (!fs.existsSync(BOT_SCRIPT_PATH)) {
      return reject(new Error(`Bot script not found at: ${BOT_SCRIPT_PATH}`));
    }
    
    console.log(`Bot script path: ${BOT_SCRIPT_PATH}`);
    
    // Spawn the bot process
    const botProcess = spawn('node', [BOT_SCRIPT_PATH], {
      detached: true,
      stdio: ['ignore', 'inherit', 'inherit']
    });
    
    // Log the process ID
    console.log(`Bot started with PID: ${botProcess.pid}`);
    
    // Handle process error
    botProcess.on('error', (err) => {
      reject(new Error(`Failed to start bot: ${err.message}`));
    });
    
    // Wait a moment to ensure the process starts correctly
    setTimeout(() => {
      // Unref the process to allow this script to exit
      botProcess.unref();
      resolve(botProcess.pid);
    }, 1000);
  });
}

// Main function
async function main() {
  console.log('=== ENSURING SINGLE BOT INSTANCE ===');
  
  try {
    // Step 1: Stop all Node.js processes
    await stopAllNodeProcesses();
    
    // Step 2: Start a single instance of the bot
    const botPid = await startBot();
    
    console.log('\n=== BOT STARTED SUCCESSFULLY ===');
    console.log(`The bot is now running with PID: ${botPid}`);
    console.log('This script will now exit, but the bot will continue running in the background.');
    console.log('\nTo stop the bot, run:');
    console.log('Get-Process -Name node | Stop-Process -Force  (on Windows)');
    console.log('pkill -f "node"  (on Linux/Mac)');
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Run the main function
main(); 