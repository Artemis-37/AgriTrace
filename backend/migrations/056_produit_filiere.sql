-- Un produit peut être rattaché à une filière : le prix d'achat officiel (fixé par l'administrateur) sert alors aussi de prix des déclarations d'achat.
ALTER TABLE products ADD COLUMN value_chain_id uuid REFERENCES value_chains(id);
