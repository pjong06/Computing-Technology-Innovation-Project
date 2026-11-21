import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, Share } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { apiDownload, apiFetch, ApiError } from '../api/client';
import { supabase } from '../lib/supabase';
import { isSyncOffline } from './syncRetry';
import {
  base64FromBytes,
  fromServer,
  tagOwnershipProblem,
  type MyTag,
  type PdfLayout,
  type ServerTagReservation,
} from '../utils/myTags';

// The botanist's own QR tags, with the existing endpoints (botanist only, own tags only):
//   GET  /api/tag-reservations                    -> the reserved tags, unused or bound
//   POST /api/tag-reservations/reserve-and-print  -> reserves N new tags, returns the PDF
//   POST /api/tag-reservations/print              -> PDF of chosen own tags
//   GET  /api/tag-reservations/:tag/image         -> PNG label of an own unused tag
//   GET  /api/plants/:id/qr/image                 -> PNG label of an own plant's tag
// The list is also kept on the phone, so a tag scanned offline can still be checked.

const CACHE_KEY = 'niah-my-qr-tags';
const OFFLINE_MESSAGE = 'You are offline. Getting tags needs the internet.';

async function signedInUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

async function saveCache(tags: MyTag[]): Promise<void> {
  const userId = await signedInUserId();
  if (!userId) return;
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ userId, savedAt: new Date().toISOString(), tags }));
}

// The list saved on this phone for the signed-in botanist, or null.
export async function cachedMyTags(): Promise<{ tags: MyTag[]; savedAt: string } | null> {
  try {
    const userId = await signedInUserId();
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!userId || !raw) return null;
    const saved = JSON.parse(raw) as { userId?: string; savedAt?: string; tags?: MyTag[] };
    if (saved.userId !== userId || !Array.isArray(saved.tags)) return null;
    return { tags: saved.tags, savedAt: saved.savedAt ?? '' };
  } catch {
    return null;
  }
}

// Every tag this botanist reserved (all pages), saved on the phone too.
export async function fetchMyTags(): Promise<MyTag[]> {
  const rows: ServerTagReservation[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const response = await apiFetch<{ data: ServerTagReservation[]; pagination: { total_pages: number } }>(
      `/api/tag-reservations?page=${page}&page_size=100`
    );
    rows.push(...(response.data ?? []));
    if (page >= (response.pagination?.total_pages ?? 1)) break;
  }
  const tags = fromServer(rows);
  await saveCache(tags).catch(() => {});
  return tags;
}

// Whether this botanist may attach this tag to this plant: one of their own reserved tags,
// not used on another plant. Online it asks the server; offline it uses the saved list.
// Returns null when the tag may be attached, otherwise a plain message.
export async function myTagProblem(tag: string, plantServerId?: string | null): Promise<string | null> {
  if (!(await isSyncOffline())) {
    try {
      return tagOwnershipProblem(tag, await fetchMyTags(), plantServerId);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 0) {
        return 'Your tags could not be checked. Please try again.';
      }
      // Couldn't reach the server: fall back to the saved list.
    }
  }
  const saved = await cachedMyTags();
  if (!saved) {
    return 'Your tags could not be checked offline. Connect to the internet once (open My QR tags), or attach the tag later.';
  }
  return tagOwnershipProblem(tag, saved.tags, plantServerId);
}

function reservationMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return OFFLINE_MESSAGE;
    if (error.status === 401) return 'Sign in again to get tags.';
    if (error.status === 403) return 'Only botanists can get QR tags.';
    if (error.status === 409) return 'Those tag numbers were just taken. Please try again.';
    if (error.status === 503) return 'The tag service is busy. Try again: you will get the same tags, not new ones.';
    return error.message;
  }
  return 'Could not get the tags. Please try again.';
}

async function writeCacheFile(name: string, bytes: Uint8Array): Promise<File> {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  await file.write(base64FromBytes(bytes), { encoding: 'base64' });
  return file;
}

// Reserves `count` new tags and returns the PDF of their QR labels, saved in the cache
// folder. requestId makes a retry return the same tags (also after a failed download), in
// either layout.
export async function reserveTagsPdf(
  count: number,
  requestId: string = randomUUID(),
  layout: PdfLayout = 'sheet'
): Promise<{ ok: true; file: File; requestId: string } | { ok: false; reason: string; requestId: string }> {
  if (await isSyncOffline()) return { ok: false, reason: OFFLINE_MESSAGE, requestId };
  try {
    const bytes = await apiDownload('/api/tag-reservations/reserve-and-print', { count, request_id: requestId, layout });
    const file = await writeCacheFile(
      `niah-qr-tags-${new Date().toISOString().slice(0, 10)}-${requestId.slice(0, 8)}-${layout}.pdf`,
      bytes
    );
    // The new tags now belong to this botanist: refresh the saved list.
    void fetchMyTags().catch(() => {});
    return { ok: true, file, requestId };
  } catch (error) {
    return { ok: false, reason: reservationMessage(error), requestId };
  }
}

function exportMessage(error: unknown, what: string): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return `You are offline. ${what} needs the internet.`;
    if (error.status === 401) return 'Sign in again, then try again.';
    if (error.status === 403 || error.status === 404) return "That tag isn't one of yours.";
    if (error.status === 503 && /not configured/i.test(error.message)) return 'QR codes are not set up on the server yet.';
    return error.message;
  }
  return `${what} did not work. Please try again.`;
}

// A PDF of the chosen tags (the botanist's own, used or unused), in either layout.
export async function printTagsPdf(
  tags: string[],
  layout: PdfLayout
): Promise<{ ok: true; file: File } | { ok: false; reason: string }> {
  if (await isSyncOffline()) return { ok: false, reason: 'You are offline. Printing tags needs the internet.' };
  try {
    const bytes = await apiDownload('/api/tag-reservations/print', { tags, layout });
    return { ok: true, file: await writeCacheFile(`niah-qr-tags-selected-${tags.length}-${layout}.pdf`, bytes) };
  } catch (error) {
    return { ok: false, reason: exportMessage(error, 'Printing tags') };
  }
}

// One tag's PNG label (QR with the tag underneath), saved in the cache folder as <tag>.png.
// `path` is from tagImagePath (own unused tag) or a plant's /qr/image (own plant).
export async function downloadTagImage(
  tag: string,
  path: string
): Promise<{ ok: true; file: File } | { ok: false; reason: string }> {
  if (await isSyncOffline()) return { ok: false, reason: 'You are offline. The tag image needs the internet.' };
  try {
    return { ok: true, file: await writeCacheFile(`${tag}.png`, await apiDownload(path)) };
  } catch (error) {
    return { ok: false, reason: exportMessage(error, 'The tag image') };
  }
}

// Saves a file the botanist can print or send later: on Android into a folder they pick
// (e.g. Downloads or Pictures); on iOS through the share sheet ("Save Image" / "Save to Files").
export async function saveFile(
  file: File,
  mimeType: 'application/pdf' | 'image/png'
): Promise<{ ok: true; message: string } | { ok: false; reason: string }> {
  try {
    if (Platform.OS === 'ios') {
      await Share.share({ url: file.uri, title: file.name });
      return { ok: true, message: mimeType === 'image/png' ? 'Choose "Save Image" or "Save to Files".' : 'Choose "Save to Files" or "Print".' };
    }
    const folder = await Directory.pickDirectoryAsync();
    const copy = folder.createFile(file.name, mimeType);
    copy.write(await file.base64(), { encoding: 'base64' });
    return { ok: true, message: `Saved ${file.name} in ${folder.name || 'the folder you chose'}.` };
  } catch {
    return { ok: false, reason: 'The file was not saved. Please try again.' };
  }
}

// Shares a file: on iOS the share sheet sends the file itself. React Native's own Share
// can't send files on Android, so there it shares the tag code as text; to send the image
// or PDF itself, save it first, then share it from Files.
export async function shareFile(
  file: File,
  text: string
): Promise<{ ok: true; message: string } | { ok: false; reason: string }> {
  try {
    if (Platform.OS === 'ios') {
      await Share.share({ url: file.uri, message: text });
      return { ok: true, message: 'Shared.' };
    }
    await Share.share({ title: text, message: text });
    return { ok: true, message: 'Shared the tag code. To send the file itself, save it, then share it from Files.' };
  } catch {
    return { ok: false, reason: 'Not shared. Please try again.' };
  }
}

// Hands the PDF on so it can be printed or sent to a computer: the share sheet on iOS
// (Print, AirDrop, Files, email...); on Android, saved into a folder the botanist picks
// (e.g. Downloads), from where it can be opened, printed or sent.
export async function shareTagsPdf(file: File): Promise<{ ok: true; message: string } | { ok: false; reason: string }> {
  const result = await saveFile(file, 'application/pdf');
  if (!result.ok) return { ok: false, reason: 'The PDF was not shared or saved. Try again with "Share PDF".' };
  return {
    ok: true,
    message: Platform.OS === 'ios'
      ? 'Print it or send it to a computer from the share sheet.'
      : `${result.message} Open it from Files to print or send it.`,
  };
}
