import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import { emailQueue } from "./producer.js";
import pkg from 'pg';
const { Pool } = pkg;
import { emailCollection } from "./mongo_db.js";
import dotenv from "dotenv";
import redis from "./redis_client.js";

dotenv.config();

const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.get("/health", async (req, res) => {
  try {
    await Promise.all([
      pgPool.query("SELECT 1"),
      redis.ping(),
    ]);

    res.status(200).json({
      status: "All services are healthy"
    });

  } catch (err) {
    console.error("Health check failed:", err);

    res.status(500).json({
      status: "unhealthy",
      error: err.message
    });
  }
});

io.on("connection", (socket) => {
  // Handle requests for "MySQL" (Postgres) data from frontend
  socket.on("getMysqlEmails", async ({ page = 1, limit = 12 }) => {
    const offset = (page - 1) * limit;
    const result = await pgPool.query("SELECT * FROM emails ORDER BY id DESC LIMIT $1 OFFSET $2", [limit, offset]);
    const countRes = await pgPool.query("SELECT COUNT(*) FROM emails");
    
    socket.emit("mysqlEmails", {
      emails: result.rows,
      total: parseInt(countRes.rows[0].count),
      totalPages: Math.ceil(parseInt(countRes.rows[0].count) / limit)
    });
  });

  socket.on("getMongoEmails", async ({ page = 1, limit = 12 }) => {
    const skip = (page - 1) * limit;
    const emails = await emailCollection.find().sort({ _id: -1 }).skip(skip).limit(limit).toArray();
    const total = await emailCollection.countDocuments();
    
    socket.emit("mongoEmails", {
      emails,
      total,
      totalPages: Math.ceil(total / limit)
    });
  });

  socket.on("sendEmail", async (data) => {
    const job = await emailQueue.add("sendEmailJob", data);
    socket.emit("emailQueued", { jobId: job.id, type: "single" });
  });

  socket.on("sendBulkEmails", async (data) => {
    // Adding each email as a separate job to the queue for better processing
    for (const emailData of data.emails) {
      await emailQueue.add("sendEmailJob", emailData);
    }
    socket.emit("emailQueued", { type: "bulk", count: data.emails.length });
  });
});

server.listen(process.env.PORT || 5050, () => console.log("✅ Server on 5050"));