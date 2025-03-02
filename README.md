# SOL Distribution Tracker API

This API tracks SOL distributions from a specified wallet address. It provides endpoints to view transaction statistics, distribution history, and more.

## API Security

The API is now secured with API key authentication. To set up API key authentication:

1. Generate a secure random API key (you can use a password generator or run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)

2. Add the API key to your environment variables:
   - For local development: Add `API_KEY=your_generated_key` to your `.env` file
   - For Vercel deployment: Add `API_KEY` as an environment variable in your Vercel project settings

3. When making API requests, include the API key in one of these ways:
   - As an `X-API-Key` header: `X-API-Key: your_generated_key`
   - As a query parameter: `?api_key=your_generated_key`

4. The Telegram bot will automatically use the API key if it's set in the environment variables.

### Public Endpoints

The following endpoints do not require API key authentication:
- `/api/stats` - Basic statistics (read-only)
- `/api/health` - Health check endpoint
- `/` - Root endpoint

### Protected Endpoints

The following endpoints require API key authentication:
- `/api/wallet` - Wallet data lookup
- `/api/force-refresh` - Force refresh of transaction data
- All other endpoints not listed as public

## Local Development

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Create a `.env` file with the following variables:
   ```
   HELIUS_API_KEY=your_helius_api_key
   HELIUS_RPC_URL=your_helius_rpc_url
   DISTRIBUTION_WALLET_ADDRESS=your_wallet_address
   API_KEY=your_generated_key
   API_BASE_URL=https://your-api-url.vercel.app
   SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
   TELEGRAM_BOT_TOKEN=your_telegram_bot_token
   ```
4. Start the API server:
   ```
   node api/index.js
   ```

## API Endpoints

- `/api/health` - Check API health
- `/api/stats` - Get distribution statistics
- `/api/distributed` - Get all distributed transactions
- `/api/sol` - Get SOL transactions
- `/api/refresh` - Refresh transaction data
- `/api/fetch-all` - Fetch all historical transactions
- `/api/fetch-status` - Check transaction fetch status
- `/api/force-save` - Force save transactions to storage
- `/api/force-refresh` - Force a full refresh of all transactions
- `/api/wallet` - Get wallet data and transaction history
- `/` - API information

## Vercel Deployment

This API is configured for deployment on Vercel. See [VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md) for detailed instructions.

### Known Issues and Solutions

1. **Force-refresh endpoint**: The force-refresh endpoint may return a 404 error in the Vercel production environment due to serverless function limitations. A standalone serverless function has been created to handle this endpoint.

2. **Duplicate initialization**: Ensure there's only one call to `initializeApp()` in the code to avoid port conflicts.

3. **Background jobs**: Background jobs for auto-fetching transactions are configured to run at regular intervals. The interval can be adjusted in the `CONFIG` object in `api/index.js`.

## Testing

To test the API endpoints:

1. Local testing:
   ```
   node test-api.js
   ```

2. Production testing:
   ```
   node test-production-api.js
   ```

## License

MIT 