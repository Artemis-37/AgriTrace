-- Catalogue standard « Distribution et services » : catégorie → groupe → article (Finance, Intrants et Outils, Services et Dépistages).
-- Fonction appelée à la création d'une coopérative ; l'administrateur peut ensuite ajouter, renommer ou retirer des articles.
BEGIN;
CREATE OR REPLACE FUNCTION ensure_distribution_catalog(org uuid) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO distribution_articles(organization_id, category, group_name, name)
  SELECT org, v.c, v.g, v.a FROM (VALUES
  ('Finance','Bourses','Bourse Accès à l''école'),
  ('Finance','Crédit','Crédit'),
  ('Finance','Crédit','Crédit générique'),
  ('Finance','Primes','Prime Rainforest Alliance'),
  ('Finance','Primes','Prime de qualité'),
  ('Finance','Primes','Prime en espèces'),
  ('Finance','Primes','Prime générique'),
  ('Finance','Prêts','Assurance générique'),
  ('Finance','Prêts','Prêt éducatif'),
  ('Finance','Prêts','Remboursement de prêt'),
  ('Finance','Subventions','Couverture des coûts d''audit'),
  ('Intrants et Outils','AVEC','Contribution principale Boîte de sécurité VSLA'),
  ('Intrants et Outils','AVEC','Fonds social Boîte de sécurité AVEC'),
  ('Intrants et Outils','AVEC','Lapui des AVEC'),
  ('Intrants et Outils','AVEC','Prêts Boîte de sécurité AVEC'),
  ('Intrants et Outils','Arbres cultivés','Plants de cacao'),
  ('Intrants et Outils','Arbres d''ombrage','Plants d''arbres d''ombrage'),
  ('Intrants et Outils','Engrais','Engrais'),
  ('Intrants et Outils','Engrais','Compost'),
  ('Intrants et Outils','Fournitures','Fournitures agricoles'),
  ('Intrants et Outils','Graines de culture','Graines de culture'),
  ('Intrants et Outils','Santé et protection','Gants'),
  ('Intrants et Outils','Santé et protection','Bottes'),
  ('Intrants et Outils','Santé et protection','Masque'),
  ('Intrants et Outils','Santé et protection','Lunettes'),
  ('Intrants et Outils','Machines agricoles','Machine agricole'),
  ('Intrants et Outils','Matériels de post récolte','Sacs de jute'),
  ('Intrants et Outils','Matériels de post récolte','Bâche de séchage'),
  ('Intrants et Outils','Outils agricoles','Machette'),
  ('Intrants et Outils','Outils agricoles','Sécateur'),
  ('Intrants et Outils','Outils agricoles','Pulvérisateur'),
  ('Intrants et Outils','Paillis','Paillis'),
  ('Intrants et Outils','Pesticides','Pesticide'),
  ('Intrants et Outils','Pesticides Fongicides','Fongicide'),
  ('Intrants et Outils','Pesticides insecticides','Insecticide'),
  ('Intrants et Outils','Semences non cultivées','Semences non cultivées'),
  ('Intrants et Outils','Transport','Transport'),
  ('Intrants et Outils','Vêtements','Tenue de travail'),
  ('Intrants et Outils','Équipement de terrain','Bâche'),
  ('Intrants et Outils','Équipement de terrain','Filet d''ombrage'),
  ('Services et Dépistages','Dépistage et traitement','Assurance maladie'),
  ('Services et Dépistages','Dépistage et traitement','Ateliers médicaux pour enfants'),
  ('Services et Dépistages','Dépistage et traitement','Dépistage de la tuberculose'),
  ('Services et Dépistages','Dépistage et traitement','Dépistage de santé général'),
  ('Services et Dépistages','Dépistage et traitement','Dépistage du cancer du sein'),
  ('Services et Dépistages','Dépistage et traitement','Dépistage oculaire'),
  ('Services et Dépistages','Dépistage et traitement','Traitement de santé général'),
  ('Services et Dépistages','Dépistage et traitement','Traitement des maladies'),
  ('Services et Dépistages','Dépistage et traitement','Vaccinations'),
  ('Services et Dépistages','Dépistage et traitement','Visites médicales à domicile'),
  ('Services et Dépistages','Services','Apiculture soutien et approvisionnement'),
  ('Services et Dépistages','Services','Assistance technique personnalisée'),
  ('Services et Dépistages','Services','Camp médical'),
  ('Services et Dépistages','Services','Création de pépinières ou semis'),
  ('Services et Dépistages','Services','Création et entretien de parcelles de démonstration'),
  ('Services et Dépistages','Services','Préparation à l''audit'),
  ('Services et Dépistages','Services','Soutien au compte bancaire'),
  ('Services et Dépistages','Services','Soutien au désherbage'),
  ('Services et Dépistages','Services','Soutien à la cartographie des propriétés'),
  ('Services et Dépistages','Services','Soutien à la certification'),
  ('Services et Dépistages','Services','Soutien à la fertilisation'),
  ('Services et Dépistages','Services','Soutien à la plantation'),
  ('Services et Dépistages','Services','Soutien à la récolte'),
  ('Services et Dépistages','Services','Soutien à la taille'),
  ('Services et Dépistages','Services','Soutien à l''analyse de l''eau'),
  ('Services et Dépistages','Services','Soutien à l''analyse du sol'),
  ('Services et Dépistages','Services','Soutien à l''analyse foliaire'),
  ('Services et Dépistages','Services','Soutien à l''entreposage'),
  ('Services et Dépistages','Services','Soutien à l''obtention d''acte de naissance'),
  ('Services et Dépistages','Services','École paysanne'),
  ('Services et Dépistages','Services','Élevage soutien et approvisionnement'),
  ('Services et Dépistages','Services vétérinaires','Traitement de déparasitage')
  ) AS v(c, g, a)
  ON CONFLICT (organization_id, category, group_name, name) DO NOTHING
$f$;
DO $$ DECLARE o record; BEGIN
  FOR o IN SELECT id FROM organizations LOOP
    PERFORM set_config('app.current_org', o.id::text, true);
    PERFORM ensure_distribution_catalog(o.id);
  END LOOP;
END $$;
COMMIT;
