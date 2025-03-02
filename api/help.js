// API help endpoint
module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-API-KEY, Content-Type');
  
  // Handle OPTIONS request (preflight)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // API information
  const apiInfo = {
    name: "Distribution Tracker API",
    version: "1.1.0",
    endpoints: [
      "/api/stats",
      "/api/distributed",
      "/api/sol",
      "/api/refresh",
      "/api/fetch-all",
      "/api/fetch-status",
      "/api/force-save",
      "/api/force-refresh",
      "/api/help"
    ],
    adminEndpoints: [
      "/api/admin/stop-collection",
      "/api/admin/stop-api"
    ],
    endpointDetails: {
      "/api/stats": {
        description: "Get statistics about SOL distribution",
        method: "GET",
        parameters: {
          limit: "Number of transactions to include (optional)",
          minimal: "Set to 'true' for minimal data (optional)"
        }
      },
      "/api/distributed": {
        description: "Get information about distributed SOL",
        method: "GET",
        parameters: {
          limit: "Number of transactions to include (optional)"
        }
      },
      "/api/sol": {
        description: "Get SOL price information",
        method: "GET"
      },
      "/api/refresh": {
        description: "Refresh transaction data",
        method: "GET"
      },
      "/api/fetch-all": {
        description: "Fetch all transactions",
        method: "GET",
        note: "This is a long-running operation"
      },
      "/api/fetch-status": {
        description: "Get status of data collection",
        method: "GET"
      },
      "/api/force-save": {
        description: "Force save all data",
        method: "GET",
        auth: "Requires API key"
      },
      "/api/force-refresh": {
        description: "Force refresh all transactions",
        method: "GET",
        auth: "Requires API key"
      },
      "/api/admin/stop-collection": {
        description: "Stop data collection process",
        method: "GET",
        auth: "Requires API key",
        note: "API will continue running but won't collect new data"
      },
      "/api/admin/stop-api": {
        description: "Stop the entire API",
        method: "GET",
        auth: "Requires API key",
        note: "API will shut down completely and return 503 until restarted"
      }
    },
    authentication: {
      description: "Some endpoints require authentication",
      method: "Include X-API-KEY header with your API key"
    }
  };
  
  // Return API information
  return res.status(200).json({
    success: true,
    ...apiInfo
  });
}; 