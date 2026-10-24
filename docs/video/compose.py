# Montage : une séquence par scène (image fixe ou enregistrement du portail + narration + sous-titres), puis assemblage.
# Usage : python3 compose.py [id ...]   → build/scenes/<id>.mp4, puis out/AgriTrace_Presentation.mp4 et .srt
import os as _o
SUF = _o.environ.get('VID', '')  # VID=-terrain : second film
import json, os, re, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
B = os.path.join(HERE, 'build'+SUF); SC = os.path.join(B, 'scenes'); OUT = os.path.join(HERE, 'out')
for d in (SC, OUT): os.makedirs(d, exist_ok=True)
scenes = json.load(open(os.path.join(HERE, 'scenario'+SUF+'.json')))
durs = json.load(open(os.path.join(B, 'durations.json')))
only = set(sys.argv[1:])
PAD = 0.9

def ts(t):
    t = max(0, t); h = int(t // 3600); m = int(t % 3600 // 60); s = t % 60
    return f'{h}:{m:02d}:{s:05.2f}'

def cues(text, dur):
    """Découpe la narration en sous-titres de ~100 caractères, répartis proportionnellement à leur longueur."""
    parts = re.split(r'(?<=[.!?:;])\s+', text.strip()); chunks = []; cur = ''
    for p in parts:
        if cur and len(cur) + len(p) + 1 > 105: chunks.append(cur); cur = p
        else: cur = (cur + ' ' + p).strip()
    if cur: chunks.append(cur)
    tot = sum(len(c) for c in chunks); t = 0.15; out = []
    for c in chunks:
        d = (dur - 0.3) * len(c) / tot; out.append((t, t + d, c)); t += d
    return out

def ass(sc, dur, path):
    clean = lambda s: s.replace('A P I', 'API').replace('U S B', 'USB').replace('A D G', 'ADG').replace('C C C', 'CCC').replace('G P S', 'GPS').replace('C S V', 'CSV').replace('K M L', 'KML').replace('K M Z', 'KMZ').replace('A P K', 'APK')
    clean = lambda s, c=clean: c(s).replace('S C zéro zéro zéro zéro zéro zéro, 2026, S Y L, 1', 'SC000000-2026-SYL-1')
    hdr = """[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Sub,Poppins,32,&H00FFFFFF,&H00FFFFFF,&HB0000000,&HB0000000,0,0,0,0,100,100,0,0,3,12,0,2,170,170,26,1
Style: Tag,Poppins,28,&H00FFFFFF,&H00FFFFFF,&HC0463D22,&HC0463D22,-1,0,0,0,100,100,0,0,3,10,0,7,40,40,14,1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
"""
    ev = [f'Dialogue: 0,{ts(a)},{ts(b)},Sub,,0,0,0,,{clean(c)}' for a, b, c in cues(sc['narration'], dur)]
    if not (sc['visual']['type'] == 'card'):
        ev.append(f'Dialogue: 1,{ts(0.3)},{ts(dur - 0.3)},Tag,,0,0,0,,AgriTrace · {clean(sc["title"])}')
    open(path, 'w').write(hdr + '\n'.join(ev) + '\n')
    return [(a, b, clean(c)) for a, b, c in cues(sc['narration'], dur)]

def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode: print(' '.join(cmd)[:300]); print(r.stderr[-1500:]); sys.exit(1)

def build(sc):
    sid = sc['id']; dur = durs[sid] + PAD + (0.6 if sid in ('intro', 'fin') else 0); wav = os.path.join(B, 'audio', sid + '.wav')
    a_path = os.path.join(SC, sid + '.ass'); cue_list = ass(sc, dur, a_path)
    out = os.path.join(SC, sid + '.mp4'); v = sc['visual']; fade = f'fade=t=in:st=0:d=0.4,fade=t=out:st={dur - 0.4:.2f}:d=0.4'
    sub = f"subtitles={a_path}:fontsdir=/usr/share/fonts/truetype/google-fonts"
    if v['type'] == 'live':
        meta = json.load(open(os.path.join(B, 'live', sid + '.json')))
        vf = f"[0:v]scale=1684:1000:flags=lanczos,tpad=stop_mode=clone:stop_duration=6,trim=duration={dur:.2f},setpts=PTS-STARTPTS[a];color=c=0x223d30:s=1920x1080:r=25:d={dur:.2f}[bg];[bg][a]overlay=118:60:shortest=1,{sub},{fade}[v]"
        inp = ['-ss', f"{meta['offset']:.2f}", '-i', meta['file']]
    else:
        img = os.path.join(B, 'img', sid + '.png'); frames = int(dur * 25) + 1
        vf = f"[0:v]scale=3840:2160,zoompan=z='1+0.045*on/{frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s=1920x1080:fps=25,{sub},{fade}[v]"
        inp = ['-loop', '1', '-framerate', '25', '-i', img]
    run(['ffmpeg', '-v', 'error', '-y', *inp, '-i', wav, '-filter_complex', vf, '-map', '[v]', '-map', '1:a', '-af', f'apad,atrim=duration={dur:.2f},afade=t=in:d=0.2,afade=t=out:st={dur - 0.4:.2f}:d=0.4,aresample=48000',
         '-ac', '2', '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p', '-r', '25', '-c:a', 'aac', '-b:a', '160k', '-t', f'{dur:.2f}', out])
    print('✓', sid, f'{dur:.0f} s'); return dur, cue_list

total = 0; srt = []; idx = 1
for sc in scenes:
    if not only or sc['id'] in only or not os.path.exists(os.path.join(SC, sc['id'] + '.mp4')):
        dur, cl = build(sc)
    else:
        dur = durs[sc['id']] + PAD + (0.6 if sc['id'] in ('intro', 'fin') else 0); cl = ass(sc, dur, os.path.join(SC, sc['id'] + '.ass'))
    for a, b, c in cl:
        f = lambda t: ts(total + t).replace('.', ',') if False else (lambda x: f'{int(x // 3600):02d}:{int(x % 3600 // 60):02d}:{int(x % 60):02d},{int(round((x % 1) * 1000)):03d}')(total + t)
        srt.append(f'{idx}\n{f(a)} --> {f(b)}\n{c}\n'); idx += 1
    total += dur
open(os.path.join(OUT, f'AgriTrace_Presentation{SUF}.srt'), 'w').write('\n'.join(srt))
lst = os.path.join(B, 'concat.txt'); open(lst, 'w').write(''.join(f"file '{os.path.join(SC, s['id'] + '.mp4')}'\n" for s in scenes))
run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', '-movflags', '+faststart', os.path.join(OUT, f'AgriTrace_Presentation{SUF}.mp4')])
print(f'Vidéo : {total / 60:.1f} minutes')
