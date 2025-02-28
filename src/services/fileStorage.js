const fs = require('fs');
const path = require('path');

// In-memory storage for Vercel deployment
let memoryStorage = {};

// Check if running in Vercel's serverless environment
const isVercel = process.env.VERCEL === '1';

// Define data directory - only used in local development
const dataDir = path.join(process.cwd(), 'data');

// Create data directory if it doesn't exist and we're not in Vercel
if (!isVercel) {
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
      console.log(`Created data directory at ${dataDir}`);
    }
  } catch (error) {
    console.error(`Error creating data directory: ${error.message}`);
  }
}

/**
 * Save data to a JSON file or memory storage
 * @param {string} filename - The name of the file (without path or extension)
 * @param {object} data - The data to save
 * @returns {Promise<boolean>} - Whether the operation was successful
 */
async function saveData(filename, data) {
  try {
    if (isVercel) {
      // In Vercel, store in memory
      memoryStorage[filename] = data;
      console.log(`Saved data to memory storage: ${filename}`);
      return true;
    } else {
      // In local development, write to file
      const filePath = path.join(dataDir, `${filename}.json`);
      await fs.promises.writeFile(
        filePath,
        JSON.stringify(data, null, 2),
        'utf8'
      );
      console.log(`Saved data to file: ${filePath}`);
      return true;
    }
  } catch (error) {
    console.error(`Error saving data for ${filename}:`, error);
    return false;
  }
}

/**
 * Load data from a JSON file or memory storage
 * @param {string} filename - The name of the file (without path or extension)
 * @param {object} defaultData - Default data to return if file doesn't exist
 * @returns {Promise<object>} - The loaded data or default data
 */
async function loadData(filename, defaultData = {}) {
  try {
    if (isVercel) {
      // In Vercel, retrieve from memory
      return memoryStorage[filename] || defaultData;
    } else {
      // In local development, read from file
      const filePath = path.join(dataDir, `${filename}.json`);
      
      if (!fs.existsSync(filePath)) {
        console.log(`File ${filePath} doesn't exist, returning default data`);
        return defaultData;
      }
      
      const data = await fs.promises.readFile(filePath, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error(`Error loading data for ${filename}:`, error);
    return defaultData;
  }
}

module.exports = {
  saveData,
  loadData
}; 