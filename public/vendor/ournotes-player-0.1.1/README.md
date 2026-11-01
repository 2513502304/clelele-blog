# Our Notes browser runtime

`ournotes-player.live2d.min.js` and its source map are the unmodified browser distribution from `ournotes-player@0.1.1` (https://www.npmjs.com/package/ournotes-player). The package tarball integrity was verified before extraction. The included `LICENSE` and `LICENSE-EXCEPTION` govern this distribution; the exception permits linking this unmodified browser artifact into an independent frontend. Source and fidelity notes: https://github.com/empty-sekai/ournotes-player.

`live2dcubismcore.min.js` is the unmodified official Cubism Core browser runtime retrieved from https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js on 2026-10-29. Its embedded notice identifies it as Redistributable Code under the Live2D Proprietary Software License: https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html . Model artwork remains the property of its respective rights holders.

These files are deliberately served as separate, lazy browser resources. Do not reformat or embed them in the application bundle. The adapter in `src/lib/live2d/our-notes-renderer.ts` owns loading, a bounded animation clock and disposal; the regular blog shell does not fetch this directory.
