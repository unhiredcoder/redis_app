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
  }
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
        
        // Update job progress
        await job.updateProgress(10);

        // Check PostgreSQL for duplicate
        const existingMySQL = await query(
          "SELECT id, email FROM emails WHERE email = $1",
          [email]
        );
        
        // Update job progress
        await job.updateProgress(30);

        // Check MongoDB for duplicate
        const existingMongoDB = await emailCollection.findOne({ email });
        
        // Update job progress
        await job.updateProgress(50);

        if (existingMySQL.rows.length > 0 || existingMongoDB) {
          console.log(`⚠️ Duplicate found: ${email}`);
          duplicates.push(email);
          skippedCount = 1;
          
          // Insert into the database where it doesn't exist
          if (existingMySQL.rows.length === 0) {
            // Insert into PostgreSQL
            const result = await query(
              "INSERT INTO emails (email, subject, body, created_at) VALUES ($1, $2, $3, NOW()) RETURNING id",
              [email, subject, body]
            );
            console.log(`📝 Inserted into PostgreSQL: ${result.rows[0].id}`);
            insertedCount++;
          }
          
          if (!existingMongoDB) {
            // Insert into MongoDB
            const mongoResult = await emailCollection.insertOne({
              email,
              subject,
              body,
              created_at: new Date(),
            });
            console.log(`📝 Inserted into MongoDB: ${mongoResult.insertedId}`);
            insertedCount++;
          }
          
          await job.updateProgress(100);
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

        // Insert into PostgreSQL (no duplicate)
        const pgResult = await query(
          "INSERT INTO emails (email, subject, body, created_at) VALUES ($1, $2, $3, NOW()) RETURNING id",
          [email, subject, body]
        );
        console.log(`✅ PostgreSQL insert: ${pgResult.rows[0].id}`);
        insertedCount++;
        
        await job.updateProgress(70);

        // Insert into MongoDB
        const mongoResult = await emailCollection.insertOne({
          email,
          subject,
          body,
          created_at: new Date(),
        });
        console.log(`✅ MongoDB insert: ${mongoResult.insertedId}`);
        insertedCount++;
        
        await job.updateProgress(100);
        
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
        
        // Update progress
        await job.updateProgress(10);

        // Extract email addresses
        const emailList = emails.map(e => e.email);
        
        // Check PostgreSQL for existing emails
        // PostgreSQL doesn't support IN with array directly, so we use ANY($1)
        const existingPostgreSQL = await query(
          "SELECT email FROM emails WHERE email = ANY($1::text[])",
          [emailList]
        );
        
        await job.updateProgress(30);

        // Check MongoDB for existing emails
        const existingMongoDB = await emailCollection.find({
          email: { $in: emailList }
        }).toArray();
        
        await job.updateProgress(50);

        const existingEmailsPostgreSQL = new Set(existingPostgreSQL.rows.map(e => e.email));
        const existingEmailsMongoDB = new Set(existingMongoDB.map(e => e.email));
        const allExistingEmails = new Set([...existingEmailsPostgreSQL, ...existingEmailsMongoDB]);

        // Separate unique and duplicate emails
        const uniqueEmails = emails.filter(emailObj => !allExistingEmails.has(emailObj.email));
        const duplicateEmails = emails.filter(emailObj => allExistingEmails.has(emailObj.email));
        
        duplicates = duplicateEmails.map(e => e.email);
        skippedCount = duplicates.length;

        console.log(`📊 Unique: ${uniqueEmails.length}, Duplicates: ${duplicates.length}`);

        // Process unique emails for PostgreSQL
        if (uniqueEmails.length > 0) {
          // PostgreSQL bulk insert using multiple VALUES rows
          let insertedRows = 0;
          
          // Process in batches to avoid huge queries
          const batchSize = 100;
          for (let i = 0; i < uniqueEmails.length; i += batchSize) {
            const batch = uniqueEmails.slice(i, i + batchSize);
            
            // Build parameterized query for batch
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
            
            const result = await query(batchQuery, values);
            insertedRows += result.rowCount;
            console.log(`✅ PostgreSQL batch insert: ${result.rowCount} rows`);
          }
          
          console.log(`✅ PostgreSQL bulk insert: ${insertedRows} rows total`);
          insertedCount += insertedRows;
        }
        
        await job.updateProgress(70);

        // Process unique emails for MongoDB (only those not in MongoDB)
        const emailsForMongoDB = uniqueEmails.filter(emailObj => !existingEmailsMongoDB.has(emailObj.email));
        
        if (emailsForMongoDB.length > 0) {
          const mongoDocs = emailsForMongoDB.map(email => ({
            email: email.email,
            subject: email.subject,
            body: email.body,
            created_at: new Date(),
          }));
          
          const mongoResult = await emailCollection.insertMany(mongoDocs);
          console.log(`✅ MongoDB bulk insert: ${mongoResult.insertedCount} documents`);
          insertedCount += mongoResult.insertedCount;
        }

        // Handle emails that exist only in PostgreSQL (add to MongoDB)
        const emailsOnlyInPostgreSQL = duplicateEmails.filter(emailObj => 
          existingEmailsPostgreSQL.has(emailObj.email) && !existingEmailsMongoDB.has(emailObj.email)
        );
        
        if (emailsOnlyInPostgreSQL.length > 0) {
          const mongoDocs = emailsOnlyInPostgreSQL.map(email => ({
            email: email.email,
            subject: email.subject,
            body: email.body,
            created_at: new Date(),
          }));
          
          const mongoResult = await emailCollection.insertMany(mongoDocs);
          console.log(`📝 Added ${mongoResult.insertedCount} emails to MongoDB (existed only in PostgreSQL)`);
          insertedCount += mongoResult.insertedCount;
        }
        
        await job.updateProgress(100);

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
        url: process.env.REDIS_URL
    },
    concurrency: 5,
    removeOnComplete: {
      count: 1000, 
    },
    removeOnFail: {
      count: 5000, 
    }
  }
);

// Worker event listeners
emailWorker.on("completed", (job, result) => {
  console.log(`✅ Job ${job.id} completed successfully`);
  console.log("Result:", JSON.stringify(result, null, 2));
});

emailWorker.on("failed", (job, err) => {
  console.error(`❌ Job ${job.id} failed: ${err.message}`);
});

emailWorker.on("progress", (job, progress) => {
  console.log(`📈 Job ${job.id} progress: ${progress}%`);
});

emailWorker.on("error", (err) => {
  console.error("Worker error:", err);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Received SIGINT. Closing PostgreSQL pool...');
  await pgPool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM. Closing PostgreSQL pool...');
  await pgPool.end();
  process.exit(0);
});

console.log("✅ Email worker started and waiting for jobs...");