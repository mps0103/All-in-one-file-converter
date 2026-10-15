import {IS_DEBUG_BUILD} from '@/native/FileBridge';
import {KEYS, store} from './storage';

/**
 * The developer unlock.
 *
 * A debug build shows the testing controls outright. A release build hides them
 * behind a gesture and a passphrase, so they can still be reached on a phone
 * holding a real Play build — which is the only place a real purchase, a real
 * restore or a real ad can be exercised.
 *
 * What this is not: security. The passphrase is inside the app, and anyone willing
 * to decompile the APK can read it. It keeps the controls away from ordinary users
 * who tap around a settings screen; it would not stop somebody determined. The
 * blast radius is deliberately small — it flips a local flag that hides ads and
 * lifts the conversion limit on that one device. It buys nothing, unlocks no
 * content, and never touches Play.
 */
const PASSPHRASE = 'mps-2026';

/** Taps on the settings card needed before the passphrase is even asked for. */
export const UNLOCK_TAPS = 7;

export const isDeveloper = async (): Promise<boolean> => {
  if (IS_DEBUG_BUILD) return true;
  return store.read<boolean>(KEYS.developer, false);
};

/** Returns false on a wrong passphrase, and changes nothing. */
export const unlockDeveloper = async (entered: string): Promise<boolean> => {
  if (entered.trim().toLowerCase() !== PASSPHRASE) return false;
  await store.write(KEYS.developer, true);
  return true;
};

export const lockDeveloper = async () => {
  await store.remove(KEYS.developer);
};
