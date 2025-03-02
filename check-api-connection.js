// Script to check if the bot can connect to the Vercel API
require('dotenv').config({ path: '.env.bot' });
const fetch = require('node-fetch');

// API base URL
const API_BASE_URL = process.env.API_BASE_URL || 'https://distribution-tracker-api.vercel.app';

// API key
const API_KEY = process.env.API_KEY;

// Headers
const headers = {
  'User-Agent': 'TelegramBot',
};

if (API_KEY) {
  headers['X-API-Key'] = API_KEY;
}

async function checkApiConnection() {
  console.log(`Checking connection to API at ${API_BASE_URL}...`);
  
  try {
    // Check health endpoint
    console.log('Testing health endpoint...');
    const healthResponse = await fetch(`${API_BASE_URL}/api/health`, { headers });
    
    if (!healthResponse.ok) {
      throw new Error(`Health endpoint returned ${healthResponse.status}: ${healthResponse.statusText}`);
    }
    
    const healthData = await healthResponse.json();
    console.log('✅ Health endpoint response:', JSON.stringify(healthData, null, 2));
    
    // Check stats endpoint with limit parameter
    console.log('\nTesting stats endpoint with limit=1...');
    const statsResponse = await fetch(`${API_BASE_URL}/api/stats?limit=1`, { headers });
    
    if (!statsResponse.ok) {
      throw new Error(`Stats endpoint returned ${statsResponse.status}: ${statsResponse.statusText}`);
    }
    
    const statsData = await statsResponse.json();
    console.log('✅ Stats endpoint response:', JSON.stringify(statsData, null, 2));
    
    console.log('\n✅ API connection test successful!');
  } catch (error) {
    console.error('❌ API connection test failed:', error.message);
    
    // Provide troubleshooting advice
    console.log('\nTroubleshooting steps:');
    console.log('1. Check if the API is deployed and running');
    console.log('2. Verify that your API_BASE_URL is correct');
    console.log('3. Check if the API requires authentication and your API_KEY is valid');
    console.log('4. Check if there are any CORS restrictions on the API');
    console.log('5. Check if the API is experiencing timeouts or rate limiting');
  }
}

// Run the check
checkApiConnection(); 