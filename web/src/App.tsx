import { useApp } from './ctx';
import { IS_SB } from './api';
import { Header } from './components/Header';
import { Login } from './pages/Login';
import { AccountLogin } from './pages/AccountLogin';
import { BlockedScreen, ExpiryBanner } from './components/Subscription';
import { NetBanner } from './components/NetBanner';
import { InAppHint, UpdateBanner } from './components/Install';
import { Sale } from './pages/Sale';
import { Cash } from './pages/Cash';
import { Products } from './pages/Products';
import { Stock } from './pages/Stock';
import { Customers } from './pages/Customers';
import { Orders } from './pages/Orders';
import { SalesList } from './pages/SalesList';
import { Reports } from './pages/Reports';
import { Settings } from './pages/Settings';
import { Today } from './pages/Today';
import { Purchases } from './pages/Purchases';

const MGR = ['admin', 'gerente'];

export function App() {
  const { user, route, store, authBusy, loja } = useApp();
  if (store === 'loading') return <div className="boot">Carregando…</div>;
  if (IS_SB && (store === 'out' || (authBusy && !user))) return <div className="app"><InAppHint /><UpdateBanner /><NetBanner /><AccountLogin /></div>;
  // loja bloqueada / vencida: tela cheia (o banco também recusa tudo — isto é só a cara)
  if (IS_SB && loja && !loja.liberada) return <div className="app"><BlockedScreen /></div>;
  if (!user) return <div className="app"><InAppHint /><UpdateBanner /><NetBanner /><Login /></div>;
  const [r, sub] = route.split('/');
  const mgr = MGR.includes(user.role);
  let page;
  switch (r) {
    case 'hoje': page = mgr ? <Today /> : <Cash />; break;
    case 'caixa': page = <Cash />; break;
    case 'produtos': page = <Products tab={sub} />; break;
    case 'promocoes': page = mgr ? <Products tab="promocoes" /> : <Sale />; break;
    case 'estoque': page = <Stock tab={sub} />; break;
    case 'compras': page = mgr ? <Purchases tab={sub} /> : <Stock tab={sub} />; break;
    case 'fiado': page = <Customers />; break;
    case 'encomendas': page = <Orders />; break;
    case 'vendas': page = <SalesList />; break;
    case 'relatorios': page = <Reports />; break;
    case 'config': page = <Settings tab={sub} />; break;
    default: page = <Sale />;
  }
  return (
    <div className="app">
      <Header />
      <InAppHint />
      <UpdateBanner />
      <NetBanner />
      {IS_SB && <ExpiryBanner />}
      <main className="main">{page}</main>
    </div>
  );
}
