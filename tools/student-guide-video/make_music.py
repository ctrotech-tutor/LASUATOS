#!/usr/bin/env python3
"""Builds the soundtrack for the student guide video: a subtle generative music bed
plus UI sound effects, mixed under the narration with sidechain-style ducking.

Everything is synthesized deterministically (fixed seed, pure numpy) so re-runs are
byte-identical. Output: out/mix-full.wav (44.1kHz stereo), exactly TOTAL seconds.

    python3 make_music.py

ffmpeg comes from imageio-ffmpeg, same as render.mjs.
"""

import subprocess
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
OUT = HERE / 'out'
FFMPEG = subprocess.run(
    ['python3', '-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'],
    capture_output=True, text=True, check=True).stdout.strip()

SR = 44100

# Segment ids and lengths: keep in sync with scenes.js (render.mjs reads them from
# the page; duplicating here keeps this script standalone).
SEGMENTS = [
    ('01-welcome', 20.32), ('02-matric', 15.52), ('03-is-this-you', 13.84),
    ('04-code', 16.28), ('05-password', 12.52), ('06-face', 20.00),
    ('07-install', 12.08), ('08-mark', 20.88), ('09-problems', 16.12),
    ('10-record', 21.88),
]
STARTS = []
acc = 0.0
for _id, length in SEGMENTS:
    STARTS.append(acc)
    acc += length
TOTAL = acc

rng = np.random.default_rng(20261110)


def note(name):
    """'A3' -> frequency in Hz."""
    names = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}
    if len(name) == 2:
        n, octv = name[0], int(name[1])
    else:
        n, octv = name[:2], int(name[2])
    midi = names[n] + 12 * (octv + 1)
    return 440.0 * 2 ** ((midi - 69) / 12)


def env_ar(n, attack, release):
    """Linear attack / exponential-ish release envelope of n samples."""
    e = np.ones(n)
    a = max(1, int(attack * SR))
    r = max(1, int(release * SR))
    if a < n:
        e[:a] = np.linspace(0, 1, a)
    if r < n:
        e[-r:] *= np.linspace(1, 0, r) ** 1.6
    return e


def soft_osc(freq, dur, harmonics=((1, 1.0), (2, 0.28), (3, 0.10)), detune=0.0):
    """Mellow tone: a few harmonics so it reads as a pad, not a sine test tone."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for h, amp in harmonics:
        f = freq * h * (1 + detune)
        out += amp * np.sin(2 * np.pi * f * t)
    return out


def place(buf, sig, at, gain=1.0, pan=0.0):
    """Add sig (mono) into stereo buf at time `at` with equal-power pan (-1..1)."""
    start = int(at * SR)
    if start >= buf.shape[0]:
        return
    n = min(sig.shape[0], buf.shape[0] - start)
    if n <= 0:
        return
    lg = np.cos((pan + 1) * np.pi / 4)
    rg = np.sin((pan + 1) * np.pi / 4)
    buf[start:start + n, 0] += sig[:n] * gain * lg
    buf[start:start + n, 1] += sig[:n] * gain * rg


def build_music():
    """The bed: warm pads (Am F C G), soft sub bass, sparse pentatonic plucks,
    a barely-there kick and shaker, and short risers into each segment boundary."""
    music = np.zeros((int((TOTAL + 0.5) * SR), 2))

    bpm = 76.0
    beat = 60.0 / bpm
    bar = 4 * beat
    chords = [  # root, triad
        ('A2', ['A3', 'C4', 'E4']),   # Am
        ('F2', ['F3', 'A3', 'C4']),   # F
        ('C3', ['C4', 'E4', 'G4']),   # C
        ('G2', ['G3', 'B3', 'D4']),   # G
    ]
    chord_len = 2 * bar  # ~6.32 s per chord

    # ---- pads + bass, chord loop across the whole film
    t = 0.0
    ci = 0
    while t < TOTAL + chord_len:
        root, triad = chords[ci % 4]
        dur = chord_len + 0.6  # overlap into the next chord
        # pad: each triad note, detuned pair panned slightly apart
        for i, nm in enumerate(triad):
            f = note(nm)
            tone_l = soft_osc(f, dur, detune=-0.0012)
            tone_r = soft_osc(f, dur, detune=0.0012)
            e = env_ar(len(tone_l), 1.1, 1.5)
            tone_l *= e
            tone_r *= e
            pan = (-0.22, 0.0, 0.22)[i % 3]
            place(music, tone_l, t, gain=0.020, pan=pan - 0.10)
            place(music, tone_r, t, gain=0.020, pan=pan + 0.10)
        # bass: root an octave down, gentle half notes
        f = note(root) / 2
        for hb in range(2):
            bt = t + hb * 2 * beat
            tone = soft_osc(f, 1.7 * beat, harmonics=((1, 1.0), (2, 0.12)))
            tone *= env_ar(len(tone), 0.03, 0.5 * beat)
            place(music, tone, bt, gain=0.052)
        t += chord_len
        ci += 1

    # ---- sparse pluck melody: A minor pentatonic, eighth-note grid, seeded rests
    penta = ['A4', 'C5', 'D5', 'E5', 'G5', 'A5']
    step = beat / 2
    n_steps = int(TOTAL / step)
    last_deg = 0
    for s in range(2, n_steps):  # leave the first bar to the intro riser
        if rng.random() < 0.62:  # rest: keep it airy
            continue
        last_deg = int(np.clip(last_deg + rng.integers(-2, 3), 0, len(penta) - 1))
        f = note(penta[last_deg])
        tone = soft_osc(f, 0.7, harmonics=((1, 1.0), (2, 0.35), (4, 0.06)))
        tone *= env_ar(len(tone), 0.004, 0.55)
        place(music, tone, s * step, gain=0.030, pan=float(rng.uniform(-0.3, 0.3)))

    # ---- percussion: soft kick on 1 & 3, shaker on the offbeats
    for b in range(int(TOTAL / beat) + 1):
        bt = b * beat
        if b % 4 in (0, 2):  # kick
            n = int(0.14 * SR)
            tt = np.arange(n) / SR
            f = 118 * np.exp(-tt / 0.045) + 46
            kick = np.sin(2 * np.pi * np.cumsum(f) / SR)
            kick *= np.exp(-tt / 0.055)
            place(music, kick, bt, gain=0.070)
        else:  # shaker: short bright noise tick
            n = int(0.035 * SR)
            noise = rng.standard_normal(n)
            noise = np.diff(noise, prepend=0)  # crude high-pass
            noise *= np.exp(-np.arange(n) / (0.010 * SR))
            place(music, noise, bt, gain=0.016, pan=0.15)

    # ---- risers into each segment boundary (skip 0)
    for st in STARTS[1:]:
        n = int(0.55 * SR)
        noise = rng.standard_normal(n)
        # slow low-pass sweep: cumulative moving average widening then narrowing
        k = np.ones(24) / 24
        noise = np.convolve(noise, k, mode='same')
        swell = (np.linspace(0, 1, n) ** 2.2) * np.exp(-np.linspace(0, 0.35, n))
        tone = soft_osc(note('A5'), 0.55, harmonics=((1, 1.0),))
        tone *= swell * 0.5
        noise *= swell
        place(music, noise, st - 0.55, gain=0.020)
        place(music, tone, st - 0.55, gain=0.006)

    # ---- intro riser + soft landing chord swell at the outro card
    n = int(1.1 * SR)
    noise = rng.standard_normal(n)
    noise = np.convolve(noise, np.ones(32) / 32, mode='same')
    noise *= np.linspace(0, 1, n) ** 2
    place(music, noise, 0.0, gain=0.018)
    outro = STARTS[9] + 17.55
    for i, nm in enumerate(['A3', 'C4', 'E4', 'A4']):
        tone = soft_osc(note(nm), 2.6, harmonics=((1, 1.0), (2, 0.2)))
        tone *= env_ar(len(tone), 0.5, 1.6)
        place(music, tone, outro + i * 0.07, gain=0.030, pan=(-0.25 + 0.17 * i))

    # global fade in/out so the bed never starts or stops audibly
    fi = int(1.2 * SR)
    fo = int(2.8 * SR)
    music[:fi] *= np.linspace(0, 1, fi)[:, None]
    music[-fo:] *= np.linspace(1, 0, fo)[:, None] ** 1.5
    return music


def build_sfx():
    """UI sounds: tap blips where the ripple lands, chimes for success moments."""
    sfx = np.zeros((int((TOTAL + 0.5) * SR), 2))

    def tap(at):
        n = int(0.07 * SR)
        t = np.arange(n) / SR
        blip = np.sin(2 * np.pi * 1750 * t) + 0.4 * np.sin(2 * np.pi * 2470 * t)
        blip *= np.exp(-t / 0.018)
        place(sfx, blip, at, gain=0.16)

    def chime(at, notes=('E5', 'A5')):
        for i, nm in enumerate(notes):
            tone = soft_osc(note(nm), 0.62, harmonics=((1, 1.0), (2, 0.25), (3, 0.05)))
            tone *= env_ar(len(tone), 0.005, 0.5)
            place(sfx, tone, at + i * 0.11, gain=0.10, pan=0.05 * (-1 if i % 2 else 1))

    # taps: [segment index, local time of the ripple]
    taps = [(1, 4.60), (2, 6.30), (3, 7.30), (3, 11.90), (4, 10.90),
            (5, 5.35), (5, 7.35), (7, 12.65), (8, 7.30)]
    for seg_i, local in taps:
        tap(STARTS[seg_i] + local)

    # chimes: student found, face saved, marked present
    chime(STARTS[1] + 11.64)                    # "found you" card pops in
    chime(STARTS[5] + 16.70, ('D5', 'G5'))      # face done
    chime(STARTS[7] + 14.05, ('C5', 'E5', 'G5'))  # marked present
    return sfx


def decode(path):
    """mp3 -> mono float32 numpy via ffmpeg."""
    raw = subprocess.run(
        [FFMPEG, '-v', 'error', '-i', str(path), '-f', 'f32le', '-ac', '1', '-ar', str(SR), '-'],
        capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


def build_narration():
    n = int((TOTAL + 0.5) * SR)
    voice = np.zeros(n)
    for (seg_id, _len), st in zip(SEGMENTS, STARTS):
        pcm = decode(HERE / 'audio' / f'{seg_id}.mp3')
        at = int(st * SR)
        end = min(n, at + len(pcm))
        voice[at:end] += pcm[:end - at]
    return voice


def duck_gain(voice):
    """0..1 gain for the music: follows the voice envelope, dips to 0.35 while
    speech is present, recovers smoothly when it pauses."""
    win = int(0.025 * SR)
    env = np.abs(voice)
    k = int(0.010 * SR)
    env = np.convolve(env, np.ones(k) / k, mode='same')
    # normalise: speech envelope sits around 0.05-0.25 for this narration
    lvl = np.clip(env / 0.16, 0, 1)
    # attack fast, release slow
    out = np.empty_like(lvl)
    prev = 0.0
    a_att = np.exp(-1 / (0.060 * SR))
    a_rel = np.exp(-1 / (0.700 * SR))
    for i in range(len(lvl)):
        x = lvl[i]
        prev = x + (prev - x) * (a_att if x > prev else a_rel)
        out[i] = prev
    return 1.0 - 0.65 * np.clip(out * 1.15, 0, 1)


def soft_clip(x):
    return np.tanh(x * 1.05) / np.tanh(1.0) * 0.985


def main():
    OUT.mkdir(exist_ok=True)
    print('music...')
    music = build_music()
    print('sfx...')
    sfx = build_sfx()
    print('narration...')
    voice = build_narration()

    print('mixing with ducking...')
    g = duck_gain(voice)
    bed = (music * 1.5 + sfx) * g[:, None]  # ~+3.5 dB on the music so it reads under speech
    # extra duck headroom: narration clearly on top
    mix = bed + np.stack([voice, voice], axis=1) * 0.98
    mix = soft_clip(mix * 1.02)

    peak = float(np.abs(mix).max())
    mix *= 0.94 / max(peak, 1e-9)

    pcm = (mix * 32767).astype(np.int16)
    out = OUT / 'mix-full.wav'
    import wave
    with wave.open(str(out), 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print('wrote', out, f'({TOTAL:.2f}s, peak {np.abs(mix).max():.3f})')

    # quick sanity numbers: bed loudness alone vs under narration
    bed_rms = float(np.sqrt((bed ** 2).mean()))
    voice_rms = float(np.sqrt((voice ** 2).mean()))
    print(f'bed RMS {20 * np.log10(bed_rms + 1e-12):.1f} dBFS, voice RMS {20 * np.log10(voice_rms + 1e-12):.1f} dBFS')


if __name__ == '__main__':
    main()
