import json, os, subprocess
H='/tmp/promo2'; tl=json.load(open(H+'/timeline.json')); TOTAL=tl[-1]['end']
live=[(s,json.load(open(f"{H}/live/{s['id']}.json"))) for s in tl if s['kind']=='live' and os.path.exists(f"{H}/live/{s['id']}.json")]
cmd=['ffmpeg','-y','-v','error','-framerate','30','-i',H+'/frames/%05d.jpg','-loop','1','-i',H+'/mask.png']
for s,r in live: cmd+=['-i',r['file']]
cmd+=['-i',H+'/music.wav','-i',H+'/voix.wav']
n=len(live); fc=[f'[1:v]format=gray,split={n}'+''.join(f'[mk{i}]' for i in range(n))]
for i,(s,r) in enumerate(live):
    rec=r['dur']; st=s['start']+0.8
    fc.append(f"[{i+2}:v]trim=start={r['offset']:.3f}:duration={rec:.3f},setpts=PTS-STARTPTS,fps=30,scale=760:453,format=yuva420p[c{i}];[c{i}][mk{i}]alphamerge,fade=t=in:st=0:d=0.4:alpha=1,fade=t=out:st={rec-0.4:.3f}:d=0.4:alpha=1,setpts=PTS+{st:.3f}/TB[v{i}]")
prev='0:v'
for i,(s,r) in enumerate(live):
    a=s['start']+0.8; b=a+r['dur']; nxt=f'o{i}'
    fc.append(f"[{prev}][v{i}]overlay=490:133:enable='between(t,{a:.3f},{b:.3f})':eof_action=pass[{nxt}]"); prev=nxt
am=n+2
fc.append(f"[{am}:a]volume=0.20,afade=t=out:st={TOTAL-3:.2f}:d=3[mu];[{am+1}:a]volume=1.25[vo];[mu][vo]amix=inputs=2:duration=longest:normalize=0[aud]")
cmd+=['-filter_complex',';'.join(fc),'-map',f'[{prev}]','-map','[aud]','-c:v','libx264','-crf','20','-pix_fmt','yuv420p','-preset','medium','-c:a','aac','-b:a','160k','-t',f'{TOTAL:.2f}','-movflags','+faststart',H+'/out_film.mp4']
print(len(live),'scènes live'); subprocess.run(cmd,check=True); print('OK')
