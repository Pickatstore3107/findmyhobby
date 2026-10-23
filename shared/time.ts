// All times come from the API in UTC and are shown in India time (IST, UTC+5:30, no daylight saving).
const IST = 5.5 * 3600e3, DAY = 864e5;
const ist = (d: string | Date) => new Date(+new Date(d) + IST); // read with getUTC* to get IST values
const pad = (n: number) => String(n).padStart(2, '0');

/** Midnight IST, `offset` days from today, as a real Date. */
export const istDay = (offset = 0, from = Date.now()) => new Date(Math.floor((from + IST) / DAY) * DAY - IST + offset * DAY);
/** Hours since IST midnight, e.g. 18.5 for 6:30 PM. */
export const istHours = (d: string | Date) => (+ist(d) % DAY) / 3600e3;
/** "2026-10-23" in IST, for grouping and <input type="date">. */
export const istDate = (d: string | Date) => ist(d).toISOString().slice(0, 10);
/** Builds a real Date from an IST date and time typed in a form. */
export const fromIst = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);

export function fmtTime(d: string | Date) {
  const t = ist(d), h = t.getUTCHours(), m = t.getUTCMinutes();
  return `${h % 12 || 12}${m ? ':' + pad(m) : ''} ${h < 12 ? 'AM' : 'PM'}`;
}
/** "6–7 PM", or "11 AM–1 PM" when the period changes. */
export function fmtRange(a: string | Date, b: string | Date) {
  const [x, y] = [fmtTime(a), fmtTime(b)];
  return x.slice(-2) === y.slice(-2) ? `${x.slice(0, -3)}–${y}` : `${x}–${y}`;
}
export const fmtDay = (d: string | Date) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short' });
export const rupees = (paise: number | string) => '₹' + (Number(paise) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
