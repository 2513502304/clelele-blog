import type { Live2DInteraction } from './types';

const MIN_TEXT_DIALOGUE_DURATION_MS = 5_000;
const MAX_TEXT_DIALOGUE_DURATION_MS = 10_000;

export interface ResolvedLive2DInteraction {
  mapping: Live2DInteraction;
  line: string;
  audio?: string;
}

interface ResolvedInteractionSource extends ResolvedLive2DInteraction {
  fromDialogueSource: boolean;
}

export interface ResolvedLive2DPlayback extends Omit<ResolvedLive2DInteraction, 'audio'> {
  audio?: {
    path: string;
    releaseId: string;
  };
}

export interface ResolveLive2DPlaybackOptions {
  mappingInteractions: readonly Live2DInteraction[];
  mappingReleaseId: string;
  dialogueSource?: {
    interactions: readonly Live2DInteraction[];
    releaseId: string;
  };
  /** A declared character voice pack is loading, so legacy costume audio must not leak into the result. */
  suppressMappingAudio?: boolean;
}

function normalizedArea(value: string): string {
  return value.trim().toLocaleLowerCase('en-US');
}

/** Text-only bubbles get a bounded reading window; voiced bubbles are closed by audio.onended instead. */
export function textDialogueDuration(text: string): number {
  const visibleCharacters = [...text.replace(/\s/g, '')].length;
  return Math.min(MAX_TEXT_DIALOGUE_DURATION_MS, Math.max(MIN_TEXT_DIALOGUE_DURATION_MS, 2_500 + visibleCharacters * 120));
}

/** Unknown hit areas degrade to the first mapping; dialogue text and audio remain an atomic pair. */
function resolveLive2DInteractionSource(
  interactions: readonly Live2DInteraction[],
  area: string,
  random: () => number = Math.random,
  dialogueInteractions?: readonly Live2DInteraction[],
): ResolvedInteractionSource | null {
  const requested = normalizedArea(area);
  const exact = interactions.filter((candidate) => normalizedArea(candidate.area) === requested);
  const mappings = exact.length > 0 ? exact : interactions.slice(0, 1);
  const mapping = mappings[Math.min(mappings.length - 1, Math.max(0, Math.floor(random() * mappings.length)))];
  if (!mapping) return null;
  const visibleChoicesFrom = (source: readonly Live2DInteraction[]) => {
    const exactDialogues = source.filter((candidate) => normalizedArea(candidate.area) === requested);
    const dialogueMappings = exactDialogues.length > 0 ? exactDialogues : source.slice(0, 1);
    return dialogueMappings
      .flatMap((candidate) =>
        candidate.dialogues
          ? candidate.dialogues.map((dialogue) => ({ mapping, line: dialogue.text.trim(), audio: dialogue.audio }))
          : (candidate.lines ?? []).map((line) => ({ mapping, line: line.trim(), audio: candidate.audio })),
      )
      .filter((choice) => choice.line.length > 0);
  };
  const dialogueChoices = dialogueInteractions ? visibleChoicesFrom(dialogueInteractions) : [];
  const fromDialogueSource = dialogueChoices.length > 0;
  const visibleChoices = fromDialogueSource ? dialogueChoices : visibleChoicesFrom(mappings);
  if (visibleChoices.length === 0) return null;
  const index = Math.min(visibleChoices.length - 1, Math.max(0, Math.floor(random() * visibleChoices.length)));
  const choice = visibleChoices[index] ?? visibleChoices[0];
  return choice ? { ...choice, fromDialogueSource } : null;
}

export function resolveLive2DInteraction(
  interactions: readonly Live2DInteraction[],
  area: string,
  random: () => number = Math.random,
  dialogueInteractions?: readonly Live2DInteraction[],
): ResolvedLive2DInteraction | null {
  const resolved = resolveLive2DInteractionSource(interactions, area, random, dialogueInteractions);
  if (!resolved) return null;
  const { fromDialogueSource: _fromDialogueSource, ...interaction } = resolved;
  return interaction;
}

/**
 * Resolves visible text and its audio release in one operation. This prevents a character-wide
 * dialogue from being played against the currently selected costume's unrelated audio package.
 */
export function resolveLive2DPlayback(
  options: ResolveLive2DPlaybackOptions,
  area: string,
  random: () => number = Math.random,
): ResolvedLive2DPlayback | null {
  const resolved = resolveLive2DInteractionSource(
    options.mappingInteractions,
    area,
    random,
    options.dialogueSource?.interactions,
  );
  if (!resolved) return null;
  const releaseId = resolved.fromDialogueSource ? options.dialogueSource?.releaseId : options.mappingReleaseId;
  return {
    mapping: resolved.mapping,
    line: resolved.line,
    ...(!resolved.audio || (options.suppressMappingAudio && !resolved.fromDialogueSource)
      ? {}
      : { audio: { path: resolved.audio, releaseId: releaseId ?? options.mappingReleaseId } }),
  };
}

/**
 * Interaction generations prevent a late audio/dialogue completion from mutating a newly selected model.
 */
export class Live2DInteractionGeneration {
  private value = 0;

  next(): number {
    this.value += 1;
    return this.value;
  }

  invalidate(): void {
    this.value += 1;
  }

  isCurrent(generation: number): boolean {
    return generation === this.value;
  }
}
