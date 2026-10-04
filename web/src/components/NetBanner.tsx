import { useApp } from '../ctx';
import { IS_SB } from '../api';

/** Faixa "sem internet" + vendas offline pendentes (só no modo online) */
export function NetBanner() {
  const { online, pending, flush } = useApp();
  if (!IS_SB || (online && !pending.n)) return null;
  return (
    <div className={`net-banner no-print ${online ? 'pend' : 'off'}`} role="status">
      {!online && <b>📡 Sem internet.</b>}
      {!online && <span> Dá para registrar vendas em dinheiro/PIX/cartão: elas ficam guardadas neste aparelho. Fiado, estoque e fechamento esperam a conexão.</span>}
      {pending.n > 0 && <span> · <b>{pending.n}</b> venda(s) aguardando envio{pending.errors ? ` (${pending.errors} com erro)` : ''}.</span>}
      {online && pending.n > 0 && <button className="btn btn-sm" onClick={() => flush()}>Enviar agora</button>}
    </div>
  );
}
