import { BadRequestException } from '@nestjs/common';

// Mots de passe les plus courants (en minuscules, sans accents) : refusés même avec une majuscule ou un chiffre ajouté à la fin.
const COMMON = ['password', 'motdepasse', 'azerty', 'qwerty', 'admin', 'administrateur', 'agritrace', 'cooperative', 'cacao', 'bienvenue', 'welcome', 'abidjan',
  'cotedivoire', 'ivoire', 'letmein', 'iloveyou', 'changeme', 'soleil', 'football', 'dragon', 'master', 'secret', 'azertyuiop', 'abc123', '123456', '000000', '111111'];

/**
 * Politique de mot de passe (OWASP) : 10 caractères au moins, jamais un mot de passe courant ni l'adresse e-mail,
 * et soit 16 caractères ou plus (phrase de passe), soit au moins trois sortes de caractères (minuscule, majuscule, chiffre, symbole).
 * Renvoie le motif du refus, ou null si le mot de passe convient.
 */
export function passwordProblem(pw: string, email?: string): string | null {
  if (typeof pw !== 'string' || pw.length < 10) return 'Le mot de passe doit faire 10 caractères au moins';
  if (pw.length > 200) return 'Le mot de passe est trop long (200 caractères au plus)';
  const flat = pw.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  if (new Set(flat).size < 5) return 'Mot de passe trop répétitif';
  if (COMMON.some((c) => flat === c || (flat.startsWith(c) && flat.length - c.length <= 4) || (flat.endsWith(c) && flat.length - c.length <= 4))) return 'Mot de passe trop courant : choisissez-en un autre';
  if (/(0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef|qwert|azert)/.test(flat) && flat.length < 16) return 'Mot de passe trop prévisible (suite de caractères)';
  if (email) {
    const local = email.toLowerCase().split('@')[0];
    if (local.length >= 4 && flat.includes(local.replace(/[^a-z0-9]/g, ''))) return 'Le mot de passe ne doit pas contenir votre adresse e-mail';
  }
  const kinds = [/[a-zà-ÿ]/, /[A-ZÀ-Ý]/, /\d/, /[^A-Za-zÀ-ÿ0-9]/].filter((r) => r.test(pw)).length;
  if (pw.length < 16 && kinds < 3) return 'Utilisez au moins trois sortes de caractères (minuscules, majuscules, chiffres, symboles) ou une phrase de 16 caractères';
  return null;
}
export function assertStrongPassword(pw: string, email?: string) {
  const p = passwordProblem(pw, email);
  if (p) throw new BadRequestException(p);
}
