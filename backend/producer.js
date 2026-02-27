import { Queue } from "bullmq";
import redis from "./redis_client.js";

// Use the same connection for all queues
export const emailQueue = new Queue("emailQueue", { connection: redis });
