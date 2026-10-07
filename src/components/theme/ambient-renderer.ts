import { getSceneryPreferences } from './scenery-preferences';

interface Particle {
  x: number;
  y: number;
  size: number;
  depth: number;
  phase: number;
  spin: number;
}
/** One bounded Canvas2D layer; no WebGL, event interception, background RAF or external assets. */
export function startAtmosphere(canvas: HTMLCanvasElement): () => void {
  const context = canvas.getContext('2d');
  if (!context) return () => {};
  const ctx = context;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let prefs = getSceneryPreferences();
  let width = 1,
    height = 1,
    frame = 0,
    last = 0,
    time = 0;
  let particles: Particle[] = [];
  let previousEffect = prefs.effect;
  let particleSettings = '';
  const makeParticle = (): Particle => ({
    x: Math.random() * width,
    y: Math.random() * height,
    size: 2 + Math.random() * 5,
    depth: 0.35 + Math.random() * 0.65,
    phase: Math.random() * Math.PI * 2,
    spin: Math.random() - 0.5,
  });
  function configure() {
    prefs = getSceneryPreferences();
    const settings = `${prefs.effect}:${prefs.density}:${prefs.speed}:${prefs.effectOpacity}:${width}:${height}`;
    // Banner color/typography sliders share this event. They must not clear or
    // restart an unrelated particle frame on every pointer movement.
    if (settings === particleSettings) return;
    particleSettings = settings;
    if (previousEffect !== prefs.effect) {
      particles = [];
      previousEffect = prefs.effect;
    }
    const limit = width < 640 ? 40 : 90;
    const count = prefs.effect === 'aurora' ? 5 : Math.round((limit * prefs.density) / 100);
    particles = particles.slice(0, count);
    while (particles.length < count) particles.push(makeParticle());
    canvas.dataset.effect = prefs.effect;
    canvas.dataset.particles = String(count);
    schedule();
  }
  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    const dpr = Math.min(devicePixelRatio || 1, width < 640 ? 1 : 1.5);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    particles = [];
    particleSettings = '';
    configure();
  }
  function canAnimate() {
    return (
      prefs.effect !== 'none' &&
      !document.hidden &&
      !motion.matches &&
      document.documentElement.dataset.readingMotion !== 'reduced'
    );
  }
  function schedule() {
    const running = canAnimate();
    canvas.dataset.running = String(running);
    // Reading settings fire for font and spacing changes too. Preserve the
    // existing clock unless visibility or a motion preference actually changes.
    if (Boolean(frame) === running) return;
    cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
    ctx.clearRect(0, 0, width, height);
    if (running) frame = requestAnimationFrame(draw);
  }
  function glow(x: number, y: number, radius: number, color: string) {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, 'transparent');
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  function draw(now: number) {
    frame = requestAnimationFrame(draw);
    // Cap at 30fps, and never jump particles across the screen after a stalled frame.
    if (last && now - last < 1000 / 30) return;
    const dt = last ? Math.min(0.07, (now - last) / 1000) : 0.033;
    last = now;
    time += dt * (0.3 + prefs.speed / 35);
    ctx.clearRect(0, 0, width, height);
    const opacity = prefs.effectOpacity / 100;
    if (prefs.effect === 'aurora') {
      // Soft elliptical light fields avoid a hard edge over content or the banner.
      for (let i = 0; i < 3; i++) {
        ctx.save();
        ctx.globalAlpha = opacity * (0.22 + prefs.density / 300);
        ctx.translate(width * (0.2 + i * 0.28), height * (0.06 + Math.sin(time * 0.06 + i) * 0.05));
        ctx.rotate(-0.3 + Math.sin(time * 0.03 + i) * 0.15);
        ctx.scale(1, 0.23);
        glow(0, 0, width * 0.5, i === 1 ? '#a08bce' : i === 0 ? '#56b89e' : '#709dc2');
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      return;
    }
    for (const p of particles) {
      const drift = Math.sin(time * 0.4 + p.phase);
      const rate = dt * (0.3 + prefs.speed / 35) * p.depth;
      const falling = ['sakura', 'snow', 'rain', 'leaves'].includes(prefs.effect);
      p.x += falling ? rate * (prefs.effect === 'rain' ? -35 : 10 + drift * 18) : rate * drift * 8;
      p.y += rate * (prefs.effect === 'rain' ? 270 : falling ? 22 : Math.cos(time * 0.3 + p.phase) * 7);
      if (p.y > height + 30) {
        p.y = -30;
        p.x = Math.random() * width;
      }
      if (p.y < -40) p.y = height + 20;
      if (p.x > width + 30) p.x = -20;
      if (p.x < -30) p.x = width + 20;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.globalAlpha = opacity * p.depth;
      switch (prefs.effect) {
        case 'sakura':
        case 'leaves': {
          ctx.rotate(p.phase + time * p.spin * 0.7);
          ctx.scale(0.65 + Math.abs(Math.cos(time * 0.6 + p.phase)) * 0.35, 1);
          const size = p.size * (prefs.effect === 'sakura' ? 1.3 : 1.7);
          ctx.fillStyle =
            prefs.effect === 'sakura' ? (p.depth > 0.7 ? '#e19ab3' : '#f3c7d5') : p.depth > 0.7 ? '#b98b48' : '#ae704c';
          ctx.beginPath();
          ctx.moveTo(0, -size);
          ctx.bezierCurveTo(size * 1.2, -size * 0.6, size, size * 0.5, 0, size);
          ctx.bezierCurveTo(-size, size * 0.4, -size * 0.6, -size * 0.7, 0, -size);
          ctx.fill();
          break;
        }
        case 'rain':
          ctx.strokeStyle = '#8bb2ce';
          ctx.lineWidth = 0.7 + p.depth;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(-2, 12 * p.depth);
          ctx.stroke();
          break;
        case 'snow':
          ctx.fillStyle = '#e6eef7';
          ctx.strokeStyle = '#b3c1d355';
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.arc(0, 0, p.size * 0.45, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          break;
        case 'fireflies':
          ctx.globalAlpha *= 0.4 + (0.6 * (1 + Math.sin(time * 0.8 + p.phase))) / 2;
          glow(0, 0, p.size * 3, '#d6dc81');
          ctx.fillStyle = '#f5edb3';
          ctx.fillRect(-1, -1, 2, 2);
          break;
        case 'stars': {
          ctx.globalAlpha *= 0.25 + (0.75 * (1 + Math.sin(time * 0.65 + p.phase))) / 2;
          ctx.fillStyle = '#c7b880';
          const size = p.size * 0.7;
          ctx.beginPath();
          ctx.moveTo(0, -size);
          ctx.quadraticCurveTo(0, 0, size, 0);
          ctx.quadraticCurveTo(0, 0, 0, size);
          ctx.quadraticCurveTo(0, 0, -size, 0);
          ctx.quadraticCurveTo(0, 0, 0, -size);
          ctx.fill();
          break;
        }
        case 'bokeh':
          ctx.globalAlpha *= 0.25;
          glow(0, 0, p.size * 7, p.depth > 0.6 ? '#e5b690' : '#bbc9e5');
          break;
      }
      ctx.restore();
    }
  }
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('scenery-change', configure);
  window.addEventListener('reading-change', schedule);
  document.addEventListener('visibilitychange', schedule);
  motion.addEventListener('change', schedule);
  return () => {
    cancelAnimationFrame(frame);
    ctx.clearRect(0, 0, width, height);
    window.removeEventListener('resize', resize);
    window.removeEventListener('scenery-change', configure);
    window.removeEventListener('reading-change', schedule);
    document.removeEventListener('visibilitychange', schedule);
    motion.removeEventListener('change', schedule);
  };
}
