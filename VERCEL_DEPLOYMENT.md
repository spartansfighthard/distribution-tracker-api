# Deploying SOL Distribution Tracker API to Vercel

This guide will walk you through the process of deploying your SOL Distribution Tracker API to Vercel.

## Prerequisites

1. A [Vercel](https://vercel.com) account
2. [Vercel CLI](https://vercel.com/docs/cli) installed (optional, for local testing)
3. Your Helius API key
4. Your distribution wallet address
5. Your tax contract address (optional)

## Deployment Steps

### 1. Prepare Your Repository

Make sure your repository contains the following files:
- `api/index.js` - The serverless API entry point
- `vercel.json` - Vercel configuration file
- `package.json` - Dependencies and project configuration
- `src/services/transactionService.js` - Transaction service with in-memory caching
- `src/services/heliusService.js` - Simplified Helius service

### 2. Set Up Environment Variables in Vercel

You'll need to set up the following environment variables in your Vercel project:

1. Log in to your Vercel account and go to your project
2. Navigate to the "Settings" tab
3. Click on "Environment Variables"
4. Add the following variables:
   - `HELIUS_API_KEY` - Your Helius API key
   - `DISTRIBUTION_WALLET_ADDRESS` - Your distribution wallet address
   - `TAX_CONTRACT_ADDRESS` - Your tax contract address (optional)

### 3. Deploy to Vercel

#### Option 1: Deploy via Vercel Dashboard

1. Connect your GitHub, GitLab, or Bitbucket repository to Vercel
2. Configure the project settings:
   - Build Command: Leave empty (uses default)
   - Output Directory: Leave empty (uses default)
   - Install Command: `npm install`
3. Click "Deploy"

#### Option 2: Deploy via Vercel CLI

1. Install Vercel CLI if you haven't already:
   ```
   npm install -g vercel
   ```

2. Log in to Vercel:
   ```
   vercel login
   ```

3. Deploy from your project directory:
   ```
   vercel
   ```

4. Follow the prompts to configure your project

### 4. Test Your Deployment

Once deployed, Vercel will provide you with a URL for your API. Test it by accessing:

```
https://your-vercel-url.vercel.app/api/health
```

You should see a response like:
```json
{
  "success": true,
  "timestamp": "2023-06-01T12:00:00.000Z",
  "message": "API is running",
  "version": "1.0.0"
}
```

### 5. Connect Your Website to the API

Update your React dashboard component to use your Vercel API URL:

```jsx
// In your React project
const API_BASE_URL = 'https://your-vercel-url.vercel.app/api';
```

## Troubleshooting

### API Timeouts

If you experience timeouts, it might be because Vercel serverless functions have a 10-second execution limit on the free plan. Consider:

1. Optimizing your code to reduce execution time
2. Upgrading to a paid Vercel plan
3. Implementing more aggressive caching

### CORS Issues

If you encounter CORS issues when accessing the API from your website, check:

1. The CORS configuration in `api/index.js`
2. Your browser's console for specific error messages
3. That your website's domain is properly configured in the CORS settings

### Memory Limitations

Vercel serverless functions have memory limitations. If you're processing a large number of transactions, consider:

1. Limiting the number of transactions fetched
2. Implementing pagination in your API responses
3. Using more efficient data structures

## Production Considerations

For a production deployment, consider:

1. Setting up a custom domain for your API
2. Implementing proper authentication for sensitive endpoints
3. Setting up monitoring and alerts
4. Implementing rate limiting to prevent abuse

## Updating Your Deployment

To update your deployment:

1. Make changes to your code
2. Commit and push to your repository
3. Vercel will automatically redeploy your API

Alternatively, you can manually trigger a deployment using the Vercel dashboard or CLI:

```
vercel --prod
``` 