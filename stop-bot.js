const { exec } = require('child_process');

console.log('Stopping any running Telegram bot instances...');

// Function to find and kill processes
function findAndKillProcesses() {
  return new Promise((resolve, reject) => {
    // For Windows
    if (process.platform === 'win32') {
      exec('tasklist /fi "imagename eq node.exe" /fo csv /nh', (error, stdout) => {
        if (error) {
          console.error(`Error getting process list: ${error.message}`);
          return reject(error);
        }
        
        // Parse the CSV output
        const lines = stdout.trim().split('\n');
        let botProcesses = [];
        
        for (const line of lines) {
          // Remove quotes and split by comma
          const parts = line.replace(/"/g, '').split(',');
          const pid = parts[1];
          
          // We'll check each process in more detail
          exec(`wmic process where processid=${pid} get commandline`, (err, cmdOut) => {
            if (!err && cmdOut.includes('telegram-bot.js')) {
              console.log(`Found Telegram bot process with PID ${pid}`);
              botProcesses.push(pid);
              
              // Kill the process
              exec(`taskkill /F /PID ${pid}`, (killErr) => {
                if (killErr) {
                  console.error(`Failed to kill process ${pid}: ${killErr.message}`);
                } else {
                  console.log(`Successfully terminated process ${pid}`);
                }
              });
            }
          });
        }
        
        // Give some time for the kill commands to complete
        setTimeout(() => {
          console.log(`Attempted to stop ${botProcesses.length} bot processes`);
          resolve();
        }, 2000);
      });
    } else {
      // For Linux/Mac
      exec("ps aux | grep 'node.*telegram-bot.js' | grep -v grep", (error, stdout) => {
        if (error) {
          // No processes found is not an error
          if (error.code === 1) {
            console.log('No Telegram bot processes found');
            return resolve();
          }
          console.error(`Error getting process list: ${error.message}`);
          return reject(error);
        }
        
        const lines = stdout.trim().split('\n');
        let killCount = 0;
        
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[1];
          
          exec(`kill -9 ${pid}`, (killErr) => {
            if (killErr) {
              console.error(`Failed to kill process ${pid}: ${killErr.message}`);
            } else {
              console.log(`Successfully terminated process ${pid}`);
              killCount++;
            }
          });
        }
        
        // Give some time for the kill commands to complete
        setTimeout(() => {
          console.log(`Stopped ${killCount} bot processes`);
          resolve();
        }, 2000);
      });
    }
  });
}

// Run the function
findAndKillProcesses()
  .then(() => {
    console.log('Process cleanup completed');
  })
  .catch(err => {
    console.error('Error during process cleanup:', err);
  }); 