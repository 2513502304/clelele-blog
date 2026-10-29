# Our Notes Live2D and a focused creation studio

The blog keeps its lightweight character companion and adds a deliberately opened studio. Existing Bestdori models, visitor preferences, gallery rendering and theme settings retain their behavior.

## Implementation

1. Compare Bestdori's five region indexes with the previous local snapshot and HF catalog; publish missing releases through the existing verified publisher. Import the union of bdon's model and international/JP story indexes by stable model ID. Prefer the smaller story representation, retain immutable provenance, and keep existing catalog entries through CAS updates.
2. Load the unmodified, pinned Our Notes browser runtime only for native Our Notes packages. Reuse the existing canvas and renderer lifecycle. Pause all work when hidden, serialize model replacement, abort abandoned downloads, and retain browser/CDN caching. Package complete native assets including split/compressed JSON and game shaders; do not convert away game rendering behavior.
3. Add a source filter to the model selector. Add a lazy large studio dialog with a roomy stage and a compact editing rail: motions, expressions, searchable parameter overrides, original/paper/film/monochrome filters, background and dialogue composition, PNG export and per-model pose JSON import/export. Use the existing blog typography, theme colors, rounded controls and accessible dialogs. Move the persistent canvas host into the stage and restore it on close instead of loading a second model.
4. Validate package integrity, catalog merging, runtime switching/cleanup, parameter clamping and pose identity. Exercise old and new models in the browser, including mobile, reopening the studio, dark theme, screenshots and network behavior. Run targeted tests, lint, Astro check and build sequentially; run CE review before shipping.

## Decisions

- bdon's published native model set is the resource source; sakiko.app is a UX reference. Do not copy either site's UI or editor implementation. The native set currently covers all 241 models in sakiko.app plus 20 newer variants.
- Keep resources in the existing HF immutable Live2D store. Its historical `bestdori` prefix is a storage path, not a claim about provenance.
- Keep the full editor out of normal page startup. No video recorder, timeline, Blender workflow, AI service, tracking or microphone access is added.
- Preserve the original game assets and runtime license notices. Existing voice packs must not be silently applied to unrelated new characters.

## Verification contract

- A native package cannot publish without every declared file, safe relative references and exact byte/hash verification.
- HF catalog contains the imported source IDs exactly once and preserves existing releases.
- An old model still renders; a new model renders nonblank with game motions/expressions. A model change releases the previous session.
- Studio open/close does not fetch or instantiate the current model again. Hidden/paused rendering has no animation loop.
- Parameter and composition changes stay local; exported poses reject another model and malformed values; PNG export includes the chosen visual treatment.
- Resource and feature documentation records source counts, availability failures, licensing and measured verification limits.
