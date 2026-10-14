"""Builds the viewer's sound bank from the raw recordings.

    python -I sfx/build.py "<Raw Master Tracks dir>" "<Essentials_Series dir>"

Reads the 192 kHz gun recordings and the NOX Essentials pack, cuts every sound
down to its useful part (gunshots come with 10-35 s of barely audible room
echo; it is trimmed to where the tail actually dies and faded), then gives
everything the same lo-fi treatment: 16 kHz, band-limited, a little tape
saturation and a bit crush. Explosions, whistles and debris do not exist in
the packs, so they are synthesised (a real gunshot pitched far down supplies
the body of each blast). Everything is packed into one raw Int16 bank plus an
index, written to viewer/audio/.
"""
import glob
import json
import math
import os
import sys
from fractions import Fraction
from math import gcd

import numpy as np
import scipy.io.wavfile as wf
import scipy.signal as sg

SR = 16000
RNG = np.random.default_rng(1944)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "viewer", "audio")


# ---------- loading and shaping ----------

def load(path):
    rate, d = wf.read(path)
    if d.dtype == np.int32:
        x = d.astype(np.float64) / 2147483648.0
    elif d.dtype == np.int16:
        x = d.astype(np.float64) / 32768.0
    elif d.dtype == np.uint8:
        x = (d.astype(np.float64) - 128) / 128.0
    else:
        x = d.astype(np.float64)
    if x.ndim > 1:
        x = x.mean(axis=1)
    g = gcd(SR, rate)
    return sg.resample_poly(x, SR // g, rate // g)


def varispeed(x, ratio):
    """Plays the sound `ratio` times as fast (pitch and length both change)."""
    f = Fraction(ratio).limit_denominator(100)
    return sg.resample_poly(x, f.denominator, f.numerator)


def smooth_env(x, ms):
    n = max(1, int(SR * ms / 1000))
    return np.sqrt(np.convolve(x * x, np.ones(n) / n, mode="same"))


def fade_out(x, ms):
    n = min(len(x), int(SR * ms / 1000))
    if n > 0:
        x = x.copy()
        x[-n:] *= np.cos(np.linspace(0, math.pi / 2, n)) ** 2
    return x


def norm(x, peak=0.85):
    m = np.max(np.abs(x))
    return x * (peak / m) if m > 1e-9 else x


def trim_shot(x, max_s, floor_db=-52, min_s=0.38):
    """From the first crack to where the sound has really died, never past max_s, with a fade."""
    env = smooth_env(x, 4)
    gate = env.max() * 0.2
    on = int(np.argmax(env > gate))
    start = max(0, on - int(SR * 0.006))
    seg = x[start:start + int(SR * 8)]
    e = smooth_env(seg, 25)
    local = e[: int(SR * 0.1)].max()
    thr = local * 10 ** (floor_db / 20)
    after = int(SR * 0.08)
    below = np.nonzero(e[after:] < thr)[0]
    end = after + (int(below[0]) if len(below) else len(seg))
    end = int(min(max(end, SR * min_s), SR * max_s, len(seg)))
    seg = seg[:end]
    return fade_out(seg, max(60, int(1000 * len(seg) / SR * 0.4)))


def active(x, max_s, floor_db=-38, gap_ms=140, lead_ms=15):
    """The first stretch of real sound in a handling/foley recording."""
    env = smooth_env(x, 6)
    thr = env.max() * 10 ** (floor_db / 20)
    idx = np.nonzero(env > thr)[0]
    if len(idx) == 0:
        return x[: int(SR * 0.2)]
    start = max(0, idx[0] - int(SR * lead_ms / 1000))
    end = idx[0]
    gap = int(SR * gap_ms / 1000)
    for i in idx:
        if i - end > gap:
            break
        end = i
    end = min(end + int(SR * 0.05), start + int(SR * max_s), len(x))
    return fade_out(x[start:end], 40)


def lofi(x, bits=10, lp=5200, hp=80, drive=1.3, hold=1, noise=0.0):
    sos = sg.butter(2, hp, "highpass", fs=SR, output="sos")
    x = sg.sosfilt(sos, x)
    sos = sg.butter(4, min(lp, SR / 2 - 200), "lowpass", fs=SR, output="sos")
    x = sg.sosfilt(sos, x)
    x = norm(x, 0.9)
    x = np.tanh(x * drive) / math.tanh(drive)
    if hold > 1:  # sample-and-hold: that crunchy aliasing
        x = np.repeat(x[::hold], hold)[: len(x)]
    if noise:
        x = x + RNG.normal(0, noise, len(x))
    q = 2 ** (bits - 1)
    return np.round(np.clip(x, -1, 1) * q) / q


def to_i16(x):
    return np.clip(np.round(x * 32767), -32768, 32767).astype("<i2")


def loopify(x, fade_s=1.5):
    n = int(SR * fade_s)
    a, b = x[:n], x[-n:]
    w = np.linspace(0, 1, n)
    mid = x[n:-n] if len(x) > 2 * n else x[n:]
    # the tail is crossfaded into the head so the end flows straight back to the start
    return np.concatenate([a * w + b * (1 - w), mid])


def punch(x, amt):
    """Bass weight and a chest-thump under the crack: how a close shot hits you."""
    lo = sg.sosfilt(sg.butter(2, 190, "lowpass", fs=SR, output="sos"), x)
    y = x + amt * 0.7 * lo
    n = int(SR * 0.16)
    t = np.arange(n) / SR
    sub = np.sin(2 * math.pi * (46 + 44 * np.exp(-t * 28)) * t) * np.exp(-t / 0.055)
    if len(y) < n:
        y = np.concatenate([y, np.zeros(n - len(y))])
    y[:n] += amt * 0.5 * np.max(np.abs(x)) * sub
    return y


def squash(x, amt=3.0):
    """Heavy compression: lift everything toward the peak, then soft-clip. Fat, loud, dense."""
    env = sg.sosfilt(sg.butter(1, 30, "lowpass", fs=SR, output="sos"), np.abs(x))
    gain = 1.0 / (0.15 + env / (np.max(env) + 1e-9)) ** (1 - 1 / amt)
    return np.tanh(norm(x * gain, 1.0) * 1.8)


# ---------- bank ----------

class Bank:
    def __init__(self):
        self.pcm = []
        self.offset = 0
        self.samples = {}
        self.groups = {}
        self.sources = {}

    def add(self, name, x, src=""):
        x = to_i16(x)
        self.samples[name] = [self.offset, len(x)]
        self.sources[name] = src
        self.pcm.append(x)
        self.offset += len(x)

    def group(self, name, members):
        self.groups.setdefault(name, []).extend(members)

    def save(self):
        os.makedirs(OUT, exist_ok=True)
        data = np.concatenate(self.pcm).tobytes()
        with open(os.path.join(OUT, "bank.bin"), "wb") as f:
            f.write(data)
        with open(os.path.join(OUT, "bank.json"), "w") as f:
            json.dump({"rate": SR, "samples": self.samples, "groups": self.groups}, f, separators=(",", ":"))
        with open(os.path.join(OUT, "sources.json"), "w") as f:
            json.dump(self.sources, f, indent=1)
        print(f"bank: {len(self.samples)} sounds, {len(data) / 1e6:.2f} MB, {self.offset / SR:.0f} s")


# ---------- synthesis ----------

def t_axis(n):
    return np.arange(n) / SR


def brown_sweep(n, f_hi, f_lo):
    """White noise through a one-pole low-pass whose cutoff falls exponentially."""
    w = RNG.normal(0, 1, n)
    fc = f_hi * (f_lo / f_hi) ** (np.arange(n) / n)
    a = 1 - np.exp(-2 * math.pi * fc / SR)
    y = np.empty(n)
    s = 0.0
    for i in range(n):
        s += a[i] * (w[i] - s)
        y[i] = s
    return y / (np.max(np.abs(y)) + 1e-9)


def blast(body, secs, pitch, sub_hz, crack, rumble, taps=()):
    n = int(SR * secs)
    t = t_axis(n)
    env = np.exp(-t / (secs * 0.22))
    noise = brown_sweep(n, 2600, 110) * env
    sub = np.sin(2 * math.pi * sub_hz * np.exp(-t / (secs * 0.9)) * t) * np.exp(-t / (secs * 0.3))
    out = rumble * noise + 0.9 * sub
    c = int(SR * 0.02)
    out[:c] += crack * RNG.normal(0, 1, c) * np.linspace(1, 0, c)
    b = varispeed(body, pitch)[:n]
    out[: len(b)] += 0.9 * b / (np.max(np.abs(b)) + 1e-9)
    for delay, g in taps:  # a couple of dull, quick slap-backs instead of a long echo
        d = int(SR * delay)
        sos = sg.butter(2, 900, "lowpass", fs=SR, output="sos")
        out[d:] += g * sg.sosfilt(sos, out[: n - d])
    return fade_out(norm(out), int(secs * 450))


def whistle(secs=2.2):
    n = int(SR * secs)
    t = t_axis(n)
    f = 2300 * (0.35 ** (t / secs))
    ph = 2 * math.pi * np.cumsum(f) / SR
    tone = np.sin(ph) * 0.5 + 0.2 * np.sin(ph * 2.01)
    hiss = sg.sosfilt(sg.butter(2, [1200, 3500], "bandpass", fs=SR, output="sos"), RNG.normal(0, 1, n))
    env = np.minimum(1, t / 0.25) ** 2 * (0.4 + 0.6 * (t / secs))
    return fade_out(norm((tone + 0.35 * hiss) * env), 80)


def whoosh(secs=0.28):
    n = int(SR * secs)
    t = t_axis(n)
    sos = sg.butter(2, [400, 2400], "bandpass", fs=SR, output="sos")
    return norm(sg.sosfilt(sos, RNG.normal(0, 1, n)) * np.sin(math.pi * t / secs) ** 2)


def whiz(secs=0.22):
    n = int(SR * secs)
    t = t_axis(n)
    f = 3400 * (0.45 ** (t / secs))
    tone = np.sin(2 * math.pi * np.cumsum(f) / SR)
    env = np.sin(math.pi * np.minimum(1, t / secs * 0.9)) ** 1.5
    return norm(tone * env * 0.7 + 0.15 * RNG.normal(0, 1, n) * env)


def thud(secs=0.18, hz=95, bright=0.35):
    n = int(SR * secs)
    t = t_axis(n)
    s = np.sin(2 * math.pi * hz * np.exp(-t * 7) * t) * np.exp(-t / 0.06)
    nz = sg.sosfilt(sg.butter(2, 1800, "lowpass", fs=SR, output="sos"), RNG.normal(0, 1, n)) * np.exp(-t / 0.025)
    return norm(s + bright * nz)


def smoke_pop(secs=0.9):
    n = int(SR * secs)
    t = t_axis(n)
    pop = thud(0.2, 140, 0.6)
    hiss = sg.sosfilt(sg.butter(2, [1500, 6000], "bandpass", fs=SR, output="sos"), RNG.normal(0, 1, n))
    out = 0.5 * hiss * np.minimum(1, t / 0.04) * np.exp(-t / 0.3)
    out[: len(pop)] += pop
    return fade_out(norm(out), 200)


def clatter(n, count, lo, hi, fall=0.0):
    out = np.zeros(n)
    for k in range(count):
        at = int(RNG.uniform(0.0, 0.85) * n)
        ln = int(SR * RNG.uniform(0.02, 0.1))
        if at + ln >= n:
            continue
        burst = RNG.normal(0, 1, ln) * np.exp(-np.arange(ln) / (ln * 0.3))
        sos = sg.butter(2, RNG.uniform(lo, hi), "lowpass", fs=SR, output="sos")
        out[at:at + ln] += sg.sosfilt(sos, burst) * RNG.uniform(0.3, 1) * (1 - fall * at / n)
    return out


def debris(secs=0.6):
    n = int(SR * secs)
    return fade_out(norm(clatter(n, int(RNG.integers(6, 11)), 900, 3200)), 150)


def collapse(secs=3.2):
    n = int(SR * secs)
    t = t_axis(n)
    out = 0.9 * brown_sweep(n, 700, 70) * (np.minimum(1, t / 0.2) * np.exp(-t / 1.1))
    out += 0.7 * clatter(n, 40, 500, 2400, fall=0.8)
    b = thud(0.5, 55, 0.3)
    out[: len(b)] += 1.4 * b
    return fade_out(norm(out), 900)


def bp(lo, hi):
    return sg.butter(2, [lo, hi], "bandpass", fs=SR, output="sos")


def noise_env(n, lo, hi, tau):
    t = t_axis(n)
    return sg.sosfilt(bp(lo, hi), RNG.normal(0, 1, n)) * np.exp(-t / tau)


def sub_thump(n, hz, tau):
    t = t_axis(n)
    return np.tanh(2.2 * np.sin(2 * math.pi * hz * np.exp(-t * 16) * t) * np.exp(-t / tau))


def snap(n, hp=1500, tau=0.004):
    t = t_axis(n)
    return sg.sosfilt(sg.butter(2, hp, "highpass", fs=SR, output="sos"), RNG.normal(0, 1, n)) * np.exp(-t / tau)


def impact_dirt(secs=0.3):
    n = int(SR * secs)
    out = 0.9 * sub_thump(n, RNG.uniform(60, 90), 0.05) + 1.0 * noise_env(n, 150, 2600, 0.04) + 0.6 * snap(n, 2000, 0.004)
    return fade_out(norm(out + 0.3 * clatter(n, 6, 1500, 4500)), 90)


def impact_wood(secs=0.35):
    n = int(SR * secs)
    out = 1.0 * snap(n, 900, 0.006) + 1.1 * noise_env(n, 300, 3200, 0.035) + 0.7 * sub_thump(n, RNG.uniform(110, 150), 0.045)
    res = sg.sosfilt(sg.butter(2, [RNG.uniform(350, 500), RNG.uniform(900, 1300)], "bandpass", fs=SR, output="sos"), RNG.normal(0, 1, n) * np.exp(-t_axis(n) / 0.02))
    return fade_out(norm(out + 0.5 * res + 0.3 * clatter(n, 5, 2000, 5500)), 100)


def impact_stone(secs=0.3):
    n = int(SR * secs)
    out = 1.2 * snap(n, 2200, 0.004) + 0.9 * noise_env(n, 600, 5200, 0.025) + 0.6 * sub_thump(n, RNG.uniform(90, 130), 0.04)
    return fade_out(norm(out + 0.5 * clatter(n, 8, 2500, 6500)), 80)


def impact_flesh(secs=0.22):
    n = int(SR * secs)
    out = 1.0 * sub_thump(n, 70, 0.06) + 0.9 * noise_env(n, 200, 1300, 0.03) + 0.6 * noise_env(n, 1000, 3200, 0.008)
    return fade_out(norm(out), 60)


def impact_water(secs=0.5):
    n = int(SR * secs)
    t = t_axis(n)
    plop = np.sin(2 * math.pi * (300 + 700 * np.exp(-t * 30)) * t) * np.exp(-t / 0.05)
    return fade_out(norm(plop * 0.5 + noise_env(n, 800, 5500, 0.12) + 0.6 * snap(n, 1500, 0.006)), 150)


def ricochet(secs=0.45):
    n = int(SR * secs)
    t = t_axis(n)
    f = RNG.uniform(1800, 2600) * (0.55 ** (t / secs))
    ping = np.sin(2 * math.pi * np.cumsum(f) / SR) * np.exp(-t / 0.12)
    return fade_out(norm(ping * 0.8 + snap(n, 1500, 0.006) * 0.8), 120)


def bullet_crack(secs=0.14):
    """The sonic snap of a round going past: a tiny N-wave, then a bright burst of air."""
    n = int(SR * secs)
    t = t_axis(n)
    nwave = np.zeros(n)
    w = int(SR * RNG.uniform(0.0012, 0.0022))
    nwave[:w] = np.linspace(1, -1.4, w)
    air = sg.sosfilt(sg.butter(2, RNG.uniform(1800, 2600), "highpass", fs=SR, output="sos"), RNG.normal(0, 1, n)) * np.exp(-t / RNG.uniform(0.012, 0.022))
    body = np.sin(2 * math.pi * RNG.uniform(500, 800) * t) * np.exp(-t / 0.012) * 0.4
    return fade_out(norm(nwave * 1.4 + air * 0.8 + body), 40)


def mortar_fire(secs=0.7):
    """The 'bloop' of a round dropped down the tube: a pitch-dropping thump, a pop of gas and a ring from the tube."""
    n = int(SR * secs)
    t = t_axis(n)
    thump = np.sin(2 * math.pi * np.cumsum(190 * np.exp(-t * 9) + 38) / SR) * np.exp(-t / 0.12)
    out = thump + 0.9 * noise_env(n, 400, 3800, 0.03) + 0.25 * np.sin(2 * math.pi * 640 * t) * np.exp(-t / 0.15) + 0.6 * snap(n, 1500, 0.004)
    return fade_out(norm(out), 200)


def clang(secs=0.45):
    """A round glancing off armour: a bright ring of metal and a spark of noise."""
    n = int(SR * secs)
    t = t_axis(n)
    f = RNG.uniform(650, 900)
    ring = np.sin(2 * math.pi * f * t) * np.exp(-t / 0.09) + 0.6 * np.sin(2 * math.pi * f * 2.76 * t) * np.exp(-t / 0.05) + 0.4 * np.sin(2 * math.pi * f * 5.4 * t) * np.exp(-t / 0.03)
    return fade_out(norm(ring + 1.2 * snap(n, 1800, 0.004)), 120)


def engine_rumble(secs=1.2):
    """A diesel or petrol engine at work: a low rumble pulsing at the firing rate, with the clank of tracks over it."""
    n = int(SR * secs)
    t = t_axis(n)
    base = sg.sosfilt(sg.butter(2, 220, "lowpass", fs=SR, output="sos"), RNG.normal(0, 1, n))
    pulse = 0.65 + 0.35 * np.sin(2 * math.pi * 17 * t)
    drone = np.sin(2 * math.pi * 38 * t) * 0.5 + np.sin(2 * math.pi * 76 * t) * 0.25
    tracks = clatter(n, int(secs * 14), 900, 3000) * 0.35
    x = (norm(base) * 0.9 + drone) * pulse + tracks
    # Seamless: the ends fade into one another.
    k = int(SR * 0.12)
    x[:k] = x[:k] * np.linspace(0, 1, k) + x[-k:] * np.linspace(1, 0, k)
    return norm(x[:-k] if False else x)


def rocket_launch(secs=0.9):
    """A rocket leaving the tube: a hiss of propellant that climbs, with a thump at the shoulder."""
    n = int(SR * secs)
    t = t_axis(n)
    hiss = noise_env(n, 600, 4200, 0.35) * np.minimum(1, t / 0.03)
    thump = sub_thump(n, 85, 0.07)
    return fade_out(norm(0.9 * hiss + 1.1 * thump + 0.5 * snap(n, 1400, 0.01)), 250)


# ---------- the build ----------

def main():
    raw = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/Downloads/Raw Master Tracks")
    ess = sys.argv[2] if len(sys.argv) > 2 else os.path.expanduser("~/Downloads/Essentials_Series_NOX_SOUND")
    if os.path.isdir(os.path.join(raw, "Master Tracks")):
        raw = os.path.join(raw, "Master Tracks")
    if os.path.isdir(os.path.join(ess, "Essentials_Series_NOX_SOUND")):
        ess = os.path.join(ess, "Essentials_Series_NOX_SOUND")
    bank = Bank()

    def gun(folder, name):
        return os.path.join(raw, folder, name + ".wav")

    # sim weapon id -> (recording folder, near takes, mid takes, far takes, playback pitch); take ids per Master Sheet.xlsx
    guns = {
        "m1_garand": ("SKS", ["U_12", "U_14"], ["U_16"], ["U_18"], 1.0),
        "m1_carbine": ("AR-15", ["D_31", "D_32"], ["D_23", "D_24"], ["D_25", "D_26"], 1.12),
        "thompson": ("PPSh", ["P_24", "P_30"], ["P_13", "P_15"], ["P_12", "P_14"], 0.92),
        "bar": ("AK-47", ["C_25", "C_28"], ["C_31", "C_37"], ["C_17", "C_23"], 0.8),
        "kar98k": ("Mosin Nagant", ["M_19", "M_21"], ["M_24", "M_26"], ["M_23", "M_25"], 1.0),
        "kar98k_scoped": ("Arisaka", ["E_22", "E_25"], ["E_16", "E_18"], ["E_17", "E_19"], 1.0),
        "m1903_scoped": ("1917", ["B_23", "B_24"], ["B_15", "B_16"], ["B_21", "B_22"], 0.95),
        "mp40": ("Carl Gustav M45_Swedish K", ["G_25"], ["G_14", "G_20"], ["G_13", "G_19"], 1.05),
        "pistol": ("1911", ["A_41", "A_42"], ["A_33", "A_34"], ["A_39", "A_40"], 1.0),
    }
    caps = {"near": 1.0, "mid": 1.3, "far": 1.7}
    lows = {"near": 6000, "mid": 4600, "far": 3300}
    for wid, (folder, near, mid, far, pitch) in guns.items():
        for dist, takes in (("near", near), ("mid", mid), ("far", far)):
            for i, take in enumerate(takes):
                x = trim_shot(load(gun(folder, take)), caps[dist])
                if pitch != 1.0:
                    x = varispeed(x, pitch)
                x = punch(norm(x), {"near": 1.3, "mid": 0.8, "far": 0.35}[dist])
                x = squash(x, {"near": 5.0, "mid": 4.0, "far": 2.5}[dist])
                x = lofi(norm(x), bits=9, lp={"near": 7500, "mid": 5200, "far": 3400}[dist], hp=40, drive={"near": 3.4, "mid": 2.8, "far": 1.8}[dist])
                nm = f"shot.{wid}.{dist}.{i}"
                bank.add(nm, x, f"{folder}/{take}")
                bank.group(f"shot.{wid}.{dist}", [nm])

    # MG 42: nothing like it in the library, so heavily pitched AK and Mosin layered for a hard, ripping crack
    for dist, ak, mo in (("near", "C_25", "M_19"), ("mid", "C_31", "M_24"), ("far", "C_17", "M_23")):
        a = varispeed(trim_shot(load(gun("AK-47", ak)), caps[dist] * 0.8), 0.62)
        m = varispeed(trim_shot(load(gun("Mosin Nagant", mo)), caps[dist] * 0.8), 0.8)
        mix = np.zeros(max(len(a), len(m)))
        mix[: len(a)] += norm(a)
        mix[: len(m)] += 0.6 * norm(m)
        x = punch(norm(fade_out(mix, 200)), {"near": 1.6, "mid": 0.9, "far": 0.4}[dist])
        x = squash(x, {"near": 5.0, "mid": 4.0, "far": 2.5}[dist])
        x = lofi(norm(x), bits=8, lp=7000 if dist == "near" else 4200, hp=40, drive=3.6 if dist == "near" else 2.6, hold=2 if dist == "near" else 1)
        bank.add(f"shot.mg42.{dist}.0", x, f"AK-47/{ak} + Mosin Nagant/{mo}, pitched down and layered")
        bank.group(f"shot.mg42.{dist}", [f"shot.mg42.{dist}.0"])

    # gun handling
    handling = {
        "bolt": [("Mosin Nagant", "M_14"), ("Arisaka", "E_13"), ("Savage 10 .300 Blackout", "T_9"), ("1917", "B_13")],
        "slide": [("AR-15", "D_14"), ("AR-15", "D_15"), ("SKS", "U_5"), ("1911", "A_24")],
        "mag": [("AR-15", "D_4"), ("PPSh", "P_6"), ("Carl Gustav M45_Swedish K", "G_8"), ("1911", "A_4")],
        "clip": [("Mosin Nagant", "M_0"), ("Arisaka", "E_2"), ("Savage 10 .300 Blackout", "T_10"), ("1917", "B_2")],
        "dry": [("AR-15", "D_16"), ("SKS", "U_6"), ("1911", "A_19"), ("Mosin Nagant", "M_10")],
        "click": [("AR-15", "D_20"), ("SKS", "U_8"), ("Mosin Nagant", "M_11")],
    }
    for kind, items in handling.items():
        for i, (folder, take) in enumerate(items):
            p = gun(folder, take)
            if not os.path.exists(p):
                print("missing", p)
                continue
            x = active(load(p), 1.3 if kind in ("bolt", "slide") else 0.9)
            nm = f"gun.{kind}.{i}"
            bank.add(nm, lofi(norm(x), bits=9, lp=4800), f"{folder}/{take}")
            bank.group(f"gun.{kind}", [nm])

    # explosions: synthesised, with a real gunshot pitched far down for the body
    body = trim_shot(load(gun("AK-47", "C_25")), 1.2)
    big = trim_shot(load(gun("Mosin Nagant", "M_19")), 1.2)
    kinds = {
        "frag": (dict(body=body, secs=1.1, pitch=0.42, sub_hz=95, crack=0.9, rumble=0.7, taps=[(0.11, 0.25)]), "AK-47/C_25"),
        "mortar": (dict(body=big, secs=1.7, pitch=0.3, sub_hz=70, crack=0.7, rumble=0.9, taps=[(0.14, 0.3), (0.31, 0.15)]), "Mosin Nagant/M_19"),
        "artillery": (dict(body=big, secs=2.4, pitch=0.22, sub_hz=52, crack=0.6, rumble=1.0, taps=[(0.17, 0.35), (0.38, 0.2)]), "Mosin Nagant/M_19"),
    }
    for kind, (kw, src) in kinds.items():
        for i in range(2):
            amt = {"frag": 1.6, "mortar": 1.3, "artillery": 1.1}[kind]
            x = squash(punch(blast(**kw), amt), 4.0 if kind == "frag" else 3.0)
            x = lofi(norm(x), bits=8, lp=3600 if kind != "frag" else 5200, hp=35, drive=2.4, hold=2)
            bank.add(f"boom.{kind}.{i}", x, "synth on " + src)
            bank.group(f"boom.{kind}", [f"boom.{kind}.{i}"])
    for i in range(2):
        bank.add(f"whistle.{i}", lofi(whistle(2.2 + 0.2 * i), bits=9, lp=4400, drive=1.2), "synth")
        bank.group("whistle", [f"whistle.{i}"])
        bank.add(f"smoke.{i}", lofi(smoke_pop(), bits=9, lp=4600), "synth")
        bank.group("smoke", [f"smoke.{i}"])
        bank.add(f"collapse.{i}", lofi(collapse(3.2 + 0.4 * i), bits=8, lp=3200, drive=1.7, hold=2), "synth")
        bank.group("collapse", [f"collapse.{i}"])
    for i in range(4):
        bank.add(f"debris.{i}", lofi(debris(0.55 + 0.1 * i), bits=8, lp=4200, drive=1.4), "synth")
        bank.group("debris", [f"debris.{i}"])
    for i in range(3):
        x = squash(punch(mortar_fire(0.6 + 0.05 * i), 1.2), 3.0)
        bank.add(f"mortar.fire.{i}", lofi(norm(x), bits=9, lp=4200, hp=40, drive=2.2), "synth")
        bank.group("mortar.fire", [f"mortar.fire.{i}"])
    for i in range(3):
        bank.add(f"throw.{i}", lofi(whoosh(0.22 + 0.04 * i), bits=9, lp=3800), "synth")
        bank.group("throw", [f"throw.{i}"])
        bank.add(f"whiz.{i}", lofi(whiz(0.18 + 0.05 * i), bits=9, lp=5000), "synth")
        bank.group("whiz", [f"whiz.{i}"])
        bank.add(f"thud.{i}", lofi(thud(0.14 + 0.03 * i, 80 + 18 * i), bits=9, lp=2600), "synth")
        bank.group("thud", [f"thud.{i}"])

    for i in range(5):
        bank.add(f"crack.{i}", lofi(bullet_crack(0.11 + 0.012 * i), bits=10, lp=7200, hp=300, drive=2.2), "synth")
        bank.group("crack", [f"crack.{i}"])

    # what bullets hit
    for name, fn, bits, lp in (("dirt", impact_dirt, 8, 3600), ("wood", impact_wood, 9, 5000), ("stone", impact_stone, 9, 6000),
                               ("flesh", impact_flesh, 9, 3000), ("water", impact_water, 9, 4800), ("ricochet", ricochet, 9, 5600)):
        for i in range(4):
            bank.add(f"impact.{name}.{i}", lofi(squash(fn(), 2.5), bits=bits, lp=lp + 1500, hp=50, drive=2.4), "synth")
            bank.group(f"impact.{name}", [f"impact.{name}.{i}"])

    # armour: the main gun, a round glancing off, a rocket going
    big_body = trim_shot(load(gun("Mosin Nagant", "M_19")), 1.0)
    for i in range(3):
        x = blast(body=big_body, secs=1.5 + 0.1 * i, pitch=0.36, sub_hz=75, crack=1.0, rumble=0.8, taps=[(0.12, 0.28), (0.3, 0.12)])
        x = squash(punch(x, 1.5), 4.0)
        bank.add(f"tank.fire.{i}", lofi(norm(x), bits=8, lp=5600, hp=35, drive=2.6, hold=2), "synth on Mosin Nagant/M_19")
        bank.group("tank.fire", [f"tank.fire.{i}"])
        bank.add(f"tank.hit.{i}", lofi(clang(0.4 + 0.06 * i), bits=9, lp=6500, hp=200, drive=1.8), "synth")
        bank.group("tank.hit", [f"tank.hit.{i}"])
        bank.add(f"tank.engine.{i}", lofi(engine_rumble(1.1 + 0.1 * i), bits=9, lp=2400, hp=35, drive=1.6), "synth")
        bank.group("tank.engine", [f"tank.engine.{i}"])
        x = squash(punch(rocket_launch(0.8 + 0.05 * i), 0.8), 3.0)
        bank.add(f"at.launch.{i}", lofi(norm(x), bits=9, lp=5200, hp=40, drive=2.0), "synth")
        bank.group("at.launch", [f"at.launch.{i}"])

    # footsteps: surface x pace, a handful of takes each
    foot = os.path.join(ess, "Footsteps_Essentials_NOX_SOUND")
    surfaces = {"grass": "Grass", "dirt": "DirtyGround", "gravel": "Gravel", "leaves": "Leaves", "wood": "Wood", "mud": "Mud", "water": "Water", "rock": "Rock"}
    for surf, folder in surfaces.items():
        for pace, sub in (("walk", "Walk"), ("run", "Run")):
            files = sorted(glob.glob(os.path.join(foot, f"Footsteps_{folder}", f"Footsteps_{folder}_{sub}", "*.wav")))
            if not files:
                print("no footsteps", surf, pace)
                continue
            for i, p in enumerate(files[:: max(1, len(files) // 5)][:5]):
                x = lofi(norm(active(load(p), 0.4, floor_db=-32, gap_ms=60)), bits=9, lp=4400, hp=100)
                bank.add(f"step.{surf}.{pace}.{i}", x, os.path.basename(p))
                bank.group(f"step.{surf}.{pace}", [f"step.{surf}.{pace}.{i}"])
        lands = sorted(glob.glob(os.path.join(foot, f"Footsteps_{folder}", "**", "*Land*.wav"), recursive=True))
        for i, p in enumerate(lands[:3]):
            x = lofi(norm(active(load(p), 0.6, floor_db=-32)), bits=9, lp=3800, hp=70)
            bank.add(f"land.{surf}.{i}", x, os.path.basename(p))
            bank.group(f"land.{surf}", [f"land.{surf}.{i}"])

    # voices: grunts and shouts only, short and dull so they read as distant men
    voice = os.path.join(ess, "Voices_Essentials_NOX_SOUND", "Voice_Essential_Male")
    for cat, label, maxn, maxlen in (("Attack", "shout", 8, 1.1), ("Pain", "pain", 8, 1.4), ("Hit", "hit", 6, 0.6), ("Effort", "effort", 6, 0.7)):
        files = sorted(glob.glob(os.path.join(voice, f"Voice_Male_{cat}", "*.wav")))
        for i, p in enumerate(files[:: max(1, len(files) // maxn)][:maxn]):
            x = lofi(norm(active(load(p), maxlen, floor_db=-34, gap_ms=220)), bits=8, lp=3400, hp=140, drive=1.4)
            bank.add(f"voice.{label}.{i}", x, os.path.basename(p))
            bank.group(f"voice.{label}", [f"voice.{label}.{i}"])

    # misc foley
    metal = sorted(glob.glob(os.path.join(foot, "Footsteps_Metal", "**", "*Jump*.wav"), recursive=True))
    for i, p in enumerate(metal[:3]):
        bank.add(f"clank.{i}", lofi(norm(active(load(p), 0.5)), bits=9, lp=5200), os.path.basename(p))
        bank.group("clank", [f"clank.{i}"])
    wood = sorted(glob.glob(os.path.join(foot, "Footsteps_Wood", "**", "*Jump*.wav"), recursive=True))
    for i, p in enumerate(wood[:3]):
        x = lofi(norm(varispeed(active(load(p), 0.6), 0.7)), bits=9, lp=3600)
        bank.add(f"door.{i}", x, os.path.basename(p) + ", pitched down")
        bank.group("door", [f"door.{i}"])

    # ambience loops
    nat = os.path.join(ess, "Nature_Essentials_NOX_SOUND")
    beds = {
        "wind": "Ambiance_Wind_Calm_Loop_Stereo.wav",
        "forest": "Ambiance_Wind_Forest_Loop_Stereo.wav",
        "birds": "Ambiance_Forest_Birds_Loop_Stereo.wav",
        "rain": "Ambiance_Rain_Calm_Loop_Stereo.wav",
        "downpour": "Ambiance_Rain_Strong_Loop_Stereo.wav",
        "river": "Ambiance_River_Moderate_Loop_Stereo.wav",
        "cicadas": "Ambiance_Cicadas_Loop_Stereo.wav",
    }
    for key, fn in beds.items():
        x = loopify(load(os.path.join(nat, fn))[: int(SR * 12)], 1.5)
        x = lofi(x, bits=10, lp=5600 if key in ("birds", "cicadas") else 4200, hp=60, drive=1.1, noise=0.002)
        bank.add(f"amb.{key}", x, fn)

    bank.save()


if __name__ == "__main__":
    main()
