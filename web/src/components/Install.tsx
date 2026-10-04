import { BRAND } from '@folha/shared';
import { useEffect, useState } from 'react';
import { pwaState, promptInstall, isIOS, isAndroid, inAppBrowser, chromeIntentUrl, applyUpdate, isSamsung, isInstalled, installedFlag, INSTALL_LABEL } from '../pwa';
import { Modal } from './Modal';

export function usePwa() {
  const [s, setS] = useState(pwaState());
  useEffect(() => { const f = () => setS(pwaState()); window.addEventListener('cc:pwa', f); return () => window.removeEventListener('cc:pwa', f); }, []);
  return s;
}

/** Botão "Instalar app": abre a janela do Chrome; se ela não estiver disponível, mostra o passo a passo do aparelho. */
export function InstallButton({ className = 'btn', label = 'Instalar app', compact = false }: { className?: string; label?: string; compact?: boolean }) {
  const s = usePwa();
  const [help, setHelp] = useState(false);
  if (s.installed) return null;
  const click = async () => {
    const r = await promptInstall();
    if (r === 'unavailable') setHelp(true);
  };
  return <>
    <button type="button" className={className} onClick={click} title={`Instalar o ${BRAND.name} na tela inicial`} data-install>
      <span aria-hidden>📲</span>{!compact && <span className="tx">{label}</span>}
    </button>
    {help && <InstallHelp onClose={() => setHelp(false)} />}
  </>;
}

export function InstallHelp({ onClose }: { onClose: () => void }) {
  const inApp = inAppBrowser();
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(location.href); setCopied(true); } catch { /* */ } };
  return (
    <Modal title={`📲 Instalar o ${BRAND.name}`} onClose={onClose} size="sm">
      {inApp ? <>
        <div className="ok-box warn-box">Você abriu o link dentro do WhatsApp/Instagram. Esse navegador interno <b>não instala apps</b>.</div>
        {isAndroid() && <a className="btn btn-primary btn-big" href={chromeIntentUrl()}>Abrir no Chrome</a>}
        <ol className="steps">
          <li>Toque nos <b>⋮ três pontinhos</b> (ou no ícone de compartilhar) no canto da tela.</li>
          <li>Escolha <b>“Abrir no Chrome”</b> / <b>“Abrir no navegador”</b>.</li>
          <li>No Chrome, toque em <b>Instalar app</b>.</li>
        </ol>
        <button className="btn" onClick={copy}>{copied ? '✓ Link copiado' : 'Copiar link'}</button>
      </> : isIOS() ? <>
        <div className="muted">No iPhone/iPad a instalação é pelo <b>Safari</b>:</div>
        <ol className="steps">
          <li>Toque em <b>Compartilhar</b> <span className="ios-share" aria-hidden>⬆︎</span> na barra do Safari.</li>
          <li>Role e toque em <b>“Adicionar à Tela de Início”</b>.</li>
          <li>Toque em <b>Adicionar</b>. O ícone da folha aparece na tela.</li>
        </ol>
      </> : <>
        <div className="muted">{isAndroid() ? 'No Android, pelo Chrome:' : 'No computador, pelo Chrome ou Edge:'}</div>
        <ol className="steps">
          {isAndroid() ? <>
            <li>Toque nos <b>⋮ três pontinhos</b> no canto de cima do {isSamsung() ? 'navegador' : 'Chrome'}.</li>
            <li>Toque em <b>“Instalar app”</b> (ou <b>“Adicionar à tela inicial”</b> → <b>Instalar</b>).</li>
            <li>Confirme. O <b>{BRAND.name}</b> abre em tela cheia, como um aplicativo.</li>
          </> : <>
            <li>Clique no ícone <b>Instalar</b> (⊕ tela com seta) no fim da barra de endereço.</li>
            <li>Ou menu <b>⋮</b> → <b>Transmitir, salvar e compartilhar</b> → <b>Instalar página como app</b>.</li>
          </>}
        </ol>
        <div className="small muted">Se a opção não aparecer, recarregue a página uma vez e toque em qualquer lugar dela; o Chrome libera a instalação depois de alguns segundos de uso.</div>
      </>}
      <button className="btn" onClick={onClose}>Entendi</button>
    </Modal>
  );
}

/** Faixa no topo quando o link foi aberto no navegador interno do WhatsApp/Instagram */
export function InAppHint() {
  const [hide, setHide] = useState(false);
  if (hide || !inAppBrowser() || isInstalled()) return null;
  return (
    <div className="net-banner pend no-print" role="note">
      <b>Abra no Chrome para instalar o app.</b> <span>O navegador do WhatsApp/Instagram não instala.</span>
      {isAndroid() && <a className="btn btn-sm" href={chromeIntentUrl()}>Abrir no Chrome</a>}
      <button className="btn btn-sm btn-ghost" onClick={() => setHide(true)} aria-label="Fechar aviso">×</button>
    </div>
  );
}

/** Versão nova do app baixada: o operador escolhe a hora de atualizar (não interrompe uma venda) */
export function UpdateBanner() {
  const s = usePwa();
  if (!s.updateReady) return null;
  return (
    <div className="update-banner no-print" role="status">
      <span>✨ <b>Nova versão do {BRAND.name}.</b> Atualize quando terminar a venda.</span>
      <button className="btn btn-sm btn-lima" onClick={applyUpdate}>Atualizar agora</button>
    </div>
  );
}

/** v3.6: Config. → "Instalado ✓" e em qual modo o app está aberto agora */
export function InstallStatus() {
  const s = usePwa();
  const flag = installedFlag();
  const txt = s.mode !== 'browser' ? `✓ Instalado · ${INSTALL_LABEL[s.mode]}`
    : s.installed ? `✓ Instalado neste aparelho${flag ? ` (${flag.mode === 'apk' ? 'APK' : 'app do Chrome'})` : ''} · aberto no navegador`
    : 'Navegador · app não instalado';
  return <span data-testid="install-status" data-mode={s.mode} data-installed={s.installed ? '1' : '0'}>{txt}</span>;
}
