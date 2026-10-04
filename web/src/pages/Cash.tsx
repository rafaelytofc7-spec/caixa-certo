import { useEffect, useState } from 'react';
import { get, post, fmtDateTime } from '../api';
import { useApp } from '../ctx';
import { Modal } from '../components/Modal';
import { MoneyInput } from '../components/Inputs';
import { ReceiptModal } from './ReceiptModal';
import { CashBook } from './CashBook';
import { formatBRL, PAYMENT_LABEL, PAYMENT_METHODS, PaymentMethod } from '@folha/shared';

const MOV_LABEL: Record<string, string> = { ABERTURA: 'Abertura (fundo)', SANGRIA: 'Sangria', SUPRIMENTO: 'Suprimento', RECEBIMENTO_FIADO: 'Recebimento fiado', ESTORNO: 'Estorno (cancelamento)' };

export function Cash() {
  const { status, refreshStatus, toast, user } = useApp();
  const mgr = user?.role === 'admin' || user?.role === 'gerente';
  const [modal, setModal] = useState<null | 'sangria' | 'suprimento' | 'fechar'>(null);
  const [report, setReport] = useState<number | null>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [float, setFloat] = useState(10000);
  const cur = status?.session;
  const loadSessions = () => get('/api/cash/sessions').then(setSessions).catch(() => {});
  useEffect(() => { refreshStatus(); loadSessions(); }, [refreshStatus]);

  const open = async () => {
    try { await post('/api/cash/open', { opening_float_cents: float }); toast('Caixa aberto.'); refreshStatus(); loadSessions(); }
    catch (e: any) { toast(e.message, 'erro'); }
  };

  return (
    <div className="page">
      <div className="page-title"><h1>💵 Caixa</h1><span className="muted">Terminal {status?.terminal}</span></div>
      {!cur ? (
        <div className="card" style={{ maxWidth: 560 }}>
          <h3>Abrir caixa</h3>
          <p className="muted">Conte o dinheiro do fundo de troco que está na gaveta.</p>
          <label className="field">Fundo de troco<MoneyInput big value={float} onChange={setFloat} autoFocus onKeyDown={(e) => e.key === 'Enter' && open()} /></label>
          <div className="row" style={{ marginTop: 12 }}><button className="btn btn-primary btn-big grow" onClick={open}>Abrir caixa</button></div>
        </div>
      ) : (
        <>
          <div className="row wrap">
            <span className="tag ok" style={{ fontSize: 14, padding: '6px 12px' }}>Aberto em {fmtDateTime(cur.session.opened_at)} por {cur.session.opened_by_name}</span>
            <span className="spacer" />
            <button className="btn" onClick={() => setModal('suprimento')}>➕ Suprimento</button>
            <button className="btn" onClick={() => setModal('sangria')}>➖ Sangria</button>
            <button className="btn" onClick={() => setReport(cur.session.id)}>Parcial (imprimir)</button>
            <button className="btn btn-primary" onClick={() => setModal('fechar')}>Fechar caixa</button>
          </div>
          <div className="grid4">
            <div className="stat"><div className="lbl">Fundo de troco</div><div className="val">{formatBRL(cur.opening_float_cents)}</div></div>
            <div className="stat verde"><div className="lbl">Vendas ({cur.sales_count})</div><div className="val">{formatBRL(cur.sales_total_cents)}</div></div>
            <div className="stat"><div className="lbl">Ticket médio</div><div className="val">{formatBRL(cur.ticket_medio_cents)}</div></div>
            <div className="stat verde"><div className="lbl">Dinheiro na gaveta</div><div className="val">{formatBRL(cur.by_method.find((m: any) => m.method === 'dinheiro')?.expected_cents ?? 0)}</div></div>
          </div>
          <div className="grid2">
            <div className="card">
              <h3>Esperado por forma de pagamento</h3>
              <table className="t"><thead><tr><th>Forma</th><th className="r">Esperado</th></tr></thead>
                <tbody>{cur.by_method.map((m: any) => <tr key={m.method}><td>{PAYMENT_LABEL[m.method as PaymentMethod]}</td><td className="r">{formatBRL(m.expected_cents)}</td></tr>)}
                  <tr><td><b>Total</b></td><td className="r"><b>{formatBRL(cur.expected_total_cents)}</b></td></tr></tbody></table>
            </div>
            <div className="card">
              <h3>Movimentos do caixa</h3>
              <table className="t"><thead><tr><th>Hora</th><th>Tipo</th><th>Quem</th><th className="r">Valor</th></tr></thead>
                <tbody>{cur.movements.map((m: any) => (
                  <tr key={m.id}><td>{m.created_at.slice(11, 16)}</td><td>{MOV_LABEL[m.type] ?? m.type}{m.note ? <div className="small muted">{m.note}</div> : null}</td>
                    <td>{m.user_name}</td><td className={`r ${m.amount_cents < 0 ? 'neg' : ''}`}>{formatBRL(m.amount_cents)}</td></tr>))}</tbody></table>
              <div className="small muted" style={{ marginTop: 8 }}>Sangrias {formatBRL(cur.sangria_cents)} · Suprimentos {formatBRL(cur.suprimento_cents)} · Estornos {formatBRL(cur.estorno_cents)}</div>
            </div>
          </div>
        </>
      )}
      {mgr ? <CashBook onSession={setReport} /> : <div className="card">
        <h3>Sessões anteriores</h3>
        <table className="t"><thead><tr><th>Nº</th><th>Terminal</th><th>Abertura</th><th>Fechamento</th><th>Operador</th><th>Situação</th><th /></tr></thead>
          <tbody>{sessions.map((s) => (
            <tr key={s.id}><td>{s.id}</td><td>{s.terminal}</td><td>{fmtDateTime(s.opened_at)}</td><td>{s.closed_at ? fmtDateTime(s.closed_at) : '—'}</td>
              <td>{s.opened_by_name}</td><td><span className={`tag ${s.status === 'ABERTO' ? 'ok' : ''}`}>{s.status === 'ABERTO' ? 'Aberto' : 'Fechado'}</span></td>
              <td className="r"><button className="btn btn-sm" onClick={() => setReport(s.id)}>Relatório</button></td></tr>))}</tbody></table>
      </div>}
      {(modal === 'sangria' || modal === 'suprimento') && <MoveModal kind={modal} onClose={() => setModal(null)} onDone={() => { setModal(null); refreshStatus(); }} />}
      {modal === 'fechar' && cur && <CloseModal cur={cur} onClose={() => setModal(null)} onDone={(id) => { setModal(null); refreshStatus(); loadSessions(); setReport(id); }} />}
      {report && <ReceiptModal sessionId={report} title="Fechamento de caixa" onClose={() => setReport(null)} />}
    </div>
  );
}

function MoveModal({ kind, onClose, onDone }: { kind: 'sangria' | 'suprimento'; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const [v, setV] = useState(0); const [note, setNote] = useState(''); const [err, setErr] = useState('');
  const save = async () => {
    try { await post(`/api/cash/${kind}`, { amount_cents: v, note }); toast(kind === 'sangria' ? 'Sangria registrada.' : 'Suprimento registrado.'); onDone(); }
    catch (e: any) { setErr(e.message); }
  };
  return (
    <Modal title={kind === 'sangria' ? '➖ Sangria (tirar dinheiro da gaveta)' : '➕ Suprimento (pôr troco na gaveta)'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Voltar</button><button className="btn btn-primary" disabled={v <= 0} onClick={save}>Confirmar</button></>}>
      <label className="field">Valor<MoneyInput big value={v} onChange={setV} autoFocus onKeyDown={(e) => e.key === 'Enter' && v > 0 && save()} /></label>
      <label className="field">Motivo / destino<input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === 'sangria' ? 'Ex.: cofre, pagar fornecedor do tomate' : 'Ex.: troco do banco'} /></label>
      {err && <div className="err">{err}</div>}
    </Modal>
  );
}

function CloseModal({ cur, onClose, onDone }: { cur: any; onClose: () => void; onDone: (id: number) => void }) {
  const { toast } = useApp();
  const [counted, setCounted] = useState<Record<string, number>>(() => Object.fromEntries(PAYMENT_METHODS.map((m) => [m, 0])));
  const [note, setNote] = useState(''); const [err, setErr] = useState('');
  const exp = (m: string) => cur.by_method.find((x: any) => x.method === m)?.expected_cents ?? 0;
  const totalExp = cur.expected_total_cents;
  const totalCount = Object.values(counted).reduce((a, b) => a + b, 0);
  const diff = totalCount - totalExp;
  const close = async () => {
    try { const r = await post('/api/cash/close', { counted, note }); toast('Caixa fechado.'); onDone(r.session.id); }
    catch (e: any) { setErr(e.message); }
  };
  return (
    <Modal title="Fechar caixa — contado × esperado" onClose={onClose} size="mid"
      footer={<><button className="btn" onClick={onClose}>Voltar</button><span className="spacer" />
        <button className="btn btn-primary btn-big" onClick={close}>Fechar caixa e imprimir</button></>}>
      <div className="muted">Conte a gaveta e some os comprovantes de cada forma. A diferença aparece na hora.</div>
      <table className="t">
        <thead><tr><th>Forma</th><th className="r">Esperado</th><th style={{ width: 210 }}>Contado</th><th className="r">Diferença</th></tr></thead>
        <tbody>{PAYMENT_METHODS.map((m) => {
          const d = counted[m] - exp(m);
          return (
            <tr key={m}><td><b>{PAYMENT_LABEL[m]}</b></td><td className="r">{formatBRL(exp(m))}</td>
              <td><div className="row" style={{ gap: 4 }}><MoneyInput value={counted[m]} onChange={(v) => setCounted((c) => ({ ...c, [m]: v }))} />
                <button className="btn btn-sm" title="Igual ao esperado" onClick={() => setCounted((c) => ({ ...c, [m]: exp(m) }))}>=</button></div></td>
              <td className={`r ${d < 0 ? 'neg' : d > 0 ? 'pos' : ''}`}><b>{d === 0 ? '—' : (d > 0 ? '+' : '') + formatBRL(d)}</b></td></tr>
          );
        })}
          <tr><td><b>Total</b></td><td className="r"><b>{formatBRL(totalExp)}</b></td><td className="r"><b>{formatBRL(totalCount)}</b></td>
            <td className={`r ${diff < 0 ? 'neg' : diff > 0 ? 'pos' : ''}`}><b>{diff === 0 ? 'Bateu' : (diff > 0 ? 'Sobra +' : 'Falta ') + formatBRL(Math.abs(diff))}</b></td></tr>
        </tbody>
      </table>
      <label className="field">Observação<input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: faltou R$ 2 de moeda" /></label>
      {err && <div className="err">{err}</div>}
    </Modal>
  );
}
