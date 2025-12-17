import { Worker } from "bullmq";
import { emailQueue } from "./producer.js";  // ✅ import the main queue

const dlqWorker = new Worker(
  "emailQueue-dlq",
  async (job) => {
    console.log(" DLQ processing job:", job.id, job.data);

    // Re-push to main queue with flag
    await emailQueue.add("sendEmailJob", { ...job.data, fromDlq: true }, {
      attempts: 1 // only retry once when coming from DLQ
    });
  },
  {
    connection: { host: "10.10.15.140", port: 6379 },
  }
);

dlqWorker.on("completed", (job) => {
  console.log(`✅ DLQ job ${job.id} requeued to main`);
});
