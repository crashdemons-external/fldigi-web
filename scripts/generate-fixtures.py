"""Generate independent, known-message radio audio for decoder verification."""
from pathlib import Path
import array
import math
import re
import wave

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'tests/fixtures'
RATE = 8000
MESSAGE = 'CQ CQ DE WEBTEST 12345\n'


def save(name, samples):
    DEST.mkdir(parents=True, exist_ok=True)
    with wave.open(str(DEST / name), 'wb') as out:
        out.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
        pcm = array.array('h', [int(max(-1, min(1, s)) * 32767) for s in samples])
        out.writeframes(pcm.tobytes())


def main():
    source = (ROOT / 'vendor/fldigi/src/psk/pskvaricode.cxx').read_text()
    codes = re.findall(r'"([01]+)"', source.split('varicodetab1[] = {')[1].split('};')[0])
    bits = '0' * 64 + ''.join(codes[ord(c)] + '00' for c in MESSAGE * 2) + '0' * 64
    pcm = []; sign = 1; n = 0
    for bit in bits:
        end = sign if bit == '1' else -sign
        for i in range(256):
            envelope = sign if bit == '1' else sign * math.cos(math.pi * i / 256)
            pcm.append(0.65 * envelope * math.cos(2 * math.pi * 1500 * n / RATE)); n += 1
        sign = end
    save('bpsk31.wav', pcm)
    letters = '\0E\nA SIU\rDRJNFCKTZLWHYPQOBG MXV '
    figures = '\0' + '3\n- ' + '\a87\r$4\',!:(5\")2#6019?& ./; '
    state = 'letters'; symbols = []
    for c in (MESSAGE * 2):
        table = letters if state == 'letters' else figures
        if c not in table:
            state = 'figures' if c in figures else 'letters'; symbols.append(27 if state == 'figures' else 31)
            table = figures if state == 'figures' else letters
        symbols.append(table.index(c))
    pcm = []; phase = 0
    def tone(bit, seconds):
        nonlocal phase
        f = 1500 + (85 if bit else -85)
        for _ in range(round(seconds * RATE)):
            pcm.append(0.65 * math.cos(phase)); phase = (phase + 2 * math.pi * f / RATE) % (2 * math.pi)
    tone(1, 2)
    for code in [31] * 4 + symbols:
        tone(0, 1 / 45.45)
        for i in range(5): tone((code >> i) & 1, 1 / 45.45)
        tone(1, 1.5 / 45.45)
    tone(1, 2)
    save('rtty.wav', pcm)
    morse={char:code for char,code in zip('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',['.-','-...','-.-.','-..','.','..-.','--.','....','..','.---','-.-','.-..','--','-.','---','.--.','--.-','.-.','...','-','..-','...-','.--','-..-','-.--','--..','-----','.----','..---','...--','....-','.....','-....','--...','---..','----.'])}
    pcm=[0.0]*RATE;dot=round(RATE*1.2/18);n=len(pcm)
    for char in (MESSAGE.strip()+' ')*2:
        if char==' ':pcm.extend([0.0]*(4*dot));n+=4*dot;continue
        for element in morse[char]:
            length=dot*(1 if element=='.' else 3)
            for i in range(length):
                edge=min(1,i/16,(length-1-i)/16);pcm.append(.65*edge*math.sin(2*math.pi*1500*n/RATE));n+=1
            pcm.extend([0.0]*dot);n+=dot
        pcm.extend([0.0]*(2*dot));n+=2*dot
    pcm.extend([0.0]*(2*RATE));save('cw.wav',pcm)
    print(f'Generated BPSK31, RTTY, and CW recordings containing {MESSAGE!r}')


if __name__ == '__main__': main()
