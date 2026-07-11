import express from 'express';
import cors from 'cors';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { ImportController } from './controllers/import.controller.js';
import { LeadService } from './services/lead.service.js';
import { prisma } from './config/db.js';

const app = express();
app.set('trust proxy', 1);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP, please try again later.' }
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Upload limit exceeded. Please wait 15 minutes.' }
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use('/api/', apiLimiter);

LeadService.cleanupStuckRuns();
LeadService.syncExistingImportStats();

app.get('/api/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: 'ok', database: 'connected' });
  } catch (err: any) {
    console.error('Health check failed:', err);
    res.status(500).json({ status: 'error', error: err?.message || 'Database connection error' });
  }
});
app.post('/api/imports/upload', uploadLimiter, upload.single('file'), ImportController.uploadCsv);
app.post('/api/imports/:runId/confirm', uploadLimiter, ImportController.confirmImport);
app.get('/api/imports/:runId/progress', ImportController.getProgressStream);
app.get('/api/imports/history', ImportController.getHistory);
app.get('/api/imports/:id', ImportController.getRunDetails);
app.get('/api/leads', ImportController.getLeadsPaginated);
app.delete('/api/leads/:id', ImportController.deleteLead);

export default app;
