import { hasAllPermissions } from './permission-evaluator';

describe('hasAllPermissions', () => {
  const granted = new Set(['producers:read', 'users:read']);

  it('accepte quand toutes les permissions requises sont détenues', () => {
    expect(hasAllPermissions(granted, ['producers:read'])).toBe(true);
    expect(hasAllPermissions(granted, ['producers:read', 'users:read'])).toBe(true);
  });

  it('refuse quand une permission manque', () => {
    expect(hasAllPermissions(granted, ['producers:read', 'producers:export'])).toBe(false);
  });

  it('accepte une liste vide (route authentifiée sans permission particulière)', () => {
    expect(hasAllPermissions(new Set(), [])).toBe(true);
  });
});
