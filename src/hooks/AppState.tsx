import React, {createContext, useCallback, useContext, useEffect, useMemo, useState} from 'react';
import {
  getCachedEntitlement,
  initBilling,
  onEntitlementChange,
  restorePurchases,
  type Entitlement,
} from '@/services/billing';
import {initAds} from '@/services/ads';
import {FREE_CONVERSIONS, countConversion, getUsed, resetQuota} from '@/services/quota';
import {addCredit, getCredits} from '@/services/credits';
import {
  addHistory,
  addViewed,
  getHistory,
  clearHistory,
  removeHistory,
  type HistoryItem,
} from '@/services/history';
import {
  getTestEntitlement,
  setTestEntitlement,
  type TestEntitlement,
} from '@/services/testMode';
import type {SavedFile} from '@/native/FileBridge';
type ToolId = string;

type Ctx = {
  ready: boolean;
  entitlement: Entitlement;
  premium: boolean;
  used: number;
  remaining: number;
  history: HistoryItem[];
  recordConversion: (toolId: ToolId, files: SavedFile[]) => Promise<void>;
  refreshEntitlement: () => Promise<void>;
  wipeHistory: () => Promise<void>;
  /** Removes one row from Recent files. The file on disk is untouched. */
  forgetHistoryItem: (id: string) => Promise<void>;
  /** Conversions earned from rewarded ads, spent after the free allowance. */
  credits: number;
  earnCredit: () => Promise<void>;
  recordView: (file: {name: string; uri: string; mime: string}) => Promise<void>;
  /** Debug builds only; null means the real Play entitlement is in use. */
  testEntitlement: TestEntitlement | null;
  setTestPremium: (value: TestEntitlement | null) => Promise<void>;
  resetFreeQuota: () => Promise<void>;
};

const AppContext = createContext<Ctx | null>(null);

export const AppStateProvider = ({children}: {children: React.ReactNode}) => {
  const [ready, setReady] = useState(false);
  const [entitlement, setEntitlement] = useState<Entitlement>({premium: false});
  const [testEntitlement, setTestState] = useState<TestEntitlement | null>(null);
  const [used, setUsed] = useState(0);
  const [credits, setCredits] = useState(0);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [cached, usedCount, items, override, earned] = await Promise.all([
        getCachedEntitlement(),
        getUsed(),
        getHistory(),
        getTestEntitlement(),
        getCredits(),
      ]);
      if (!alive) return;
      setEntitlement(cached);
      setTestState(override);
      setUsed(usedCount);
      setCredits(earned);
      setHistory(items);
      setReady(true);

      // Network-backed work happens after the UI is already on screen.
      initBilling();
      // The override decides this too, so "testing as premium" starts a session
      // with no ad SDK running at all rather than one that merely hides them.
      if (!(override ? override === 'premium' : cached.premium)) initAds();
    })();
    const off = onEntitlementChange(setEntitlement);
    return () => {
      alive = false;
      off();
    };
  }, []);

  // A debug override shadows whatever billing reported, so every premium gate in
  // the app — banner, interstitial, quota, paywall — follows it from this one spot.
  const premium = testEntitlement ? testEntitlement === 'premium' : entitlement.premium;

  /**
   * Ads are started whenever the app is not premium, not only at launch. Premium
   * can fall away mid-session — a lapsed subscription, a refund, or the debug
   * toggle being switched back — and the startup call is long past by then, so
   * without this the session would run to its end with no ads at all.
   */
  useEffect(() => {
    if (ready && !premium) initAds();
  }, [ready, premium]);

  const recordConversion = useCallback(
    async (toolId: ToolId, files: SavedFile[]) => {
      await countConversion(premium);
      setUsed(await getUsed());
      setCredits(await getCredits());
      setHistory(
        await addHistory(
          files.map(f => ({toolId, name: f.name, path: f.path, uri: f.uri, mime: f.mime})),
        ),
      );
    },
    [premium],
  );

  const refreshEntitlement = useCallback(async () => {
    setEntitlement(await restorePurchases());
  }, []);

  const wipeHistory = useCallback(async () => {
    setHistory(await clearHistory());
  }, []);

  const forgetHistoryItem = useCallback(async (id: string) => {
    setHistory(await removeHistory(id));
  }, []);

  const recordView = useCallback(
    async (file: {name: string; uri: string; mime: string}) => {
      setHistory(await addViewed({name: file.name, uri: file.uri, mime: file.mime, path: ''}));
    },
    [],
  );

  const setTestPremium = useCallback(async (value: TestEntitlement | null) => {
    await setTestEntitlement(value);
    setTestState(value);
  }, []);

  const resetFreeQuota = useCallback(async () => {
    await resetQuota();
    setUsed(await getUsed());
  }, []);

  const earnCredit = useCallback(async () => {
    setCredits(await addCredit());
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      ready,
      entitlement: testEntitlement ? {premium} : entitlement,
      premium,
      used,
      remaining: premium ? Infinity : Math.max(0, FREE_CONVERSIONS - used) + credits,
      history,
      recordConversion,
      refreshEntitlement,
      wipeHistory,
      forgetHistoryItem,
      recordView,
      credits,
      earnCredit,
      testEntitlement,
      setTestPremium,
      resetFreeQuota,
    }),
    [
      ready,
      entitlement,
      testEntitlement,
      premium,
      used,
      history,
      recordConversion,
      refreshEntitlement,
      wipeHistory,
      forgetHistoryItem,
      recordView,
      credits,
      earnCredit,
      setTestPremium,
      resetFreeQuota,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp was called outside AppStateProvider.');
  return ctx;
};
