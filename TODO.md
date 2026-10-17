# To do

## Before the production release on Google Play

- [ ] **Free conversions back to 10.** `FREE_CONVERSIONS` in `src/services/quota.ts`
      is 50 for the testing period (closed testing, 14 days). Set it back to 10, then
      bump `versionCode` and build a new AAB.
- [ ] Replace the Google sample AdMob app id (`AndroidManifest.xml` and `app.json`)
      and the test ad unit ids with the app's own.
