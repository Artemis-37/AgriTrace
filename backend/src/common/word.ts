import { AlignmentType, BorderStyle, Document, Footer, Header, ImageRun, Packer, PageBreak, Paragraph, Table, TableCell, TableRow, TextRun, VerticalAlign, WidthType } from 'docx';
import { PNG } from 'pngjs';
import { RaFiche, SECTIONS_RA, sketchDescription } from './pdf';

const W = 10200; // largeur utile (twips) : A4 avec marges de 1 cm environ
const FONT = 'Calibri';
const border = { style: BorderStyle.SINGLE, size: 6, color: '000000' };
const borders = { top: border, bottom: border, left: border, right: border };
const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };

const run = (t: string, o: { b?: boolean; i?: boolean; size?: number } = {}) => new TextRun({ text: t, bold: o.b, italics: o.i, size: o.size ?? 18, font: FONT });
const para = (t: string | TextRun[], o: { align?: (typeof AlignmentType)[keyof typeof AlignmentType]; before?: number; after?: number; b?: boolean; size?: number; i?: boolean } = {}) =>
  new Paragraph({ alignment: o.align, spacing: { before: o.before ?? 0, after: o.after ?? 40 }, children: typeof t === 'string' ? t.split('\n').flatMap((l, i) => [run(l, o)].map((r) => (i ? new TextRun({ text: l, break: 1, bold: o.b, italics: o.i, size: o.size ?? 18, font: FONT }) : r))) : t });
const cell = (children: (Paragraph | Table)[], width: number, o: { span?: number; v?: boolean; noBorder?: boolean } = {}) =>
  new TableCell({ width: { size: width, type: WidthType.DXA }, columnSpan: o.span, verticalAlign: o.v ? VerticalAlign.CENTER : VerticalAlign.TOP, borders: o.noBorder ? { top: none, bottom: none, left: none, right: none } : borders,
    margins: { top: 40, bottom: 40, left: 80, right: 80 }, children });
const table = (widths: number[], rows: TableRow[]) => new Table({ width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA }, columnWidths: widths, rows });
const BOX = (on: boolean) => (on ? '☒' : '☐');
const tick = (on: boolean) => para(on ? [new TextRun({ text: '✔', bold: true, size: 40, color: '000000', font: 'Segoe UI Symbol' })] : '', { align: AlignmentType.CENTER });
const pt = (id: string) => (id ? id : '');

/** Contour des parcelles seul, fond transparent (PNG), à l'échelle. */
export function sketchPng(parcels: { ring: number[][] }[]): { data: Buffer; w: number; h: number } | null {
  if (!parcels.length) return null;
  const all = parcels.flatMap((p) => p.ring);
  const lon0 = Math.min(...all.map((c) => c[0])), lon1 = Math.max(...all.map((c) => c[0])), lat0 = Math.min(...all.map((c) => c[1])), lat1 = Math.max(...all.map((c) => c[1]));
  const kx = Math.cos((((lat0 + lat1) / 2) * Math.PI) / 180);
  const spanX = Math.max((lon1 - lon0) * kx, 1e-9), spanY = Math.max(lat1 - lat0, 1e-9);
  const pad = 12, maxPx = 900, sc = (maxPx - 2 * pad) / Math.max(spanX, spanY);
  const w = Math.ceil(spanX * sc + 2 * pad), h = Math.ceil(spanY * sc + 2 * pad);
  const png = new PNG({ width: w, height: h }); // RGBA, entièrement transparent au départ
  const dot = (x: number, y: number) => { for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const px = Math.round(x) + dx, py = Math.round(y) + dy; if (px >= 0 && py >= 0 && px < w && py < h) { const i = (w * py + px) << 2; png.data[i] = 0; png.data[i + 1] = 0; png.data[i + 2] = 0; png.data[i + 3] = 255; } } };
  for (const p of parcels) {
    const pts = p.ring.map((c) => [pad + (c[0] - lon0) * kx * sc, pad + (lat1 - c[1]) * sc]);
    for (let k = 1; k < pts.length; k++) {
      const [x0, y0] = pts[k - 1], [x1, y1] = pts[k], n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
      for (let s = 0; s <= n; s++) dot(x0 + ((x1 - x0) * s) / n, y0 + ((y1 - y0) * s) / n);
    }
  }
  return { data: PNG.sync.write(png), w, h };
}

export async function raInspectionDocx(d: RaFiche): Promise<Buffer> {
  const kids: (Paragraph | Table)[] = [];
  const field = (label: string, v?: string) => para([run(label + ' : ', { b: true }), run(v || '………………………………………………………')], { after: 80 });
  const sec = (title: string, body: (Paragraph | Table)[]) => kids.push(table([W], [new TableRow({ children: [cell([para(title, { i: true, after: 80 }), ...body], W)] })]), para('', { after: 80 }));
  const sexe = (male: boolean | null) => para([run('Genre : ', { b: true }), run(`Masculin ${BOX(male === true)}      Féminin ${BOX(male === false)}`)], { after: 80 });

  kids.push(para("FICHE D'INSPECTION INTERNE DE CERTIFICATION RAINFOREST ALLIANCE", { b: true, size: 22, after: 80 }), para('INFORMATIONS GÉNÉRALES', { b: true, size: 20, after: 120 }));
  sec('1. Information membre du groupe', [field('Nom et prénoms du membre du groupe', d.f.name), field("Type de pièce d'identité et N° pièce d'identité", d.f.idDoc), field('Date et Lieu de naissance', d.f.birth), sexe(d.male),
    field('Contact du membre', d.f.phone), field('Identifiant du membre', d.f.code), field('Localité', d.f.village), field('Section', d.f.section), field('Région', d.f.region), field('Département', d.f.department),
    field('Première année de certification RA 2020', d.f.firstYear), field("Identifiant de l'exploitation", d.f.farmId), field("Superficie totale de l'exploitation", d.f.totalArea), field("Nombre d'exploitations agricoles", d.f.farms), field('Taille du ménage', d.f.household)]);
  sec("2. Informations Propriétaire légal de l'exploitation", [para([run("Êtes-vous le propriétaire légal de l'exploitation ?", { b: true })]), para(`OUI ${BOX(d.owner === true)}        NON ${BOX(d.owner === false)}        (Si oui passer à la rubrique 3)`, { after: 80 }),
    field('Si non Nom et Prénoms du propriétaire', d.f.ownerName), sexe(null), field("Type de pièce d'identité et N° pièce d'identité", ''), field('Contact', '')]);
  sec('3. Informations sur la culture certifiée', [field("Identifiant de l'unité agricole certifiée", d.f.unitId), field("Superficie(cacao) de l'unité agricole certifiée", d.f.unitArea), field("Nombre total d'unités agricoles certifiées", d.f.units),
    field("Année création de l'unité agricole à certifier", ''), field('Estimation de production en cours (kg)', ''), field('Production récoltée précédente (kg)', ''), field('Volume livré campagne précédente (kg)', ''), field('Volume livré campagne N-2 (kg)', ''),
    field('Coordonnées GPS (décimal 4 chiffres)  Latitude', d.f.lat), field('Longitude', d.f.lon)]);

  const c4 = [3400, 2600, 1600, 1300, 1300];
  const others = (d.f.others ?? '').split('\n').filter(Boolean);
  kids.push(para('4. Informations sur les autres unités agricoles', { i: true, after: 60 }), table(c4, [
    new TableRow({ children: ["Type d'unité agricole", "Identifiant de l'unité agricole", 'Superficie (ha)', 'Latitude', 'Longitude'].map((t, i) => cell([para(t, { b: true, size: 16 })], c4[i])) }),
    ...[0, 1, 2, 3].map((r) => new TableRow({ height: { value: 380, rule: 'atLeast' }, children: c4.map((w, i) => cell([para(i === 0 ? others[r] ?? '' : '')], w)) }))]), para('', { after: 120 }));

  kids.push(para('5. Informations sur les travailleurs', { i: true, after: 60 }), para([run('Avez-vous des travailleurs ?  ', { b: true }), run(`OUI ${BOX(d.hasWorkers === true)}    NON ${BOX(d.hasWorkers === false)}    (Si oui remplissez le tableau ci-dessous)${d.f.workers ? '   Nombre de travailleurs : ' + d.f.workers : ''}`)], { after: 80 }));
  const c5 = [500, 2700, 1500, 700, 800, 1900, 2100];
  kids.push(table(c5, [
    new TableRow({ children: ['N°', 'Nom et prénoms du manœuvre', "Type de main-d'œuvre (temporaire / permanent / groupe)", 'Âge', 'Genre H/F', "Date d'embauche ou nombre de jours travaillés", 'Salaire (précisez si mensuel, journalier, hebdomadaire, annuel, nature ou espèce)'].map((t, i) => cell([para(t, { b: true, size: 14, align: AlignmentType.CENTER })], c5[i])) }),
    ...[1, 2, 3, 4, 5, 6].map(() => new TableRow({ height: { value: 340, rule: 'atLeast' }, children: c5.map((w) => cell([para('')], w)) }))]),
  para("Type d'exploitation agricole :   Petite exploitation ☐     Grande exploitation ☐     (l'exploitation est grande si le nombre de travailleurs permanents est supérieur ou égal à 5)", { size: 15, before: 80, after: 120 }));
  const ci = [4400, W - 4400];
  kids.push(table(ci, [["Date de l'inspection interne (Jour/Mois/Année)", d.f.inspDate], ["Nom et prénoms de l'inspecteur interne", d.f.inspector], ["Type et N° de pièce d'identité de l'inspecteur interne", d.f.inspId], ["Contact de l'inspecteur interne", d.f.inspPhone]]
    .map(([k, v]) => new TableRow({ height: { value: 460, rule: 'atLeast' }, children: [cell([para(k, { b: true, size: 16 })], ci[0], { v: true }), cell([para(pt(v ?? ''))], ci[1], { v: true })] }))));
  kids.push(new Paragraph({ children: [new PageBreak()] }));

  // Légende + exigences
  kids.push(para('Légende :', { b: true }), para('C : Conforme', { b: true }), para('NC : Non conforme', { b: true }), para('N/A : Non applicable', { b: true }), para("EF : Exigence Fondamentale", { b: true }), para('ES : Exigence Spécialisée', { b: true }), para("EAC : Exigence d'Amélioration Continue", { b: true, after: 160 }));
  const cr = [1000, 5200, 500, 500, 500, W - 7700];
  const rows: TableRow[] = [new TableRow({ tableHeader: true, children: [
    cell([para('N° Exigences', { b: true, size: 16, align: AlignmentType.CENTER })], cr[0], { v: true }), cell([para('Libellé', { b: true, align: AlignmentType.CENTER })], cr[1], { v: true }),
    cell([para('C', { b: true, size: 16, align: AlignmentType.CENTER })], cr[2], { v: true }), cell([para('NC', { b: true, size: 16, align: AlignmentType.CENTER })], cr[3], { v: true }), cell([para('N/A', { b: true, size: 16, align: AlignmentType.CENTER })], cr[4], { v: true }),
    cell([para('Observations', { b: true, align: AlignmentType.CENTER })], cr[5], { v: true })] })];
  let last = '';
  for (const r of d.reqs) {
    const s = SECTIONS_RA.find((x) => x[0] === r.num.split('.').slice(0, 2).join('.'))?.[1] ?? '';
    if (s && s !== last) { rows.push(new TableRow({ children: [cell([para(s, { b: true })], W, { span: 6 })] })); last = s; }
    rows.push(new TableRow({ cantSplit: true, height: { value: 700, rule: 'atLeast' }, children: [
      cell([para(r.num, { b: true, size: 16, align: AlignmentType.CENTER, after: 0 }), para(r.type, { b: true, size: 16, align: AlignmentType.CENTER, after: 0 })], cr[0], { v: true }),
      cell([para(r.text, { size: 16 })], cr[1], { v: true }),
      cell([tick(r.answer === 'Conforme')], cr[2], { v: true }), cell([tick(r.answer === 'Non conforme')], cr[3], { v: true }), cell([tick(r.answer === 'Non applicable')], cr[4], { v: true }), cell([para(r.obs ?? '', { size: 14 })], cr[5])] }));
  }
  kids.push(table(cr, rows), para('', { after: 200 }));

  // Évaluation, score
  const A = d.reqs.filter((r) => r.answer === 'Conforme').length, B = d.reqs.filter((r) => r.answer === 'Non conforme').length, NA = d.reqs.filter((r) => r.answer === 'Non applicable');
  const c3 = [3000, 2200, 2200, 2200];
  kids.push(para('EVALUATION DE LA CONFORMITÉ', { b: true, after: 80 }), table(c3, [
    new TableRow({ children: ['', 'Conforme', 'Non conformes', 'Total'].map((t, i) => cell([para(t, { b: true })], c3[i])) }),
    new TableRow({ children: ['Exigences applicables', String(A), String(B), String(A + B)].map((t, i) => cell([para(t, { b: i === 0 })], c3[i])) })]), para('', { after: 80 }),
  table(c3, [new TableRow({ children: ['(EF+ES+EAC)', `A = ${A}`, `B = ${B}`, `(A+B) = ${A + B}`].map((t, i) => cell([para(t)], c3[i])) })]),
  table([3000, 6600], [new TableRow({ height: { value: 600, rule: 'atLeast' }, children: [cell([para('Exigences non applicables')], 3000), cell([para(`${NA.length}${NA.length ? ' : ' + NA.map((r) => r.num).join(', ') : ''}`)], 6600)] })]),
  para('', { after: 120 }), para('SCORE GENERAL', { b: true, after: 80 }),
  table([2000, 2400, 2400], [
    new TableRow({ children: [cell([para('')], 2000), cell([para('Score exigé (%)', { b: true })], 2400), cell([para('Score obtenu (%)', { b: true })], 2400)] }),
    new TableRow({ height: { value: 1000, rule: 'atLeast' }, children: [cell([para('Exigences applicables = (A+B) − Nbre NA', { size: 15 })], 2000), cell([para('100 %', { b: true, size: 28 })], 2400, { v: true }), cell([para(d.score === null ? '—' : `${String(d.score).replace('.', ',')} %`, { b: true, size: 28 }), para('Score = A ÷ (A+B) × 100', { size: 14 })], 2400, { v: true })] })]),
  para('', { after: 160 }));

  // Recommandations
  const dec = d.decision ?? '';
  kids.push(para("Recommandations d'Approbation de l'inspecteur", { b: true, after: 80 }), table([W], [new TableRow({ height: { value: 700, rule: 'atLeast' }, children: [cell([para('Statut de Conformité', { size: 16 }),
    para(`${BOX(dec.startsWith('Approuvé'))} approuvé          ${BOX(dec.startsWith('Sanctionn'))} sanctionné avec mesures correctives          ${BOX(dec.startsWith('Exclu'))} exclu`)], W)] })]));
  const cn = [W / 2, W / 2];
  kids.push(table(cn, [new TableRow({ children: [cell([para('Non conformités', { b: true })], cn[0]), cell([para('Mesures correctives pour l\'année en cours', { b: true })], cn[1])] }),
    ...Array.from({ length: Math.max(5, d.nc.length) }, (_, i) => new TableRow({ height: { value: 640, rule: 'atLeast' }, children: [cell([para(d.nc[i] ?? '', { size: 15 })], cn[0]), cell([para(i === 0 ? d.corrective : '', { size: 15 })], cn[1])] }))]), para('', { after: 160 }));

  kids.push(table(cn, [new TableRow({ height: { value: 900, rule: 'atLeast' }, children: [cell([para('')], cn[0]), cell([para('')], cn[1])] }), new TableRow({ children: [cell([para('Signature ou empreinte digitale du membre', { b: true, size: 16 })], cn[0]), cell([para("Signature de l'Inspecteur Interne", { b: true, size: 16 })], cn[1])] })]), para('', { after: 120 }),
    table([W], [new TableRow({ height: { value: 2200, rule: 'atLeast' }, children: [cell([para('En cas de non-conformités : Vérification et description des mesures correctives :', { size: 16 })], W)] })]),
    table(cn, [new TableRow({ children: [cell([para('Date de vérification', { b: true, size: 16 })], cn[0], { noBorder: true }), cell([para("Nom et Signature de l'Inspecteur Interne", { b: true, size: 16 })], cn[1], { noBorder: true })] })]), para('', { after: 120 }),
    para("Décision sur l'État de certification du membre", { b: true, align: AlignmentType.CENTER, after: 80 }),
    table([W], [new TableRow({ height: { value: 900, rule: 'atLeast' }, children: [cell([para('Statut de vérification'), para('☐ approuvé          ☐ sanctionné avec mesures correctives          ☐ exclu')], W)] })]), para('', { after: 160 }),
    table([W], [new TableRow({ height: { value: 2200, rule: 'atLeast' }, children: [cell([para('Remarque additionnelles :', { b: true }), para(d.remarks, { size: 16 })], W)] })]), para('', { after: 160 }));

  const sk = sketchPng(d.sketch);
  if (sk) {
    const wpx = Math.min(560, sk.w), hpx = Math.round((wpx * sk.h) / sk.w);
    kids.push(para("Croquis de l'exploitation", { b: true, after: 60 }), para(sketchDescription(d.sketch), { size: 15, after: 100 }),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: 'png', data: sk.data, transformation: { width: wpx, height: Math.min(hpx, 420) }, altText: { title: 'Croquis', description: 'Contour des parcelles', name: 'croquis' } })] }), para('', { after: 120 }));
  }
  kids.push(table([W], [new TableRow({ children: [cell([para('Lieu et date :')], W)] }), new TableRow({ height: { value: 1500, rule: 'atLeast' }, children: [cell([para("Signature du Président du Comité d'Approbation ou de son représentant")], W)] })]));

  const header = new Header({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run("Fiche d'inspection interne version 1.4", { b: true })] })] });
  const doc = new Document({
    creator: 'AgriTrace', title: "Fiche d'inspection interne Rainforest Alliance",
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1000, bottom: 900, left: 850, right: 850 } } }, headers: { default: header },
      footers: { default: new Footer({ children: [new Paragraph({ children: [run(d.orgName, { size: 16 })] })] }) }, children: kids }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}
