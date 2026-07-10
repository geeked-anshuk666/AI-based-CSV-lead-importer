import { prisma } from '../config/db.js';

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
    // Lead mapping parameters ensure standard fields.
    // Insert leads database records.
    const createData = leads.map(lead => ({
      importId,
      name: lead.name || null,
      email: lead.email || null,
      countryCode: lead.country_code || null,
      mobileWithoutCountryCode: lead.mobile_without_country_code || null,
      company: lead.company || null,
      city: lead.city || null,
      state: lead.state || null,
      country: lead.country || null,
      leadOwner: lead.lead_owner || null,
      crmStatus: lead.crm_status || 'GOOD_LEAD_FOLLOW_UP',
      crmNote: lead.crm_note || null,
      dataSource: lead.data_source || null,
      possessionTime: lead.possession_time || null,
      description: lead.description || null,
      createdAt: lead.created_at ? new Date(lead.created_at) : new Date()
    }));

    return await prisma.lead.createMany({
      data: createData
    });
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
          // Parent run has only 1 lead left (this one) — delete the run which cascades to the lead
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

