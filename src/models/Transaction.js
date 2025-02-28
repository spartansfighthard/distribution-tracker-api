const { connectToDatabase } = require('../utils/mongodb');

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

  // Save transaction to MongoDB
  async save() {
    try {
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
        console.log(`Updated transaction: ${this.signature}`);
      } else {
        // Insert new transaction
        await collection.insertOne(this);
        console.log(`Saved new transaction: ${this.signature}`);
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
      
      const { db } = await connectToDatabase();
      const collection = db.collection('transactions');
      
      return await collection.find(query).toArray();
    } catch (error) {
      console.error('Error finding transactions:', error);
      return [];
    }
  }

  // Find one transaction by query
  static async findOne(query = {}) {
    try {
      console.log(`Finding one transaction with query:`, query);
      
      const { db } = await connectToDatabase();
      const collection = db.collection('transactions');
      
      return await collection.findOne(query);
    } catch (error) {
      console.error('Error finding transaction:', error);
      return null;
    }
  }

  // Get all transactions
  static async getAll() {
    try {
      const { db } = await connectToDatabase();
      const collection = db.collection('transactions');
      
      const transactions = await collection.find({}).toArray();
      console.log(`Getting all transactions (count: ${transactions.length})`);
      
      return transactions;
    } catch (error) {
      console.error('Error getting all transactions:', error);
      return [];
    }
  }

  // Get transaction count
  static async getCount() {
    try {
      const { db } = await connectToDatabase();
      const collection = db.collection('transactions');
      
      return await collection.countDocuments({});
    } catch (error) {
      console.error('Error getting transaction count:', error);
      return 0;
    }
  }

  // Get transactions by type
  static async getByType(type) {
    try {
      const { db } = await connectToDatabase();
      const collection = db.collection('transactions');
      
      return await collection.find({ type }).toArray();
    } catch (error) {
      console.error(`Error getting transactions by type ${type}:`, error);
      return [];
    }
  }

  // Get transactions by token
  static async getByToken(token) {
    try {
      const { db } = await connectToDatabase();
      const collection = db.collection('transactions');
      
      return await collection.find({ token }).toArray();
    } catch (error) {
      console.error(`Error getting transactions by token ${token}:`, error);
      return [];
    }
  }

  // Get transactions by token mint
  static async getByTokenMint(tokenMint) {
    try {
      const { db } = await connectToDatabase();
      const collection = db.collection('transactions');
      
      return await collection.find({ tokenMint }).toArray();
    } catch (error) {
      console.error(`Error getting transactions by token mint ${tokenMint}:`, error);
      return [];
    }
  }

  // Set last fetch timestamp
  static async setLastFetchTimestamp(timestamp) {
    try {
      const { db } = await connectToDatabase();
      const collection = db.collection('metadata');
      
      await collection.updateOne(
        { key: 'lastFetchTimestamp' },
        { $set: { value: timestamp } },
        { upsert: true }
      );
      
      console.log(`Set last fetch timestamp: ${timestamp}`);
    } catch (error) {
      console.error('Error setting last fetch timestamp:', error);
    }
  }

  // Get last fetch timestamp
  static async getLastFetchTimestamp() {
    try {
      const { db } = await connectToDatabase();
      const collection = db.collection('metadata');
      
      const doc = await collection.findOne({ key: 'lastFetchTimestamp' });
      return doc ? doc.value : null;
    } catch (error) {
      console.error('Error getting last fetch timestamp:', error);
      return null;
    }
  }

  // Clear all transactions (for testing)
  static async clearAll() {
    try {
      const { db } = await connectToDatabase();
      const collection = db.collection('transactions');
      
      const result = await collection.deleteMany({});
      console.log(`Cleared all transactions (count: ${result.deletedCount})`);
      
      return result.deletedCount;
    } catch (error) {
      console.error('Error clearing transactions:', error);
      return 0;
    }
  }
}

module.exports = Transaction; 