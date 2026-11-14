import React from 'react';
import { StyleSheet, Text } from 'react-native';
import type { SpeciesMedia } from '../api/species';

const LICENCES = {
  'cc-by': 'CC BY',
  'cc-by-sa': 'CC BY-SA',
  cc0: 'CC0',
};

interface SpeciesPhotoCreditProps {
  photo: SpeciesMedia | null | undefined;
  compact?: boolean;
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
      {`Photo: ${name}, ${licence ?? 'Unknown licence'} via iNaturalist`}
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
