const axios = require('axios');

// Configuration
const API_BASE_URL = 'http://localhost:3000'; // For most endpoints
const FORCE_REFRESH_URL = 'http://localhost:3002'; // For force-refresh endpoint

// Test endpoints
async function testEndpoints() {
  try {
    // Test root endpoint
    console.log('Testing root endpoint...');
    const rootResponse = await axios.get(API_BASE_URL);
    console.log('Root endpoint response:', rootResponse.data);
    console.log('-----------------------------------');

    // Test health endpoint
    console.log('Testing health endpoint...');
    const healthResponse = await axios.get(`${API_BASE_URL}/api/health`);
    console.log('Health endpoint response:', healthResponse.data);
    console.log('-----------------------------------');

    // Test stats endpoint
    console.log('Testing stats endpoint...');
    const statsResponse = await axios.get(`${API_BASE_URL}/api/stats`);
    console.log('Stats endpoint response:', statsResponse.data);
    console.log('-----------------------------------');

    // Test force-refresh endpoint (on port 3002)
    console.log('Testing force-refresh endpoint...');
    const forceRefreshResponse = await axios.get(`${FORCE_REFRESH_URL}/api/force-refresh`);
    console.log('Force-refresh endpoint response:', forceRefreshResponse.data);
    console.log('-----------------------------------');

  } catch (error) {
    console.error('Error testing endpoints:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
      console.error('Response status:', error.response.status);
    }
  }
}

// Run the tests
testEndpoints(); 