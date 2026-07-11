import app from './app.js';
import { connectDb } from './config/db.js';
import { connectRedis } from './config/redis.js';
import { QueueService } from './services/queue.service.js';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 5000;

async function startServer() {
  await connectDb();

  try {
    if (process.env.REDIS_URL) {
      await connectRedis();
    }
  } catch (err) {
    console.warn('Redis client setup skipped/failed:', err);
  }

  await QueueService.initialize();
  await import('./worker/worker.js');

  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
