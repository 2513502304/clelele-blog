# Local poster display fonts

These Latin WOFF2 subsets are bundled for the Live2D workbench. The font software remains under each accompanying SIL Open Font License 1.1. Files are unmodified downloads; local filenames and CSS family aliases describe their use in the editor. Chinese font subsets and licenses are documented separately in `CJK-SOURCES.md`.

| Family | Weight | Bytes | Original font URL | License |
| --- | ---: | ---: | --- | --- |
| Bodoni Moda | 700 (optical-size variable) | 27,312 | https://fonts.gstatic.com/s/bodonimoda/v28/aFTH7PxzY382XsXX63LUYL6GYFksw-NIrKp-S_31KOxQVAS1Eg.woff2 | [Bodoni-Moda-OFL.txt](Bodoni-Moda-OFL.txt), https://raw.githubusercontent.com/google/fonts/main/ofl/bodonimoda/OFL.txt |
| Barlow Condensed | 800 | 14,764 | https://fonts.gstatic.com/s/barlowcondensed/v13/HTxwL3I-JCGChYJ8VI-L6OO_au7B47b1z3bWuYMBYro.woff2 | [Barlow-Condensed-OFL.txt](Barlow-Condensed-OFL.txt), https://raw.githubusercontent.com/google/fonts/main/ofl/barlowcondensed/OFL.txt |
| Allura | 400 | 26,464 | https://fonts.gstatic.com/s/allura/v23/9oRPNYsQpS4zjuA_iwgWHNn7GQ.woff2 | [Allura-OFL.txt](Allura-OFL.txt), https://raw.githubusercontent.com/google/fonts/main/ofl/allura/OFL.txt |
| Fredoka | 600 | 16,464 | https://fonts.gstatic.com/s/fredoka/v17/X7nP4b87HvSqjb_WIi2yDCRwoQ_k7367_B-i2yQag0-mac3OLyX8EemKttxNbikt.woff2 | [Fredoka-OFL.txt](Fredoka-OFL.txt), https://raw.githubusercontent.com/google/fonts/main/ofl/fredoka/OFL.txt |

Total Latin font payload: 85,004 bytes. Retrieved and independently license-checked on 2026-10-30. The UI loads `poster-fonts.css`, then awaits `ensurePosterFonts(layers)` before rasterizing previews or exports. Chinese text can fall back to the blog's existing local 寒蝉全圆体.
