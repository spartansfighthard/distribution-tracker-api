/**
 * Test Bot with Limit Parameter
 * 
 * This script tests the Telegram bot with a modified fetchStats function that includes a limit parameter of 1.
 * Based on our testing, we know that the API works with a limit of 1 but times out with higher values.
 * 
 * This script will:
 * 1. Modify the fetchStats function in the bot to use a limit parameter of 1
 * 2. Start the bot with the modified function
 * 3. Test the bot commands to ensure they work with the limited API
 */

require('dotenv').config();
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const BOT_FILE_PATH = path.join(__dirname, 'telegram-bot.js');
const BACKUP_FILE_PATH = path.join(__dirname, 'telegram-bot.backup.js');
const LIMIT_VALUE = 1;

// Function to backup the original bot file
function backupBotFile() {
  console.log('Creating backup of the original bot file...');
  try {
    fs.copyFileSync(BOT_FILE_PATH, BACKUP_FILE_PATH);
    console.log('✅ Backup created successfully at:', BACKUP_FILE_PATH);
    return true;
  } catch (error) {
    console.error('❌ Failed to create backup:', error.message);
    return false;
  }
}

// Function to modify the fetchStats function in the bot file
function modifyBotFile() {
  console.log(`Modifying bot file to use limit=${LIMIT_VALUE}...`);
  try {
    let botCode = fs.readFileSync(BOT_FILE_PATH, 'utf8');
    
    // Replace the fetchStats function to use a limit of 1
    const fetchStatsPattern = /async function fetchStats\(\) \{[\s\S]+?const response = await fetch\(`\$\{API_BASE_URL\}\/api\/stats\?limit=(\d+)`\);/;
    const match = botCode.match(fetchStatsPattern);
    
    if (match) {
      const originalLimit = match[1];
      
      botCode = botCode.replace(
        fetchStatsPattern,
        `async function fetchStats() {
  try {
    // Modified to use limit=${LIMIT_VALUE} instead of limit=${originalLimit}
    const response = await fetch(\`\${API_BASE_URL}/api/stats?limit=${LIMIT_VALUE}\`);`
      );
      
      // Also modify the force-refresh endpoint if it exists
      const refreshPattern = /\/api\/force-refresh\?limit=(\d+)/g;
      botCode = botCode.replace(refreshPattern, `/api/force-refresh?limit=${LIMIT_VALUE}`);
      
      // Add a note at the top of the file
      botCode = `/**
 * MODIFIED VERSION WITH LIMIT PARAMETER
 * This file has been automatically modified to use a limit parameter of ${LIMIT_VALUE} in API calls.
 * Original file is backed up at telegram-bot.backup.js
 * Modified on: ${new Date().toISOString()}
 */\n\n${botCode}`;
      
      fs.writeFileSync(BOT_FILE_PATH, botCode);
      console.log('✅ Bot file modified successfully');
      console.log(`Modified fetchStats function to use limit=${LIMIT_VALUE} (was ${originalLimit})`);
      console.log('Also modified any force-refresh calls to use the same limit');
      return true;
    } else {
      console.error('❌ Could not find fetchStats pattern in the bot file');
      return false;
    }
  } catch (error) {
    console.error('❌ Failed to modify bot file:', error.message);
    return false;
  }
}

// Function to restore the original bot file
function restoreBotFile() {
  console.log('Restoring original bot file...');
  try {
    if (fs.existsSync(BACKUP_FILE_PATH)) {
      fs.copyFileSync(BACKUP_FILE_PATH, BOT_FILE_PATH);
      console.log('✅ Original bot file restored');
      return true;
    } else {
      console.error('❌ Backup file not found');
      return false;
    }
  } catch (error) {
    console.error('❌ Failed to restore bot file:', error.message);
    return false;
  }
}

// Function to restart the bot
function restartBot() {
  console.log('Restarting the bot with modified API URL...');
  return new Promise((resolve, reject) => {
    exec('node restart-bot.js', (error, stdout, stderr) => {
      if (error) {
        console.error('❌ Failed to restart bot:', error.message);
        reject(error);
        return;
      }
      
      console.log('Bot restart output:');
      console.log(stdout);
      
      if (stderr) {
        console.error('Bot restart stderr:');
        console.error(stderr);
      }
      
      console.log('✅ Bot restarted successfully with modified API URL');
      resolve();
    });
  });
}

// Main function to run the test
async function runTest() {
  console.log('=== TESTING BOT WITH LIMIT PARAMETER ===');
  console.log(`Limit value: ${LIMIT_VALUE}`);
  
  try {
    // Step 1: Backup the original bot file
    if (!backupBotFile()) {
      console.error('Aborting test due to backup failure');
      return;
    }
    
    // Step 2: Modify the bot file
    if (!modifyBotFile()) {
      console.error('Aborting test due to modification failure');
      restoreBotFile();
      return;
    }
    
    // Step 3: Restart the bot with the modified file
    await restartBot();
    
    console.log('\n=== TEST COMPLETED SUCCESSFULLY ===');
    console.log('The bot is now running with a modified fetchStats function that uses a limit parameter of 1.');
    console.log('You can now test the bot commands to ensure they work with the limited API.');
    console.log('\nTo restore the original bot file, run:');
    console.log('node test-bot-with-limit.js --restore');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    restoreBotFile();
  }
}

// Function to handle command line arguments
function handleArgs() {
  const args = process.argv.slice(2);
  
  if (args.includes('--restore')) {
    restoreBotFile();
    console.log('You can now restart the bot with the original file using:');
    console.log('node restart-bot.js');
  } else {
    runTest();
  }
}

// Run the script
handleArgs(); 