/**
 * Fetch All Transactions Script
 * 
 * This script repeatedly calls the /api/fetch-all endpoint until all transactions are fetched.
 * It handles the Vercel serverless function time limits by making multiple calls.
 */

const fetch = require('node-fetch');

// Configuration
const API_BASE_URL = process.env.API_BASE_URL || 'https://distribution-tracker-api.vercel.app';
const API_KEY = process.env.API_KEY || 'your-api-key-here'; // Replace with your actual API key
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'your-admin-password-here'; // Replace with your actual admin password
const MAX_ATTEMPTS = 10; // Maximum number of attempts to fetch all transactions
const DELAY_BETWEEN_CALLS = 5000; // 5 seconds delay between calls
const REQUEST_TIMEOUT = 30000; // 30 seconds timeout for each request

async function fetchAllTransactions() {
  console.log('=== FETCH ALL TRANSACTIONS SCRIPT ===');
  console.log(`API URL: ${API_BASE_URL}`);
  console.log(`Max attempts: ${MAX_ATTEMPTS}`);
  console.log(`Delay between calls: ${DELAY_BETWEEN_CALLS}ms`);
  console.log(`Request timeout: ${REQUEST_TIMEOUT}ms`);
  console.log('Starting fetch process...\n');
  
  let attempts = 0;
  let totalFetched = 0;
  let continueLoop = true;
  
  // Prepare headers with authentication
  const headers = {
    'User-Agent': 'FetchAllScript',
    'X-API-Key': API_KEY,
    'X-Admin-Password': ADMIN_PASSWORD
  };
  
  while (continueLoop && attempts < MAX_ATTEMPTS) {
    attempts++;
    console.log(`\nAttempt ${attempts}/${MAX_ATTEMPTS}:`);
    
    try {
      console.log(`Calling ${API_BASE_URL}/api/fetch-all...`);
      const startTime = Date.now();
      
      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
      
      try {
        const response = await fetch(`${API_BASE_URL}/api/fetch-all`, { 
          headers,
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        const endTime = Date.now();
        
        console.log(`Response status: ${response.status} ${response.statusText}`);
        console.log(`Response time: ${endTime - startTime}ms`);
        
        if (!response.ok) {
          console.error(`Error: ${response.status} ${response.statusText}`);
          try {
            const errorText = await response.text();
            console.error('Error details:', errorText);
          } catch (e) {
            console.error('Could not read error details');
          }
          
          // Wait before retrying
          console.log(`Waiting ${DELAY_BETWEEN_CALLS}ms before next attempt...`);
          await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_CALLS));
          continue;
        }
        
        const data = await response.json();
        console.log('Response summary:');
        console.log(`- Success: ${data.success}`);
        console.log(`- Timestamp: ${data.timestamp}`);
        console.log(`- New transactions: ${data.newTransactionsCount}`);
        console.log(`- Total transactions: ${data.totalTransactionsCount}`);
        
        totalFetched += data.newTransactionsCount;
        
        // If no new transactions were found, we can stop
        if (data.newTransactionsCount === 0) {
          console.log('\n✅ No new transactions found. All transactions have been fetched!');
          continueLoop = false;
        } else {
          console.log(`\nFetched ${data.newTransactionsCount} new transactions. Continuing...`);
          console.log(`Waiting ${DELAY_BETWEEN_CALLS}ms before next attempt...`);
          await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_CALLS));
        }
      } catch (fetchError) {
        clearTimeout(timeoutId);
        if (fetchError.name === 'AbortError') {
          console.error(`Request timed out after ${REQUEST_TIMEOUT}ms`);
        } else {
          console.error(`Fetch error: ${fetchError.message}`);
        }
        console.log(`Waiting ${DELAY_BETWEEN_CALLS}ms before next attempt...`);
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_CALLS));
      }
    } catch (error) {
      console.error(`Error during fetch: ${error.message}`);
      console.log(`Waiting ${DELAY_BETWEEN_CALLS}ms before next attempt...`);
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_CALLS));
    }
  }
  
  if (attempts >= MAX_ATTEMPTS && continueLoop) {
    console.log(`\n⚠️ Reached maximum number of attempts (${MAX_ATTEMPTS})`);
    console.log(`Total transactions fetched: ${totalFetched}`);
  } else {
    console.log(`\n✅ Fetch process completed after ${attempts} attempts`);
    console.log(`Total transactions fetched: ${totalFetched}`);
  }
}

// Run the script
fetchAllTransactions().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
}); 