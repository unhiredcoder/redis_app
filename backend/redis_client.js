import Redis from 'ioredis';
import dotenv from "dotenv";

dotenv.config();

// Upstash works best with a single shared connection
const redisConfig = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

const redis = new Redis(process.env.REDIS_URL, redisConfig);

redis.on("error", (err) => console.error("Redis Error:", err));
redis.on("connect", () => console.log("✅ Shared Redis Connected"));

export default redis;