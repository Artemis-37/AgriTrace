# Images fixes de la vidéo : cartes (titre, architecture, profils, flux, listes), planches de téléphones, portail + téléphone.
import json, os
from PIL import Image, ImageDraw, ImageFont, ImageFilter
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'build', 'img'); os.makedirs(OUT, exist_ok=True)
FD = '/usr/share/fonts/truetype/google-fonts/'
def font(sz, w='Regular'): return ImageFont.truetype(FD + f'Poppins-{w}.ttf', sz)
GREEN, DARK, LIGHT, LIME, SAND, INK = (47, 93, 70), (34, 61, 48), (247, 250, 242), (183, 208, 138), (238, 233, 221), (40, 52, 46)
W, H = 1920, 1080
LOGO = Image.open(os.path.join(HERE, '..', 'brand', 'logo-horizontal.png')).convert('RGB')

def base(bg=DARK):
    im = Image.new('RGB', (W, H), bg); d = ImageDraw.Draw(im)
    for i in range(0, H, 3):  # léger dégradé vertical
        k = i / H; d.line([(0, i), (W, i)], fill=tuple(int(bg[c] + (GREEN[c] - bg[c]) * 0.35 * k) for c in range(3)), width=3)
    return im, ImageDraw.Draw(im)

def logo_panel(im, x, y, scale=1.0):
    lg = LOGO.resize((int(LOGO.width * scale), int(LOGO.height * scale)), Image.LANCZOS)
    pad = 18; p = Image.new('RGB', (lg.width + 2 * pad, lg.height + 2 * pad), (255, 255, 255))
    m = Image.new('L', p.size, 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, p.width, p.height], 22, fill=255)
    p.paste(lg, (pad, pad)); im.paste(p, (x, y), m)

def center(d, text, y, f, fill, w=W):
    tw = d.textlength(text, font=f); d.text(((w - tw) / 2, y), text, font=f, fill=fill)

def wrap(d, text, f, maxw):
    out, line = [], ''
    for word in text.split():
        t = (line + ' ' + word).strip()
        if d.textlength(t, font=f) <= maxw: line = t
        else: out.append(line); line = word
    if line: out.append(line)
    return out

def rbox(d, xy, fill, r=26, outline=None, width=3): d.rounded_rectangle(xy, r, fill=fill, outline=outline, width=width)

def title_card(s):
    im, d = base(); logo_panel(im, int((W - 419 * 1.3 - 36) // 2), 150, 1.3)
    center(d, s['title'], 400, font(120, 'Bold'), LIGHT)
    center(d, s['subtitle'], 560, font(40, 'Medium'), LIME)
    if s.get('note'): center(d, s['note'], 700, font(32), (200, 214, 196))
    return im

def arch_card(s):
    im, d = base(); center(d, 'Quatre briques, une seule plateforme', 70, font(58, 'Bold'), LIGHT)
    items = [('Serveur', 'API NestJS\nPostgreSQL 16\nisolation par coopérative (RLS)\njournal d\'audit', LIME), ('Portail web', 'React\ntravail de bureau\nrapports · finances · équipe', (160, 200, 230)),
             ('Application Android', 'Flutter\nhors connexion\ncollecteurs · coachs · agents', (240, 200, 140)), ('Application Windows', 'Electron\nserveur local ou poste client\nsauvegarde · mises à jour', (230, 170, 170))]
    bw, gap, y0 = 410, 40, 260; x0 = (W - (4 * bw + 3 * gap)) // 2
    for i, (t, body, col) in enumerate(items):
        x = x0 + i * (bw + gap); rbox(d, [x, y0, x + bw, y0 + 520], LIGHT, 30); rbox(d, [x, y0, x + bw, y0 + 110], col, 30); d.rectangle([x, y0 + 70, x + bw, y0 + 110], fill=col)
        tw = d.textlength(t, font=font(33, 'Bold')); d.text((x + (bw - tw) / 2, y0 + 32), t, font=font(33, 'Bold'), fill=INK)
        yy = y0 + 150
        for ln in body.split('\n'):
            for k, l2 in enumerate(wrap(d, ln, font(29), bw - 80)):
                if k == 0: d.text((x + 28, yy), '•', font=font(29), fill=GREEN)
                d.text((x + 56, yy), l2, font=font(29), fill=INK); yy += 42
            yy += 10
    rbox(d, [x0, 840, W - x0, 960], (60, 108, 85), 26)
    center(d, 'Synchronisation sans doublon : chaque opération porte une clé unique', 878, font(38, 'Medium'), LIGHT)
    return im

def flow_card(s):
    im, d = base(); center(d, s['title'], 70, font(58, 'Bold'), LIGHT)
    n = len(s['nodes']); bw = 300; gap = (W - 160 - n * bw) // (n - 1); y0 = 330
    for i, t in enumerate(s['nodes']):
        x = 80 + i * (bw + gap); rbox(d, [x, y0, x + bw, y0 + 300], LIGHT, 30)
        a, b = (t.split('\n') + [''])[:2]
        d.ellipse([x + bw // 2 - 34, y0 - 34, x + bw // 2 + 34, y0 + 34], fill=GREEN, outline=LIME, width=4)
        tw = d.textlength(str(i + 1), font=font(36, 'Bold')); d.text((x + bw // 2 - tw / 2, y0 - 28), str(i + 1), font=font(36, 'Bold'), fill=LIGHT)
        tw = d.textlength(a, font=font(38, 'Bold')); d.text((x + (bw - tw) / 2, y0 + 60), a, font=font(38, 'Bold'), fill=GREEN)
        yy = y0 + 140
        for l2 in wrap(d, b, font(30), bw - 40): tw = d.textlength(l2, font=font(30)); d.text((x + (bw - tw) / 2, yy), l2, font=font(30), fill=INK); yy += 46
        if i < n - 1:
            ax = x + bw + 8; ay = y0 + 150; d.line([(ax, ay), (ax + gap - 16, ay)], fill=LIME, width=8); d.polygon([(ax + gap - 16, ay - 18), (ax + gap + 2, ay), (ax + gap - 16, ay + 18)], fill=LIME)
    for k, l2 in enumerate(wrap(d, s['foot'], font(34, 'Medium'), W - 240)): center(d, l2, 760 + k * 52, font(34, 'Medium'), (214, 226, 208))
    return im

def bullets_card(s):
    im, d = base(); center(d, s['title'], 80, font(64, 'Bold'), LIGHT)
    y = 230; st = min(118, 700 // len(s['items'])); bh = st - 20
    for it in s['items']:
        rbox(d, [200, y, W - 200, y + bh], LIGHT, 24); d.ellipse([232, y + bh // 2 - 20, 272, y + bh // 2 + 20], fill=GREEN)
        d.text((310, y + bh // 2 - 24), it.replace('A P I', 'API').replace('U S B', 'USB'), font=font(36, 'Medium'), fill=INK); y += st
    return im

def profils_card(s):
    im, d = base(); center(d, 'Qui utilise quoi', 60, font(58, 'Bold'), LIGHT)
    cols = [('Portail web / Windows', LIME, ['Administrateur de coopérative', 'Magasinier · Caissier · Comptable', 'Direction · Responsable financier', 'Responsables : traçabilité, cartographie,', '   magasin, qualité, logistique', 'Cartographe · Auditeur (lecture)', 'ADG : missions, modules, conformité', 'Acheteur et Exportateur (partenaires)']),
            ('Téléphone Android uniquement', (240, 200, 140), ['Collecteur : achats, convois, stock', 'Agent de terrain : producteurs, missions', 'Coach : producteurs par section, missions,', '   relevés, modules de formation'])]
    bx = [140, 1000]; bw = 780
    for (t, col, items), x in zip(cols, bx):
        rbox(d, [x, 190, x + bw, 940], LIGHT, 30); rbox(d, [x, 190, x + bw, 280], col, 30); d.rectangle([x, 240, x + bw, 280], fill=col)
        d.text((x + 36, 208), t, font=font(38, 'Bold'), fill=INK); y = 320
        for it in items: d.text((x + 40, y), it if it.startswith('   ') else '• ' + it, font=font(31), fill=INK); y += 56
    return im

def phone_img(path, h):
    im = Image.open(path).convert('RGB'); w = int(im.width * h / im.height); im = im.resize((w, h), Image.LANCZOS)
    pad = 12; fr = Image.new('RGB', (w + 2 * pad, h + 2 * pad), (20, 28, 24)); m = Image.new('L', fr.size, 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, fr.width, fr.height], 38, fill=255)
    inner = Image.new('L', im.size, 0); ImageDraw.Draw(inner).rounded_rectangle([0, 0, im.width, im.height], 30, fill=255); fr.paste(im, (pad, pad), inner); return fr, m

def shadow(im, fr, m, x, y):
    sh = Image.new('RGBA', (fr.width + 80, fr.height + 80), (0, 0, 0, 0)); ImageDraw.Draw(sh).rounded_rectangle([40, 50, 40 + fr.width, 50 + fr.height], 40, fill=(0, 0, 0, 120))
    sh = sh.filter(ImageFilter.GaussianBlur(18)); im.paste(sh, (x - 40, y - 40), sh); im.paste(fr, (x, y), m)

def phones_img(s):
    im, d = base(); n = len(s['images']); h = 700 if n >= 4 else 760; top = 80
    frames = [phone_img(p, h) for p in s['images']]; tot = sum(f.width for f, _ in frames) + (n - 1) * 70; x = (W - tot) // 2
    caps = s.get('captions') or []
    for i, (fr, m) in enumerate(frames):
        shadow(im, fr, m, x, top)
        if i < len(caps) and caps[i]: tw = d.textlength(caps[i], font=font(30, 'Medium')); d.text((x + (fr.width - tw) / 2, top + fr.height + 28), caps[i], font=font(30, 'Medium'), fill=LIGHT)
        x += fr.width + 70
    return im

def mix_img(s):
    im, d = base(); sc = Image.open(s['left']).convert('RGB'); sc = sc.resize((1180, int(sc.height * 1180 / sc.width)), Image.LANCZOS)
    m = Image.new('L', sc.size, 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, sc.width, sc.height], 20, fill=255)
    shadow(im, sc, m, 100, (H - sc.height) // 2 - 40)
    fr, mm = phone_img(s['phones'][0], 800); shadow(im, fr, mm, 1380, 80)
    return im

KINDS = {'title': title_card, 'arch': arch_card, 'flow': flow_card, 'bullets': bullets_card, 'profils': profils_card}
for sc in json.load(open(os.path.join(HERE, 'scenario.json'))):
    v = sc['visual']
    if v['type'] == 'card': im = KINDS[v['kind']](v)
    elif v['type'] == 'phones': v = {**v, 'images': [os.path.join(HERE, p) for p in v['images']]}; im = phones_img(v)
    elif v['type'] == 'mix': v = {**v, 'left': os.path.join(HERE, v['left']), 'phones': [os.path.join(HERE, p) for p in v['phones']]}; im = mix_img(v)
    else: continue
    im.save(os.path.join(OUT, sc['id'] + '.png')); print('✓', sc['id'])
