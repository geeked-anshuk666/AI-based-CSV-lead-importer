import { Request, Response } from 'express';
import { CsvService } from '../services/csv.service.js';
import { LeadService } from '../services/lead.service.js';
import { QueueService } from '../services/queue.service.js';
import dotenv from 'dotenv';

dotenv.config();

export class ImportController {
  /**
   * Upload CSV file, parse locally, store PENDING state in DB, publish to Redis Pub/Sub.
   */
  public static async uploadCsv(req: Request, res: Response): Promise<void> {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No CSV file uploaded.' });
        return;
      }

      const csvText = req.file.buffer.toString('utf-8');
      const rawRows = await CsvService.parseCsv(csvText);

      if (rawRows.length === 0) {
        res.status(400).json({ error: 'Uploaded CSV file is empty.' });
        return;
      }

      // Early validating filter: filter out rows containing neither email nor mobile/phone key/value.
      // This helps frontend stats and prevents submitting useless records to the LLM.
      const { valid, skippedCount } = CsvService.validateAndFilterRows(rawRows);

      // Create PENDING database record
      const run = await LeadService.createImportRun(req.file.originalname, rawRows.length);

      // Publish task message to workers
      const taskPayload = {
        runId: run.id,
        rows: valid
      };

      await QueueService.publish('csv_imports', JSON.stringify(taskPayload));

      // Return 202 Accepted with preview statistics
      res.status(202).json({
        runId: run.id,
        fileName: run.fileName,
        totalRecords: rawRows.length,
        validCount: valid.length,
        skippedCount: skippedCount,
        previewRows: rawRows.slice(0, 10) // Show up to first 10 rows in frontend preview
      });
    } catch (error: any) {
      console.error('Import upload error:', error);
      res.status(500).json({ error: error.message || 'Internal server error.' });
    }
  }

  /**
   * Stream progress updates via Server-Sent Events (SSE) using Redis Pub/Sub.
   */
  public static async getProgressStream(req: Request, res: Response): Promise<void> {
    const { runId } = req.params;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    console.log(`SSE Client connected to import run: ${runId}`);

    // Subscribe to progress events channel via QueueService
    const unsubscribe = await QueueService.subscribe(`import_progress:${runId}`, (message) => {
      res.write(`data: ${message}\n\n`);
    });

    // Clean up connections when client disconnects
    req.on('close', async () => {
      console.log(`SSE Client disconnected from import run: ${runId}`);
      await unsubscribe();
    });
  }

  /**
   * Get history of all import runs.
   */
  public static async getHistory(req: Request, res: Response): Promise<void> {
    try {
      const runs = await LeadService.getImportRuns();
      res.status(200).json(runs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Get specific run detail details.
   */
  public static async getRunDetails(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const run = await LeadService.getImportRunDetails(id);
      if (!run) {
        res.status(404).json({ error: 'Import run not found.' });
        return;
      }
      res.status(200).json(run);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  public static async deleteLead(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      await LeadService.deleteLead(id);
      res.status(200).json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}
