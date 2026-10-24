# Exportateur et échanges entre organisations

## Principe
Un **exportateur** est une organisation à part entière d'AgriTrace (type « exportateur »), au même titre qu'une coopérative : il a ses propres employés, sa caisse, sa comptabilité, ses stocks, ses rapports, **isolés** de ceux des coopératives (même sécurité par ligne que pour les coopératives). Il n'a pas d'agents de terrain : les menus de collecte (producteurs, parcelles, délégués, missions, données de terrain, modules de formation) n'apparaissent pas chez lui.

Ses agents se connectent avec leurs propres comptes, depuis le portail (ordinateur ou navigateur du téléphone). L'application mobile se connecte aussi avec ces comptes, mais **les écrans de livraison (pont bascule, analyse) n'existent pas encore dans l'application mobile** : ils sont dans le portail.

Chez l'exportateur, la **coopérative joue le rôle du délégué** : c'est elle qui livre, et l'écran **Coopératives** donne, pour chacune, les livraisons, les poids acceptés ou rejetés, ce qui reste à régler et ce qui est payé.

## Rôles chez l'exportateur
| Rôle | Ce qu'il fait |
|---|---|
| **Responsable pont bascule** (le magasinier de l'exportateur) | pèse l'**entrée** (camion chargé, poids brut) et la **sortie** (camion vide, tare) ; le **poids net** est calculé |
| **Analyste** | saisit les résultats de l'analyse (humidité, grainage, défauts, qualité), décide (acceptée / rejetée, motif obligatoire si rejet) et produit le **bulletin de pesée** |
| **Caissier / comptable** | fixent le prix et règlent la coopérative (droit « Régler ») |
| **Administrateur** | crée les comptes, propose et accepte les liens |
| Direction, comptable, caissier… | les rôles types existants servent tels quels |

Rôles à créer depuis Équipe → rôles types : *Responsable pont bascule*, *Analyste*.

## Mise en place (administrateur de plateforme)
1. Console du serveur → **Créer une organisation** : type *Exportateur*, code (il servira aux autres organisations pour proposer un lien), nom, premier administrateur.
2. L'administrateur de l'exportateur crée son équipe (Équipe).
3. **Lien** : l'une des deux organisations propose (Organisations liées / Coopératives → *Proposer un lien* avec le code de l'autre, sens « nous lui livrons » ou « elle nous livre », éventuellement « dans les deux sens ») ; **l'autre accepte**. Un lien révoqué n'autorise plus de nouvelles livraisons.

## Circuit d'une livraison
1. **Coopérative** : le responsable de traçabilité crée la fiche d'accompagnement (convois pesés) et la **transmet** à l'organisation liée (Fiches d'accompagnement → Transmettre → organisation liée).
2. **Exportateur** : la livraison apparaît (**Attendue**, numéro DL-aaaa-nnnnn), les responsables du pont bascule sont notifiés.
3. **Pont bascule** : *Peser l'entrée* (brut), puis *Peser la sortie* (tare) : poids net = brut − tare, écart avec le poids déclaré par la coopérative. La tare doit être inférieure au brut.
4. **Analyste** : *Analyser* → décision et **bulletin de pesée** (BP-aaaa-nnnnn), imprimable ou enregistrable en PDF depuis la fenêtre d'impression.
5. **Caisse** : *Régler* (livraison acceptée) : prix au kg, montant = poids net × prix, référence du paiement. L'écriture comptable se passe dans Comptabilité (le règlement de la livraison n'écrit pas automatiquement en comptabilité).
6. **Retour à la coopérative** : *Livraisons → Mes livraisons envoyées* : poids net, écart, décision, bulletin, montant, avec une notification à chaque étape.

Après l'analyse, les poids ne peuvent plus changer ; une livraison réglée ne peut plus être modifiée ; aucune livraison ne se supprime.

## Coopérative ↔ coopérative
Même circuit : un lien actif entre deux coopératives (dans un sens, ou dans les deux) permet à l'une de transmettre une fiche à l'autre, qui la reçoit comme livraison (pesée, analyse, bulletin, règlement). Pour livrer dans les deux sens, cocher « dans les deux sens » à la création du lien. Pour recevoir, la coopérative destinataire crée les rôles *Responsable pont bascule* et *Analyste* (ou les droits équivalents).

## Confidentialité
* La fiche transmise contient la liste des producteurs (noms, codes, poids) : c'est ce qu'une fiche d'accompagnement papier transmet déjà. Elle est **copiée** chez le destinataire au moment de la transmission.
* Chaque organisation ne voit que ses livraisons : le destinataire voit celles qu'il reçoit, le fournisseur voit celles qu'il a envoyées (sans les données internes de l'autre).
* Un lien peut être révoqué à tout moment ; les livraisons déjà reçues restent chez le destinataire. Prévoir dans le contrat entre organisations la durée de conservation de ces listes (voir DONNEES_PERSONNELLES).

## Limites actuelles
* Écrans de livraison dans le **portail** seulement (pas dans l'application mobile).
* Le règlement n'écrit pas dans la comptabilité ; la transmission est à sens unique par fiche (pas de retour de marchandise).
* Un serveur local de coopérative (mode « local ») ne réplique pas encore les livraisons vers le central : la transmission se fait depuis le serveur qui héberge à la fois la coopérative et l'exportateur.
* Pas de rapports spécifiques exportateur (les rapports existants restent disponibles).
