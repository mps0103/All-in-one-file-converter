# React Native
-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }

# The native converter bridge is reached by name from JS.
-keep class com.mps.allinone.FileBridgeModule { *; }
-keep class com.mps.allinone.ArchiveModule { *; }
-keep class com.mps.allinone.BillingModule { *; }
-keep class com.mps.allinone.** { *; }

# Media3 Transformer and ML Kit text recognition
-keep class androidx.media3.** { *; }
-dontwarn androidx.media3.**
-keep class com.google.mlkit.** { *; }
-dontwarn com.google.mlkit.**

# PDFBox for Android pulls in optional AWT and Bouncy Castle classes it can live without.
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

# Archive decoders
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

# Google Mobile Ads
-keep class com.google.android.gms.ads.** { *; }
-dontwarn com.google.android.gms.**
