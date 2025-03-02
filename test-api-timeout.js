const fetch = require('node-fetch');

const BASE_URL = 'https://distribution-tracker-api.vercel.app';

async function testEndpoint(url, params = {}) {
  console.log(`Testing endpoint: ${url}`);
  try {
    // Add a timeout parameter to limit the number of transactions processed
    const queryParams = new URLSearchParams(params).toString();
    const fullUrl = queryParams ? `${url}?${queryParams}` : url;
    
    console.log(`Fetching: ${fullUrl}`);
    const startTime = Date.now();
    const response = await fetch(fullUrl);
    const endTime = Date.now();
    
    console.log(`Status: ${response.status} ${response.statusText}`);
    console.log(`Response time: ${endTime - startTime}ms`);
    
    const data = await response.json();
    console.log('Response:', JSON.stringify(data, null, 2));
    return { success: true, status: response.status, data };
  } catch (error) {
    console.error(`Error testing ${url}:`, error.message);
    return { success: false, error: error.message };
  }
}

async function testAPIWithLimits() {
  console.log('Testing API with transaction limits...');
  
  // Test health endpoint
  await testEndpoint(`${BASE_URL}/api/health`);
  
  // Test stats endpoint with limit parameter
  console.log('\nTesting stats endpoint with limit=50...');
  await testEndpoint(`${BASE_URL}/api/stats`, { limit: 50 });
  
  // Test stats endpoint with limit parameter
  console.log('\nTesting stats endpoint with limit=20...');
  await testEndpoint(`${BASE_URL}/api/stats`, { limit: 20 });
  
  // Test stats endpoint with limit parameter
  console.log('\nTesting stats endpoint with limit=10...');
  await testEndpoint(`${BASE_URL}/api/stats`, { limit: 10 });
  
  console.log('\nAPI testing complete');
}

// Run the test
testAPIWithLimits().catch(error => {
  console.error('Test failed:', error);
}); 