# R8 runs in full mode (gradle.properties). Libraries that ship their own consumer
# rules — React Native and Hermes, Media3, ML Kit and its document scanner, Google
# Mobile Ads — are left to those rules, so R8 can drop the parts this app never
# calls. Blanket "-keep class lib.** { *; }" lines for them used to keep all of it.
#
# React Native's rules keep every NativeModule (this app's modules and the
# document scanner plugin's), every JavaScriptModule, @ReactProp setters, JNI
# methods and @DoNotStrip members.

# This app's own code is small and reached from JS by name; kept whole.
-keep class com.mps.allinone.** { *; }

# The MP3 encoder's JNI functions are bound by class and method name
# (Java_com_mps_allinone_Mp3Encoder_*), so neither may be renamed.
-keep class com.mps.allinone.Mp3Encoder { native <methods>; }

# Document scanner plugin: two small classes, kept whole. The ML Kit scanner it
# opens brings its own rules.
-keep class com.documentscanner.** { *; }

# Media3 Transformer and ML Kit text recognition: their own rules are enough.
-dontwarn androidx.media3.**
-dontwarn com.google.mlkit.**

# PDFBox for Android pulls in optional AWT and Bouncy Castle classes it can live
# without. It loads fonts and glyph lists by resource path and some filters by
# reflection, so it stays whole.
-keep class com.tom_roush.pdfbox.** { *; }
-dontwarn java.awt.**
-dontwarn javax.imageio.**
-dontwarn org.bouncycastle.**
-dontwarn org.apache.commons.logging.**

# PDFBox's JPEG 2000 filter calls an optional decoder that is not bundled. Only
# JPX-encoded images inside a PDF need it, and those are never decoded here: text
# is read by PDFBox and pages are drawn by Android's own PdfRenderer.
-dontwarn com.gemalto.jp2.JP2Decoder
-dontwarn com.gemalto.jp2.JP2Encoder

# slf4j looks for a logging binder at runtime and carries on without one.
-dontwarn org.slf4j.impl.StaticLoggerBinder
-dontwarn org.slf4j.**

# Archive decoders. commons-compress finds some formats by reflection.
-keep class net.lingala.zip4j.** { *; }
-keep class org.apache.commons.compress.** { *; }
-keep class com.github.junrar.** { *; }
-dontwarn org.apache.commons.compress.**
-dontwarn org.brotli.**
-dontwarn com.github.luben.**
-dontwarn org.tukaani.xz.**

# Play Billing. The library is reached reflectively by the Play Store app, and its
# listener callbacks are only ever called from there, so it is kept whole.
-keep class com.android.billingclient.** { *; }
-keep class com.android.vending.billing.** { *; }

# Google Mobile Ads ships its own rules.
-dontwarn com.google.android.gms.**
