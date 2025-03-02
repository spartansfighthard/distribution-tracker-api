const axios = require('axios');

// Configuration
const API_URL = 'http://localhost:3002';

// Test the root endpoint
async function testRoot() {
  try {
    console.log('Testing root endpoint...');
    const response = await axios.get(API_URL);
    console.log('Root Response:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error testing root endpoint:', error.response ? error.response.data : error.message);
    return null;
  }
}

// Test the force-refresh endpoint
async function testForceRefresh() {
  try {
    console.log('Testing /api/force-refresh endpoint...');
    const response = await axios.get(`${API_URL}/api/force-refresh`);
    console.log('Response:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error testing /api/force-refresh:', error.response ? error.response.data : error.message);
    return null;
  }
}

// Main function
async function main() {
  try {
    // Test the root endpoint first
    await testRoot();
    
    // Test the force-refresh endpoint
    await testForceRefresh();
  } catch (error) {
    console.error('Error in main function:', error);
  }
}

// Run the main function
main(); 