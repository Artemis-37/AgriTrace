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
    row(doc, 'Date', fmtDate(r.weighed_at));
    row(doc, 'Producteur', `${r.producer_name} (${r.producer_code})`);
    row(doc, 'Collecteur', r.collector_name);
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
        `${o.net_kg} kg (déclaré ${o.declared_kg} kg) — reçu ${o.receipt_number} — collecteur ${o.collector_name}`);
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
