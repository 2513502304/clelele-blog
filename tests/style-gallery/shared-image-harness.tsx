import { createRoot } from 'react-dom/client';
import StyleGallerySharedImage from '../../src/components/style-gallery/StyleGallerySharedImage';

/** Exercise real React mount identity while preserving the gallery's load history. */
export function mountSharedImageHarness(source: string) {
  const host = document.createElement('div');
  host.id = 'shared-image-harness';
  document.body.replaceChildren(host);
  const root = createRoot(host);
  const loadedSources = new Set<string>();
  let key = 0;
  const render = () =>
    root.render(
      <>
        <StyleGallerySharedImage key={key} source={source} loadedSources={loadedSources} alt="Expiry fixture" />
        <button type="button" onClick={render}>
          Rerender
        </button>
        <button
          type="button"
          onClick={() => {
            if (!loadedSources.has(source)) throw new Error('Image must load before remounting');
            key += 1;
            render();
          }}
        >
          Remount
        </button>
      </>,
    );
  render();
}
