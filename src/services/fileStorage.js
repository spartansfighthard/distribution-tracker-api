// File storage service with in-memory fallback for Vercel
const fs = require('fs').promises;
const path = require('path');
const { connectToDatabase } = require('../utils/mongodb');

// Check if we're in Vercel environment
const isVercel = process.env.VERCEL === '1' || process.env.VERCEL === 'true';

// Data directory
const DATA_DIR = isVercel ? null : path.join(process.cwd(), 'data');

// Initialize storage
async function initialize() {
  try {
    if (isVercel) {
      console.log('Running in Vercel environment, using MongoDB storage');
      // Test MongoDB connection
      await connectToDatabase();
      return true;
    }
    
    console.log(`Initializing file storage at ${DATA_DIR}`);
    
    // Create data directory if it doesn't exist
    try {
      await fs.mkdir(DATA_DIR, { recursive: true });
      console.log(`Created data directory: ${DATA_DIR}`);
    } catch (error) {
      if (error.code !== 'EEXIST') {
        console.error('Error creating data directory:', error);
        return false;
      }
    }
    
    return true;
  } catch (error) {
    console.error('Error initializing file storage:', error);
    return false;
  }
}

// Read data from file or MongoDB
async function readData(filename) {
  try {
    // Use MongoDB in Vercel
    if (isVercel) {
      console.log(`Reading data from MongoDB: ${filename}`);
      
      const { db } = await connectToDatabase();
      const collection = db.collection('metadata');
      
      const doc = await collection.findOne({ key: filename });
      return doc ? doc.value : null;
    }
    
    // Use file storage in local environment
    const filePath = path.join(DATA_DIR, filename);
    console.log(`Reading data from file: ${filePath}`);
    
    try {
      const data = await fs.readFile(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log(`File not found: ${filePath}`);
        return null;
      }
      throw error;
    }
  } catch (error) {
    console.error(`Error reading data from ${filename}:`, error);
    return null;
  }
}

// Write data to file or MongoDB
async function writeData(filename, data) {
  try {
    // Use MongoDB in Vercel
    if (isVercel) {
      console.log(`Writing data to MongoDB: ${filename}`);
      
      const { db } = await connectToDatabase();
      const collection = db.collection('metadata');
      
      await collection.updateOne(
        { key: filename },
        { $set: { value: data } },
        { upsert: true }
      );
      
      return true;
    }
    
    // Use file storage in local environment
    const filePath = path.join(DATA_DIR, filename);
    console.log(`Writing data to file: ${filePath}`);
    
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error(`Error writing data to ${filename}:`, error);
    return false;
  }
}

// Delete data from file or MongoDB
async function deleteData(filename) {
  try {
    // Use MongoDB in Vercel
    if (isVercel) {
      console.log(`Deleting data from MongoDB: ${filename}`);
      
      const { db } = await connectToDatabase();
      const collection = db.collection('metadata');
      
      await collection.deleteOne({ key: filename });
      return true;
    }
    
    // Use file storage in local environment
    const filePath = path.join(DATA_DIR, filename);
    console.log(`Deleting data from file: ${filePath}`);
    
    try {
      await fs.unlink(filePath);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log(`File not found: ${filePath}`);
        return true;
      }
      throw error;
    }
  } catch (error) {
    console.error(`Error deleting data from ${filename}:`, error);
    return false;
  }
}

// List all data files
async function listData() {
  try {
    // Use MongoDB in Vercel
    if (isVercel) {
      console.log('Listing data from MongoDB');
      
      const { db } = await connectToDatabase();
      const collection = db.collection('metadata');
      
      const docs = await collection.find({}).toArray();
      return docs.map(doc => doc.key);
    }
    
    // Use file storage in local environment
    console.log(`Listing data from directory: ${DATA_DIR}`);
    
    try {
      const files = await fs.readdir(DATA_DIR);
      return files;
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log(`Directory not found: ${DATA_DIR}`);
        return [];
      }
      throw error;
    }
  } catch (error) {
    console.error('Error listing data:', error);
    return [];
  }
}

// Export functions
module.exports = {
  initialize,
  readData,
  writeData,
  deleteData,
  listData
}; 