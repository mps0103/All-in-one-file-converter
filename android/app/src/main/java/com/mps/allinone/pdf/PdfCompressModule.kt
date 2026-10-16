package com.mps.allinone.pdf

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.cos.COSBase
import com.tom_roush.pdfbox.cos.COSName
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.graphics.color.PDDeviceGray
import com.tom_roush.pdfbox.pdmodel.graphics.color.PDDeviceRGB
import com.tom_roush.pdfbox.pdmodel.graphics.image.JPEGFactory
import com.tom_roush.pdfbox.pdmodel.graphics.image.PDImageXObject
import java.io.File
import java.io.FileOutputStream
import java.util.Collections
import java.util.IdentityHashMap

class PdfCompressModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    init {
        PDFBoxResourceLoader.init(reactContext.applicationContext)
    }

    override fun getName() = "PdfCompress"

    private fun clean(path: String) = path.removePrefix("file://")

    /**
     * Re-encodes every image on every page as JPEG at the given quality,
     * capping the longest edge at maxEdge pixels. Set grayscale to drop colour.
     * Text and vectors are untouched.
     */
    @ReactMethod
    fun rewriteImages(
        srcPath: String,
        destPath: String,
        quality: Float,
        maxEdge: Int,
        grayscale: Boolean,
        promise: Promise
    ) {
        try {
            val srcFile = File(clean(srcPath))
            val before = srcFile.length()
            var touched = 0

            PDDocument.load(srcFile).use { doc ->
                // A logo or letterhead is usually one image stream referenced from every
                // page, and pages often share one resources dictionary outright. Without
                // this, each page re-encoded it into a new copy (the output could grow
                // past the input) or re-compressed the JPEG this loop had just written.
                val replaced = IdentityHashMap<COSBase, PDImageXObject>()
                val written = Collections.newSetFromMap(IdentityHashMap<COSBase, Boolean>())

                for (page in doc.pages) {
                    val resources = page.resources ?: continue
                    // Copy the name list first — we mutate resources while iterating.
                    val names = resources.xObjectNames.toList()

                    for (name in names) {
                        val xObject = try {
                            resources.getXObject(name)
                        } catch (e: Exception) {
                            null
                        } ?: continue

                        if (xObject !is PDImageXObject) continue

                        val stream = xObject.cosObject
                        if (stream in written) continue
                        val done = replaced[stream]
                        if (done != null) {
                            resources.put(name as COSName, done)
                            continue
                        }

                        val original = try {
                            runCatching { sampledJpeg(xObject, maxEdge) }.getOrNull() ?: xObject.image
                        } catch (e: Exception) {
                            null
                        } ?: continue

                        val processed = transform(original, maxEdge, grayscale)
                        if (processed == null) {
                            original.recycle()
                            continue
                        }

                        val replacement = JPEGFactory.createFromImage(doc, processed, quality)
                        resources.put(name as COSName, replacement)
                        replaced[stream] = replacement
                        written += replacement.cosObject
                        touched++

                        if (processed != original) processed.recycle()
                        original.recycle()
                    }
                }

                doc.isAllSecurityToBeRemoved = false
                doc.save(File(clean(destPath)))
            }

            val after = File(clean(destPath)).length()
            promise.resolve(
                Arguments.createMap().apply {
                    putString("path", destPath)
                    putDouble("bytesBefore", before.toDouble())
                    putDouble("bytesAfter", after.toDouble())
                    putInt("imagesRewritten", touched)
                }
            )
        } catch (e: OutOfMemoryError) {
            promise.reject("E_MEMORY", "This file has images too large to process on device.")
        } catch (e: Exception) {
            promise.reject("E_IO", e.message, e)
        }
    }

    /**
     * Turns a photo of a signature on paper into transparent PNG ink.
     * Pixels brighter than `threshold` become fully transparent; darker ones
     * keep their colour at full alpha. A soft band just above the threshold
     * fades out gradually so the edges do not look cut with scissors.
     * The result is cropped to the ink, so there is no dead space around it
     * when the signature is placed on a page.
     */
    @ReactMethod
    fun signatureFromImage(srcPath: String, destPath: String, threshold: Int, promise: Promise) {
        try {
            val src = BitmapFactory.decodeFile(clean(srcPath))
            if (src == null) {
                promise.reject("E_IO", "Could not read that image.")
                return
            }

            val w = src.width
            val h = src.height
            val pixels = IntArray(w * h)
            src.getPixels(pixels, 0, w, 0, 0, w, h)
            src.recycle()

            val soft = 25f
            var minX = w
            var minY = h
            var maxX = -1
            var maxY = -1

            for (i in pixels.indices) {
                val p = pixels[i]
                val r = (p shr 16) and 0xFF
                val g = (p shr 8) and 0xFF
                val b = p and 0xFF
                val lum = 0.299f * r + 0.587f * g + 0.114f * b

                val alpha = when {
                    lum >= threshold -> 0
                    lum >= threshold - soft ->
                        (((threshold - lum) / soft) * 255f).toInt().coerceIn(0, 255)
                    else -> 255
                }

                if (alpha == 0) {
                    pixels[i] = 0
                } else {
                    pixels[i] = (alpha shl 24) or (p and 0x00FFFFFF)
                    val x = i % w
                    val y = i / w
                    if (x < minX) minX = x
                    if (x > maxX) maxX = x
                    if (y < minY) minY = y
                    if (y > maxY) maxY = y
                }
            }

            if (maxX < 0) {
                promise.reject("E_EMPTY", "No ink found. Try a lower threshold or a clearer photo.")
                return
            }

            val margin = 8
            minX = (minX - margin).coerceAtLeast(0)
            minY = (minY - margin).coerceAtLeast(0)
            maxX = (maxX + margin).coerceAtMost(w - 1)
            maxY = (maxY + margin).coerceAtMost(h - 1)

            val cw = maxX - minX + 1
            val ch = maxY - minY + 1
            val out = Bitmap.createBitmap(cw, ch, Bitmap.Config.ARGB_8888)
            val row = IntArray(cw)
            for (y in 0 until ch) {
                System.arraycopy(pixels, (minY + y) * w + minX, row, 0, cw)
                out.setPixels(row, 0, cw, 0, y, cw, 1)
            }

            // PNG only — JPEG has no alpha and would bring the paper back.
            FileOutputStream(File(clean(destPath))).use {
                out.compress(Bitmap.CompressFormat.PNG, 100, it)
            }

            val result = Arguments.createMap().apply {
                putString("path", destPath)
                putInt("width", cw)
                putInt("height", ch)
            }
            out.recycle()
            promise.resolve(result)
        } catch (e: OutOfMemoryError) {
            promise.reject("E_MEMORY", "That photo is too large. Try a smaller one.")
        } catch (e: Exception) {
            promise.reject("E_IO", e.message ?: "Could not process that image.", e)
        }
    }

    /**
     * A plain JPEG picture in the PDF, decoded from its own bytes and sampled down
     * to half, a quarter… of its size as it is read, never above maxEdge × 2. Asking
     * PDFBox for the image decodes it whole first: 48 MB for a 12 MP photo that is
     * about to be shrunk to 1600 px anyway. Null for anything with a mask, a Decode
     * array, CMYK or 16-bit samples — those go through PDFBox exactly as before —
     * and when the picture is not even twice the size it is being brought down to.
     */
    private fun sampledJpeg(image: PDImageXObject, maxEdge: Int): Bitmap? {
        if (maxEdge <= 0 || image.suffix != "jpg" || image.bitsPerComponent != 8) return null
        val dict = image.cosObject
        if (dict.containsKey(COSName.MASK) || dict.containsKey(COSName.SMASK) || dict.containsKey(COSName.DECODE)) return null
        val cs = image.colorSpace
        val plain = cs is PDDeviceRGB || cs is PDDeviceGray || (cs.name == "ICCBased" && cs.numberOfComponents in setOf(1, 3))
        if (!plain) return null
        var sample = 1
        while (maxOf(image.width, image.height) / (sample * 2) >= maxEdge) sample *= 2
        if (sample == 1) return null
        val opts = BitmapFactory.Options().apply {
            inSampleSize = sample
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        return image.stream.createInputStream(listOf(COSName.DCT_DECODE.name)).use { BitmapFactory.decodeStream(it, null, opts) }
    }

    /** Returns a downscaled and/or desaturated copy, or the input when nothing to do. */
    private fun transform(source: Bitmap, maxEdge: Int, grayscale: Boolean): Bitmap? {
        val longest = maxOf(source.width, source.height)
        val scale = if (maxEdge > 0 && longest > maxEdge) maxEdge.toFloat() / longest else 1f

        if (scale == 1f && !grayscale) return source

        val w = (source.width * scale).toInt().coerceAtLeast(1)
        val h = (source.height * scale).toInt().coerceAtLeast(1)
        val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)

        val paint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
        if (grayscale) {
            paint.colorFilter = ColorMatrixColorFilter(ColorMatrix().apply { setSaturation(0f) })
        }

        Canvas(out).drawBitmap(
            source,
            android.graphics.Rect(0, 0, source.width, source.height),
            android.graphics.Rect(0, 0, w, h),
            paint
        )
        return out
    }
}