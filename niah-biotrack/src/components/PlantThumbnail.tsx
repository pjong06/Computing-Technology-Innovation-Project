import React, { useEffect, useState } from 'react';
import { Image, type ImageResizeMode, type ImageStyle, type StyleProp } from 'react-native';
import { cachedThumbnail, downloadThumbnail } from '../services/thumbnailCache';
import { usePlantListStore } from '../store/usePlantListStore';
import { firstStep, onSourceFailed, type ThumbnailSource } from '../utils/thumbnailSources';

// A plant's picture from the first source that works (thumbnailSources: phone photo →
// signed server thumbnail → public copy), else the placeholder. Remote pictures are
// downloaded once and kept on the phone (thumbnailCache), so scrolling back shows them at
// once. A signed link that has expired or fails makes the list fetch fresh links once
// (usePlantListStore); after that the next source is tried. The caption (e.g. "From plant
// NIAH-PLT-00012") shows only while a picture does.
export default function PlantThumbnail({
  sources,
  style,
  placeholder,
  caption = null,
  resizeMode = 'cover',
}: {
  sources: ThumbnailSource[];
  style: StyleProp<ImageStyle>;
  placeholder: React.ReactElement;
  caption?: React.ReactElement | null;
  resizeMode?: ImageResizeMode;
}) {
  const sourcesKey = sources.map((source) => `${source.kind}|${source.cacheKey ?? ''}|${source.uri}|${source.expired}`).join('\n');
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState<string | null>(null);

  // New sources (e.g. fresh signed links): start again from the first.
  useEffect(() => setIndex(0), [sourcesKey]);

  useEffect(() => {
    let cancelled = false;
    const source = sources[index];
    if (!source) {
      setShown(null);
      return undefined;
    }
    const store = usePlantListStore.getState();
    const step = firstStep(
      source,
      source.cacheKey ? cachedThumbnail(source.cacheKey) : null,
      store.refreshedForExpiry
    );
    if (step.action === 'show') {
      setShown(step.uri);
      return undefined;
    }
    setShown(null);
    const failed = () => {
      if (cancelled) return;
      const latest = usePlantListStore.getState();
      if (onSourceFailed(source, latest.refreshedForExpiry) === 'refresh') void latest.refreshExpiredThumbnails();
      setIndex((current) => current + 1);
    };
    if (step.action === 'skip') {
      if (step.refresh) void store.refreshExpiredThumbnails();
      setIndex((current) => current + 1);
      return undefined;
    }
    downloadThumbnail(step.cacheKey, step.uri).then(
      (uri) => {
        if (!cancelled) setShown(uri);
      },
      failed
    );
    return () => {
      cancelled = true;
    };
    // sourcesKey stands for sources.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourcesKey, index]);

  if (!shown) return placeholder;
  return (
    <>
      <Image
        source={{ uri: shown }}
        style={style}
        resizeMode={resizeMode}
        onError={() => setIndex((current) => current + 1)}
        accessibilityIgnoresInvertColors
      />
      {caption}
    </>
  );
}
