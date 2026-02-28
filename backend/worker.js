import { Worker } from "bullmq";
import pkg from 'pg';
const { Pool } = pkg;
import { emailCollection } from "./mongo_db.js";
import dotenv from "dotenv";

dotenv.config();

// --- PostgreSQL (Supabase) Connection ---
const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  max: 10, // Limit connection pool size
  idleTimeoutMillis: 30000
});

// Test PostgreSQL connection
async function testConnection() {
  try {
    const client = await pgPool.connect();
    console.log("✅ Connected to PostgreSQL (Supabase)");
    client.release();
  } catch (error) {
    console.error("❌ PostgreSQL connection error:", error);
    process.exit(1);
  }
}

testConnection();

// Helper function for queries
const query = (text, params) => pgPool.query(text, params);

// Optimized Worker Configuration
const emailWorker = new Worker(
  "emailQueue",
  async (job) => {
    console.log(`📨 Processing job ${job.id}: ${job.name}`);
    
    let duplicates = [];
    let insertedCount = 0;
    let skippedCount = 0;

    try {
      if (job.name === "sendEmailJob") {
        const { email, subject, body } = job.data;
        
        // Optimize: Check both databases in parallel
        const [existingMySQL, existingMongoDB] = await Promise.all([
          query("SELECT id, email FROM emails WHERE email = $1", [email]),
          emailCollection.findOne({ email })
        ]);

        const isDuplicate = existingMySQL.rows.length > 0 || existingMongoDB;

        if (isDuplicate) {
          console.log(`⚠️ Duplicate found: ${email}`);
          duplicates.push(email);
          skippedCount = 1;
          
          // Use Promise.all for parallel inserts where needed
          const insertPromises = [];
          
          if (existingMySQL.rows.length === 0) {
            insertPromises.push(
              query(
                "INSERT INTO emails (email, subject, body, created_at) VALUES ($1, $2, $3, NOW()) RETURNING id",
                [email, subject, body]
              ).then(result => {
                console.log(`📝 Inserted into PostgreSQL: ${result.rows[0].id}`);
                insertedCount++;
              })
            );
          }
          
          if (!existingMongoDB) {
            insertPromises.push(
              emailCollection.insertOne({
                email,
                subject,
                body,
                created_at: new Date(),
              }).then(result => {
                console.log(`📝 Inserted into MongoDB: ${result.insertedId}`);
                insertedCount++;
              })
            );
          }
          
          await Promise.all(insertPromises);
          
          return {
            success: true,
            type: "single",
            duplicates,
            insertedCount,
            skippedCount,
            total: 1,
            message: "Duplicate email found and handled"
          };
        }

        // No duplicate - insert to both databases in parallel
        const [pgResult, mongoResult] = await Promise.all([
          query(
            "INSERT INTO emails (email, subject, body, created_at) VALUES ($1, $2, $3, NOW()) RETURNING id",
            [email, subject, body]
          ),
          emailCollection.insertOne({
            email,
            subject,
            body,
            created_at: new Date(),
          })
        ]);
        
        console.log(`✅ PostgreSQL insert: ${pgResult.rows[0].id}`);
        console.log(`✅ MongoDB insert: ${mongoResult.insertedId}`);
        insertedCount = 2;
        
        return {
          success: true,
          type: "single",
          duplicates: [],
          insertedCount,
          skippedCount: 0,
          total: 1,
          message: "Email processed successfully"
        };

      } else if (job.name === "sendBulkEmailsJob") {
        const emails = job.data.emails;
        const totalEmails = emails.length;
        
        console.log(`📦 Processing bulk job with ${totalEmails} emails`);

        // Extract email addresses
        const emailList = emails.map(e => e.email);
        
        // Check both databases in parallel
        const [existingPostgreSQL, existingMongoDB] = await Promise.all([
          query(
            "SELECT email FROM emails WHERE email = ANY($1::text[])",
            [emailList]
          ),
          emailCollection.find({
            email: { $in: emailList }
          }).toArray()
        ]);

        const existingEmailsPostgreSQL = new Set(existingPostgreSQL.rows.map(e => e.email));
        const existingEmailsMongoDB = new Set(existingMongoDB.map(e => e.email));
        const allExistingEmails = new Set([...existingEmailsPostgreSQL, ...existingEmailsMongoDB]);

        // Separate unique and duplicate emails
        const uniqueEmails = emails.filter(emailObj => !allExistingEmails.has(emailObj.email));
        const duplicateEmails = emails.filter(emailObj => allExistingEmails.has(emailObj.email));
        
        duplicates = duplicateEmails.map(e => e.email);
        skippedCount = duplicates.length;

        console.log(`📊 Unique: ${uniqueEmails.length}, Duplicates: ${duplicates.length}`);

        // Process inserts in parallel batches
        const batchSize = 100;
        const pgBatches = [];
        const mongoBatches = [];

        // Prepare PostgreSQL batches
        for (let i = 0; i < uniqueEmails.length; i += batchSize) {
          const batch = uniqueEmails.slice(i, i + batchSize);
          
          const values = [];
          const placeholders = [];
          
          batch.forEach((email, index) => {
            const baseIndex = index * 3;
            placeholders.push(`($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, NOW())`);
            values.push(email.email, email.subject, email.body);
          });
          
          const batchQuery = `
            INSERT INTO emails (email, subject, body, created_at) 
            VALUES ${placeholders.join(', ')}
            RETURNING id
          `;
          
          pgBatches.push(query(batchQuery, values));
        }

        // Prepare MongoDB batches (only emails not in MongoDB)
        const emailsForMongoDB = uniqueEmails.filter(emailObj => !existingEmailsMongoDB.has(emailObj.email));
        
        for (let i = 0; i < emailsForMongoDB.length; i += batchSize) {
          const batch = emailsForMongoDB.slice(i, i + batchSize);
          const mongoDocs = batch.map(email => ({
            email: email.email,
            subject: email.subject,
            body: email.body,
            created_at: new Date(),
          }));
          mongoBatches.push(emailCollection.insertMany(mongoDocs));
        }

        // Handle emails that exist only in PostgreSQL
        const emailsOnlyInPostgreSQL = duplicateEmails.filter(emailObj => 
          existingEmailsPostgreSQL.has(emailObj.email) && !existingEmailsMongoDB.has(emailObj.email)
        );

        for (let i = 0; i < emailsOnlyInPostgreSQL.length; i += batchSize) {
          const batch = emailsOnlyInPostgreSQL.slice(i, i + batchSize);
          const mongoDocs = batch.map(email => ({
            email: email.email,
            subject: email.subject,
            body: email.body,
            created_at: new Date(),
          }));
          mongoBatches.push(emailCollection.insertMany(mongoDocs));
        }

        // Execute all batches in parallel
        const [pgResults, mongoResults] = await Promise.all([
          Promise.all(pgBatches),
          Promise.all(mongoBatches)
        ]);

        // Count inserted rows
        const pgInserted = pgResults.reduce((sum, result) => sum + (result.rowCount || 0), 0);
        const mongoInserted = mongoResults.reduce((sum, result) => sum + (result.insertedCount || 0), 0);
        
        insertedCount = pgInserted + mongoInserted;

        return {
          success: true,
          type: "bulk",
          duplicates,
          insertedCount,
          skippedCount,
          total: totalEmails,
          message: `Processed ${totalEmails} emails (${duplicates.length} duplicates skipped)`
        };
      }
    } catch (err) {
      console.error(`❌ Error in job ${job.id}:`, err.message);
      throw err;
    }
  },
  {
    connection: {
      url: process.env.REDIS_URL,
      // Add connection options for Upstash
      maxRetriesPerRequest: null,
      enableReadyCheck: false
    },
    concurrency: 5,
    // OPTIMIZED SETTINGS FOR FREE TIER
    settings: {
      markerTTL: 30000,      // Wait 30s between checks (reduces Redis commands by 83%)
      stalledInterval: 120000, // Check stalled every 2 minutes
      lockDuration: 60000,    // 1 minute lock duration
      maxStalledCount: 2      // Only retry stalled jobs twice
    },
    removeOnComplete: {
      age: 3600, // Remove completed jobs older than 1 hour (reduces Redis memory)
      count: 100 // Keep only last 100 completed jobs
    },
    removeOnFail: {
      age: 7200, // Remove failed jobs older than 2 hours
      count: 200 // Keep only last 200 failed jobs
    }
  }
);

// Worker event listeners (keep these - they don't affect Redis much)
emailWorker.on("completed", (job, result) => {
  console.log(`✅ Job ${job.id} completed successfully`);
  if (result?.type === "bulk") {
    console.log(`📊 Bulk result: ${result.insertedCount} inserted, ${result.skippedCount} skipped`);
  }
});

emailWorker.on("failed", (job, err) => {
  console.error(`❌ Job ${job.id} failed: ${err.message}`);
});

// Only log progress for long-running jobs (optional)
emailWorker.on("progress", (job, progress) => {
  if (progress % 50 === 0) { // Log only at 50% and 100%
    console.log(`📈 Job ${job.id} progress: ${progress}%`);
  }
});

emailWorker.on("error", (err) => {
  console.error("Worker error:", err);
});

// Graceful shutdown - close all connections
async function shutdown() {
  console.log('🛑 Shutting down gracefully...');
  
  // Close worker first (stops accepting new jobs)
  await emailWorker.close();
  console.log('✅ Worker closed');
  
  // Close PostgreSQL pool
  await pgPool.end();
  console.log('✅ PostgreSQL pool closed');
  
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log("✅ Email worker started with Redis-optimized settings");
console.log("📊 Settings:", {
  concurrency: 5,
  markerTTL: '30s',
  stalledInterval: '2m',
  lockDuration: '1m',
  removeOnComplete: '100 jobs or 1 hour',
  removeOnFail: '200 jobs or 2 hours'
});
