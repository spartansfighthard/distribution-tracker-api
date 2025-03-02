/**
 * API Fix for Timeout Issues
 * 
 * This script demonstrates how to fix the timeout issues in the Vercel API
 * by properly implementing the limit parameter in the fetchTransactionsVercel function.
 * 
 * The key changes needed are:
 * 
 * 1. Extract the limit parameter from req.query.limit in all API endpoints
 * 2. Pass this limit to fetchTransactionsVercel()
 * 3. Modify fetchTransactionsVercel to respect the limit parameter
 */

// Example implementation for fetchTransactionsVercel function
async function fetchTransactionsVercel(limit = 10) {
  console.log(`[Vercel] Starting historical transaction fetch with limit: ${limit}...`);
  
  try {
    // Load existing transactions from storage
    const loadedFromStorage = await storage.load();
    let existingSignatures = [];
    
    if (loadedFromStorage && transactions.length > 0) {
      console.log(`[Vercel] Loaded ${transactions.length} existing transactions`);
      existingSignatures = transactions.map(tx => tx.signature);
      console.log(`[Vercel] Loaded ${existingSignatures.length} existing transaction signatures`);
    }
    
    // Fetch signatures in batches
    let allNewTransactions = [];
    let beforeSignature = null;
    let batchNumber = 1;
    let reachedExistingSignatures = false;
    
    while (!reachedExistingSignatures) {
      console.log(`[Vercel] Fetching batch ${batchNumber} of signatures (before: ${beforeSignature || 'none'})...`);
      
      // Fetch signatures
      const signatures = await fetchSignatures(beforeSignature);
      console.log(`[Vercel] Fetched ${signatures.length} signatures in batch ${batchNumber}`);
      
      if (signatures.length === 0) {
        console.log(`[Vercel] No more signatures to fetch, stopping`);
        break;
      }
      
      // Filter out signatures we already have
      const newSignatures = signatures.filter(sig => !existingSignatures.includes(sig));
      console.log(`[Vercel] Found ${newSignatures.length} new signatures in batch ${batchNumber}`);
      
      if (newSignatures.length === 0) {
        console.log(`[Vercel] Reached signatures that are already in storage, stopping`);
        reachedExistingSignatures = true;
        break;
      }
      
      // Process only up to the limit
      const signaturesLimit = Math.min(newSignatures.length, limit);
      console.log(`[Vercel] Processing ${signaturesLimit} out of ${newSignatures.length} signatures to avoid timeouts`);
      
      // Process transactions for these signatures
      const batchStartTime = Date.now();
      const batchTransactions = [];
      
      for (let i = 0; i < signaturesLimit; i++) {
        try {
          const tx = await fetchTransactionDetails(newSignatures[i]);
          if (tx) {
            batchTransactions.push(tx);
            console.log(`[Vercel] Successfully processed transaction: ${newSignatures[i]}`);
          }
        } catch (error) {
          console.error(`[Vercel] Error processing transaction ${newSignatures[i]}: ${error.message}`);
        }
      }
      
      const batchEndTime = Date.now();
      console.log(`[Vercel] Processed ${batchTransactions.length} transactions in batch ${batchNumber} (${batchEndTime - batchStartTime}ms)`);
      
      // Add to our collection
      allNewTransactions = [...allNewTransactions, ...batchTransactions];
      
      // If we've reached our limit, stop fetching
      if (allNewTransactions.length >= limit) {
        console.log(`[Vercel] Reached limit of ${limit} transactions, stopping`);
        break;
      }
      
      // Update the before signature for the next batch
      beforeSignature = signatures[signatures.length - 1];
      batchNumber++;
      
      // Safety check to prevent infinite loops
      if (batchNumber > 10) {
        console.log(`[Vercel] Reached maximum batch count (10), stopping`);
        break;
      }
    }
    
    console.log(`[Vercel] Historical fetch complete. Added ${allNewTransactions.length} new transactions in ${batchNumber} batches.`);
    return allNewTransactions;
  } catch (error) {
    console.error(`[Vercel] Error in fetchTransactionsVercel: ${error.message}`);
    throw error;
  }
}

// Example implementation for the stats endpoint
/*
app.get('/api/stats', asyncHandler(async (req, res) => {
  console.log('Getting overall SOL statistics...');
  
  try {
    // Extract limit parameter from query string
    const limit = parseInt(req.query.limit) || 10;
    console.log(`Using limit: ${limit}`);
    
    // For Vercel, use a simplified approach
    if (process.env.VERCEL) {
      // Try to load from storage first
      let fetchedTransactions = [];
      const loadedFromStorage = await storage.load();
      
      if (loadedFromStorage && transactions.length > 0) {
        console.log(`Using ${transactions.length} transactions from storage`);
        fetchedTransactions = transactions;
      } else {
        // If no stored data, fetch fresh data with the limit parameter
        fetchedTransactions = await fetchTransactionsVercel(limit);
        
        // Save the fetched transactions to storage
        if (fetchedTransactions.length > 0) {
          transactions.length = 0;
          transactions.push(...fetchedTransactions);
          lastFetchTimestamp = new Date().toISOString();
          await storage.save();
        }
      }
      
      // Calculate statistics
      const stats = calculateStatistics(fetchedTransactions);
      
      // Return the response
      return res.json({
        success: true,
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        vercel: !!process.env.VERCEL,
        note: process.env.VERCEL ? 'Running in optimized mode for Vercel serverless environment' : 'Running in standard mode',
        stats,
        transactionCounts: {
          totalStoredTransactions: fetchedTransactions.length,
          solTransactions: fetchedTransactions.length,
          receivedTransactions: fetchedTransactions.filter(tx => tx.type === 'received').length,
          sentTransactions: fetchedTransactions.filter(tx => tx.type === 'sent').length
        },
        fetchedAt: lastFetchTimestamp
      });
    }
    
    // ... rest of the code for non-Vercel environments ...
  } catch (error) {
    console.error(`Error getting statistics: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: {
        message: `Error getting statistics: ${error.message}`,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      }
    });
  }
}));
*/

// Example implementation for the force-refresh endpoint
/*
app.get('/api/force-refresh', asyncHandler(async (req, res) => {
  console.log('Forcing full refresh of all transactions...');
  
  try {
    // Extract limit parameter from query string
    const limit = parseInt(req.query.limit) || 10;
    console.log(`Using limit: ${limit}`);
    
    // Clear existing transactions
    transactions.length = 0;
    
    // Fetch fresh transactions with the limit parameter
    const fetchedTransactions = await fetchTransactionsVercel(limit);
    
    // Update in-memory storage
    transactions.push(...fetchedTransactions);
    lastFetchTimestamp = new Date().toISOString();
    
    // Save to storage
    await storage.save();
    
    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      message: 'Successfully refreshed transaction data',
      transactionCount: transactions.length,
      fetchedTransactions: fetchedTransactions.length
    });
  } catch (error) {
    console.error(`Error refreshing transactions: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: {
        message: `Error refreshing transactions: ${error.message}`,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      }
    });
  }
}));
*/

console.log("This script contains the code needed to fix the API timeout issues.");
console.log("To implement this fix:");
console.log("1. Update the fetchTransactionsVercel function in api/index.js to respect the limit parameter");
console.log("2. Update the /api/stats endpoint to extract and pass the limit parameter");
console.log("3. Update the /api/force-refresh endpoint to extract and pass the limit parameter");
console.log("4. Deploy the updated code to Vercel"); 