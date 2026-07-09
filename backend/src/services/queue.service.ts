import { createClient } from 'redis';
import { EventEmitter } from 'events';
import dotenv from 'dotenv';

dotenv.config();

class QueueServiceImpl {
  private redisEnabled: boolean = false;
  private emitter = new EventEmitter();
  private redisUrl = process.env.REDIS_URL;
  private pubClient: any = null;
  private subClient: any = null;

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  public async initialize(): Promise<void> {
    if (this.redisUrl) {
      try {
        console.log('Connecting to Redis for Queue...');
        this.pubClient = createClient({ url: this.redisUrl });
        this.subClient = createClient({ url: this.redisUrl });
        
        await this.pubClient.connect();
        await this.subClient.connect();
        this.redisEnabled = true;
        console.log('Redis Queue Service initialized successfully.');
      } catch (err) {
        console.warn('Redis connection failed, falling back to local memory queue:', err);
        this.redisEnabled = false;
      }
    } else {
      console.log('No REDIS_URL provided. Using local memory queue.');
      this.redisEnabled = false;
    }
  }

  public async publish(channel: string, message: string): Promise<void> {
    if (this.redisEnabled && this.pubClient) {
      await this.pubClient.publish(channel, message);
    } else {
      this.emitter.emit(channel, message);
    }
  }

  public async subscribe(channel: string, callback: (message: string) => void): Promise<() => void> {
    if (this.redisEnabled && this.subClient) {
      const subConn = createClient({ url: this.redisUrl });
      await subConn.connect();
      await subConn.subscribe(channel, (message) => {
        callback(message);
      });
      return async () => {
        await subConn.unsubscribe(channel);
        await subConn.disconnect();
      };
    } else {
      this.emitter.on(channel, callback);
      return () => {
        this.emitter.off(channel, callback);
      };
    }
  }
}

export const QueueService = new QueueServiceImpl();
