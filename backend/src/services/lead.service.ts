import { prisma } from '../config/db.js';
import { Prisma } from '@prisma/client';

export class LeadService {
  public static async createImportRun(fileName: string, totalRecords: number) {
    return await prisma.importRun.create({
      data: {
        fileName,
        totalRecords,
        status: 'PENDING',
        processedRecords: 0,
        skippedRecords: 0
      }
    });
  }

  public static async updateImportRunStatus(id: string, status: string) {
    return await prisma.importRun.update({
      where: { id },
      data: { status }
    });
  }

  public static async incrementImportCounts(id: string, processedCount: number, skippedCount: number) {
    return await prisma.importRun.update({
      where: { id },
      data: {
        processedRecords: { increment: processedCount },
        skippedRecords: { increment: skippedCount }
      }
    });
  }

  public static async saveLeadsBatch(importId: string, leads: any[]) {
    // 1. Gather all emails and mobile numbers to query in one round-trip
    const emails = leads.map(l => l.email).filter(Boolean) as string[];
    const phones = leads.map(l => l.mobile_without_country_code).filter(Boolean) as string[];

    // 2. Fetch all existing leads that match any email or phone in this batch
    const existingLeads = await prisma.lead.findMany({
      where: {
        OR: [
          ...(emails.length > 0 ? [{ email: { in: emails } }] : []),
          ...(phones.length > 0 ? [{ mobileWithoutCountryCode: { in: phones } }] : [])
        ]
      }
    });

    // Build a fast lookup map: email → existing lead, phone → existing lead
    const byEmail = new Map(existingLeads.filter(l => l.email).map(l => [l.email!.toLowerCase(), l]));
    const byPhone = new Map(existingLeads.filter(l => l.mobileWithoutCountryCode).map(l => [l.mobileWithoutCountryCode!, l]));

    const toCreate: Prisma.LeadCreateManyInput[] = [];
    // Updates must remain individual due to field-level merging logic
    const updatePromises: Promise<any>[] = [];

    for (const lead of leads) {
      // Find a matching existing record (email takes priority over phone)
      const matched =
        (lead.email && byEmail.get(lead.email.toLowerCase())) ||
        (lead.mobile_without_country_code && byPhone.get(lead.mobile_without_country_code)) ||
        null;

      const leadData = {
        importId,
        name: lead.name || (matched ? matched.name : null),
        email: lead.email || (matched ? matched.email : null),
        countryCode: lead.country_code || (matched ? matched.countryCode : null),
        mobileWithoutCountryCode: lead.mobile_without_country_code || (matched ? matched.mobileWithoutCountryCode : null),
        company: lead.company || (matched ? matched.company : null),
        city: lead.city || (matched ? matched.city : null),
        state: lead.state || (matched ? matched.state : null),
        country: lead.country || (matched ? matched.country : null),
        leadOwner: lead.lead_owner || (matched ? matched.leadOwner : null),
        crmStatus: lead.crm_status || (matched ? matched.crmStatus : 'GOOD_LEAD_FOLLOW_UP'),
        crmNote: lead.crm_note || (matched ? matched.crmNote : null),
        dataSource: lead.data_source || (matched ? matched.dataSource : null),
        possessionTime: lead.possession_time || (matched ? matched.possessionTime : null),
        description: lead.description || (matched ? matched.description : null)
      };

      if (matched) {
        // Queue update (individual — needs field-level merge & old-run decrement)
        const oldImportId = matched.importId;
        updatePromises.push(
          prisma.lead.update({
            where: { id: matched.id },
            data: {
              ...leadData,
              updatedAt: new Date()
            }
          }).then(async () => {
            if (oldImportId && oldImportId !== importId) {
              try {
                await prisma.importRun.update({
                  where: { id: oldImportId },
                  data: { processedRecords: { decrement: 1 } }
                });
              } catch (err) {
                console.error(`Failed to decrement processedRecords for old run ${oldImportId}:`, err);
              }
            }
          })
        );
      } else {
        // Accumulate new leads for a single bulk insert
        toCreate.push({
          ...leadData,
          createdAt: lead.created_at ? new Date(lead.created_at) : new Date()
        });
      }
    }

    // 3. Bulk-insert all new leads in one DB round-trip
    if (toCreate.length > 0) {
      await prisma.lead.createMany({ data: toCreate, skipDuplicates: true });
    }

    // 4. Run all updates concurrently (typically a small fraction of the batch)
    if (updatePromises.length > 0) {
      await Promise.allSettled(updatePromises);
    }

    return { count: leads.length };
  }

  public static async getImportRuns() {
    return await prisma.importRun.findMany({
      orderBy: { createdAt: 'desc' }
    });
  }

  public static async getImportRunDetails(id: string) {
    return await prisma.importRun.findUnique({
      where: { id },
      include: {
        leads: true
      }
    });
  }

  public static async deleteLead(id: string) {
    const lead = await prisma.lead.findUnique({
      where: { id },
      select: { importId: true }
    });
    if (lead && lead.importId) {
      const parentRun = await prisma.importRun.findUnique({
        where: { id: lead.importId },
        include: { leads: true }
      });
      if (parentRun) {
        if (parentRun.leads.length <= 1) {
          // Parent run has only 1 lead left (this one) - delete the run which cascades to the lead
          await prisma.importRun.delete({
            where: { id: lead.importId }
          });
          return { id };
        } else {
          await prisma.importRun.update({
            where: { id: lead.importId },
            data: {
              processedRecords: { decrement: 1 }
            }
          });
        }
      }
    }
    return await prisma.lead.delete({
      where: { id }
    });
  }

  public static async cleanupStuckRuns() {
    try {
      const result = await prisma.importRun.updateMany({
        where: { status: 'PROCESSING' },
        data: { status: 'FAILED' }
      });
      if (result.count > 0) {
        console.log(`[Startup Cleanup] Marked ${result.count} stuck PROCESSING runs as FAILED.`);
      }
    } catch (err) {
      console.error('[Startup Cleanup] Failed to clean stuck runs:', err);
    }
  }

  /**
   * Self-healing method: Iterates through all historical completed import runs,
   * counts the actual leads stored in the DB, and fixes processed/skipped counts
   * so they are 100% accurate.
   */
  public static async syncExistingImportStats() {
    try {
      const completedRuns = await prisma.importRun.findMany({
        where: { status: 'COMPLETED' },
        include: {
          _count: {
            select: { leads: true }
          }
        }
      });

      let updatedCount = 0;
      for (const run of completedRuns) {
        const actualProcessed = run._count.leads;
        const actualSkipped = Math.max(0, run.totalRecords - actualProcessed);

        if (run.processedRecords !== actualProcessed || run.skippedRecords !== actualSkipped) {
          await prisma.importRun.update({
            where: { id: run.id },
            data: {
              processedRecords: actualProcessed,
              skippedRecords: actualSkipped
            }
          });
          updatedCount++;
        }
      }

      if (updatedCount > 0) {
        console.log(`[Startup Self-Healing] Synced stats for ${updatedCount} historical import runs.`);
      }
    } catch (err) {
      console.error('[Startup Self-Healing] Failed to sync historical run stats:', err);
    }
  }
}

