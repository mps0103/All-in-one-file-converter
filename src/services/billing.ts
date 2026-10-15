import {DeviceEventEmitter, NativeModules, Platform} from 'react-native';
import {KEYS, store} from './storage';

/**
 * Talks to BillingModule.kt, which wraps Google Play Billing 8 directly.
 *
 * Play requires Billing Library 8 as of 2026, and react-native-iap could not reach
 * it without the New Architecture, so the native side is ours now. This file is
 * unchanged in what it offers the rest of the app: the same functions, the same
 * shapes. Only what sits underneath moved.
 */
const Billing = NativeModules.BillingBridge as {
  start(): Promise<boolean>;
  stop(): Promise<boolean>;
  getPlans(subIds: string[], productIds: string[]): Promise<NativePlan[]>;
  purchase(productId: string, offerToken: string): Promise<boolean>;
  restore(): Promise<NativePurchase[]>;
};

type NativeOffer = {basePlanId: string; offerToken: string; price: string};
type NativePlan = {
  productId: string;
  title: string;
  type: string;
  price: string;
  offers: NativeOffer[];
};
type NativePurchase = {
  productId: string;
  purchaseToken: string;
  acknowledged: boolean;
  /** False while Play is still waiting to be paid — a cash payment, or a parent to approve. */
  purchased: boolean;
  purchaseTime: number;
};

/**
 * Product ids must match the Play Console exactly.
 * Prices are set in the Play Console, never in the app — the app only ever shows
 * the localised price string that Play sends back.
 */
export const SUB_ID = 'premium_monthly';
export const SUB_BASE_PLAN = 'monthly-149';
export const LIFETIME_ID = 'premium_lifetime';

export type Plan = {
  id: string;
  kind: 'subscription' | 'lifetime';
  title: string;
  price: string;
  offerToken?: string;
};

export type Entitlement = {premium: boolean; kind?: 'subscription' | 'lifetime'; since?: number};

let listeners: Array<(e: Entitlement) => void> = [];
let current: Entitlement = {premium: false};

export const onEntitlementChange = (fn: (e: Entitlement) => void) => {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter(l => l !== fn);
  };
};

const setEntitlement = async (e: Entitlement) => {
  current = e;
  await store.write(KEYS.entitlement, e);
  listeners.forEach(l => l(e));
};

export const getCachedEntitlement = async (): Promise<Entitlement> => {
  current = await store.read<Entitlement>(KEYS.entitlement, {premium: false});
  return current;
};

let purchaseSub: {remove(): void} | null = null;
let errorSub: {remove(): void} | null = null;

export const initBilling = async () => {
  if (Platform.OS !== 'android' || !Billing) return;
  await getCachedEntitlement();
  try {
    await Billing.start();
  } catch {
    return; // No Play Services. The free tier keeps working.
  }

  purchaseSub?.remove();
  purchaseSub = DeviceEventEmitter.addListener('billingPurchase', async (p: NativePurchase) => {
    // The native side has already acknowledged it. A purchase still pending has
    // not been paid for, so it unlocks nothing until Play says otherwise.
    if (!p.purchased) return;
    const kind = p.productId === LIFETIME_ID ? 'lifetime' : 'subscription';
    await setEntitlement({premium: true, kind, since: Date.now()});
  });

  errorSub?.remove();
  errorSub = DeviceEventEmitter.addListener('billingError', () => {
    /* The screen shows its own message; nothing to do here. */
  });

  await restorePurchases();
};

export const endBilling = async () => {
  purchaseSub?.remove();
  errorSub?.remove();
  purchaseSub = null;
  errorSub = null;
  try {
    await Billing?.stop();
  } catch {
    /* nothing to close */
  }
};

export const loadPlans = async (): Promise<Plan[]> => {
  if (!Billing) return [];
  let found: NativePlan[];
  try {
    found = await Billing.getPlans([SUB_ID], [LIFETIME_ID]);
  } catch {
    return []; // handled by the caller showing a retry
  }

  return found.map(p => {
    if (p.productId === LIFETIME_ID) {
      return {id: p.productId, kind: 'lifetime' as const, title: p.title || 'One time', price: p.price};
    }
    // A subscription is priced per base plan. The named one is preferred so the
    // price shown is the one this build was built around, but any base plan is
    // better than an empty price if the console is renamed later.
    const offer = p.offers.find(o => o.basePlanId === SUB_BASE_PLAN) ?? p.offers[0];
    return {
      id: p.productId,
      kind: 'subscription' as const,
      title: p.title || 'Monthly',
      price: offer?.price ?? '',
      offerToken: offer?.offerToken,
    };
  });
};

export const buy = async (plan: Plan) => {
  if (!Billing) throw new Error('Billing is unavailable on this device.');
  await Billing.purchase(plan.id, plan.offerToken ?? '');
};

/** Called on every launch so a reinstall or a new device keeps what was paid for. */
export const restorePurchases = async (): Promise<Entitlement> => {
  if (!Billing) return current;
  try {
    const owned = (await Billing.restore()).filter(p => p.purchased);
    const lifetime = owned.find(p => p.productId === LIFETIME_ID);
    const sub = owned.find(p => p.productId === SUB_ID);
    if (lifetime || sub) {
      await setEntitlement({premium: true, kind: lifetime ? 'lifetime' : 'subscription', since: Date.now()});
    } else {
      await setEntitlement({premium: false});
    }
  } catch {
    /* Offline restore keeps the cached entitlement. */
  }
  return current;
};

export const manageSubscriptionUrl = `https://play.google.com/store/account/subscriptions?sku=${SUB_ID}&package=com.mps.allinone`;
