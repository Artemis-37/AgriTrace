// Génère les PDF des guides : pandoc (Markdown → HTML) puis Chromium (HTML → PDF).
// Usage : NODE_PATH=… node docs/build-pdf.mjs   (Chromium : CHROMIUM_PATH ou celui de Playwright)
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(dir, 'pdf'); fs.mkdirSync(out, { recursive: true });
const DOCS = [
  ['GUIDE_UTILISATEUR.md', 'AgriTrace - Guide utilisateur', 'Guide utilisateur', false],
  ['GUIDE_FORMATION.md', 'AgriTrace - Guide de formation par profil', 'Guide de formation par profil', false],
  ['DEPLOIEMENT.md', 'AgriTrace - Deploiement et installation', 'Déploiement et installation', false],
  ['DEPLOIEMENT_MULTI_COOPERATIVES.md', 'AgriTrace - Deploiement multi-cooperatives', 'Déploiement pour plusieurs coopératives', false],
  ['DEPLOIEMENT_HETZNER.md', 'AgriTrace - Deploiement Hetzner', 'Déploiement sur Hetzner', false],
  ['AUDITS.md', 'AgriTrace - Audits exportateur et cooperative', 'Audits : l\'exportateur audite ses coopératives', false],
  ['EXPORTATEUR.md', 'AgriTrace - Exportateur et echanges entre organisations', 'Exportateur et échanges entre organisations', false],
  ['EXPLOITATION.md', 'AgriTrace - Exploitation', 'Exploitation', false],
  ['DEMO.md', 'AgriTrace - Version de demonstration', 'Version de démonstration', false],
  ['COMPTES_DEMO.md', 'AgriTrace - Comptes de demonstration', 'Comptes de la version de démonstration', false],
  ['MATRICE_ROLES.md', 'AgriTrace - Matrice des roles et permissions', 'Matrice des rôles et permissions', true],
  ['DEFAUTS_CONNUS_ET_RECETTE.md', 'AgriTrace - Defauts connus et plan de recette', 'Défauts connus et plan de recette', false],
  ['SECURITE.md', 'AgriTrace - Rapport de securite', 'Rapport de sécurité', false],
  ['DONNEES_PERSONNELLES.md', 'AgriTrace - Donnees personnelles', 'Données personnelles', false],
];
// Informations du créateur : en couverture de chaque document et en pied de chaque page.
const AUTEUR = { nom: "Dominique N'Guessan", tel: '05 05 05 45 63', mail: 'dominiquenguessan414@gmail.com' };
const css = `
@page { size: A4; margin: 31mm 14mm 18mm; }
body { font: 10.5pt/1.5 "Poppins","Segoe UI",Helvetica,Arial,sans-serif; color: #26332b; }
h1 { color: #2f5d46; font-size: 22pt; border-bottom: 3px solid #b6cf8e; padding-bottom: 6px; }
h2 { color: #2f5d46; font-size: 15pt; margin-top: 22px; break-after: avoid; }
h3 { color: #3d6b52; font-size: 12pt; break-after: avoid; }
img { max-width: 100%; border: 1px solid #d8dccf; border-radius: 6px; display: block; margin: 8px auto 2px; break-inside: avoid; }
p > em { display: block; text-align: center; color: #6a766d; font-size: 9pt; margin-bottom: 12px; }
table.phones { border: 0; table-layout: fixed; } table.phones td { border: 0; text-align: center; padding: 4px; } table.phones img { border-radius: 14px; margin: 0 auto; } table.phones em { display: block; font-size: 8pt; color: #6a766d; margin-top: 2px; }
table { border-collapse: collapse; width: 100%; font-size: 8.5pt; margin: 8px 0 16px; }
th { background: #2f5d46; color: #fff; text-align: left; }
th, td { border: 1px solid #cfd5c8; padding: 4px 6px; vertical-align: top; }
tr { break-inside: avoid; }
code { font-size: 8.5pt; background: #f1f3ec; padding: 0 3px; border-radius: 3px; }
blockquote { border-left: 4px solid #b6cf8e; margin-left: 0; padding-left: 12px; color: #55625a; }
.cover { text-align: center; padding: 45mm 0 0; break-after: page; }
.cover .logo { font-size: 40pt; font-weight: 700; color: #2f5d46; } .cover .logo span { color: #8fb15a; }
.cover .coverlogo { width: 110mm; border: 0; margin: 0 auto 14mm; }
.cover p { color: #55625a; font-size: 13pt; }
.cover .auteur { margin: 22mm auto 0; display: inline-block; text-align: left; border-left: 4px solid #b6cf8e; padding: 2px 0 2px 14px; }
.cover .auteur p { margin: 2px 0; font-size: 11.5pt; color: #26332b; } .cover .auteur strong { color: #2f5d46; }
`;
const b64 = (f) => 'data:image/png;base64,' + fs.readFileSync(path.join(dir, 'brand', f)).toString('base64');
const logo = b64('logo-nom.png'), logoFull = b64('logo-horizontal.png');
const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [file, title, heading, landscape] of DOCS) {
  const body = execFileSync('pandoc', ['-f', 'gfm', '-t', 'html5', path.join(dir, file)], { cwd: dir, maxBuffer: 1 << 28 }).toString();
  const date = new Date().toISOString().slice(0, 10);
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${title}</title><base href="file://${dir}/"><style>${css}${landscape ? '@page { size: A4 landscape; }' : ''}</style></head><body>
<div class="cover"><img class="coverlogo" src="${logoFull}"><h1 style="border:0">${heading}</h1><p>La traçabilité agricole, de la parcelle au marché.</p><p>Version du ${date}</p><div class="auteur"><p><strong>Créateur :</strong> ${AUTEUR.nom}</p><p><strong>Téléphone :</strong> ${AUTEUR.tel}</p><p><strong>E-mail :</strong> ${AUTEUR.mail}</p></div></div>${body}</body></html>`;
  const tmp = path.join(out, '_tmp.html'); fs.writeFileSync(tmp, html);
  const page = await browser.newPage();
  await page.goto('file://' + tmp); await page.waitForLoadState('load');
  const name = file.replace(/\.md$/, '').split('_').map((w) => w[0] + w.slice(1).toLowerCase()).join('_');
  await page.pdf({ path: path.join(out, `AgriTrace_${name}.pdf`), format: 'A4', landscape, printBackground: true, displayHeaderFooter: true,
    margin: { top: '30mm', bottom: '18mm', left: '14mm', right: '14mm' },
    headerTemplate: `<div style="width:100%;padding:0 14mm;box-sizing:border-box;display:flex;align-items:center;gap:10px;border-bottom:1px solid #c9d6b8;padding-bottom:4px;font-family:Helvetica,Arial,sans-serif"><img src="${logo}" style="height:13mm"><span style="font-size:10px;color:#0B5E3B;font-style:italic;flex:1">La traçabilité agricole, de la parcelle au marché.</span><span style="font-size:8px;color:#55625a">${heading}</span></div>`,
    footerTemplate: `<div style="font-size:8px;width:100%;text-align:center;color:#777;font-family:Helvetica,Arial,sans-serif">AgriTrace — Créateur : ${AUTEUR.nom} · Tél. ${AUTEUR.tel} · ${AUTEUR.mail} — page <span class="pageNumber"></span> / <span class="totalPages"></span></div>` });
  await page.close(); fs.unlinkSync(tmp); console.log('  ✓', file);
}
await browser.close();
