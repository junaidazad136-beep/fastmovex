import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

export type ExportFormat = 'csv' | 'xlsx' | 'pdf';
export interface Table { title: string; columns: string[]; rows: (string | number | null)[][] }

/**
 * CSV injection guard: a cell starting with = + - @ (or tab/CR) can run formulas when opened in Excel.
 * Such cells are prefixed with a quote. Exported for tests.
 */
export function csvCell(v: string | number | null): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(t: Table): string {
  // BOM so Excel opens Arabic text correctly
  return '\uFEFF' + [t.columns, ...t.rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

@Injectable()
export class ExportService {
  async render(t: Table, format: ExportFormat): Promise<{ buffer: Buffer; contentType: string; ext: string }> {
    if (format === 'csv') return { buffer: Buffer.from(toCsv(t), 'utf8'), contentType: 'text/csv; charset=utf-8', ext: 'csv' };
    if (format === 'xlsx') return { buffer: await this.xlsx(t), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' };
    return { buffer: await this.pdf(t), contentType: 'application/pdf', ext: 'pdf' };
  }

  private async xlsx(t: Table): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'FastMoveX';
    const ws = wb.addWorksheet(t.title.slice(0, 31));
    ws.addRow(t.columns).font = { bold: true };
    // Values written as data, never as formulas
    t.rows.forEach((r) => ws.addRow(r.map((v) => (typeof v === 'string' && /^[=+\-@]/.test(v) ? `'${v}` : v))));
    ws.columns.forEach((c) => { c.width = 18; });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  private pdf(t: Table): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', layout: t.columns.length > 5 ? 'landscape' : 'portrait', margin: 36 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(16).text(`FastMoveX — ${t.title}`);
      doc.fontSize(8).fillColor('#666').text(`Generated ${new Date().toISOString()}`).fillColor('#000').moveDown();
      const width = doc.page.width - 72;
      const colW = width / t.columns.length;
      const row = (cells: (string | number | null)[], bold = false) => {
        if (doc.y > doc.page.height - 60) doc.addPage();
        const y = doc.y;
        doc.fontSize(8).font(bold ? 'Helvetica-Bold' : 'Helvetica');
        cells.forEach((c, i) => doc.text(String(c ?? '').slice(0, 60), 36 + i * colW, y, { width: colW - 4, ellipsis: true, lineBreak: false }));
        doc.moveDown(0.8);
      };
      row(t.columns, true);
      t.rows.slice(0, 5_000).forEach((r) => row(r)); // PDFs are for reading; big datasets -> CSV/Excel
      if (t.rows.length > 5_000) doc.moveDown().fontSize(8).text(`${t.rows.length - 5_000} more rows — use CSV or Excel for the full data.`);
      doc.end();
    });
  }
}
