import {KEYS, store} from './storage';
import {getCredits, spendCredit} from './credits';

/**
 * Conversions a new user gets before the paywall appears. Extracting an archive
 * counts as one; viewing never does, because the viewer is free.
 *
 * The free allowance is kept intentionally low for testing and promotion, and
 * every screen that mentions the allowance reads it from here.
 */
export const FREE_CONVERSIONS = 10;

export const getUsed = () => store.read<number>(KEYS.used, 0);

export const getRemaining = async (isPremium: boolean) => {
  if (isPremium) return Infinity;
  return Math.max(0, FREE_CONVERSIONS - (await getUsed())) + (await getCredits());
};

export const canConvert = async (isPremium: boolean) => (await getRemaining(isPremium)) > 0;

/** Debug-build testing aid: puts the free tally back to zero. */
export const resetQuota = () => store.write(KEYS.used, 0);

/** Only called after a file has actually been written. A failed run costs nothing. */
export const countConversion = async (isPremium: boolean) => {
  if (isPremium) return;
  const used = await getUsed();
  // The free allowance is spent first; credits are only touched once it is gone,
  // so somebody who watched an ad early still gets the whole free allowance.
  if (used < FREE_CONVERSIONS) {
    await store.write(KEYS.used, used + 1);
    return;
  }
  await spendCredit();
};
