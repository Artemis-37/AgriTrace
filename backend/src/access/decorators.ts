import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';
export const NO_ORG = 'noOrg';
export const PERMISSIONS = 'permissions';
export const PLATFORM_ADMIN = 'platformAdmin';

/** Route sans authentification (login, refresh). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Route authentifiée mais sans contexte d'organisation (liste de mes organisations). */
export const NoOrg = () => SetMetadata(NO_ORG, true);
/** Permissions requises dans l'organisation courante (toutes obligatoires). */
export const RequirePermissions = (...codes: string[]) => SetMetadata(PERMISSIONS, codes);
/** Réservé aux administrateurs de plateforme (sans contexte d'organisation). */
export const PlatformAdminOnly = () => SetMetadata(PLATFORM_ADMIN, true);
