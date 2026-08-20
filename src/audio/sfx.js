// ============================================================================
// Synthesised sound. No audio files ship with the game — every cue is a few
// oscillators and a noise burst, which keeps the download tiny and lets the
// mix stay consistent. Starts muted until the first user gesture, as browsers
// require.
// ============================================================================

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.volume = 0.5;
    this.last = new Map();
  }

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 8;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

  /** Rate-limit repeated cues so a big battle doesn't turn to mush. */
  throttled(name, ms) {
    const now = performance.now();
    const t = this.last.get(name) || 0;
    if (now - t < ms) return false;
    this.last.set(name, now);
    return true;
  }

  tone({ freq = 440, to = null, type = 'sine', dur = 0.15, gain = 0.3, delay = 0, attack = 0.005, curve = 'exp' }) {
    if (!this.enabled) return;
    this.ensure();
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) {
      if (curve === 'exp') osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
      else osc.frequency.linearRampToValueAtTime(to, t0 + dur);
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }

  noise({ dur = 0.12, gain = 0.2, delay = 0, filter = 1800, q = 1, type = 'bandpass', sweep = null }) {
    if (!this.enabled) return;
    this.ensure();
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bq = ctx.createBiquadFilter();
    bq.type = type; bq.frequency.setValueAtTime(filter, t0); bq.Q.value = q;
    if (sweep) bq.frequency.exponentialRampToValueAtTime(Math.max(40, sweep), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bq); bq.connect(g); g.connect(this.master);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }

  // ---- cues ---------------------------------------------------------------
  click() { this.tone({ freq: 620, to: 780, type: 'triangle', dur: 0.07, gain: 0.10 }); }
  select() { this.tone({ freq: 520, to: 700, type: 'triangle', dur: 0.09, gain: 0.11 }); this.tone({ freq: 780, type: 'sine', dur: 0.06, gain: 0.05, delay: 0.03 }); }
  command() { this.tone({ freq: 340, to: 260, type: 'triangle', dur: 0.1, gain: 0.11 }); }
  deny() { this.tone({ freq: 200, to: 130, type: 'sawtooth', dur: 0.16, gain: 0.1 }); }

  melee() {
    if (!this.throttled('melee', 55)) return;
    this.noise({ dur: 0.09, gain: 0.16, filter: 3200, sweep: 900, q: 1.2 });
    this.tone({ freq: 220 + Math.random() * 60, to: 110, type: 'square', dur: 0.06, gain: 0.05 });
  }
  bow() {
    if (!this.throttled('bow', 60)) return;
    this.noise({ dur: 0.07, gain: 0.1, filter: 2400, sweep: 5000, q: 0.8 });
  }
  fire() {
    if (!this.throttled('fire', 70)) return;
    this.noise({ dur: 0.22, gain: 0.14, filter: 900, sweep: 260, type: 'lowpass' });
    this.tone({ freq: 160, to: 60, type: 'sawtooth', dur: 0.2, gain: 0.07 });
  }
  explode() {
    if (!this.throttled('explode', 90)) return;
    this.noise({ dur: 0.4, gain: 0.22, filter: 600, sweep: 120, type: 'lowpass' });
    this.tone({ freq: 90, to: 40, type: 'sine', dur: 0.35, gain: 0.12 });
  }
  death(demon) {
    if (!this.throttled('death', 110)) return;
    if (demon) this.tone({ freq: 300, to: 90, type: 'sawtooth', dur: 0.3, gain: 0.1 });
    else this.tone({ freq: 260, to: 120, type: 'triangle', dur: 0.24, gain: 0.09 });
    this.noise({ dur: 0.2, gain: 0.09, filter: 1200, sweep: 300, type: 'lowpass' });
  }
  build() { this.noise({ dur: 0.12, gain: 0.1, filter: 1400, q: 1.4 }); }
  complete() {
    this.tone({ freq: 520, type: 'triangle', dur: 0.16, gain: 0.11 });
    this.tone({ freq: 660, type: 'triangle', dur: 0.2, gain: 0.10, delay: 0.1 });
    this.tone({ freq: 880, type: 'sine', dur: 0.26, gain: 0.08, delay: 0.2 });
  }
  coin() { if (!this.throttled('coin', 140)) return; this.tone({ freq: 1180, to: 1560, type: 'sine', dur: 0.07, gain: 0.045 }); }
  blink() { this.tone({ freq: 900, to: 300, type: 'sine', dur: 0.16, gain: 0.08 }); }
  alarm() { this.tone({ freq: 440, to: 300, type: 'square', dur: 0.2, gain: 0.09 }); this.tone({ freq: 440, to: 300, type: 'square', dur: 0.2, gain: 0.09, delay: 0.24 }); }

  victory() {
    [0, 0.16, 0.32, 0.52].forEach((d, i) => {
      this.tone({ freq: [392, 494, 587, 784][i], type: 'triangle', dur: 0.5, gain: 0.13, delay: d });
    });
  }
  defeat() {
    [0, 0.22, 0.46].forEach((d, i) => {
      this.tone({ freq: [330, 262, 196][i], type: 'sawtooth', dur: 0.6, gain: 0.11, delay: d });
    });
  }
}
