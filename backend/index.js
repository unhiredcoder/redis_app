import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import { emailQueue } from "./producer.js";
import connection from "./mysql_db.js";
import { emailCollection } from "./mongo_db.js";

const app = express();
app.use(cors({ origin: "http://10.10.15.140:5175", methods: ["GET", "POST"] }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "http://10.10.15.140:5175", methods: ["GET", "POST"] },
});

// Store active jobs for real-time tracking
const activeJobs = new Map();

// Listen for queue events
emailQueue.on("completed", (job, result) => {
  console.log(`✅ Job ${job.id} completed`);
  
  // Broadcast to all clients
  io.emit("jobCompleted", {
    jobId: job.id,
    result,
    timestamp: new Date(),
  });
  
  // Remove from active jobs
  activeJobs.delete(job.id);
});

emailQueue.on("failed", (job, err) => {
  console.error(`❌ Job ${job.id} failed: ${err.message}`);
  
  io.emit("jobFailed", {
    jobId: job.id,
    error: err.message,
    timestamp: new Date(),
  });
  
  activeJobs.delete(job.id);
});

emailQueue.on("progress", (job, progress) => {
  io.emit("jobProgress", {
    jobId: job.id,
    progress,
    timestamp: new Date(),
  });
});

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Fetch MySQL emails with pagination
  socket.on("getMysqlEmails", async ({ page = 1, limit = 12 }) => {
    try {
      const offset = (page - 1) * limit;

      // Get Data
      const [rows] = await connection.query(
        "SELECT * FROM emails ORDER BY id DESC LIMIT ? OFFSET ?",
        [limit, offset]
      );

      // Get Total Count
      const [countResult] = await connection.query("SELECT COUNT(*) as total FROM emails");
      const total = countResult[0].total;

      socket.emit("mysqlEmails", {
        emails: rows,
        total,
        totalPages: Math.ceil(total / limit),
        currentPage: page
      });
    } catch (err) {
      socket.emit("error", { source: "mysql", message: err.message });
    }
  });

  // Fetch MongoDB emails with pagination
  socket.on("getMongoEmails", async ({ page = 1, limit = 12 }) => {
    try {
      const skip = (page - 1) * limit;

      // Get Data
      const docs = await emailCollection
        .find({})
        .sort({ _id: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      // Get Total Count
      const total = await emailCollection.countDocuments();

      socket.emit("mongoEmails", {
        emails: docs,
        total,
        totalPages: Math.ceil(total / limit),
        currentPage: page
      });
    } catch (err) {
      socket.emit("error", { source: "mongo", message: err.message });
    }
  });

  // Send single email
  socket.on("sendEmail", async (data) => {
    try {
      const job = await emailQueue.add("sendEmailJob", data, {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: true
      });
      
      activeJobs.set(job.id, { type: "single", data });
      
      // Immediate acknowledgment
      socket.emit("emailQueued", { 
        jobId: job.id, 
        type: "single", 
        count: 1,
        timestamp: new Date()
      });
      
      // Broadcast to all clients
      socket.broadcast.emit("emailQueued", { 
        jobId: job.id, 
        type: "single", 
        count: 1,
        timestamp: new Date()
      });
    } catch (err) {
      socket.emit("error", { source: "queue", message: err.message });
    }
  });

  // Send bulk emails
  socket.on("sendBulkEmails", async (data) => {
    if (!data.emails || !Array.isArray(data.emails) || data.emails.length === 0) {
      socket.emit("error", { source: "bulk", message: "No emails provided" });
      return;
    }
    
    try {
      const job = await emailQueue.add("sendBulkEmailsJob", { emails: data.emails }, {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: true
      });
      
      activeJobs.set(job.id, { type: "bulk", count: data.emails.length });
      
      // Immediate acknowledgment
      socket.emit("emailQueued", {
        jobId: job.id,
        type: "bulk",
        count: data.emails.length,
        timestamp: new Date()
      });
      
      // Broadcast to all clients
      socket.broadcast.emit("emailQueued", {
        jobId: job.id,
        type: "bulk",
        count: data.emails.length,
        timestamp: new Date()
      });
    } catch (err) {
      socket.emit("error", { source: "queue", message: err.message });
    }
  });

  // Get active jobs
  socket.on("getActiveJobs", () => {
    const jobs = Array.from(activeJobs.entries()).map(([id, data]) => ({ id, ...data }));
    socket.emit("activeJobs", jobs);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

server.listen(5050, () => {
  console.log("✅ Server running on http://localhost:5050");
});