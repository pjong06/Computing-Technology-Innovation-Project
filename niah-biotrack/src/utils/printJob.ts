// My QR tags: what happens after Print in the "Print N tags" sheet, in this order:
//   1. close the sheet;
//   2. wait until it has really gone (iOS: the Modal's onDismiss; Android: a short delay).
//      iOS silently ignores a share sheet opened while a Modal is still closing;
//   3. generate the PDF / PNG labels;
//   4. open the share / save sheet.
// Any failure (network, the server's answer, saving the file) ends with a plain message,
// never silence. Pure (no React Native): tested by src/utils/printJob.test.mjs.

import type { PrintLayout } from './myTags';

export type StepResult<T> = { ok: true; value: T } | { ok: false; reason: string };

export interface PrintJobSteps<T> {
  closeSheet: () => void;
  // Resolves once the sheet has gone. Created before the sheet closes, so its "dismissed"
  // signal can't be missed.
  waitForClose: () => Promise<void>;
  generate: () => Promise<StepResult<T>>;
  share: (value: T) => Promise<{ ok: true; message?: string } | { ok: false; reason: string }>;
}

export const PRINT_FAILED = 'The labels could not be printed. Please try again.';

export async function runPrintJob<T>(steps: PrintJobSteps<T>): Promise<{ ok: true; message?: string } | { ok: false; reason: string; error?: unknown }> {
  try {
    const closed = steps.waitForClose();
    steps.closeSheet();
    await closed;
    const made = await steps.generate();
    if (!made.ok) return { ok: false, reason: made.reason || PRINT_FAILED };
    const shared = await steps.share(made.value);
    return shared.ok ? { ok: true, message: shared.message } : { ok: false, reason: shared.reason || PRINT_FAILED };
  } catch (error) {
    const detail = error instanceof Error && error.message ? ` (${error.message})` : '';
    return { ok: false, reason: `${PRINT_FAILED}${detail}`, error };
  }
}

/** "Preparing 3 labels…", "Preparing 1 label…", "Preparing 3 images…". */
export function preparingText(count: number, layout: PrintLayout): string {
  const noun = layout === 'images' ? (count === 1 ? 'image' : 'images') : count === 1 ? 'label' : 'labels';
  return `Preparing ${count} ${noun}…`;
}

// How long Android waits for the sheet's slide-down before opening the share/save sheet, and
// how long iOS waits at most for onDismiss (in case it never comes).
export const ANDROID_CLOSE_DELAY_MS = 350;
export const IOS_DISMISS_TIMEOUT_MS = 1200;

/**
 * The Print button in the sheet: enabled with tags to print and nothing being prepared.
 * Opening the sheet (batch "Print", "Print N") never waits for anything else.
 */
export function printButtonState(input: { tagCount: number; preparing: boolean }): { disabled: boolean; label: string } {
  if (input.preparing) return { disabled: true, label: 'Preparing…' };
  return { disabled: input.tagCount === 0, label: 'Print' };
}
