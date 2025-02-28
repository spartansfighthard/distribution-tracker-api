const fs = require('fs');
const path = require('path');

// Check if .env file exists
if (!fs.existsSync(path.join(__dirname, '.env'))) {
  // Check if .env.example exists
  if (fs.existsSync(path.join(__dirname, '.env.example'))) {
    // Copy .env.example to .env
    fs.copyFileSync(
      path.join(__dirname, '.env.example'),
      path.join(__dirname, '.env')
    );
    console.log('Created .env file from .env.example');
  } else {
    console.error('.env.example file not found');
    process.exit(1);
  }
} else {
  console.log('.env file already exists');
}

// Create data directory if it doesn't exist
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log('Created data directory');
}

console.log('Setup complete! You can now run the application with:');
console.log('npm start'); 