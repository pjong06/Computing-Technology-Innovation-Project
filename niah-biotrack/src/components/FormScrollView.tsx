import React from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  type ScrollViewProps,
} from 'react-native';

// Scroll container for any screen with text inputs. Use it instead of ScrollView on
// every form so the keyboard behaves the same everywhere:
// - Dragging the content hides the keyboard, so lower fields can be reached
//   (iOS: "interactive", the keyboard follows the finger down; Android: "on-drag").
// - Tapping empty space hides the keyboard (Keyboard.dismiss below). Taps on buttons
//   and inputs still work while the keyboard is open (keyboardShouldPersistTaps).
// - The focused field scrolls into view above the keyboard:
//   iOS: the ScrollView adds bottom inset for the keyboard (automaticallyAdjustKeyboardInsets).
//   Android: KeyboardAvoidingView shrinks the area above the keyboard. Android apps are
//   always edge-to-edge since SDK 58, so the window no longer resizes on its own.
// Number pads still need KeyboardDoneBar on iOS: they have no key that closes them.
export default function FormScrollView({ children, style, contentContainerStyle, ...props }: ScrollViewProps) {
  const scrollView = (
    <ScrollView
      style={[styles.flex, style]}
      // flexGrow: short forms still fill the screen, so a tap below the last field
      // lands on the Pressable and closes the keyboard.
      contentContainerStyle={styles.grow}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      automaticallyAdjustKeyboardInsets
      showsVerticalScrollIndicator={false}
      {...props}
    >
      {/* The screen's contentContainerStyle goes here, so its padding and centring
          apply to the fields exactly as before. accessible={false}: screen readers
          see the fields, not one big button. */}
      <Pressable style={[styles.grow, contentContainerStyle]} onPress={Keyboard.dismiss} accessible={false}>
        {children}
      </Pressable>
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
  grow: { flexGrow: 1 },
});
