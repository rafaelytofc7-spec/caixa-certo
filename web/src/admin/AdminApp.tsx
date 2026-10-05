import { useCallback, useEffect, useMemo, useState } from 'react';
import { BRAND, formatBRL } from '@folha/shared';
import { Modal } from '../components/Modal';
import { Logo } from '../components/Logo';
import { docDigits, docType, maskDoc, maskPhoneBR } from '../doc';
import { sb, rpc, signIn, changePassword, CONFIGURED, LojaAdm, Config, AdminError } from './api';

const fmtD = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
const fmtDT = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const todaySP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const toCents = (v: string) => Math.round(Number(String(v).replace(/\./g, '').replace(',', '.')) * 100);
const centsTxt = (c: number) => (c / 100).toFixed(2).replace('.', ',');
const genPass = () => { const a = 'abcdefghjkmnpqrstuvwxyz23456789'; const r = crypto.getRandomValues(new Uint8Array(12)); return Array.from(r, (x) => a[x % a.length]).join(''); };
const SIT: Record<string, [string, string]> = {
  teste: ['Teste', 'st-teste'], ativa: ['Ativa', 'st-ativa'], carencia: ['Carência', 'st-carencia'], vencida: ['Vencida', 'st-bloqueada'], bloqueada: ['Bloqueada', 'st-bloqueada'],
};
const EVT: Record<string, string> = { CRIADA: 'Loja criada', PAGAMENTO: 'Pagamento', BLOQUEADA: 'Bloqueada', DESBLOQUEADA: 'Desbloqueada', EDITADA: 'Dados editados', SENHA_REDEFINIDA: 'Senha redefinida' };

export function AdminApp() {
  const [me, setMe] = useState<{ usuario: string; config: Config } | null | 'loading'>('loading');
  useEffect(() => {
    if (!CONFIGURED) { setMe(null); return; }
    (async () => {
      const { data } = await sb().auth.getSession();
      if (!data.session) return setMe(null);
      try { setMe(await rpc('admin_me')); } catch { await sb().auth.signOut(); setMe(null); }
    })();
  }, []);
  if (me === 'loading') return <div className="boot">Carregando…</div>;
  if (!me) return <AdminLogin onIn={setMe} />;
  return <Panel me={me} onOut={async () => { await sb().auth.signOut(); setMe(null); }} />;
}

function AdminLogin({ onIn }: { onIn: (m: any) => void }) {
  const [u, setU] = useState(''); const [p, setP] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  return (
    <div className="adm-login">
      <form className="card col adm-login-box" onSubmit={async (e) => {
        e.preventDefault(); setErr(''); setBusy(true);
        try { onIn(await signIn(u, p)); } catch (x: any) { setErr(x.message); setBusy(false); }
      }}>
        <Logo size={28} />
        <div><div className="eyebrow">Área restrita</div><h1 className="login-h1">Administração</h1>
          <div className="muted small">Somente para a administração do {BRAND.name}. Lojas entram pelo app.</div></div>
        {!CONFIGURED && <div className="err">Supabase não configurado neste build.</div>}
        <label className="field">Usuário<input className="input" autoCapitalize="none" autoComplete="username" value={u} onChange={(e) => setU(e.target.value.trim().toLowerCase())} autoFocus required /></label>
        <label className="field">Senha<input className="input" type="password" autoComplete="current-password" value={p} onChange={(e) => setP(e.target.value)} required /></label>
        {err && <div className="err">{err}</div>}
        <button className="btn btn-primary btn-big" disabled={busy || !u || !p}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </div>
  );
}

type Dlg = { k: 'pag' | 'bloq' | 'desbloq' | 'edit' | 'senha' | 'detalhe'; loja: LojaAdm } | { k: 'nova' } | { k: 'minhasenha' } | { k: 'config' } | null;

function Panel({ me, onOut }: { me: { usuario: string; config: Config }; onOut: () => void }) {
  const [lojas, setLojas] = useState<LojaAdm[] | null>(null);
  const [cfg, setCfg] = useState<Config>(me.config);
  const [qtxt, setQ] = useState(''); const [filtro, setFiltro] = useState('todas');
  const [dlg, setDlg] = useState<Dlg>(null);
  const [toast, setToast] = useState<{ m: string; k: 'ok' | 'erro' } | null>(null);
  const say = (m: string, k: 'ok' | 'erro' = 'ok') => { setToast({ m, k }); setTimeout(() => setToast(null), 3500); };
  const load = useCallback(async () => {
    try { setLojas(await rpc<LojaAdm[]>('admin_lojas')); } catch (e: any) { say(e.message, 'erro'); if (e instanceof AdminError && /42501|PROIBIDO|SEM_LOGIN/.test(e.code)) onOut(); }
  }, []); // eslint-disable-line
  useEffect(() => { load(); }, [load]);
  const done = (msg: string) => { setDlg(null); say(msg); load(); };

  const list = useMemo(() => {
    const t = qtxt.trim().toLowerCase(); const d = docDigits(qtxt);
    return (lojas ?? []).filter((l) => (filtro === 'todas' || l.situacao === filtro || (filtro === 'atencao' && (l.situacao === 'carencia' || l.situacao === 'vencida' || (l.liberada && l.dias_restantes <= cfg.aviso_dias)))))
      .filter((l) => !t || l.nome.toLowerCase().includes(t) || (d.length >= 3 && l.documento.includes(d)) || (l.responsavel ?? '').toLowerCase().includes(t) || (l.dono_usuario ?? '').includes(t));
  }, [lojas, qtxt, filtro, cfg.aviso_dias]);
  const tot = useMemo(() => {
    const ls = lojas ?? [];
    return { n: ls.length, ativas: ls.filter((l) => l.situacao === 'ativa').length, teste: ls.filter((l) => l.situacao === 'teste').length,
      problema: ls.filter((l) => !l.liberada).length, mrr: ls.filter((l) => l.status === 'ativa').reduce((a, l) => a + (l.valor_mensal_cents || 0), 0) };
  }, [lojas]);

  return (
    <div className="adm">
      <header className="adm-top">
        <Logo size={24} light /><span className="adm-badge">Administração</span><span className="spacer" />
        <span className="small">👤 <b>{me.usuario}</b></span>
        <button className="btn btn-sm" onClick={() => setDlg({ k: 'config' })}>⚙️ Regras</button>
        <button className="btn btn-sm" onClick={() => setDlg({ k: 'minhasenha' })}>🔑 Minha senha</button>
        <button className="btn btn-sm" onClick={onOut}>Sair</button>
      </header>
      <main className="page">
        <div className="adm-stats">
          <div className="card"><span>Lojas</span><b>{tot.n}</b></div>
          <div className="card"><span>Ativas</span><b>{tot.ativas}</b></div>
          <div className="card"><span>Em teste</span><b>{tot.teste}</b></div>
          <div className="card"><span>Bloqueadas / vencidas</span><b>{tot.problema}</b></div>
          <div className="card"><span>Mensalidades (ativas)</span><b>{formatBRL(tot.mrr)}</b></div>
        </div>
        <div className="card">
          <div className="adm-toolbar">
            <h3>Lojas</h3>
            <input className="input adm-search" placeholder="Buscar por nome, CPF/CNPJ ou responsável" value={qtxt} onChange={(e) => setQ(e.target.value)} />
            <select className="input" value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Filtrar">
              <option value="todas">Todas</option><option value="atencao">Precisam de atenção</option><option value="teste">Teste</option>
              <option value="ativa">Ativas</option><option value="carencia">Carência</option><option value="vencida">Vencidas</option><option value="bloqueada">Bloqueadas</option>
            </select>
            <button className="btn btn-primary" onClick={() => setDlg({ k: 'nova' })}>+ Nova loja</button>
            <button className="btn" onClick={load} title="Atualizar">↻</button>
          </div>
          {lojas === null ? <div className="muted">Carregando…</div> : list.length === 0 ? <div className="muted">Nenhuma loja{qtxt || filtro !== 'todas' ? ' com esse filtro' : ' cadastrada ainda'}.</div> :
            <div className="table-wrap"><table className="t adm-table">
              <thead><tr><th>Loja</th><th>CPF/CNPJ</th><th>Situação</th><th>Vencimento</th><th className="r">Dias</th><th>Último acesso</th><th className="r">Vendas</th><th className="r">Total do mês</th><th /></tr></thead>
              <tbody>{list.map((l) => {
                const [st, cls] = SIT[l.situacao] ?? [l.situacao, ''];
                return (
                  <tr key={l.id}>
                    <td data-label="Loja"><button className="link" onClick={() => setDlg({ k: 'detalhe', loja: l })}><b>{l.nome}</b></button>
                      <div className="small muted">{l.responsavel}{l.dono_usuario ? ` · ${l.dono_usuario}` : ''}{l.plano ? ` · ${l.plano}` : ''}{l.valor_mensal_cents ? ` · ${formatBRL(l.valor_mensal_cents)}/mês` : ''}</div></td>
                    <td data-label="CPF/CNPJ" className="mono nowrap">{maskDoc(l.documento)}</td>
                    <td data-label="Situação"><span className={`tag ${cls}`} title={l.motivo_bloqueio ?? ''}>{st}</span></td>
                    <td data-label="Vencimento" className="nowrap">{fmtD(l.vencimento)}</td>
                    <td data-label="Dias" className={`r ${l.dias_restantes < 0 ? 'neg' : l.dias_restantes <= cfg.aviso_dias ? 'warn' : ''}`}>{l.dias_restantes}</td>
                    <td data-label="Último acesso" className="nowrap small">{fmtDT(l.ultimo_acesso)}</td>
                    <td data-label="Vendas (mês / total)" className="r"><span>{l.vendas_mes}<span className="small muted"> / {l.vendas_total}</span></span></td>
                    <td data-label="Total do mês" className="r nowrap">{formatBRL(l.total_mes_cents)}</td>
                    <td className="nowrap adm-acts">
                      <button className="btn btn-sm btn-primary" onClick={() => setDlg({ k: 'pag', loja: l })}>💰 Pagamento</button>
                      {l.status === 'bloqueada'
                        ? <button className="btn btn-sm" onClick={() => setDlg({ k: 'desbloq', loja: l })}>🔓 Desbloquear</button>
                        : <button className="btn btn-sm btn-danger" onClick={() => setDlg({ k: 'bloq', loja: l })}>🔒 Bloquear</button>}
                      <button className="btn btn-sm" onClick={() => setDlg({ k: 'edit', loja: l })}>✏️</button>
                    </td>
                  </tr>);
              })}</tbody>
            </table></div>}
          <div className="small muted" style={{ marginTop: 8 }}>“Vendas” = mês / total. Carência de {cfg.carencia_dias} dia(s) depois do vencimento (só para lojas ativas). Teste grátis: {cfg.dias_teste} dias.</div>
        </div>
      </main>
      {dlg?.k === 'pag' && <PaymentDlg loja={dlg.loja} onClose={() => setDlg(null)} onDone={done} />}
      {dlg?.k === 'bloq' && <BlockDlg loja={dlg.loja} onClose={() => setDlg(null)} onDone={done} />}
      {dlg?.k === 'desbloq' && <UnblockDlg loja={dlg.loja} onClose={() => setDlg(null)} onDone={done} />}
      {dlg?.k === 'edit' && <EditDlg loja={dlg.loja} onClose={() => setDlg(null)} onDone={done} />}
      {dlg?.k === 'senha' && <ResetPassDlg loja={dlg.loja} onClose={() => setDlg(null)} onDone={done} />}
      {dlg?.k === 'detalhe' && <DetailDlg loja={dlg.loja} onClose={() => setDlg(null)} open={(k, l) => setDlg({ k, loja: l } as Dlg)} />}
      {dlg?.k === 'nova' && <NewStoreDlg cfg={cfg} onClose={() => setDlg(null)} onDone={done} />}
      {dlg?.k === 'minhasenha' && <MyPassDlg usuario={me.usuario} onClose={() => setDlg(null)} onDone={(m) => { setDlg(null); say(m); }} />}
      {dlg?.k === 'config' && <ConfigDlg cfg={cfg} onClose={() => setDlg(null)} onDone={(c) => { setCfg(c); done('Regras salvas.'); }} />}
      {toast && <div className={`toast ${toast.k}`} role="status"><span>{toast.m}</span></div>}
    </div>
  );
}

function useAct() {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const run = async (f: () => Promise<void>) => { setErr(''); setBusy(true); try { await f(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  return { busy, err, setErr, run };
}
const Head = ({ l }: { l: LojaAdm }) => <div className="adm-head"><b>{l.nome}</b> · <span className="mono">{maskDoc(l.documento)}</span> · vence {fmtD(l.vencimento)}</div>;

function PaymentDlg({ loja, onClose, onDone }: { loja: LojaAdm; onClose: () => void; onDone: (m: string) => void }) {
  const hoje = todaySP();
  const base = loja.vencimento > hoje ? loja.vencimento : hoje;
  const [modo, setModo] = useState<'30' | 'data'>('30');
  const [valor, setValor] = useState(loja.valor_mensal_cents ? centsTxt(loja.valor_mensal_cents) : '');
  const [pago, setPago] = useState(hoje); const [venc, setVenc] = useState(addDays(base, 30));
  const [metodo, setMetodo] = useState('pix'); const [obs, setObs] = useState('');
  const a = useAct();
  const novo = modo === '30' ? addDays(base, 30) : venc;
  const save = () => a.run(async () => {
    const c = toCents(valor);
    if (!Number.isFinite(c) || c < 0 || valor.trim() === '') throw new Error('Informe o valor pago (pode ser 0,00).');
    await rpc('admin_registrar_pagamento', { p_loja: loja.id, p_data: { valor_cents: c, pago_em: pago, metodo, observacao: obs, ...(modo === 'data' ? { novo_vencimento: venc } : { dias: 30 }) } });
    onDone(`Pagamento registrado. ${loja.nome} liberada até ${fmtD(novo)}.`);
  });
  return (
    <Modal title="💰 Registrar pagamento" onClose={onClose} size="mid"
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={a.busy} onClick={save}>{a.busy ? 'Salvando…' : 'Registrar e liberar'}</button></>}>
      <Head l={loja} />
      <div className="grid2 tight">
        <label className="field">Valor pago (R$)<input className="input num" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value.replace(/[^\d,.]/g, ''))} placeholder="0,00" autoFocus /></label>
        <label className="field">Data do pagamento<input className="input" type="date" value={pago} onChange={(e) => setPago(e.target.value)} /></label>
      </div>
      <div className="field"><span>Novo vencimento</span>
        <div className="tabs"><button type="button" className={modo === '30' ? 'on' : ''} onClick={() => setModo('30')}>+30 dias</button>
          <button type="button" className={modo === 'data' ? 'on' : ''} onClick={() => setModo('data')}>Escolher data</button></div>
        {modo === 'data' && <input className="input" type="date" min={hoje} value={venc} onChange={(e) => setVenc(e.target.value)} />}
        <span className="hint">Fica liberada até <b>{fmtD(novo)}</b> (conta a partir de {loja.vencimento > hoje ? 'o vencimento atual' : 'hoje, porque já venceu'}). A situação vira “Ativa”.</span></div>
      <div className="grid2 tight">
        <label className="field">Forma<select className="input" value={metodo} onChange={(e) => setMetodo(e.target.value)}>
          <option value="pix">PIX</option><option value="dinheiro">Dinheiro</option><option value="transferencia">Transferência</option><option value="cortesia">Cortesia</option><option value="outro">Outro</option></select></label>
        <label className="field">Observação<input className="input" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="ex.: PIX de outubro" /></label>
      </div>
      {a.err && <div className="err">{a.err}</div>}
    </Modal>
  );
}

function BlockDlg({ loja, onClose, onDone }: { loja: LojaAdm; onClose: () => void; onDone: (m: string) => void }) {
  const [m, setM] = useState('Falta de pagamento'); const a = useAct();
  return (
    <Modal title="🔒 Bloquear loja" onClose={onClose} size="sm"
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-danger solid" disabled={a.busy} onClick={() => a.run(async () => { await rpc('admin_bloquear', { p_loja: loja.id, p_motivo: m }); onDone(`${loja.nome} bloqueada.`); })}>{a.busy ? 'Bloqueando…' : 'Bloquear agora'}</button></>}>
      <Head l={loja} />
      <div className="muted">A loja para de vender na hora (o banco recusa) e vê a tela “Acesso bloqueado”. Os dados ficam guardados.</div>
      <label className="field">Motivo (a loja vê)<input className="input" value={m} onChange={(e) => setM(e.target.value)} autoFocus /></label>
      {a.err && <div className="err">{a.err}</div>}
    </Modal>
  );
}

function UnblockDlg({ loja, onClose, onDone }: { loja: LojaAdm; onClose: () => void; onDone: (m: string) => void }) {
  const hoje = todaySP();
  const [m, setM] = useState(''); const [st, setSt] = useState<'ativa' | 'teste'>('ativa');
  const [venc, setVenc] = useState(loja.vencimento < hoje ? addDays(hoje, 7) : '');
  const a = useAct();
  return (
    <Modal title="🔓 Desbloquear loja" onClose={onClose} size="sm"
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={a.busy} onClick={() => a.run(async () => {
        await rpc('admin_desbloquear', { p_loja: loja.id, p_motivo: m, p_status: st, p_novo_vencimento: venc || null }); onDone(`${loja.nome} desbloqueada.`);
      })}>{a.busy ? 'Salvando…' : 'Desbloquear'}</button></>}>
      <Head l={loja} />
      {loja.motivo_bloqueio && <div className="small muted">Bloqueada por: <b>{loja.motivo_bloqueio}</b></div>}
      <label className="field">Motivo do desbloqueio<input className="input" value={m} onChange={(e) => setM(e.target.value)} placeholder="ex.: combinou pagar dia 10" autoFocus /></label>
      <label className="field">Voltar como<select className="input" value={st} onChange={(e) => setSt(e.target.value as any)}><option value="ativa">Ativa</option><option value="teste">Teste</option></select></label>
      <label className="field">Novo vencimento {loja.vencimento < hoje ? '(necessário: já venceu)' : '(opcional)'}<input className="input" type="date" min={hoje} value={venc} onChange={(e) => setVenc(e.target.value)} /></label>
      <div className="hint">Se a loja pagou, prefira “Registrar pagamento” (já desbloqueia e guarda o histórico).</div>
      {a.err && <div className="err">{a.err}</div>}
    </Modal>
  );
}

function EditDlg({ loja, onClose, onDone }: { loja: LojaAdm; onClose: () => void; onDone: (m: string) => void }) {
  const [f, setF] = useState({ nome: loja.nome, responsavel: loja.responsavel ?? '', telefone: maskPhoneBR(loja.telefone ?? ''), plano: loja.plano ?? '',
    valor: loja.valor_mensal_cents ? centsTxt(loja.valor_mensal_cents) : '', vencimento: loja.vencimento, observacao: loja.observacao ?? '' });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const a = useAct();
  return (
    <Modal title="✏️ Editar loja" onClose={onClose} size="mid"
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={a.busy} onClick={() => a.run(async () => {
        const c = f.valor.trim() === '' ? 0 : toCents(f.valor);
        if (!Number.isFinite(c) || c < 0) throw new Error('Valor mensal inválido.');
        await rpc('admin_editar_loja', { p_loja: loja.id, p_data: { nome: f.nome, responsavel: f.responsavel, telefone: f.telefone, plano: f.plano, valor_mensal_cents: c, vencimento: f.vencimento, observacao: f.observacao } });
        onDone('Loja atualizada.');
      })}>{a.busy ? 'Salvando…' : 'Salvar'}</button></>}>
      <div className="small muted">CPF/CNPJ: <b className="mono">{maskDoc(loja.documento)}</b> (não muda — é o login da loja)</div>
      <div className="grid2 tight">
        <label className="field">Nome da loja<input className="input" value={f.nome} onChange={(e) => set('nome', e.target.value)} /></label>
        <label className="field">Responsável<input className="input" value={f.responsavel} onChange={(e) => set('responsavel', e.target.value)} /></label>
        <label className="field">WhatsApp<input className="input" inputMode="tel" value={f.telefone} onChange={(e) => set('telefone', maskPhoneBR(e.target.value))} /></label>
        <label className="field">Plano<input className="input" value={f.plano} onChange={(e) => set('plano', e.target.value)} placeholder="ex.: mensal" /></label>
        <label className="field">Valor mensal (R$)<input className="input num" inputMode="decimal" value={f.valor} onChange={(e) => set('valor', e.target.value.replace(/[^\d,.]/g, ''))} placeholder="0,00" /></label>
        <label className="field">Vencimento<input className="input" type="date" value={f.vencimento} onChange={(e) => set('vencimento', e.target.value)} /></label>
      </div>
      <label className="field">Observação interna (a loja não vê)<textarea className="input" rows={3} value={f.observacao} onChange={(e) => set('observacao', e.target.value)} /></label>
      {a.err && <div className="err">{a.err}</div>}
    </Modal>
  );
}

function ResetPassDlg({ loja, onClose, onDone }: { loja: LojaAdm; onClose: () => void; onDone: (m: string) => void }) {
  const [u, setU] = useState(loja.dono_usuario ?? ''); const [p] = useState(genPass()); const [ok, setOk] = useState(false); const a = useAct();
  if (ok) return (
    <Modal title="✅ Senha redefinida" onClose={() => onDone('Senha redefinida.')} size="sm" footer={<button className="btn btn-primary" onClick={() => onDone('Senha redefinida.')}>Pronto</button>}>
      <div>Envie para a loja (a senha não aparece de novo):</div>
      <div className="cred"><div><span>CPF/CNPJ</span><b className="mono">{maskDoc(loja.documento)}</b></div><div><span>Usuário</span><b className="mono">{u}</b></div><div><span>Senha</span><b className="mono">{p}</b></div></div>
      <button className="btn" onClick={() => navigator.clipboard?.writeText(`${BRAND.name}\n${BRAND.url}\nCPF/CNPJ: ${maskDoc(loja.documento)}\nUsuário: ${u}\nSenha: ${p}`)}>📋 Copiar</button>
    </Modal>
  );
  return (
    <Modal title="🔑 Redefinir senha de usuário da loja" onClose={onClose} size="sm"
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={a.busy || !u} onClick={() => a.run(async () => { await rpc('account_admin_password', { p_loja: loja.id, p_usuario: u, p_password: p }); setOk(true); })}>{a.busy ? 'Salvando…' : 'Gerar nova senha'}</button></>}>
      <Head l={loja} />
      <label className="field">Usuário da loja<input className="input mono" value={u} onChange={(e) => setU(e.target.value.trim().toLowerCase())} /></label>
      <div className="hint">Use quando o dono esqueceu a senha. Fica registrado no histórico da loja.</div>
      {a.err && <div className="err">{a.err}</div>}
    </Modal>
  );
}

function DetailDlg({ loja, onClose, open }: { loja: LojaAdm; onClose: () => void; open: (k: 'pag' | 'bloq' | 'desbloq' | 'edit' | 'senha', l: LojaAdm) => void }) {
  const [d, setD] = useState<LojaAdm | null>(null); const [err, setErr] = useState('');
  useEffect(() => { rpc<LojaAdm>('admin_loja', { p_loja: loja.id }).then(setD).catch((e) => setErr(e.message)); }, [loja.id]);
  const l = d ?? loja; const [st, cls] = SIT[l.situacao] ?? [l.situacao, ''];
  return (
    <Modal title={`🏪 ${l.nome}`} onClose={onClose} size="wide">
      <div className="kv">
        <div><span>{l.tipo_documento}</span><b className="mono">{maskDoc(l.documento)}</b></div>
        <div><span>Responsável</span><b>{l.responsavel || '—'}{l.telefone ? <> · <a href={`https://wa.me/55${l.telefone.replace(/^55/, '')}`} target="_blank" rel="noopener noreferrer">{maskPhoneBR(l.telefone)}</a></> : null}</b></div>
        <div><span>Situação</span><b><span className={`tag ${cls}`}>{st}</span> {l.motivo_bloqueio ? `— ${l.motivo_bloqueio}` : ''}</b></div>
        <div><span>Vencimento</span><b>{fmtD(l.vencimento)} ({l.dias_restantes} dias)</b></div>
        <div><span>Plano</span><b>{l.plano || '—'} · {formatBRL(l.valor_mensal_cents || 0)}/mês</b></div>
        <div><span>Criada em</span><b>{fmtDT(l.criado_em)}</b></div>
        <div><span>Último acesso</span><b>{fmtDT(l.ultimo_acesso)}</b></div>
        <div><span>Vendas</span><b>{l.vendas_mes} no mês ({formatBRL(l.total_mes_cents)}) · {l.vendas_total} no total</b></div>
        {l.observacao && <div><span>Observação</span><b>{l.observacao}</b></div>}
      </div>
      <div className="row wrap" style={{ gap: 6 }}>
        <button className="btn btn-sm btn-primary" onClick={() => open('pag', l)}>💰 Registrar pagamento</button>
        {l.status === 'bloqueada' ? <button className="btn btn-sm" onClick={() => open('desbloq', l)}>🔓 Desbloquear</button> : <button className="btn btn-sm btn-danger" onClick={() => open('bloq', l)}>🔒 Bloquear</button>}
        <button className="btn btn-sm" onClick={() => open('edit', l)}>✏️ Editar</button>
        <button className="btn btn-sm" onClick={() => open('senha', l)}>🔑 Redefinir senha</button>
      </div>
      {err && <div className="err">{err}</div>}
      {d && <div className="grid2">
        <div><h3>Pagamentos</h3>{!d.pagamentos?.length ? <div className="muted small">Nenhum ainda.</div> :
          <table className="t"><thead><tr><th>Data</th><th className="r">Valor</th><th>Forma</th><th>Venc. novo</th></tr></thead>
            <tbody>{d.pagamentos.map((p) => <tr key={p.id}><td>{fmtD(p.pago_em)}</td><td className="r">{formatBRL(p.valor_cents)}</td><td>{p.metodo}</td><td>{fmtD(p.vencimento_novo)}{p.observacao ? <div className="small muted">{p.observacao}</div> : null}</td></tr>)}</tbody></table>}
          <h3 style={{ marginTop: 14 }}>Equipe</h3>
          {(d.equipe ?? []).map((u) => <div key={u.usuario} className="small">{u.nome} · <span className="mono">{u.usuario}</span> · {u.papel}{u.ativo ? '' : ' (inativo)'}</div>)}
        </div>
        <div><h3>Histórico</h3>{!d.eventos?.length ? <div className="muted small">—</div> :
          <div className="adm-events">{d.eventos.map((e) => <div key={e.id} className="small"><b>{EVT[e.tipo] ?? e.tipo}</b> · {fmtDT(e.criado_em)}{e.motivo ? <> — {e.motivo}</> : null}</div>)}</div>}</div>
      </div>}
    </Modal>
  );
}

function NewStoreDlg({ cfg, onClose, onDone }: { cfg: Config; onClose: () => void; onDone: (m: string) => void }) {
  const hoje = todaySP();
  const [f, setF] = useState({ loja: '', doc: '', responsavel: '', usuario: '', whatsapp: '', status: 'teste', vencimento: addDays(hoje, cfg.dias_teste), plano: '', valor: '', observacao: '' });
  const [senha] = useState(genPass()); const [ok, setOk] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const a = useAct(); const tipo = docType(f.doc);
  if (ok) return (
    <Modal title="✅ Loja criada" onClose={() => onDone('Loja criada.')} size="sm" footer={<button className="btn btn-primary" onClick={() => onDone('Loja criada.')}>Pronto</button>}>
      <div>Envie os dados de acesso para a loja (a senha não aparece de novo):</div>
      <div className="cred"><div><span>Endereço</span><b>{BRAND.url}</b></div><div><span>CPF/CNPJ</span><b className="mono">{maskDoc(f.doc)}</b></div>
        <div><span>Usuário</span><b className="mono">{f.usuario}</b></div><div><span>Senha</span><b className="mono">{senha}</b></div></div>
      <button className="btn" onClick={() => navigator.clipboard?.writeText(`${BRAND.name}\n${BRAND.url}\nCPF/CNPJ: ${maskDoc(f.doc)}\nUsuário: ${f.usuario}\nSenha: ${senha}`)}>📋 Copiar</button>
      <div className="small muted">O dono pode trocar a senha em Configurações › Minha conta.</div>
    </Modal>
  );
  return (
    <Modal title="+ Nova loja" onClose={onClose} size="mid"
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={a.busy} onClick={() => a.run(async () => {
        if (!tipo) throw new Error('CPF ou CNPJ inválido.');
        const c = f.valor.trim() === '' ? 0 : toCents(f.valor);
        if (!Number.isFinite(c) || c < 0) throw new Error('Valor mensal inválido.');
        await rpc('account_admin_new_loja', { p_data: { loja_nome: f.loja.trim(), documento: docDigits(f.doc), responsavel: f.responsavel.trim(), usuario: f.usuario, senha,
          whatsapp: f.whatsapp.replace(/\D/g, ''), status: f.status, vencimento: f.vencimento, plano: f.plano, valor_mensal_cents: c, observacao: f.observacao } });
        setOk(true);
      })}>{a.busy ? 'Criando…' : 'Criar loja'}</button></>}>
      <div className="grid2 tight">
        <label className="field">Nome da loja<input className="input" value={f.loja} onChange={(e) => set('loja', e.target.value)} autoFocus /></label>
        <label className="field">CPF ou CNPJ<input className="input mono" value={f.doc} onChange={(e) => set('doc', maskDoc(e.target.value))} />
          <span className="hint">{tipo ? `✓ ${tipo} válido` : docDigits(f.doc).length >= 11 ? 'Inválido' : ' '}</span></label>
        <label className="field">Responsável<input className="input" value={f.responsavel} onChange={(e) => set('responsavel', e.target.value)} /></label>
        <label className="field">Usuário do dono<input className="input mono" value={f.usuario} onChange={(e) => set('usuario', e.target.value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9._-]/g, ''))} /></label>
        <label className="field">WhatsApp<input className="input" inputMode="tel" value={f.whatsapp} onChange={(e) => set('whatsapp', maskPhoneBR(e.target.value))} /></label>
        <label className="field">Situação<select className="input" value={f.status} onChange={(e) => set('status', e.target.value)}><option value="teste">Teste</option><option value="ativa">Ativa</option></select></label>
        <label className="field">Vencimento<input className="input" type="date" min={hoje} value={f.vencimento} onChange={(e) => set('vencimento', e.target.value)} /></label>
        <label className="field">Valor mensal (R$)<input className="input num" inputMode="decimal" value={f.valor} onChange={(e) => set('valor', e.target.value.replace(/[^\d,.]/g, ''))} placeholder="0,00" /></label>
        <label className="field">Plano<input className="input" value={f.plano} onChange={(e) => set('plano', e.target.value)} placeholder="ex.: mensal" /></label>
        <label className="field">Observação<input className="input" value={f.observacao} onChange={(e) => set('observacao', e.target.value)} /></label>
      </div>
      <div className="hint">Uma senha temporária é gerada e mostrada uma única vez.</div>
      {a.err && <div className="err">{a.err}</div>}
    </Modal>
  );
}

function MyPassDlg({ usuario, onClose, onDone }: { usuario: string; onClose: () => void; onDone: (m: string) => void }) {
  const [cur, setCur] = useState(''); const [n1, setN1] = useState(''); const [n2, setN2] = useState(''); const a = useAct();
  return (
    <Modal title="🔑 Trocar minha senha" onClose={onClose} size="sm"
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={a.busy || !cur || !n1} onClick={() => a.run(async () => {
        if (n1.length < 12) throw new Error('Use pelo menos 12 caracteres.');
        if (n1 !== n2) throw new Error('As duas senhas novas não são iguais.');
        await changePassword(usuario, cur, n1); onDone('Senha trocada.');
      })}>{a.busy ? 'Trocando…' : 'Trocar senha'}</button></>}>
      <label className="field">Senha atual<input className="input" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} autoFocus /></label>
      <label className="field">Nova senha (mín. 12)<input className="input" type="password" autoComplete="new-password" value={n1} onChange={(e) => setN1(e.target.value)} /></label>
      <label className="field">Repita a nova senha<input className="input" type="password" autoComplete="new-password" value={n2} onChange={(e) => setN2(e.target.value)} /></label>
      {a.err && <div className="err">{a.err}</div>}
    </Modal>
  );
}

function ConfigDlg({ cfg, onClose, onDone }: { cfg: Config; onClose: () => void; onDone: (c: Config) => void }) {
  const [f, setF] = useState({ carencia_dias: String(cfg.carencia_dias), dias_teste: String(cfg.dias_teste), aviso_dias: String(cfg.aviso_dias) }); const a = useAct();
  return (
    <Modal title="⚙️ Regras da plataforma" onClose={onClose} size="sm"
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={a.busy} onClick={() => a.run(async () => { onDone(await rpc<Config>('admin_config_salvar', { p_data: f })); })}>Salvar</button></>}>
      <label className="field">Carência depois do vencimento (dias)<input className="input num" inputMode="numeric" value={f.carencia_dias} onChange={(e) => setF({ ...f, carencia_dias: e.target.value.replace(/\D/g, '') })} />
        <span className="hint">Lojas ativas continuam usando por estes dias depois de vencer (com aviso). Teste não tem carência.</span></label>
      <label className="field">Dias de teste grátis (novas lojas)<input className="input num" inputMode="numeric" value={f.dias_teste} onChange={(e) => setF({ ...f, dias_teste: e.target.value.replace(/\D/g, '') })} /></label>
      <label className="field">Avisar a loja quantos dias antes<input className="input num" inputMode="numeric" value={f.aviso_dias} onChange={(e) => setF({ ...f, aviso_dias: e.target.value.replace(/\D/g, '') })} /></label>
      {a.err && <div className="err">{a.err}</div>}
    </Modal>
  );
}
