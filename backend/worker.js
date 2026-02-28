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
  max: 10,
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

const query = (text, params) => pgPool.query(text, params);

// CRITICAL FIX: BullMQ v4 settings structure
const emailWorker = new Worker(
  "emailQueue",
  async (job) => {
    // Your existing job processing logic (keep it exactly as is)
    console.log(`📨 Processing job ${job.id}: ${job.name}`);
    
    let duplicates = [];
    let insertedCount = 0;
    let skippedCount = 0;

    try {
      if (job.name === "sendEmailJob") {
        const { email, subject, body } = job.data;
        
        const [existingMySQL, existingMongoDB] = await Promise.all([
          query("SELECT id, email FROM emails WHERE email = $1", [email]),
          emailCollection.findOne({ email })
        ]);

        const isDuplicate = existingMySQL.rows.length > 0 || existingMongoDB;

        if (isDuplicate) {
          console.log(`⚠️ Duplicate found: ${email}`);
          duplicates.push(email);
          skippedCount = 1;
          
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
        // Your existing bulk processing logic (keep as is)
        const emails = job.data.emails;
        const totalEmails = emails.length;
        
        console.log(`📦 Processing bulk job with ${totalEmails} emails`);

        const emailList = emails.map(e => e.email);
        
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

        const uniqueEmails = emails.filter(emailObj => !allExistingEmails.has(emailObj.email));
        const duplicateEmails = emails.filter(emailObj => allExistingEmails.has(emailObj.email));
        
        duplicates = duplicateEmails.map(e => e.email);
        skippedCount = duplicates.length;

        console.log(`📊 Unique: ${uniqueEmails.length}, Duplicates: ${duplicates.length}`);

        const batchSize = 100;
        const pgBatches = [];
        const mongoBatches = [];

        // PostgreSQL batches
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

        // MongoDB batches (only emails not in MongoDB)
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

        const [pgResults, mongoResults] = await Promise.all([
          Promise.all(pgBatches),
          Promise.all(mongoBatches)
        ]);

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
      maxRetriesPerRequest: null,
      enableReadyCheck: false
    },
    concurrency: 5,
    // CRITICAL: BullMQ v4 settings - these go at root level, not in 'settings'
    lockDuration: 60000,        // How long to hold the job lock (default: 30000)
    stalledInterval: 120000,     // How often to check for stalled jobs (default: 30000)
    maxStalledCount: 2,          // Max retries for stalled jobs (default: 1)
    skipStalledCheck: false,     // Don't skip stalled check
    // This is the key setting for reducing polling - it's called 'drainDelay' in v4, not 'markerTTL'
    drainDelay: 30000,           // Wait 30 seconds when queue is empty instead of 5 (THIS IS THE FIX!)
    
    removeOnComplete: {
      age: 3600,  // 1 hour
      count: 100
    },
    removeOnFail: {
      age: 7200,  // 2 hours
      count: 200
    },
    
    // These settings help reduce Redis commands
    limiter: {
      max: 100,   // Max jobs processed
      duration: 1000 // Per second
    }
  }
);

// Worker event listeners
emailWorker.on("completed", (job, result) => {
  console.log(`✅ Job ${job.id} completed successfully`);
  if (result?.type === "bulk") {
    console.log(`📊 Bulk result: ${result.insertedCount} inserted, ${result.skippedCount} skipped`);
  }
});

emailWorker.on("failed", (job, err) => {
  console.error(`❌ Job ${job.id} failed: ${err.message}`);
});

emailWorker.on("error", (err) => {
  console.error("Worker error:", err);
});

// Graceful shutdown
async function shutdown() {
  console.log('🛑 Shutting down gracefully...');
  
  await emailWorker.close();
  console.log('✅ Worker closed');
  
  await pgPool.end();
  console.log('✅ PostgreSQL pool closed');
  
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log("✅ Email worker started with Redis-optimized settings");
console.log("📊 Settings for BullMQ v4:", {
  concurrency: 5,
  drainDelay: '30s (was 5s)',
  stalledInterval: '2m (was 30s)',
  lockDuration: '1m (was 30s)',
  maxStalledCount: 2
});
