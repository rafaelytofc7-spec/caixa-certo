// Assinatura da loja (modo online): tela de bloqueio, faixa de aviso de vencimento, cartão "Plano e assinatura".
// O bloqueio de verdade é no banco (loja_liberada() nas regras de acesso); aqui é só a cara para o usuário.
import { useState } from 'react';
import { BRAND, supportLink, SUPPORT_IS_PLACEHOLDER, formatBRL } from '@folha/shared';
import { useApp } from '../ctx';
import { post } from '../api';
import { maskDoc } from '../doc';
import { Logo } from './Logo';
import type { Loja } from '../backend/accounts';

const fmtD = (iso?: string) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
const STATUS_TXT: Record<string, string> = { teste: 'Teste grátis', ativa: 'Ativa', bloqueada: 'Bloqueada' };

function SupportButton({ loja, big }: { loja: Loja | null; big?: boolean }) {
  const extra = loja ? `Loja: ${loja.nome} (${maskDoc(loja.documento)})` : '';
  return (
    <a className={`btn btn-primary ${big ? 'btn-big' : ''}`} href={supportLink(extra)} target="_blank" rel="noopener noreferrer">
      💬 Falar com o suporte{SUPPORT_IS_PLACEHOLDER ? ' (número a definir)' : ''}
    </a>
  );
}

/** tela cheia quando a loja está bloqueada ou vencida — só deixa falar com o suporte e sair */
export function BlockedScreen() {
  const { loja, storeLogout, refreshLoja } = useApp();
  const [busy, setBusy] = useState(false);
  const vencida = loja?.status !== 'bloqueada';
  return (
    <div className="blocked">
      <div className="blocked-box card col">
        <Logo size={28} />
        <div className="blocked-ico" aria-hidden>🔒</div>
        <h1>Acesso bloqueado</h1>
        {loja && <div className="muted"><b>{loja.nome}</b> · <span className="nowrap">{maskDoc(loja.documento)}</span></div>}
        <p>{vencida
          ? <>A {loja?.status === 'teste' ? 'avaliação grátis' : 'assinatura'} desta loja venceu em <b>{fmtD(loja?.vencimento)}</b>. Para voltar a vender, regularize o pagamento com o suporte.</>
          : <>O acesso desta loja ao {BRAND.name} foi suspenso{loja?.motivo_bloqueio ? <>: <b>{loja.motivo_bloqueio}</b></> : '.'}</>}</p>
        <p className="small muted">Seus dados continuam guardados com segurança e voltam a aparecer assim que o acesso for liberado.</p>
        <SupportButton loja={loja} big />
        <div className="row" style={{ gap: 8, justifyContent: 'center' }}>
          <button className="btn" disabled={busy} onClick={async () => { setBusy(true); await refreshLoja(); setBusy(false); }}>{busy ? 'Verificando…' : '↻ Já paguei — verificar'}</button>
          <button className="btn btn-ghost" onClick={() => storeLogout()}>Sair</button>
        </div>
      </div>
    </div>
  );
}

/** faixa no topo quando faltam poucos dias para vencer (ou está na carência) */
export function ExpiryBanner() {
  const { loja } = useApp();
  const [closed, setClosed] = useState(() => sessionStorage.getItem('cc.bannerClosed') === (loja?.vencimento ?? ''));
  if (!loja || !loja.liberada || closed) return null;
  const d = loja.dias_restantes;
  if (!loja.em_carencia && d > loja.aviso_dias) return null;
  const txt = loja.em_carencia
    ? <>⚠️ O pagamento venceu em <b>{fmtD(loja.vencimento)}</b>. O acesso será bloqueado em <b>{fmtD(loja.bloqueio_em)}</b>.</>
    : d <= 0 ? <>⚠️ {loja.status === 'teste' ? 'O teste grátis' : 'A assinatura'} vence <b>hoje</b>.</>
    : <>⏳ {loja.status === 'teste' ? 'O teste grátis' : 'A assinatura'} vence em <b>{d} dia{d > 1 ? 's' : ''}</b> ({fmtD(loja.vencimento)}).</>;
  return (
    <div className="expiry-banner" role="status">
      <span>{txt}</span>
      <a className="btn btn-sm" href={supportLink(`Quero pagar/renovar: ${loja.nome} (${maskDoc(loja.documento)})`)} target="_blank" rel="noopener noreferrer">Pagar / falar com o suporte</a>
      <button className="btn btn-sm btn-ghost" aria-label="Fechar aviso" onClick={() => { sessionStorage.setItem('cc.bannerClosed', loja.vencimento); setClosed(true); }}>✕</button>
    </div>
  );
}

/** Configurações › Minha conta: situação da assinatura + nota de privacidade */
export function SubscriptionCard() {
  const { loja } = useApp();
  if (!loja) return null;
  return (
    <div className="card col sub-card">
      <h3>Plano e assinatura</h3>
      <div className="kv">
        <div><span>Loja</span><b>{loja.nome}</b></div>
        <div><span>{loja.tipo_documento}</span><b className="mono">{maskDoc(loja.documento)}</b></div>
        <div><span>Situação</span><b><span className={`tag st-${loja.status}`}>{STATUS_TXT[loja.status] ?? loja.status}</span></b></div>
        <div><span>Vence em</span><b>{fmtD(loja.vencimento)} {loja.dias_restantes >= 0 ? `(${loja.dias_restantes} dia${loja.dias_restantes === 1 ? '' : 's'})` : '(vencida)'}</b></div>
        <div><span>Plano</span><b>{loja.plano || '—'}{loja.valor_mensal_cents > 0 ? ` · ${formatBRL(loja.valor_mensal_cents)}/mês` : ''}</b></div>
      </div>
      <div className="small muted">Pagamento por PIX direto com o suporte. Depois de pagar, a liberação é feita no mesmo dia.</div>
      <div><SupportButton loja={loja} /></div>
      <div className="lgpd small muted">🔐 <b>Privacidade (LGPD):</b> guardamos só o necessário para o caixa funcionar. O CPF/CNPJ e os dados da loja
        aparecem apenas para a própria loja e para a administração do {BRAND.name}; nenhuma outra loja enxerga seus produtos, vendas ou clientes.</div>
    </div>
  );
}

/** Configurações › Loja: carrega uma lista de produtos comuns de hortifruti (sem preço) no catálogo vazio */
export function SampleProducts({ onDone }: { onDone?: () => void }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const load = async () => {
    if (!confirm('Carregar uns 40 produtos comuns de hortifruti (sem preço e sem estoque)? Depois é só ajustar os preços.')) return;
    setBusy(true);
    try { const r = await post('/api/sample-products'); toast(`${r.created} produtos de exemplo criados. Ajuste os preços em Produtos.`); onDone?.(); }
    catch (e: any) { toast(e.message, 'erro'); } finally { setBusy(false); }
  };
  return (
    <div className="card col">
      <h3>Começar o catálogo</h3>
      <div className="muted">Loja nova começa sem produtos. Para ganhar tempo, carregue uma lista de exemplo (tomate, banana, alface…) <b>sem preços</b> — você ajusta os preços e apaga o que não vende.</div>
      <div><button className="btn" disabled={busy} onClick={load}>{busy ? 'Carregando…' : '🧺 Carregar produtos de exemplo'}</button></div>
    </div>
  );
}
