import app from './app.js';
import { connectDb } from './config/db.js';
import { connectRedis } from './config/redis.js';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 5000;

async function startServer() {
  // Establish configurations and services
  await connectDb();
  await connectRedis();

  // Start background worker subscription logic in the same process
  await import('./worker/worker.js');

  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
