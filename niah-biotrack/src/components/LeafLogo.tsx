import React from 'react';
import { View, Image, StyleSheet } from 'react-native';

interface LeafLogoProps {
  width?: number;
  height?: number;
  marginBottom?: number;
}

export default function LeafLogo({ width = 110, height = 70, marginBottom = 16 }: LeafLogoProps) {
  return (
    <View style={[styles.container, { marginBottom }]}>
      <Image
        source={require('../../assets/logo.png')}
        style={{ width, height }}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});