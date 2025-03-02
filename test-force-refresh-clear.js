const fetch = require('node-fetch');

// Production API URL
const BASE_URL = 'https://distribution-tracker-api.vercel.app';

// Update the URLs to include a smaller limit parameter
const STATS_URL = `${BASE_URL}/api/stats?limit=10`;
const FORCE_REFRESH_URL = `${BASE_URL}/api/force-refresh?limit=10`;

async function testEndpoint(endpoint, description) {
  console.log(`\nTesting ${description} (${endpoint})...`);
  try {
    const response = await fetch(endpoint);
    console.log(`Status: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`Error: ${error.message}`);
    return null;
  }
}

async function verifyTransactionClearing() {
  console.log('=== TESTING FORCE-REFRESH TRANSACTION CLEARING ===');
  console.log(`Base URL: ${BASE_URL}`);
  
  console.log('\nStep 1: Checking current transaction count...');
  
  // Get initial stats
  const initialStats = await testEndpoint(STATS_URL, 'Stats Endpoint (Before)');
  
  if (!initialStats || !initialStats.success) {
    console.log('Failed to get initial stats. Aborting test.');
    return;
  }
  
  const initialCount = initialStats.stats.totalTransactions;
  console.log(`Initial transaction count: ${initialCount}`);
  
  console.log('\nStep 2: Forcing refresh of transactions...');
  
  // Force refresh
  const refreshResult = await testEndpoint(FORCE_REFRESH_URL, 'Force Refresh Endpoint');
  
  if (!refreshResult || !refreshResult.success) {
    console.log('Failed to force refresh. Aborting test.');
    return;
  }
  
  console.log(`Force refresh result: ${refreshResult.success ? 'Success' : 'Failed'}`);
  
  console.log('\nStep 3: Checking updated transaction count...');
  
  // Get updated stats
  const updatedStats = await testEndpoint(STATS_URL, 'Stats Endpoint (After)');
  
  if (!updatedStats || !updatedStats.success) {
    console.log('Failed to get updated stats. Aborting test.');
    return;
  }
  
  const updatedCount = updatedStats.stats.totalTransactions;
  console.log(`Updated transaction count: ${updatedCount}`);
  
  console.log('\nTest Results:');
  console.log(`- Initial count: ${initialCount}`);
  console.log(`- Updated count: ${updatedCount}`);
  console.log(`- Difference: ${updatedCount - initialCount}`);
  
  if (updatedCount !== initialCount) {
    console.log('✅ Test PASSED: Transaction count changed after force refresh');
  } else {
    console.log('❌ Test FAILED: Transaction count did not change after force refresh');
  }
}

// Run the test
verifyTransactionClearing(); 