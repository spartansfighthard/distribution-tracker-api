const { MongoClient, ServerApiVersion } = require('mongodb');

const uri = process.env.MONGODB_URI || "mongodb+srv://spartansfighthard:cUhXoY8oJ9uylB4Y@cluster0.v6wfp.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

// Create a MongoClient with a MongoClientOptions object
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

// Connection cache
let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
  // If we already have a connection, use it
  if (cachedClient && cachedDb) {
    return { client: cachedClient, db: cachedDb };
  }

  // If no connection, create a new one
  try {
    await client.connect();
    
    // Verify connection with a ping
    await client.db("admin").command({ ping: 1 });
    console.log("Connected to MongoDB Atlas successfully!");
    
    const db = client.db("distro-tracker");
    
    // Cache the connection
    cachedClient = client;
    cachedDb = db;
    
    return { client, db };
  } catch (error) {
    console.error("MongoDB connection error:", error);
    throw error;
  }
}

module.exports = { connectToDatabase }; 