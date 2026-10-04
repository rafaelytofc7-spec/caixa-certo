import type { DB } from '../db';

/** Interface para NFC-e futura. Hoje só existe o mock: nada é enviado à SEFAZ. */
export interface FiscalResult { provider: string; status: 'SIMULADO' | 'AUTORIZADO' | 'REJEITADO' | 'ERRO'; access_key: string | null; message: string }
export interface FiscalProvider {
  readonly name: string;
  emit(sale: { id: number; number: number; total_cents: number; created_at: string }): FiscalResult;
}

export class MockFiscalProvider implements FiscalProvider {
  readonly name = 'mock';
  emit(sale: { id: number; number: number; total_cents: number }): FiscalResult {
    const key = ('35' + String(Date.now()) + String(sale.number).padStart(9, '0') + '0'.repeat(44)).slice(0, 44);
    return { provider: this.name, status: 'SIMULADO', access_key: key, message: 'Simulação — sem envio à SEFAZ. NÃO É DOCUMENTO FISCAL.' };
  }
}

let provider: FiscalProvider = new MockFiscalProvider();
export const getFiscalProvider = () => provider;
export const setFiscalProvider = (p: FiscalProvider) => { provider = p; };

export function emitFiscal(db: DB, sale: { id: number; number: number; total_cents: number; created_at: string }) {
  try {
    const r = provider.emit(sale);
    db.prepare('INSERT INTO fiscal_documents(sale_id, provider, status, access_key, payload) VALUES (?,?,?,?,?)')
      .run(sale.id, r.provider, r.status, r.access_key, JSON.stringify(r));
    return r;
  } catch (e: any) {
    db.prepare('INSERT INTO fiscal_documents(sale_id, provider, status, payload) VALUES (?,?,?,?)')
      .run(sale.id, provider.name, 'ERRO', JSON.stringify({ message: String(e?.message ?? e) }));
    return null;
  }
}
