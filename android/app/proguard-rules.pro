# R8 runs in full mode (gradle.properties). Every library here is left to the
# consumer rules it ships (React Native and Hermes, Media3, ML Kit and its document
# scanner, Google Mobile Ads, Play Billing, PDFBox), so R8 can drop the parts this
# app never calls. Blanket "-keep class lib.** { *; }" lines used to keep all of it.
#
# React Native's rules keep every NativeModule (this app's modules and the
# document scanner plugin's), every JavaScriptModule, @ReactProp setters and
# @DoNotStrip members. Activities, providers and receivers named in the manifest
# are kept by the rules AAPT writes for it.

# JNI functions are bound by class and method name (Java_com_mps_allinone_Mp3Encoder_*),
# so classes with native methods keep their names. The MP3 encoder's C code never
# calls back into Java, so nothing more of it needs keeping.
-keepclasseswithmembernames class * { native <methods>; }

# Optional classes the libraries refer to but that are not bundled. Each is only
# reached on a path this app never takes, so they are not kept, only not warned on.
-dontwarn androidx.media3.**
-dontwarn com.google.mlkit.**
-dontwarn com.google.android.gms.**
# PDFBox: the JPEG 2000 codec, for JPX images inside a PDF; pages are drawn by
# Android's own PdfRenderer, so they are never decoded here.
-dontwarn com.gemalto.jp2.JP2Decoder
-dontwarn com.gemalto.jp2.JP2Encoder
# commons-compress: zstd and brotli streams, formats the extractor does not offer.
-dontwarn com.github.luben.zstd.**
-dontwarn org.brotli.dec.**
# slf4j looks for a logging binder at run time and carries on without one.
-dontwarn org.slf4j.impl.StaticLoggerBinder

# WorkManager (pulled in by Google Mobile Ads) opens its Room database by building
# the class name "<Database>_Impl" and calling its no-argument constructor, which
# R8 full mode would otherwise strip.
-keep class * extends androidx.room.RoomDatabase { <init>(); }

# ML Kit (text recognition) builds its parts from the ComponentRegistrar classes
# named in the manifest, through their no-argument constructors. R8 full mode
# drops those constructors, and TextRecognition.getClient() then finds nothing.
-keep class * implements com.google.firebase.components.ComponentRegistrar { <init>(); }
