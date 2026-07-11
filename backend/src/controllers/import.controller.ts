import { Request, Response } from 'express';
import { CsvService } from '../services/csv.service.js';
import { LeadService } from '../services/lead.service.js';
import { QueueService } from '../services/queue.service.js';
import { prisma } from '../config/db.js';
import dotenv from 'dotenv';

dotenv.config();

const pendingRowsStore = new Map<string, any[]>();
const MAX_PENDING_ROWS = 100_000;
const confirmLocks = new Set<string>();
const PENDING_RUN_TTL_MS = 30 * 60 * 1000;

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
      staleIds.forEach(id => pendingRowsStore.delete(id));
      console.log(`[Cleanup] Deleted ${staleRuns.length} stale PENDING import runs.`);
    }
  } catch (err) {
    console.error('[Cleanup] Error during stale run cleanup:', err);
  }
}, 10 * 60 * 1000);

export class ImportController {
  public static async uploadCsv(req: Request, res: Response): Promise<void> {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No CSV file uploaded.' });
        return;
      }

      const rawText = req.file.buffer.toString('utf-8');
      const csvText = CsvService.sanitizeCsvText(rawText);
      const rawRows = await CsvService.parseCsv(csvText);

      if (rawRows.length === 0) {
        res.status(400).json({ error: 'Uploaded CSV file is empty or contained no readable rows.' });
        return;
      }

      if (rawRows.length > MAX_PENDING_ROWS) {
        res.status(413).json({
          error: `CSV file contains ${rawRows.length.toLocaleString()} rows, which exceeds the maximum of ${MAX_PENDING_ROWS.toLocaleString()} rows per import. Please split the file into smaller chunks.`
        });
        return;
      }

      if (rawRows.length > 10_000) {
        console.warn(`[Large Import] ${rawRows.length} rows from "${req.file.originalname}".`);
      }

      const { valid, skippedCount } = CsvService.validateAndFilterRows(rawRows);
      const run = await LeadService.createImportRun(req.file.originalname, rawRows.length);
      pendingRowsStore.set(run.id, valid);

      res.status(202).json({
        runId: run.id,
        fileName: run.fileName,
        totalRecords: rawRows.length,
        validCount: valid.length,
        skippedCount: skippedCount,
        previewRows: valid.slice(0, 10)
      });
    } catch (error: any) {
      console.error('Import upload error:', error);
      res.status(500).json({ error: error.message || 'Internal server error.' });
    }
  }

  public static async confirmImport(req: Request, res: Response): Promise<void> {
    try {
      const { runId } = req.params;
      const { excludedIndices } = req.body;

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

        if (run.status !== 'PENDING') {
          res.status(409).json({
            error: `Import run is already in status "${run.status}". Cannot confirm again.`
          });
          return;
        }

        const allStoredRows = pendingRowsStore.get(runId) || [];
        let rowsToProcess = allStoredRows;
        if (Array.isArray(excludedIndices) && excludedIndices.length > 0) {
          const excludeSet = new Set(excludedIndices);
          rowsToProcess = allStoredRows.filter((_, idx) => !excludeSet.has(idx));
        }

        pendingRowsStore.delete(runId);

        if (rowsToProcess.length === 0) {
          await prisma.importRun.delete({ where: { id: runId } });
          res.status(200).json({
            success: true,
            message: 'Import confirmed with 0 records. Run deleted to keep logs clean.'
          });
          return;
        }

        const initialSkipped = Math.max(0, run.totalRecords - rowsToProcess.length);
        await prisma.importRun.update({
          where: { id: runId },
          data: { skippedRecords: initialSkipped }
        });

        const taskPayload = { runId, rows: rowsToProcess };
        await QueueService.publish('csv_imports', JSON.stringify(taskPayload));

        res.status(200).json({
          success: true,
          message: `Import confirmed. ${rowsToProcess.length} records queued for processing.`
        });
      } finally {
        confirmLocks.delete(runId);
      }
    } catch (error: any) {
      console.error('Import confirm error:', error);
      res.status(500).json({ error: error.message || 'Internal server error.' });
    }
  }

  public static async getProgressStream(req: Request, res: Response): Promise<void> {
    const { runId } = req.params;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    console.log(`SSE Client connected to import run: ${runId}`);

    const unsubscribe = await QueueService.subscribe(`import_progress:${runId}`, (message) => {
      res.write(`data: ${message}\n\n`);
    });

    req.on('close', async () => {
      console.log(`SSE Client disconnected from import run: ${runId}`);
      await unsubscribe();
    });
  }

  public static async getHistory(req: Request, res: Response): Promise<void> {
    try {
      const runs = await LeadService.getImportRuns();
      res.status(200).json(runs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

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

  public static async getLeadsPaginated(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const search = (req.query.search as string) || '';
      const status = (req.query.status as string) || 'ALL';

      const skip = (page - 1) * limit;

      const where: any = {};
      if (status && status !== 'ALL') {
        where.crmStatus = status;
      }
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { mobileWithoutCountryCode: { contains: search, mode: 'insensitive' } },
          { company: { contains: search, mode: 'insensitive' } },
          { city: { contains: search, mode: 'insensitive' } },
          { state: { contains: search, mode: 'insensitive' } },
          { country: { contains: search, mode: 'insensitive' } }
        ];
      }

      const [leads, totalFilteredCount, totalUniqueCount] = await Promise.all([
        prisma.lead.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' }
        }),
        prisma.lead.count({ where }),
        prisma.lead.count()
      ]);

      res.status(200).json({
        leads,
        totalUniqueCount,
        totalFilteredCount,
        page,
        limit
      });
    } catch (error: any) {
      console.error('Failed to query paginated leads:', error);
      res.status(500).json({ error: error.message || 'Internal server error.' });
    }
  }
}
