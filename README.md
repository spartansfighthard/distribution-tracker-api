# SOL Distribution Tracker

A comprehensive solution for tracking SOL distributions and tax collections on the Solana blockchain. This application includes:

1. A Telegram bot for real-time monitoring
2. An API server for programmatic access to transaction data
3. A React dashboard component for website integration

## Features

- Track SOL distributions to users
- Monitor tax collections
- View detailed transaction history
- Real-time statistics and analytics
- Comprehensive API for integration with websites and other applications
- Caching system to reduce API calls and improve performance

## Setup

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- A Solana wallet address for tracking
- Helius API key (for blockchain data)
- Telegram Bot Token (for the Telegram bot)

### Installation

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/sol-distribution-tracker.git
   cd sol-distribution-tracker
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file in the root directory with the following variables:
   ```
   # Required
   HELIUS_API_KEY=your_helius_api_key
   DISTRIBUTION_WALLET_ADDRESS=your_wallet_address
   
   # Optional (for Telegram bot)
   TELEGRAM_BOT_TOKEN=your_telegram_bot_token
   
   # Optional (for tax tracking)
   TAX_CONTRACT_ADDRESS=your_tax_contract_address
   
   # Optional (for API server)
   API_PORT=3001
   ```

4. Start the application:
   ```
   npm start
   ```

## Telegram Bot

The Telegram bot provides real-time monitoring of your SOL distributions and tax collections. Once you've set up the bot with BotFather and added the token to your `.env` file, you can use the following commands:

- `/start` - Start the bot
- `/help` - Show available commands
- `/stats` - Show overall SOL statistics
- `/distributed` - Show SOL distribution data
- `/sol` - Show detailed SOL transfer statistics
- `/tax` - Show tax-related SOL transactions
- `/refresh` - Force refresh historical transaction data

## API Server

The API server provides programmatic access to your transaction data. By default, it runs on port 3001, but you can change this by setting the `API_PORT` environment variable.

### API Endpoints

#### GET /api/health
Health check endpoint to verify the API is running.

**Response:**
```json
{
  "success": true,
  "timestamp": "2023-06-01T12:00:00.000Z",
  "message": "API is running",
  "version": "1.0.0"
}
```

#### GET /api/stats
Get overall wallet statistics.

**Query Parameters:**
- `wallet` (optional) - The wallet address to get statistics for. Defaults to the `DISTRIBUTION_WALLET_ADDRESS` environment variable.

**Response:**
```json
{
  "success": true,
  "timestamp": "2023-06-01T12:00:00.000Z",
  "data": {
    "totalSolSent": 100.5,
    "totalSolReceived": 200.75,
    "totalTaxReceived": 50.25,
    "currentBalance": 150.25,
    "transactionCount": 100,
    "outgoingTransactions": [...],
    "taxIncomingTransactions": [...]
  }
}
```

#### GET /api/distributions
Get distribution transactions.

**Query Parameters:**
- `wallet` (optional) - The wallet address to get distributions for. Defaults to the `DISTRIBUTION_WALLET_ADDRESS` environment variable.

**Response:**
```json
{
  "success": true,
  "timestamp": "2023-06-01T12:00:00.000Z",
  "data": {
    "totalSolSent": 100.5,
    "transactionCount": 100,
    "transactions": [...]
  }
}
```

#### GET /api/tax
Get tax transactions.

**Query Parameters:**
- `wallet` (optional) - The wallet address to get tax transactions for. Defaults to the `DISTRIBUTION_WALLET_ADDRESS` environment variable.

**Response:**
```json
{
  "success": true,
  "timestamp": "2023-06-01T12:00:00.000Z",
  "data": {
    "totalTaxReceived": 50.25,
    "transactionCount": 100,
    "transactions": [...]
  }
}
```

#### POST /api/refresh
Force refresh historical transaction data.

**Request Body:**
```json
{
  "wallet": "optional_wallet_address"
}
```

**Response:**
```json
{
  "success": true,
  "timestamp": "2023-06-01T12:00:00.000Z",
  "data": {
    "message": "Historical data refreshed successfully",
    "timestamp": "2023-06-01T12:00:00.000Z"
  }
}
```

## Website Integration

### React Dashboard Component

The repository includes a React dashboard component that you can use to display transaction data on your website. The component is located in `src/web/TransactionDashboard.jsx` and `src/web/TransactionDashboard.css`.

#### Installation in Your React Project

1. Copy the `TransactionDashboard.jsx` and `TransactionDashboard.css` files to your React project.

2. Install required dependencies:
   ```
   npm install axios
   ```

3. Set up environment variables in your React project:
   ```
   REACT_APP_API_URL=http://your-api-server-url:3001/api
   REACT_APP_DISTRIBUTION_WALLET_ADDRESS=your_wallet_address
   REACT_APP_TAX_CONTRACT_ADDRESS=your_tax_contract_address
   ```

4. Import and use the component in your React application:
   ```jsx
   import React from 'react';
   import TransactionDashboard from './path/to/TransactionDashboard';
   import './path/to/TransactionDashboard.css';

   function App() {
     return (
       <div className="App">
         <header className="App-header">
           <h1>My SOL Distribution Dashboard</h1>
         </header>
         <main>
           <TransactionDashboard />
         </main>
       </div>
     );
   }

   export default App;
   ```

### API Integration for Other Frameworks

If you're not using React, you can still integrate with the API using any HTTP client. Here's an example using vanilla JavaScript:

```javascript
// Fetch wallet statistics
async function fetchStats() {
  try {
    const response = await fetch('http://your-api-server-url:3001/api/stats');
    const data = await response.json();
    
    if (data.success) {
      // Update your UI with the data
      console.log(data.data);
    } else {
      console.error('Error fetching stats:', data.error);
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

// Call the function
fetchStats();
```

## Data Storage

The application stores historical transaction data in the following files:

- `data/transactions.json` - Tracked transactions from the Helius service
- `data/historical_transactions.json` - Cached historical transaction data

## Customization

### Styling

You can customize the appearance of the React dashboard component by modifying the `TransactionDashboard.css` file. The component uses a clean, modern design with responsive layouts.

### Transaction Processing

If you need to customize how transactions are processed or displayed, you can modify the following files:

- `src/services/transactionService.js` - Core transaction processing logic
- `src/services/heliusService.js` - Helius API integration
- `src/api/apiServer.js` - API endpoints and response formatting

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgements

- [Helius](https://helius.xyz/) for providing blockchain data
- [Solana](https://solana.com/) for the blockchain platform
- [Telegram Bot API](https://core.telegram.org/bots/api) for the bot functionality 