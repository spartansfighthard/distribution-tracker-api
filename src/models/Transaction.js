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

  // Save transaction to in-memory storage
  async save() {
    try {
      // Check if transaction already exists
      const existingIndex = transactions.findIndex(t => t.signature === this.signature);
      
      if (existingIndex >= 0) {
        // Update existing transaction
        transactions[existingIndex] = this;
        console.log(`Updated transaction: ${this.signature}`);
      } else {
        // Add new transaction
        transactions.push(this);
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
      return transactions.length;
    } catch (error) {
      console.error('Error getting transaction count:', error);
      return 0;
    }
  }

  // Get transactions by type
  static async getByType(type) {
    try {
      return transactions.filter(t => t.type === type);
    } catch (error) {
      console.error(`Error getting transactions by type ${type}:`, error);
      return [];
    }
  }

  // Get transactions by token
  static async getByToken(token) {
    try {
      return transactions.filter(t => t.token === token);
    } catch (error) {
      console.error(`Error getting transactions by token ${token}:`, error);
      return [];
    }
  }

  // Get transactions by token mint
  static async getByTokenMint(tokenMint) {
    try {
      return transactions.filter(t => t.tokenMint === tokenMint);
    } catch (error) {
      console.error(`Error getting transactions by token mint ${tokenMint}:`, error);
      return [];
    }
  }

  // Set last fetch timestamp
  static setLastFetchTimestamp(timestamp) {
    lastFetchTimestamp = timestamp;
    console.log(`Set last fetch timestamp: ${timestamp}`);
  }

  // Get last fetch timestamp
  static getLastFetchTimestamp() {
    return lastFetchTimestamp;
  }

  // Clear all transactions (for testing)
  static async clearAll() {
    try {
      const count = transactions.length;
      transactions.length = 0;
      console.log(`Cleared all transactions (count: ${count})`);
      return count;
    } catch (error) {
      console.error('Error clearing transactions:', error);
      return 0;
    }
  }
}

module.exports = Transaction; 