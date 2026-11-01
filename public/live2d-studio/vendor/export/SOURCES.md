# Local export encoders

- `gifenc-1.0.3.js`: unmodified ESM build from https://unpkg.com/gifenc@1.0.3/dist/gifenc.esm.js ; source https://github.com/mattdesl/gifenc ; MIT license in `gifenc-LICENSE.txt`.
- `mp4-muxer-5.2.2.js`: unmodified ESM build from https://unpkg.com/mp4-muxer@5.2.2/build/mp4-muxer.mjs ; source https://github.com/Vanilagy/mp4-muxer/tree/v5.2.2 ; MIT license in `mp4-muxer-LICENSE.txt`.

Retrieved 2026-10-30 through the existing proxy environment. These unmodified builds are served locally and imported only when exporting; no package or lockfile changes.

The first published workbench retains the tested mp4-muxer build for its bounded, in-memory H.264 export. Upstream has deprecated it in favor of Mediabunny: it is a compatibility choice, not a maintained general-purpose video pipeline. Reassess this dependency before adding codecs, streaming or audio, and test exported files when replacing it. GIF uses a fixed palette with binary transparency; MP4 has no alpha/audio and flattens onto the chosen background color.
