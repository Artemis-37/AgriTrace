/** Logique pure et testable : l'utilisateur détient-il toutes les permissions requises ? */
export function hasAllPermissions(granted: ReadonlySet<string>, required: readonly string[]): boolean {
  return required.every((p) => granted.has(p));
}
