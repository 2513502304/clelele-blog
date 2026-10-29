import { STUDIO_FILTERS, type StudioFilter } from './studio-state';

export const STUDIO_BACKGROUNDS = { transparent: '', paper: '#f8f4f1', blush: '#eed9df', midnight: '#222731' } as const;
export type StudioBackground = keyof typeof STUDIO_BACKGROUNDS;
export interface StudioScene {
  background: StudioBackground;
  filter: StudioFilter;
  zoom: number;
  x: number;
  y: number;
  speaker: string;
  dialogue: string;
}

/** Export the same local canvas composition, without fetching a second model or external image. */
export async function exportStudioScene(frame: string, scene: StudioScene, aspect: number): Promise<Blob> {
  const image = new Image();
  image.src = frame;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(1600 * Math.min(1, aspect));
  canvas.height = Math.round(canvas.width / aspect);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  const { width: w, height: h } = canvas;
  if (scene.background !== 'transparent') {
    ctx.fillStyle = STUDIO_BACKGROUNDS[scene.background];
    ctx.fillRect(0, 0, w, h);
  }
  ctx.save();
  ctx.filter = STUDIO_FILTERS[scene.filter];
  ctx.translate(w / 2 + (scene.x * w) / 100, h / 2 + (scene.y * h) / 100);
  ctx.scale(scene.zoom / 100, scene.zoom / 100);
  ctx.drawImage(image, -w / 2, -h / 2, w, h);
  ctx.restore();
  if (scene.dialogue) {
    const pad = w * 0.05,
      font = Math.max(16, w * 0.025),
      maxWidth = w - pad * 4;
    ctx.font = `${font}px sans-serif`;
    const lines: string[] = [];
    let line = '';
    for (const char of scene.dialogue) {
      if (char === '\n' || ctx.measureText(line + char).width > maxWidth) {
        lines.push(line);
        line = char === '\n' ? '' : char;
      } else line += char;
    }
    if (line) lines.push(line);
    const visible = lines.slice(0, 5),
      lineHeight = font * 1.5;
    const boxHeight = (visible.length + (scene.speaker ? 1.5 : 0)) * lineHeight + pad;
    const top = h - boxHeight - pad;
    ctx.fillStyle = 'rgba(25, 27, 36, 0.86)';
    ctx.beginPath();
    ctx.roundRect(pad, top, w - pad * 2, boxHeight, 14);
    ctx.fill();
    let y = top + pad * 0.6 + font;
    if (scene.speaker) {
      ctx.fillStyle = '#f5b5c6';
      ctx.font = `bold ${font}px sans-serif`;
      ctx.fillText(scene.speaker, pad * 2, y, maxWidth);
      y += lineHeight * 1.5;
    }
    ctx.font = `${font}px sans-serif`;
    ctx.fillStyle = '#fff';
    for (const text of visible) {
      ctx.fillText(text, pad * 2, y);
      y += lineHeight;
    }
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG export failed'))), 'image/png'),
  );
}

export function downloadStudioFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
