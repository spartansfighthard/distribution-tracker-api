/**
 * Test API with Standard Limit
 * 
 * This script tests the API with a standard limit parameter (10).
 * It tests both the stats and force-refresh endpoints.
 */

const fetch = require('node-fetch');

// Production API URL
const BASE_URL = 'https://distribution-tracker-api.vercel.app';

// Use a standard limit that should still avoid timeouts
const LIMIT = 10;

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
  console.log('TESTING API WITH STANDARD LIMIT');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Limit: ${LIMIT}`);
  
  // Step 1: Test health endpoint
  const healthUrl = `${BASE_URL}/api/health`;
  await testEndpoint(healthUrl, 'Health Check');
  
  // Step 2: Test stats endpoint
  const statsUrl = `${BASE_URL}/api/stats?limit=${LIMIT}`;
  const statsResult = await testEndpoint(statsUrl, 'Stats');
  
  if (statsResult && statsResult.success) {
    console.log('\n✅ Stats request successful!');
    console.log(`- Total transactions: ${statsResult.stats.totalTransactions}`);
    console.log(`- Total SOL distributed: ${statsResult.stats.totalSolDistributed}`);
    console.log(`- Current SOL balance: ${statsResult.stats.currentSolBalance}`);
    
    if (statsResult.transactionCounts) {
      console.log(`- Total stored transactions: ${statsResult.transactionCounts.totalStoredTransactions}`);
      console.log(`- Received transactions: ${statsResult.transactionCounts.receivedTransactions}`);
      console.log(`- Sent transactions: ${statsResult.transactionCounts.sentTransactions}`);
    }
  } else {
    console.log('\n❌ Stats request failed!');
  }
  
  // Wait a moment before testing force-refresh
  console.log('\nWaiting 2 seconds before testing force-refresh...');
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Step 3: Test force-refresh endpoint
  const forceRefreshUrl = `${BASE_URL}/api/force-refresh?limit=${LIMIT}`;
  const refreshResult = await testEndpoint(forceRefreshUrl, 'Force Refresh');
  
  if (refreshResult && refreshResult.success) {
    console.log('\n✅ Force refresh successful!');
    console.log(`- Transaction count: ${refreshResult.transactionCount || 0}`);
    console.log(`- Fetched transactions: ${refreshResult.fetchedTransactions || 0}`);
  } else {
    console.log('\n❌ Force refresh failed!');
  }
  
  console.log('\nAPI testing complete!');
}

// Run the tests
runTests(); 