import { useEffect } from 'react';

interface OgTagsProps {
  title: string;
  description: string;
  imageUrl: string | null;
  pageUrl: string;
}

export const OgTags = ({ title, description, imageUrl, pageUrl }: OgTagsProps) => {
  useEffect(() => {
    const created: HTMLMetaElement[] = [];

    const upsertMeta = (
      attrKey: 'property' | 'name',
      attrValue: string,
      content: string,
    ) => {
      const selector = `meta[${attrKey}="${attrValue}"]`;
      let el = document.head.querySelector<HTMLMetaElement>(selector);
      if (el) {
        el.setAttribute('content', content);
      } else {
        el = document.createElement('meta');
        el.setAttribute(attrKey, attrValue);
        el.setAttribute('content', content);
        document.head.appendChild(el);
        created.push(el);
      }
    };

    upsertMeta('property', 'og:title', title);
    upsertMeta('property', 'og:description', description);
    upsertMeta('property', 'og:url', pageUrl);
    upsertMeta('property', 'og:type', 'website');
    if (imageUrl !== null) {
      upsertMeta('property', 'og:image', imageUrl);
    }
    upsertMeta('name', 'twitter:card', 'summary_large_image');
    upsertMeta('name', 'twitter:title', title);
    upsertMeta('name', 'twitter:description', description);

    return () => {
      created.forEach((el) => {
        if (el.parentNode) {
          el.parentNode.removeChild(el);
        }
      });
    };
  }, [title, description, imageUrl, pageUrl]);

  return null;
};
