import React from 'react';
import { InputAccessoryView, Keyboard, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

// iOS number pads and multiline inputs have no key that closes the keyboard.
// Render this once per screen and give those inputs inputAccessoryViewID={nativeID}
// to get a "Done" bar above the keyboard. Renders nothing on Android, where the
// keyboard always has its own close/back control.
export default function KeyboardDoneBar({ nativeID }: { nativeID: string }) {
  if (Platform.OS !== 'ios') return null;

  return (
    <InputAccessoryView nativeID={nativeID}>
      <View style={styles.bar}>
        <TouchableOpacity onPress={() => Keyboard.dismiss()} hitSlop={10}>
          <Text style={styles.done}>Done</Text>
        </TouchableOpacity>
      </View>
    </InputAccessoryView>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#F1F3F2',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#C9D1CC',
  },
  done: { fontSize: 16, fontWeight: '700', color: '#213B2A' },
});
