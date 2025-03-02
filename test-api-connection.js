// Test script to verify connection to the Vercel API
const fetch = require('node-fetch');

const API_BASE_URL = 'https://distribution-tracker-api.vercel.app';

async function testEndpoint(endpoint, description) {
  console.log(`\nTesting ${description} (${endpoint})...`);
  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`);
    console.log('Status:', response.status, response.statusText);
    
    if (response.ok) {
      const data = await response.json();
      console.log('Response:', JSON.stringify(data, null, 2));
      return { success: true, data };
    } else {
      console.log(`Error: ${response.status} ${response.statusText}`);
      return { success: false, error: `${response.status} ${response.statusText}` };
    }
  } catch (error) {
    console.log(`Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function testAPIConnection() {
  console.log('Testing connection to the Vercel API...');
  console.log(`API URL: ${API_BASE_URL}`);
  
  let successCount = 0;
  let failCount = 0;
  
  // Test root endpoint
  const rootResult = await testEndpoint('/', 'Root Endpoint');
  rootResult.success ? successCount++ : failCount++;
  
  // Test health endpoint
  const healthResult = await testEndpoint('/api/health', 'Health Endpoint');
  healthResult.success ? successCount++ : failCount++;
  
  // Test stats endpoint
  const statsResult = await testEndpoint('/api/stats', 'Stats Endpoint');
  statsResult.success ? successCount++ : failCount++;
  
  // Test sol endpoint
  const solResult = await testEndpoint('/api/sol', 'SOL Endpoint');
  solResult.success ? successCount++ : failCount++;
  
  // Test distributed endpoint
  const distributedResult = await testEndpoint('/api/distributed', 'Distributed Endpoint');
  distributedResult.success ? successCount++ : failCount++;
  
  // Test force-refresh endpoint
  const refreshResult = await testEndpoint('/api/force-refresh', 'Force-refresh Endpoint');
  refreshResult.success ? successCount++ : failCount++;
  
  // Test help endpoint
  const helpResult = await testEndpoint('/api/help', 'Help Endpoint');
  helpResult.success ? successCount++ : failCount++;
  
  console.log('\n=== API CONNECTION TEST RESULTS ===');
  console.log(`Successful endpoints: ${successCount}`);
  console.log(`Failed endpoints: ${failCount}`);
  
  if (failCount === 0) {
    console.log('\n✅ All API endpoints are accessible!');
    console.log('The Telegram bot should be able to connect to the API successfully.');
  } else if (successCount > 0) {
    console.log('\n⚠️ Some API endpoints are accessible, but others failed.');
    console.log('The Telegram bot may work partially, but some commands might fail.');
  } else {
    console.log('\n❌ No API endpoints are accessible.');
    console.log('The Telegram bot will not be able to connect to the API.');
  }
}

testAPIConnection().catch(error => {
  console.error('Test failed:', error);
}); 