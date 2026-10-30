import { useState } from 'react';
import { api, message, useApi } from '../api.ts';
import { rupees } from '@fmh/shared/time';
import { Icon } from '../icons.tsx';
import { ask, askForm, cat, Drawer, toast } from '../ui.tsx';
import type { Activity, Catalog as CatalogData, Category, Host } from '../types.ts';

/** Uploads a photo with a signed form from our API, then returns the storage key. */
async function uploadImage(file: File) {
  if (file.size > 5 * 1024 * 1024) throw new Error('Image is larger than 5 MB.');
  const { url, fields, key } = await api<{ url: string; fields: Record<string, string>; key: string }>('/admin/uploads', { folder: 'activities', contentType: file.type });
  const form = new FormData();
  Object.entries(fields).forEach(([k, v]) => form.append(k, v));
  form.append('file', file);
  if (!(await fetch(url, { method: 'POST', body: form })).ok) throw new Error('Upload failed. Please try again.');
  return key;
}

const LEVELS = ['All levels', 'Beginner', 'Intermediate', 'Advanced'];
const blank = { name: '', categoryId: '', price: '', capacity: '20', durationMin: '60', level: 'All levels', hostId: '', bring: '', about: '' };
type Form = typeof blank;
const toForm = (a: Activity): Form => ({
  name: a.name, categoryId: String(a.categoryId), price: String(a.defaultPrice / 100), capacity: String(a.defaultCapacity),
  durationMin: String(a.durationMin), level: a.level, hostId: a.defaultHostId ? String(a.defaultHostId) : '', bring: a.bring ?? '', about: a.about ?? '',
});
const toBody = (f: Form) => ({
  name: f.name.trim(), categoryId: Number(f.categoryId), defaultPrice: Math.round(Number(f.price) * 100), defaultCapacity: Number(f.capacity),
  durationMin: Number(f.durationMin), level: f.level, defaultHostId: f.hostId ? Number(f.hostId) : null,
  bring: f.bring.trim() || null, about: f.about.trim() || null,
});
const errText = (e: unknown) => (e instanceof Error && !('code' in e) ? e.message : message(e));

export function Catalog() {
  const data = useApi<CatalogData>('/admin/catalog');
  const [editing, setEditing] = useState<Activity | 'new' | null>(null);
  const ok = (text: string) => { toast(text); data.reload(); };
  const fail = (e: unknown) => toast(errText(e), true);

  const update = (a: Activity, body: Partial<Activity>, text = `${a.name} updated.`) => api(`/admin/activities/${a.id}`, body, 'PATCH').then(() => ok(text), fail);
  const remove = async (a: Activity) => {
    if (await ask({ title: `Delete ${a.name}?`, body: 'Only an activity that was never scheduled can be deleted. Otherwise, hide it from the app instead.', confirm: 'Delete', danger: true }))
      api(`/admin/activities/${a.id}`, undefined, 'DELETE').then(() => ok(`${a.name} deleted.`), fail);
  };
  const photo = async (a: Activity, file?: File) => {
    if (!file) return;
    try { await update(a, { imageKey: await uploadImage(file) }, 'Photo updated.'); } catch (e) { fail(e); }
  };
  const editCategory = async (c: Category) => {
    const v = await askForm({ title: 'Edit category', confirm: 'Save', fields: [
      { name: 'name', label: 'Name', value: c.name }, { name: 'color', label: 'Card colour', type: 'color', value: c.color },
    ] });
    if (v) api(`/admin/categories/${c.id}`, { name: v.name.trim(), color: v.color.toUpperCase() }, 'PATCH').then(() => ok('Category saved.'), fail);
  };
  const editHost = async (h?: Host) => {
    const v = await askForm({ title: h ? 'Edit host' : 'Add host', confirm: 'Save', fields: [
      { name: 'name', label: 'Name', value: h?.name ?? '' }, { name: 'bio', label: 'Short bio (optional)', type: 'textarea', required: false, value: h?.bio ?? '' },
    ] });
    if (!v) return;
    const body = { name: v.name.trim(), bio: v.bio.trim() || null };
    (h ? api(`/admin/hosts/${h.id}`, body, 'PATCH') : api('/admin/hosts', body)).then(() => ok(h ? 'Host saved.' : 'Host added.'), fail);
  };

  const d = data.data;
  const category = (id: number) => d?.categories.find((c) => c.id === id);
  const host = (id: number | null) => d?.hosts.find((h) => h.id === id);

  return (
    <>
      <header className="page"><div><h1>Activities</h1><span className="sub">What members can book · {d?.activities.filter((a) => a.active).length ?? 0} activities live in the app</span></div>
        <button className="btn primary" onClick={() => setEditing('new')} disabled={!d}><Icon n="plus" s={16} />New activity</button></header>
      {data.error && <p className="note error">{data.error}</p>}
      {d && <>
        <section>
          <h2>Activities</h2>
          <div className="scroll"><table>
            <thead><tr><th>Activity</th><th>Category</th><th>Usual price</th><th>Seats</th><th>Length</th><th>Host</th><th>In app</th><th /></tr></thead>
            <tbody>{d.activities.map((a) => (
              <tr key={a.id} className={a.active ? '' : 'off'}>
                <td><div className="row" style={{ flexWrap: 'nowrap', gap: 12 }}>
                  {a.imageKey && d.imageBase
                    ? <img src={`${d.imageBase}/${a.imageKey}`} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 8 }} />
                    : <span style={{ width: 40, height: 40, borderRadius: 8, background: 'var(--active)', display: 'grid', placeItems: 'center', color: 'var(--text-3)' }}><Icon n="image" s={18} /></span>}
                  <div><b>{a.name}</b><div className="muted" style={{ fontSize: 12 }}>{a.level}</div></div></div></td>
                <td><span className="tag cat" style={cat(category(a.categoryId)?.color)}>{category(a.categoryId)?.name}</span></td>
                <td className="num">{rupees(a.defaultPrice)}</td>
                <td className="num">{a.defaultCapacity}</td>
                <td className="num">{a.durationMin} min</td>
                <td>{host(a.defaultHostId)?.name ?? <span className="muted">—</span>}</td>
                <td><label className="check"><input type="checkbox" checked={a.active} onChange={() => update(a, { active: !a.active }, a.active ? `${a.name} hidden from the app.` : `${a.name} is live in the app.`)} />{a.active ? 'Live' : 'Hidden'}</label></td>
                <td><div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap', gap: 4 }}>
                  <button className="btn small" onClick={() => setEditing(a)}>Edit</button>
                  <label className="btn small icon" title="Upload photo"><Icon n="image" s={16} />
                    <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => photo(a, e.target.files?.[0])} /></label>
                  <button className="btn small icon" title="Delete" onClick={() => remove(a)}><Icon n="trash" s={16} /></button>
                </div></td>
              </tr>
            ))}</tbody>
          </table></div>
          {!d.activities.length && <p className="empty">No activities yet. Add the first one.</p>}
        </section>

        <div className="grid2" style={{ marginTop: 16 }}>
          <section>
            <div className="spread"><h2>Hosts & instructors</h2><button className="btn small" onClick={() => editHost()}><Icon n="userplus" s={14} />Add host</button></div>
            <table><tbody>{d.hosts.map((h) => (
              <tr key={h.id} className={h.active ? '' : 'off'}>
                <td><b>{h.name}</b>{h.bio && <div className="muted" style={{ fontSize: 12 }}>{h.bio}</div>}</td>
                <td><div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                  <button className="btn small" onClick={() => editHost(h)}>Edit</button>
                  <button className="btn small ghost" onClick={() => api(`/admin/hosts/${h.id}`, { active: !h.active }, 'PATCH').then(() => ok(h.active ? `${h.name} retired.` : `${h.name} is back.`), fail)}>
                    {h.active ? 'Retire' : 'Bring back'}</button>
                </div></td>
              </tr>
            ))}</tbody></table>
            {!d.hosts.length && <p className="empty">No hosts yet.</p>}
          </section>
          <section>
            <h2>Categories <small>Home screen filters</small></h2>
            <table><tbody>{d.categories.map((c) => (
              <tr key={c.id}><td><span className="tag cat" style={cat(c.color)}>{c.name}</span> <span className="muted num" style={{ fontSize: 12, marginLeft: 6 }}>{c.color}</span></td>
                <td style={{ textAlign: 'right' }}><button className="btn small" onClick={() => editCategory(c)}>Edit</button></td></tr>
            ))}</tbody></table>
            <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>The whole centre runs one session at a time, with 30 minutes to change over.</p>
          </section>
        </div>
      </>}
      {editing && d && <ActivityDrawer data={d} activity={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(t) => { ok(t); setEditing(null); }} />}
    </>
  );
}

function ActivityDrawer({ data, activity, onClose, onSaved }: { data: CatalogData; activity: Activity | null; onClose: () => void; onSaved: (text: string) => void }) {
  const [f, setF] = useState(activity ? toForm(activity) : blank);
  const [error, setError] = useState('');
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    try {
      if (activity) await api(`/admin/activities/${activity.id}`, toBody(f), 'PATCH');
      else await api('/admin/activities', toBody(f));
      onSaved(activity ? `${f.name} saved.` : `${f.name} added.`);
    } catch (err) { setError(errText(err)); }
  };
  return (
    <Drawer kicker="Activities" title={activity ? activity.name : 'New activity'} onClose={onClose}
      foot={<><button form="activity" className="btn primary lg">{activity ? 'Save' : 'Add activity'}</button><button className="btn lg" onClick={onClose}>Cancel</button></>}>
      <form id="activity" className="form" onSubmit={save}>
        <label className="field wide">Name<input required maxLength={60} value={f.name} onChange={set('name')} /></label>
        <label className="field">Category<select required value={f.categoryId} onChange={set('categoryId')}>
          <option value="">Choose…</option>{data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="field">Level<select value={f.level} onChange={set('level')}>{LEVELS.map((l) => <option key={l}>{l}</option>)}</select></label>
        <label className="field">Usual price (₹)<input type="number" min={0} required value={f.price} onChange={set('price')} /></label>
        <label className="field">Usual seats (1–30)<input type="number" min={1} max={30} required value={f.capacity} onChange={set('capacity')} /></label>
        <label className="field">Length (min)<input type="number" min={15} max={720} step={15} required value={f.durationMin} onChange={set('durationMin')} /></label>
        <label className="field">Usual host<select value={f.hostId} onChange={set('hostId')}>
          <option value="">None</option>{data.hosts.filter((h) => h.active).map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></label>
        <label className="field wide">What to bring<input maxLength={200} placeholder="e.g. Yoga mat, water bottle" value={f.bring} onChange={set('bring')} /></label>
        <label className="field wide">About <span className="muted" style={{ fontWeight: 500 }}>shown on the activity page</span>
          <textarea rows={5} maxLength={2000} value={f.about} onChange={set('about')} /></label>
      </form>
      {error && <p className="note error"><Icon n="alert" s={16} />{error}</p>}
    </Drawer>
  );
}
