// Shared overlays: confirm/form dialogs, toasts and the right-hand drawer.
// Any page can call ask(), askForm() or toast(); <Overlays /> in the app shell renders them.
import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from './icons.tsx';

type Field = { name: string; label: string; type?: 'text' | 'number' | 'textarea' | 'color' | 'select'; value?: string;
  min?: number; max?: number; required?: boolean; options?: [string, string][]; placeholder?: string };
type DialogReq = { title: string; body?: ReactNode; confirm: string; danger?: boolean; fields?: Field[]; resolve: (v: Record<string, string> | null) => void };
type Toast = { id: number; text: string; error?: boolean };

let showDialog: (d: DialogReq) => void = () => {};
let showToast: (t: Toast) => void = () => {};

/** A confirm dialog that states the consequence. Resolves true if confirmed. */
export const ask = (o: { title: string; body?: ReactNode; confirm: string; danger?: boolean }) =>
  new Promise<boolean>((resolve) => showDialog({ ...o, resolve: (v) => resolve(!!v) }));

/** A small form in a dialog. Resolves the field values, or null if cancelled. */
export const askForm = (o: { title: string; body?: ReactNode; confirm: string; fields: Field[] }) =>
  new Promise<Record<string, string> | null>((resolve) => showDialog({ ...o, resolve }));

let nextId = 1;
export const toast = (text: string, error = false) => showToast({ id: nextId++, text, error });

export function Overlays() {
  const [dialog, setDialog] = useState<DialogReq | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [t, setT] = useState<Toast | null>(null);

  useEffect(() => {
    showDialog = (d) => { setValues(Object.fromEntries((d.fields ?? []).map((f) => [f.name, f.value ?? '']))); setDialog(d); };
    showToast = setT;
  }, []);
  useEffect(() => { if (!t) return; const h = setTimeout(() => setT(null), t.error ? 5200 : 3200); return () => clearTimeout(h); }, [t]);
  useEffect(() => {
    if (!dialog) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close(null);
    addEventListener('keydown', esc);
    return () => removeEventListener('keydown', esc);
  });

  const close = (v: Record<string, string> | null) => { dialog?.resolve(v); setDialog(null); };
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setValues({ ...values, [k]: e.target.value });

  return (
    <>
      {dialog && (
        <div className="dialog-wrap" onMouseDown={(e) => e.target === e.currentTarget && close(null)}>
          <form className="dialog" role="dialog" aria-modal onSubmit={(e) => { e.preventDefault(); close(values); }}>
            <h3>{dialog.title}</h3>
            {dialog.body && <p>{dialog.body}</p>}
            {dialog.fields?.map((f, i) => (
              <label key={f.name} className="field">{f.label}
                {f.type === 'textarea' ? <textarea autoFocus={i === 0} required={f.required} value={values[f.name]} onChange={set(f.name)} />
                  : f.type === 'select' ? <select autoFocus={i === 0} value={values[f.name]} onChange={set(f.name)}>
                    {f.options!.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                  : <input autoFocus={i === 0} type={f.type ?? 'text'} required={f.required ?? true} min={f.min} max={f.max}
                    placeholder={f.placeholder} value={values[f.name]} onChange={set(f.name)} />}
              </label>
            ))}
            <div className="actions">
              <button type="button" className="btn" onClick={() => close(null)}>Cancel</button>
              <button autoFocus={!dialog.fields} className={`btn ${dialog.danger ? 'primary' : 'dark'}`}>{dialog.confirm}</button>
            </div>
          </form>
        </div>
      )}
      {t && <div key={t.id} className={`toast ${t.error ? 'error' : ''}`} role="status"><Icon n={t.error ? 'alert' : 'check'} s={16} />{t.text}</div>}
    </>
  );
}

/** Right-hand drawer (rounded on the left), closed by Esc, the scrim or the X. */
export function Drawer({ title, kicker, onClose, children, foot }: { title: ReactNode; kicker?: ReactNode; onClose: () => void; children: ReactNode; foot?: ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.dialog-wrap') && onClose();
    addEventListener('keydown', esc);
    return () => removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal>
        <div className="drawer-head">
          <div>{kicker && <div className="kicker" style={{ marginBottom: 6 }}>{kicker}</div>}<h3>{title}</h3></div>
          <button className="btn icon" onClick={onClose} aria-label="Close"><Icon n="x" /></button>
        </div>
        <div className="drawer-body">{children}</div>
        {foot && <div className="drawer-foot">{foot}</div>}
      </aside>
    </>
  );
}

/** Category colour on an element, used by .chip, .tag.cat and .dot. */
export const cat = (color?: string) => ({ '--c': color ?? '#BDB6AE' }) as React.CSSProperties;
