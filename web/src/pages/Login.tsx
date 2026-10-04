import { useEffect, useState } from 'react';
import { get, post, setToken, IS_SB } from '../api';
import { useApp } from '../ctx';
import { PinPad } from '../components/PinPad';
import { LoginSide, MobileBrand } from '../components/LoginSide';
import { InstallButton } from '../components/Install';
import { ROLE_LABEL, Role } from '@folha/shared';

/** Tela do PIN: troca rápida de operador no caixa (no modo online, o aparelho continua no login de usuário + senha). */
export function Login() {
  const { setUser, store, storeLogout } = useApp();
  const [users, setUsers] = useState<Array<{ id: number; name: string; role: Role }> | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [storeName, setStoreName] = useState('');
  useEffect(() => {
    get('/api/auth/users').then((u) => { setUsers(u); const op = u.find((x: any) => x.role === 'operador'); setSel((op ?? u[0])?.id ?? null); })
      .catch((e) => { setUsers([]); setErr(e.message); });
    get('/api/store').then((s) => setStoreName(s.name)).catch(() => {});
  }, []);
  const submit = async (pin: string) => {
    if (!sel) return;
    setErr(''); setBusy(true);
    try { const r = await post('/api/auth/login', { user_id: sel, pin }); setToken(r.token); setUser(r.user); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const selUser = users?.find((u) => u.id === sel);
  return (
    <div className="login">
      <LoginSide />
      <div className="login-main">
        <div className="login-box">
          <MobileBrand />
          <div>
            <div className="eyebrow">{storeName || 'Banca'}</div>
            <h1 className="login-h1">{IS_SB ? 'Quem vai pro caixa?' : 'Quem vai pro caixa?'}</h1>
            {IS_SB && <div className="muted small">Toque no seu nome e digite o PIN. Aparelho conectado como <b>{store}</b>.</div>}
          </div>
          {users && !users.length && !err && <div className="ok-box warn-box">Ninguém tem PIN ainda. Entre com usuário e senha e crie os PINs em Configurações › Usuários.</div>}
          <div className="users">
            {(users ?? []).map((u) => (
              <button key={u.id} className={`user-tile ${sel === u.id ? 'on' : ''}`} onClick={() => { setSel(u.id); setErr(''); }}>
                <span className="av">{u.name.slice(0, 1).toUpperCase()}</span><span className="nm">{u.name}</span><small>{ROLE_LABEL[u.role]}</small>
              </button>
            ))}
          </div>
          {!!users?.length && <>
            <div className="muted center" style={{ fontWeight: 600 }}>{selUser ? <>PIN de <b>{selUser.name}</b></> : 'Digite seu PIN de 4 dígitos'}</div>
            {err && <div className="err center">{err}</div>}
            <PinPad onSubmit={submit} disabled={busy} />
          </>}
          {IS_SB && <div className="row wrap login-links">
            <button className="btn btn-ghost" onClick={() => storeLogout()}>🔑 Entrar com usuário e senha</button>
            <span className="spacer" />
            <InstallButton className="btn btn-ghost install-link" />
          </div>}
        </div>
      </div>
    </div>
  );
}
