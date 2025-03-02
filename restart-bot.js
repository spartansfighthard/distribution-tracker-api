const { exec, spawn } = require('child_process');

console.log('===== SOL Distribution Tracker Bot Restart =====');

// Step 1: Stop any running bot instances
console.log('\n1. Stopping any running bot instances...');

function stopRunningBots() {
  return new Promise((resolve) => {
    // For Windows (which is what the user is running)
    exec('Get-Process -Name node | Where-Object {$_.CommandLine -like "*telegram-bot.js*"} | Stop-Process -Force', 
      { shell: 'powershell.exe' }, 
      (error, stdout, stderr) => {
        if (error) {
          // If error code is 1, it means no processes were found
          if (error.code === 1) {
            console.log('No running bot instances found.');
          } else {
            console.error(`Error stopping bot instances: ${error.message}`);
          }
        } else {
          console.log('Successfully stopped running bot instances.');
        }
        
        // Wait a moment to ensure processes are fully terminated
        setTimeout(resolve, 2000);
      }
    );
  });
}

// Step 2: Update bot commands
function updateBotCommands() {
  return new Promise((resolve) => {
    console.log('\n2. Updating bot commands...');
    
    exec('node update-bot-commands.js', (error, stdout, stderr) => {
      if (error) {
        console.error(`Error updating bot commands: ${error.message}`);
        console.error(stderr);
      } else {
        console.log(stdout);
      }
      resolve();
    });
  });
}

// Step 3: Start a new bot instance
function startNewBotInstance() {
  console.log('\n3. Starting new bot instance...');
  
  // Using spawn to keep the child process running
  const botProcess = spawn('node', ['telegram-bot.js'], {
    detached: true,
    stdio: 'ignore'
  });
  
  // Unref the child process so the parent can exit
  botProcess.unref();
  
  console.log(`Bot started with PID: ${botProcess.pid}`);
  console.log('Bot is now running in the background.');
}

// Run all steps in sequence
async function restartBot() {
  try {
    await stopRunningBots();
    await updateBotCommands();
    startNewBotInstance();
    
    console.log('\n===== Bot Restart Complete =====');
    console.log('The bot is now running with updated commands.');
  } catch (error) {
    console.error('Error during bot restart:', error);
  }
}

// Execute the restart process
restartBot(); 