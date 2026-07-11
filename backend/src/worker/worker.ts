import { connectDb } from '../config/db.js';
import { LeadService } from '../services/lead.service.js';
import { AiService } from '../services/ai.service.js';
import { QueueService } from '../services/queue.service.js';
import { prisma } from '../config/db.js';
import dotenv from 'dotenv';

dotenv.config();

const BATCH_SIZE = 50;
const PARALLEL_BATCHES = 1;

async function startWorker() {
  await connectDb();

  console.log('Worker listening on channel "csv_imports"...');

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  await QueueService.subscribe('csv_imports', async (message) => {
    try {
      const task = JSON.parse(message);
      const { runId, rows } = task;

      console.log(`Starting execution for Import Run: ${runId} with ${rows.length} rows`);
      await LeadService.updateImportRunStatus(runId, 'PROCESSING');

      let processedCount = 0;
      let totalSkipped = 0;
      let aiExhausted = false;
      let preferredModel: string | undefined = undefined;

      const effectiveBatchSize = rows.length < 30
        ? Math.max(1, Math.ceil(rows.length / 5))
        : BATCH_SIZE;

      const batchStarts: number[] = [];
      for (let i = 0; i < rows.length; i += effectiveBatchSize) {
        batchStarts.push(i);
      }

      const totalGroups = Math.ceil(batchStarts.length / PARALLEL_BATCHES);
      const targetGroupDurationMs = 5000;

      for (let g = 0; g < batchStarts.length; g += PARALLEL_BATCHES) {
        if (aiExhausted) break;

        const groupStartTime = Date.now();
        const currentGroupIndex = g / PARALLEL_BATCHES;
        const remainingGroups = totalGroups - (currentGroupIndex + 1);

        const estimatedTimeRemainingSeconds = preferredModel === 'GrowEasy Local Rule-Based Mapper'
          ? 0
          : remainingGroups * (targetGroupDurationMs / 1000);

        const group = batchStarts.slice(g, g + PARALLEL_BATCHES);

        const groupResults = await Promise.allSettled(
          group.map(async (startIdx) => {
            const batch = rows.slice(startIdx, startIdx + effectiveBatchSize);

            let mappedLeads: any[] = [];
            let retriesLeft = 3;

            while (retriesLeft >= 0) {
              try {
                const res = await AiService.mapLeadsBatch(
                  batch,
                  async (modelName, status, errorMsg) => {
                    await QueueService.publish(
                      `import_progress:${runId}`,
                      JSON.stringify({
                        status: 'MODEL_LOG',
                        model: modelName,
                        modelStatus: status,
                        error: errorMsg
                      })
                    );
                  },
                  preferredModel
                );
                mappedLeads = res.leads;
                preferredModel = res.modelUsed;
                break;
              } catch (err: any) {
                const errMsg = err?.message || String(err);
                const isRateLimit = errMsg.includes('quota') || errMsg.includes('429') || errMsg.includes('rate limit');

                if (isRateLimit && retriesLeft > 0) {
                  console.warn(`Rate limit hit. Retrying in 8s... (${retriesLeft} retries left)`);
                  retriesLeft--;
                  await sleep(8000);
                } else {
                  throw err;
                }
              }
            }

            if (mappedLeads.length > 0) {
              await LeadService.saveLeadsBatch(runId, mappedLeads);
            }
            return { batch, mappedLeads };
          })
        );

        let groupProcessed = 0;
        let groupSkipped = 0;

        for (const result of groupResults) {
          if (result.status === 'fulfilled') {
            const { batch, mappedLeads } = result.value;
            groupProcessed += mappedLeads.length;
            groupSkipped += batch.length - mappedLeads.length;
          } else {
            const errMsg = result.reason?.message || String(result.reason);
            console.error(`Batch in group ${g} failed:`, errMsg);

            const isAiExhaustion =
              errMsg.includes('All AI Mapping services exhausted') ||
              errMsg.includes('quota') ||
              errMsg.includes('429') ||
              errMsg.includes('rate limit');

            if (isAiExhaustion) {
              aiExhausted = true;
              console.error(`AI quota exhausted for run ${runId}. Marking as FAILED.`);

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
              return;
            }

            const failedBatchIdx = group[groupResults.indexOf(result)];
            const failedBatch = rows.slice(failedBatchIdx, failedBatchIdx + effectiveBatchSize);
            groupSkipped += failedBatch.length;
          }
        }

        processedCount += groupProcessed;
        totalSkipped += groupSkipped;

        await LeadService.incrementImportCounts(runId, groupProcessed, groupSkipped);

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
            skipped: totalSkipped,
            estimatedTimeRemainingSeconds: Math.round(estimatedTimeRemainingSeconds)
          })
        );

        const groupDuration = Date.now() - groupStartTime;
        const targetDuration = preferredModel === 'GrowEasy Local Rule-Based Mapper' ? 0 : targetGroupDurationMs;
        if (groupDuration < targetDuration && g + PARALLEL_BATCHES < batchStarts.length) {
          const sleepDuration = targetDuration - groupDuration;
          console.log(`Group done in ${Math.round(groupDuration/1000)}s. Throttling ${Math.round(sleepDuration/1000)}s.`);
          await sleep(sleepDuration);
        }
      }

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
