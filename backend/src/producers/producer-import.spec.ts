import { findInFileDuplicates, resolveMapping, validateRow } from './producer-import';

describe('import producteurs', () => {
  const headers = ['Code', 'Nom', 'Prénoms', 'Téléphone', 'Village'];
  const mapping = resolveMapping(headers);

  it('reconnaît les en-têtes du modèle malgré accents et casse', () => {
    expect(mapping.last_name).toBe('Nom');
    expect(resolveMapping(['NOM', 'PRENOMS']).first_names).toBe('PRENOMS');
  });

  it('accepte un mapping explicite', () => {
    expect(resolveMapping(['Family'], { last_name: 'family' }).last_name).toBe('Family');
  });

  it('signale nom manquant et téléphone invalide', () => {
    const r = validateRow(2, { Nom: '', Prénoms: 'Awa', Téléphone: '12' }, mapping);
    expect(r.errors).toEqual(expect.arrayContaining(['Nom manquant', 'Téléphone invalide']));
  });

  it('nettoie le téléphone', () => {
    const r = validateRow(2, { Nom: 'Kone', Prénoms: 'Awa', Téléphone: '+225 07 01 02 03 04' }, mapping);
    expect(r.errors).toEqual([]);
    expect(r.data.phone).toBe('+2250701020304');
  });

  it('détecte les doublons dans le fichier sans les fusionner', () => {
    const a = validateRow(2, { Nom: 'Kone', Prénoms: 'Awa', Village: 'Hiré' }, mapping);
    const b = validateRow(3, { Nom: 'KONÉ', Prénoms: 'awa', Village: 'hire' }, mapping);
    expect(findInFileDuplicates([a, b]).get(3)).toMatch(/ligne 2/);
  });
});
