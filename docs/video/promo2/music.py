import numpy as np, wave
sr=44100; D=400; t=np.arange(int(sr*D))/sr
def note(f,start,dur,amp=.2,kind='pad'):
    n=int(dur*sr); x=np.arange(n)/sr; out=np.zeros(len(t))
    if kind=='pad': env=np.minimum(1,x/1.5)*np.minimum(1,(dur-x)/2.0); w=(np.sin(2*np.pi*f*x)+.5*np.sin(2*np.pi*f*2.003*x)+.25*np.sin(2*np.pi*f*.998*x))/1.75
    else: env=np.exp(-x*3.2)*np.minimum(1,x/.01); w=np.sin(2*np.pi*f*x)+.3*np.sin(2*np.pi*f*2*x)
    s=int(start*sr); e=min(len(t),s+n); out[s:e]=(w*env*amp)[:e-s]; return out
hz=lambda m:440*2**((m-69)/12)
chords=[(57,60,64),(53,57,60),(48,52,55),(55,59,62)]  # Am F C G
y=np.zeros(len(t)); bar=4.0
for b in range(int(D/bar)):
    ch=chords[b%4]
    for m in ch: y+=note(hz(m),b*bar,bar+1.2,.075)
    y+=note(hz(ch[0]-12),b*bar,bar+1,.1)
    for q in range(8):
        m=ch[[0,1,2,1,2,1,2,1][q]]+12
        y+=note(hz(m),b*bar+q*bar/8,1.4,.045,'pluck')
y*=np.minimum(1,t/3)*np.minimum(1,(D-t)/4)
y=y/np.abs(y).max()*.55
w=wave.open('music.wav','wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes((y*32767).astype('<i2').tobytes()); w.close()
