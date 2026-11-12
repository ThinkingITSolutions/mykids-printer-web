/** Webapp instalável: service worker, convite de instalação (Android/desktop e iPhone), atualização e aviso offline. */
import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'mkp-install-dismissed';
let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // guardamos o evento para mostrar o nosso botão
  deferred = e as BeforeInstallPromptEvent;
  notify();
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  notify();
});

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Registra o service worker (só em contexto seguro: HTTPS ou localhost). */
export function registerServiceWorker(onUpdate: (apply: () => void) => void) {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      const offer = (w: ServiceWorker) =>
        onUpdate(() => {
          w.postMessage('skipWaiting');
        });
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
        });
      });
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded) return;
        reloaded = true;
        window.location.reload();
      });
      setInterval(() => void reg.update(), 30 * 60_000);
    } catch {
      /* sem service worker: o app continua funcionando online */
    }
  });
}

/** Convite de instalação: botão no Android/Chrome/Edge; instruções no iPhone (Safari não tem prompt). */
export function InstallBanner() {
  const [, force] = useState(0);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [iosHelp, setIosHelp] = useState(false);

  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);

  if (isStandalone() || dismissed) return null;
  const ios = isIos();
  if (!deferred && !ios) {
    if (!window.isSecureContext)
      return (
        <div className="install-banner muted">
          <span>Para instalar como app, acesse o painel pelo endereço com HTTPS.</span>
          <button className="link" onClick={() => dismiss()}>
            Ok
          </button>
        </div>
      );
    return null;
  }

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
    setDismissed(true);
  }

  const install = async () => {
    if (!deferred) return setIosHelp(true);
    await deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    force((n) => n + 1);
  };

  return (
    <>
      <div className="install-banner">
        <img src="/icon-192.png" alt="" />
        <div className="install-text">
          <strong>Instale o MyKids Printer</strong>
          <span>Abre direto da tela inicial, em tela cheia.</span>
        </div>
        <button className="primary" onClick={install}>
          Instalar
        </button>
        <button className="install-close" aria-label="Agora não" onClick={dismiss}>
          ×
        </button>
      </div>
      {iosHelp && (
        <div className="modal-backdrop" onClick={() => setIosHelp(false)}>
          <div className="modal sheet" onClick={(e) => e.stopPropagation()}>
            <header>
              <h3>Instalar no iPhone</h3>
              <button onClick={() => setIosHelp(false)}>×</button>
            </header>
            <div className="body stack">
              <ol className="ios-steps">
                <li>
                  Abra este endereço no <strong>Safari</strong>.
                </li>
                <li>
                  Toque em <strong>Compartilhar</strong>{' '}
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M12 3v12M7 8l5-5 5 5M5 12v8h14v-8" />
                  </svg>{' '}
                  na barra de baixo.
                </li>
                <li>
                  Role e toque em <strong>Adicionar à Tela de Início</strong>.
                </li>
                <li>
                  Confirme em <strong>Adicionar</strong>. O ícone da INCC aparece na tela inicial.
                </li>
              </ol>
            </div>
            <footer>
              <button className="primary" onClick={() => setIosHelp(false)}>
                Entendi
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}

/** Faixa de "nova versão disponível" e de "sem conexão". */
export function AppNotices({ update }: { update?: () => void }) {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return (
    <>
      {!online && <div className="notice bad">Sem internet/Wi-Fi: o painel volta a atualizar quando a conexão voltar.</div>}
      {update && (
        <div className="notice info">
          <span>Nova versão do painel disponível.</span>
          <button className="dark" onClick={update}>
            Atualizar
          </button>
        </div>
      )}
    </>
  );
}
