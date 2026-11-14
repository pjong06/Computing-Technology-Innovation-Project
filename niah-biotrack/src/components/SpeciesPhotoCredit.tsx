import React from 'react';
import { Linking, StyleSheet, Text, type GestureResponderEvent } from 'react-native';
import type { SpeciesMedia } from '../api/species';

const LICENCES = {
  'cc-by': {
    label: 'CC BY 4.0',
    url: 'https://creativecommons.org/licenses/by/4.0/',
  },
  'cc-by-sa': {
    label: 'CC BY-SA 4.0',
    url: 'https://creativecommons.org/licenses/by-sa/4.0/',
  },
  cc0: {
    label: 'CC0 1.0',
    url: 'https://creativecommons.org/publicdomain/zero/1.0/',
  },
};

interface SpeciesPhotoCreditProps {
  photo: SpeciesMedia | null | undefined;
  compact?: boolean;
}

function openUrl(event: GestureResponderEvent, url: string | null | undefined) {
  event.stopPropagation();
  if (url) void Linking.openURL(url);
}

export default function SpeciesPhotoCredit({
  photo,
  compact = false,
}: SpeciesPhotoCreditProps) {
  if (!photo || photo.source !== 'inaturalist') return null;

  const licence = photo.licence_code ? LICENCES[photo.licence_code] : undefined;
  const name = photo.photographer?.trim() || photo.attribution?.trim() || 'Unknown photographer';

  return (
    <Text style={[styles.credit, compact && styles.compact]}>
      {`Photo: ${name}, `}
      {licence ? (
        <Text
          accessibilityRole="link"
          onPress={(event) => openUrl(event, licence.url)}
          style={styles.link}
        >
          {licence.label}
        </Text>
      ) : (
        'Unknown licence'
      )}
      {' via '}
      {photo.source_url ? (
        <Text
          accessibilityRole="link"
          onPress={(event) => openUrl(event, photo.source_url)}
          style={styles.link}
        >
          iNaturalist
        </Text>
      ) : (
        'iNaturalist'
      )}
    </Text>
  );
}

const styles = StyleSheet.create({
  credit: {
    color: '#526659',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  compact: {
    fontSize: 9,
    lineHeight: 12,
  },
  link: {
    color: '#284632',
    textDecorationLine: 'underline',
  },
});
