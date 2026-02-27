# 📧 Real-Time Email Processing System

A scalable, non-blocking email delivery system built to handle bulk email workloads without server timeouts.

Sending one email is easy. Sending thousands reliably without blocking your server? That requires proper architecture.

This project solves concurrency and performance issues by offloading heavy email processing to background workers using Redis-powered queues.

---

## 🚀 Live Demo

👉 https://email-redis.vercel.app

---

## 🧠 Why This Project?

Traditional email sending in Node.js can block the main thread during high-volume operations, leading to:

- Server timeouts  
- Race conditions  
- Poor user feedback  
- Crashes under heavy load  

This system is designed to stay responsive even during bulk email processing.

---

## 🛠 Tech Stack

### Backend
- Node.js
- Express.js

### Queue & Background Jobs
- BullMQ
- Redis

### Real-Time Communication
- Socket.io (Live job status updates)

### Databases
- PostgreSQL (Structured logging & tracking)
- MongoDB (Flexible email storage)

### Process Management
- PM2 (Production monitoring & uptime)

---

## ✨ Features

- ✅ Single Email Sending
- ✅ Bulk Email Upload (CSV / JSON support)
- ✅ Background Job Processing (Non-blocking)
- ✅ Race Condition Handling via Socket Acknowledgments
- ✅ Real-Time Job Status Updates
- ✅ Connection Monitoring

---

## ⚙️ How It Works

1. User uploads email data (Single / CSV / JSON).
2. Data is pushed to a Redis queue.
3. BullMQ workers process emails in the background.
4. Status updates are emitted via Socket.io.
5. Logs are stored in PostgreSQL.
6. Email metadata is stored in MongoDB.

The main server remains free and responsive throughout the process.

---

## 📦 Installation

```bash
git clone https://github.com/unhiredcoder/redis_app.git
cd redis-app
npm install
