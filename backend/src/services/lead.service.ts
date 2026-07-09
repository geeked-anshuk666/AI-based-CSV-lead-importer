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
    return await prisma.lead.delete({
      where: { id }
    });
  }
}
