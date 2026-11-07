import { describe, expect, it } from 'vitest';
import { errorMessage } from './api';
import { date, kg, money } from './format';

describe('formats', () => {
  it('formate les montants en FCFA sans décimales', () => {
    expect(money('130000.0000').replace(/\s/g, ' ')).toBe('130 000 FCFA');
  });
  it('gère les valeurs absentes', () => {
    expect(money(null)).toBe('—');
    expect(kg(undefined)).toBe('—');
    expect(date(null)).toBe('—');
  });
  it('formate une date UTC sans décalage de fuseau', () => {
    expect(date('2026-10-20T00:00:00.000Z')).toBe('20/10/2026');
  });
});

describe('errorMessage', () => {
  it('assemble les messages de validation', () => {
    expect(errorMessage({ message: ['a est requis', 'b invalide'] }, 'x')).toBe('a est requis ; b invalide');
  });
  it('utilise le texte du serveur ou le repli', () => {
    expect(errorMessage({ message: 'Permission insuffisante' }, 'x')).toBe('Permission insuffisante');
    expect(errorMessage(null, 'repli')).toBe('repli');
  });
});

import { bagWeightError } from './format';
describe('règle des sacs (50 à 75 kg)', () => {
  it('refuse 2 sacs pour 11 kg et accepte 110 kg', () => {
    expect(bagWeightError('11', 'kg', '2')).toContain('entre 100 et 150 kg');
    expect(bagWeightError('110', 'kg', '2')).toBeNull();
  });
  it('bornes incluses, autres unités ignorées', () => {
    expect(bagWeightError('150', 'kg', 3)).toBeNull();
    expect(bagWeightError('226', 'kg', 3)).not.toBeNull();
    expect(bagWeightError('5', 'sac', 2)).toBeNull();
  });
});
