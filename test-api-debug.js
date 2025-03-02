/**
 * API Debug Test Script
 * 
 * This script tests the Distribution Tracker API with various limit values
 * to identify at which point the API starts timing out.
 */

const fetch = require('node-fetch');

const BASE_URL = 'https://distribution-tracker-api.vercel.app';
const TIMEOUT_MS = 20000; // 20 second timeout for requests

// Test configurations
const ENDPOINTS = [
  { path: '/api/health', description: 'Health Check' },
  { path: '/api/stats', description: 'Stats', useLimit: true },
  { path: '/api/force-refresh', description: 'Force Refresh', useLimit: true }
];

const LIMITS_TO_TEST = [1, 2, 3, 5, 10];

/**
 * Fetch with timeout
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeout);
    return response;
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

/**
 * Test an endpoint with a specific limit
 */
async function testEndpoint(endpoint, limit = null) {
  const { path, description, useLimit } = endpoint;
  
  let url = `${BASE_URL}${path}`;
  if (useLimit && limit !== null) {
    url += `?limit=${limit}`;
  }
  
  console.log(`\n=== Testing ${description} ${useLimit ? `(limit=${limit})` : ''} ===`);
  console.log(`URL: ${url}`);
  
  const startTime = Date.now();
  
  try {
    console.log('Sending request...');
    const response = await fetchWithTimeout(url);
    const responseTime = Date.now() - startTime;
    
    console.log(`Status: ${response.status} ${response.statusText}`);
    console.log(`Response time: ${responseTime}ms`);
    
    try {
      const data = await response.json();
      console.log('Response data:');
      console.log(JSON.stringify(data, null, 2));
      
      if (data.success) {
        console.log(`✅ Request successful!`);
        
        // Log additional details for specific endpoints
        if (path === '/api/stats' && data.stats) {
          console.log(`- Total transactions: ${data.stats.totalTransactions || 'N/A'}`);
          console.log(`- Stored transactions: ${data.transactionCounts?.totalStoredTransactions || 'N/A'}`);
        } else if (path === '/api/force-refresh') {
          console.log(`- Transaction count: ${data.transactionCount || 'N/A'}`);
        }
      } else {
        console.log(`❌ Request returned success: false`);
        if (data.error) {
          console.log(`- Error: ${data.error.message}`);
          console.log(`- Code: ${data.error.code}`);
        }
      }
    } catch (jsonError) {
      console.log(`Error parsing JSON: ${jsonError.message}`);
    }
  } catch (error) {
    const responseTime = Date.now() - startTime;
    console.log(`Response time: ${responseTime}ms`);
    
    if (error.name === 'AbortError') {
      console.log(`❌ Request timed out after ${TIMEOUT_MS}ms`);
    } else {
      console.log(`❌ Request failed: ${error.message}`);
    }
  }
  
  console.log('-----------------------------------');
}

/**
 * Run all tests
 */
async function runTests() {
  console.log('=== API DEBUG TEST SCRIPT ===');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Request timeout: ${TIMEOUT_MS}ms`);
  console.log('============================\n');
  
  // First test health endpoint (no limit)
  await testEndpoint(ENDPOINTS[0]);
  
  // Test each endpoint that uses limits with different limit values
  for (const endpoint of ENDPOINTS.filter(e => e.useLimit)) {
    console.log(`\n=== TESTING ${endpoint.description.toUpperCase()} WITH VARIOUS LIMITS ===`);
    
    for (const limit of LIMITS_TO_TEST) {
      await testEndpoint(endpoint, limit);
      // Add a small delay between requests
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  console.log('\n=== API DEBUG TESTING COMPLETE ===');
}

// Run the tests
runTests().catch(error => {
  console.error('Error running tests:', error);
}); 