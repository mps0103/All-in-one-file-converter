import {KEYS, store} from './storage';

/**
 * Conversions earned by watching a rewarded ad, spent only once the free
 * allowance is gone.
 *
 * Kept apart from the free tally rather than decrementing it, so the two can be
 * reasoned about separately: the allowance is a fixed grant that never comes
 * back, a credit is something the user worked for. Mixing them would make
 * the stated free allowance untrue the moment somebody watched an ad.
 */
export const getCredits = () => store.read<number>(KEYS.credits, 0);

export const addCredit = async (amount = 1) => {
  const next = (await getCredits()) + amount;
  await store.write(KEYS.credits, next);
  return next;
};

/** Returns the balance left. Never goes below zero, whatever the caller does. */
export const spendCredit = async () => {
  const next = Math.max(0, (await getCredits()) - 1);
  await store.write(KEYS.credits, next);
  return next;
};
