/**
 * Script to check the API response and debug financial data issues
 */

const fetch = require('node-fetch');

const API_URL = 'https://distribution-tracker-api.vercel.app/api/stats?limit=50';

async function checkApi() {
  try {
    console.log(`Fetching data from: ${API_URL}`);
    const response = await fetch(API_URL);
    
    if (!response.ok) {
      throw new Error(`API returned status ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Log the full response
    console.log('\n=== FULL API RESPONSE ===');
    console.log(JSON.stringify(data, null, 2));
    
    // Check if financial data exists
    if (data.success && data.stats) {
      console.log('\n=== FINANCIAL DATA CHECK ===');
      const stats = data.stats;
      
      console.log(`Total Distributed: ${stats.totalSolDistributed} (${typeof stats.totalSolDistributed})`);
      console.log(`Total Received: ${stats.totalSolReceived} (${typeof stats.totalSolReceived})`);
      console.log(`Current Balance: ${stats.currentSolBalance} (${typeof stats.currentSolBalance})`);
      
      // Check if values are numeric but zero
      if (stats.totalSolDistributed === 0 && stats.totalSolReceived === 0 && stats.currentSolBalance === 0) {
        console.log('\n⚠️ All financial values are zero. This might indicate a data processing issue.');
      }
      
      // Check transaction counts
      console.log('\n=== TRANSACTION COUNTS ===');
      console.log(`Total Transactions: ${stats.totalTransactions}`);
      if (data.transactionCounts) {
        console.log(`Sent Transactions: ${data.transactionCounts.sentTransactions}`);
        console.log(`Received Transactions: ${data.transactionCounts.receivedTransactions}`);
      }
    } else {
      console.log('\n❌ API response does not contain expected data structure');
    }
    
  } catch (error) {
    console.error('Error fetching API data:', error.message);
  }
}

// Run the check
checkApi(); 