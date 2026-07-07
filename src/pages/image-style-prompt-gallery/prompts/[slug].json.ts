import { getStyleGalleryItems, getStyleGallerySlug } from '@lib/style-gallery';
import type { APIRoute, GetStaticPaths } from 'astro';

export const getStaticPaths = (async () => {
  const items = await getStyleGalleryItems();

  return items.map((item) => ({
    params: { slug: getStyleGallerySlug(item) },
    props: {
      prompt: item.data.prompt,
      title: item.data.title,
    },
  }));
}) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) => {
  return new Response(
    JSON.stringify({
      title: props.title,
      prompt: props.prompt,
    }),
    {
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
    },
  );
};
