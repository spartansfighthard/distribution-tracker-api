const fetch = require('node-fetch');

// Production API URL
const BASE_URL = 'https://distribution-tracker-api.vercel.app';

// Use a very small limit to avoid timeouts
const FORCE_REFRESH_URL = `${BASE_URL}/api/force-refresh?limit=1`;

async function testForceRefresh() {
  console.log('=== TESTING MINIMAL FORCE-REFRESH ===');
  console.log(`URL: ${FORCE_REFRESH_URL}`);
  
  try {
    console.log('\nSending request to force-refresh endpoint...');
    const startTime = Date.now();
    const response = await fetch(FORCE_REFRESH_URL);
    const endTime = Date.now();
    
    console.log(`Status: ${response.status} ${response.statusText}`);
    console.log(`Response time: ${endTime - startTime}ms`);
    
    if (!response.ok) {
      console.error(`Error: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      console.error('Error details:', errorText);
      return;
    }
    
    const data = await response.json();
    console.log('Response data:', JSON.stringify(data, null, 2));
    
    if (data.success) {
      console.log('\n✅ Force refresh successful!');
      console.log(`- Timestamp: ${data.timestamp}`);
      console.log(`- Transaction count: ${data.transactionCount}`);
      console.log(`- Fetched transactions: ${data.fetchedTransactions}`);
    } else {
      console.log('\n❌ Force refresh failed!');
      console.log(`- Error: ${data.error?.message || 'Unknown error'}`);
    }
  } catch (error) {
    console.error('Error during test:', error.message);
  }
}

// Run the test
testForceRefresh(); 