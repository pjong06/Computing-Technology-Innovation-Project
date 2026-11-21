import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SpeciesMedia } from '../api/species';
import { needsPhotoCredit, photoCreditText } from '../utils/photoCredit';

interface PhotoCreditInfoProps {
  photo: SpeciesMedia | null | undefined;
}

// A small "i" in the bottom-right corner of a photo on a detail screen. Tapping it shows the
// plain-text credit "Photo: <name>, <licence> via iNaturalist" (no links); tap again to hide.
// Nothing is shown for CC0 photos or SFC's own photos. Place it inside the photo's View.
export default function PhotoCreditInfo({ photo }: PhotoCreditInfoProps) {
  const [open, setOpen] = useState(false);
  if (!needsPhotoCredit(photo)) return null;
  const text = photoCreditText(photo!);

  return (
    <View style={styles.corner} pointerEvents="box-none">
      {open ? (
        <View style={styles.bubble} accessibilityRole="text">
          <Text style={styles.bubbleText}>{text}</Text>
        </View>
      ) : null}
      <Pressable
        onPress={() => setOpen((value) => !value)}
        hitSlop={10}
        style={styles.button}
        accessibilityRole="button"
        accessibilityLabel={open ? 'Hide photo credit' : 'Show photo credit'}
        accessibilityHint={text}
      >
        <Text style={styles.buttonText}>i</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  corner: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    alignItems: 'flex-end',
    maxWidth: '85%',
  },
  bubble: {
    backgroundColor: 'rgba(0,0,0,0.78)',
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 6,
  },
  bubbleText: {
    color: '#FFFFFF',
    fontSize: 12,
    lineHeight: 16,
  },
  button: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    fontStyle: 'italic',
  },
});
