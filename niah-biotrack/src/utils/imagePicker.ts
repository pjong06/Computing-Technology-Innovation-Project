import * as ImagePicker from 'expo-image-picker';

// One place for every camera / gallery launch, so all screens behave the same.
//
// Why these options (expo-image-picker 57, iOS):
// - allowsEditing: false. With true, the gallery switches from the system photo
//   picker (PHPickerViewController) to the legacy UIImagePickerController and the
//   status bar is hidden while it's open. iOS crops square regardless of `aspect`.
// - allowsMultipleSelection: false. A single tap picks the image and closes the
//   picker; Cancel is in the picker's own top bar.
// - presentationStyle: FULL_SCREEN, so the picker's navigation bar (Cancel) is
//   always fully visible instead of sitting in a sheet over our screen.
// - No media-library permission request: the system photo picker doesn't need it,
//   and asking for it can trigger iOS's separate "limited access" photo selector.
// Never launch these from inside an Alert button: the picker would be presented
// while the alert is still closing.
const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: false,
  allowsMultipleSelection: false,
  quality: 0.8,
  presentationStyle: ImagePicker.UIImagePickerPresentationStyle.FULL_SCREEN,
};

export type PickImageResult =
  | { status: 'picked'; asset: ImagePicker.ImagePickerAsset }
  | { status: 'canceled' }
  | { status: 'permission-denied' }
  | { status: 'error' };

// Guards against a second picker being launched by a double tap.
let pickerOpen = false;

async function runPicker(launch: () => Promise<ImagePicker.ImagePickerResult>): Promise<PickImageResult> {
  if (pickerOpen) return { status: 'canceled' };
  pickerOpen = true;
  try {
    const result = await launch();
    const asset = result.canceled ? undefined : result.assets?.[0];
    return asset ? { status: 'picked', asset } : { status: 'canceled' };
  } catch {
    return { status: 'error' };
  } finally {
    pickerOpen = false;
  }
}

export function pickImageFromLibrary(): Promise<PickImageResult> {
  return runPicker(() => ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS));
}

export async function takePhotoWithCamera(): Promise<PickImageResult> {
  try {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { status: 'permission-denied' };
  } catch {
    return { status: 'error' };
  }
  return runPicker(() => ImagePicker.launchCameraAsync(PICKER_OPTIONS));
}
