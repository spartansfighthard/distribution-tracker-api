# Deploying SOL Distribution Tracker API to Vercel

This guide will walk you through the process of deploying your SOL Distribution Tracker API to Vercel.

## Prerequisites

1. A [Vercel](https://vercel.com) account
2. Your GitHub repository set up with the code

## Environment Variables

You'll need to set up the following environment variables in your Vercel project:

- `HELIUS_API_KEY`: Your Helius API key (currently: f293a327-e829-4c21-be96-224e219cbffe)
- `HELIUS_RPC_URL`: Your Helius RPC URL (currently: https://mainnet.helius-rpc.com/?api-key=f293a327-e829-4c21-be96-224e219cbffe)
- `DISTRIBUTION_WALLET_ADDRESS`: Your distribution wallet address (currently: HMDVj2Mhax9Kg68yTPo8qH1bcMQuCAqzDatV6d4Wqawv)
- `TAX_CONTRACT_ADDRESS`: Your tax contract address (if applicable)

Note: The Telegram bot token and MongoDB URI are not needed for the API deployment on Vercel.

## Deployment Steps

### 1. Push Your Code to GitHub

Make sure all your code is committed and pushed to your GitHub repository:

```powershell
git add .
git commit -m "Prepare for Vercel deployment"
git push origin main
```

### 2. Deploy to Vercel

#### Option 1: Deploy via Vercel Dashboard (Recommended)

1. Go to [Vercel](https://vercel.com/) and sign in
2. Click "Add New..." → "Project"
3. Import your GitHub repository (`spartansfighthard/distribution-tracker-api`)
4. Configure your project:
   - **Framework Preset**: Select "Other" or "Node.js"
   - **Root Directory**: Leave as `.` (the project root)
   - **Build Command**: Leave blank (uses the default from vercel.json)
   - **Output Directory**: Leave blank (uses the default)

5. Add Environment Variables:
   - Click "Environment Variables"
   - Add each of the variables listed in the "Environment Variables" section above
   - Make sure to copy the values exactly from your local `.env` file

6. Click "Deploy"

#### Option 2: Deploy via Vercel CLI

If you prefer using the command line:

1. Install Vercel CLI:
   ```powershell
   npm i -g vercel
   ```

2. Log in to Vercel:
   ```powershell
   vercel login
   ```

3. Deploy your project:
   ```powershell
   vercel
   ```

4. Follow the interactive prompts and add your environment variables when asked

### 3. Test Your Deployment

Once deployed, Vercel will provide you with a URL for your API. Test it by accessing:

```
https://your-vercel-url.vercel.app/api/health
```

You should see a response indicating that the API is running.

Then test the other endpoints:
- `https://your-vercel-url.vercel.app/api/stats`
- `https://your-vercel-url.vercel.app/api/distributions`
- `https://your-vercel-url.vercel.app/api/tax`

## Troubleshooting

### API Timeouts

If you experience timeouts, it might be because Vercel serverless functions have a 10-second execution limit on the free plan. Consider:

1. Optimizing your code to reduce execution time
2. Upgrading to a paid Vercel plan
3. Implementing more aggressive caching

### CORS Issues

If you encounter CORS issues when accessing the API from your website, check the CORS configuration in `api/index.js`. Your current configuration allows all origins, which is fine for development but might need to be restricted in production.

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
5. Securing your environment variables (don't share your API keys publicly)

## Updating Your Deployment

To update your deployment:

1. Make changes to your code
2. Commit and push to your repository
3. Vercel will automatically redeploy your API

Alternatively, you can manually trigger a deployment using the Vercel dashboard or CLI:

```
vercel --prod
``` 