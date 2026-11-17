import React from 'react';
import { StyleSheet, Text } from 'react-native';
import type { SpeciesMedia } from '../api/species';
import { photoCreditText } from '../utils/photoCredit';

interface SpeciesPhotoCreditProps {
  photo: SpeciesMedia | null | undefined;
  compact?: boolean;
}

export default function SpeciesPhotoCredit({
  photo,
  compact = false,
}: SpeciesPhotoCreditProps) {
  if (!photo || photo.source !== 'inaturalist') return null;

  // "Photo: <name>, <licence> via iNaturalist" (never the whole attribution sentence).
  return (
    <Text style={[styles.credit, compact && styles.compact]}>
      {photoCreditText(photo)}
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
});
