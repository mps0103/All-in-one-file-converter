# Play Console setup — All-in-One File Converter

Package: `com.mps.allinone` · Category: Tools · Content rating target: Everyone

## 1. Store listing

**App name (30 char max)**
`All-in-One File Converter`

**Short description (80 char max)**
`Offline file converter: PDF, MP3, video, image & ZIP tools. No upload, private.`

**Full description** — use the 4000-character text prepared for this release (keep it in sync with the features that actually ship).

**Graphics to prepare**
- App icon 512×512 — `store-icon-512.png` in the project root
- Feature graphic 1024×500
- Phone screenshots, at least 4 (home grid, a tool screen, processing, result) in dark and light

## 2. Products to create

| Type | Product ID | Base plan | Price |
| --- | --- | --- | --- |
| Subscription | `premium_monthly` | `monthly-149` | set in Play Console |
| One-time product | `premium_lifetime` | — | set in Play Console |

The base plan id must stay `monthly-149` because it is matched verbatim by `SUB_BASE_PLAN` in
`src/services/billing.ts`. The digits are part of an identifier, not a price.

These ids must match `src/services/billing.ts` exactly, or the paywall loads empty. Activate both products before uploading the build.

## 3. Data safety form

| Question | Answer |
| --- | --- |
| Does the app collect or share user data? | Yes |
| Data types collected | Device or other IDs (advertising ID); App activity → app interactions |
| Purpose | Advertising or marketing; Analytics (ad measurement only) |
| Collected or shared? | Shared with Google AdMob (rewarded ads only) |
| Is collection optional? | Yes, in regions where the consent form applies |
| Is data encrypted in transit? | Yes |
| Can users request deletion? | Yes — via the in-app ad privacy choices and by uninstalling |
| Files, photos, audio, video the user converts or scans | Not collected. Processed on the device only. State this in the review notes. |

## 4. Other console sections

- **Privacy policy URL** — https://mps0103.github.io/All-in-one-file-converter/privacy-policy.html

  Served by GitHub Pages from this repo's `docs/` folder (repo name `All-in-one-file-converter`,
  Pages source: branch `main`, folder `/docs`). Jekyll renders each markdown file to `.html`,
  so the extension is part of the address. The same pair is hard-coded in
  `src/screens/SettingsScreen.tsx`; change one and the other has to follow.

  Terms of use: https://mps0103.github.io/All-in-one-file-converter/terms-of-use.html
- **Ads declaration** — Yes, the app contains ads (rewarded only).
- **Content rating questionnaire** — no sensitive content; declare that ads are shown.
- **Target audience** — 13+. Do not tick the children's section; the app uses an advertising ID.
- **Government apps / financial features** — no.
- **App access** — no login needed; all features reachable without an account.
- **app-ads.txt** — served from https://dealtrix.com/app-ads.txt (covers all MPS apps on the same AdMob publisher id). Set https://dealtrix.com as the developer website.

## 5. Before each upload

1. Put this app's real AdMob app id in `AndroidManifest.xml` and `app.json`, and the rewarded unit id in `src/services/ads.ts` (`PROD_REWARDED`).
2. Bump `versionCode` and `versionName` in `android/app/build.gradle` — once, at the end of a batch of changes.
3. `npx tsc --noEmit` and confirm the app runs on a real device in airplane mode.
4. Make sure `android/keystore.properties` and `android/keystores/all-in-one-upload.jks` exist (never commit them).
5. `cd android; .\gradlew bundleRelease` and upload `android/app/build/outputs/bundle/release/app-release.aab`.
6. In Play Console, App bundle explorer → check "Memory page size: 16 KB supported".
