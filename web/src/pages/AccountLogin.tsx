import { useState } from 'react';
import { BRAND, supportLink } from '@folha/shared';
import { useApp } from '../ctx';
import { LoginSide, MobileBrand } from '../components/LoginSide';
import { InstallButton } from '../components/Install';
import { USER_RE } from '../text';
import { docDigits, docType, maskDoc, maskPhoneBR } from '../doc';
import { knownStores } from '../backend/accounts';

const suggestUser = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().split(/\s+/)[0]?.replace(/[^a-z0-9._-]/g, '') ?? '';
const cleanTyping = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9._-]/g, '');

/** Modo online: entra com CPF/CNPJ DA LOJA + USUÁRIO + SENHA, ou cria a conta de uma loja nova (teste grátis). */
export function AccountLogin() {
  const [mode, setMode] = useState<'login' | 'cadastro'>(() => (location.hash.includes('criar-conta') ? 'cadastro' : 'login'));
  return (
    <div className="login">
      <LoginSide />
      <div className="login-main">
        <div className="login-box">
          <MobileBrand />
          {mode === 'cadastro' ? <Register onLogin={() => setMode('login')} /> : <LoginForm onRegister={() => setMode('cadastro')} />}
          <div className="login-install"><InstallButton className="btn btn-ghost install-link" label="Instalar o app neste aparelho" /></div>
        </div>
      </div>
    </div>
  );
}

function PassInput({ value, onChange, autoComplete, id }: { value: string; onChange: (v: string) => void; autoComplete: string; id?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="pass">
      <input id={id} className="input" type={show ? 'text' : 'password'} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} required />
      <button type="button" className="eye" onClick={() => setShow(!show)} aria-label={show ? 'Esconder senha' : 'Mostrar senha'}>{show ? '🙈' : '👁'}</button>
    </div>
  );
}

function DocInput({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return <input className="input mono" inputMode="text" autoCapitalize="characters" autoCorrect="off" spellCheck={false} autoComplete="off"
    value={value} onChange={(e) => onChange(maskDoc(e.target.value))} placeholder="000.000.000-00 ou 00.000.000/0000-00" autoFocus={autoFocus} required />;
}

function LoginForm({ onRegister }: { onRegister: () => void }) {
  const { passwordLogin } = useApp();
  const [doc, setDoc] = useState(() => maskDoc(localStorage.getItem('cc.lastDoc') ?? ''));
  const [u, setU] = useState(() => localStorage.getItem('cc.lastUser') ?? '');
  const [p, setP] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const known = knownStores()[docDigits(doc)];
  const tipo = docType(doc);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('');
    if (!tipo) return setErr('CPF ou CNPJ inválido. Confira os números.');
    setBusy(true);
    try { await passwordLogin(doc, u, p); localStorage.setItem('cc.lastUser', u); }
    catch (e: any) { setErr(e.message); setBusy(false); }
  };
  return (
    <form className="col" style={{ gap: 14 }} onSubmit={submit}>
      <div>
        <div className="eyebrow">Bem-vindo de volta</div>
        <h1 className="login-h1">Entrar na loja</h1>
        <div className="muted">Use o CPF ou CNPJ da loja e o seu usuário.</div>
      </div>
      <label className="field">CPF ou CNPJ da loja
        <DocInput value={doc} onChange={setDoc} autoFocus={!doc} />
        {known ? <span className="hint signup-doc-ok">🏪 {known}</span>
          : docDigits(doc).length >= 11 && !tipo ? <span className="hint" style={{ color: 'var(--erro, #B42318)' }}>CPF/CNPJ inválido.</span> : null}
      </label>
      <label className="field">Usuário
        <input className="input" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" inputMode="text"
          value={u} onChange={(e) => setU(cleanTyping(e.target.value))} placeholder="ex.: maria" autoFocus={!!doc && !u} required /></label>
      <label className="field">Senha<PassInput value={p} onChange={setP} autoComplete="current-password" /></label>
      {err && <div className="err">{err}</div>}
      <button className="btn btn-primary btn-big" disabled={busy || !doc || !u || !p} type="submit">{busy ? 'Entrando…' : 'Entrar'}</button>
      <button type="button" className="btn btn-lima" onClick={onRegister}>🏪 Criar conta da loja — {BRAND.trialDays} dias grátis</button>
      <div className="small muted center">Esqueceu a senha? Peça ao dono da loja (Configurações › Usuários). O dono pode falar com o <a href={supportLink('Esqueci a senha do dono da loja.')} target="_blank" rel="noopener noreferrer">suporte</a>.</div>
    </form>
  );
}

function Register({ onLogin }: { onLogin: () => void }) {
  const { register } = useApp();
  const [f, setF] = useState({ loja: '', doc: '', responsavel: '', username: '', password: '', password2: '', whatsapp: '', pin: '' });
  const [aceite, setAceite] = useState(false);
  const [touchedUser, setTouchedUser] = useState(false);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const tipo = docType(f.doc);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('');
    if (f.loja.trim().length < 2) return setErr('Digite o nome da loja.');
    if (!tipo) return setErr('CPF ou CNPJ inválido. Confira os números (os dígitos verificadores não batem).');
    if (!f.responsavel.trim()) return setErr('Digite o nome do responsável.');
    if (!USER_RE.test(f.username)) return setErr('Usuário: de 3 a 30 letras minúsculas ou números, sem espaço (pode usar . - _).');
    if (f.password.length < 8) return setErr('A senha precisa ter pelo menos 8 caracteres.');
    if (f.password !== f.password2) return setErr('As duas senhas não são iguais.');
    const wa = f.whatsapp.replace(/\D/g, '');
    if (wa && wa.length < 10) return setErr('WhatsApp: digite com DDD (ex.: (11) 91234-5678).');
    if (f.pin && !/^\d{4}$/.test(f.pin)) return setErr('O PIN precisa ter 4 números (ou deixe vazio).');
    if (!aceite) return setErr('Marque que você concorda com o uso dos dados descrito abaixo.');
    setBusy(true);
    try {
      await register({ loja_nome: f.loja.trim(), documento: f.doc, responsavel: f.responsavel.trim(), usuario: f.username, senha: f.password, whatsapp: wa, pin: f.pin || undefined });
      localStorage.setItem('cc.lastUser', f.username);
    } catch (e: any) { setErr(e.message); setBusy(false); }
  };
  return (
    <form className="col" style={{ gap: 12 }} onSubmit={submit}>
      <div>
        <div className="eyebrow">Teste grátis por {BRAND.trialDays} dias</div>
        <h1 className="login-h1">Criar conta da loja</h1>
        <div className="muted">Em 1 minuto sua loja está vendendo no {BRAND.name}. Sem cartão de crédito.</div>
      </div>
      <label className="field">Nome da loja<input className="input" value={f.loja} autoComplete="organization" autoFocus
        onChange={(e) => set('loja', e.target.value)} placeholder="ex.: Hortifruti Boa Safra" required /></label>
      <label className="field">CPF ou CNPJ da loja
        <DocInput value={f.doc} onChange={(v) => set('doc', v)} />
        <span className="hint">{tipo ? <span className="signup-doc-ok">✓ {tipo} válido</span> : docDigits(f.doc).length >= 11 ? <span style={{ color: 'var(--erro, #B42318)' }}>Número inválido</span> : 'É com ele que todo mundo da loja vai entrar.'}</span></label>
      <label className="field">Nome do responsável<input className="input" value={f.responsavel} autoComplete="name"
        onChange={(e) => { set('responsavel', e.target.value); if (!touchedUser) set('username', suggestUser(e.target.value)); }} placeholder="ex.: Ana Souza" required /></label>
      <div className="grid2 tight">
        <label className="field">Usuário (para entrar)
          <input className="input" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" value={f.username}
            onChange={(e) => { setTouchedUser(true); set('username', cleanTyping(e.target.value)); }} placeholder="ex.: ana" required />
          <span className="hint">Minúsculas, sem espaço.</span></label>
        <label className="field">WhatsApp
          <input className="input" inputMode="tel" autoComplete="tel" value={f.whatsapp} onChange={(e) => set('whatsapp', maskPhoneBR(e.target.value))} placeholder="(11) 91234-5678" />
          <span className="hint">Para avisos de vencimento.</span></label>
      </div>
      <div className="grid2 tight">
        <label className="field">Senha (mín. 8)<PassInput value={f.password} onChange={(v) => set('password', v)} autoComplete="new-password" /></label>
        <label className="field">Repita a senha<PassInput value={f.password2} onChange={(v) => set('password2', v)} autoComplete="new-password" /></label>
      </div>
      <label className="field">PIN de 4 números (opcional)
        <input className="input num pin-input" inputMode="numeric" maxLength={4} autoComplete="off" value={f.pin}
          onChange={(e) => set('pin', e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="••••" />
        <span className="hint">Troca de operador no caixa num toque e autoriza cancelamento, desconto e perda.</span></label>
      <label className="check lgpd-note"><input type="checkbox" checked={aceite} onChange={(e) => setAceite(e.target.checked)} />
        <span>🔐 Concordo com o uso dos dados só para o funcionamento do caixa e da cobrança (LGPD). O CPF/CNPJ fica visível apenas para a minha loja e para a administração do {BRAND.name}.</span></label>
      {err && <div className="err">{err}</div>}
      <button className="btn btn-primary btn-big" disabled={busy} type="submit">{busy ? 'Criando…' : 'Criar conta e começar'}</button>
      <button type="button" className="btn btn-ghost" onClick={onLogin}>Já tenho conta — entrar</button>
    </form>
  );
}
