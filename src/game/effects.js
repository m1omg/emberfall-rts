// ============================================================================
// Particles, projectiles-in-flight visuals and ground decals.
// Pure presentation: nothing here feeds back into the simulation.
// ============================================================================

import { TAU, clamp, makeRng, rgba } from '../core/util.js';

export class Effects {
  constructor() {
    this.parts = [];
    this.decals = [];
    this.floaters = [];
    this.rnd = makeRng(90210);
  }

  clear() { this.parts.length = 0; this.decals.length = 0; this.floaters.length = 0; }

  spawn(p) {
    if (this.parts.length > 1400) this.parts.shift();
    this.parts.push(p);
  }

  burst(x, y, kind, n = 8, opts = {}) {
    const r = this.rnd;
    for (let i = 0; i < n; i++) {
      const a = opts.angle !== undefined ? opts.angle + r.range(-0.9, 0.9) : r.range(0, TAU);
      const sp = r.range(opts.minSpeed ?? 30, opts.maxSpeed ?? 130);
      this.spawn({
        kind, x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (opts.lift ?? 20),
        life: r.range(opts.minLife ?? 0.28, opts.maxLife ?? 0.7),
        age: 0,
        size: r.range(opts.minSize ?? 1.4, opts.maxSize ?? 3.4),
        color: opts.color,
        grav: opts.grav ?? 180,
      });
    }
  }

  hit(x, y, faction, angle) {
    const blood = faction === 'demon' ? '#ff7a3d' : '#c23a3a';
    this.burst(x, y - 6, 'spark', 6, { color: blood, angle, minSpeed: 40, maxSpeed: 150, maxLife: 0.42, maxSize: 2.8 });
  }

  death(x, y, faction, big = false) {
    const n = big ? 22 : 12;
    if (faction === 'demon') {
      this.burst(x, y - 8, 'ember', n, { color: '#ff6a2a', minSpeed: 20, maxSpeed: 110, maxLife: 1.1, lift: 40, grav: -30 });
      this.burst(x, y - 6, 'smoke', 6, { color: 'rgba(60,24,30,0.6)', minSpeed: 8, maxSpeed: 34, maxLife: 1.4, grav: -18, minSize: 5, maxSize: 11 });
    } else {
      this.burst(x, y - 8, 'spark', n, { color: '#c23a3a', minSpeed: 25, maxSpeed: 120, maxLife: 0.8 });
      this.burst(x, y - 6, 'smoke', 5, { color: 'rgba(120,120,130,0.4)', minSpeed: 6, maxSpeed: 26, maxLife: 1.2, grav: -14, minSize: 4, maxSize: 9 });
    }
  }

  explosion(x, y, r, color = '#ff8a3d') {
    this.spawn({ kind: 'shock', x, y, r0: r * 0.2, r1: r, life: 0.36, age: 0, color });
    this.burst(x, y, 'ember', 16, { color, minSpeed: 60, maxSpeed: 230, maxLife: 0.7, grav: 40 });
    this.burst(x, y, 'smoke', 6, { color: 'rgba(50,30,26,0.55)', minSpeed: 10, maxSpeed: 50, maxLife: 1.2, grav: -20, minSize: 6, maxSize: 14 });
  }

  heal(x, y) {
    for (let i = 0; i < 6; i++) {
      const a = this.rnd.range(0, TAU);
      this.spawn({
        kind: 'heal', x: x + Math.cos(a) * 9, y: y + Math.sin(a) * 5,
        vx: 0, vy: -this.rnd.range(20, 44), life: this.rnd.range(0.5, 0.9), age: 0,
        size: this.rnd.range(1.8, 3.2), color: '#ffe8aa', grav: 0,
      });
    }
  }

  blink(x, y, color = '#ff6a2a') {
    this.spawn({ kind: 'shock', x, y: y - 8, r0: 2, r1: 26, life: 0.3, age: 0, color });
    this.burst(x, y - 8, 'ember', 10, { color, minSpeed: 40, maxSpeed: 120, maxLife: 0.5, grav: -40 });
  }

  dust(x, y, n = 3) {
    this.burst(x, y, 'dust', n, { color: 'rgba(180,168,140,0.45)', minSpeed: 4, maxSpeed: 20, maxLife: 0.55, grav: -8, minSize: 2, maxSize: 4.5 });
  }

  decal(x, y, kind, faction, seed) {
    if (this.decals.length > 220) this.decals.shift();
    this.decals.push({ x, y, kind, faction, seed, age: 0, life: 46 });
  }

  floater(x, y, text, color) {
    if (this.floaters.length > 60) this.floaters.shift();
    this.floaters.push({ x, y, text, color, age: 0, life: 1.1 });
  }

  update(dt) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.age += dt;
      if (p.age >= p.life) { this.parts.splice(i, 1); continue; }
      if (p.kind === 'shock') continue;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += (p.grav ?? 180) * dt;
      p.vx *= Math.pow(0.24, dt); 
    }
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.age += dt;
      if (d.age >= d.life) this.decals.splice(i, 1);
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.age += dt;
      f.y -= 26 * dt;
      if (f.age >= f.life) this.floaters.splice(i, 1);
    }
  }
}
