import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

function decodeImageData(img: ImageData): string | undefined {
  return jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })?.data;
}

/** Lê um QR code pela câmera (exige HTTPS ou localhost) ou por uma foto enviada. */
export function QrScanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let stream: MediaStream | undefined;
    let raf = 0;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('A câmera só funciona em HTTPS. Use "Enviar foto do QR code".');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        const tick = () => {
          if (v.videoWidth) {
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            ctx.drawImage(v, 0, 0);
            const text = decodeImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
            if (text) return onResult(text);
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) {
        setError(`Não foi possível abrir a câmera: ${(e as Error).message}`);
      }
    })();
    return () => {
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onResult]);

  const fromFile = async (file?: File) => {
    if (!file) return;
    const bmp = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const text = decodeImageData(ctx.getImageData(0, 0, bmp.width, bmp.height));
    if (text) onResult(text);
    else setError('Nenhum QR code encontrado na foto.');
  };

  return (
    <div className="card stack">
      <video ref={video} className="scanner" muted playsInline />
      {error && <div className="alert error">{error}</div>}
      <div className="actions">
        <label className="btn" style={{ margin: 0 }}>
          Enviar foto do QR code
          <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => fromFile(e.target.files?.[0])} />
        </label>
        <button type="button" onClick={onClose}>
          Fechar
        </button>
      </div>
    </div>
  );
}

/** Extrai o ID numérico da impressora do texto do QR (número puro, URL ou texto com o ID). */
export function idFromQr(text: string): string | undefined {
  const t = text.trim();
  if (/^\d+$/.test(t)) return t;
  try {
    const u = new URL(t);
    for (const k of ['printerId', 'impressora', 'id']) {
      const v = u.searchParams.get(k);
      if (v && /^\d+$/.test(v)) return v;
    }
  } catch {
    /* não é URL */
  }
  return t.match(/\d{3,}/)?.[0];
}
