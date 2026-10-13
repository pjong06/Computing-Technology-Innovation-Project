import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, type ScrollViewProps } from 'react-native';

// Scroll container for any screen with text inputs.
// - iOS: the ScrollView itself adds bottom inset for the keyboard and scrolls the
//   focused input into view (automaticallyAdjustKeyboardInsets), so every field
//   and the Save button stay reachable.
// - Android: KeyboardAvoidingView shrinks the area above the keyboard.
// Tapping empty space dismisses the keyboard (keyboardShouldPersistTaps="handled"),
// and so does dragging the content (keyboardDismissMode="on-drag").
export default function FormScrollView({ children, style, ...props }: ScrollViewProps) {
  const scrollView = (
    <ScrollView
      style={[styles.flex, style]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      automaticallyAdjustKeyboardInsets
      showsVerticalScrollIndicator={false}
      {...props}
    >
      {children}
    </ScrollView>
  );

  if (Platform.OS === 'ios') return scrollView;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior="height">
      {scrollView}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
