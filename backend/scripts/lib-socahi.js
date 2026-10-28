// Producteurs et parcelles de la démonstration : VRAIS tracés, surfaces, codes SOCAHI, sections et villages (data/socahi-demo.json,
// produit par tools/build-socahi-demo.py) ; les noms et prénoms sont INVENTÉS (le dépôt est public) ; ni téléphone ni pièce d'identité.
const REAL = require('./data/socahi-demo.json').producers;

const SECTIONS = { HIRE: 'Hiré', TAABO: 'Taabo', ADJEYAOKRO: 'Adjéyaokro', KREZOUKOUE: 'Krézoukoué', DOUAVILLE: 'Douaville', KAGBE: 'Kagbé', LELEBLE: 'Léléblé', DAAKO: 'Daako', ZAROKO: 'Zaroko' };
const geometry = (parcel) => ({ type: 'Polygon', coordinates: [parcel.ring] });
/** Corps de POST /producers pour le producteur réel n° i (sans téléphone). */
const producerBody = (p, extra = {}) => ({
  internal_code: p.code, last_name: p.last_name, first_names: p.first_names, gender: p.gender, region: 'Gôh', department: 'Divo',
  section: SECTIONS[p.section] ?? p.section, village: p.village, area_ha: String(p.area_ha), consent: true, ...extra,
});
/** Corps de POST /parcels pour une parcelle réelle (idempotency_key et producer_id à ajouter par l'appelant). */
const parcelBody = (parcel, vcId) => ({ value_chain_id: vcId, declared_area_ha: String(parcel.area_ha), geometry: geometry(parcel), confirm_not_duplicate: true });
const byCode = new Map(REAL.map((p) => [p.code, p]));
module.exports = { REAL, producerBody, parcelBody, geometry, byCode };
