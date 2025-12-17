import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

// --- MongoDB ---
const client = new MongoClient(process.env.MONGO_URI);
await client.connect();
console.log("Connected to MongoDB");

const db = client.db(process.env.MONGO_DB);
const emailCollection = db.collection(process.env.MONGO_COLLECTION);

export { emailCollection };
