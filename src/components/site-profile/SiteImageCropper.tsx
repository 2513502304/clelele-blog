import './site-image-cropper.css';
import { useEffect, useRef, useState } from 'react';
import { AVATAR_DISPLAY_SIZE, type CropPosition, cropRectangle } from '@/lib/site-profile/image-crop';

/** The viewport is the exported crop. Local input bytes are never changed or sent before confirmation. */
export default function SiteImageCropper({
  file,
  ratio,
  avatar,
  busy,
  onApply,
  onProcessing,
}: {
  file: File;
  ratio: number;
  avatar: boolean;
  busy: boolean;
  onApply: (file: File) => Promise<void>;
  onProcessing: (busy: boolean) => void;
}) {
  const [source, setSource] = useState('');
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [position, setPosition] = useState<CropPosition>({ zoom: 1, x: 0, y: 0 });
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number; position: CropPosition } | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSource(url);
    setSize({ width: 0, height: 0 });
    setPosition({ zoom: 1, x: 0, y: 0 });
    setError('');
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const crop = cropRectangle(size.width || 1, size.height || 1, ratio, position);
  const move = (x: number, y: number) =>
    setPosition((current) => ({ ...current, x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) }));
  async function apply() {
    if (!image.current || !size.width || busy || exporting) return;
    setExporting(true);
    onProcessing(true);
    setError('');
    try {
      const canvas = document.createElement('canvas');
      // Avoid upscaling tiny originals; bound the outgoing crop independently of the source file size.
      canvas.width = Math.max(1, Math.round(Math.min(crop.width, avatar ? AVATAR_DISPLAY_SIZE * 3 : 2560)));
      canvas.height = Math.max(1, Math.round(canvas.width / ratio));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('浏览器无法创建裁剪画布。');
      context.drawImage(image.current, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.95));
      if (!blob || blob.size > 3_000_000) throw new Error('裁剪结果超过 3 MB，请换用较小的图片。');
      // Safari may fall back to PNG when its canvas encoder cannot write WebP. Respect the actual returned format.
      const extension = blob.type === 'image/webp' ? 'webp' : 'png';
      await onApply(
        new File([blob], `${file.name.replace(/\.[^.]+$/, '').slice(0, 230)}-crop.${extension}`, { type: blob.type }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '裁剪失败，请重新选择图片。');
    } finally {
      setExporting(false);
      onProcessing(false);
    }
  }
  return (
    <section className="space-y-4" aria-label="调整图片构图">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">拖动图片调整位置</span>
        <span className="text-muted-foreground">{avatar ? '圆形头像 · 1:1' : `当前横幅 · ${ratio.toFixed(2)}:1`}</span>
      </div>
      <div className="site-crop-context">
        <div
          role="slider"
          tabIndex={0}
          aria-label="裁剪位置（方向键移动）"
          aria-valuemin={-100}
          aria-valuemax={100}
          aria-valuenow={Math.round(position.x * 100)}
          aria-valuetext={`水平 ${Math.round(position.x * 100)}，垂直 ${Math.round(position.y * 100)}`}
          data-crop-stage
          className="site-crop-frame relative touch-none outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
          style={{
            width: `min(80%, ${avatar ? '300px' : `calc(46dvh * ${ratio})`})`,
            aspectRatio: ratio,
            cursor: 'grab',
            borderRadius: avatar ? '50%' : '8px',
          }}
          onPointerDown={(event) => {
            if (event.button !== 0 || busy || exporting) return;
            event.preventDefault();
            event.currentTarget.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { x: event.clientX, y: event.clientY, position };
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            if (!start) return;
            const scale = event.currentTarget.clientWidth / crop.width;
            move(
              start.position.x - ((event.clientX - start.x) * 2) / Math.max(1, (size.width - crop.width) * scale),
              start.position.y - ((event.clientY - start.y) * 2) / Math.max(1, (size.height - crop.height) * scale),
            );
          }}
          onPointerUp={(event) => {
            drag.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onKeyDown={(event) => {
            const delta = (
              { ArrowLeft: [-0.05, 0], ArrowRight: [0.05, 0], ArrowUp: [0, -0.05], ArrowDown: [0, 0.05] } as Record<
                string,
                number[]
              >
            )[event.key];
            if (delta) {
              event.preventDefault();
              move(position.x + delta[0], position.y + delta[1]);
            }
          }}
        >
          {source && (
            <img
              ref={image}
              src={source}
              alt="待裁剪图片"
              draggable={false}
              onLoad={(event) => {
                const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
                if (width * height > 40_000_000) {
                  setError('图片超过 4000 万像素，请先缩小图片。');
                  setSize({ width: 0, height: 0 });
                } else setSize({ width, height });
              }}
              onError={() => setError('无法读取图片，请更换文件。')}
              className="pointer-events-none absolute max-w-none select-none"
              style={{
                // The global image reset uses max-inline-size, which otherwise clamps zoomed images.
                maxInlineSize: 'none',
                width: `${(size.width / crop.width) * 100}%`,
                height: `${(size.height / crop.height) * 100}%`,
                left: `${(-crop.x / crop.width) * 100}%`,
                top: `${(-crop.y / crop.height) * 100}%`,
              }}
            />
          )}
          <div aria-hidden className="site-crop-mask pointer-events-none absolute inset-0">
            <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 overflow-hidden rounded-[inherit] opacity-30">
              {['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'].map((cell) => (
                <span key={cell} className="border border-white/40" />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <label htmlFor="crop-zoom" className="text-sm">
          缩放
        </label>
        <input
          id="crop-zoom"
          type="range"
          min={1}
          max={4}
          step={0.01}
          value={position.zoom}
          disabled={busy || exporting}
          className="site-crop-zoom min-w-0 flex-1"
          onInput={(event) => {
            const zoom = Number(event.currentTarget.value);
            setPosition((current) => ({ ...current, zoom }));
          }}
        />
        <span className="w-12 text-right text-sm tabular-nums">{Math.round(position.zoom * 100)}%</span>
        <button
          type="button"
          disabled={busy || exporting}
          onClick={() => setPosition({ zoom: 1, x: 0, y: 0 })}
          className="text-primary text-sm"
        >
          重置
        </button>
      </div>
      <p className="text-muted-foreground text-xs leading-5">
        {avatar
          ? '圆形遮罩外的区域不会显示；保存为方形图片，适配站点所有头像。'
          : '按打开页面的横幅比例导出。其他屏幕尺寸会继续居中适配，建议把主体留在画面中央。'}
        优先导出 WebP，浏览器不支持时使用 PNG。
        {file.type === 'image/gif' && ' 动图裁剪将保存为静态图片。'}
      </p>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={busy || exporting || !size.width}
        onClick={() => void apply()}
        className="w-full rounded-xl bg-primary px-4 py-3 font-medium text-white disabled:opacity-50"
      >
        {exporting || busy ? '处理中…' : '使用这个构图'}
      </button>
    </section>
  );
}
