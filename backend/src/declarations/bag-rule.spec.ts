import { bagWeightError } from './bag-rule';

describe('règle des sacs (50 à 75 kg)', () => {
  it('refuse 2 sacs pour 11 kg (zéro oublié)', () => expect(bagWeightError('11', 'kg', 2)).toContain('entre 100 et 150 kg'));
  it('accepte 2 sacs pour 110 kg', () => expect(bagWeightError('110', 'kg', 2)).toBeNull());
  it('bornes incluses', () => {
    expect(bagWeightError('150', 'kg', 3)).toBeNull();
    expect(bagWeightError('225', 'kg', 3)).toBeNull();
    expect(bagWeightError('149', 'kg', 3)).not.toBeNull();
    expect(bagWeightError('226', 'kg', 3)).not.toBeNull();
  });
  it('ne contrôle ni les autres unités ni l\'absence de sacs', () => {
    expect(bagWeightError('5', 'sac', 2)).toBeNull();
    expect(bagWeightError('110', 'kg', null)).toBeNull();
  });
});
