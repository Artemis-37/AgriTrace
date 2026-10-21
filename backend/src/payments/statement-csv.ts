/** Lecture d'un relevé bancaire CSV : séparateur détecté, guillemets, dates JJ/MM/AAAA ou AAAA-MM-JJ, nombres « 1 234,56 » ou « 1,234.56 ». */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, '');
  const first = t.split(/\r?\n/, 1)[0] ?? '';
  const delim = [';', '\t', ',', '|'].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((c) => c.trim() !== '')) rows.push(row); row = []; }
    else cell += ch;
  }
  row.push(cell); if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows.map((r) => r.map((c) => c.trim()));
}

export function parseDate(s: string): string | null {
  const v = s.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  let y: number, mo: number, d: number;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/.exec(v))) { d = +m[1]; mo = +m[2]; y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; }
  else return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** Nombre décimal en texte (4 décimales) ou null si illisible ; vide = 0. */
export function parseAmount(s: string): number | null {
  let v = s.replace(/[\s  ]/g, '').replace(/[A-Za-z]+$/, '');
  if (v === '') return 0;
  let neg = false;
  if (/^\(.*\)$/.test(v)) { neg = true; v = v.slice(1, -1); }
  if (v.startsWith('-')) { neg = !neg; v = v.slice(1); } else if (v.startsWith('+')) v = v.slice(1);
  const lc = v.lastIndexOf(','), lp = v.lastIndexOf('.');
  if (lc >= 0 && lp >= 0) v = lc > lp ? v.replace(/\./g, '').replace(',', '.') : v.replace(/,/g, '');
  else if (lc >= 0) v = /,\d{1,2}$/.test(v) ? v.replace(',', '.') : v.replace(/,/g, '');
  else if (lp >= 0 && /\.\d{3}$/.test(v) && v.split('.').length > 2) v = v.replace(/\./g, '');
  if (!/^\d+(\.\d+)?$/.test(v)) return null;
  const n = Number(v);
  return neg ? -n : n;
}
