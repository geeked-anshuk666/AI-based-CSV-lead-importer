import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { ImportController } from './controllers/import.controller.js';

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB max limit to handle 100K+ leads
});

app.use(cors());
app.use(express.json());

// Routes definition
app.post('/api/imports/upload', upload.single('file'), ImportController.uploadCsv);
app.get('/api/imports/:runId/progress', ImportController.getProgressStream);
app.get('/api/imports/history', ImportController.getHistory);
app.get('/api/imports/:id', ImportController.getRunDetails);
app.delete('/api/leads/:id', ImportController.deleteLead);

export default app;
