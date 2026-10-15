import {isDeveloper} from './devMode';
import {KEYS, store} from './storage';

/**
 * Debug-build-only entitlement override.
 *
 * Play billing never completes in a locally built APK: the products do not
 * resolve and `getAvailablePurchases` comes back empty, so the paid half of the
 * app — unlimited conversions, no banner, no interstitial — cannot be reached on
 * a test device at all. This forces it on so those paths can actually be used.
 *
 * Gated on the developer unlock in devMode.ts: always on in a debug build, and in
 * a release only once the passphrase has been entered on that device. It lives
 * under its own key, well away from the billing cache, so it can never be mistaken
 * for a real purchase or reconciled back to Play.
 */
export type TestEntitlement = 'free' | 'premium';

/** The forced entitlement, or null to defer to real billing. */
export const getTestEntitlement = async (): Promise<TestEntitlement | null> => {
  if (!(await isDeveloper())) return null;
  return store.read<TestEntitlement | null>(KEYS.testEntitlement, null);
};

export const setTestEntitlement = async (value: TestEntitlement | null) => {
  if (!(await isDeveloper())) return;
  if (value === null) await store.remove(KEYS.testEntitlement);
  else await store.write(KEYS.testEntitlement, value);
};
