import type { Live2DInteraction } from './types';

export interface ResolvedLive2DInteraction {
  mapping: Live2DInteraction;
  line: string;
}

function normalizedArea(value: string): string {
  return value.trim().toLocaleLowerCase('en-US');
}

/** Unknown or absent hit-area names degrade to the first configured interaction. */
export function resolveLive2DInteraction(
  interactions: readonly Live2DInteraction[],
  area: string,
  random: () => number = Math.random,
): ResolvedLive2DInteraction | null {
  const requested = normalizedArea(area);
  const mapping = interactions.find((candidate) => normalizedArea(candidate.area) === requested) ?? interactions[0];
  if (!mapping) return null;
  const index = Math.min(mapping.lines.length - 1, Math.max(0, Math.floor(random() * mapping.lines.length)));
  return { mapping, line: mapping.lines[index] ?? mapping.lines[0] };
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
