const fs = require('fs');
const path = require('path');

// Directory to store data files
const DATA_DIR = path.join(__dirname, '../../data');

// Ensure the data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log(`Created data directory at ${DATA_DIR}`);
}

// File paths
const TRANSACTIONS_FILE = path.join(DATA_DIR, 'transactions.json');

// Initialize files if they don't exist
if (!fs.existsSync(TRANSACTIONS_FILE)) {
  fs.writeFileSync(TRANSACTIONS_FILE, JSON.stringify([]));
  console.log(`Created transactions file at ${TRANSACTIONS_FILE}`);
}

// Helper function to read data from a file
const readData = (filePath) => {
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading from ${filePath}:`, error);
    return [];
  }
};

// Helper function to write data to a file
const writeData = (filePath, data) => {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error(`Error writing to ${filePath}:`, error);
    return false;
  }
};

// Transaction methods
const transactionMethods = {
  // Find transactions with optional filter
  find: (filter = {}, sort = {}, limit = 0, skip = 0) => {
    console.log(`Finding transactions with filter: ${JSON.stringify(filter)}, sort: ${JSON.stringify(sort)}, limit: ${limit}, skip: ${skip}`);
    let transactions = readData(TRANSACTIONS_FILE);
    console.log(`Total transactions in database: ${transactions.length}`);
    
    // Apply filters
    if (Object.keys(filter).length > 0) {
      transactions = transactions.filter(tx => {
        return Object.keys(filter).every(key => {
          // Handle $in operator
          if (filter[key] && typeof filter[key] === 'object' && filter[key].$in) {
            return filter[key].$in.includes(tx[key]);
          }
          
          // Handle null values
          if (filter[key] === null) {
            return tx[key] === null;
          }
          
          // Handle regex
          if (filter[key] instanceof RegExp) {
            return filter[key].test(tx[key]);
          }
          
          // Default equality check
          return tx[key] === filter[key];
        });
      });
      console.log(`After filtering: ${transactions.length} transactions`);
    }
    
    // Apply sorting
    if (Object.keys(sort).length > 0) {
      const sortKey = Object.keys(sort)[0];
      const sortDir = sort[sortKey];
      
      transactions.sort((a, b) => {
        if (a[sortKey] < b[sortKey]) return sortDir === 1 ? -1 : 1;
        if (a[sortKey] > b[sortKey]) return sortDir === 1 ? 1 : -1;
        return 0;
      });
      console.log(`Sorted by ${sortKey} in ${sortDir === 1 ? 'ascending' : 'descending'} order`);
    }
    
    // Apply pagination
    if (skip > 0) {
      transactions = transactions.slice(skip);
      console.log(`Skipped ${skip} transactions`);
    }
    
    if (limit > 0) {
      transactions = transactions.slice(0, limit);
      console.log(`Limited to ${limit} transactions`);
    }
    
    return transactions;
  },
  
  // Find one transaction
  findOne: (filter = {}) => {
    console.log(`Finding one transaction with filter: ${JSON.stringify(filter)}`);
    const transactions = readData(TRANSACTIONS_FILE);
    
    const transaction = transactions.find(tx => {
      return Object.keys(filter).every(key => {
        return tx[key] === filter[key];
      });
    });
    
    console.log(`Found transaction: ${transaction ? 'Yes' : 'No'}`);
    return transaction;
  },
  
  // Count documents
  countDocuments: (filter = {}) => {
    return transactionMethods.find(filter).length;
  },
  
  // Save a transaction
  save: (transaction) => {
    console.log(`Saving transaction: ${transaction.signature}`);
    const transactions = readData(TRANSACTIONS_FILE);
    
    // Check if transaction already exists
    const existingIndex = transactions.findIndex(tx => tx.signature === transaction.signature);
    
    if (existingIndex >= 0) {
      console.log(`Transaction ${transaction.signature} already exists, updating`);
      // Update existing transaction
      transactions[existingIndex] = {
        ...transactions[existingIndex],
        ...transaction,
        updatedAt: new Date().toISOString()
      };
    } else {
      console.log(`Adding new transaction ${transaction.signature}`);
      // Add new transaction
      transactions.push({
        ...transaction,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
    
    const result = writeData(TRANSACTIONS_FILE, transactions);
    console.log(`Transaction save result: ${result ? 'Success' : 'Failed'}`);
    return result;
  },
  
  // Aggregate function (simplified)
  aggregate: (pipeline) => {
    console.log(`Aggregating with pipeline: ${JSON.stringify(pipeline)}`);
    let transactions = readData(TRANSACTIONS_FILE);
    console.log(`Starting with ${transactions.length} transactions`);
    
    // Process each pipeline stage
    for (const stage of pipeline) {
      // $match stage
      if (stage.$match) {
        transactions = transactions.filter(tx => {
          return Object.keys(stage.$match).every(key => {
            // Handle $in operator
            if (key === 'type' && stage.$match[key].$in) {
              return stage.$match[key].$in.includes(tx[key]);
            }
            
            // Default equality check
            return tx[key] === stage.$match[key];
          });
        });
        console.log(`After $match: ${transactions.length} transactions`);
      }
      
      // $group stage
      if (stage.$group) {
        const groupKey = stage.$group._id;
        const groups = {};
        
        transactions.forEach(tx => {
          const key = groupKey === null ? 'all' : tx[groupKey];
          if (!groups[key]) {
            groups[key] = { _id: key };
            
            // Initialize accumulators
            Object.keys(stage.$group).forEach(field => {
              if (field !== '_id') {
                if (stage.$group[field].$sum) {
                  groups[key][field] = 0;
                } else if (stage.$group[field].$count) {
                  groups[key][field] = 0;
                }
              }
            });
          }
          
          // Update accumulators
          Object.keys(stage.$group).forEach(field => {
            if (field !== '_id') {
              if (stage.$group[field].$sum) {
                const sumField = stage.$group[field].$sum;
                if (sumField === 'tokenAmount' || sumField === 'solAmount') {
                  groups[key][field] += parseFloat(tx[sumField] || 0);
                } else {
                  groups[key][field] += 1; // Count if field doesn't exist
                }
              } else if (stage.$group[field].$count) {
                groups[key][field] += 1;
              }
            }
          });
        });
        
        transactions = Object.values(groups);
        console.log(`After $group: ${transactions.length} groups`);
      }
      
      // $sort stage
      if (stage.$sort) {
        const sortKey = Object.keys(stage.$sort)[0];
        const sortDir = stage.$sort[sortKey];
        transactions.sort((a, b) => {
          if (a[sortKey] < b[sortKey]) return sortDir === 1 ? -1 : 1;
          if (a[sortKey] > b[sortKey]) return sortDir === 1 ? 1 : -1;
          return 0;
        });
        console.log(`After $sort: Sorted by ${sortKey}`);
      }
      
      // $limit stage
      if (stage.$limit) {
        transactions = transactions.slice(0, stage.$limit);
        console.log(`After $limit: ${transactions.length} transactions`);
      }
    }
    
    return transactions;
  }
};

module.exports = {
  Transaction: transactionMethods
}; 