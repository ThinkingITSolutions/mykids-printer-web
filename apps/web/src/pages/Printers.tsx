import { useCallback, useEffect, useState } from 'react';
import { api, type FoundPrinter, type PrinterRow, type Target } from '../api';
import { QrScanner, idFromQr } from '../QrScanner';

interface Catalog {
  templates: { type: string; description: string; width: number; height: number; source: string }[];
  labels: { id: string; description: string }[];
  orientations: string[];
}
interface MyKidsPrinter {
  id: string;
  nome: string;
  linkedTo: string | null;
}

const ORIENT_LABEL: Record<string, string> = {
  LANDSCAPE: 'Paisagem',
  INVERSE_LANDSCAPE: 'Paisagem invertida (180°)',
  PORTRAIT: 'Retrato',
  INVERSE_PORTRAIT: 'Retrato invertido (180°)',
};
const KIND_LABEL: Record<Target['kind'], string> = { 'brother-ql': 'Brother QL (rede)', ipp: 'Impressora comum (IPP/PDF)', preview: 'Sem impressora (só pré-visualização)' };

/** Sugere o rolo Brother pelo tamanho do modelo. */
const suggestLabel = (t?: { width: number; height: number }) => {
  if (!t) return '29x90';
  const small = Math.min(t.width, t.height);
  return small <= 30 ? '29x90' : '62x100';
};

export function Printers() {
  const [list, setList] = useState<PrinterRow[]>([]);
  const [catalog, setCatalog] = useState<Catalog>();
  const [editing, setEditing] = useState<PrinterRow | 'new'>();
  const [msg, setMsg] = useState<{ type: string; text: string }>();
  const [busyId, setBusyId] = useState<number>();
  const [previewTick, setPreviewTick] = useState(0);

  const load = useCallback(async () => {
    setList(await api('/api/printers'));
    setCatalog(await api('/api/catalog'));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const test = async (p: PrinterRow) => {
    setBusyId(p.id);
    setMsg(undefined);
    try {
      await api(`/api/printers/${p.id}/test`, { method: 'POST' });
      setMsg({ type: 'success', text: `Etiqueta de teste enviada para "${p.nickname}".` });
      setPreviewTick(Date.now());
    } catch (e) {
      setMsg({ type: 'error', text: (e as Error).message });
    } finally {
      setBusyId(undefined);
    }
  };

  const remove = async (p: PrinterRow) => {
    if (!confirm(`Remover o vínculo "${p.nickname}"? As etiquetas da impressora MyKids #${p.mykidsId} deixam de sair aqui.`)) return;
    await api(`/api/printers/${p.id}`, { method: 'DELETE' });
    await load();
  };

  const tplName = (type: string) => catalog?.templates.find((t) => t.type === type)?.description ?? type;

  return (
    <>
      <section className="hero">
        <h1>Impressoras</h1>
        <p>Vincule cada impressora cadastrada no MyKids (pelo ID ou QR code) a uma impressora da rede da igreja.</p>
      </section>
      <main className="stack">
        <div className="section-head">
          <h2 className="section">Vínculos</h2>
          <button className="primary" onClick={() => setEditing('new')}>
            + Incluir impressora
          </button>
        </div>
        {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}
        {list.length === 0 && <div className="alert info">Nenhuma impressora vinculada ainda.</div>}
        <div className="grid">
          {list.map((p) => (
            <div className="card stack" key={p.id}>
              <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                <h3 style={{ flex: 1 }}>{p.nickname}</h3>
                <span className={`pill ${p.enabled ? 'ok' : 'warn'}`}>{p.enabled ? 'Ativa' : 'Desativada'}</span>
              </div>
              <div className="meta">
                MyKids #{p.mykidsId} {p.mykidsName ? `· ${p.mykidsName}` : ''}
                <br />
                {KIND_LABEL[p.target.kind]} {p.target.host ? `· ${p.target.host}` : ''} {p.target.model ? `· ${p.target.model}` : ''}
                <br />
                Etiqueta: {tplName(p.ticketType)} {p.target.label ? `· rolo ${p.target.label}` : ''} · {ORIENT_LABEL[p.orientation]}
              </div>
              {p.target.kind !== 'ipp' && (
                <div className="preview">
                  <img
                    src={`/api/printers/${p.id}/preview.png?t=${previewTick}`}
                    alt="Faça um teste para ver a última etiqueta"
                    onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
                    onLoad={(e) => ((e.target as HTMLImageElement).style.display = '')}
                  />
                </div>
              )}
              <div className="actions">
                <button className="dark" onClick={() => test(p)} disabled={busyId === p.id}>
                  {busyId === p.id ? 'Imprimindo…' : 'Imprimir teste'}
                </button>
                <button onClick={() => setEditing(p)}>Editar</button>
                <button className="danger" onClick={() => remove(p)}>
                  Remover
                </button>
              </div>
            </div>
          ))}
        </div>
      </main>
      {editing && catalog && (
        <PrinterModal
          catalog={catalog}
          initial={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(undefined)}
          onSaved={async () => {
            setEditing(undefined);
            await load();
          }}
        />
      )}
    </>
  );
}

function PrinterModal({ catalog, initial, onClose, onSaved }: { catalog: Catalog; initial?: PrinterRow; onClose: () => void; onSaved: () => void }) {
  const [mykids, setMykids] = useState<MyKidsPrinter[]>();
  const [mykidsError, setMykidsError] = useState('');
  const [found, setFound] = useState<FoundPrinter[]>();
  const [searching, setSearching] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState<Omit<PrinterRow, 'id'>>(
    initial ?? {
      mykidsId: '',
      mykidsName: '',
      nickname: '',
      ticketType: catalog.templates[0]?.type ?? 'BROTHER28X80',
      orientation: 'LANDSCAPE',
      target: { kind: 'brother-ql', label: suggestLabel(catalog.templates[0]) },
      enabled: true,
    },
  );
  const setTarget = (t: Partial<Target>) => setForm((f) => ({ ...f, target: { ...f.target, ...t } }));

  useEffect(() => {
    api<MyKidsPrinter[]>('/api/mykids/printers')
      .then(setMykids)
      .catch((e) => setMykidsError(e.message));
  }, []);

  const pickMyKids = (id: string, nome?: string) =>
    setForm((f) => ({ ...f, mykidsId: id, mykidsName: nome ?? mykids?.find((m) => m.id === id)?.nome ?? '', nickname: f.nickname || (nome ?? '') }));

  const onQr = useCallback(
    (text: string) => {
      setScanning(false);
      const id = idFromQr(text);
      if (!id) return setError(`QR code lido, mas sem ID de impressora: "${text.slice(0, 80)}"`);
      setError('');
      pickMyKids(id);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mykids],
  );

  const search = async () => {
    setSearching(true);
    try {
      setFound(await api<FoundPrinter[]>('/api/discover'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSearching(false);
    }
  };

  const choosePhysical = (p: FoundPrinter) =>
    setTarget({
      kind: p.isBrotherQL ? 'brother-ql' : p.ipp ? 'ipp' : 'brother-ql',
      host: p.ip,
      mac: p.mac,
      name: p.name,
      model: p.model,
    });

  const save = async () => {
    setError('');
    try {
      const body = { ...form, target: { ...form.target, port: form.target.port || undefined } };
      if (initial) await api(`/api/printers/${initial.id}`, { method: 'PUT', body });
      else await api('/api/printers', { body });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const tpl = catalog.templates.find((t) => t.type === form.ticketType);

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <header>
          <h3>{initial ? 'Editar impressora' : 'Incluir impressora'}</h3>
          <button onClick={onClose}>×</button>
        </header>
        <div className="body stack">
          {/* 1 — impressora do MyKids */}
          <div className="step">1 · Impressora no MyKids</div>
          <div className="fields">
            <div>
              <label>ID da impressora (MyKids)</label>
              <input inputMode="numeric" value={form.mykidsId} onChange={(e) => pickMyKids(e.target.value.replace(/\D/g, ''))} placeholder="ex.: 123456" />
              <div className="hint">{form.mykidsName || 'Digite, escolha na lista ou leia o QR code.'}</div>
            </div>
            <div className="qr-btn">
              <button type="button" onClick={() => setScanning((s) => !s)}>
                ▣ Ler QR code
              </button>
            </div>
          </div>
          {scanning && <QrScanner onResult={onQr} onClose={() => setScanning(false)} />}
          {mykidsError && <div className="alert error">Não foi possível listar as impressoras do MyKids: {mykidsError}</div>}
          {mykids && (
            <table className="responsive compact">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Nome no MyKids</th>
                  <th>Vinculada a</th>
                </tr>
              </thead>
              <tbody>
                {mykids.map((m) => (
                  <tr key={m.id} className={`selectable ${form.mykidsId === m.id ? 'selected' : ''}`} onClick={() => pickMyKids(m.id, m.nome)}>
                    <td data-label="ID">
                      <strong>{m.id}</strong>
                    </td>
                    <td data-label="Nome no MyKids">{m.nome}</td>
                    <td data-label="Vinculada a" className="meta">
                      {m.linkedTo ? `→ ${m.linkedTo}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* 2 — impressora física */}
          <div className="step">2 · Impressora na rede</div>
          <div className="actions">
            <button type="button" className="primary" onClick={search} disabled={searching}>
              {searching ? 'Procurando… (até 10 s)' : '🔍 Procurar impressoras na rede'}
            </button>
            <span className="meta">Encontra as Brother QL-810W ligadas no Wi-Fi da igreja.</span>
          </div>
          {found && (
            <table className="responsive">
              <thead>
                <tr>
                  <th>Impressora</th>
                  <th>IP</th>
                  <th>Estado</th>
                  <th>Achada por</th>
                </tr>
              </thead>
              <tbody>
                {found.length === 0 && (
                  <tr>
                    <td colSpan={4} className="empty">Nenhuma impressora encontrada. Confira se ela está ligada e no mesmo Wi-Fi.</td>
                  </tr>
                )}
                {found.map((p) => (
                  <tr key={p.ip} className={`selectable ${form.target.host === p.ip ? 'selected' : ''}`} onClick={() => choosePhysical(p)}>
                    <td data-label="Impressora">
                      <div>
                        <strong>{p.model ?? p.name ?? 'Impressora'}</strong> {p.isBrotherQL && <span className="pill info">Brother QL</span>}
                        <div className="meta">{p.name}</div>
                      </div>
                    </td>
                    <td data-label="IP">
                      <div>
                        {p.ip}
                        <div className="meta">{p.mac}</div>
                      </div>
                    </td>
                    <td data-label="Estado">{p.status ?? '—'}</td>
                    <td data-label="Achada por" className="meta">
                      {p.via.join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="fields">
            <div>
              <label>Tipo</label>
              <select value={form.target.kind} onChange={(e) => setTarget({ kind: e.target.value as Target['kind'] })}>
                {Object.entries(KIND_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            {form.target.kind !== 'preview' && (
              <div>
                <label>Endereço IP</label>
                <input inputMode="decimal" value={form.target.host ?? ''} onChange={(e) => setTarget({ host: e.target.value.trim() })} placeholder="192.168.0.50" />
                <div className="hint">{form.target.mac ? `MAC ${form.target.mac}: se o IP mudar, o sistema reencontra sozinho.` : 'Preenchido pela busca.'}</div>
              </div>
            )}
          </div>

          {/* 3 — etiqueta */}
          <div className="step">3 · Etiqueta</div>
          <div className="fields">
            <div>
              <label>Modelo de etiqueta</label>
              <select
                value={form.ticketType}
                onChange={(e) => {
                  const t = catalog.templates.find((x) => x.type === e.target.value);
                  setForm((f) => ({ ...f, ticketType: e.target.value, target: { ...f.target, label: suggestLabel(t) } }));
                }}
              >
                {catalog.templates.map((t) => (
                  <option key={t.type} value={t.type}>
                    {t.description} {t.source === 'online' ? '(personalizado da igreja)' : ''}
                  </option>
                ))}
              </select>
              <div className="hint">{tpl ? `${tpl.width} x ${tpl.height} (medidas do MyKids)` : ''}</div>
            </div>
            {form.target.kind === 'brother-ql' && (
              <div>
                <label>Rolo na Brother</label>
                <select value={form.target.label} onChange={(e) => setTarget({ label: e.target.value })}>
                  {catalog.labels.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.description}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label>Orientação</label>
              <select value={form.orientation} onChange={(e) => setForm({ ...form, orientation: e.target.value })}>
                {catalog.orientations.map((o) => (
                  <option key={o} value={o}>
                    {ORIENT_LABEL[o]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Apelido</label>
              <input value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} placeholder="ex.: Recepção Kids 1" />
            </div>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', textTransform: 'none', letterSpacing: 0 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            Ativa (recebe as etiquetas do check-in)
          </label>

          {error && <div className="alert error">{error}</div>}
        </div>
        <footer>
          <button onClick={onClose}>Cancelar</button>
          <button className="primary" onClick={save} disabled={!form.mykidsId || !form.nickname}>
            Salvar
          </button>
        </footer>
      </div>
    </div>
  );
}
