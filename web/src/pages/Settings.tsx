import { useEffect, useState } from 'react';
import { authUrl, get, post, put, getTerminal, setTerminal, fmtDateTime, IS_SB } from '../api';
import { backupJson, backupCsv, BACKUP_TABLES } from '../files';
import { useApp } from '../ctx';
import { maskDoc } from '../doc';
import { Modal } from '../components/Modal';
import { ROLE_LABEL, ROLES, Role, pctToText, parseScaleLabel, scaleLabelQty, sameProductCode, formatQty, formatBRL, Product, normalizeScan, BRAND } from '@folha/shared';
import { beepEnabled, setBeepEnabled, scanOk } from '../scan/feedback';
import { Scanner } from '../components/Scanner';
import { APP_VERSION } from '../version';
import { ImageCreditsLink } from '../components/ImageCredits';
import { InstallStatus } from '../components/Install';
import { SubscriptionCard, SampleProducts } from '../components/Subscription';

type Tab = 'loja' | 'usuarios' | 'backup' | 'auditoria' | 'conta';
export function Settings({ tab: tabProp }: { tab?: string }) {
  const { toast, user, refreshStatus, go } = useApp();
  const [s, setS] = useState<any>(null);
  const [term, setTerm] = useState(getTerminal());
  const [users, setUsers] = useState<any[]>([]);
  const [backups, setBackups] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [editUser, setEditUser] = useState<any>(null);
  const [passUser, setPassUser] = useState<any>(null);
  const isAdmin = user?.role === 'admin';
  const isMgr = user?.role === 'admin' || user?.role === 'gerente';
  const TABS = ([['loja', 'Loja e cupom'], ['usuarios', 'Usuários'], ['backup', 'Backup'], ['auditoria', 'Auditoria'],
    ...(IS_SB ? [['conta', 'Minha conta']] as const : [])] as const).filter(([k]) => isMgr || k === 'conta');
  const tab: Tab = (TABS.find(([k]) => k === tabProp)?.[0] ?? TABS[0]?.[0] ?? 'conta') as Tab;
  const setTab = (t: Tab) => go(`config/${t}`);
  const loadUsers = () => get('/api/users').then(setUsers).catch(() => {});
  useEffect(() => {
    get('/api/settings').then(setS).catch(() => setS({})); if (isMgr) loadUsers();
    if (isMgr) { get('/api/backup').then(setBackups).catch(() => {}); get('/api/audit?limit=150').then(setAudit).catch(() => {}); }
  }, []); // eslint-disable-line
  const set = (k: string, v: any) => setS((x: any) => ({ ...x, [k]: v }));
  const save = async () => {
    try { setS(await put('/api/settings', s)); setTerminal(term); toast('Configurações salvas.'); refreshStatus(); }
    catch (e: any) { toast(e.message, 'erro'); }
  };
  const backup = async () => {
    try { const r = await post('/api/backup'); toast(`Backup criado: ${r.file}`); setBackups(await get('/api/backup')); }
    catch (e: any) { toast(e.message, 'erro'); }
  };
  const testPrinter = async () => { const r = await post('/api/printer/test'); toast(r.ok ? 'Impressora respondeu.' : r.error, r.ok ? 'ok' : 'erro'); };
  if (!s) return <div className="page">Carregando…</div>;
  void isAdmin;
  return (
    <div className="page">
      <div className="page-title"><h1>⚙️ Configurações</h1>
        <div className="tabs">{TABS.map(([k, l]) =>
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k as Tab)}>{l}</button>)}</div></div>
      {tab === 'loja' && isMgr && <>
        <div className="grid2">
          <div className="card col">
            <h3>Dados da loja (saem no cupom)</h3>
            <label className="field">Nome da loja (sai no cupom)<input className="input" value={s.name} onChange={(e) => set('name', e.target.value)} /></label>
            <label className="field">Razão social<input className="input" value={s.legal_name} onChange={(e) => set('legal_name', e.target.value)} /></label>
            <div className="grid2">
              <label className="field">CNPJ<input className="input" value={s.cnpj} onChange={(e) => set('cnpj', e.target.value)} /></label>
              <label className="field">Telefone<input className="input" value={s.phone} onChange={(e) => set('phone', e.target.value)} /></label>
            </div>
            <label className="field">Endereço<input className="input" value={s.address} onChange={(e) => set('address', e.target.value)} /></label>
            <label className="field">Mensagem do rodapé<input className="input" value={s.receipt_footer} onChange={(e) => set('receipt_footer', e.target.value)} /></label>
          </div>
          <div className="card col">
            <h3>Regras do caixa</h3>
            <label className="field">Desconto máximo sem gerente: {pctToText(s.discount_limit_pct)}
              <input type="range" min={0} max={5000} step={100} value={s.discount_limit_pct} onChange={(e) => set('discount_limit_pct', Number(e.target.value))} style={{ accentColor: 'var(--folha)', height: 40 }} /></label>
            <label className="check"><input type="checkbox" checked={s.allow_negative_stock} onChange={(e) => set('allow_negative_stock', e.target.checked)} /> Liberar estoque negativo (vender mesmo sem saldo)</label>
            <label className="field">Alerta de validade (dias antes)<input className="input" type="number" min={0} max={60} value={s.expiry_alert_days} onChange={(e) => set('expiry_alert_days', Number(e.target.value))} /></label>
            <label className="field">Nome deste terminal<input className="input" value={term} onChange={(e) => setTerm(e.target.value)} /></label>
            <h3 style={{ marginTop: 6 }}>Impressora térmica (rede, ESC/POS 80 mm)</h3>
            {IS_SB ? <div className="small muted">No modo online (navegador) não dá para mandar direto para a térmica de rede (porta 9100): o navegador não abre essa conexão.
              Use <b>Imprimir (80 mm)</b> com a impressora instalada no celular/PC, ou baixe o <b>PDF</b> / <b>.bin</b> (ESC/POS) do cupom.
              A impressão direta funciona na versão local (servidor na banca).</div> : <>
            <div className="grid2" style={{ gridTemplateColumns: '2fr 1fr' }}>
              <label className="field">IP da impressora<input className="input" placeholder="192.168.0.50 (vazio = sem impressora)" value={s.printer_host} onChange={(e) => set('printer_host', e.target.value)} /></label>
              <label className="field">Porta<input className="input" type="number" value={s.printer_port} onChange={(e) => set('printer_port', Number(e.target.value))} /></label>
            </div>
            <button className="btn" onClick={testPrinter}>Testar impressora</button></>}
            <h3 style={{ marginTop: 6 }}>Etiqueta de balança (EAN começando com 2)</h3>
            <div className="grid2">
              <label className="field">Valor na etiqueta<select className="input" value={s.scale_label_mode} onChange={(e) => set('scale_label_mode', e.target.value)}>
                <option value="peso">Peso (gramas)</option><option value="preco">Preço (centavos)</option></select></label>
              <label className="field">Dígitos do código<select className="input" value={s.scale_code_digits} onChange={(e) => set('scale_code_digits', Number(e.target.value))}>
                <option value={4}>4</option><option value={5}>5</option><option value={6}>6</option></select></label>
            </div>
            <ScaleLabelHelp mode={s.scale_label_mode} digits={s.scale_code_digits} />
            <h3 style={{ marginTop: 6 }}>Leitor de código de barras (este aparelho)</h3>
            <BeepToggle />
            <div className="small muted">📷 na venda, no cadastro de produto e nas compras usa a câmera. Leitor USB/Bluetooth (modo teclado, com Enter no fim) funciona direto na tela de venda. Versão do app: <b>{APP_VERSION}</b></div>
          </div>
        </div>
        <div className="row"><span className="spacer" /><button className="btn btn-primary btn-big" onClick={save}>Salvar configurações</button></div>
        {IS_SB && <SampleProducts />}
      </>}
      {tab === 'usuarios' && isMgr && (
        <div className="card">
          <div className="row wrap" style={{ marginBottom: 10 }}><h3 className="grow" style={{ margin: 0 }}>Usuários da banca</h3>
            {isAdmin && <button className="btn btn-primary" onClick={() => setEditUser({ name: '', role: 'operador', active: true })}>+ Novo usuário</button>}</div>
          <div className="table-wrap"><table className="t"><thead><tr><th>Nome</th>{IS_SB && <th>Usuário</th>}<th>Papel</th><th>PIN</th><th>Situação</th><th /></tr></thead>
            <tbody>{users.map((u) => <tr key={u.id}><td><b>{u.name}</b>{u.id === user?.id && <span className="tag" style={{ marginLeft: 6 }}>você</span>}</td>
              {IS_SB && <td className="mono">{u.username ?? <span className="muted">— só PIN</span>}</td>}
              <td><span className={`tag role-${u.role}`}>{ROLE_LABEL[u.role as Role]}</span></td>
              <td>{u.has_pin === false ? <span className="tag warn">sem PIN</span> : <span className="muted">••••</span>}</td>
              <td>{u.active ? <span className="tag ok">Ativo</span> : <span className="tag bad">Inativo</span>}</td>
              <td className="r">{isAdmin && <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                <button className="btn btn-sm" onClick={() => setEditUser({ ...u, active: !!u.active })}>Editar / PIN</button>
                {IS_SB && u.has_login && <button className="btn btn-sm" onClick={() => setPassUser(u)}>Nova senha</button>}</div>}</td></tr>)}</tbody></table></div>
          <div className="small muted" style={{ marginTop: 8 }}>
            {IS_SB ? 'Cada pessoa entra com usuário e senha; no caixa, troca de operador com o PIN de 4 dígitos. ' : ''}
            Gerente autoriza cancelamento, desconto acima do limite, perda e ajuste. Só o admin cria e altera usuários.</div>
        </div>
      )}
      {tab === 'backup' && isMgr && IS_SB && <OnlineBackup />}
      {tab === 'conta' && IS_SB && <><SubscriptionCard /><div style={{ height: 14 }} /><MyAccount /></>}
      {tab === 'backup' && isMgr && !IS_SB && (
        <div className="card col">
          <h3>Backup do banco (SQLite)</h3>
          <div className="muted">Faça no fim do dia e copie para um pendrive. O arquivo tem todas as vendas, estoque e fiado.</div>
          <div><button className="btn btn-primary btn-big" onClick={backup}>💾 Fazer backup agora</button></div>
          <table className="t"><thead><tr><th>Arquivo</th><th>Data</th><th className="r">Tamanho</th><th /></tr></thead>
            <tbody>{backups.map((b) => <tr key={b.file}><td>{b.file}</td><td>{new Date(b.created_at).toLocaleString('pt-BR')}</td><td className="r">{(b.size / 1024).toFixed(0)} KB</td>
              <td className="r"><a className="btn btn-sm" href={authUrl(`/api/backup/${b.file}`)}>⬇ Baixar</a></td></tr>)}</tbody></table>
        </div>
      )}
      {tab === 'auditoria' && isMgr && (
        <div className="card">
          <h3>Log de auditoria (últimos 150)</h3>
          <table className="t"><thead><tr><th>Data/hora</th><th>Usuário</th><th>Ação</th><th>Detalhes</th></tr></thead>
            <tbody>{audit.map((a) => <tr key={a.id}><td>{fmtDateTime(a.created_at)}</td><td>{a.user_name ?? '—'}</td><td><span className="tag">{a.action}</span></td>
              <td className="small muted" style={{ maxWidth: 520, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.details}</td></tr>)}</tbody></table>
        </div>
      )}
      {editUser && <UserForm u={editUser} onClose={() => setEditUser(null)} onDone={async () => { setEditUser(null); loadUsers(); }} />}
      {passUser && <PasswordForm u={passUser} onClose={() => setPassUser(null)} />}
      <div className="small muted about-line">{BRAND.name} {APP_VERSION} · <InstallStatus /> · <ImageCreditsLink /></div>
    </div>
  );
}

const genPass = () => { const a = 'abcdefghjkmnpqrstuvwxyz23456789'; const r = crypto.getRandomValues(new Uint8Array(10)); return Array.from(r, (x) => a[x % a.length]).join(''); };
const cleanUser = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9._-]/g, '');

function UserForm({ u, onClose, onDone }: { u: any; onClose: () => void; onDone: () => void }) {
  const { toast, loja } = useApp();
  const docTxt = loja ? maskDoc(loja.documento) : '';
  const isNew = !u.id;
  const [f, setF] = useState({ ...u, pin: '', username: u.username ?? '', password: isNew && IS_SB ? genPass() : '' }); const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ username: string; password: string; doc?: string } | null>(null);
  const save = async () => {
    setErr('');
    if (!f.name.trim()) return setErr('Digite o nome.');
    if (f.pin && !/^\d{4}$/.test(f.pin)) return setErr('O PIN precisa ter 4 números.');
    if (isNew && !IS_SB && !f.pin) return setErr('Informe o PIN de 4 dígitos.');
    if (isNew && IS_SB) {
      if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(f.username)) return setErr('Usuário: 3 a 30 letras minúsculas ou números, sem espaço.');
      if (f.password.length < 8) return setErr('A senha precisa ter pelo menos 8 caracteres.');
      if (f.role !== 'operador' && !f.pin) return setErr('Gerente e admin precisam de PIN (é com ele que autorizam no caixa).');
    }
    const body: any = { name: f.name.trim(), role: f.role, active: f.active }; if (f.pin) body.pin = f.pin;
    setBusy(true);
    try {
      if (!isNew) await put(`/api/users/${u.id}`, body);
      else if (IS_SB) { await post('/api/users', { ...body, username: f.username, password: f.password }); setCreated({ username: f.username, password: f.password, doc: docTxt }); onDoneLater(); return; }
      else await post('/api/users', body);
      toast('Usuário salvo.'); onDone();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const onDoneLater = () => { toast('Usuário criado.'); };
  if (created) return (
    <Modal title="✅ Usuário criado" onClose={onDone}
      footer={<button className="btn btn-primary" onClick={onDone}>Pronto</button>}>
      <div>Passe estes dados para <b>{f.name}</b> (anote agora — a senha não aparece de novo):</div>
      <div className="cred"><div><span>Endereço</span><b>{location.origin + location.pathname}</b></div>
        <div><span>CPF/CNPJ da loja</span><b className="mono">{created.doc}</b></div>
        <div><span>Usuário</span><b className="mono">{created.username}</b></div><div><span>Senha</span><b className="mono">{created.password}</b></div></div>
      <button className="btn" onClick={() => navigator.clipboard?.writeText(`${BRAND.name}\n${location.origin + location.pathname}\nCPF/CNPJ da loja: ${created.doc ?? ''}\nUsuário: ${created.username}\nSenha: ${created.password}`).then(() => toast('Copiado.'))}>📋 Copiar dados</button>
      <div className="small muted">A pessoa pode trocar a senha depois em Minha conta.</div>
    </Modal>
  );
  return (
    <Modal title={isNew ? 'Novo usuário' : `Editar ${u.name}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Voltar</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Salvando…' : isNew ? 'Criar usuário' : 'Salvar'}</button></>}>
      <label className="field">Nome<input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, ...(isNew && IS_SB && !u._touched ? { username: cleanUser(e.target.value.split(' ')[0] ?? '') } : {}) })} autoFocus /></label>
      {isNew && IS_SB && <div className="grid2 tight">
        <label className="field">Usuário (para entrar)<input className="input mono" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={f.username}
          onChange={(e) => { u._touched = true; setF({ ...f, username: cleanUser(e.target.value) }); }} /></label>
        <label className="field">Senha inicial<div className="row" style={{ gap: 6 }}><input className="input mono" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          <button type="button" className="btn btn-sm" title="Gerar outra" onClick={() => setF({ ...f, password: genPass() })}>↻</button></div></label>
      </div>}
      {!isNew && IS_SB && u.username && <div className="muted small">Usuário: <b className="mono">{u.username}</b> (não muda)</div>}
      <div className="field"><span>Papel</span><div className="tabs">{ROLES.map((r) => <button key={r} type="button" className={f.role === r ? 'on' : ''} onClick={() => setF({ ...f, role: r })}>{ROLE_LABEL[r]}</button>)}</div>
        <span className="hint">{f.role === 'operador' ? 'Vende, abre/fecha caixa, recebe fiado.' : f.role === 'gerente' ? 'Tudo do operador + produtos, preços, compras, relatórios e autorizações.' : 'Tudo + cria usuários e senhas.'}</span></div>
      <label className="field">{isNew ? `PIN de 4 números${f.role === 'operador' ? ' (opcional, para trocar de operador no caixa)' : ''}` : 'Novo PIN (deixe vazio para manter)'}
        <input className="input num pin-input" inputMode="numeric" maxLength={4} value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, '').slice(0, 4) })} /></label>
      {!isNew && <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Ativo (desmarque para bloquear a entrada)</label>}
      {err && <div className="err">{err}</div>}
    </Modal>
  );
}

function PasswordForm({ u, onClose }: { u: any; onClose: () => void }) {
  const { toast } = useApp();
  const [p, setP] = useState(genPass()); const [err, setErr] = useState(''); const [done, setDone] = useState(false); const [busy, setBusy] = useState(false);
  const save = async () => {
    if (p.length < 8) return setErr('A senha precisa ter pelo menos 8 caracteres.');
    setBusy(true); setErr('');
    try { await post(`/api/users/${u.id}/password`, { password: p }); setDone(true); toast('Senha trocada.'); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Nova senha — ${u.name}`} onClose={onClose} size="sm"
      footer={done ? <button className="btn btn-primary" onClick={onClose}>Pronto</button> : <><button className="btn" onClick={onClose}>Voltar</button><button className="btn btn-primary" disabled={busy} onClick={save}>Trocar senha</button></>}>
      {done ? <div className="cred"><div><span>Usuário</span><b className="mono">{u.username}</b></div><div><span>Nova senha</span><b className="mono">{p}</b></div></div> : <>
        <div className="muted">Use quando a pessoa esqueceu a senha. A senha antiga para de funcionar na hora.</div>
        <label className="field">Nova senha<div className="row" style={{ gap: 6 }}><input className="input mono" value={p} onChange={(e) => setP(e.target.value)} />
          <button type="button" className="btn btn-sm" onClick={() => setP(genPass())}>↻</button></div></label></>}
      {err && <div className="err">{err}</div>}
    </Modal>
  );
}

/** Modo online: exporta todas as tabelas (JSON único ou CSV por tabela) */
function OnlineBackup() {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<unknown>) => { setBusy(true); try { await f(); } catch (e: any) { toast(e.message, 'erro'); } finally { setBusy(false); } };
  return (
    <div className="card col">
      <h3>Backup dos dados online</h3>
      <div className="muted">Os dados ficam no banco online (Supabase). Baixe uma cópia no fim do dia e guarde no computador ou no Drive.
        O arquivo JSON tem todas as tabelas (vendas, estoque, fiado, caixa, auditoria). Os PINs não saem no backup.</div>
      <div><button className="btn btn-primary btn-big" disabled={busy} onClick={() => run(async () => { const n = await backupJson(); toast(`Backup baixado (${n} registros).`); })}>
        💾 {busy ? 'Gerando…' : 'Baixar backup completo (JSON)'}</button></div>
      <h3 style={{ marginTop: 8 }}>CSV por tabela (abre no Excel)</h3>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        {BACKUP_TABLES.map((t) => <button key={t} className="btn btn-sm" disabled={busy} onClick={() => run(() => backupCsv(t))}>⬇ {t}</button>)}
      </div>
    </div>
  );
}

/** Modo online: a conta (usuário + senha) conectada neste aparelho — trocar senha e sair */
function MyAccount() {
  const { toast, store, storeLogout, user } = useApp();
  const [cur, setCur] = useState(''); const [n1, setN1] = useState(''); const [n2, setN2] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const change = async () => {
    setErr('');
    if (n1.length < 8) { setErr('A nova senha precisa ter pelo menos 8 caracteres.'); return; }
    if (n1 !== n2) { setErr('As duas senhas novas não são iguais.'); return; }
    setBusy(true);
    try {
      const a = await import('../backend/accounts');
      await a.changeOwnPassword(cur, n1);
      setCur(''); setN1(''); setN2(''); toast('Senha trocada. Use a nova nos outros aparelhos.');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="grid2">
      <div className="card col">
        <h3>Trocar minha senha</h3>
        <div className="muted">Login deste aparelho: <b className="mono">{store}</b>{user?.username && user.username !== store ? <> · no caixa agora: <b>{user.name}</b> (PIN)</> : null}.</div>
        <label className="field">Senha atual<input className="input" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></label>
        <label className="field">Nova senha (mín. 8)<input className="input" type="password" autoComplete="new-password" value={n1} onChange={(e) => setN1(e.target.value)} /></label>
        <label className="field">Repita a nova senha<input className="input" type="password" autoComplete="new-password" value={n2} onChange={(e) => setN2(e.target.value)} /></label>
        {err && <div className="err">{err}</div>}
        <div><button className="btn btn-primary" disabled={busy || !cur || !n1} onClick={change}>{busy ? 'Trocando…' : 'Trocar senha'}</button></div>
      </div>
      <div className="card col">
        <h3>Este aparelho</h3>
        <div className="muted">“Sair da conta” desconecta este celular/PC. Para usar de novo, entre com usuário e senha.
          Para só passar o caixa para outra pessoa, use <b>Trocar operador (PIN)</b> no menu do seu nome.</div>
        <div><button className="btn btn-danger" onClick={() => { if (confirm('Sair da conta neste aparelho?')) storeLogout(); }}>Sair da conta</button></div>
      </div>
    </div>
  );
}

function BeepToggle() {
  const [on, setOn] = useState(beepEnabled());
  return <label className="check"><input type="checkbox" checked={on} onChange={(e) => { setBeepEnabled(e.target.checked); setOn(e.target.checked); if (e.target.checked) scanOk(); }} /> Bipe ao ler um código (a vibração no celular continua)</label>;
}

/** explica o layout e deixa testar uma etiqueta (digitando ou com a câmera) antes de salvar */
function ScaleLabelHelp({ mode, digits }: { mode: 'peso' | 'preco'; digits: number }) {
  const [code, setCode] = useState('');
  const [scan, setScan] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  useEffect(() => { get('/api/products').then(setProducts).catch(() => {}); }, []);
  const vlen = 11 - digits;
  const c = normalizeScan(code);
  const lbl = c ? parseScaleLabel(c, digits) : null;
  const p = lbl ? products.find((x) => sameProductCode(x.code, lbl.productCode)) : undefined;
  let out: string | null = null;
  if (c && !lbl) out = /^2\d{12}$/.test(c) ? 'Dígito verificador errado: confira o número.' : 'Não é etiqueta de balança (precisa ter 13 dígitos e começar com 2).';
  else if (lbl && !p) out = `Código do produto ${lbl.productCode} · valor ${lbl.value} — nenhum produto com esse código (PLU) no cadastro.`;
  else if (lbl && p) {
    const q = scaleLabelQty(p, lbl.value, mode);
    out = `${p.icon} ${p.name} (cód. ${p.code}) · ${mode === 'peso' ? `peso ${formatQty(q, p.unit)}` : `preço ${formatBRL(lbl.value)} → ${formatQty(q, p.unit)}`} · total ${formatBRL(Math.round(p.price_cents * q / 1000))}`;
  }
  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="small muted">Formato: <span className="mono">2 · {'C'.repeat(digits)} · {'V'.repeat(vlen)} · D</span> — “2”, o <b>código do produto</b> ({digits} dígitos, é o <b>Código (PLU)</b> do cadastro), o {mode === 'peso' ? <b>peso em gramas</b> : <b>preço total em centavos</b>} ({vlen} dígitos) e o dígito verificador. Configure na balança o mesmo código do produto daqui.</div>
      <div className="field-scan"><input className="input" inputMode="numeric" placeholder="Testar uma etiqueta: digite ou leia (ex.: 2001010015006)" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Testar etiqueta de balança" />
        <button type="button" className="btn" onClick={() => setScan(true)} aria-label="Ler etiqueta com a câmera">📷</button></div>
      {out && <div className={lbl && p ? 'ok-box' : 'warn-mini'} data-testid="scale-test">{out}</div>}
      {scan && <Scanner title="Testar etiqueta de balança" onClose={() => setScan(false)} onDetected={(x) => { scanOk(); setCode(x); return { close: true }; }} />}
    </div>
  );
}
