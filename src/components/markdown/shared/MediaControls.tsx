/**
 * Shared media controls for audio and video players.
 *
 * Renders playback mode, prev/play/next, volume, and progress bar.
 * Accepts optional extra buttons (e.g. fullscreen) and conditional track buttons.
 *
 * Progress bar width is updated imperatively via ref (zero re-renders from timeupdate).
 */

import { usePlaybackFormattedTime, usePlaybackProgress } from '@hooks/usePlaybackTime';
import { useTranslation } from '@hooks/useTranslation';
import { Icon } from '@iconify/react';
import type { PlaybackTimeStore } from '@lib/playback-time-store';
import { cn } from '@lib/utils';
import { type CSSProperties, memo, useRef } from 'react';
import type { PlayMode } from '@/store/player';

export interface MediaControlsProps {
  playing: boolean;
  loading: boolean;
  mode: PlayMode;
  volume: number;
  muted: boolean;
  timeStore: PlaybackTimeStore;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (time: number) => void;
  onSetMode: (mode: PlayMode) => void;
  onSetVolume: (volume: number) => void;
  onToggleMute: () => void;
  showModeButton?: boolean;
  showTrackButtons?: boolean;
  extraButtons?: React.ReactNode;
}

const MODE_ICONS: Record<PlayMode, string> = {
  order: 'ri:order-play-line',
  random: 'ri:shuffle-line',
  loop: 'ri:repeat-one-line',
};

const MODE_LABEL_KEYS: Record<PlayMode, 'media.playModeOrder' | 'media.playModeRandom' | 'media.playModeLoop'> = {
  order: 'media.playModeOrder',
  random: 'media.playModeRandom',
  loop: 'media.playModeLoop',
};

const MODE_CYCLE: PlayMode[] = ['order', 'random', 'loop'];

function rangeValueAtPointer(input: HTMLInputElement, clientX: number): number {
  const rect = input.getBoundingClientRect();
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 1;
  const step = Number(input.step) || 0;
  const ratio = rect.width > 0 ? Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) : 0;
  const raw = min + ratio * (max - min);
  const stepped = step > 0 ? min + Math.round((raw - min) / step) * step : raw;
  return Math.max(min, Math.min(max, stepped));
}

function getVolumeIcon(volume: number, muted: boolean): string {
  if (muted || volume === 0) return 'ri:volume-mute-line';
  if (volume < 0.5) return 'ri:volume-down-line';
  return 'ri:volume-up-line';
}

export const MediaControls = memo(function MediaControls({
  playing,
  loading,
  mode,
  volume,
  muted,
  timeStore,
  onTogglePlay,
  onPrev,
  onNext,
  onSeek,
  onSetMode,
  onSetVolume,
  onToggleMute,
  showModeButton = true,
  showTrackButtons = true,
  extraButtons,
}: MediaControlsProps) {
  const { t } = useTranslation();
  const progressBarRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const progressPointerId = useRef<number | null>(null);
  const volumePointerId = useRef<number | null>(null);
  usePlaybackProgress(timeStore, progressBarRef, sliderRef);
  const formattedTime = usePlaybackFormattedTime(timeStore);

  const applyProgress = (input: HTMLInputElement, next: number) => {
    const duration = timeStore.getDuration();
    if (duration <= 0) return;
    input.valueAsNumber = next;
    const ratio = duration > 0 ? Math.max(0, Math.min(1, next / duration)) : 0;
    if (progressBarRef.current) progressBarRef.current.style.width = `${ratio * 100}%`;
    onSeek(next);
  };

  const handleProgressInput = (event: React.FormEvent<HTMLInputElement>) => {
    if (progressPointerId.current === null) applyProgress(event.currentTarget, event.currentTarget.valueAsNumber);
  };

  const applyVolume = (input: HTMLInputElement, next: number) => {
    input.valueAsNumber = next;
    input.style.setProperty('--audio-player-volume', `${next * 100}%`);
    onSetVolume(next);
  };

  const cycleMode = () => {
    const idx = MODE_CYCLE.indexOf(mode);
    onSetMode(MODE_CYCLE[(idx + 1) % MODE_CYCLE.length]);
  };

  const handleVolumeInput = (event: React.FormEvent<HTMLInputElement>) => {
    if (volumePointerId.current === null) applyVolume(event.currentTarget, event.currentTarget.valueAsNumber);
  };

  const displayedVolume = muted ? 0 : volume;

  return (
    <div className="audio-player-controls">
      <div className="audio-player-buttons">
        {showModeButton && (
          <button type="button" className="audio-player-btn" onClick={cycleMode} title={t(MODE_LABEL_KEYS[mode])}>
            <Icon icon={MODE_ICONS[mode]} />
          </button>
        )}
        {showTrackButtons && (
          <button type="button" className="audio-player-btn" onClick={onPrev} title={t('media.prevTrack')}>
            <Icon icon="ri:skip-back-line" />
          </button>
        )}
        <button
          type="button"
          className={cn('audio-player-btn audio-player-btn-play', loading && 'loading')}
          onClick={onTogglePlay}
          title={playing ? t('media.pause') : t('media.play')}
        >
          {loading ? (
            <Icon icon="ri:loader-4-line" className="animate-spin" />
          ) : playing ? (
            <Icon icon="ri:pause-large-line" />
          ) : (
            <Icon icon="ri:play-large-fill" />
          )}
        </button>
        {showTrackButtons && (
          <button type="button" className="audio-player-btn" onClick={onNext} title={t('media.nextTrack')}>
            <Icon icon="ri:skip-forward-line" />
          </button>
        )}

        {extraButtons}

        <div className="audio-player-volume-group">
          <button type="button" className="audio-player-btn" onClick={onToggleMute} title={t('media.mute')}>
            <Icon icon={getVolumeIcon(volume, muted)} />
          </button>
          <input
            type="range"
            className="audio-player-volume"
            min={0}
            max={1}
            step={0.01}
            value={displayedVolume}
            onInput={handleVolumeInput}
            onPointerDown={(event) => {
              if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
              event.preventDefault();
              volumePointerId.current = event.pointerId;
              event.currentTarget.setPointerCapture(event.pointerId);
              applyVolume(event.currentTarget, rangeValueAtPointer(event.currentTarget, event.clientX));
            }}
            onPointerMove={(event) => {
              if (volumePointerId.current !== event.pointerId) return;
              applyVolume(event.currentTarget, rangeValueAtPointer(event.currentTarget, event.clientX));
            }}
            onPointerUp={(event) => {
              if (volumePointerId.current !== event.pointerId) return;
              applyVolume(event.currentTarget, rangeValueAtPointer(event.currentTarget, event.clientX));
              volumePointerId.current = null;
            }}
            onPointerCancel={() => {
              volumePointerId.current = null;
            }}
            onLostPointerCapture={() => {
              volumePointerId.current = null;
            }}
            style={{ '--audio-player-volume': `${displayedVolume * 100}%` } as CSSProperties}
            aria-label={t('media.volume', { percent: String(Math.round(displayedVolume * 100)) })}
            title={t('media.volume', { percent: String(Math.round(displayedVolume * 100)) })}
          />
          <output className="audio-player-volume-value" aria-live="polite">
            {Math.round(displayedVolume * 100)}%
          </output>
        </div>
      </div>

      <div className="audio-player-progress-row">
        <div className="audio-player-progress">
          <div ref={progressBarRef} className="audio-player-progress-bar" style={{ width: '0%' }} />
          <input
            ref={sliderRef}
            className="audio-player-progress-input"
            type="range"
            min={0}
            max={Math.max(timeStore.getDuration(), 1)}
            step={0.1}
            defaultValue={timeStore.getCurrentTime()}
            aria-label={t('media.progress')}
            onPointerDown={(event) => {
              if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
              event.preventDefault();
              progressPointerId.current = event.pointerId;
              event.currentTarget.dataset.scrubbing = 'true';
              event.currentTarget.setPointerCapture(event.pointerId);
              applyProgress(event.currentTarget, rangeValueAtPointer(event.currentTarget, event.clientX));
            }}
            onPointerMove={(event) => {
              if (progressPointerId.current !== event.pointerId) return;
              applyProgress(event.currentTarget, rangeValueAtPointer(event.currentTarget, event.clientX));
            }}
            onPointerUp={(event) => {
              if (progressPointerId.current !== event.pointerId) return;
              applyProgress(event.currentTarget, rangeValueAtPointer(event.currentTarget, event.clientX));
              progressPointerId.current = null;
              delete event.currentTarget.dataset.scrubbing;
            }}
            onPointerCancel={(event) => {
              progressPointerId.current = null;
              delete event.currentTarget.dataset.scrubbing;
            }}
            onLostPointerCapture={(event) => {
              progressPointerId.current = null;
              delete event.currentTarget.dataset.scrubbing;
            }}
            onBlur={(event) => {
              progressPointerId.current = null;
              delete event.currentTarget.dataset.scrubbing;
            }}
            onInput={handleProgressInput}
          />
        </div>
        <output className="audio-player-time-value" aria-live="off">
          {formattedTime}
        </output>
      </div>
    </div>
  );
});
