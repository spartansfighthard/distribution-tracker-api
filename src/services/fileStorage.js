// File storage service with in-memory fallback for Vercel
const fs = require('fs').promises;
const path = require('path');

// In-memory storage for Vercel environment
const memoryStorage = {};

// Check if we're in Vercel environment
const isVercel = process.env.VERCEL === '1' || process.env.VERCEL === 'true';

// Data directory
const DATA_DIR = isVercel ? null : path.join(process.cwd(), 'data');

// Initialize storage
async function initialize() {
  try {
    if (isVercel) {
      console.log('Running in Vercel environment, using in-memory storage');
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

// Read data from file or memory
async function readData(filename) {
  try {
    // Use in-memory storage in Vercel
    if (isVercel) {
      console.log(`Reading data from memory: ${filename}`);
      return memoryStorage[filename] || null;
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

// Write data to file or memory
async function writeData(filename, data) {
  try {
    // Use in-memory storage in Vercel
    if (isVercel) {
      console.log(`Writing data to memory: ${filename}`);
      memoryStorage[filename] = data;
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

// Delete data from file or memory
async function deleteData(filename) {
  try {
    // Use in-memory storage in Vercel
    if (isVercel) {
      console.log(`Deleting data from memory: ${filename}`);
      delete memoryStorage[filename];
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
    // Use in-memory storage in Vercel
    if (isVercel) {
      console.log('Listing data from memory');
      return Object.keys(memoryStorage);
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