import { setImmediate } from 'node:timers/promises';
import sharp from 'sharp';

const W = 48;
const H = 64;

/** Both metrics use the same aligned RGB pixels. Weight structure 80%, pixel fidelity 20%.
 * PSNR is normalized against 50 dB, never added in raw dB to SSIM. A finite 100 dB
 * reporting ceiling keeps exact-match metrics JSON-safe (its normalized contribution is 1).
 */
function similarity(a: Uint8Array, b: Uint8Array) {
  let sum = 0;
  let squaredError = 0;
  for (let y = 0; y < H; y += 8)
    for (let x = 0; x < W; x += 8)
      for (let c = 0; c < 3; c++) {
        let ma = 0,
          mb = 0,
          aa = 0,
          bb = 0,
          ab = 0;
        for (let j = y; j < y + 8; j++)
          for (let i = x; i < x + 8; i++) {
            const v = a[(j * W + i) * 3 + c],
              w = b[(j * W + i) * 3 + c];
            ma += v;
            mb += w;
            aa += v * v;
            bb += w * w;
            ab += v * w;
            squaredError += (v - w) ** 2;
          }
        ma /= 64;
        mb /= 64;
        sum +=
          ((2 * ma * mb + 6.5025) * (2 * (ab / 64 - ma * mb) + 58.5225)) /
          ((ma * ma + mb * mb + 6.5025) * (aa / 64 - ma * ma + bb / 64 - mb * mb + 58.5225));
      }
  const ssim = sum / (((W * H) / 64) * 3);
  const mse = squaredError / (W * H * 3);
  const psnr = Math.min(100, 10 * Math.log10(255 ** 2 / Math.max(mse, 255 ** 2 * 1e-10)));
  const score = 0.8 * Math.max(0, ssim) + 0.2 * Math.min(1, Math.max(0, psnr / 50));
  return { score, ssim, psnr };
}

/** Search scale/translation because Hpoi covers crop and enlarge the official photo. Never mirror/rotate a match. */
export async function matchCover(cover: Buffer, candidate: Buffer) {
  const meta = await sharp(cover).metadata();
  const ratio = (meta.width ?? 360) / (meta.height ?? 520);
  const target = await sharp(cover)
    .flatten({ background: '#fff' })
    .resize(W, H, { fit: 'fill' })
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer();
  const { data, info } = await sharp(candidate)
    .flatten({ background: '#fff' })
    .resize(180, 180, { fit: 'inside' })
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const out = new Uint8Array(W * H * 3);
  let best = { score: -1, ssim: 0, psnr: 0, left: 0, top: 0, width: 1, height: 1 };
  const maxHeight = Math.min(info.height, info.width / ratio);
  const evaluate = (height: number, left: number, top: number) => {
    const width = height * ratio;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const sx = Math.min(info.width - 1, left + ((x + 0.5) * width) / W - 0.5);
        const sy = Math.min(info.height - 1, top + ((y + 0.5) * height) / H - 0.5);
        const ix = Math.max(0, Math.floor(sx)),
          iy = Math.max(0, Math.floor(sy));
        const fx = Math.max(0, sx - ix),
          fy = Math.max(0, sy - iy);
        // Compute bilinear sample offsets once per pixel, not via four closures per channel.
        const right = Math.min(info.width - 1, ix + 1),
          bottom = Math.min(info.height - 1, iy + 1);
        const a = (iy * info.width + ix) * 3,
          b = (iy * info.width + right) * 3;
        const c = (bottom * info.width + ix) * 3,
          d = (bottom * info.width + right) * 3;
        for (let channel = 0; channel < 3; channel++) {
          out[(y * W + x) * 3 + channel] =
            (data[a + channel] * (1 - fx) + data[b + channel] * fx) * (1 - fy) +
            (data[c + channel] * (1 - fx) + data[d + channel] * fx) * fy;
        }
      }
    const metrics = similarity(target, out);
    if (metrics.score > best.score)
      best = {
        ...metrics,
        left: left / info.width,
        top: top / info.height,
        width: width / info.width,
        height: height / info.height,
      };
  };
  for (let scale = 1; scale >= 0.45; scale -= 0.05) {
    // Yield between scales so a new-figure background job cannot monopolize the Node origin.
    await setImmediate();
    const height = maxHeight * scale;
    for (let y = 0; y <= 4; y++)
      for (let x = 0; x <= 4; x++) evaluate(height, ((info.width - height * ratio) * x) / 4, ((info.height - height) * y) / 4);
  }
  // Refine the winning crop locally, without a full-resolution CV pass.
  const seed = { ...best };
  for (let dh = -3; dh <= 3; dh++)
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const height = seed.height * info.height + dh;
        const left = seed.left * info.width + dx,
          top = seed.top * info.height + dy;
        if (height > 0 && left >= 0 && top >= 0 && left + height * ratio <= info.width && top + height <= info.height)
          evaluate(height, left, top);
      }
  return best;
}
