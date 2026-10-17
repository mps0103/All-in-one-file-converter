import {Platform} from 'react-native';
import mobileAds, {
  AdEventType,
  AdsConsent,
  AdsConsentPrivacyOptionsRequirementStatus,
  AdsConsentStatus,
  MaxAdContentRating,
  RewardedAd,
  RewardedAdEventType,
  TestIds,
} from 'react-native-google-mobile-ads';

const isDev = __DEV__;

/**
 * The app shows one kind of ad only: an optional rewarded video, offered when
 * the free conversions are used up. Watching it to the end gives one more
 * conversion. There are no banners and no full-screen ads.
 *
 * Paste the production rewarded unit id here, and the AdMob app id in
 * AndroidManifest.xml and app.json. Until then every build shows Google's test ad.
 */
const PROD_REWARDED = '';

export const AD_UNITS = {
  rewarded: isDev || !PROD_REWARDED ? TestIds.REWARDED : PROD_REWARDED,
};

let rewarded: RewardedAd | null = null;
let rewardedLoaded = false;

let started = false;

/**
 * Safe to call more than once: the app can become free part way through a
 * session (a lapsed subscription), and the ad then has to start from nothing.
 */
export const initAds = async () => {
  if (Platform.OS !== 'android' || started) return;
  started = true;
  try {
    await requestConsent();
    await mobileAds().setRequestConfiguration({
      maxAdContentRating: MaxAdContentRating.G,
      tagForChildDirectedTreatment: false,
      tagForUnderAgeOfConsent: false,
    });
    await mobileAds().initialize();
    preloadRewarded();
  } catch {
    // The app is fully usable with no ads at all. Let a later call try again.
    started = false;
  }
};

export const requestConsent = async () => {
  try {
    const info = await AdsConsent.requestInfoUpdate();
    if (
      info.isConsentFormAvailable &&
      info.status === AdsConsentStatus.REQUIRED
    ) {
      await AdsConsent.showForm();
    }
  } catch {
    /* Consent is only required in some regions; failures must not block the app. */
  }
};

/** Wired to the "Ad privacy choices" row in Settings, which Google requires to stay reachable. */
/**
 * Whether Google requires this user to be offered a way to change their ad consent.
 *
 * Only true where privacy law demands it, which in practice means the EEA and the
 * UK. Everywhere else the form does not exist, and the settings row that opens it
 * was a dead end — it did nothing when tapped, because there was nothing to show.
 */
export const privacyOptionsRequired = async () => {
  try {
    const info = await AdsConsent.getConsentInfo();
    return info.privacyOptionsRequirementStatus === AdsConsentPrivacyOptionsRequirementStatus.REQUIRED;
  } catch {
    return false;
  }
};

export const showPrivacyOptions = async () => {
  try {
    await AdsConsent.showPrivacyOptionsForm();
  } catch {
    /* no form for this region */
  }
};

/**
 * A rewarded ad is loaded up front and reloaded after every showing, because it is
 * offered at the moment the free allowance runs out — a spinner there would read
 * as the paywall stalling.
 */
const preloadRewarded = () => {
  rewarded = RewardedAd.createForAdRequest(AD_UNITS.rewarded, {
    requestNonPersonalizedAdsOnly: false,
  });
  rewardedLoaded = false;
  rewarded.addAdEventListener(RewardedAdEventType.LOADED, () => {
    rewardedLoaded = true;
  });
  rewarded.addAdEventListener(AdEventType.ERROR, () => {
    rewardedLoaded = false;
  });
  rewarded.load();
};

export const isRewardedReady = () => rewardedLoaded;

/**
 * Resolves true only when Google says the reward was actually earned — closing the
 * ad early resolves false and nothing is granted. The listeners are torn down on
 * the way out so a second showing cannot pay out twice.
 */
export const showRewarded = (): Promise<boolean> =>
  new Promise(resolve => {
    const ad = rewarded;
    if (!ad || !rewardedLoaded) {
      resolve(false);
      return;
    }
    rewardedLoaded = false;
    let earned = false;
    let settled = false;

    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      offEarned();
      offClosed();
      preloadRewarded();
      resolve(value);
    };

    const offEarned = ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
      earned = true;
    });
    const offClosed = ad.addAdEventListener(AdEventType.CLOSED, () => finish(earned));

    try {
      ad.show();
    } catch {
      finish(false);
    }
  });
