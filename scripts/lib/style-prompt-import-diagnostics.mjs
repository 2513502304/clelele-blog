/** Keep records, cards, prompts and files distinct. Plans are estimates; write results are acknowledgements. */
export function describeImportPlan(prepared, existingByHash, metadataOnly = false) {
  const newItems = prepared.items.filter((item) => !existingByHash.has(item.imageHash));
  const existingItems = prepared.items.filter((item) => existingByHash.has(item.imageHash));
  const count = (items) => items.reduce((sum, item) => sum + item.prompts.length, 0);
  const additional = prepared.recordDetails.filter((detail) => detail.kind === 'variant').length;
  const lines = [
    `\n[Plan] ${prepared.sourceSlugs.length} distinct card(s) touched; ${count(prepared.items)} candidate prompt(s) to write.`,
    `  New cards: ${newItems.length}, with ${count(newItems)} prompt(s). Existing cards: ${existingItems.length}, with ${count(existingItems)} ${metadataOnly ? 'replacement' : 'additional'} prompt(s).`,
    `  Duplicate skipped: ${prepared.skippedDuplicates} identical image/prompt record(s); no image or prompt write for these records. Tags may still change.`,
    `  ${metadataOnly ? 'Replacement' : 'Additional'} prompt records: ${additional} (same image, different prompt; published cards or earlier records in this session).`,
  ];
  const ordinals = { duplicate: 0, variant: 0 };
  for (const detail of prepared.recordDetails) {
    const previous = detail.previousLine ? `session image line ${detail.previousLine}` : 'published card';
    const label = detail.kind === 'duplicate' ? 'Duplicate skipped' : metadataOnly ? 'Replacement prompt' : 'Additional prompt';
    lines.push(
      `  ${label} [${++ordinals[detail.kind]}]: ${detail.slug}; image line ${detail.sourceLine ?? '?'}, prompt line ${detail.promptLine ?? '?'}; matches ${previous}.`,
    );
  }
  return lines.join('\n');
}

/** The metadata endpoint preserves existing images; image migration is a separate preceding stage. */
export function describeMetadataWrite(result, migratedHashes = new Set()) {
  const both = (result.items ?? []).filter((item) => migratedHashes.has(item.imageHash)).length;
  return `${result.created ?? 0} new card(s); ${result.updated ?? 0} existing card(s) with prompt changes (${(result.updated ?? 0) - both} prompt-only, ${both} also image-replaced earlier); ${result.addedPrompts ?? 0} prompt(s) added; ${result.skippedDuplicates ?? 0} duplicate prompt(s) skipped. Image replacements in this metadata batch: 0.`;
}
