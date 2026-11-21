import React, { useEffect, useState } from 'react';
import { Image, type ImageResizeMode, type ImageStyle, type StyleProp } from 'react-native';

// A photo from the network that falls back to the given placeholder when there is no
// address or it can't be loaded (offline, or the plant is no longer public). The caption
// (e.g. "From plant NIAH-PLT-00012") shows only while the photo does.
export default function RemotePhoto({
  uri,
  style,
  placeholder,
  caption = null,
  resizeMode = 'cover',
}: {
  uri: string | null;
  style: StyleProp<ImageStyle>;
  placeholder: React.ReactElement;
  caption?: React.ReactElement | null;
  resizeMode?: ImageResizeMode;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);
  if (!uri || failed) return placeholder;
  return (
    <>
      <Image
        source={{ uri }}
        style={style}
        resizeMode={resizeMode}
        onError={() => setFailed(true)}
        accessibilityIgnoresInvertColors
      />
      {caption}
    </>
  );
}
