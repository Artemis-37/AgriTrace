# Audits : l'exportateur audite ses coopératives

## Principe
L'exportateur est le **supérieur hiérarchique** des coopératives qui travaillent avec lui. Il les audite dans un module dédié, **Audits** (menu *Suivi*). Les données des deux organisations restent séparées : **rien n'est lu en direct chez l'autre**. Chacun *partage* dans l'audit des copies figées de ses données, des documents ou des notes ; seuls les **participants désignés** de l'audit les voient.

## Supervision
1. L'exportateur propose la supervision d'une coopérative avec son code (*Audits → Supervision*).
2. La **coopérative l'accepte** (droit « liens »). Sans acceptation, aucun audit n'est possible.
3. La coopérative peut **révoquer** la supervision tant qu'aucun audit n'est en cours.

## Mission d'audit
* L'exportateur **programme** un audit : coopérative, intitulé, périmètre (traçabilité, stock, pesées, comptabilité, caisse, social, environnement), dates. Numéro AU-aaaa-nnnn ; la coopérative est notifiée.
* États : *Programmé → En cours → Rapport publié → Clos* (ou *Annulé*).
* **Participants** : chaque partie désigne ses propres participants. Qui n'est pas désigné ne voit ni les données partagées ni le journal d'accès.

## Données partagées
* **Extrait figé** : copie d'une vue de ses propres données sur une période. Coopérative : achats déclarés, connaissements pesés, stocks, mouvements financiers, fiches d'accompagnement, livraisons envoyées. Exportateur : livraisons reçues de la coopérative auditée. Les producteurs apparaissent par leur **code**, sans nom ni téléphone ; 5 000 lignes au plus.
* **Document** (10 Mo maximum, empreinte SHA-256) et **note**.
* Un partage ne se modifie pas ; son auteur peut le **retirer** (la donnée est alors effacée).
* **Journal d'accès** : chaque lecture d'un partage est inscrite chez celui qui l'a partagé (qui, quand, quoi).
* Un audit clos n'accepte plus de partage.

## Constats et plans d'action
L'exportateur saisit des constats (domaine, exigence, résultat : conforme, observation, mineure, majeure, critique, preuve, échéance). La coopérative ne les voit qu'après la **publication du rapport**. Elle répond à chaque constat non conforme (réponse, plan d'action, échéance) ; l'exportateur **vérifie** l'action, puis **clôt** l'audit avec une synthèse.

## Droits
`audits:manage` (exportateur : programmer, constats, clôture), `audits:share` (partager), `audits:respond` (coopérative : désigner, répondre), `audits:read` (consulter). Rôle prêt à l'emploi *Auditeur (exportateur)* ; le responsable de traçabilité de la coopérative lit, partage et répond.

## Limites
* Écrans dans le **portail** seulement (pas dans l'application mobile).
* Pas de modèles de grille d'audit : le périmètre est libre.
* Les extraits sont figés à la date du partage ; pour des chiffres à jour, repartager.
