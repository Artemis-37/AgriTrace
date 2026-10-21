export type Question = { key: string; label: string; type: 'text' | 'number' | 'select'; required: boolean; options: string[] };

const yn = ['Oui', 'Non'];
const q = (key: string, label: string, type: Question['type'] = 'text', required = true, options: string[] = []): Question => ({ key, label, type, required, options });

/** Modèles proposés au départ : l'ADG les charge, les adapte à sa coopérative puis les déploie. */
export const DEFAULT_INFRASTRUCTURES: Record<string, Question[]> = {
  École: [
    q('nom', "Nom de l'école"), q('niveau', 'Niveau académique', 'select', true, ['Maternelle', 'Primaire', 'Collège', 'Lycée']),
    q('type', "Type d'école", 'select', true, ['Publique', 'Privée', 'Communautaire']), q('capacite', 'Capacité totale', 'number'),
    q('genre', 'Genre', 'select', true, ['Mixte', 'Filles', 'Garçons']), q('classes', 'Nombre de classes', 'number'),
    q('inscrits_garcons', "Nombre d'étudiants inscrits", 'number'), q('inscrites_filles', "Nombre d'étudiantes inscrites", 'number'),
    q('enseignants', "Nombre d'enseignants", 'number'), q('frais', 'Frais de scolarité par an', 'number'),
    q('cantine', "L'école dispose-t-elle d'une cantine opérationnelle ?", 'select', true, yn), q('latrines', "L'école dispose-t-elle des latrines fonctionnelles ?", 'select', true, yn),
    q('pct_classe_suivante', "Pourcentage d'élèves ayant passé à la classe suivante (au cours de la dernière année scolaire)", 'number'),
    q('pct_examen', "Pourcentage d'élèves ayant passé l'examen CM2 ou ayant passé au lycée (au cours de la dernière année scolaire)", 'number'),
    q('finance_partenaire', 'Financé par un partenaire ?', 'select', false, yn), q('annee_ouverture', "Année d'ouverture", 'number'), q('finance_prime', 'Financé par la prime au cacao ?', 'select', false, yn),
  ],
};

export const DEFAULT_TRAINING_THEMES: Record<string, string[]> = {
  'Agriculture régénératrice': [
    'Actions paysagères', 'Agroforesterie et arbres à la ferme', "Conservation de l'eau après la récolte", "Conservation de l'eau avant la récolte",
    "Contrôle de l'érosion des sols", 'Correction du sol', 'Couverture permanente du sol', 'Cultures intercalaires et rotations des cultures',
    'Gestion des eaux usées', 'Gestion des résidus de récolte et des déchets',
  ],
  'Alimentation saine et nutrition': [], 'Collecte de documents et tenue de registres': [], 'Culture commerciale et financière': [], Diversification: [],
  'Eau, assainissement, et hygiène': [], "Entreprise responsable et droits de l'homme": [], 'Genre, jeunesse, et inclusion': [], 'Gestion des récoltes et des produits': [],
  'Gouvernance coopérative': [], 'Maladies transmissibles et non transmissibles': [], 'Normes et réglementations de certification': [], 'Santé et sécurité au travail': [],
  'Santé générale': [], 'Santé maternelle et reproductive': [],
};

/** Vérifie et normalise une définition ; renvoie un message d'erreur ou la définition propre. */
export function cleanDefinition(kind: string, d: any): { error?: string; value?: any } {
  if (!d || typeof d !== 'object') return { error: 'Définition manquante' };
  if (kind === 'training_theme') {
    const mods = Array.isArray(d.modules) ? d.modules.map((m: any) => String(m).trim()).filter(Boolean) : null;
    if (!mods) return { error: 'La liste des modules est requise (elle peut être vide)' };
    if (mods.length > 100 || mods.some((m: string) => m.length > 200)) return { error: 'Trop de modules ou module trop long' };
    return { value: { modules: [...new Set<string>(mods)] } };
  }
  if (!Array.isArray(d.questions) || d.questions.length < 1 || d.questions.length > 60) return { error: 'Entre 1 et 60 questions sont requises' };
  const keys = new Set<string>();
  const out: Question[] = [];
  for (const x of d.questions) {
    const key = String(x?.key ?? '').trim(), label = String(x?.label ?? '').trim();
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) return { error: `Identifiant de question invalide : « ${key} » (minuscules, chiffres et _ ; 40 caractères)` };
    if (keys.has(key)) return { error: `Identifiant en double : ${key}` };
    if (!label || label.length > 300) return { error: `Libellé invalide pour « ${key} »` };
    if (!['text', 'number', 'select'].includes(x.type)) return { error: `Type invalide pour « ${key} »` };
    const options = Array.isArray(x.options) ? [...new Set<string>(x.options.map((o: any) => String(o).trim()).filter(Boolean))] : [];
    if (x.type === 'select' && (options.length < 2 || options.length > 30)) return { error: `« ${label} » : une liste de choix demande 2 à 30 options` };
    keys.add(key);
    out.push({ key, label, type: x.type, required: x.required !== false, options: x.type === 'select' ? options : [] });
  }
  return { value: { questions: out } };
}
