import pkg from 'pg';
const { Pool } = pkg;
import dotenv from "dotenv";

dotenv.config();

// --- PostgreSQL (Supabase) ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // Supabase provides this
  ssl: {
    rejectUnauthorized: false // Required for Supabase connections
  }
});

// Ensure table exists
async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS emails (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        subject VARCHAR(255) NOT NULL,
        body TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log("Connected to PostgreSQL (Supabase) DB");
  } catch (error) {
    console.error("Error initializing database:", error);
    throw error;
  }
}

// Initialize the database
initializeDatabase();

// Export a function to get a client from the pool
export const query = (text, params) => pool.query(text, params);

// Export the pool itself if needed
export default pool;