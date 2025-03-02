# SOL Distribution Tracker API

This API tracks SOL distributions from a specified wallet address. It provides endpoints to view transaction statistics, distribution history, and more.

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