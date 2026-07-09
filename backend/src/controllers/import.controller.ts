import { Request, Response } from 'express';
import { CsvService } from '../services/csv.service.js';
import { LeadService } from '../services/lead.service.js';
import { QueueService } from '../services/queue.service.js';
import { prisma } from '../config/db.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Temporary in-memory store for parsed CSV rows awaiting user confirmation.
 * Key: runId, Value: valid rows array
 * Entries are cleaned up after confirmation or on server restart.
 */
const pendingRowsStore = new Map<string, any[]>();

export class ImportController {
  /**
   * Upload CSV file, parse locally, store PENDING state in DB.
   * Does NOT publish to worker queue yet - waits for user confirmation.
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
      const { valid, skippedCount } = CsvService.validateAndFilterRows(rawRows);

      // Create PENDING database record
      const run = await LeadService.createImportRun(req.file.originalname, rawRows.length);

      // Store the valid rows temporarily - waiting for user to confirm with (possibly pruned) rows
      pendingRowsStore.set(run.id, valid);

      // Return 202 Accepted with preview statistics (no queue publish yet)
      res.status(202).json({
        runId: run.id,
        fileName: run.fileName,
        totalRecords: rawRows.length,
        validCount: valid.length,
        skippedCount: skippedCount,
        previewRows: rawRows.slice(0, 50) // Show up to first 50 rows for preview
      });
    } catch (error: any) {
      console.error('Import upload error:', error);
      res.status(500).json({ error: error.message || 'Internal server error.' });
    }
  }

  /**
   * Confirm import: receive the final (possibly pruned) rows from frontend,
   * publish ONLY those rows to the worker queue.
   */
  public static async confirmImport(req: Request, res: Response): Promise<void> {
    try {
      const { runId } = req.params;
      const { rows: confirmedRows } = req.body;

      const run = await LeadService.getImportRunDetails(runId);
      if (!run) {
        res.status(404).json({ error: 'Import run not found.' });
        return;
      }

      // Use the confirmed (pruned) rows from frontend if provided, otherwise use stored valid rows
      const rowsToProcess: any[] = Array.isArray(confirmedRows) && confirmedRows.length >= 0
        ? confirmedRows
        : (pendingRowsStore.get(runId) || []);

      // Clean up the temp store
      pendingRowsStore.delete(runId);

      // Compute records skipped via preview pruning
      const initialSkipped = Math.max(0, run.totalRecords - rowsToProcess.length);
      await prisma.importRun.update({
        where: { id: runId },
        data: {
          skippedRecords: initialSkipped
        }
      });

      if (rowsToProcess.length === 0) {
        // User pruned everything - mark as completed with 0 records
        await LeadService.updateImportRunStatus(runId, 'COMPLETED');
        res.status(200).json({ success: true, message: 'Import confirmed with 0 records. Nothing to process.' });
        return;
      }

      // Now publish ONLY the confirmed rows to the worker queue
      const taskPayload = {
        runId,
        rows: rowsToProcess
      };


      await QueueService.publish('csv_imports', JSON.stringify(taskPayload));

      res.status(200).json({
        success: true,
        message: `Import confirmed. ${rowsToProcess.length} records queued for processing.`
      });
    } catch (error: any) {
      console.error('Import confirm error:', error);
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
