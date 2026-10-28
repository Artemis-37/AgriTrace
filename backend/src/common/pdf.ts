import PDFDocument = require('pdfkit');

function render(build: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    build(doc);
    doc.end();
  });
}

const GREEN = '#0B5E3B';
const fmtDate = (d: any) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—');

function header(doc: PDFKit.PDFDocument, title: string, subtitle: string) {
  doc.fillColor(GREEN).fontSize(20).text('AgriTrace', { continued: true }).fontSize(10).fillColor('#444')
    .text('   La traçabilité agricole, de la parcelle au marché.');
  doc.moveDown(0.5).fillColor('#000').fontSize(16).text(title);
  doc.fontSize(10).fillColor('#444').text(subtitle).moveDown();
  doc.strokeColor(GREEN).lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke().moveDown();
  doc.fillColor('#000');
}

const row = (doc: PDFKit.PDFDocument, k: string, v: any) =>
  doc.fontSize(10).font('Helvetica-Bold').text(`${k} : `, { continued: true }).font('Helvetica').text(String(v ?? '—'));

export function receiptPdf(r: any): Promise<Buffer> {
  return render((doc) => {
    header(doc, `Reçu de pesée n° ${r.number}`, `Coopérative : ${r.organization_name}`);
    row(doc, 'Reçu d\'achat n°', r.purchase_receipt_no ?? 'non renseigné');
    row(doc, 'Date', fmtDate(r.weighed_at));
    row(doc, 'Producteur', `${r.producer_name} (${r.producer_code})`);
    row(doc, 'Délégué', r.collector_name);
    row(doc, 'Magasin', r.warehouse_name);
    row(doc, 'Opérateur de pesée', r.operator_name);
    row(doc, 'Lot', r.lot_code);
    doc.moveDown();
    row(doc, 'Poids brut', `${r.gross_kg} kg`);
    row(doc, 'Tare', `${r.tare_kg} kg`);
    row(doc, 'Poids net réceptionné', `${r.net_kg} kg`);
    row(doc, 'Poids déclaré', `${r.declared_kg} kg`);
    row(doc, 'Écart', `${r.variance_kg} kg (${r.variance_pct ?? '—'} %)`);
    if (r.bags != null) row(doc, 'Nombre de sacs', r.bags);
    row(doc, 'Statut de la déclaration', r.declaration_status);
    row(doc, 'Statut du reçu', r.status);
    doc.moveDown(2).fontSize(8).fillColor('#666').text(`Document généré le ${fmtDate(new Date())}`);
  });
}

export function traceabilityPdf(t: any): Promise<Buffer> {
  return render((doc) => {
    header(doc, `Rapport de traçabilité — lot ${t.lot.code}`, `Généré le ${fmtDate(t.generated_at)}`);
    row(doc, 'Filière', t.lot.value_chain_code);
    row(doc, 'Campagne', t.lot.campaign_code);
    row(doc, 'Type de lot', t.lot.kind);
    doc.moveDown().font('Helvetica-Bold').fontSize(12).text('Stock actuel');
    for (const s of t.stock) row(doc, s.warehouse_name, `${s.balance_kg} kg`);
    if (!t.stock.length) doc.font('Helvetica').fontSize(10).text('Aucun stock enregistré');

    doc.moveDown().font('Helvetica-Bold').fontSize(12).text('Origines (producteurs)');
    for (const o of t.origins) {
      doc.font('Helvetica').fontSize(9).text(
        `${o.producer_code} ${o.producer_name} — ${o.village ?? 'village ?'}, section ${o.section ?? '?'} — ` +
        `${o.net_kg} kg (déclaré ${o.declared_kg} kg) — reçu de pesée ${o.receipt_number}${o.purchase_receipt_no ? ` (reçu d'achat ${o.purchase_receipt_no})` : ''} — délégué ${o.collector_name}`);
    }
    if (!t.origins.length) doc.font('Helvetica').fontSize(10).text('Aucune origine trouvée');

    doc.moveDown().font('Helvetica-Bold').fontSize(12).text('Parcelles des producteurs (filière du lot)');
    for (const x of t.parcels) doc.font('Helvetica').fontSize(9).text(`${x.producer_code} ${x.code} — ${x.declared_area_ha} ha déclarés — GPS ${x.latitude ?? 'manquant'}${x.longitude != null ? ', ' + x.longitude : ''} — ${x.verification_status}`);
    if (!t.parcels.length) doc.font('Helvetica').fontSize(10).text('Aucune parcelle enregistrée');

    doc.moveDown().font('Helvetica-Bold').fontSize(12).text('Contrôles qualité du lot');
    for (const q of t.quality) doc.font('Helvetica').fontSize(9).text(`${fmtDate(q.completed_at)}  ${q.kind}  ${q.outcome}  — ${q.summary ?? ''}`);
    if (!t.quality.length) doc.font('Helvetica').fontSize(10).text('Aucun contrôle enregistré');

    if (t.ancestors.length) {
      doc.moveDown().font('Helvetica-Bold').fontSize(12).text('Lots d\'origine (divisions et fusions)');
      for (const a of t.ancestors) doc.font('Helvetica').fontSize(9).text(`${a.parent_code} -> ${a.child_code} (${a.relation}, ${a.quantity_kg} kg)`);
    }

    doc.moveDown().font('Helvetica-Bold').fontSize(12).text('Événements');
    for (const e of t.events.slice(0, 200))
      doc.font('Helvetica').fontSize(9).text(`${fmtDate(e.created_at)}  ${e.lot_code}  ${e.event_type}${e.quantity_kg ? '  ' + e.quantity_kg + ' kg' : ''}`);

    doc.moveDown().font('Helvetica-Bold').fontSize(12).text('Anomalies');
    for (const a of t.anomalies) doc.font('Helvetica').fontSize(9).text(`- ${a}`);
    if (!t.anomalies.length) doc.font('Helvetica').fontSize(10).text('Aucune anomalie détectée');

    doc.moveDown().font('Helvetica-Bold').fontSize(12).text('Informations manquantes');
    for (const m of t.missing) doc.font('Helvetica').fontSize(9).text(`- ${m}`);
  });
}

/** Fiche d'inspection interne remplie (un producteur) : logos de la certification et de la coopérative, informations, exigences, score et signatures. */
export function inspectionPdf(f: {
  certification: string | null; certLogo: Buffer | null; orgLogo: Buffer | null; orgName: string; title: string;
  producer: string; code: string; village?: string | null; answeredAt: any; answeredBy?: string | null;
  items: { label: string; answer: string }[];
  sketch?: { parcels: { code: string; ha: number | null; ring: number[][] }[] } | null;
}): Promise<Buffer> {
  return render((doc) => {
    const top = doc.y;
    try { if (f.certLogo) doc.image(f.certLogo, 50, top, { fit: [150, 60] }); } catch { /* logo illisible : ignoré */ }
    try { if (f.orgLogo) doc.image(f.orgLogo, 395, top, { fit: [150, 60], align: 'right' }); } catch { /* idem */ }
    doc.y = top + 70;
    doc.fillColor('#000').fontSize(16).font('Helvetica-Bold').text(`FICHE D'INSPECTION INTERNE${f.certification ? ' — ' + f.certification.toUpperCase() : ''}`, 50, doc.y, { align: 'center', width: 495 });
    doc.font('Helvetica').fontSize(10).fillColor('#444').text(f.title, { align: 'center', width: 495 }).text(f.orgName, { align: 'center', width: 495 }).moveDown();
    doc.strokeColor(GREEN).lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke().moveDown(0.6);
    doc.fillColor('#000');
    row(doc, 'Producteur', `${f.producer} (${f.code})`);
    if (f.village) row(doc, 'Village', f.village);
    row(doc, 'Date de l\'inspection', f.answeredAt ? new Date(f.answeredAt).toISOString().slice(0, 10) : '—');
    row(doc, 'Inspecteur interne', f.answeredBy ?? '—');
    const c = f.items.filter((i) => i.answer === 'Conforme').length, nc = f.items.filter((i) => i.answer === 'Non conforme').length, na = f.items.filter((i) => i.answer === 'Non applicable').length;
    if (c + nc + na) {
      doc.moveDown(0.5);
      row(doc, 'Exigences', `${c} conforme(s), ${nc} non conforme(s), ${na} non applicable(s)`);
      row(doc, 'Score obtenu', c + nc ? `${Math.round((c / (c + nc)) * 1000) / 10} %` : '—');
    }
    doc.moveDown();
    for (const it of f.items) {
      if (doc.y > 740) doc.addPage();
      const colour = it.answer === 'Non conforme' ? '#B00020' : it.answer === 'Conforme' ? GREEN : '#333';
      doc.font('Helvetica').fontSize(9).fillColor('#000').text(it.label, 50, doc.y, { width: 360, continued: false });
      const y = doc.y;
      doc.font('Helvetica-Bold').fillColor(colour).text(it.answer, 50, y, { width: 495 });
      doc.moveDown(0.4);
    }
    if (f.sketch && f.sketch.parcels.length) drawSketch(doc, f.sketch.parcels);
    if (doc.y > 680) doc.addPage();
    doc.moveDown(2).fillColor('#000').font('Helvetica').fontSize(10);
    const y = doc.y;
    doc.text('Signature ou empreinte du membre', 50, y, { width: 220 }).text('Signature de l\'inspecteur interne', 325, y, { width: 220 });
    doc.rect(50, y + 15, 220, 60).stroke('#999').rect(325, y + 15, 220, 60).stroke('#999');
    doc.y = y + 90;
    doc.fontSize(8).fillColor('#666').text(`Document généré le ${fmtDate(new Date())}`, 50, doc.y);
  });
}

const rad = (d: number) => (d * Math.PI) / 180;
function meters(a: number[], b: number[]) {
  const R = 6371008.8, dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export const perimeterM = (ring: number[][]) => ring.reduce((t, p, i) => (i ? t + meters(ring[i - 1], p) : t), 0);

/** Description automatique de l'exploitation d'après les parcelles du producteur (limites, surfaces). */
export function sketchDescription(parcels: { code: string; ha: number | null; ring: number[][] }[]) {
  if (!parcels.length) return 'Aucune parcelle cartographiée pour ce producteur.';
  const total = parcels.reduce((t, p) => t + (p.ha ?? 0), 0);
  const fr = (n: number, d = 2) => n.toFixed(d).replace('.', ',');
  const lines = [`${parcels.length} parcelle(s) cartographiée(s), superficie mesurée totale : ${fr(total)} ha.`];
  for (const p of parcels) {
    const xs = p.ring.map((c) => c[0]), ys = p.ring.map((c) => c[1]);
    lines.push(`${p.code} : ${p.ha != null ? fr(p.ha) + ' ha' : 'surface non calculée'}, périmètre ${Math.round(perimeterM(p.ring))} m, ${p.ring.length - 1} sommets, centre ${fr((Math.min(...ys) + Math.max(...ys)) / 2, 5)}, ${fr((Math.min(...xs) + Math.max(...xs)) / 2, 5)}.`);
  }
  return lines.join('\n');
}

/** Croquis (autres fiches) : uniquement le contour des parcelles, sans cadre ni fond. */
function drawSketch(doc: PDFKit.PDFDocument, parcels: { code: string; ha: number | null; ring: number[][] }[]) {
  drawParcelsOnly(doc, parcels, 50, 495, () => doc.addPage(), 770);
}

// ───────────── Fiche d'inspection interne Rainforest Alliance (mise en page de la fiche papier, version 1.4) ─────────────

export const SECTIONS_RA: [string, string][] = [
  ['1.2', '1.2.    ADMINISTRATION'], ['1.5', '1.5.    MÉCANISME DE RÉCLAMATION'], ['2.1', '2.1. TRAÇABILITÉ'], ['3.1', '3.1 PRIME'], ['4.1', '4.1. PLANTATION ET ROTATION'], ['4.2', '4.2 TAILLE ET ROTATION DES CULTURES'],
  ['4.3', '4.3. ORGANISMES GÉNÉTIQUEMENT MODIFIÉS (OGM)'], ['4.4', '4.4   CONSERVATION ET FERTILITÉ DES SOLS'], ['4.5', '4.5 PROTECTION INTÉGRÉE DES CULTURES (PIC)'], ['4.6', '4.6    GESTION DES PRODUITS CHIMIQUES'],
  ['4.7', '4.7.    PRATIQUES DE RÉCOLTES ET POST-RÉCOLTES'], ['5.2', "5.2. LIBERTÉ D'ASSOCIATION ET NÉGOCIATION COLLECTIVE"], ['5.3', '5.3. SALAIRES ET CONTRATS'], ['5.5', '5.5.   CONDITIONS DE TRAVAIL'],
  ['5.6', '5.6. SANTÉ ET SÉCURITÉ'], ['5.7', '5.7 CONDITIONS DE VIE ET DE LOGEMENT'], ['5.8', '5.8    COMMUNAUTÉS'], ['6.1', '6.1 FORÊTS, AUTRES ÉCOSYSTÈMES NATURELS ET AIRES PROTÉGÉES'],
  ['6.2', '6.2 CONSERVATION ET AMÉLIORATION DES ÉCOSYSTÈMES NATURELS ET DE LA VÉGÉTATION NATURELLE'], ['6.3', '6.3  ZONES RIPARIENNES TAMPONS'], ['6.4', '6.4 PROTECTION DE LA FAUNE SAUVAGE ET DE LA BIODIVERSITÉ'],
  ['6.5', '6.4 PROTECTION DE LA FAUNE SAUVAGE ET DE LA BIODIVERSITÉ'], ['6.6', '6.6 GESTION DES EAUX USÉES'], ['6.7', '6.7 GESTION DES DÉCHETS'],
];

export interface RaFiche {
  orgName: string; certLogo: Buffer | null; orgLogo: Buffer | null;
  f: Record<string, string>;                       // champs d'identification (voir le contrôleur)
  owner: boolean | null; hasWorkers: boolean | null; male: boolean | null;
  reqs: { num: string; type: string; text: string; answer: string; obs?: string }[];
  decision: string | null; corrective: string; remarks: string;
  nc: string[]; score: number | null; threshold: number;
  sketch: { code: string; ha: number | null; ring: number[][] }[];
}

/** Coche large tracée au vecteur (police sans glyphe ✔) dans la case (x, y, w, h). */
function tick(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number) {
  const s = Math.min(w, h);
  doc.save().lineWidth(Math.max(1.8, s / 7)).lineCap('round').lineJoin('round').strokeColor('#000')
    .moveTo(x + w / 2 - s * 0.32, y + h / 2 + s * 0.02).lineTo(x + w / 2 - s * 0.08, y + h / 2 + s * 0.3).lineTo(x + w / 2 + s * 0.38, y + h / 2 - s * 0.34).stroke().restore();
}
function checkbox(doc: PDFKit.PDFDocument, x: number, y: number, on: boolean, size = 11) {
  doc.save().lineWidth(0.8).strokeColor('#000').rect(x, y, size, size).stroke().restore();
  if (on) tick(doc, x - 2, y - 3, size + 6, size + 6);
}

export function raInspectionPdf(d: RaFiche): Promise<Buffer> {
  const L = 40, R = 555, W = R - L, BOTTOM = 762;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: false });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const frame = () => {
      try { if (d.certLogo) doc.image(d.certLogo, L, 24, { fit: [90, 36] }); } catch { /* logo illisible */ }
      try { if (d.orgLogo) doc.image(d.orgLogo, R - 90, 24, { fit: [90, 36], align: 'right' }); } catch { /* idem */ }
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#000').text("Fiche d'inspection interne version 1.4", L, 34, { width: W, align: 'center', lineBreak: false });
      doc.font('Helvetica').fontSize(8).fillColor('#333').text(d.orgName, L, 786, { width: W, lineBreak: false });
      doc.y = 74;
    };
    const page = () => { doc.addPage(); frame(); };
    const need = (h: number) => { if (doc.y + h > BOTTOM) page(); };
    frame();

    const dots = (label: string, value: string | undefined, x: number, y: number, w: number) => {
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#000').text(label + ' : ', x, y, { continued: true, width: w, lineBreak: false });
      const lx = doc.x;
      doc.font('Helvetica').text(value ? value : '', { lineBreak: false });
      doc.save().lineWidth(0.5).dash(1, { space: 2 }).strokeColor('#555').moveTo(Math.min(lx, x + w - 20), y + 11).lineTo(x + w, y + 11).stroke().undash().restore();
    };
    const box = (x: number, y: number, w: number, h: number) => doc.save().lineWidth(0.8).strokeColor('#000').rect(x, y, w, h).stroke().restore();

    // ── Titre ──
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000').text("FICHE D'INSPECTION INTERNE DE CERTIFICATION RAINFOREST ALLIANCE", L, doc.y, { width: W });
    doc.moveDown(0.5).fontSize(10).text('INFORMATIONS GÉNÉRALES', L, doc.y);
    doc.moveDown(0.6);

    // ── 1. Membre du groupe ──
    let top = doc.y, y = top + 20;
    doc.font('Helvetica-Oblique').fontSize(8.5).text('1. Information membre du groupe', L + 6, top + 6);
    const line = (label: string, v: string | undefined) => { dots(label, v, L + 6, y, W - 12); y += 17; };
    const two = (l1: string, v1: string | undefined, l2: string, v2: string | undefined) => { dots(l1, v1, L + 6, y, W / 2 - 10); dots(l2, v2, L + W / 2 + 4, y, W / 2 - 10); y += 17; };
    line('Nom et prénoms du membre du groupe', d.f.name);
    line("Type de pièce d'identité et N° pièce d'identité", d.f.idDoc);
    line('Date et Lieu de naissance', d.f.birth);
    doc.font('Helvetica-Bold').fontSize(9).text('Genre :', L + 6, y, { lineBreak: false }); doc.font('Helvetica').text('Masculin', L + 60, y, { lineBreak: false }); checkbox(doc, L + 110, y - 1, d.male === true, 12);
    doc.text('Féminin', L + 190, y, { lineBreak: false }); checkbox(doc, L + 232, y - 1, d.male === false, 12); y += 19;
    line('Contact du membre', d.f.phone);
    line('Identifiant du membre', d.f.code);
    two('Localité', d.f.village, 'Section', d.f.section);
    two('Région', d.f.region, 'Département', d.f.department);
    line('Première année de certification RA 2020', d.f.firstYear);
    line("Identifiant de l'exploitation", d.f.farmId);
    line("Superficie totale de l'exploitation", d.f.totalArea);
    line("Nombre d'exploitations agricoles", d.f.farms);
    line('Taille du ménage', d.f.household);
    box(L, top, W, y - top + 2); doc.y = y + 8;

    // ── 2. Propriétaire ──
    top = doc.y; y = top + 20;
    doc.font('Helvetica-Oblique').fontSize(8.5).fillColor('#000').text("2. Informations Propriétaire légal de l'exploitation", L + 6, top + 6);
    doc.font('Helvetica-Bold').fontSize(9).text("Êtes-vous le propriétaire légal de l'exploitation ?", L + 6, y); y += 18;
    doc.font('Helvetica').text('OUI', L + 40, y, { lineBreak: false }); checkbox(doc, L + 65, y - 1, d.owner === true, 12);
    doc.text('NON', L + 160, y, { lineBreak: false }); checkbox(doc, L + 187, y - 1, d.owner === false, 12);
    doc.font('Helvetica-Oblique').fontSize(8).text('(Si oui passer à la rubrique 3)', L + 240, y + 1, { lineBreak: false }); y += 20;
    line('Si non Nom et Prénoms du propriétaire', d.f.ownerName);
    doc.font('Helvetica-Bold').fontSize(9).text('Genre :', L + 6, y, { lineBreak: false }); doc.font('Helvetica').text('Masculin', L + 60, y, { lineBreak: false }); checkbox(doc, L + 110, y - 1, false, 12);
    doc.text('Féminin', L + 190, y, { lineBreak: false }); checkbox(doc, L + 232, y - 1, false, 12); y += 19;
    line("Type de pièce d'identité et N° pièce d'identité", '');
    line('Contact', '');
    box(L, top, W, y - top + 2); doc.y = y + 8;

    // ── 3. Culture certifiée ──
    need(190);
    top = doc.y; y = top + 20;
    doc.font('Helvetica-Oblique').fontSize(8.5).fillColor('#000').text('3. Informations sur la culture certifiée', L + 6, top + 6);
    line("Identifiant de l'unité agricole certifiée", d.f.unitId);
    line("Superficie(cacao) de l'unité agricole certifiée", d.f.unitArea);
    line("Nombre total d'unités agricoles certifiées", d.f.units);
    line("Année création de l'unité agricole à certifier", '');
    line('Estimation de production en cours (kg)', '');
    line('Production récoltée précédente (kg)', '');
    line('Volume livré campagne précédente (kg)', '');
    line('Volume livré campagne N-2 (kg)', '');
    dots('Coordonnées GPS (décimal 4 chiffres)  Latitude', d.f.lat, L + 6, y, W / 2 + 40); dots('Longitude', d.f.lon, L + W / 2 + 56, y, W / 2 - 62); y += 17;
    box(L, top, W, y - top + 2); doc.y = y + 8;

    // ── 4. Autres unités ──
    need(150);
    top = doc.y;
    doc.font('Helvetica-Oblique').fontSize(8.5).text('4. Informations sur les autres unités agricoles', L + 6, top + 6);
    y = top + 22;
    const cols4 = [W * 0.34, W * 0.26, W * 0.16, W * 0.12, W * 0.12];
    const heads4 = ["Type d'unité agricole", "Identifiant de l'unité agricole", 'Superficie (ha)', 'Latitude', 'Longitude'];
    let cx = L; doc.font('Helvetica-Bold').fontSize(8);
    cols4.forEach((cw, i) => { box(cx, y, cw, 22); doc.fillColor('#000').text(heads4[i], cx + 3, y + 4, { width: cw - 6 }); cx += cw; });
    y += 22;
    const others = (d.f.others ?? '').split('\n').filter(Boolean);
    for (let r = 0; r < 4; r++) { cx = L; cols4.forEach((cw) => { box(cx, y, cw, 20); cx += cw; }); if (others[r]) doc.font('Helvetica').fontSize(8).text(others[r], L + 3, y + 5, { width: W - 6, lineBreak: false }); y += 20; }
    box(L, top, W, y - top + 2); doc.y = y + 8;

    // ── 5. Travailleurs ──
    need(200);
    top = doc.y;
    doc.font('Helvetica-Oblique').fontSize(8.5).fillColor('#000').text('5. Informations sur les travailleurs', L, top);
    y = top + 16;
    doc.font('Helvetica-Bold').fontSize(9).text('Avez-vous des travailleurs ?', L, y, { lineBreak: false });
    doc.font('Helvetica').text('OUI', L + 130, y, { lineBreak: false }); checkbox(doc, L + 152, y - 1, d.hasWorkers === true, 12);
    doc.text('NON', L + 200, y, { lineBreak: false }); checkbox(doc, L + 224, y - 1, d.hasWorkers === false, 12);
    doc.font('Helvetica-Oblique').fontSize(8).text('(Si oui remplissez le tableau ci-dessous)', L + 260, y + 1, { lineBreak: false });
    if (d.f.workers) doc.font('Helvetica').fontSize(8).text(`Nombre de travailleurs : ${d.f.workers}`, L + 260, y + 12, { lineBreak: false });
    y += 26;
    const cw5 = [24, 150, 70, 40, 40, 90, 101];
    const h5 = ['N°', 'Nom et prénoms du manœuvre', 'Type de main-d\'œuvre (temporaire / permanent / groupe)', 'Âge', 'Genre H/F', 'Date d\'embauche ou nombre de jours travaillés', 'Salaire (précisez si mensuel, journalier, hebdomadaire, annuel, nature ou espèce)'];
    cx = L; doc.font('Helvetica-Bold').fontSize(6.5);
    cw5.forEach((cw, i) => { box(cx, y, cw, 50); doc.text(h5[i], cx + 2, y + 3, { width: cw - 4, align: 'center' }); cx += cw; });
    y += 50;
    for (let r = 0; r < 6; r++) { cx = L; cw5.forEach((cw) => { box(cx, y, cw, 16); cx += cw; }); y += 16; }
    doc.y = y + 10;
    doc.font('Helvetica').fontSize(7.5).text("Type d'exploitation agricole :   Petite exploitation        Grande exploitation        (l'exploitation est grande si le nombre de travailleurs permanents est supérieur ou égal à 5)", L, doc.y, { width: W });
    doc.moveDown(0.8);

    // ── Inspecteur ──
    need(120);
    y = doc.y;
    const insp: [string, string][] = [["Date de l'inspection interne (Jour/Mois/Année)", d.f.inspDate], ["Nom et prénoms de l'inspecteur interne", d.f.inspector], ["Type et N° de pièce d'identité de l'inspecteur interne", d.f.inspId], ["Contact de l'inspecteur interne", d.f.inspPhone]];
    for (const [k, v] of insp) { box(L, y, 200, 26); box(L + 200, y, W - 200, 26); doc.font('Helvetica-Bold').fontSize(8).text(k, L + 4, y + 4, { width: 192 }); doc.font('Helvetica').fontSize(9).text(v ?? '', L + 206, y + 8, { width: W - 210, lineBreak: false }); y += 26; }
    doc.y = y + 10;

    // ── Légende + tableau d'évaluation ──
    page();
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#000');
    doc.text('Légende :', L, doc.y).moveDown(0.3).text('C : Conforme').text('NC : Non conforme').text('N/A : Non applicable').moveDown(0.3).text("EF : Exigence Fondamentale").text('ES : Exigence Spécialisée').text("EAC : Exigence d'Amélioration Continue");
    doc.moveDown(0.8);
    const cw = [52, 258, 26, 26, 26, W - 388];
    const header = () => {
      const yy = doc.y; let x = L;
      const labels = ['N° Exigences', 'Libellé', 'C', 'NC', 'N/A', 'Observations'];
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#000');
      cw.forEach((c, i) => { box(x, yy, c, 30); if (i >= 2 && i <= 4) { doc.fontSize(7).text(labels[i], x + 1, yy + 19, { width: c - 2, align: 'center', lineBreak: false }); } else doc.fontSize(8).text(labels[i], x + 2, yy + (i === 0 ? 4 : 10), { width: c - 4, align: 'center' }); x += c; });
      doc.save().lineWidth(0.8).moveTo(L + cw[0] + cw[1], yy + 15).lineTo(L + cw[0] + cw[1] + cw[2] + cw[3] + cw[4], yy + 15).stroke();
      doc.font('Helvetica-Bold').fontSize(5.5).text('Évaluation de la conformité', L + cw[0] + cw[1], yy + 5, { width: cw[2] + cw[3] + cw[4], align: 'center', lineBreak: false }).restore();
      doc.y = yy + 30;
    };
    header();
    let lastSec = '';
    for (const r of d.reqs) {
      const pre = r.num.split('.').slice(0, 2).join('.');
      const sec = SECTIONS_RA.find((s) => s[0] === pre)?.[1] ?? '';
      doc.font('Helvetica').fontSize(8);
      const th = doc.heightOfString(r.text, { width: cw[1] - 10 });
      doc.fontSize(7.5);
      const oh = r.obs ? doc.heightOfString(r.obs, { width: cw[5] - 8 }) : 0;
      const rh = Math.max(34, th + 12, oh + 12);
      if (sec && sec !== lastSec) {
        if (doc.y + 22 + rh > BOTTOM) { page(); header(); }
        const hy = doc.y; box(L, hy, W, 20); doc.font('Helvetica-Bold').fontSize(8.5).text(sec, L + 4, hy + 6, { width: W - 8, lineBreak: false }); doc.y = hy + 20; lastSec = sec;
      }
      if (doc.y + rh > BOTTOM) { page(); header(); }
      const yy = doc.y; let x = L;
      cw.forEach((c) => { box(x, yy, c, rh); x += c; });
      doc.font('Helvetica-Bold').fontSize(8).text(`${r.num}\n${r.type}`, L + 2, yy + 6, { width: cw[0] - 4, align: 'center' });
      doc.font('Helvetica').fontSize(8).text(r.text, L + cw[0] + 5, yy + 6, { width: cw[1] - 10 });
      if (r.obs) doc.font('Helvetica').fontSize(7.5).text(r.obs, L + cw[0] + cw[1] + cw[2] + cw[3] + cw[4] + 4, yy + 6, { width: cw[5] - 8 });
      const col = (a: string) => (r.answer === a);
      const cells = [col('Conforme'), col('Non conforme'), col('Non applicable')];
      cells.forEach((on, i) => { if (on) tick(doc, L + cw[0] + cw[1] + i * 26 + 1, yy + rh / 2 - 12, 24, 24); });
      doc.y = yy + rh;
    }

    // ── Évaluation de la conformité ──
    const A = d.reqs.filter((r) => r.answer === 'Conforme').length, B = d.reqs.filter((r) => r.answer === 'Non conforme').length;
    const NA = d.reqs.filter((r) => r.answer === 'Non applicable');
    need(520);
    doc.moveDown(1.5).font('Helvetica-Bold').fontSize(9).fillColor('#000').text('EVALUATION DE LA CONFORMITÉ', L, doc.y);
    doc.moveDown(0.5);
    y = doc.y;
    const t1 = [150, 100, 100, 100];
    const grid = (rows: string[][], widths: number[], x0: number, y0: number, h = 22, boldFirst = true) => {
      let yy = y0;
      rows.forEach((row, ri) => { let x = x0; row.forEach((cell, ci) => { box(x, yy, widths[ci], h); doc.font(ri === 0 || (boldFirst && ci === 0) ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).text(cell, x + 4, yy + 7, { width: widths[ci] - 8, lineBreak: false }); x += widths[ci]; }); yy += h; });
      return yy;
    };
    y = grid([['', 'Conforme', 'Non conformes', 'Total'], ['Exigences applicables', String(A), String(B), String(A + B)]], t1, L, y);
    y += 12;
    y = grid([['(EF+ES+EAC)', `A = ${A}`, `B = ${B}`, `(A+B) = ${A + B}`]], [150, 100, 100, 100], L, y, 24, false);
    box(L, y, 150, 46); box(L + 150, y, 300, 46);
    doc.font('Helvetica').fontSize(8).text('Exigences non applicables', L + 4, y + 8, { width: 142 });
    doc.text(`${NA.length}${NA.length ? ' : ' + NA.map((r) => r.num).join(', ') : ''}`, L + 154, y + 8, { width: 292 });
    y += 62;
    doc.font('Helvetica-Bold').fontSize(9).text('SCORE GENERAL', L, y); y += 14;
    const sy = y;
    box(L, sy, 80, 22); box(L + 80, sy, 120, 22); box(L + 200, sy, 130, 22);
    doc.fontSize(8).text('Score exigé (%)', L + 84, sy + 7, { width: 112 }).text('Score obtenu (%)', L + 204, sy + 7, { width: 122 });
    box(L, sy + 22, 80, 56); box(L + 80, sy + 22, 120, 56); box(L + 200, sy + 22, 130, 56);
    doc.font('Helvetica').fontSize(7.5).text('Exigences applicables = (A+B) − Nbre NA', L + 4, sy + 30, { width: 72 });
    doc.font('Helvetica-Bold').fontSize(14).text(`100 %`, L + 100, sy + 42, { width: 90, lineBreak: false });
    doc.text(d.score === null ? '—' : `${String(d.score).replace('.', ',')} %`, L + 224, sy + 42, { width: 100, lineBreak: false });
    doc.font('Helvetica').fontSize(7).text('Score = A ÷ (A+B) × 100', L + 204, sy + 64, { width: 122, lineBreak: false });
    doc.y = sy + 92;

    // ── Recommandations ──
    need(330);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#000').text("Recommandations d'Approbation de l'inspecteur", L, doc.y); doc.moveDown(0.4);
    y = doc.y;
    box(L, y, W, 38);
    doc.font('Helvetica').fontSize(8).text('Statut de Conformité', L + 4, y + 4, { lineBreak: false });
    const opts = [['Approuvé', 'approuvé'], ['Sanctionn', 'sanctionné avec mesures correctives'], ['Exclu', 'exclu']];
    let ox = L + 6;
    for (const [key, lab] of opts) { checkbox(doc, ox, y + 21, !!d.decision && d.decision.startsWith(key), 11); doc.font('Helvetica').fontSize(8).text(lab, ox + 16, y + 23, { lineBreak: false }); ox += key === 'Approuvé' ? 110 : key === 'Sanctionn' ? 230 : 0; }
    y += 38;
    box(L, y, W / 2, 20); box(L + W / 2, y, W / 2, 20);
    doc.font('Helvetica-Bold').fontSize(8).text('Non conformités', L + 4, y + 6, { lineBreak: false }).text('Mesures correctives pour l\'année en cours', L + W / 2 + 4, y + 6, { lineBreak: false });
    y += 20;
    const rowsNc = Math.max(5, d.nc.length);
    for (let i = 0; i < rowsNc; i++) {
      const txt = d.nc[i] ?? '';
      doc.font('Helvetica').fontSize(7.5);
      const h = Math.max(32, doc.heightOfString(txt, { width: W / 2 - 8 }) + 10);
      if (y + h > BOTTOM) { page(); y = doc.y; }
      box(L, y, W / 2, h); box(L + W / 2, y, W / 2, h);
      doc.text(txt, L + 4, y + 5, { width: W / 2 - 8 });
      if (i === 0 && d.corrective) doc.text(d.corrective, L + W / 2 + 4, y + 5, { width: W / 2 - 8, height: h - 6 });
      y += h;
    }
    doc.y = y + 14;

    // ── Signatures et vérification ──
    need(300);
    y = doc.y;
    box(L, y, W / 2, 40); box(L + W / 2, y, W / 2, 40); y += 48;
    box(L + 6, y, W / 2 - 20, 20); box(L + W / 2 - 14, y, W / 2 + 8, 20);
    doc.font('Helvetica-Bold').fontSize(8).text('Signature ou empreinte digitale du membre', L + 10, y + 6, { width: W / 2 - 28, lineBreak: false }).text("Signature de l'Inspecteur Interne", L + W / 2 - 8, y + 6, { width: W / 2 - 4, lineBreak: false });
    y += 32;
    box(L, y, W, 120);
    doc.font('Helvetica').fontSize(8).text("En cas de non-conformités : Vérification et description des mesures correctives :", L + 4, y + 5);
    doc.font('Helvetica-Bold').text('Date de vérification', L + 4, y + 104, { lineBreak: false }).text("Nom et Signature de l'Inspecteur Interne", L + W / 2, y + 104, { lineBreak: false });
    y += 132;
    doc.font('Helvetica-Bold').fontSize(8.5).text("Décision sur l'État de certification du membre", L + 40, y, { lineBreak: false }); y += 14;
    box(L + 10, y, W - 20, 50);
    doc.font('Helvetica').fontSize(9).text('Statut de vérification', L + 16, y + 6, { lineBreak: false });
    ox = L + 16; for (const [key, lab] of opts) { checkbox(doc, ox, y + 31, false, 11); doc.fontSize(8).text(lab, ox + 16, y + 33, { lineBreak: false }); ox += key === 'Approuvé' ? 110 : key === 'Sanctionn' ? 230 : 0; }
    doc.y = y + 64;

    // ── Remarques, croquis, approbation ──
    need(160);
    y = doc.y;
    const rh2 = 130; box(L, y, W, rh2);
    doc.font('Helvetica-Bold').fontSize(8.5).text('Remarque additionnelles :', L + 4, y + 5);
    if (d.remarks) doc.font('Helvetica').fontSize(8).text(d.remarks, L + 4, y + 20, { width: W - 8, height: rh2 - 24 });
    doc.y = y + rh2 + 14;
    drawParcelsOnly(doc, d.sketch, L, W, () => page(), BOTTOM);
    need(130);
    y = doc.y + 6;
    box(L, y, W, 22); box(L, y + 22, W, 80);
    doc.font('Helvetica').fontSize(8.5).text('Lieu et date :', L + 4, y + 7, { lineBreak: false }).text("Signature du Président du Comité d'Approbation ou de son représentant", L + 4, y + 29, { lineBreak: false });
    doc.end();
  });
}

/** Croquis : uniquement le contour des parcelles du producteur (sans cadre ni fond), à l'échelle. */
function drawParcelsOnly(doc: PDFKit.PDFDocument, parcels: { code: string; ha: number | null; ring: number[][] }[], L: number, W: number, newPage: () => void, bottom: number) {
  if (!parcels.length) return;
  const H = 230;
  if (doc.y + H + 40 > bottom) newPage();
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#000').text("Croquis de l'exploitation", L, doc.y);
  doc.font('Helvetica').fontSize(7.5).fillColor('#444').text(sketchDescription(parcels), L, doc.y + 2, { width: W });
  const top = doc.y + 8;
  const all = parcels.flatMap((p) => p.ring);
  const lon0 = Math.min(...all.map((c) => c[0])), lon1 = Math.max(...all.map((c) => c[0]));
  const lat0 = Math.min(...all.map((c) => c[1])), lat1 = Math.max(...all.map((c) => c[1]));
  const kx = Math.cos(rad((lat0 + lat1) / 2));
  const spanX = Math.max((lon1 - lon0) * kx, 1e-9), spanY = Math.max(lat1 - lat0, 1e-9);
  const sc = Math.min((W - 40) / spanX, (H - 20) / spanY);
  const ox = L + (W - spanX * sc) / 2, oy = top + (H - spanY * sc) / 2;
  parcels.forEach((p, i) => {
    const pts = p.ring.map((c): [number, number] => [ox + (c[0] - lon0) * kx * sc, oy + (lat1 - c[1]) * sc]);
    doc.save().lineWidth(1.4).strokeColor('#000').moveTo(pts[0][0], pts[0][1]);
    for (const q of pts.slice(1)) doc.lineTo(q[0], q[1]);
    doc.closePath().stroke().restore();
    const cx = pts.reduce((t, q) => t + q[0], 0) / pts.length, cy = pts.reduce((t, q) => t + q[1], 0) / pts.length;
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(7).text(p.code || `P${i + 1}`, cx - 30, cy - 4, { width: 60, align: 'center', lineBreak: false });
  });
  doc.y = top + H + 6;
}
