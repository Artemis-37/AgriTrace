import { canSubmit, canTransition, RECEPTION_STATES } from './declaration-states';

describe('états des déclarations', () => {
  it('autorise le parcours normal', () => {
    expect(canTransition('received', 'in_review')).toBe(true);
    expect(canTransition('in_review', 'accepted')).toBe(true);
  });
  it('interdit de sauter la vérification', () => {
    expect(canTransition('received', 'accepted')).toBe(false);
    expect(canTransition('draft', 'accepted')).toBe(false);
  });
  it('ne permet pas de déclarer une réception à la main', () => {
    for (const s of RECEPTION_STATES) expect(canTransition('accepted', s)).toBe(false);
  });
  it('interdit de sortir d’un état final', () => {
    expect(canTransition('rejected', 'accepted')).toBe(false);
    expect(canTransition('cancelled', 'draft')).toBe(false);
  });
  it('limite la soumission au brouillon et aux corrections', () => {
    expect(canSubmit('draft')).toBe(true);
    expect(canSubmit('to_correct')).toBe(true);
    expect(canSubmit('accepted')).toBe(false);
  });
});
