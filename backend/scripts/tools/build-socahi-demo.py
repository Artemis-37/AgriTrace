#!/usr/bin/env python3
"""Construit backend/scripts/data/socahi-demo.json à partir des fichiers de la coopérative (fournis séparément, JAMAIS versionnés) :
  python3 build-socahi-demo.py DB_SOCAHI_COMPLET.xlsx GMR.xlsx POLYGONES.kml [sortie.json]
Garde 70 producteurs ayant leurs parcelles : VRAIS tracés (simplifiés), surfaces, codes, sections et villages ;
les NOMS sont remplacés par des noms inventés (le dépôt est public) ; ni téléphone, ni pièce d'identité, ni année de naissance."""
import sys, json, collections, random
import xml.etree.ElementTree as ET
import openpyxl
from shapely.geometry import Polygon
from shapely.strtree import STRtree

db_f, gmr_f, kml_f = sys.argv[1:4]
out = sys.argv[4] if len(sys.argv) > 4 else 'backend/scripts/data/socahi-demo.json'
rnd = random.Random(2026)

db = {r[0].strip(): r for r in openpyxl.load_workbook(db_f, read_only=True, data_only=True).worksheets[0].iter_rows(min_row=2, values_only=True) if r[0]}
gmr = {}
for r in openpyxl.load_workbook(gmr_f, read_only=True, data_only=True)["1. l'exploitation agricole"].iter_rows(min_row=3, values_only=True):
    if r[0]: gmr[str(r[0]).strip()] = r
ns = {'k': 'http://www.opengis.net/kml/2.2'}
byp = collections.defaultdict(list)
for p in ET.parse(kml_f).getroot().findall('.//k:Placemark', ns):
    d = {x.get('name'): x.find('k:value', ns).text for x in p.findall('.//k:Data', ns)}
    pts = [tuple(float(v) for v in c.split(',')[:2]) for c in p.find('.//k:coordinates', ns).text.split()]
    if len(pts) < 4: continue
    poly = Polygon(pts)
    if not poly.is_valid: poly = poly.buffer(0)
    if poly.is_empty or poly.geom_type != 'Polygon': continue
    poly = poly.simplify(0.00002, preserve_topology=True)
    if poly.geom_type != 'Polygon' or not poly.is_valid or len(poly.exterior.coords) < 4: continue
    byp[d['Id Producteur']].append({'section': d.get('Section'), 'name': p.find('k:name', ns).text, 'area': float(d.get('Area') or 0), 'poly': poly})

cands = [c for c in byp if c in db or c in gmr]
# Tous les producteurs qui ont au moins un tracé ; ordre : sections en alternance (les premiers servent aux jeux d'essai), plusieurs parcelles d'abord.
def section_of(c):
    return (db[c][3].strip() if c in db else byp[c][0]['section'] or 'AUTRE').upper().replace('ZAROKO ', 'ZAROKO')
def village_of(c): return ((db[c][4] or '') if c in db else '').strip().title() or section_of(c).title()
groups = collections.defaultdict(list)
for c in sorted(cands, key=lambda x: (-len(byp[x]), x)): groups[section_of(c)].append(c)
order = []
while any(groups.values()):
    for sec in sorted(groups):
        if groups[sec]: order.append(groups[sec].pop(0))
FIRST_M = ['Kouadio', 'Yao', 'Konan', 'Koffi', 'Kouamé', 'Adama', 'Moussa', 'Ibrahim', 'Yves', 'Jean', 'Paul', 'Désiré', 'Hervé', 'Seydou', 'Lassina', 'Brice', 'Arsène', 'Rodrigue', 'Anselme', 'Sylvain', 'Gilbert', 'Théophile', 'Narcisse', 'Valentin', 'Bertrand', 'Clément', 'Eugène', 'Faustin', 'Germain', 'Honoré', 'Isidore', 'Léopold', 'Maurice', 'Noël', 'Olivier', 'Pascal', 'Raphaël', 'Serge', 'Timothée', 'Victor']
FIRST_F = ['Adjoua', 'Aya', 'Affoué', 'Aminata', 'Fatou', 'Marie', 'Salimata', 'Odette', 'Mariam', 'Colette', 'Joséphine', 'Awa', 'Bintou', 'Léa', 'Nanan', 'Amenan', 'Akissi', 'Habiba', 'Rokia', 'Sita', 'Clarisse', 'Estelle', 'Florence', 'Grâce', 'Henriette', 'Irène', 'Justine', 'Lucie', 'Micheline', 'Nathalie', 'Pauline', 'Rosalie', 'Solange', 'Thérèse', 'Valérie', 'Yvonne', 'Zita', 'Berthe', 'Cécile', 'Delphine']
LAST = ['KOUADIO', 'YAO', 'KONAN', 'TRAORE', 'COULIBALY', 'BAMBA', 'GNAGNE', 'OUATTARA', 'KOFFI', 'DOSSO', 'TOURE', 'AKA', 'BROU', 'DIABATE', "N'DRI", 'ZAHUI', 'LOUKOU', 'ASSI', 'SORO', 'KONE', 'DIALLO', 'SANGARE', 'ADJE', 'TAPE', 'GOUE', 'BEUGRE', 'DJEDJE', 'EHUI', 'ATTA', 'GBANE',
        'AMANI', 'ANOH', 'BAH', 'BLE', 'BOLOU', 'CISSE', 'DAGO', 'DIOMANDE', 'EDI', 'FOFANA', 'GADOU', 'GUEI', 'HIEN', 'KACOU', 'KAMAGATE', 'KEITA', 'KOUAKOU', 'KOUASSI', 'LATH', 'MEL', 'NANAN', 'OKA', 'SEKA', 'SILUE', 'TANOH', 'TIA', 'WAYOU', 'YAPI', 'ZADI', 'ZOKORA']
combos = [(l, f) for l in LAST for f in range(40)]
rnd.shuffle(combos)
used_names = 0
out_list = []
for i, c in enumerate(order):
    row = db.get(c); g = gmr.get(c)
    female = bool(g) and str(g[13] or '').lower().startswith('f')
    l, fi = combos[i % len(combos)]
    fn = (FIRST_F if female else FIRST_M)[fi]
    if i >= len(combos): fn += ' ' + (FIRST_M[(i * 3) % 40])
    parcels = []
    for x in byp[c]:
        area = x['area'] if x['area'] > 0 else round(x['poly'].area * 110574 * 110700 / 1e4, 2)
        ring = [[round(a, 6), round(b, 6)] for a, b in x['poly'].exterior.coords]
        parcels.append({'suffix': x['name'].rsplit('-', 1)[-1], 'area_ha': round(area, 2), 'ring': ring})
    out_list.append({'code': c, 'last_name': l, 'first_names': fn, 'gender': 'female' if female else 'male', 'section': section_of(c), 'village': village_of(c),
                     'area_ha': round(sum(p['area_ha'] for p in parcels), 2), 'parcels': parcels})
json.dump({'producers': out_list}, open(out, 'w'), ensure_ascii=False, separators=(',', ':'))
print(len(out_list), 'producteurs,', sum(len(p['parcels']) for p in out_list), 'parcelles', dict(collections.Counter(len(p['parcels']) for p in out_list)))
