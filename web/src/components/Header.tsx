import { useEffect, useRef, useState } from 'react';
import { useApp } from '../ctx';
import { Logo } from './Logo';
import { ROLE_LABEL, Role } from '@folha/shared';
import { getTerminal, IS_SB } from '../api';
import { InstallButton } from './Install';

type NavItem = { r: string; ic: string; tx: string; roles?: Role[] };
const MGR: Role[] = ['admin', 'gerente'];
export const NAV: NavItem[] = [
  { r: 'venda', ic: '🛒', tx: 'Venda' }, { r: 'hoje', ic: '📈', tx: 'Hoje', roles: MGR }, { r: 'caixa', ic: '💵', tx: 'Caixa' },
  { r: 'vendas', ic: '🧾', tx: 'Vendas' }, { r: 'encomendas', ic: '📦', tx: 'Encomendas' }, { r: 'fiado', ic: '📒', tx: 'Fiado' }, { r: 'estoque', ic: '🧺', tx: 'Estoque' },
  { r: 'compras', ic: '🚚', tx: 'Compras', roles: MGR }, { r: 'produtos', ic: '🥕', tx: 'Produtos', roles: MGR },
  { r: 'promocoes', ic: '🔥', tx: 'Promoções', roles: MGR },
  { r: 'relatorios', ic: '📊', tx: 'Relatórios', roles: MGR }, { r: 'config', ic: '⚙️', tx: 'Config.', roles: MGR },
];
/** no celular: 4 atalhos na barra de baixo + "Mais" */
const PHONE_MAIN: Record<string, string[]> = { mgr: ['venda', 'hoje', 'vendas', 'estoque'], op: ['venda', 'caixa', 'vendas', 'fiado'] };

export function Header() {
  const { user, status, route, go, logout, switchOperator, storeLogout, store, pending, loja } = useApp();
  const [menu, setMenu] = useState(false);
  const [more, setMore] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const h = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [menu]);
  const open = status?.session?.session;
  const nExp = status?.alerts?.expiring?.length ?? 0; const nLow = status?.alerts?.low_stock?.length ?? 0;
  const alerts = nExp + nLow;
  const nOrders = Number(status?.orders_pending ?? 0);
  const items = NAV.filter((n) => !n.roles || (user && n.roles.includes(user.role)));
  const cur = route.split('/')[0] || 'venda';
  const isMgr = !!user && MGR.includes(user.role);
  const main = PHONE_MAIN[isMgr ? 'mgr' : 'op'];
  const phoneMain = items.filter((n) => main.includes(n.r));
  const phoneMore = items.filter((n) => !main.includes(n.r));
  const nav = (r: string) => { setMore(false); setMenu(false); go(r); };
  const leave = () => {
    if (pending.n && !confirm(`Há ${pending.n} venda(s) sem internet esperando envio neste aparelho. Sair mesmo assim? Elas continuam guardadas e vão quando alguém entrar de novo.`)) return;
    setMenu(false); storeLogout();
  };
  return (
    <>
      <header className="header no-print">
        <button className="hdr-logo" onClick={() => nav('venda')} aria-label="Ir para a venda"><Logo size={28} light /></button>
        <div className="sep" />
        <div className="store" data-testid="store-name" title={status?.store?.name || loja?.nome}>{status?.store?.name || loja?.nome || '…'}</div>
        <button className={`status-pill ${open ? 'aberto' : 'fechado'}`} title={open ? `Aberto por ${open.opened_by_name}` : 'Caixa fechado'} onClick={() => nav('caixa')}>
          <span className="dot" />{open ? 'Caixa aberto' : 'Caixa fechado'} <span className="term">{getTerminal()}</span>
        </button>
        {alerts > 0 && <button className="alert-badge" onClick={() => nav('estoque/alertas')} title={`${nExp} vencendo · ${nLow} com estoque baixo`}>
          ⚠ {alerts}<span className="tx"> {nExp && nLow ? 'alertas' : nExp ? 'vencendo' : 'estoque baixo'}</span></button>}
        <nav className="nav" aria-label="Menu">
          {items.map((n) => (
            <button key={n.r} className={cur === n.r ? 'on' : ''} onClick={() => nav(n.r)} title={n.tx} aria-current={cur === n.r ? 'page' : undefined}>
              <span className="ic" aria-hidden>{n.ic}</span><span className="tx">{n.tx}</span>
              {n.r === 'encomendas' && nOrders > 0 && <span className="nav-badge" data-testid="orders-badge" title={`${nOrders} encomenda(s) pendente(s)`}>{nOrders}</span>}
            </button>
          ))}
        </nav>
        <InstallButton className="btn btn-sm hdr-install" compact />
        <div className="userbox" ref={menuRef}>
          <button className="user-btn" onClick={() => setMenu(!menu)} aria-haspopup="menu" aria-expanded={menu}>
            <span className="av">{user?.name.slice(0, 1).toUpperCase()}</span>
            <span className="who"><b>{user?.name}</b><span>{user ? ROLE_LABEL[user.role] : ''}</span></span>
            <span className="caret" aria-hidden>▾</span>
          </button>
          {menu && <div className="menu" role="menu">
            <div className="menu-h"><b>{user?.name}</b><span className="muted small">{user ? ROLE_LABEL[user.role] : ''}{IS_SB ? ` · aparelho: ${store}` : ''}</span></div>
            <button role="menuitem" onClick={() => { setMenu(false); IS_SB ? switchOperator() : logout(); }}>🔁 Trocar operador (PIN)</button>
            {IS_SB && <button role="menuitem" onClick={() => nav('config/conta')}>🔑 Minha conta e senha</button>}
            {IS_SB ? <button role="menuitem" className="danger" onClick={leave}>🚪 Sair da conta</button>
              : <button role="menuitem" className="danger" onClick={() => { setMenu(false); logout(); }}>🚪 Sair</button>}
          </div>}
        </div>
      </header>
      <nav className="bottom-nav no-print" aria-label="Menu do celular">
        {phoneMain.map((n) => (
          <button key={n.r} className={cur === n.r ? 'on' : ''} onClick={() => nav(n.r)} aria-current={cur === n.r ? 'page' : undefined}>
            <span className="ic" aria-hidden>{n.ic}</span><span className="tx">{n.tx}</span>
          </button>
        ))}
        <button className={phoneMore.some((n) => n.r === cur) || more ? 'on' : ''} onClick={() => setMore(true)}>
          <span className="ic" aria-hidden>☰</span><span className="tx">Mais</span>
          {nOrders > 0 && phoneMore.some((n) => n.r === 'encomendas') && <span className="nav-badge">{nOrders}</span>}
        </button>
      </nav>
      {more && <div className="overlay sheet-overlay no-print" onMouseDown={(e) => { if (e.target === e.currentTarget) setMore(false); }}>
        <div className="sheet" role="dialog" aria-label="Mais opções">
          <div className="sheet-grab" />
          <div className="sheet-grid">
            {phoneMore.map((n) => <button key={n.r} className={cur === n.r ? 'on' : ''} onClick={() => nav(n.r)}><span className="ic">{n.ic}</span>{n.tx}
              {n.r === 'encomendas' && nOrders > 0 && <span className="nav-badge">{nOrders}</span>}</button>)}
            {alerts > 0 && <button onClick={() => nav('estoque/alertas')}><span className="ic">⚠️</span>Alertas ({alerts})</button>}
          </div>
          <div className="sheet-actions">
            <button className="btn" onClick={() => { setMore(false); IS_SB ? switchOperator() : logout(); }}>🔁 Trocar operador</button>
            {IS_SB && <button className="btn" onClick={() => nav('config/conta')}>🔑 Minha conta</button>}
            <InstallButton className="btn" />
            {IS_SB && <button className="btn btn-danger" onClick={() => { setMore(false); leave(); }}>🚪 Sair da conta</button>}
          </div>
        </div>
      </div>}
    </>
  );
}
