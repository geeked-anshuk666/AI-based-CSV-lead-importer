import csvParser from 'csv-parser';
import { Readable } from 'stream';

export class CsvService {
  public static sanitizeCsvText(raw: string): string {
    let text = raw.replace(/^\uFEFF/, '');
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    return text;
  }

  public static normalizeHeader(key: string): string {
    return key
      .trim()
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .replace(/[\s\-\.]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .toLowerCase();
  }

  public static normalizeRowHeaders(rows: any[]): any[] {
    return rows.map(row => {
      const normalized: Record<string, any> = {};
      for (const [key, value] of Object.entries(row)) {
        const normalKey = this.normalizeHeader(key);
        if (!(normalKey in normalized)) {
          normalized[normalKey] = value;
        }
      }
      return normalized;
    });
  }

  public static async parseCsv(csvText: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const results: any[] = [];
      const stream = Readable.from(csvText);

      stream
        .pipe(csvParser({
          mapHeaders: ({ header }) => this.normalizeHeader(header)
        }))
        .on('data', (data) => {
          results.push(data);
        })
        .on('end', () => {
          resolve(results);
        })
        .on('error', (err) => {
          reject(err);
        });
    });
  }

  public static validateAndFilterRows(rows: any[]): { valid: any[]; skippedCount: number } {
    const valid: any[] = [];
    let skippedCount = 0;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const phoneRegex = /[0-9]{6,}/;

    for (const row of rows) {
      const keys = Object.keys(row);

      const hasEmail = keys.some(key => {
        if ((key.includes('email') || key.includes('mail')) && row[key]) {
          const val = String(row[key]).trim();
          return emailRegex.test(val);
        }
        return false;
      });

      const hasPhone = keys.some(key => {
        if ((key.includes('phone') || key.includes('mobile') || key.includes('contact') || key.includes('num')) && row[key]) {
          const val = String(row[key]).replace(/[^0-9]/g, '');
          return phoneRegex.test(val);
        }
        return false;
      });

      if (hasEmail || hasPhone) {
        valid.push(row);
      } else {
        skippedCount++;
      }
    }

    return { valid, skippedCount };
  }
}
