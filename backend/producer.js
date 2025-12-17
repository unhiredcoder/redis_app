
import { Queue } from "bullmq";

// Common Redis connection
const redisConnection = {
  host: "10.10.15.140",
  port: 6379
};

export const emailQueue = new Queue("emailQueue", { connection: redisConnection });

export const dlqQueue = new Queue("emailQueue-dlq", { connection: redisConnection });