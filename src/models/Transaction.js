// In-memory transaction storage for Vercel environment
const transactions = [];
let lastFetchTimestamp = null;

class Transaction {
  constructor(data) {
    this.signature = data.signature;
    this.timestamp = data.timestamp || new Date().toISOString();
    this.type = data.type || 'unknown';
    this.amount = data.amount || 0;
    this.token = data.token || 'SOL';
    this.tokenMint = data.tokenMint || null;
    this.sender = data.sender || null;
    this.receiver = data.receiver || null;
    this.fee = data.fee || 0;
    this.status = data.status || 'success';
    this.blockTime = data.blockTime || Math.floor(Date.now() / 1000);
    this.slot = data.slot || 0;
    this.meta = data.meta || {};
  }

  // Save transaction to storage
  async save() {
    try {
      // Try to use MongoDB if available
      try {
        const { connectToDatabase } = require('../utils/mongodb');
        const { db } = await connectToDatabase();
        const collection = db.collection('transactions');
        
        // Check if transaction already exists
        const existing = await collection.findOne({ signature: this.signature });
        
        if (existing) {
          // Update existing transaction
          await collection.updateOne(
            { signature: this.signature },
            { $set: this }
          );
          console.log(`Updated transaction in MongoDB: ${this.signature}`);
        } else {
          // Insert new transaction
          await collection.insertOne(this);
          console.log(`Saved new transaction to MongoDB: ${this.signature}`);
        }
        
        return this;
      } catch (error) {
        console.warn('MongoDB save failed, falling back to in-memory storage:', error.message);
      }
      
      // Fall back to in-memory storage
      // Check if transaction already exists
      const existingIndex = transactions.findIndex(t => t.signature === this.signature);
      
      if (existingIndex >= 0) {
        // Update existing transaction
        transactions[existingIndex] = this;
        console.log(`Updated transaction in memory: ${this.signature}`);
      } else {
        // Add new transaction
        transactions.push(this);
        console.log(`Saved new transaction to memory: ${this.signature}`);
      }
      
      return this;
    } catch (error) {
      console.error('Error saving transaction:', error);
      throw error;
    }
  }

  // Find transactions by query
  static async find(query = {}) {
    try {
      console.log(`Finding transactions with query:`, query);
      
      // Try to use MongoDB if available
      try {
        const { connectToDatabase } = require('../utils/mongodb');
        const { db } = await connectToDatabase();
        const collection = db.collection('transactions');
        
        return await collection.find(query).toArray();
      } catch (error) {
        console.warn('MongoDB find failed, falling back to in-memory storage:', error.message);
      }
      
      // Fall back to in-memory storage
      // Filter transactions based on query
      return transactions.filter(transaction => {
        for (const [key, value] of Object.entries(query)) {
          if (transaction[key] !== value) {
            return false;
          }
        }
        return true;
      });
    } catch (error) {
      console.error('Error finding transactions:', error);
      return [];
    }
  }

  // Find one transaction by query
  static async findOne(query = {}) {
    try {
      console.log(`Finding one transaction with query:`, query);
      
      // Try to use MongoDB if available
      try {
        const { connectToDatabase } = require('../utils/mongodb');
        const { db } = await connectToDatabase();
        const collection = db.collection('transactions');
        
        return await collection.findOne(query);
      } catch (error) {
        console.warn('MongoDB findOne failed, falling back to in-memory storage:', error.message);
      }
      
      // Fall back to in-memory storage
      // Find first transaction matching query
      return transactions.find(transaction => {
        for (const [key, value] of Object.entries(query)) {
          if (transaction[key] !== value) {
            return false;
          }
        }
        return true;
      }) || null;
    } catch (error) {
      console.error('Error finding transaction:', error);
      return null;
    }
  }

  // Get all transactions
  static async getAll() {
    try {
      // Try to use MongoDB if available
      try {
        const { connectToDatabase } = require('../utils/mongodb');
        const { db } = await connectToDatabase();
        const collection = db.collection('transactions');
        
        const result = await collection.find({}).toArray();
        console.log(`Getting all transactions from MongoDB (count: ${result.length})`);
        return result;
      } catch (error) {
        console.warn('MongoDB getAll failed, falling back to in-memory storage:', error.message);
      }
      
      // Fall back to in-memory storage
      console.log(`Getting all transactions from memory (count: ${transactions.length})`);
      return transactions;
    } catch (error) {
      console.error('Error getting all transactions:', error);
      return [];
    }
  }

  // Get transaction count
  static async getCount() {
    try {
      // Try to use MongoDB if available
      try {
        const { connectToDatabase } = require('../utils/mongodb');
        const { db } = await connectToDatabase();
        const collection = db.collection('transactions');
        
        return await collection.countDocuments({});
      } catch (error) {
        console.warn('MongoDB getCount failed, falling back to in-memory storage:', error.message);
      }
      
      // Fall back to in-memory storage
      return transactions.length;
    } catch (error) {
      console.error('Error getting transaction count:', error);
      return 0;
    }
  }

  // Get transactions by type
  static async getByType(type) {
    try {
      // Try to use MongoDB if available
      try {
        const { connectToDatabase } = require('../utils/mongodb');
        const { db } = await connectToDatabase();
        const collection = db.collection('transactions');
        
        return await collection.find({ type }).toArray();
      } catch (error) {
        console.warn(`MongoDB getByType failed, falling back to in-memory storage:`, error.message);
      }
      
      // Fall back to in-memory storage
      return transactions.filter(t => t.type === type);
    } catch (error) {
      console.error(`Error getting transactions by type ${type}:`, error);
      return [];
    }
  }

  // Get transactions by token
  static async getByToken(token) {
    try {
      // Try to use MongoDB if available
      try {
        const { connectToDatabase } = require('../utils/mongodb');
        const { db } = await connectToDatabase();
        const collection = db.collection('transactions');
        
        return await collection.find({ token }).toArray();
      } catch (error) {
        console.warn(`MongoDB getByToken failed, falling back to in-memory storage:`, error.message);
      }
      
      // Fall back to in-memory storage
      return transactions.filter(t => t.token === token);
    } catch (error) {
      console.error(`Error getting transactions by token ${token}:`, error);
      return [];
    }
  }

  // Get transactions by token mint
  static async getByTokenMint(tokenMint) {
    try {
      // Try to use MongoDB if available
      try {
        const { connectToDatabase } = require('../utils/mongodb');
        const { db } = await connectToDatabase();
        const collection = db.collection('transactions');
        
        return await collection.find({ tokenMint }).toArray();
      } catch (error) {
        console.warn(`MongoDB getByTokenMint failed, falling back to in-memory storage:`, error.message);
      }
      
      // Fall back to in-memory storage
      return transactions.filter(t => t.tokenMint === tokenMint);
    } catch (error) {
      console.error(`Error getting transactions by token mint ${tokenMint}:`, error);
      return [];
    }
  }

  // Set last fetch timestamp
  static async setLastFetchTimestamp(timestamp) {
    try {
      // Try to use MongoDB if available
      try {
        const { connectToDatabase } = require('../utils/mongodb');
        const { db } = await connectToDatabase();
        const collection = db.collection('metadata');
        
        await collection.updateOne(
          { key: 'lastFetchTimestamp' },
          { $set: { value: timestamp } },
          { upsert: true }
        );
        
        console.log(`Set last fetch timestamp in MongoDB: ${timestamp}`);
      } catch (error) {
        console.warn('MongoDB setLastFetchTimestamp failed, falling back to in-memory storage:', error.message);
      }
      
      // Fall back to in-memory storage
      lastFetchTimestamp = timestamp;
      console.log(`Set last fetch timestamp in memory: ${timestamp}`);
    } catch (error) {
      console.error('Error setting last fetch timestamp:', error);
    }
  }

  // Get last fetch timestamp
  static async getLastFetchTimestamp() {
    try {
      // Try to use MongoDB if available
      try {
        const { connectToDatabase } = require('../utils/mongodb');
        const { db } = await connectToDatabase();
        const collection = db.collection('metadata');
        
        const doc = await collection.findOne({ key: 'lastFetchTimestamp' });
        if (doc) {
          console.log(`Got last fetch timestamp from MongoDB: ${doc.value}`);
          return doc.value;
        }
      } catch (error) {
        console.warn('MongoDB getLastFetchTimestamp failed, falling back to in-memory storage:', error.message);
      }
      
      // Fall back to in-memory storage
      console.log(`Got last fetch timestamp from memory: ${lastFetchTimestamp}`);
      return lastFetchTimestamp;
    } catch (error) {
      console.error('Error getting last fetch timestamp:', error);
      return null;
    }
  }

  // Clear all transactions (for testing)
  static async clearAll() {
    try {
      // Try to use MongoDB if available
      try {
        const { connectToDatabase } = require('../utils/mongodb');
        const { db } = await connectToDatabase();
        const collection = db.collection('transactions');
        
        const result = await collection.deleteMany({});
        console.log(`Cleared all transactions from MongoDB (count: ${result.deletedCount})`);
        return result.deletedCount;
      } catch (error) {
        console.warn('MongoDB clearAll failed, falling back to in-memory storage:', error.message);
      }
      
      // Fall back to in-memory storage
      const count = transactions.length;
      transactions.length = 0;
      console.log(`Cleared all transactions from memory (count: ${count})`);
      return count;
    } catch (error) {
      console.error('Error clearing transactions:', error);
      return 0;
    }
  }
}

module.exports = Transaction; 