const fetch = require('node-fetch');

// Production API URL
const BASE_URL = 'https://distribution-tracker-api.vercel.app';

// Use a very small limit to avoid timeouts
const LIMIT = 1;

async function testEndpoint(url, description) {
  console.log(`\n=== TESTING ${description.toUpperCase()} ===`);
  console.log(`URL: ${url}`);
  
  try {
    console.log('\nSending request...');
    const startTime = Date.now();
    const response = await fetch(url);
    const endTime = Date.now();
    
    console.log(`Status: ${response.status} ${response.statusText}`);
    console.log(`Response time: ${endTime - startTime}ms`);
    
    if (!response.ok) {
      console.error(`Error: ${response.status} ${response.statusText}`);
      try {
        const errorText = await response.text();
        console.error('Error details:', errorText);
      } catch (e) {
        console.error('Could not read error details');
      }
      return null;
    }
    
    const data = await response.json();
    console.log('Response summary:');
    console.log(`- Success: ${data.success}`);
    console.log(`- Timestamp: ${data.timestamp}`);
    
    return data;
  } catch (error) {
    console.error('Error during test:', error.message);
    return null;
  }
}

async function runTests() {
  console.log('TESTING API WITH MINIMAL LIMIT');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Limit: ${LIMIT}`);
  
  // Step 1: Test force-refresh endpoint
  const forceRefreshUrl = `${BASE_URL}/api/force-refresh?limit=${LIMIT}`;
  const refreshResult = await testEndpoint(forceRefreshUrl, 'Force Refresh');
  
  if (refreshResult && refreshResult.success) {
    console.log('\n✅ Force refresh successful!');
    console.log(`- Transaction count: ${refreshResult.transactionCount || 0}`);
  } else {
    console.log('\n❌ Force refresh failed!');
  }
  
  // Wait a moment for the server to process
  console.log('\nWaiting 5 seconds before testing stats...');
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Step 2: Test stats endpoint
  const statsUrl = `${BASE_URL}/api/stats?limit=${LIMIT}`;
  const statsResult = await testEndpoint(statsUrl, 'Stats');
  
  if (statsResult && statsResult.success) {
    console.log('\n✅ Stats request successful!');
    console.log(`- Total transactions: ${statsResult.stats.totalTransactions}`);
    console.log(`- Total SOL distributed: ${statsResult.stats.totalSolDistributed}`);
    console.log(`- Current SOL balance: ${statsResult.stats.currentSolBalance}`);
  } else {
    console.log('\n❌ Stats request failed!');
  }
}

// Run the tests
runTests(); 