# All-in-One File Converter (by MPS)

Offline Android app: PDF tools, document converters, image tools, audio editor,
video editor, ZIP/7Z/TAR maker and archive extractor. React Native 0.77,
package `com.mps.allinone`.

## Run (Windows, PowerShell)

    npm install; npx react-native start

In a second window:

    npx react-native run-android

Release bundle (bump `versionCode` / `versionName` in `android/app/build.gradle` first):

    cd android; .\gradlew bundleRelease

## Where things live

- `src/tools/registry.ts` – every tool, its options and which engine runs it
- `src/tools/pdf.ts`, `media.ts` – PDF, image, audio and video runners
- `src/convert/` – document converters reused from File Converter
- `src/theme/index.tsx` – Market IQ palette, dark/light/system
- `src/components/motion.tsx`, `ui.tsx` – Market IQ in-app animations and UI kit
- `android/app/src/main/java/com/mps/allinone/`
  - `MediaToolsModule.kt` – video (Media3 Transformer) and audio (MediaCodec) engine
  - `ImageToolsModule.kt` – compress, resize, convert, crop, rotate, flip, OCR, images to PDF
  - `WorkbenchModule.kt` – staging files and saving to Downloads / Ringtones
  - `pdf/` – PDF compress, password, extract, OCR, render (from PDF Tools)
  - `ArchiveModule.kt`, `FileBridgeModule.kt`, `BillingModule.kt` – from File Converter

## Before Play upload

1. Create the AdMob app and units; put the app id in `AndroidManifest.xml` and `app.json`, unit ids in `src/services/ads.ts` (test ads until then).
2. Create in-app products `premium_monthly` (base plan `monthly-149`) and `premium_lifetime`.
3. Host `docs/privacy-policy.md` and `docs/terms-of-use.md`; links are in `src/screens/SettingsScreen.tsx`.
4. Add `android/keystore.properties` (see the example file) for release signing.

## Limits (offline)

- Audio saves M4A, AAC or WAV. MP3 encoding needs FFmpeg, which is not bundled.
- Video saves MP4 (H.264/AAC).
- RAR can be extracted (RAR4), not created. RAR5 cannot be opened.
- Word/Excel/PowerPoint to PDF keeps content; complex layouts can shift.
