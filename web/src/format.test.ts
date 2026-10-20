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
