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

/** Croquis : les polygones des parcelles du producteur, à l'échelle, dans un cadre. */
function drawSketch(doc: PDFKit.PDFDocument, parcels: { code: string; ha: number | null; ring: number[][] }[]) {
  const W = 495, H = 260;
  if (doc.y > 740 - H - 40) doc.addPage();
  doc.moveDown(1).font('Helvetica-Bold').fontSize(11).fillColor('#000').text("Croquis de l'exploitation (parcelles du producteur)", 50, doc.y);
  doc.font('Helvetica').fontSize(8).fillColor('#444').text(sketchDescription(parcels), 50, doc.y + 2, { width: W });
  const top = doc.y + 6;
  doc.rect(50, top, W, H).stroke('#999');
  const all = parcels.flatMap((p) => p.ring);
  const lon0 = Math.min(...all.map((c) => c[0])), lon1 = Math.max(...all.map((c) => c[0]));
  const lat0 = Math.min(...all.map((c) => c[1])), lat1 = Math.max(...all.map((c) => c[1]));
  const kx = Math.cos(rad((lat0 + lat1) / 2)); // correction de la longitude
  const spanX = Math.max((lon1 - lon0) * kx, 1e-9), spanY = Math.max(lat1 - lat0, 1e-9);
  const pad = 24, sc = Math.min((W - 2 * pad) / spanX, (H - 2 * pad) / spanY);
  const ox = 50 + (W - spanX * sc) / 2, oy = top + (H - spanY * sc) / 2;
  const pt = (c: number[]): [number, number] => [ox + (c[0] - lon0) * kx * sc, oy + (lat1 - c[1]) * sc];
  parcels.forEach((p, i) => {
    const pts = p.ring.map(pt);
    doc.save().fillColor(GREEN).fillOpacity(0.18).strokeColor(GREEN).lineWidth(1.2);
    doc.moveTo(pts[0][0], pts[0][1]);
    for (const q of pts.slice(1)) doc.lineTo(q[0], q[1]);
    doc.closePath().fillAndStroke();
    doc.restore();
    const cx = pts.reduce((t, q) => t + q[0], 0) / pts.length, cy = pts.reduce((t, q) => t + q[1], 0) / pts.length;
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(7).text(p.code || `P${i + 1}`, cx - 30, cy - 4, { width: 60, align: 'center' });
  });
  doc.fillColor('#000').font('Helvetica').fontSize(7).text('N ↑', 50 + W - 28, top + 6);
  const m = Math.pow(10, Math.floor(Math.log10(((W - 2 * pad) / sc / kx) * 111320 / 3))); // longueur ronde de l'échelle
  doc.moveTo(60, top + H - 12).lineTo(60 + (m / 111320) * kx * sc, top + H - 12).lineWidth(1.5).stroke('#000');
  doc.text(`${m} m`, 60, top + H - 10);
  doc.y = top + H + 6;
  doc.fontSize(7).fillColor('#666').text('Limites tirées des polygones relevés. Voisins, cours d\'eau, magasin phytosanitaire et habitations ne sont pas connus du logiciel : à compléter dans « Remarques additionnelles ».', 50, doc.y, { width: W });
}
