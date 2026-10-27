# Film promotionnel AgriTrace : narration (Piper) -> durées -> timeline.js ; puis voix.wav (concaténée) à mixer avec la musique.
import json, os, subprocess, sys, wave
import numpy as np
HERE=os.path.dirname(os.path.abspath(__file__)); VOICE=os.environ.get('PIPER_VOICE','/tmp/video/voices/fr_FR-siwis-medium.onnx')
os.makedirs(HERE+'/audio',exist_ok=True)
PRON=[('AgriTrace','Agri Trace'),('Agri Trace','Agri Trace'),('Excel','Èxel'),('macOS','mak O S'),('Windows','Ouine-dôze'),('GPS','jé pé èsse'),('Android','Androïde')]
S=[]
def sc(id,kind,narr,**kw): S.append(dict(id=id,kind=kind,narration=' '.join(narr.split()),**kw))
G=lambda p:{'goto':p}
TAB=lambda t:{'tab':t}
CK=lambda sel:{'click':sel}
TY=lambda sel,t:{'type':[sel,t]}
SEL=lambda sel,l:{'select':[sel,l]}
IDX=lambda sel,i:{'idx':[sel,i]}
SC=lambda n:{'scroll':n}
HV=lambda sel:{'hover':sel}
W=lambda w=1:{'wait':True,'w':w}
def live(role,steps): return dict(role=role,steps=steps)

sc('hook','hook',"Votre coopérative perd peut-être de l'argent, chaque jour. Pas dans de grands accidents, mais dans de petits oublis, que personne ne voit.")
sc('pain','pain',"Des sacs achetés au village, jamais retrouvés au magasin. Un poids annoncé, un poids reçu, et personne ne compare. Des avances aux délégués, notées dans un cahier, puis oubliées. Et quand un acheteur demande d'où vient le lot, pas de réponse.")
sc('logo','logo',"Voici Agri Trace : la plateforme intégrée de gestion agricole, de traçabilité et de gestion financière des coopératives. De la parcelle au marché.")
sc('achat','phones',"Tout commence au village. Sur son téléphone, le délégué choisit le producteur, puis saisit le poids, le nombre de sacs et le numéro du reçu remis au producteur. L'achat est enregistré sur l'appareil, même sans réseau, et part dès que la connexion revient, sans doublon.",
   tag='TERRAIN',title='L’achat saisi au village, même sans réseau',text='Producteur, poids, sacs, reçu : tout est enregistré sur le téléphone, puis envoyé.',seq=['achat'])
sc('connaissement','phones',"Quand le camion est prêt, le délégué déclare son connaissement : le numéro, le chauffeur, le camion, le nombre de sacs et le poids annoncé. Le magasin n'a plus qu'à peser à l'arrivée.",
   tag='TERRAIN',title='Le connaissement déclaré depuis le téléphone',text='Numéro, chauffeur, camion, sacs et poids annoncé.',seq=['convoi'])
sc('coach','phones',"Le coach suit les producteurs de ses sections. Sur la fiche d'un producteur, il retrouve les tâches et les formations, puis les informations. Il enregistre aussi des relevés, comme une distribution de primes : il choisit la catégorie, le groupe, l'article, puis les bénéficiaires.",
   tag='COACH',title='Le coach suit ses producteurs',text='Fiche du producteur, tâches, formations, et relevés de distribution.',seq=['producteur','distribution'])
sc('parcelles','live',"Chaque parcelle est déclarée, mesurée, puis contrôlée. On filtre par niveau de vérification, et on lance le contrôle d'un clic.",
   tag='PARCELLES',title='Chaque parcelle déclarée, mesurée, contrôlée',text='Superficie déclarée et mesurée, GPS, niveau de vérification.',
   live=live('coop_admin',[G('/parcelles'),W(2),SEL('select[aria-label="Filtrer par niveau"]','Contrôlée'),W(2),SEL('select[aria-label="Filtrer par niveau"]','Déclarée'),W(2),CK('button:has-text("Contrôler") >> nth=0'),W(3)]))
sc('anomalies','live',"Le module de cartographie signale les anomalies : un chevauchement, une parcelle qui touche une forêt classée. Le responsable les corrige, ou les justifie par une exception, avec un motif obligatoire. Tout reste tracé.",
   tag='CARTOGRAPHIE',title='Les anomalies repérées avant qu’elles coûtent',text='Chevauchements et zones protégées, corrigés ou justifiés par une exception.',
   live=live('responsable_cartographie',[G('/cartographie'),TAB('Anomalies'),W(2),SEL('select[aria-label="Statut"]','Exception'),W(2),SEL('select[aria-label="Statut"]','Tous'),W(1.5),HV('tbody tr >> nth=0'),W(1.5),CK('button:has-text("Lancer le contrôle périodique")'),W(4)]))
sc('taches','live',"Au bureau, l'Administrateur de groupe organise le travail des coachs. Il choisit la nature de l'élément : formation, distribution ou tâche. Il choisit les producteurs concernés, ajoute une consigne et une échéance, et l'élément apparaît dans leur profil.",
   tag='ORGANISATION',title='Le travail des coachs, organisé depuis le bureau',text='Formations, distributions et tâches ajoutées aux profils, avec consigne et échéance.',
   live=live('adg',[G('/modules-exportateurs'),W(2),CK('tr:has-text("Séchage et stockage des fèves") button:has-text("Transmettre aux coachs")'),W(2),SEL('select[aria-label="Nature"]','Module de formation'),W(1.5),SEL('select[aria-label="Cible"]','Certains producteurs'),W(1.5),CK('.modal input[type=checkbox] >> nth=0'),CK('.modal input[type=checkbox] >> nth=1'),TY('.modal textarea','À dispenser avant la récolte principale.'),W(2),CK('.modal .modal-foot button:has-text("Transmettre aux coachs")'),W(3)]))
sc('declarations','live',"Le responsable de traçabilité reçoit les déclarations d'achat, avec la fiche du producteur sous les yeux. Il met une déclaration en vérification, puis l'accepte, ou demande une correction avec un motif. Le délégué voit aussitôt le résultat sur son téléphone.",
   tag='ACHATS',title='Chaque achat reste lié à son producteur',text='Vérification, acceptation ou correction motivée, visible tout de suite sur le téléphone.',
   live=live('responsable_tracabilite',[G('/declarations'),W(2),SEL('select[aria-label="Filtrer par statut"]','Reçue'),W(2),CK('button:has-text("Mettre en vérification") >> nth=0'),W(1.5),CK('.modal button:has-text("Confirmer")'),W(2),SEL('select[aria-label="Filtrer par statut"]','En vérification'),W(3)]))
sc('pesee','live',"À l'arrivée du camion, le magasinier pèse en brut, déduit la tare, et obtient le poids net. L'écart avec le poids annoncé est calculé. Au-delà de la tolérance, il doit être approuvé.",
   tag='MAGASIN',title='La pesée calcule le poids net toute seule',text='Poids brut, tare, écart avec le poids annoncé : tout est consigné sur le bulletin.',
   live=live('magasinier',[G('/pesees'),W(2),CK('button:has-text("Enregistrer une pesée")'),W(1.5),CK('button:has-text("Peser ce convoi") >> nth=1'),W(2),TY('label.field:has(> span:text-is("Poids (kg)")) input','2095'),TY('label.field:has(> span:text-is("Nombre de sacs reçus")) input','40'),TY('label.field:has(> span:text-is("Sacs déchargés")) input','1'),W(2),SC(300),W(2)]))
sc('convois','live',"Chaque convoi est suivi de bout en bout : chauffeur, camion, sacs, poids reçu. Le camion arrive, le magasin pèse, la caisse règle.",
   tag='CONVOIS',title='Les convois des délégués, de bout en bout',text='Chauffeur, camion, sacs et poids reçu, jusqu’au règlement.',
   live=live('magasinier',[G('/convois'),W(2),HV('tbody tr >> nth=1'),W(1),HV('tbody tr >> nth=3'),W(1),SC(250),W(2),HV('tbody tr >> nth=6'),W(2),SC(-250),W(1)]))
sc('caisse','live',"À la caisse, le fonds disponible s'affiche en haut de l'écran : les espèces, chaque compte bancaire, et le mobile money. Le caissier paie un délégué en espèces, ou par chèque : il choisit alors la banque et saisit le numéro du chèque.",
   tag='CAISSE',title='Le fonds disponible, et le paiement par chèque',text='Espèces, banque, mobile money. Paiement d’un délégué en espèces ou par chèque.',
   live=live('caissier',[G('/caisse'),W(3),CK('button:has-text("Payer un délégué")'),W(1.5),IDX('.modal select >> nth=0',2),W(1.5),IDX('.modal select >> nth=1',1),W(2),IDX('.modal select >> nth=2',1),W(1.5),TY('.modal input >> nth=0','CHQ-004512'),TY('.modal input >> nth=1','250000'),W(3)]))
sc('compte','live',"Le compte de chaque délégué remplace le cahier : ce que la coopérative fournit, ce que le délégué apporte, et le solde. Le caissier clôture le compte quand tout est réglé.",
   tag='COMPTE DÉLÉGUÉ',title='Le compte de chaque délégué, toujours à jour',text='Avances, livraisons, solde. Règlement en espèces ou par chèque.',
   live=live('caissier',[G('/mise-en-compte'),W(2),HV('tbody tr >> nth=1'),W(1.5),HV('tbody tr >> nth=2'),W(1.5),TAB('Demandes de reversement'),W(2),TAB('Délégués'),W(2)]))
sc('finances','live',"Côté finances, chaque opération est tracée et justifiée : comptes et caisses, paiements, prêts, comptabilité, rapprochement bancaire. Une erreur se corrige par une écriture inverse, jamais en effaçant.",
   tag='FINANCES',title='Comptes, paiements et rapprochement bancaire',text='Chaque opération est justifiée. Une erreur se corrige par une écriture inverse.',
   live=live('coop_admin',[G('/finances'),W(2),TAB('Paiements'),W(2),TAB('Prêts et préfinancements'),W(2),TAB('Comptabilité'),W(2),SC(300),W(2),TAB('Rapprochement bancaire'),W(2.5)]))
sc('stocks','live',"Le stock est calculé depuis les mouvements, par magasin et par lot. Chaque lot garde sa traçabilité, de la pesée jusqu'à la vente.",
   tag='STOCKS',title='Le stock, par magasin et par lot',text='Quantités calculées depuis les mouvements. Traçabilité du lot, jusqu’à la vente.',
   live=live('coop_admin',[G('/stocks'),W(2),IDX('select >> nth=0',2),W(2),SC(300),W(1.5),CK('button:has-text("Traçabilité") >> nth=0'),W(4)]))
sc('commerce','live',"Le lot est ensuite vendu. On crée la commande : l'acheteur, la filière, le produit, la quantité et le prix. L'acheteur partenaire ne voit que ses propres commandes, expéditions et documents.",
   tag='VENTES',title='Commandes, expéditions, factures',text='L’acheteur ne voit que ses propres commandes et documents.',
   live=live('coop_admin',[G('/commerce'),W(2),CK('button:has-text("Nouvelle commande")'),W(1.5),IDX('.modal select >> nth=0',1),W(1.2),IDX('.modal select >> nth=1',2),W(1.2),IDX('.modal select >> nth=2',1),W(1.2),TY('.modal input >> nth=0','Cacao fèves, lot export'),TY('.modal input >> nth=1','3000'),TY('.modal input >> nth=2','1200'),W(2),CK('.modal button:has-text("Annuler")'),W(1)]))
sc('fiches','live',"Avant le départ du camion, la coopérative prépare la fiche d'accompagnement : les producteurs de chaque connaissement pesé, avec leur poids net. Elle l'exporte en Excel, puis la transmet à l'exportateur.",
   tag='EXPORTATEUR',title='La fiche d’accompagnement part chez l’exportateur',text='Producteurs, sections et poids net de chaque connaissement pesé.',
   live=live('responsable_tracabilite',[G('/fiches-accompagnement'),W(2),HV('tbody tr >> nth=1'),W(1.5),CK('button:has-text("Exporter (Excel)") >> nth=0'),W(2.5),TAB("Fiches d'accompagnement"),W(3)]))
sc('livraisons','live',"Chez l'exportateur, le pont bascule pèse l'entrée et la sortie du camion. L'analyste saisit les résultats, et le bulletin de pesée est produit, avec le poids net, l'écart et le règlement.",
   tag='EXPORTATEUR',title='Pont bascule, analyse et bulletin de pesée',text='Entrée, sortie, poids net, écart, décision et règlement.',
   live=live('pont_bascule',[G('/livraisons'),W(2),SC(250),W(2),CK('button:has-text("Pièces") >> nth=0'),W(3),CK('.modal button:has-text("Fermer")'),W(1),TAB('Mes livraisons envoyées'),W(2)]))
sc('liens','live',"L'exportateur voit, pour chaque coopérative qui lui livre, les livraisons, les poids acceptés ou rejetés, ce qui reste à régler, et ce qui est payé. Les liens entre organisations se proposent avec un code.",
   tag='EXPORTATEUR',title='Les coopératives qui lui livrent',text='Livraisons, poids acceptés ou rejetés, à régler, déjà payé.',
   live=live('exp_admin',[G('/organisations-liees'),W(3),TAB('Liens'),W(2),CK('button:has-text("Proposer un lien")'),W(3),CK('.modal button:has-text("Annuler")'),W(1)]))
sc('audits','live',"Il peut aussi auditer la coopérative. Il programme l'audit, puis chaque partie désigne ses participants. Les données sont partagées en copies figées, seuls les participants les voient, et chaque lecture est inscrite dans un journal.",
   tag='AUDITS',title='Des audits, avec des données partagées en copies figées',text='Constats, plan d’action, journal de chaque lecture.',
   live=live('exp_admin',[G('/audits'),W(2),CK('button:has-text("Programmer un audit")'),W(1.5),TY('.modal input >> nth=0','Audit des pesées et de la caisse'),W(1.5),IDX('.modal select >> nth=0',1),W(1),CK('.modal input[type=checkbox] >> nth=0'),CK('.modal input[type=checkbox] >> nth=1'),W(2),W(2)]))
sc('boucle','live',"Et la boucle se referme avec les formations. L'exportateur propose un module : titre, thème, objectifs, sections. L'Administrateur de groupe le transmet aux coachs, les coachs le dispensent au village, et les résultats remontent jusqu'à l'exportateur.",
   tag='FORMATIONS',title='Des formations qui redescendent au village',text='Proposition, transmission aux coachs, séance au village, résultats renvoyés.',
   live=live('exportateur',[G('/modules-exportateurs'),W(2),CK('text=Proposer un module'),W(1.5),TY('.modal input[maxlength="200"]','Conservation des fèves en magasin'),TY('.modal textarea >> nth=0','Module proposé par l\'exportateur de démonstration (fictif).'),TY('.modal textarea >> nth=1','Stocker les sacs sur palettes\nContrôler l\'humidité'),W(1.5),TY('input[aria-label="Titre de la section 1"]','Le stockage'),TY('textarea[aria-label="Points de la section 1"]','Sacs sur palettes, loin des murs\nAérer le magasin'),W(2),CK('.modal button:has-text("Envoyer"), .modal button:has-text("Enregistrer")'),W(3)]))
sc('qualite','live',"La qualité et la conformité suivent les certificats, les inspections et les actions correctives, pour préparer les audits de certification.",
   tag='QUALITÉ',title='Certificats et inspections, sous contrôle',text='Échéances de certificats, inspections en retard, actions correctives.',
   live=live('coop_admin',[G('/qualite'),W(2),TAB('Certificats'),W(2.5),TAB('Règles qualité'),W(2.5),SC(250),W(2)]))
sc('rapports','live',"Enfin, des rapports prêts pour la direction : achats, sacs, poids net et montants, par section, par village, par délégué ou par filière, exportables vers Excel.",
   tag='RAPPORTS',title='Des chiffres prêts pour la direction',text='Par section, délégué ou filière, exportables vers Excel.',
   live=live('coop_admin',[G('/rapports'),W(2),IDX('select >> nth=0',1),W(2),IDX('select >> nth=1',1),W(2),IDX('select >> nth=0',2),W(2),TAB('Finance'),W(2),TAB('Achats'),W(1.5),CK('button:has-text("Exporter vers Excel")'),W(2)]))
sc('nouveautes','bul',"Les dernières évolutions : une synchronisation manuelle du téléphone, qui affiche chaque étape. Des poids et des sacs en nombres entiers. Le paiement par chèque. Une croix de visée sur les cartes, avec la latitude et la longitude. Et toutes les parcelles dans le profil du producteur.",
   tag='NOUVEAUTÉS',title='Les dernières évolutions',items=['Synchronisation manuelle, étape par étape','Poids et sacs en nombres entiers','Paiement d’un délégué par chèque','Cartes : croix de visée, latitude et longitude','Toutes les parcelles dans le profil du producteur'])
sc('securite','bul',"Les données sont protégées : base chiffrée sur le téléphone, photos chiffrées, accès selon le rôle de chacun, et un journal de toutes les actions. Rien n'est jamais supprimé : tout s'annule par écriture inverse.",
   tag='SÉCURITÉ',title='Des données protégées, des actions tracées',items=['Base et photos chiffrées sur le téléphone','Accès selon le rôle de chaque utilisateur','Journal de toutes les actions','Rien n’est supprimé : tout s’annule par écriture inverse'])
sc('partout','net',"Un seul outil, sur tous vos postes. Le téléphone travaille sans réseau et se synchronise ensuite. Le portail s'ouvre dans un navigateur, et l'application existe aussi pour Windows et macOS.")
sc('fin','end',"Agri Trace : gardez le contrôle de chaque sac, et de chaque franc. Pour toute question, contactez le créateur, Dominique N'Guessan : téléphone, zéro cinq, zéro cinq, zéro cinq, quarante-cinq, soixante-trois ; adresse électronique, dominique n guessan quatre cent quatorze, arobase gmail point com.")

LEAD=0.7; TAIL=1.1; sr=22050
T=0; voice=[]; out=[]
for s in S:
    wav=f"{HERE}/audio/{s['id']}.wav"
    if not os.path.exists(wav):
        txt=s['narration']
        for a,b in PRON: txt=txt.replace(a,b)
        subprocess.run([sys.executable,'-m','piper','-m',VOICE,'-f',wav,'--length-scale','1.04','--sentence-silence','0.3'],input=txt.encode(),check=True,stderr=subprocess.DEVNULL)
    w=wave.open(wav); n=w.getnframes(); rate=w.getframerate(); data=np.frombuffer(w.readframes(n),dtype='<i2'); w.close()
    d=n/rate; dur=max(7.0 if s['kind']!='live' else 9.0,LEAD+d+TAIL)
    voice.append((T+LEAD,data,rate)); out.append(dict(s,start=round(T,3),end=round(T+dur,3),dur=round(dur,3),voice=round(d,2))); T+=dur
rate=voice[0][2]; buf=np.zeros(int((T+1)*rate),dtype=np.float32)
for st,data,_ in voice: i=int(st*rate); buf[i:i+len(data)]+=data/32768
w=wave.open(HERE+'/voix.wav','wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes((np.clip(buf,-1,1)*32767).astype('<i2').tobytes()); w.close()
json.dump(out,open(HERE+'/timeline.json','w'),ensure_ascii=False,indent=1)
open(HERE+'/timeline.js','w').write('window.SCENES='+json.dumps(out,ensure_ascii=False)+';window.TOTAL='+str(round(T,2))+';')
print(len(out),'scènes,',round(T,1),'s =',round(T/60,1),'min ;',sum(len(s['narration'].split()) for s in S),'mots')
