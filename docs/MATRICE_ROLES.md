# Matrice des rôles et permissions (CDC §5, §35)

Fichier généré par `backend/scripts/gen-matrice-roles.js` à partir du code : ne pas le modifier à la main. Les menus du portail et les routes de l'API se règlent sur les **permissions**, jamais sur le nom du rôle. Une coopérative crée ses propres rôles en combinant ces permissions ; les cinq rôles ci-dessous sont des modèles proposés.

118 permissions, 271 routes protégées. Les droits sensibles (paiements, ajustements, exports de noms) peuvent en plus exiger une seconde approbation, réglée par rôle.

## Rôles types
- **Magasinier** (`magasinier`) : Réceptionne et pèse les convois au magasin central, tient les stocks et l'inventaire.
- **Caissier** (`caissier`) : Traite les convois reçus, règle les collecteurs, tient la caisse et les comptes des collecteurs.
- **Collecteur (délégué)** (`collecteur`) : Déclare ses achats chez les producteurs et ses convois, voit son stock, son historique et sa fiche de compte.
- **Administrateur de groupe (ADG)** (`adg`) : Responsable de la conformité et de la certification : suit les certificats, les inspections et la qualité, contrôle et vérifie les parcelles, met en place les missions des coachs et décide de leurs demandes.
- **Coach** (`coach`) : Agent de terrain suivi par l'ADG : exécute ses missions, relève des parcelles, joint des photos et demande de nouvelles missions.

## Permissions par domaine
Colonnes : ✓ = accordé par le rôle type. Les rôles Administrateur de coopérative et Administrateur de plateforme ne figurent pas : le premier gère les utilisateurs et les rôles de sa coopérative, le second crée les coopératives et n'a pas accès à leurs données.

### accounting
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `accounting:close` | Clôturer une période comptable |  |  |  |  |  | `POST /accounting/closures` |
| `accounting:post` | Saisir des écritures comptables |  |  |  |  |  | `POST /accounting/accounts`<br>`POST /financial-accounts/:id/accounting-code`<br>`POST /accounting/entries`<br>… +2 |
| `accounting:read` | Consulter journaux, grand livre et balance |  | ✓ |  |  |  | `GET /accounting/chart`<br>`GET /accounting/entries`<br>`GET /accounting/trial-balance`<br>… +3 |

### alerts
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `alerts:read` | Consulter les alertes et échéances |  |  |  | ✓ |  | `GET /alerts` |

### audit
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `audit:read` | Consulter les journaux d'audit |  |  |  |  |  | `GET /audit-logs` |

### buyers
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `buyers:manage` | Gérer les fiches acheteurs et les contrats |  |  |  |  |  | `POST /buyers`<br>`POST /buyers/:id/status`<br>`POST /sales-contracts` |
| `buyers:read` | Consulter les acheteurs, contrats et commandes |  |  |  |  |  | `GET /buyers`<br>`GET /sales-contracts`<br>`GET /sales-orders`<br>… +2 |

### campaigns
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `campaigns:manage` | Gérer les campagnes |  |  |  |  |  | `POST /campaigns` |
| `campaigns:read` | Consulter les campagnes |  |  |  | ✓ |  | `GET /campaigns` |

### cash
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `cash:manage` | Créer des caisses et comptes |  |  |  |  |  | `POST /cash-sessions/:id/settle-variance`<br>`POST /financial-accounts`<br>`POST /cash-registers` |
| `cash:operate` | Ouvrir, clôturer et enregistrer des opérations de caisse |  | ✓ |  |  |  | `POST /convoys/payout`<br>`POST /cash-registers/:id/sessions`<br>`POST /cash-sessions/:id/close`<br>… +1 |
| `cash:read` | Consulter les caisses |  |  |  |  |  | `GET /cash-registers` |

### certificates
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `certificates:manage` | Enregistrer et révoquer des certificats |  |  |  | ✓ |  | `POST /certificates`<br>`POST /certificates/:id/revoke` |
| `certificates:read` | Consulter les certificats |  |  |  | ✓ |  | `GET /certificates` |

### claims
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `claims:manage` | Enregistrer et traiter les réclamations des acheteurs |  |  |  |  |  | `POST /sales-claims`<br>`GET /sales-claims`<br>`POST /sales-claims/:id/resolve` |

### collector
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `collector:stock` | Consulter son propre stock acheté, ses convois et son compte (collecteur) |  |  | ✓ |  |  | `GET /convoys/my-stock` |

### collectors
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `collectors:manage` | Gérer les collecteurs et affectations |  |  |  |  |  | `POST /collectors`<br>`POST /collectors/:id/assignments`<br>`POST /collectors/:id/disable` |
| `collectors:read` | Consulter les collecteurs |  |  |  | ✓ |  | `GET /collectors` |

### convoys
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `convoys:create` | Déclarer un convoi (collecteur : n° de convoi, chauffeur, camion) |  |  | ✓ |  |  | `POST /convoys`<br>`GET /convoys/available-declarations` |
| `convoys:read` | Consulter les convois | ✓ | ✓ | ✓ |  |  | `GET /convoys/:id/declarations`<br>`GET /convoys`<br>`GET /convoys/statement` |
| `convoys:receive` | Réceptionner un convoi au magasin central (poids total, sacs) | ✓ |  |  |  |  | `GET /convoys/expected`<br>`POST /convoys/receive` |
| `convoys:settle` | Traiter un convoi en caisse et créditer le compte du collecteur |  | ✓ |  |  |  | `GET /convoys/cashier-queue`<br>`POST /convoy-receptions/:id/settle`<br>`GET /convoys/collectors`<br>… +4 |

### declarations
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `declarations:create` | Créer et soumettre des déclarations |  |  | ✓ |  |  | `POST /purchase-declarations`<br>`POST /purchase-declarations/:id/submit` |
| `declarations:read` | Consulter les déclarations d'achat |  |  | ✓ |  |  | `GET /purchase-declarations/settings/receipts`<br>`GET /purchase-declarations/export/xlsx`<br>`GET /purchase-declarations`<br>… +1 |
| `declarations:validate` | Vérifier, accepter ou rejeter des déclarations |  |  |  |  |  | `POST /purchase-declarations/:id/transition` |

### documents
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `documents:read` | Consulter et télécharger les documents |  |  |  | ✓ |  | `GET /documents`<br>`GET /documents/:id/download` |
| `documents:sensitive` | Télécharger les documents sensibles |  |  |  | ✓ |  | `GET /documents/:id/downloads` |
| `documents:upload` | Déposer des documents |  |  | ✓ | ✓ | ✓ | `POST /documents` |

### finance
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `finance:read` | Consulter les comptes et transactions |  | ✓ |  |  |  | `GET /financial-accounts`<br>`GET /financial-accounts/:id/transactions`<br>`GET /reports/finance`<br>… +1 |
| `finance:reverse` | Passer une écriture compensatoire |  |  |  |  |  | `POST /financial-transactions/:id/reverse`<br>`POST /loan-repayments/:id/reverse` |

### geo
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `geo:anomalies` | Consulter et traiter les anomalies cartographiques |  |  |  | ✓ |  | `GET /geo/anomalies`<br>`POST /geo/anomalies/:id/resolve`<br>`POST /geo/anomalies/:id/assign`<br>… +4 |
| `geo:export` | Exporter des parcelles (GeoJSON, KML, KMZ, Shapefile, GeoPackage) |  |  |  | ✓ |  | `GET /geo/export` |
| `geo:export_names` | Inclure le nom des producteurs dans les exports cartographiques |  |  |  |  |  | — |
| `geo:import` | Importer des parcelles depuis un fichier cartographique |  |  |  |  |  | `POST /geo/imports`<br>`GET /geo/imports`<br>`GET /geo/imports/:id`<br>… +3 |
| `geo:layers` | Charger et gérer les couches de référence (zones protégées) |  |  |  | ✓ |  | `POST /geo/layers`<br>`POST /geo/layers/rescan`<br>`DELETE /geo/layers/:id` |
| `geo:merge` | Remplacer un doublon de parcelle par une parcelle de référence |  |  |  |  |  | `POST /geo/merges` |
| `geo:override` | Accepter une exception (chevauchement ou doublon) de façon motivée |  |  |  |  |  | — |
| `geo:settings` | Configurer les tolérances géométriques |  |  |  |  |  | `PUT /geo/settings` |

### inspections
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `inspections:perform` | Planifier, réaliser et clôturer des inspections et actions correctives |  |  |  | ✓ | ✓ | `POST /inspections`<br>`POST /inspections/:id/start`<br>`POST /inspections/:id/results`<br>… +4 |
| `inspections:read` | Consulter les inspections |  |  |  | ✓ |  | `GET /inspections`<br>`GET /inspections/:id` |

### invoices
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `invoices:issue` | Émettre et annuler des factures |  |  |  |  |  | `POST /invoices`<br>`POST /invoices/:id/cancel`<br>`POST /invoices/:id/credit-notes` |
| `invoices:payments` | Enregistrer les paiements reçus |  |  |  |  |  | `POST /invoices/:id/payments` |
| `invoices:read` | Consulter les factures et soldes |  |  |  |  |  | `GET /buyers/:id/statement`<br>`GET /invoices`<br>`GET /invoices/:id` |

### loans
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `loans:approve` | Approuver ou rejeter (utilisateur distinct du demandeur) |  |  |  |  |  | `POST /loans/:id/approve`<br>`POST /loans/:id/reject` |
| `loans:disburse` | Décaisser un prêt approuvé |  |  |  |  |  | `POST /loans/:id/disburse` |
| `loans:read` | Consulter prêts et préfinancements |  |  |  |  |  | `GET /loans`<br>`GET /loans/:id` |
| `loans:repay` | Enregistrer un remboursement |  |  |  |  |  | `POST /loans/:id/repayments` |
| `loans:request` | Demander et analyser un prêt ou préfinancement |  |  |  |  |  | `POST /loans`<br>`POST /loans/:id/analyze`<br>`POST /loans/:id/cancel` |

### logistics
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `logistics:manage` | Gérer transporteurs, véhicules et conducteurs |  |  |  |  |  | `POST /carriers`<br>`POST /vehicles`<br>`POST /drivers` |
| `logistics:read` | Consulter transporteurs, véhicules, conducteurs et expéditions |  |  |  |  |  | `GET /carriers`<br>`GET /vehicles`<br>`GET /drivers`<br>… +2 |

### lots
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `lots:manage` | Diviser et fusionner des lots |  |  |  |  |  | `POST /lots/merge`<br>`POST /lots/:id/split` |
| `lots:read` | Consulter les lots et la traçabilité | ✓ |  |  |  |  | `GET /lots`<br>`GET /lots/:id/traceability`<br>`GET /lots/:id/traceability.pdf`<br>… +1 |

### messages
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `messages:use` | Échanger des messages avec les autres postes de la coopérative | ✓ | ✓ | ✓ | ✓ | ✓ | `POST /messages`<br>`GET /messages/contacts`<br>`GET /messages/unread-count`<br>… +2 |

### notifications
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `notifications:scan` | Lancer la recherche d'alertes |  |  |  | ✓ |  | `POST /notifications/scan` |

### orders
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `orders:manage` | Créer, confirmer et annuler des commandes, affecter des lots |  |  |  |  |  | `POST /sales-orders`<br>`POST /sales-orders/:id/confirm`<br>`POST /sales-orders/:id/cancel`<br>… +3 |

### organizations
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `organizations:manage` | Gérer les organisations |  |  |  |  |  | — |
| `organizations:read` | Consulter les organisations |  |  |  |  |  | — |

### parcels
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `parcels:control` | Contrôler les données d'une parcelle |  |  |  | ✓ |  | `POST /parcels/:id/control` |
| `parcels:create` | Enregistrer des parcelles |  |  |  |  | ✓ | `POST /parcels` |
| `parcels:read` | Consulter les parcelles |  |  |  | ✓ | ✓ | `GET /geo/settings`<br>`GET /geo/map`<br>`GET /parcels/checks`<br>… +2 |
| `parcels:update` | Modifier une parcelle (repasse en « déclarée ») |  |  |  |  |  | `POST /parcels/:id/update`<br>`POST /parcels/:id/archive` |
| `parcels:verify` | Vérifier une parcelle (inspection conforme exigée) |  |  |  | ✓ |  | `POST /parcels/:id/verify` |

### payments
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `payments:confirm` | Confirmer manuellement un paiement |  |  |  |  |  | `POST /payments/:id/confirm`<br>`POST /payments/:id/refund` |
| `payments:manage` | Préparer et suivre les paiements |  |  |  |  |  | `POST /payments`<br>`POST /payments/:id/transition` |
| `payments:read` | Consulter les paiements |  |  |  |  |  | `GET /payments`<br>`GET /payments/:id` |

### prefinancing
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `prefinancing:manage` | Enregistrer préfinancements, utilisations et remboursements |  |  |  |  |  | `POST /prefinancings`<br>`POST /prefinancings/:id/uses`<br>`POST /prefinancings/:id/repayments` |
| `prefinancing:read` | Consulter les préfinancements |  |  |  |  |  | `GET /prefinancings`<br>`GET /prefinancings/report`<br>`GET /prefinancings/:id` |

### prices
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `prices:manage` | Gérer les barèmes de prix |  |  |  |  |  | `POST /price-schedules`<br>`POST /price-schedules/:id/versions` |
| `prices:read` | Consulter les prix |  |  |  |  |  | `GET /prices` |

### producers
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `producers:create` | Créer des producteurs |  |  |  |  |  | `POST /producers`<br>`POST /producers/imports` |
| `producers:export` | Exporter les producteurs |  |  |  |  |  | — |
| `producers:import` | Importer des producteurs depuis Excel |  |  |  |  |  | `GET /producers/imports/template`<br>`POST /producers/imports` |
| `producers:read` | Consulter les producteurs |  |  | ✓ | ✓ | ✓ | `GET /producers/:id/status-history`<br>`GET /producers`<br>`GET /producers/:id` |
| `producers:status` | Changer le statut d'un producteur |  |  |  |  |  | `POST /producers/:id/status` |
| `producers:update` | Modifier des producteurs |  |  |  |  |  | — |

### quality
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `quality:manage` | Configurer les règles qualité |  |  |  | ✓ |  | `POST /quality-rules`<br>`POST /quality-rules/:id/deactivate` |
| `quality:read` | Consulter les règles qualité |  |  |  | ✓ |  | `GET /quality-rules`<br>`GET /reports/quality`<br>`GET /reports/quality/xlsx` |

### receipts
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `receipts:correct` | Corriger un numéro de reçu d'achat |  |  |  |  |  | `POST /purchase-declarations/:id/receipt-number` |
| `receipts:create` | Valider une réception et émettre le reçu | ✓ |  |  |  |  | `POST /receipts` |
| `receipts:override` | Autoriser un numéro de reçu en doublon (exception auditée) |  |  |  |  |  | `POST /purchase-declarations/:id/receipt-override` |
| `receipts:search` | Rechercher une opération par numéro de reçu |  |  |  |  |  | `GET /purchase-declarations/search/by-receipt` |

### reconciliation
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `reconciliation:manage` | Effectuer et consulter les rapprochements |  |  |  |  |  | `POST /reconciliations`<br>`GET /reconciliations` |

### replication
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `replication:manage` | Gérer la synchronisation avec le serveur central |  |  |  |  |  | — |

### reports
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `reports:read` | Consulter et exporter les rapports d'achats (période, section, collecteur, filière) |  |  |  | ✓ |  | `GET /reports/purchases`<br>`GET /reports/filters`<br>`GET /reports/purchases/xlsx`<br>… +6 |

### roles
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `roles:manage` | Gérer les rôles et permissions |  |  |  |  |  | `POST /roles/standard`<br>`POST /roles` |

### settings
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `settings:manage` | Gérer les paramètres |  |  |  |  |  | `POST /app/releases`<br>`POST /map-packs`<br>`GET /map-packs`<br>… +1 |
| `settings:receipts` | Configurer la numérotation des reçus d'achat |  |  |  |  |  | `PUT /purchase-declarations/settings/receipts` |
| `settings:weighing` | Configurer les seuils d'écart de pesée |  |  |  |  |  | `PUT /settings/weighing` |

### shipments
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `shipments:manage` | Planifier, charger et suivre les expéditions |  |  |  |  |  | `POST /shipments`<br>`POST /shipments/:id/load`<br>`POST /shipments/:id/assign`<br>… +5 |
| `shipments:validate` | Valider la livraison d'une expédition |  |  |  |  |  | `POST /shipments/:id/validate` |

### stock
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `stock:adjust` | Ajuster les stocks et déclarer des pertes |  |  |  |  |  | — |
| `stock:count` | Compter le stock (inventaire) | ✓ |  |  |  |  | `POST /stock-counts`<br>`GET /stock-counts`<br>`GET /stock-counts/:id`<br>… +3 |
| `stock:count_approve` | Approuver un inventaire et ses ajustements |  |  |  |  |  | `POST /stock-counts/:id/approve`<br>`POST /stock-counts/:id/reject` |
| `stock:move` | Enregistrer des mouvements de stock | ✓ |  |  |  |  | `POST /lots/merge`<br>`POST /lots/:id/split`<br>`POST /warehouse-movements`<br>… +1 |

### sync
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `sync:use` | Utiliser la synchronisation mobile | ✓ | ✓ | ✓ | ✓ | ✓ | `POST /sync/batch`<br>`GET /sync/changes` |

### tasks
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `tasks:assign` | Attribuer ou réattribuer une mission |  |  |  | ✓ |  | `POST /tasks/:id/assign` |
| `tasks:close` | Terminer, clôturer ou annuler une mission |  |  |  | ✓ |  | — |
| `tasks:create` | Créer des missions officielles |  |  |  | ✓ |  | `POST /tasks` |
| `tasks:decide_requests` | Accepter ou refuser les demandes de mission |  |  |  | ✓ |  | `POST /task-requests/:id/decide` |
| `tasks:execute` | Exécuter une mission attribuée (observations, GPS, photos, soumission) |  |  |  |  | ✓ | `POST /tasks/:id/entries` |
| `tasks:read` | Consulter les tâches qui me sont attribuées |  |  |  | ✓ | ✓ | `GET /tasks`<br>`GET /tasks/dashboard`<br>`GET /tasks/:id`<br>… +1 |
| `tasks:read_all` | Consulter toutes les tâches de la coopérative |  |  |  | ✓ |  | — |
| `tasks:request` | Demander la création d'une mission |  |  |  |  | ✓ | `POST /task-requests`<br>`GET /task-requests` |
| `tasks:review` | Vérifier une mission soumise (valider ou renvoyer à corriger) |  |  |  | ✓ |  | — |
| `tasks:update` | Modifier les instructions officielles d'une mission |  |  |  | ✓ |  | `POST /tasks/:id/update` |

### users
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `users:change_role` | Modifier le rôle d'un utilisateur |  |  |  |  |  | `POST /users/:id/role` |
| `users:create` | Créer des utilisateurs |  |  |  |  |  | `POST /users` |
| `users:manage` | Gérer les utilisateurs et rôles |  |  |  |  |  | — |
| `users:read` | Consulter les utilisateurs |  |  |  |  |  | `GET /users/:id/access-history`<br>`GET /users`<br>`GET /roles`<br>… +1 |
| `users:suspend` | Suspendre, réactiver un compte et révoquer ses sessions |  |  |  |  |  | `POST /users/:id/suspend`<br>`POST /users/:id/reactivate`<br>`POST /users/:id/revoke-sessions` |

### value_chains
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `value_chains:manage` | Gérer les filières et conversions |  |  |  |  |  | `POST /value-chains`<br>`POST /unit-conversions` |
| `value_chains:read` | Consulter les filières |  |  |  | ✓ |  | `GET /value-chains`<br>`GET /unit-conversions` |

### warehouses
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `warehouses:manage` | Gérer les magasins |  |  |  |  |  | `POST /warehouses` |
| `warehouses:read` | Consulter les magasins et les stocks | ✓ |  |  |  |  | `GET /reports/stock`<br>`GET /reports/stock/xlsx`<br>`GET /warehouses`<br>… +2 |

### weighings
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `weighings:approve` | Valider les écarts de pesée (utilisateur distinct de l'opérateur) |  |  |  |  |  | `GET /convoys/variance-queue`<br>`POST /convoy-receptions/:id/approve-variance`<br>`POST /weighings/:id/approve` |
| `weighings:create` | Enregistrer des pesées |  |  |  |  |  | `POST /weighings` |
| `weighings:read` | Consulter les pesées et reçus |  |  |  |  |  | `GET /settings/weighing`<br>`GET /weighings`<br>`GET /weighings/:id`<br>… +2 |

### workstations
| Permission | Rôle du droit | Magasinier | Caissier | Collecteur | Administrateur de groupe | Coach | Routes |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `workstations:manage` | Associer, révoquer les postes de travail et rendre l'association obligatoire |  |  |  |  |  | `POST /workstations/pairing-codes`<br>`GET /workstations`<br>`POST /workstations/:id/revoke`<br>… +1 |

