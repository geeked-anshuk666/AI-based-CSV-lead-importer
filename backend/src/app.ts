import express from 'express';
import cors from 'cors';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { ImportController } from './controllers/import.controller.js';
import { LeadService } from './services/lead.service.js';

const app = express();

// Secure file size upload limits to protect server memory (25MB is more than enough for 100K+ leads)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

// Configure API Rate Limiting to prevent DoS attacks / resource exhaustion
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP, please try again later.' }
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 upload/confirm requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Upload limit exceeded. Please wait 15 minutes.' }
});

app.use(cors());
app.use(express.json());
app.use('/api/', apiLimiter);

// Clean up any dangling runs stuck in PROCESSING status on server boot (Edge Case 3)
LeadService.cleanupStuckRuns();
// Sync stats of completed runs to match actual leads in DB (self-healing)
LeadService.syncExistingImportStats();

// Routes definition
app.post('/api/imports/upload', uploadLimiter, upload.single('file'), ImportController.uploadCsv);
app.post('/api/imports/:runId/confirm', uploadLimiter, ImportController.confirmImport);
app.get('/api/imports/:runId/progress', ImportController.getProgressStream);
app.get('/api/imports/history', ImportController.getHistory);
app.get('/api/imports/:id', ImportController.getRunDetails);
app.delete('/api/leads/:id', ImportController.deleteLead);

export default app;
