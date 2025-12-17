import { Worker } from "bullmq";
import connection from "./mysql_db.js";
import { emailCollection } from "./mongo_db.js";

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

        // Check MySQL for duplicate
        const [existingMySQL] = await connection.query(
          "SELECT id, email FROM emails WHERE email = ?",
          [email]
        );
        
        // Update job progress
        await job.updateProgress(30);

        // Check MongoDB for duplicate
        const existingMongoDB = await emailCollection.findOne({ email });
        
        // Update job progress
        await job.updateProgress(50);

        if (existingMySQL.length > 0 || existingMongoDB) {
          console.log(`⚠️ Duplicate found: ${email}`);
          duplicates.push(email);
          skippedCount = 1;
          
          // Insert into the database where it doesn't exist
          if (existingMySQL.length === 0) {
            // Insert into MySQL
            const [result] = await connection.query(
              "INSERT INTO emails (email, subject, body, created_at) VALUES (?, ?, ?, NOW())",
              [email, subject, body]
            );
            console.log(`📝 Inserted into MySQL: ${result.insertId}`);
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

        // Insert into MySQL (no duplicate)
        const [mysqlResult] = await connection.query(
          "INSERT INTO emails (email, subject, body, created_at) VALUES (?, ?, ?, NOW())",
          [email, subject, body]
        );
        console.log(`✅ MySQL insert: ${mysqlResult.insertId}`);
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
        
        // Check MySQL for existing emails
        const [existingMySQL] = await connection.query(
          "SELECT email FROM emails WHERE email IN (?)",
          [emailList]
        );
        
        await job.updateProgress(30);

        // Check MongoDB for existing emails
        const existingMongoDB = await emailCollection.find({
          email: { $in: emailList }
        }).toArray();
        
        await job.updateProgress(50);

        const existingEmailsMySQL = new Set(existingMySQL.map(e => e.email));
        const existingEmailsMongoDB = new Set(existingMongoDB.map(e => e.email));
        const allExistingEmails = new Set([...existingEmailsMySQL, ...existingEmailsMongoDB]);

        // Separate unique and duplicate emails
        const uniqueEmails = emails.filter(emailObj => !allExistingEmails.has(emailObj.email));
        const duplicateEmails = emails.filter(emailObj => allExistingEmails.has(emailObj.email));
        
        duplicates = duplicateEmails.map(e => e.email);
        skippedCount = duplicates.length;

        console.log(`📊 Unique: ${uniqueEmails.length}, Duplicates: ${duplicates.length}`);

        // Process unique emails for MySQL
        if (uniqueEmails.length > 0) {
          const mysqlValues = uniqueEmails.map(email => [
            email.email,
            email.subject,
            email.body,
            new Date()
          ]);
          
          const [mysqlResult] = await connection.query(
            "INSERT INTO emails (email, subject, body, created_at) VALUES ?",
            [mysqlValues]
          );
          
          console.log(`✅ MySQL bulk insert: ${mysqlResult.affectedRows} rows`);
          insertedCount += mysqlResult.affectedRows;
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

        // Handle emails that exist only in MySQL (add to MongoDB)
        const emailsOnlyInMySQL = duplicateEmails.filter(emailObj => 
          existingEmailsMySQL.has(emailObj.email) && !existingEmailsMongoDB.has(emailObj.email)
        );
        
        if (emailsOnlyInMySQL.length > 0) {
          const mongoDocs = emailsOnlyInMySQL.map(email => ({
            email: email.email,
            subject: email.subject,
            body: email.body,
            created_at: new Date(),
          }));
          
          const mongoResult = await emailCollection.insertMany(mongoDocs);
          console.log(`📝 Added ${mongoResult.insertedCount} emails to MongoDB (existed only in MySQL)`);
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
      host: "10.10.15.140",
      port: 6379,
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

console.log("✅ Email worker started and waiting for jobs...");