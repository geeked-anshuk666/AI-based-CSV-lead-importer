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

/**
 * EC9: Maximum number of rows we hold in memory per pending import.
 * For files with more rows than this, we still parse them all but only
 * store the first MAX_PENDING_ROWS for the in-memory preview/confirm flow.
 * The full row count is still recorded in the DB for stats accuracy.
 * 100,000 rows at ~300 bytes each = ~30MB. With 25MB file limit, this is safe.
 */
const MAX_PENDING_ROWS = 100_000;

/**
 * EC5: In-process lock map to prevent double-confirm race conditions.
 * When a confirm request is being processed, the runId is locked.
 * Any concurrent confirm for the same runId is rejected with 409.
 */
const confirmLocks = new Set<string>();

/**
 * EC7: Track PENDING runs that were uploaded but never confirmed.
 * We clean these up after a configurable TTL (default 30 minutes).
 */
const PENDING_RUN_TTL_MS = 30 * 60 * 1000; // 30 minutes

/** Schedule periodic cleanup of stale PENDING runs every 10 minutes */
setInterval(async () => {
  try {
    const cutoff = new Date(Date.now() - PENDING_RUN_TTL_MS);
    const staleRuns = await prisma.importRun.findMany({
      where: {
        status: 'PENDING',
        createdAt: { lt: cutoff }
      },
      select: { id: true }
    });

    if (staleRuns.length > 0) {
      const staleIds = staleRuns.map(r => r.id);
      await prisma.importRun.deleteMany({
        where: { id: { in: staleIds } }
      });
      // Clean up associated pending rows store
      staleIds.forEach(id => pendingRowsStore.delete(id));
      console.log(`[EC7] Cleaned up ${staleRuns.length} stale PENDING import runs.`);
    }
  } catch (err) {
    console.error('[EC7] Error during stale run cleanup:', err);
  }
}, 10 * 60 * 1000); // Every 10 minutes

export class ImportController {
  /**
   * Upload CSV file, parse locally, store PENDING state in DB.
   * Does NOT publish to worker queue yet - waits for user confirmation.
   *
   * EC4: Strips UTF-8 BOM and sanitizes encoding before parsing.
   * EC6: Normalizes all CSV headers to lowercase snake_case at parse time.
   */
  public static async uploadCsv(req: Request, res: Response): Promise<void> {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No CSV file uploaded.' });
        return;
      }

      // EC4: Decode buffer with BOM stripping & encoding sanitization
      const rawText = req.file.buffer.toString('utf-8');
      const csvText = CsvService.sanitizeCsvText(rawText);

      // parseCsv already normalizes headers via mapHeaders (EC6)
      const rawRows = await CsvService.parseCsv(csvText);

      if (rawRows.length === 0) {
        res.status(400).json({ error: 'Uploaded CSV file is empty or contained no readable rows.' });
        return;
      }

      // EC9: Enforce row cap - reject files that exceed the max processable limit
      if (rawRows.length > MAX_PENDING_ROWS) {
        res.status(413).json({
          error: `CSV file contains ${rawRows.length.toLocaleString()} rows, which exceeds the maximum of ${MAX_PENDING_ROWS.toLocaleString()} rows per import. Please split the file into smaller chunks.`
        });
        return;
      }

      // EC9: Log a warning for large imports to help with monitoring
      if (rawRows.length > 10_000) {
        console.warn(`[EC9] Large import detected: ${rawRows.length} rows from file "${req.file.originalname}". Memory usage may spike.`);
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
   *
   * EC5: Uses a per-runId lock to prevent double-confirm race conditions
   *      (e.g. user double-clicking "Import" or having the page open in two tabs).
   * EC7: Auto-deletes empty PENDING runs where 0 records were confirmed.
   */
  public static async confirmImport(req: Request, res: Response): Promise<void> {
    try {
      const { runId } = req.params;
      const { rows: confirmedRows } = req.body;

      // EC5: Check and set lock to prevent concurrent confirm for same runId
      if (confirmLocks.has(runId)) {
        res.status(409).json({
          error: 'Import confirmation already in progress for this run. Please wait.'
        });
        return;
      }
      confirmLocks.add(runId);

      try {
        const run = await LeadService.getImportRunDetails(runId);
        if (!run) {
          res.status(404).json({ error: 'Import run not found.' });
          return;
        }

        // Only PENDING runs can be confirmed
        if (run.status !== 'PENDING') {
          res.status(409).json({
            error: `Import run is already in status "${run.status}". Cannot confirm again.`
          });
          return;
        }

        // Use the confirmed (pruned) rows from frontend if provided, otherwise use stored valid rows
        const rowsToProcess: any[] = Array.isArray(confirmedRows) && confirmedRows.length >= 0
          ? confirmedRows
          : (pendingRowsStore.get(runId) || []);

        // Clean up the temp store
        pendingRowsStore.delete(runId);

        // EC7: If user confirmed 0 rows, auto-delete the empty ImportRun (no point keeping it)
        if (rowsToProcess.length === 0) {
          await prisma.importRun.delete({ where: { id: runId } });
          console.log(`[EC7] Deleted empty ImportRun ${runId} - user confirmed 0 records.`);
          res.status(200).json({
            success: true,
            message: 'Import confirmed with 0 records. Run deleted to keep logs clean.'
          });
          return;
        }

        // Compute records skipped via preview pruning
        const initialSkipped = Math.max(0, run.totalRecords - rowsToProcess.length);
        await prisma.importRun.update({
          where: { id: runId },
          data: { skippedRecords: initialSkipped }
        });

        // Publish ONLY the confirmed rows to the worker queue
        const taskPayload = { runId, rows: rowsToProcess };
        await QueueService.publish('csv_imports', JSON.stringify(taskPayload));

        res.status(200).json({
          success: true,
          message: `Import confirmed. ${rowsToProcess.length} records queued for processing.`
        });
      } finally {
        // Always release the lock, even on error
        confirmLocks.delete(runId);
      }
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
