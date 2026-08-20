// ============================================================================
// Unified pointer + keyboard input.
//
// Mouse:  left-drag box-selects, left-click selects, right-click commands,
//         middle-drag and the screen edges pan, the wheel zooms at the cursor.
// Touch:  one finger box-selects (or pans, via the on-screen ✋ toggle), two
//         fingers always pan and pinch-zoom, a tap selects or commands, and
//         dragging on the minimap flies the camera.
// ============================================================================

import { clamp, dist } from '../core/util.js';

const TAP_MS = 260;
const TAP_SLOP = 12;
const DRAG_SLOP = 7;

export class Input {
  constructor(canvas, camera, handlers) {
    this.canvas = canvas;
    this.camera = camera;
    this.h = handlers;
    this.pointers = new Map();
    this.mode = 'select';         // touch one-finger behaviour
    this.box = null;              // active selection box in screen space
    this.dragging = null;         // 'box' | 'pan' | 'pinch'
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, inside: false, down: false };
    this.edgeScroll = true;
    this.isTouch = false;
    this.pinch = null;
    this.suppressClick = false;
    this.bind();
  }

  setMode(m) { this.mode = m; }

  bind() {
    const c = this.canvas;
    const opts = { passive: false };
    c.addEventListener('pointerdown', (e) => this.onDown(e), opts);
    window.addEventListener('pointermove', (e) => this.onMove(e), opts);
    window.addEventListener('pointerup', (e) => this.onUp(e), opts);
    window.addEventListener('pointercancel', (e) => this.onUp(e), opts);
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => this.onWheel(e), opts);
    c.addEventListener('mouseleave', () => { this.mouse.inside = false; });
    c.addEventListener('mouseenter', () => { this.mouse.inside = true; });
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => { this.keys.clear(); this.pointers.clear(); this.dragging = null; this.box = null; });
  }

  local(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  onDown(e) {
    if (e.pointerType === 'touch') { this.isTouch = true; document.body.classList.add('touch'); }
    const p = this.local(e);
    this.pointers.set(e.pointerId, { ...p, sx: p.x, sy: p.y, t: performance.now(), type: e.pointerType, button: e.button, moved: 0 });
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* not fatal */ }

    if (this.pointers.size === 2) {
      // second finger down -> pinch/pan, abandon any box
      const [a, b] = [...this.pointers.values()];
      this.pinch = {
        d: dist(a.x, a.y, b.x, b.y),
        cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2,
      };
      this.dragging = 'pinch';
      this.box = null;
      return;
    }
    if (this.pointers.size > 2) return;

    this.mouse.down = true;
    this.mouse.x = p.x; this.mouse.y = p.y;

    if (e.pointerType === 'mouse') {
      if (e.button === 2) { this.dragging = 'rmb'; return; }
      if (e.button === 1) { this.dragging = 'pan'; e.preventDefault(); return; }
      this.dragging = 'maybe-box';
      this.box = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, active: false };
    } else {
      this.dragging = this.mode === 'pan' ? 'maybe-pan' : 'maybe-box';
      if (this.mode !== 'pan') this.box = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, active: false };
    }
    e.preventDefault();
  }

  onMove(e) {
    const rec = this.pointers.get(e.pointerId);
    const p = this.local(e);
    if (e.pointerType === 'mouse') { this.mouse.x = p.x; this.mouse.y = p.y; this.mouse.inside = true; }
    if (!rec) { if (this.h.onHover) this.h.onHover(p.x, p.y); return; }

    const dx = p.x - rec.x, dy = p.y - rec.y;
    rec.moved += Math.abs(dx) + Math.abs(dy);
    rec.x = p.x; rec.y = p.y;

    if (this.dragging === 'pinch' && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = dist(a.x, a.y, b.x, b.y);
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      if (this.pinch) {
        if (this.pinch.d > 8 && d > 8) this.camera.zoomAt(cx, cy, d / this.pinch.d);
        this.camera.panBy(-(cx - this.pinch.cx) / this.camera.zoom, -(cy - this.pinch.cy) / this.camera.zoom);
      }
      this.pinch = { d, cx, cy };
      e.preventDefault();
      return;
    }

    if (this.dragging === 'maybe-box' && Math.hypot(p.x - rec.sx, p.y - rec.sy) > DRAG_SLOP) {
      this.dragging = 'box';
      if (this.box) this.box.active = true;
    }
    if (this.dragging === 'maybe-pan' && Math.hypot(p.x - rec.sx, p.y - rec.sy) > DRAG_SLOP) this.dragging = 'pan';

    if (this.dragging === 'box' && this.box) {
      this.box.x1 = p.x; this.box.y1 = p.y;
      e.preventDefault();
    } else if (this.dragging === 'pan') {
      this.camera.panBy(-dx / this.camera.zoom, -dy / this.camera.zoom);
      this.camera.vx = -dx / this.camera.zoom * 12;
      this.camera.vy = -dy / this.camera.zoom * 12;
      e.preventDefault();
    }
  }

  onUp(e) {
    const rec = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }

    if (this.dragging === 'pinch') {
      if (this.pointers.size < 2) { this.pinch = null; this.dragging = this.pointers.size ? 'pan' : null; this.suppressClick = true; }
      return;
    }
    if (!rec) { this.dragging = null; return; }

    const p = this.local(e);
    const dt = performance.now() - rec.t;
    const moved = Math.hypot(p.x - rec.sx, p.y - rec.sy);
    const additive = this.keys.has('shift');

    if (this.dragging === 'box' && this.box && this.box.active) {
      const b = this.normBox(this.box);
      if (Math.abs(b.w) > DRAG_SLOP || Math.abs(b.h) > DRAG_SLOP) this.h.onBoxSelect(b, additive);
      else this.h.onClick(p.x, p.y, additive);
    } else if (this.dragging === 'rmb') {
      this.h.onCommand(p.x, p.y, { queue: additive });
    } else if (this.dragging === 'maybe-box' || this.dragging === 'maybe-pan') {
      if (dt < TAP_MS * 3 && moved < TAP_SLOP) {
        if (rec.type === 'touch') this.h.onTap(p.x, p.y, additive);
        else this.h.onClick(p.x, p.y, additive);
      }
    } else if (this.dragging === 'pan' && rec.type === 'touch' && dt < TAP_MS && moved < TAP_SLOP) {
      this.h.onTap(p.x, p.y, additive);
    }

    this.box = null;
    this.dragging = this.pointers.size ? this.dragging : null;
    this.mouse.down = false;
  }

  normBox(b) {
    const x = Math.min(b.x0, b.x1), y = Math.min(b.y0, b.y1);
    return { x, y, w: Math.abs(b.x1 - b.x0), h: Math.abs(b.y1 - b.y0) };
  }

  onWheel(e) {
    e.preventDefault();
    const p = this.local(e);
    const f = Math.pow(0.9985, e.deltaY * (e.deltaMode === 1 ? 18 : 1));
    this.camera.zoomAt(p.x, p.y, f);
  }

  onKey(e, down) {
    const k = e.key.toLowerCase();
    if (down) this.keys.add(k); else this.keys.delete(k);
    if (e.shiftKey) this.keys.add('shift'); else this.keys.delete('shift');
    if (e.ctrlKey || e.metaKey) this.keys.add('ctrl'); else this.keys.delete('ctrl');
    if (down && this.h.onKey) {
      const consumed = this.h.onKey(k, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey });
      if (consumed) e.preventDefault();
    }
  }

  /** Called every frame: keyboard and edge panning. */
  update(dt) {
    const cam = this.camera;
    const speed = 900 / cam.zoom * dt;
    let dx = 0, dy = 0;
    if (this.keys.has('a') || this.keys.has('arrowleft')) dx -= speed;
    if (this.keys.has('d') || this.keys.has('arrowright')) dx += speed;
    if (this.keys.has('w') || this.keys.has('arrowup')) dy -= speed;
    if (this.keys.has('s') || this.keys.has('arrowdown')) dy += speed;

    if (this.edgeScroll && !this.isTouch && this.mouse.inside && !this.mouse.down) {
      const m = 26, W = cam.viewW, H = cam.viewH;
      if (this.mouse.x < m) dx -= speed * (1 - this.mouse.x / m);
      else if (this.mouse.x > W - m) dx += speed * (1 - (W - this.mouse.x) / m);
      if (this.mouse.y < m) dy -= speed * (1 - this.mouse.y / m);
      else if (this.mouse.y > H - m) dy += speed * (1 - (H - this.mouse.y) / m);
    }
    if (dx || dy) { cam.panBy(dx, dy); cam.vx = cam.vy = 0; }
  }
}
