import { useTranslation } from '@hooks/useTranslation';
import type { Live2DLoadProgress } from '@lib/live2d/renderer';

/** Only verified resource bytes have a percentage; parsing/GPU setup remains indeterminate. */
export function Live2DLoadStatus({ progress }: { progress: Live2DLoadProgress | null }) {
  const { t } = useTranslation();
  const downloading = progress?.stage === 'download' && progress.total > 0;
  const percent = downloading ? Math.min(100, Math.floor((progress.loaded / progress.total) * 100)) : undefined;
  const label = t(
    progress?.stage === 'initialize' ? 'live2d.initializing' : downloading ? 'live2d.downloading' : 'live2d.loading',
  );
  return (
    <output className="live2d-load-progress">
      <span>
        {label}
        {percent !== undefined && ` ${percent}%`}
      </span>
      <progress max={100} value={percent} aria-label={label} />
      {downloading && (
        <small>
          {(progress.loaded / 1048576).toFixed(1)} / {(progress.total / 1048576).toFixed(1)} MB
        </small>
      )}
    </output>
  );
}
