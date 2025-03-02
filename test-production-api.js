const fetch = require('node-fetch');

// Production API URL
const BASE_URL = 'https://distribution-tracker-api.vercel.app';

async function testEndpoint(endpoint, description) {
  console.log(`\nTesting ${description} (${endpoint})...`);
  try {
    const response = await fetch(`${BASE_URL}${endpoint}`);
    const status = response.status;
    const statusText = response.statusText;
    console.log(`Status: ${status} ${statusText}`);
    
    if (response.ok) {
      const data = await response.json();
      console.log('Response:');
      console.log(JSON.stringify(data, null, 2));
      return { success: true, data };
    } else {
      console.log(`Error: ${status} ${statusText}`);
      return { success: false, error: `${status} ${statusText}` };
    }
  } catch (error) {
    console.log(`Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function runTests() {
  console.log('=== TESTING PRODUCTION API ===');
  console.log(`Base URL: ${BASE_URL}`);
  
  // Test root endpoint
  await testEndpoint('/', 'Root Endpoint');
  
  // Test health endpoint
  await testEndpoint('/api/health', 'Health Endpoint');
  
  // Test stats endpoint
  await testEndpoint('/api/stats', 'Stats Endpoint');
  
  // Test force-refresh endpoint
  await testEndpoint('/api/force-refresh', 'Force-refresh Endpoint');
  
  // Test help endpoint
  await testEndpoint('/api/help', 'Help Endpoint');
  
  console.log('\n=== TESTS COMPLETED ===');
}

runTests().catch(error => {
  console.error('Test failed:', error);
}); 