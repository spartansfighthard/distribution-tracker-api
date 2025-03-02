const fetch = require('node-fetch');

// Production API URL
const BASE_URL = 'https://distribution-tracker-api.vercel.app';

// Use a very small limit to avoid timeouts
const STATS_URL = `${BASE_URL}/api/stats?limit=1`;

async function testStats() {
  console.log('=== TESTING MINIMAL STATS ===');
  console.log(`URL: ${STATS_URL}`);
  
  try {
    console.log('\nSending request to stats endpoint...');
    const startTime = Date.now();
    const response = await fetch(STATS_URL);
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
      console.log('\n✅ Stats request successful!');
      console.log(`- Total transactions: ${data.stats.totalTransactions}`);
      console.log(`- Total SOL distributed: ${data.stats.totalSolDistributed}`);
      console.log(`- Current SOL balance: ${data.stats.currentSolBalance}`);
    } else {
      console.log('\n❌ Stats request failed!');
      console.log(`- Error: ${data.error?.message || 'Unknown error'}`);
    }
  } catch (error) {
    console.error('Error during test:', error.message);
  }
}

// Run the test
testStats(); 