import { connectDb } from '../config/db.js';
import { LeadService } from '../services/lead.service.js';
import { AiService } from '../services/ai.service.js';
import { QueueService } from '../services/queue.service.js';
import { prisma } from '../config/db.js';
import dotenv from 'dotenv';

dotenv.config();

// Each AI call handles up to BATCH_SIZE rows.
// PARALLEL_BATCHES batches are fired concurrently to maximise free-tier throughput.
const BATCH_SIZE = 150;
const PARALLEL_BATCHES = 3;

async function startWorker() {
  await connectDb();

  console.log('Worker listening on channel "csv_imports"...');

  await QueueService.subscribe('csv_imports', async (message) => {
    try {
      const task = JSON.parse(message);
      const { runId, rows } = task;

      console.log(`Starting execution for Import Run: ${runId} with ${rows.length} rows`);
      await LeadService.updateImportRunStatus(runId, 'PROCESSING');

      let processedCount = 0;
      let totalSkipped = 0;
      let aiExhausted = false;

      // For very small files use smaller batches so progress feels responsive.
      // For larger files use full BATCH_SIZE to minimise the number of AI round-trips.
      const effectiveBatchSize = rows.length < 30
        ? Math.max(1, Math.ceil(rows.length / 5))
        : BATCH_SIZE;

      // Build the list of all batch start-indices upfront
      const batchStarts: number[] = [];
      for (let i = 0; i < rows.length; i += effectiveBatchSize) {
        batchStarts.push(i);
      }

      // Process PARALLEL_BATCHES batches at a time.
      // Promise.allSettled is used so a single bad batch does not abort the others.
      for (let g = 0; g < batchStarts.length; g += PARALLEL_BATCHES) {
        if (aiExhausted) break;

        const group = batchStarts.slice(g, g + PARALLEL_BATCHES);

        const groupResults = await Promise.allSettled(
          group.map(async (startIdx) => {
            const batch = rows.slice(startIdx, startIdx + effectiveBatchSize);
            const mappedLeads = await AiService.mapLeadsBatch(batch);
            if (mappedLeads.length > 0) {
              await LeadService.saveLeadsBatch(runId, mappedLeads);
            }
            return { batch, mappedLeads };
          })
        );

        // Aggregate results from this parallel group
        let groupProcessed = 0;
        let groupSkipped = 0;

        for (const result of groupResults) {
          if (result.status === 'fulfilled') {
            const { batch, mappedLeads } = result.value;
            groupProcessed += mappedLeads.length;
            groupSkipped += batch.length - mappedLeads.length;
          } else {
            // Rejected batch
            const errMsg = result.reason?.message || String(result.reason);
            console.error(`Batch in group ${g} failed:`, errMsg);

            // EC10: Detect AI quota/key exhaustion — fail the entire run
            const isAiExhaustion =
              errMsg.includes('All AI Mapping services exhausted') ||
              errMsg.includes('quota') ||
              errMsg.includes('429') ||
              errMsg.includes('rate limit');

            if (isAiExhaustion) {
              aiExhausted = true;
              console.error(`[EC10] AI key quota exhausted for run ${runId}. Marking as FAILED.`);

              const remainingRows = rows.length - (g * effectiveBatchSize);
              await prisma.importRun.update({
                where: { id: runId },
                data: {
                  status: 'FAILED',
                  skippedRecords: { increment: remainingRows }
                }
              });

              await QueueService.publish(
                `import_progress:${runId}`,
                JSON.stringify({
                  status: 'FAILED',
                  progress: Math.round((g * effectiveBatchSize / rows.length) * 100),
                  processed: processedCount,
                  skipped: totalSkipped + remainingRows,
                  error: 'AI mapping service quota exhausted. Check your API key limits and try again.'
                })
              );
              return; // Exit the subscriber handler
            }

            // Non-quota batch error: count all rows in the failed batch as skipped
            // Find the original batch to know how many rows were in it
            const failedBatchIdx = group[groupResults.indexOf(result)];
            const failedBatch = rows.slice(failedBatchIdx, failedBatchIdx + effectiveBatchSize);
            groupSkipped += failedBatch.length;
          }
        }

        processedCount += groupProcessed;
        totalSkipped += groupSkipped;

        // One DB write to update counts for the whole parallel group
        await LeadService.incrementImportCounts(runId, groupProcessed, groupSkipped);

        // Progress = rows completed so far / total rows
        const completedRows = Math.min(
          (g + group.length) * effectiveBatchSize,
          rows.length
        );
        const progressPercent = Math.round((completedRows / rows.length) * 100);

        await QueueService.publish(
          `import_progress:${runId}`,
          JSON.stringify({
            status: 'PROCESSING',
            progress: progressPercent,
            processed: processedCount,
            skipped: totalSkipped
          })
        );
      }

      // Only mark as COMPLETED if AI was not exhausted mid-run
      if (!aiExhausted) {
        await LeadService.updateImportRunStatus(runId, 'COMPLETED');
        await QueueService.publish(
          `import_progress:${runId}`,
          JSON.stringify({
            status: 'COMPLETED',
            progress: 100,
            processed: processedCount,
            skipped: totalSkipped
          })
        );
        console.log(`Finished processing Import Run: ${runId}`);
      }
    } catch (err) {
      console.error('Error in subscriber loop:', err);
    }
  });
}

startWorker().catch((err) => {
  console.error('Worker failed to start:', err);
});
