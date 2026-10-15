import AsyncStorage from '@react-native-async-storage/async-storage';

const read = async <T>(key: string, fallback: T): Promise<T> => {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
};

const write = async (key: string, value: unknown) => {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A full disk should never break a conversion that already succeeded.
  }
};

export const store = {read, write, remove: (k: string) => AsyncStorage.removeItem(k)};

export const KEYS = {
  used: 'quota.used',
  entitlement: 'billing.entitlement',
  history: 'history.items',
  seenIntro: 'intro.seen',
  adsSince: 'ads.lastInterstitial',
  conversionsSinceAd: 'ads.sinceLast',
  /** Conversions earned from rewarded ads. */
  credits: 'quota.credits',
  /** Debug builds, or a release unlocked by hand. Deliberately not the entitlement key. */
  testEntitlement: 'debug.testEntitlement',
  /** Set once the developer unlock has been entered on this device. */
  developer: 'debug.developer',
} as const;
