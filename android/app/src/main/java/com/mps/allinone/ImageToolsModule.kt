package com.mps.allinone

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapRegionDecoder
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.pdf.PdfDocument
import android.net.Uri
import android.os.Build
import androidx.exifinterface.media.ExifInterface
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executors
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Every image tool in one place: compress, resize, change resolution, convert
 * format, crop to an aspect, rotate, flip, grayscale, images to PDF and OCR.
 * Everything runs on the device; nothing touches the network.
 *
 * Memory: an image is decoded no larger than the job needs, one image at a time,
 * and each intermediate bitmap is recycled as soon as the next step has it. A
 * camera photo is the largest thing this app ever holds — 48 MP is 192 MB as a
 * bitmap — so how it is decoded decides the app's peak memory.
 */
class ImageToolsModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {

    override fun getName() = "ImageTools"

    private val worker = Executors.newSingleThreadExecutor()

    /**
     * opts (all optional):
     *  format   "jpg" | "png" | "webp" | "same"
     *  quality  1..100 (jpg / webp)
     *  maxEdge  longest side in px, 0 = keep
     *  width / height  exact size in px; with keepAspect the other side follows
     *  scale    percent, 1..100
     *  rotate   0 | 90 | 180 | 270
     *  flipH / flipV / grayscale  booleans
     *  aspect   "1:1" | "4:3" | "3:4" | "16:9" | "9:16" | "3:2" | "2:3" — centre crop
     *  outPath  where to write
     */
    @ReactMethod
    fun process(uriString: String, opts: ReadableMap, promise: Promise) {
        worker.execute {
            var bmp: Bitmap? = null
            try {
                val outPath = opts.str("outPath") ?: throw IllegalArgumentException("No output path.")
                val srcMime = ctx.contentResolver.getType(Uri.parse(uriString)) ?: ""
                val (srcW, srcH) = sourceSize(uriString)
                val srcLong = max(srcW, srcH)
                val edge = decodeEdge(srcW, srcH, opts)
                // A "keep the size" job is decoded straight to its final size; any other
                // job only as close to its target as sampling gets, and scaled below.
                bmp = decode(uriString, edge, exact = edge == min(srcLong, KEEP_EDGE))
                // Decoded pixels per source pixel, so a percentage is of the photo itself.
                val sourceScale = if (srcLong > 0) max(bmp.width, bmp.height).toFloat() / srcLong else 1f

                val aspect = opts.str("aspect")
                if (!aspect.isNullOrBlank() && aspect != "free") bmp = centreCrop(bmp, aspect)

                val rotate = opts.int("rotate", 0)
                val flipH = opts.bool("flipH")
                val flipV = opts.bool("flipV")
                if (rotate != 0 || flipH || flipV) {
                    val m = Matrix()
                    if (rotate != 0) m.postRotate(rotate.toFloat())
                    if (flipH || flipV) m.postScale(if (flipH) -1f else 1f, if (flipV) -1f else 1f)
                    bmp = replace(bmp, Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true))
                }

                val (tw, th) = targetSize(bmp.width, bmp.height, opts, sourceScale)
                if (tw != bmp.width || th != bmp.height) {
                    bmp = replace(bmp, Bitmap.createScaledBitmap(bmp, tw, th, true))
                }

                if (opts.bool("grayscale")) bmp = grayscale(bmp)

                val format = when (val f = opts.str("format") ?: "same") {
                    "same" -> when {
                        srcMime.contains("png") -> "png"
                        srcMime.contains("webp") -> "webp"
                        else -> "jpg"
                    }
                    else -> f
                }
                val quality = opts.int("quality", 90).coerceIn(1, 100)
                val out = File(outPath).apply { parentFile?.mkdirs() }
                write(bmp, format, quality, out)

                promise.resolve(Arguments.createMap().apply {
                    putString("path", out.absolutePath)
                    putInt("width", bmp.width)
                    putInt("height", bmp.height)
                    putDouble("size", out.length().toDouble())
                    putString("format", format)
                })
            } catch (e: OutOfMemoryError) {
                promise.reject("E_MEMORY", "This image is too large for the phone's memory. Try a smaller size.")
            } catch (e: Exception) {
                promise.reject("E_IMAGE", e.message ?: "Could not process the image.", e)
            } finally {
                bmp?.recycle()
            }
        }
    }

    /**
     * One page per image. pageSize "fit" makes each page the size of its image;
     * "a4" / "letter" fit the image inside the page with a margin.
     *
     * A PdfDocument page keeps the bitmap drawn on it at the bitmap's own resolution,
     * so each image is decoded to what the page can show — about 200 dpi on A4 or
     * Letter — and freed before the next one is read.
     */
    @ReactMethod
    fun imagesToPdf(uris: ReadableArray, pageSize: String, margin: Int, outPath: String, promise: Promise) {
        worker.execute {
            val doc = PdfDocument()
            var bmp: Bitmap? = null
            try {
                val edge = when (pageSize) {
                    "a4" -> pagePixels(842)
                    "letter" -> pagePixels(792)
                    else -> FIT_PAGE_EDGE
                }
                for (i in 0 until uris.size()) {
                    val image = decode(uris.getString(i) ?: continue, edge, exact = true)
                    bmp = image
                    val (pw, ph) = when (pageSize) {
                        "a4" -> 595 to 842
                        "letter" -> 612 to 792
                        else -> {
                            // Image at 150 dpi, expressed in points.
                            val s = 72f / 150f
                            max(1, (image.width * s).roundToInt()) to max(1, (image.height * s).roundToInt())
                        }
                    }
                    val page = doc.startPage(PdfDocument.PageInfo.Builder(pw, ph, i + 1).create())
                    val c = page.canvas
                    c.drawColor(Color.WHITE)
                    val m = if (pageSize == "fit") 0 else margin
                    val scale = min((pw - 2f * m) / image.width, (ph - 2f * m) / image.height)
                    val w = image.width * scale
                    val h = image.height * scale
                    val left = (pw - w) / 2f
                    val top = (ph - h) / 2f
                    c.drawBitmap(image, null, RectF(left, top, left + w, top + h), Paint(Paint.FILTER_BITMAP_FLAG))
                    doc.finishPage(page)
                    image.recycle()
                    bmp = null
                }
                val out = File(outPath).apply { parentFile?.mkdirs() }
                FileOutputStream(out).use { doc.writeTo(it) }
                promise.resolve(out.absolutePath)
            } catch (e: OutOfMemoryError) {
                promise.reject("E_MEMORY", "Too many large images at once. Try fewer images.")
            } catch (e: Exception) {
                promise.reject("E_IMAGE", e.message ?: "Could not build the PDF.", e)
            } finally {
                bmp?.recycle()
                doc.close()
            }
        }
    }

    /** Reads printed text from a photo with the on-device ML Kit model. */
    @ReactMethod
    fun recognizeText(uriString: String, promise: Promise) {
        worker.execute {
            var bmp: Bitmap? = null
            try {
                // Printed text reads as well at 2500 px as at full camera resolution.
                bmp = decode(uriString, OCR_EDGE, exact = true)
                val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
                val result = Tasks.await(recognizer.process(InputImage.fromBitmap(bmp, 0)))
                recognizer.close()
                promise.resolve(Arguments.createMap().apply {
                    putString("text", result.text)
                    putInt("blocks", result.textBlocks.size)
                })
            } catch (e: Exception) {
                promise.reject("E_OCR", e.message ?: "Could not read text from this image.", e)
            } finally {
                bmp?.recycle()
            }
        }
    }

    // ---------------------------------------------------------------- helpers

    /** The image's stored width and height, read from its header alone; 0 × 0 if unknown. */
    private fun sourceSize(uriString: String): Pair<Int, Int> {
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        return try {
            ctx.contentResolver.openInputStream(toUri(uriString))?.use { BitmapFactory.decodeStream(it, null, o) }
            if (o.outWidth > 0 && o.outHeight > 0) o.outWidth to o.outHeight else 0 to 0
        } catch (_: Exception) {
            0 to 0
        }
    }

    /**
     * The long side to decode at: what the job will write, and no more. Never above
     * KEEP_EDGE (~19 MP), which is as large as any photo is ever kept.
     */
    private fun decodeEdge(srcW: Int, srcH: Int, opts: ReadableMap): Int {
        val srcLong = max(srcW, srcH)
        if (srcLong <= 0) {
            // Size unknown: the old rule, twice any asked-for size.
            val explicit = max(opts.int("width", 0), opts.int("height", 0))
            val edge = opts.int("maxEdge", 0)
            return when {
                explicit > 0 -> explicit * 2
                edge > 0 -> edge * 2
                else -> KEEP_EDGE
            }
        }
        // Tried with the photo either way up: EXIF rotation can swap its sides.
        val need = max(neededScale(srcW, srcH, opts), neededScale(srcH, srcW, opts))
        val edge = if (need >= 1f) srcLong else ceil(srcLong * need).toInt()
        return edge.coerceIn(1, min(srcLong, KEEP_EDGE))
    }

    /** Output size over source size for a w×h source. */
    private fun neededScale(w: Int, h: Int, opts: ReadableMap): Float {
        // Sized at a nominal 10 000 px long side, so a job is worked out without decoding
        // anything and the integer maths keeps its precision; k is nominal px per real px.
        val k = 10_000f / max(w, h)
        var cw = (w * k).roundToInt().coerceAtLeast(1)
        var ch = (h * k).roundToInt().coerceAtLeast(1)
        val aspect = opts.str("aspect")
        if (!aspect.isNullOrBlank() && aspect != "free") {
            cropSize(cw, ch, aspect)?.let { (a, b) -> cw = a; ch = b }
        }
        val rotate = opts.int("rotate", 0)
        if (rotate == 90 || rotate == 270) cw = ch.also { ch = cw }
        val (tw, th) = targetSize(cw, ch, opts, 1f, px = k)
        return max(tw.toFloat() / cw, th.toFloat() / ch)
    }

    /**
     * Decodes with EXIF orientation applied, the long side near maxEdge: at least
     * maxEdge and at most about twice it, or exactly maxEdge when exact is set.
     */
    private fun decode(uriString: String, maxEdge: Int, exact: Boolean = false): Bitmap {
        val uri = toUri(uriString)
        decodeBanded(uri, maxEdge, exact)?.let { return it }
        val bmp = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) decodeP(uri, maxEdge) else decodeLegacy(uri, maxEdge)
        return if (exact) fitWithin(bmp, maxEdge) else bmp
    }

    /**
     * ImageDecoder decodes at whole-number sample sizes as it reads, but any other
     * target size is reached by decoding the full image first and scaling that copy:
     * 192 MB held for a moment to make a 75 MB bitmap from a 48 MP photo. So it is
     * only ever asked for a sample size, and the remaining step, if any, is taken by
     * decodeBanded or fitWithin.
     */
    private fun decodeP(uri: Uri, maxEdge: Int): Bitmap {
        val source = ImageDecoder.createSource(ctx.contentResolver, uri)
        val decoded = ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            // Mutable, so grayscale and the white JPEG background are drawn in place.
            decoder.isMutableRequired = true
            val long = max(info.size.width, info.size.height)
            if (long > maxEdge) decoder.setTargetSampleSize(max(1, long / maxEdge))
        }
        if (decoded.config == Bitmap.Config.ARGB_8888) return decoded
        // HDR (RGBA_F16) and other configs: one ARGB_8888 copy, the original let go at once.
        return replace(decoded, decoded.copy(Bitmap.Config.ARGB_8888, true))
    }

    private fun decodeLegacy(uri: Uri, maxEdge: Int): Bitmap {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        ctx.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxEdge) sample *= 2
        val opts = BitmapFactory.Options().apply {
            inSampleSize = sample
            inPreferredConfig = Bitmap.Config.ARGB_8888
            inMutable = true
        }
        val raw = ctx.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) }
            ?: throw IllegalStateException("This image format is not supported on this phone.")
        val m = orientationMatrix(exifOrientation(uri), raw.width.toFloat(), raw.height.toFloat()) ?: return raw
        return replace(raw, Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, m, true))
    }

    /**
     * A big JPEG brought down to a size sampling cannot reach — a 48 MP photo kept
     * at 19 MP, a 12 MP one put on an A4 page — is read in horizontal bands of a few
     * MB, each drawn scaled (and turned upright per its EXIF tag) straight into the
     * finished bitmap. The full-size image never exists in memory. Returns null for
     * anything else, which then takes the ordinary path.
     */
    private fun decodeBanded(uri: Uri, maxEdge: Int, exact: Boolean): Bitmap? {
        if (!isJpeg(uri)) return null
        val region = try {
            ctx.contentResolver.openInputStream(uri)?.use {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) BitmapRegionDecoder.newInstance(it)
                else @Suppress("DEPRECATION") BitmapRegionDecoder.newInstance(it, false)
            }
        } catch (_: Exception) {
            null
        } ?: return null
        try {
            val w = region.width
            val h = region.height
            val long = max(w, h)
            // Small, already small enough, or (when the caller scales afterwards anyway)
            // reachable by sampling alone: not needed.
            if (long <= maxEdge || (!exact && long >= maxEdge * 2) || w.toLong() * h < BANDED_MIN_PIXELS) return null

            val scale = maxEdge.toFloat() / long
            val ow = max(1, (w * scale).roundToInt())
            val oh = max(1, (h * scale).roundToInt())
            val orientation = exifOrientation(uri)
            val swap = orientation in SWAPPING
            val out = Bitmap.createBitmap(if (swap) oh else ow, if (swap) ow else oh, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(out)
            orientationMatrix(orientation, ow.toFloat(), oh.toFloat())?.let { canvas.concat(it) }
            val paint = Paint(Paint.FILTER_BITMAP_FLAG)
            val opts = BitmapFactory.Options().apply {
                inPreferredConfig = Bitmap.Config.ARGB_8888
                // Bands read at a whole-number sample when the image is over twice the size.
                inSampleSize = max(1, long / maxEdge)
            }
            val bandRows = max(16, ((BAND_BYTES / (w * 4L)) * scale).toInt())

            var dy0 = 0
            while (dy0 < oh) {
                val dy1 = min(oh, dy0 + bandRows)
                // A couple of rows either side, clipped off again, so the filtering at
                // the edge of one band matches its neighbour and no seam shows.
                val sy0 = max(0, floor(dy0 / scale).toInt() - 2)
                val sy1 = min(h, ceil(dy1 / scale).toInt() + 2)
                val band = region.decodeRegion(Rect(0, sy0, w, sy1), opts)
                    ?: throw IllegalStateException("This image could not be read.")
                canvas.save()
                canvas.clipRect(0f, dy0.toFloat(), ow.toFloat(), dy1.toFloat())
                canvas.drawBitmap(band, null, RectF(0f, sy0 * scale, w * scale, sy1 * scale), paint)
                canvas.restore()
                band.recycle()
                dy0 = dy1
            }
            return out
        } catch (e: OutOfMemoryError) {
            throw e
        } catch (_: Exception) {
            return null
        } finally {
            region.recycle()
        }
    }

    private fun isJpeg(uri: Uri): Boolean = try {
        ctx.contentResolver.openInputStream(uri)?.use { s ->
            s.read() == 0xFF && s.read() == 0xD8 && s.read() == 0xFF
        } ?: false
    } catch (_: Exception) {
        false
    }

    private fun exifOrientation(uri: Uri): Int = try {
        ctx.contentResolver.openInputStream(uri)?.use {
            ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        } ?: ExifInterface.ORIENTATION_NORMAL
    } catch (_: Exception) {
        ExifInterface.ORIENTATION_NORMAL
    }

    /** Maps a w×h stored image onto its upright form, or null when it is already upright. */
    private fun orientationMatrix(orientation: Int, w: Float, h: Float): Matrix? {
        val m = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> { m.postRotate(90f); m.postTranslate(h, 0f) }
            ExifInterface.ORIENTATION_ROTATE_180 -> { m.postRotate(180f); m.postTranslate(w, h) }
            ExifInterface.ORIENTATION_ROTATE_270 -> { m.postRotate(270f); m.postTranslate(0f, w) }
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> { m.postScale(-1f, 1f); m.postTranslate(w, 0f) }
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> { m.postScale(1f, -1f); m.postTranslate(0f, h) }
            ExifInterface.ORIENTATION_TRANSPOSE -> { m.postRotate(90f); m.postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_TRANSVERSE -> { m.postRotate(270f); m.postScale(-1f, 1f); m.postTranslate(h, w) }
            else -> return null
        }
        return m
    }

    /** Scales down so the long side is maxEdge; the original is recycled. */
    private fun fitWithin(bmp: Bitmap, maxEdge: Int): Bitmap {
        val long = max(bmp.width, bmp.height)
        if (long <= maxEdge) return bmp
        val s = maxEdge.toFloat() / long
        return replace(bmp, Bitmap.createScaledBitmap(bmp, max(1, (bmp.width * s).roundToInt()), max(1, (bmp.height * s).roundToInt()), true))
    }

    /**
     * sourceScale is decoded pixels per source pixel, so a percentage means a share
     * of the photo itself rather than of the copy in memory. px converts a requested
     * size in real pixels to the units of w and h (1 except when sizing a job ahead).
     */
    private fun targetSize(w: Int, h: Int, opts: ReadableMap, sourceScale: Float, px: Float = 1f): Pair<Int, Int> {
        val ew = opts.int("width", 0)
        val eh = opts.int("height", 0)
        val keep = !opts.hasKey("keepAspect") || opts.bool("keepAspect")
        if (ew > 0 || eh > 0) {
            val rw = ew * px
            val rh = eh * px
            return when {
                ew > 0 && eh > 0 && !keep -> max(1, rw.roundToInt()) to max(1, rh.roundToInt())
                ew > 0 && eh > 0 -> {
                    val s = min(rw / w, rh / h)
                    max(1, (w * s).roundToInt()) to max(1, (h * s).roundToInt())
                }
                ew > 0 -> max(1, rw.roundToInt()) to max(1, (h * rw / w).roundToInt())
                else -> max(1, (w * rh / h).roundToInt()) to max(1, rh.roundToInt())
            }
        }
        val pct = opts.int("scale", 100)
        if (pct in 1..99) {
            // Never above the decoded copy: a percentage of a photo larger than
            // KEEP_EDGE stops at KEEP_EDGE rather than being blown back up.
            val s = min(1f, pct / 100f / sourceScale)
            return max(1, (w * s).roundToInt()) to max(1, (h * s).roundToInt())
        }
        val edge = opts.int("maxEdge", 0) * px
        if (edge > 0 && max(w, h) > edge) {
            val s = edge / max(w, h)
            return max(1, (w * s).roundToInt()) to max(1, (h * s).roundToInt())
        }
        return w to h
    }

    private fun cropSize(w: Int, h: Int, aspect: String): Pair<Int, Int>? {
        val parts = aspect.split(":").mapNotNull { it.toFloatOrNull() }
        if (parts.size != 2 || parts[0] <= 0 || parts[1] <= 0) return null
        val want = parts[0] / parts[1]
        val have = w.toFloat() / h
        return if (have > want) max(1, (h * want).roundToInt()) to h
        else w to max(1, (w / want).roundToInt())
    }

    private fun centreCrop(src: Bitmap, aspect: String): Bitmap {
        val (cw, ch) = cropSize(src.width, src.height, aspect) ?: return src
        val x = (src.width - cw) / 2
        val y = (src.height - ch) / 2
        return replace(src, Bitmap.createBitmap(src, x, y, cw, ch))
    }

    /**
     * Grey in place, a row at a time, when the bitmap can be written to: no second
     * full-size bitmap. The weights are ColorMatrix.setSaturation(0)'s, so the result
     * matches the colour-filter path used for an immutable bitmap.
     */
    private fun grayscale(bmp: Bitmap): Bitmap {
        if (!bmp.isMutable) {
            val g = Bitmap.createBitmap(bmp.width, bmp.height, Bitmap.Config.ARGB_8888)
            val p = Paint().apply { colorFilter = ColorMatrixColorFilter(ColorMatrix().apply { setSaturation(0f) }) }
            Canvas(g).drawBitmap(bmp, 0f, 0f, p)
            return replace(bmp, g)
        }
        val row = IntArray(bmp.width)
        for (y in 0 until bmp.height) {
            bmp.getPixels(row, 0, bmp.width, 0, y, bmp.width, 1)
            for (x in row.indices) {
                val c = row[x]
                val l = (0.213f * Color.red(c) + 0.715f * Color.green(c) + 0.072f * Color.blue(c)).roundToInt().coerceIn(0, 255)
                row[x] = Color.argb(Color.alpha(c), l, l, l)
            }
            bmp.setPixels(row, 0, bmp.width, 0, y, bmp.width, 1)
        }
        return bmp
    }

    private fun write(bmp: Bitmap, format: String, quality: Int, out: File) {
        FileOutputStream(out).use { stream ->
            when (format) {
                "png" -> bmp.compress(Bitmap.CompressFormat.PNG, 100, stream)
                "webp" -> {
                    @Suppress("DEPRECATION")
                    val f = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        if (quality >= 100) Bitmap.CompressFormat.WEBP_LOSSLESS else Bitmap.CompressFormat.WEBP_LOSSY
                    } else Bitmap.CompressFormat.WEBP
                    bmp.compress(f, quality, stream)
                }
                else -> {
                    // JPEG has no transparency: flatten onto white rather than black,
                    // in place when the bitmap allows it.
                    if (bmp.hasAlpha() && bmp.isMutable) {
                        Canvas(bmp).drawColor(Color.WHITE, PorterDuff.Mode.DST_OVER)
                        bmp.compress(Bitmap.CompressFormat.JPEG, quality, stream)
                    } else if (bmp.hasAlpha()) {
                        val flat = Bitmap.createBitmap(bmp.width, bmp.height, Bitmap.Config.ARGB_8888)
                        Canvas(flat).apply { drawColor(Color.WHITE); drawBitmap(bmp, 0f, 0f, null) }
                        flat.compress(Bitmap.CompressFormat.JPEG, quality, stream)
                        flat.recycle()
                    } else {
                        bmp.compress(Bitmap.CompressFormat.JPEG, quality, stream)
                    }
                }
            }
        }
    }

    private fun replace(old: Bitmap, new: Bitmap): Bitmap {
        if (old !== new) old.recycle()
        return new
    }

    private fun toUri(s: String): Uri = if (s.startsWith("/")) Uri.fromFile(File(s)) else Uri.parse(s)

    /** Pixels for a page side of the given length in points, at PAGE_DPI. */
    private fun pagePixels(points: Int) = (points / 72f * PAGE_DPI).roundToInt()

    private fun ReadableMap.str(k: String) = if (hasKey(k) && !isNull(k)) getString(k) else null
    private fun ReadableMap.int(k: String, d: Int) = if (hasKey(k) && !isNull(k)) getDouble(k).toInt() else d
    private fun ReadableMap.bool(k: String) = hasKey(k) && !isNull(k) && getBoolean(k)

    private companion object {
        /** ~19 MP: big enough for any phone photo kept at its size. */
        const val KEEP_EDGE = 5000
        /** An A4 or Letter page drawn at this many dots per inch. */
        const val PAGE_DPI = 200
        /** A "fit" page is the image itself, at 150 dpi; this caps it at 16 inches. */
        const val FIT_PAGE_EDGE = 2400
        const val OCR_EDGE = 2500
        /** Below ~8 MP the full decode is small enough that bands are not worth it. */
        const val BANDED_MIN_PIXELS = 8_000_000L
        /** Size of one band of a banded decode. */
        const val BAND_BYTES = 8L * 1024 * 1024
        val SWAPPING = setOf(
            ExifInterface.ORIENTATION_ROTATE_90,
            ExifInterface.ORIENTATION_ROTATE_270,
            ExifInterface.ORIENTATION_TRANSPOSE,
            ExifInterface.ORIENTATION_TRANSVERSE,
        )
    }
}
