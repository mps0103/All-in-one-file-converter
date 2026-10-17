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
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.EOFException
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.zip.CRC32
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
     *  width / height  exact size in px, 1..10000; with keepAspect a missing side
     *           follows the picture's shape, and two sides are a box it fits inside
     *  scale    percent of the picture itself, 1..1000 (over 100 enlarges)
     *  rotate   0 | 90 | 180 | 270
     *  flipH / flipV / grayscale  booleans
     *  aspect   "1:1" | "4:3" | "3:4" | "16:9" | "9:16" | "3:2" | "2:3" — centre crop
     *  crop     {x, y, w, h} as fractions of the upright picture after rotate/flip
     *  dpi      dots per inch written into a JPEG (JFIF) or PNG (pHYs)
     *  dpiOnly  the pixels stay as they are: the file is copied and only its DPI changes
     *  outPath  where to write
     */
    @ReactMethod
    fun process(uriString: String, opts: ReadableMap, promise: Promise) {
        worker.execute {
            var bmp: Bitmap? = null
            try {
                val outPath = opts.str("outPath") ?: throw IllegalArgumentException("No output path.")
                val out = File(outPath).apply { parentFile?.mkdirs() }
                val plan = plan(uriString, opts)
                val dpi = opts.int("dpi", 0)

                if (opts.bool("dpiOnly")) {
                    // Not re-encoded at all: same pixels, same quality, a new DPI field.
                    val format = sourceFormat(uriString)
                    ctx.contentResolver.openInputStream(toUri(uriString))?.use { input ->
                        FileOutputStream(out).use { copyWithDpi(input, format, it, dpi) }
                    } ?: throw IllegalStateException("This image could not be read.")
                    if (format == "jpg") matchExifDpi(out, dpi)
                    promise.resolve(result(out, plan.uprightW, plan.uprightH, format))
                    return@execute
                }

                bmp = render(uriString, opts, plan, plan.outW, plan.outH, plan.decodeEdge, exact = plan.decodeEdge == min(plan.srcLong, KEEP_EDGE))
                val format = outFormat(uriString, opts)
                write(bmp, format, opts.int("quality", 90).coerceIn(1, 100), out)
                if (dpi > 0 && (format == "jpg" || format == "png")) setDpi(out, format, dpi)
                promise.resolve(result(out, bmp.width, bmp.height, format))
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
     * The job process() would do, drawn no larger than maxSide and written to the
     * cache in the job's own format and quality, so what is shown is what will be
     * saved. Resolves {uri, width, height, outWidth, outHeight, estimatedBytes,
     * srcWidth, srcHeight, exact}: out* is the real job's size, and when the job fits
     * inside maxSide the preview is the job itself (exact) and so is its size.
     *
     * opts.slot names the preview (one screen can show more than one); a newer
     * request for the same slot makes an older one still waiting resolve null, and
     * replaces its file.
     */
    @ReactMethod
    fun preview(uriString: String, opts: ReadableMap, maxSide: Int, promise: Promise) {
        val slot = (opts.str("slot") ?: "main").filter { it.isLetterOrDigit() }.ifEmpty { "main" }
        val gen = previewGen.merge(slot, 1, Int::plus)
        worker.execute {
            if (previewGen[slot] != gen) {
                promise.resolve(null)
                return@execute
            }
            var bmp: Bitmap? = null
            try {
                val plan = plan(uriString, opts)
                val p = min(1.0, maxSide.coerceIn(64, 2048).toDouble() / max(plan.outW, plan.outH))
                val pw = max(1, (plan.outW * p).roundToInt())
                val ph = max(1, (plan.outH * p).roundToInt())
                bmp = render(uriString, opts, plan, pw, ph, max(1, ceil(plan.decodeEdge * p).toInt()), exact = false)
                val format = if (opts.bool("dpiOnly")) sourceFormat(uriString) else outFormat(uriString, opts)
                val dir = File(ctx.cacheDir, PREVIEW_DIR).apply { mkdirs() }
                dir.listFiles()?.forEach { if (it.name.startsWith("$slot-")) it.delete() }
                val out = File(dir, "$slot-${System.nanoTime()}.${if (format == "jpg") "jpg" else format}")
                write(bmp, format, opts.int("quality", 90).coerceIn(1, 100), out)
                val estimate = when {
                    opts.bool("dpiOnly") -> sourceBytes(uriString).toDouble()
                    p >= 1.0 -> out.length().toDouble()
                    // Scaled up from the preview by pixel count: close enough for a guide.
                    else -> out.length() * (plan.outW.toDouble() * plan.outH) / (pw.toDouble() * ph)
                }
                promise.resolve(Arguments.createMap().apply {
                    putString("uri", Uri.fromFile(out).toString())
                    putInt("width", pw)
                    putInt("height", ph)
                    putInt("outWidth", plan.outW)
                    putInt("outHeight", plan.outH)
                    putDouble("estimatedBytes", estimate)
                    putInt("srcWidth", plan.uprightW)
                    putInt("srcHeight", plan.uprightH)
                    putBoolean("exact", p >= 1.0)
                })
            } catch (e: OutOfMemoryError) {
                promise.reject("E_MEMORY", "This picture is too large to preview.")
            } catch (e: Exception) {
                promise.reject("E_IMAGE", e.message ?: "Could not preview the image.", e)
            } finally {
                bmp?.recycle()
            }
        }
    }

    /** The screen showing previews has closed: their files go. */
    @ReactMethod
    fun clearPreviews() {
        previewGen.clear()
        worker.execute { File(ctx.cacheDir, PREVIEW_DIR).listFiles()?.forEach { it.delete() } }
    }

    private val previewGen = ConcurrentHashMap<String, Int>()

    private fun result(out: File, w: Int, h: Int, format: String) = Arguments.createMap().apply {
        putString("path", out.absolutePath)
        putInt("width", w)
        putInt("height", h)
        putDouble("size", out.length().toDouble())
        putString("format", format)
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
     * What a job makes, worked out from the picture's header alone, before anything
     * is decoded: the upright source size, the exact output size, and the long side
     * to decode at so the output is never drawn from fewer pixels than it has.
     */
    private class Plan(val srcLong: Int, val uprightW: Int, val uprightH: Int, val outW: Int, val outH: Int, val decodeEdge: Int)

    private fun plan(uriString: String, opts: ReadableMap): Plan {
        val (uw, uh) = uprightSize(uriString)
        val srcLong = max(uw, uh)
        // The part of the picture that is kept, in source pixels, in the order render()
        // works: centre crop to an aspect, rotate, then the crop box.
        var cw = uw.toDouble()
        var ch = uh.toDouble()
        aspectOf(opts.str("aspect"))?.let { want -> if (cw / ch > want) cw = ch * want else ch = cw / want }
        val rotate = opts.int("rotate", 0)
        if (rotate == 90 || rotate == 270) cw = ch.also { ch = cw }
        cropBox(opts)?.let { r ->
            cw *= r.width()
            ch *= r.height()
        }
        val (ow, oh) = if (opts.bool("dpiOnly")) uw to uh else outSize(cw, ch, srcLong, opts)
        if (ow > MAX_SIDE || oh > MAX_SIDE || ow.toLong() * oh > MAX_PIXELS) {
            throw IllegalArgumentException("$ow × $oh px is larger than this phone can make. Pick a smaller size.")
        }
        // Output pixels per source pixel; below 1 the picture is decoded only that large.
        val f = max(ow / cw, oh / ch)
        val edge = ceil(srcLong * min(1.0, f) - 1e-6).toInt().coerceIn(1, srcLong)
        return Plan(srcLong, uw, uh, ow, oh, edge)
    }

    /** The output size for a kept part of cw × ch source pixels. */
    private fun outSize(cw: Double, ch: Double, srcLong: Int, opts: ReadableMap): Pair<Int, Int> {
        fun px(v: Double) = max(1, v.roundToInt())
        val ew = opts.int("width", 0).coerceIn(0, MAX_SIDE)
        val eh = opts.int("height", 0).coerceIn(0, MAX_SIDE)
        val keep = !opts.hasKey("keepAspect") || opts.bool("keepAspect")
        if (ew > 0 || eh > 0) {
            return when {
                // Proportions off: exactly what was typed.
                ew > 0 && eh > 0 && !keep -> ew to eh
                // Proportions on and both typed: the largest size that fits the box.
                ew > 0 && eh > 0 -> min(ew / cw, eh / ch).let { s -> px(cw * s) to px(ch * s) }
                // One side typed: the other follows the picture's own shape.
                ew > 0 -> ew to px(ch * ew / cw)
                else -> px(cw * eh / ch) to eh
            }
        }
        val pct = opts.int("scale", 100).coerceIn(1, 1000)
        if (pct != 100) return px(cw * pct / 100.0) to px(ch * pct / 100.0)
        val edge = opts.int("maxEdge", 0)
        if (edge > 0 && max(cw, ch) > edge) {
            val s = edge / max(cw, ch)
            return px(cw * s) to px(ch * s)
        }
        // Kept at its size, up to KEEP_EDGE on the source's long side.
        val k = min(1.0, KEEP_EDGE.toDouble() / srcLong)
        return px(cw * k) to px(ch * k)
    }

    /**
     * Decodes and does the job at outW × outH: centre crop, rotate/flip, crop box,
     * then one filtered scale to exactly the size asked for, then grey.
     */
    private fun render(uriString: String, opts: ReadableMap, plan: Plan, outW: Int, outH: Int, edge: Int, exact: Boolean): Bitmap {
        var bmp = decode(uriString, edge, exact)
        try {
            val aspect = opts.str("aspect")
            if (aspectOf(aspect) != null) bmp = centreCrop(bmp, aspect!!)

            val rotate = opts.int("rotate", 0)
            val flipH = opts.bool("flipH")
            val flipV = opts.bool("flipV")
            if (rotate != 0 || flipH || flipV) {
                val m = Matrix()
                if (rotate != 0) m.postRotate(rotate.toFloat())
                if (flipH || flipV) m.postScale(if (flipH) -1f else 1f, if (flipV) -1f else 1f)
                bmp = replace(bmp, Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true))
            }

            cropBox(opts)?.let { r ->
                val x = (r.left * bmp.width).roundToInt().coerceIn(0, bmp.width - 1)
                val y = (r.top * bmp.height).roundToInt().coerceIn(0, bmp.height - 1)
                val w = (r.width() * bmp.width).roundToInt().coerceIn(1, bmp.width - x)
                val h = (r.height() * bmp.height).roundToInt().coerceIn(1, bmp.height - y)
                bmp = replace(bmp, Bitmap.createBitmap(bmp, x, y, w, h))
            }

            if (outW != bmp.width || outH != bmp.height) bmp = replace(bmp, Bitmap.createScaledBitmap(bmp, outW, outH, true))
            if (opts.bool("grayscale")) bmp = grayscale(bmp)
            return bmp
        } catch (e: Throwable) {
            bmp.recycle()
            throw e
        }
    }

    /** The picture's width and height as it is seen, EXIF rotation applied. */
    private fun uprightSize(uriString: String): Pair<Int, Int> {
        val (sw, sh) = sourceSize(uriString)
        if (sw > 0 && sh > 0) return if (exifOrientation(toUri(uriString)) in SWAPPING) sh to sw else sw to sh
        // A format BitmapFactory cannot size (some HEIF): a thumbnail-sized decode tells.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) throw IllegalStateException("This image format is not supported on this phone.")
        var w = 0
        var h = 0
        val tiny = ImageDecoder.decodeBitmap(ImageDecoder.createSource(ctx.contentResolver, toUri(uriString))) { d, info, _ ->
            w = info.size.width
            h = info.size.height
            d.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            d.setTargetSampleSize(max(1, max(w, h) / 64))
        }
        val turned = w != h && (tiny.width > tiny.height) != (w > h)
        tiny.recycle()
        if (w <= 0 || h <= 0) throw IllegalStateException("This image could not be read.")
        return if (turned) h to w else w to h
    }

    private fun aspectOf(aspect: String?): Double? {
        if (aspect.isNullOrBlank() || aspect == "free") return null
        val parts = aspect.split(":").mapNotNull { it.toDoubleOrNull() }
        if (parts.size != 2 || parts[0] <= 0 || parts[1] <= 0) return null
        return parts[0] / parts[1]
    }

    /** The crop box as fractions of the upright, rotated picture; null for none. */
    private fun cropBox(opts: ReadableMap): RectF? {
        if (!opts.hasKey("crop") || opts.isNull("crop")) return null
        val m = opts.getMap("crop") ?: return null
        fun d(k: String, def: Double) = if (m.hasKey(k) && !m.isNull(k)) m.getDouble(k) else def
        val x = d("x", 0.0).coerceIn(0.0, 0.999)
        val y = d("y", 0.0).coerceIn(0.0, 0.999)
        val w = d("w", 1.0).coerceIn(0.001, 1.0 - x)
        val h = d("h", 1.0).coerceIn(0.001, 1.0 - y)
        if (x <= 0.0005 && y <= 0.0005 && w >= 0.9995 && h >= 0.9995) return null
        return RectF(x.toFloat(), y.toFloat(), (x + w).toFloat(), (y + h).toFloat())
    }

    private fun outFormat(uriString: String, opts: ReadableMap): String = when (val f = opts.str("format") ?: "same") {
        "same" -> sourceFormat(uriString).let { if (it == "png" || it == "webp") it else "jpg" }
        else -> f
    }

    /** jpg, png or webp from the file's own first bytes (a file:// uri has no MIME type). */
    private fun sourceFormat(uriString: String): String {
        val head = ByteArray(12)
        val n = try {
            ctx.contentResolver.openInputStream(toUri(uriString))?.use { readUpTo(it, head) } ?: 0
        } catch (_: Exception) {
            0
        }
        return when {
            n >= 3 && head[0] == 0xFF.toByte() && head[1] == 0xD8.toByte() -> "jpg"
            n >= 8 && head[0] == 0x89.toByte() && head[1] == 'P'.code.toByte() && head[2] == 'N'.code.toByte() -> "png"
            n >= 12 && String(head, 0, 4, Charsets.US_ASCII) == "RIFF" && String(head, 8, 4, Charsets.US_ASCII) == "WEBP" -> "webp"
            else -> {
                val mime = ctx.contentResolver.getType(toUri(uriString)) ?: ""
                when {
                    mime.contains("png") -> "png"
                    mime.contains("webp") -> "webp"
                    else -> "other"
                }
            }
        }
    }

    private fun readUpTo(s: InputStream, buf: ByteArray): Int {
        var n = 0
        while (n < buf.size) {
            val r = s.read(buf, n, buf.size - n)
            if (r < 0) break
            n += r
        }
        return n
    }

    private fun sourceBytes(uriString: String): Long = try {
        ctx.contentResolver.openAssetFileDescriptor(toUri(uriString), "r")?.use { it.length } ?: 0L
    } catch (_: Exception) {
        0L
    }

    // ------------------------------------------------------------------- DPI

    /** Rewrites a saved JPEG or PNG in place with a new DPI field. */
    private fun setDpi(file: File, format: String, dpi: Int) {
        val tmp = File(file.path + ".dpi")
        FileInputStream(file).use { input -> FileOutputStream(tmp).use { copyWithDpi(input, format, it, dpi) } }
        if (!tmp.renameTo(file)) {
            tmp.delete()
            throw IllegalStateException("Could not save the DPI setting.")
        }
    }

    /**
     * Streams a JPEG or PNG to out with its dots per inch set, every other byte as
     * it was: the JFIF header of a JPEG (added when the file has none) or the pHYs
     * chunk of a PNG. A camera JPEG's EXIF resolution is set to match afterwards.
     */
    private fun copyWithDpi(input: InputStream, format: String, out: OutputStream, dpi: Int) {
        if (dpi !in 1..65535) throw IllegalArgumentException("Pick a DPI between 1 and 65535.")
        val i = DataInputStream(BufferedInputStream(input, 64 * 1024))
        val o = DataOutputStream(BufferedOutputStream(out, 64 * 1024))
        when (format) {
            "jpg" -> jpegWithDpi(i, o, dpi)
            "png" -> pngWithDpi(i, o, dpi)
            else -> throw IllegalArgumentException("Only JPG and PNG pictures carry a DPI setting.")
        }
        o.flush()
    }

    private fun jpegWithDpi(i: DataInputStream, o: DataOutputStream, dpi: Int) {
        if (i.readUnsignedShort() != 0xFFD8) throw IllegalStateException("This is not a JPEG file.")
        o.writeShort(0xFFD8)
        val marker = i.readUnsignedShort()
        if (marker == 0xFFE0) {
            val len = i.readUnsignedShort()
            val data = ByteArray(len - 2).also { i.readFully(it) }
            if (len >= 16 && String(data, 0, 5, Charsets.ISO_8859_1) == "JFIF\u0000") {
                // units 1 = dots per inch, then X and Y density.
                data[7] = 1
                data[8] = (dpi shr 8).toByte(); data[9] = dpi.toByte()
                data[10] = (dpi shr 8).toByte(); data[11] = dpi.toByte()
            } else {
                writeJfif(o, dpi)
            }
            o.writeShort(0xFFE0)
            o.writeShort(len)
            o.write(data)
        } else {
            // No JFIF header (camera photos start with EXIF): one goes first, as the format wants.
            writeJfif(o, dpi)
            o.writeShort(marker)
        }
        i.copyTo(o, 64 * 1024)
    }

    /**
     * A camera photo also states its resolution in EXIF (usually 72), which Windows
     * and print dialogs read before JFIF; it is set to the same. A photo with no
     * EXIF block is left without one.
     */
    private fun matchExifDpi(file: File, dpi: Int) {
        try {
            val exif = ExifInterface(file)
            if (exif.getAttribute(ExifInterface.TAG_X_RESOLUTION) == null) return
            exif.setAttribute(ExifInterface.TAG_X_RESOLUTION, "$dpi/1")
            exif.setAttribute(ExifInterface.TAG_Y_RESOLUTION, "$dpi/1")
            exif.setAttribute(ExifInterface.TAG_RESOLUTION_UNIT, "2") // inches
            exif.saveAttributes()
        } catch (_: Exception) {
            // The JFIF field is already set; EXIF is a second copy of it.
        }
    }

    private fun writeJfif(o: DataOutputStream, dpi: Int) {
        o.writeShort(0xFFE0)
        o.writeShort(16)
        o.write("JFIF\u0000".toByteArray(Charsets.ISO_8859_1))
        o.writeShort(0x0101) // version 1.01
        o.writeByte(1) // dots per inch
        o.writeShort(dpi)
        o.writeShort(dpi)
        o.writeShort(0) // no thumbnail
    }

    private fun pngWithDpi(i: DataInputStream, o: DataOutputStream, dpi: Int) {
        val sig = ByteArray(8).also { i.readFully(it) }
        if (sig[1] != 'P'.code.toByte() || sig[2] != 'N'.code.toByte()) throw IllegalStateException("This is not a PNG file.")
        o.write(sig)
        val buf = ByteArray(64 * 1024)
        var placed = false
        while (true) {
            val len = try { i.readInt() } catch (_: EOFException) { break }
            val type = ByteArray(4).also { i.readFully(it) }
            val name = String(type, Charsets.US_ASCII)
            var left = len.toLong() + 4 // data and CRC
            if (name == "pHYs") {
                // The old one is dropped; the new one is written straight after IHDR.
                while (left > 0) left -= i.read(buf, 0, min(buf.size.toLong(), left).toInt()).also { if (it < 0) throw EOFException() }
                continue
            }
            if (!placed && name != "IHDR") {
                writePhys(o, dpi)
                placed = true
            }
            o.writeInt(len)
            o.write(type)
            while (left > 0) {
                val n = i.read(buf, 0, min(buf.size.toLong(), left).toInt())
                if (n < 0) throw EOFException()
                o.write(buf, 0, n)
                left -= n
            }
            if (name == "IEND") break
        }
    }

    private fun writePhys(o: DataOutputStream, dpi: Int) {
        val ppm = (dpi / 0.0254).roundToInt()
        val chunk = ByteBuffer.allocate(13).put("pHYs".toByteArray(Charsets.US_ASCII)).putInt(ppm).putInt(ppm).put(1).array()
        o.writeInt(9)
        o.write(chunk)
        o.writeInt(CRC32().apply { update(chunk) }.value.toInt())
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
        /** Largest side the app makes, as the size fields allow. */
        const val MAX_SIDE = 10_000
        /** 50 MP, 200 MB as a bitmap: the most this app holds for one picture. */
        const val MAX_PIXELS = 50_000_000L
        const val PREVIEW_DIR = "imgpreview"
        val SWAPPING = setOf(
            ExifInterface.ORIENTATION_ROTATE_90,
            ExifInterface.ORIENTATION_ROTATE_270,
            ExifInterface.ORIENTATION_TRANSPOSE,
            ExifInterface.ORIENTATION_TRANSVERSE,
        )
    }
}
