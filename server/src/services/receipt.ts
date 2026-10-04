import net from 'node:net';
import PDFDocument from 'pdfkit';
import type { DB } from '../db';
import { getSettings } from '../settings';
import { getSale } from './sales';
import { sessionSummary } from './cash';
import { buildReceiptDoc, buildSessionReportDoc, renderEscPos as escposBytes, renderText, ReceiptDoc, BRAND } from '@folha/shared';
export { COLS, lr, colsLine, renderText, encodeCp860, renderHtml } from '@folha/shared';
export type { RLine, ReceiptDoc } from '@folha/shared';

export function buildReceipt(db: DB, saleId: number): ReceiptDoc {
  const sale = getSale(db, saleId);
  const c = sale.customer_id ? (db.prepare('SELECT balance_cents FROM customers WHERE id = ?').get(sale.customer_id) as any) : null;
  return buildReceiptDoc(getSettings(db), sale, c?.balance_cents ?? 0);
}
export function buildSessionReport(db: DB, sessionId: number): ReceiptDoc {
  return buildSessionReportDoc(getSettings(db), sessionSummary(db, sessionId));
}
export function renderEscPos(doc: ReceiptDoc, opts: { cut?: boolean; drawer?: boolean } = {}): Buffer {
  return Buffer.from(escposBytes(doc, opts));
}

/** Envia para impressora de rede (RAW 9100). Nunca derruba o servidor. */
export function sendToPrinter(host: string, port: number, data: Buffer, timeoutMs = 4000): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    if (!host) return resolve({ ok: false, error: 'Nenhuma impressora configurada (Configurações > Impressora).' });
    let done = false;
    const finish = (r: { ok: boolean; error?: string }) => { if (!done) { done = true; sock.destroy(); resolve(r); } };
    const sock = net.createConnection({ host, port }, () => { sock.end(data, () => finish({ ok: true })); });
    sock.setTimeout(timeoutMs, () => finish({ ok: false, error: `Impressora ${host}:${port} não respondeu.` }));
    sock.on('error', (e) => finish({ ok: false, error: `Falha ao imprimir em ${host}:${port}: ${e.message}` }));
  });
}

// ---------- PDF 80 mm ----------
export function renderPdf(doc: ReceiptDoc): Promise<Buffer> {
  const lines = renderText(doc);
  const W = 226.77; const fs = 7.2; const lh = 9.6; const margin = 9;
  const H = margin * 2 + lh * (lines.length + 2);
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: [W, H], margin, info: { Title: doc.title, Creator: BRAND.name } });
    const chunks: Buffer[] = [];
    pdf.on('data', (c: Buffer) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    let y = margin; let i = 0;
    for (const l of doc.lines) {
      const rendered = renderText({ lines: [l], title: '' });
      for (const t of rendered) {
        const isBold = l.k === 'title' || ('bold' in l && l.bold);
        pdf.font(isBold ? 'Courier-Bold' : 'Courier').fontSize(l.k === 'title' ? fs + 2 : fs)
          .fillColor(l.k === 'title' || (l.k === 'lr' && l.big) ? '#1F7A4D' : l.k === 'hr' ? '#1F7A4D' : '#1C1917');
        if (l.k === 'title' || l.k === 'center') pdf.text(t.trim(), margin, y, { lineBreak: false, width: W - margin * 2, align: 'center' });
        else pdf.text(t, margin, y, { lineBreak: false });
        y += lh; i++;
      }
    }
    pdf.end();
  });
}
