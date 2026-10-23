import { useState } from 'react';
import { api, message, useApi } from '../api.ts';
import { rupees } from '@fmh/shared/time';
import type { Activity, Catalog as CatalogData } from '../types.ts';

/** Uploads a photo straight to S3 with a signed form from our API, then returns the S3 key. */
async function uploadImage(file: File) {
  if (file.size > 5 * 1024 * 1024) throw new Error('Image is larger than 5 MB.');
  const { url, fields, key } = await api<{ url: string; fields: Record<string, string>; key: string }>('/admin/uploads', { folder: 'activities', contentType: file.type });
  const form = new FormData();
  Object.entries(fields).forEach(([k, v]) => form.append(k, v));
  form.append('file', file);
  if (!(await fetch(url, { method: 'POST', body: form })).ok) throw new Error('Upload failed. Please try again.');
  return key;
}

const blank = { name: '', categoryId: '', price: '', capacity: '' };

export function Catalog() {
  const data = useApi<CatalogData>('/admin/catalog');
  const [f, setF] = useState(blank);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const done = (text: string) => { setNote({ ok: true, text }); data.reload(); };
  const fail = (e: unknown) => setNote({ ok: false, text: e instanceof Error && !('code' in e) ? e.message : message(e) });
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const update = (a: Activity, body: Partial<Activity>) =>
    api(`/admin/activities/${a.id}`, body, 'PATCH').then(() => done(`${a.name} updated.`), fail);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api('/admin/activities', { name: f.name, categoryId: Number(f.categoryId), defaultPrice: Math.round(Number(f.price) * 100), defaultCapacity: Number(f.capacity) });
      setF(blank); done('Activity added.');
    } catch (err) { fail(err); }
  };

  const edit = (a: Activity) => {
    const price = prompt(`Usual price for ${a.name} in ₹`, String(a.defaultPrice / 100));
    if (price === null) return;
    const seats = prompt(`Usual seats for ${a.name} (1–30)`, String(a.defaultCapacity));
    if (seats === null) return;
    update(a, { defaultPrice: Math.round(Number(price) * 100), defaultCapacity: Number(seats) });
  };

  const photo = async (a: Activity, file?: File) => {
    if (!file) return;
    try { await update(a, { imageKey: await uploadImage(file) }); } catch (e) { fail(e); }
  };

  const rename = (path: string, current: string) => {
    const name = prompt('New name', current);
    if (name?.trim()) api(path, { name: name.trim() }, 'PATCH').then(() => done('Renamed.'), fail);
  };
  const addZone = () => { const name = prompt('Zone name, e.g. "Zone D · Learn"'); if (name?.trim()) api('/admin/zones', { name: name.trim() }).then(() => done('Zone added.'), fail); };

  const d = data.data;
  const category = (id: number) => d?.categories.find((c) => c.id === id);

  return (
    <>
      <header className="page"><div><div className="kicker">What members can book</div><h1>Activities & zones</h1></div></header>
      {note && <p className={`note ${note.ok ? 'ok' : 'error'}`}>{note.text}</p>}
      {d && <>
        <section>
          <h2>Activities</h2>
          <form className="form" onSubmit={add} style={{ marginBottom: 16 }}>
            <label className="field">Name<input required maxLength={60} value={f.name} onChange={set('name')} /></label>
            <label className="field">Category<select required value={f.categoryId} onChange={set('categoryId')}>
              <option value="">Choose…</option>{d.categories.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}</select></label>
            <label className="field">Usual price (₹)<input type="number" min={0} required value={f.price} onChange={set('price')} /></label>
            <label className="field">Usual seats (1–30)<input type="number" min={1} max={30} required value={f.capacity} onChange={set('capacity')} /></label>
            <button className="btn primary">Add activity</button>
          </form>
          <div className="scroll"><table>
            <thead><tr><th>Photo</th><th>Activity</th><th>Category</th><th>Usual price</th><th>Seats</th><th>Shown in app</th><th /></tr></thead>
            <tbody>{d.activities.map((a) => (
              <tr key={a.id} className={a.active ? '' : 'off'}>
                <td>{a.imageKey && d.imageBase
                  ? <img src={`${d.imageBase}/${a.imageKey}`} alt="" style={{ width: 48, height: 48, objectFit: 'cover', border: '2px solid var(--ink)' }} />
                  : <span className="muted">—</span>}</td>
                <td><b>{a.name}</b></td>
                <td>{category(a.categoryId)?.emoji} {category(a.categoryId)?.name}</td>
                <td className="num">{rupees(a.defaultPrice)}</td>
                <td className="num">{a.defaultCapacity}</td>
                <td><label className="row" style={{ cursor: 'pointer' }}><input type="checkbox" style={{ height: 18, width: 18 }} checked={a.active} onChange={() => update(a, { active: !a.active })} /> {a.active ? 'Yes' : 'Hidden'}</label></td>
                <td><div className="row" style={{ justifyContent: 'flex-end' }}>
                  <button className="btn small" onClick={() => edit(a)}>Edit</button>
                  <label className="btn small" style={{ display: 'inline-flex', alignItems: 'center' }}>Photo
                    <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => photo(a, e.target.files?.[0])} /></label>
                </div></td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>

        <section className="grid2">
          <div>
            <div className="row" style={{ justifyContent: 'space-between' }}><h2>Zones</h2><button className="btn small" onClick={addZone}>Add zone</button></div>
            <table><tbody>{d.zones.map((z) => (
              <tr key={z.id}><td><b>{z.name}</b></td><td style={{ textAlign: 'right' }}><button className="btn small" onClick={() => rename(`/admin/zones/${z.id}`, z.name)}>Rename</button></td></tr>
            ))}</tbody></table>
            <p className="muted" style={{ marginTop: 8 }}>Only one slot can run in a zone at a time.</p>
          </div>
          <div>
            <h2>Categories (Home screen groups)</h2>
            <table><tbody>{d.categories.map((c) => (
              <tr key={c.id}><td>{c.emoji} <b>{c.name}</b></td><td style={{ textAlign: 'right' }}><button className="btn small" onClick={() => rename(`/admin/categories/${c.id}`, c.name)}>Rename</button></td></tr>
            ))}</tbody></table>
          </div>
        </section>
      </>}
    </>
  );
}
