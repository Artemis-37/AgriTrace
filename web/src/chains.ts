import { get, post } from './api';

// Filières proposées par défaut : les produits pour lesquels l'outil est conçu.
export const COMMON_CHAINS: [string, string][] = [
  ['CACAO', 'Cacao'], ['CAFE', 'Café'], ['PALMIER-HUILE', 'Palmier à huile'], ['ANACARDE', 'Anacarde'],
  ['HEVEA', 'Hévéa'], ['COTON', 'Coton'], ['MANGUE', 'Mangue'], ['RIZ', 'Riz'],
];

const checked = new Set<string>();

/** Liste des filières de la coopérative ; les filières courantes manquantes sont ajoutées une fois (si le profil a le droit de les gérer). */
export async function getChains(): Promise<any[]> {
  let list = await get<any[]>('/value-chains');
  let org = '';
  try { org = sessionStorage.getItem('agritrace.org') ?? ''; } catch { /* stockage indisponible */ }
  if (checked.has(org)) return list;
  checked.add(org);
  const have = new Set(list.map((v) => String(v.code).toUpperCase()));
  let added = false;
  for (const [code, name] of COMMON_CHAINS) {
    if (have.has(code) || list.some((v) => String(v.name).toLowerCase() === name.toLowerCase())) continue;
    try { await post('/value-chains', { code, name }); added = true; } catch { break; } // pas le droit (ou déjà créée) : on s'arrête
  }
  if (added) list = await get<any[]>('/value-chains');
  return list;
}
