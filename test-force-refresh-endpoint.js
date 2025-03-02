const fetch = require('node-fetch');

// Production API URL
const BASE_URL = 'https://distribution-tracker-api.vercel.app';

async function testForceRefreshEndpoint() {
  console.log('=== TESTING FORCE-REFRESH ENDPOINT ===');
  console.log(`URL: ${BASE_URL}/api/force-refresh`);
  
  try {
    const response = await fetch(`${BASE_URL}/api/force-refresh`);
    const status = response.status;
    const statusText = response.statusText;
    console.log(`Status: ${status} ${statusText}`);
    
    if (response.ok) {
      const data = await response.json();
      console.log('Response:');
      console.log(JSON.stringify(data, null, 2));
      return { success: true, data };
    } else {
      console.log(`Error: ${status} ${statusText}`);
      return { success: false, error: `${status} ${statusText}` };
    }
  } catch (error) {
    console.log(`Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

testForceRefreshEndpoint().catch(error => {
  console.error('Test failed:', error);
}); 