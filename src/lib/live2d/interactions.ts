import type { Live2DInteraction } from './types';

export interface ResolvedLive2DInteraction {
  mapping: Live2DInteraction;
  line: string;
  audio?: string;
}

function normalizedArea(value: string): string {
  return value.trim().toLocaleLowerCase('en-US');
}

/** Unknown hit areas degrade to the first mapping; dialogue text and audio remain an atomic pair. */
export function resolveLive2DInteraction(
  interactions: readonly Live2DInteraction[],
  area: string,
  random: () => number = Math.random,
  dialogueInteractions?: readonly Live2DInteraction[],
): ResolvedLive2DInteraction | null {
  const requested = normalizedArea(area);
  const exact = interactions.filter((candidate) => normalizedArea(candidate.area) === requested);
  const mappings = exact.length > 0 ? exact : interactions.slice(0, 1);
  const mapping = mappings[Math.min(mappings.length - 1, Math.max(0, Math.floor(random() * mappings.length)))];
  if (!mapping) return null;
  const dialogueSource = dialogueInteractions ?? mappings;
  const exactDialogues = dialogueSource.filter((candidate) => normalizedArea(candidate.area) === requested);
  const dialogueMappings = exactDialogues.length > 0 ? exactDialogues : dialogueSource.slice(0, 1);
  const choices = dialogueMappings.flatMap((candidate) =>
    candidate.dialogues
      ? candidate.dialogues.map((dialogue) => ({ mapping, line: dialogue.text.trim(), audio: dialogue.audio }))
      : (candidate.lines ?? []).map((line) => ({ mapping, line: line.trim(), audio: candidate.audio })),
  );
  const visibleChoices = choices.filter((choice) => choice.line.length > 0);
  if (visibleChoices.length === 0) return null;
  const index = Math.min(visibleChoices.length - 1, Math.max(0, Math.floor(random() * visibleChoices.length)));
  return visibleChoices[index] ?? visibleChoices[0];
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
