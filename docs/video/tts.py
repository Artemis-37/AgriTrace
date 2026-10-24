# Synthèse vocale (Piper, voix française « siwis ») : un fichier .wav par scène dans build/audio + durées dans build/durations.json.
import os as _o
SUF = _o.environ.get('VID', '')  # VID=-terrain : second film
import json, os, re, subprocess, sys, wave
HERE = os.path.dirname(os.path.abspath(__file__))
VOICE = os.environ.get('PIPER_VOICE', '/tmp/video/voices/fr_FR-siwis-medium.onnx')
OUT = os.path.join(HERE, 'build'+SUF, 'audio'); os.makedirs(OUT, exist_ok=True)
PRON = [('AgriTrace', 'Agri Trace'), ('PostgreSQL', 'Post-gresse-Q-L'), ('GeoJSON', 'Géo-Jeï-sonne'), ('Shapefile', 'Chèpe-faïle'), ('GeoPackage', 'Géo-Pakèdje'), ('Excel', 'Èxel'), ('Android', 'Androïde'), ('Wi-Fi', 'Ouifi'), ('APK', 'A P K'), ('RLS', 'R L S')]
scenes = json.load(open(os.path.join(HERE, 'scenario'+SUF+'.json')))
durs = {}
only = set(sys.argv[1:])
for s in scenes:
    wav = os.path.join(OUT, s['id'] + '.wav')
    if not only or s['id'] in only or not os.path.exists(wav):
        txt = s['narration']
        for a, b in PRON: txt = txt.replace(a, b)
        subprocess.run([sys.executable, '-m', 'piper', '-m', VOICE, '-f', wav, '--length-scale', '1.05', '--sentence-silence', '0.35'], input=txt.encode(), check=True, stderr=subprocess.DEVNULL)
    with wave.open(wav) as w: durs[s['id']] = round(w.getnframes() / w.getframerate(), 2)
json.dump(durs, open(os.path.join(HERE, 'build'+SUF, 'durations.json'), 'w'), indent=1)
print(round(sum(durs.values()) / 60, 1), 'minutes de narration')
