/** Logique pure d'import des producteurs (testable sans base ni fichier). */

export const TARGET_FIELDS = [
  'internal_code', 'last_name', 'first_names', 'phone', 'region', 'department',
  'section', 'village', 'area_ha', 'estimated_kg', 'value_chains', 'joined_on', 'gender',
  'birth_date', 'id_doc_type', 'id_doc_number',
] as const;
export type TargetField = (typeof TARGET_FIELDS)[number];

/** En-têtes du modèle téléchargeable → champ cible. */
export const TEMPLATE_HEADERS: Record<TargetField, string> = {
  internal_code: 'Code',
  last_name: 'Nom',
  first_names: 'Prénoms',
  phone: 'Téléphone',
  region: 'Région',
  department: 'Département',
  section: 'Section',
  village: 'Sous-préfecture',
  area_ha: 'Superficie (ha)',
  estimated_kg: 'Estimation (kg)',
  value_chains: 'Filières',
  joined_on: "Date d'adhésion",
  gender: 'Sexe',
  birth_date: 'Date de naissance',
  id_doc_type: "Type de pièce d'identité",
  id_doc_number: "Numéro de la pièce d'identité",
};

/** Anciens intitulés (et variantes courantes) toujours reconnus à l'import. */
export const HEADER_ALIASES: Partial<Record<TargetField, string[]>> = {
  department: ['Quartier', 'Ville', 'Ville (chef-lieu de région)', 'Chef-lieu', 'Departement'],
  village: ['Lieu', 'Sous-préfecture', 'Sous prefecture', 'Village', 'Localité', 'Localite'],
  gender: ['Genre'],
  birth_date: ['Naissance', 'Né(e) le', 'Date naissance'],
  id_doc_type: ['Type de pièce', 'Type pièce', 'ID type'],
  id_doc_number: ['Numéro de pièce', 'N° pièce', 'Numéro pièce', 'N° CNI', 'CNI'],
};

export const normalize = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Correspondance colonnes → champs : mapping explicite de l'utilisateur, sinon reconnaissance des en-têtes du modèle. */
export function resolveMapping(headers: string[], explicit?: Partial<Record<TargetField, string>>) {
  const byNorm = new Map(headers.map((h) => [normalize(h), h]));
  const out: Partial<Record<TargetField, string>> = {};
  for (const f of TARGET_FIELDS) {
    const names = explicit?.[f] ? [explicit[f]!] : [TEMPLATE_HEADERS[f], ...(HEADER_ALIASES[f] ?? [])];
    const found = names.map((n) => byNorm.get(normalize(n))).find(Boolean);
    if (found) out[f] = found;
  }
  return out;
}

export interface ParsedRow {
  line: number;
  data: Partial<Record<TargetField, string>>;
  errors: string[];
}

const cleanPhone = (p: string) => p.replace(/[\s.\-()]/g, '');

export function validateRow(line: number, raw: Record<string, string>, mapping: Partial<Record<TargetField, string>>): ParsedRow {
  const get = (f: TargetField) => {
    const col = mapping[f];
    const v = col ? raw[col] : undefined;
    return v == null ? undefined : String(v).trim() || undefined;
  };
  const data: ParsedRow['data'] = {};
  for (const f of TARGET_FIELDS) {
    const v = get(f);
    if (v) data[f] = v;
  }
  const errors: string[] = [];
  if (!data.last_name) errors.push('Nom manquant');
  if (!data.first_names) errors.push('Prénoms manquants');
  if (data.phone) {
    data.phone = cleanPhone(data.phone);
    if (!/^\+?\d{8,15}$/.test(data.phone)) errors.push('Téléphone invalide');
  }
  for (const [f, label] of [['area_ha', 'Superficie'], ['estimated_kg', 'Estimation']] as const) {
    if (data[f]) {
      data[f] = data[f]!.replace(/\s/g, '').replace(',', '.');
      if (!/^\d+(\.\d{1,4})?$/.test(data[f]!)) errors.push(`${label} invalide (nombre positif)`);
    }
  }
  if (data.gender) {
    const g = normalize(data.gender);
    if (/^(m|h|masculin|homme|male)$/.test(g)) data.gender = 'male';
    else if (/^(f|feminin|femme|female)$/.test(g)) data.gender = 'female';
    else errors.push('Sexe invalide (M ou F)');
  }
  if (data.birth_date) {
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(data.birth_date);
    if (m) data.birth_date = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    const d = new Date(data.birth_date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.birth_date) || isNaN(d.getTime()) || d > new Date()) errors.push('Date de naissance invalide (JJ/MM/AAAA)');
  }
  if (data.id_doc_number && !data.id_doc_type) errors.push("Type de pièce d'identité manquant");
  if (data.joined_on && !/^\d{4}-\d{2}-\d{2}$/.test(data.joined_on)) errors.push("Date d'adhésion invalide (AAAA-MM-JJ)");
  if (data.internal_code && !/^[A-Za-z0-9_-]{1,30}$/.test(data.internal_code)) errors.push('Code invalide');
  return { line, data, errors };
}

/** Clé de détection de doublon à l'intérieur du fichier et face à la base. */
export const duplicateKeys = (d: ParsedRow['data']): string[] => {
  const keys: string[] = [];
  if (d.internal_code) keys.push(`code:${d.internal_code.toLowerCase()}`);
  if (d.phone) keys.push(`tel:${d.phone}`);
  if (d.last_name && d.first_names)
    keys.push(`nom:${normalize(d.last_name)}|${normalize(d.first_names)}|${normalize(d.village ?? '')}`);
  return keys;
};

export function findInFileDuplicates(rows: ParsedRow[]): Map<number, string> {
  const seen = new Map<string, number>();
  const dups = new Map<number, string>();
  for (const r of rows) {
    if (r.errors.length) continue;
    for (const k of duplicateKeys(r.data)) {
      const first = seen.get(k);
      if (first !== undefined) {
        dups.set(r.line, `Doublon dans le fichier avec la ligne ${first}`);
        break;
      }
      seen.set(k, r.line);
    }
  }
  return dups;
}
