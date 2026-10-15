package com.mps.allinone

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.graphics.Paint
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
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Every image tool in one place: compress, resize, change resolution, convert
 * format, crop to an aspect, rotate, flip, grayscale, images to PDF and OCR.
 * Everything runs on the device; nothing touches the network.
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
                bmp = decode(uriString, maxDecodeEdge(opts))

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

                val (tw, th) = targetSize(bmp.width, bmp.height, opts)
                if (tw != bmp.width || th != bmp.height) {
                    bmp = replace(bmp, Bitmap.createScaledBitmap(bmp, tw, th, true))
                }

                if (opts.bool("grayscale")) {
                    val g = Bitmap.createBitmap(bmp.width, bmp.height, Bitmap.Config.ARGB_8888)
                    val p = Paint().apply { colorFilter = ColorMatrixColorFilter(ColorMatrix().apply { setSaturation(0f) }) }
                    Canvas(g).drawBitmap(bmp, 0f, 0f, p)
                    bmp = replace(bmp, g)
                }

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
     */
    @ReactMethod
    fun imagesToPdf(uris: ReadableArray, pageSize: String, margin: Int, outPath: String, promise: Promise) {
        worker.execute {
            val doc = PdfDocument()
            try {
                for (i in 0 until uris.size()) {
                    val bmp = decode(uris.getString(i) ?: continue, 2400)
                    val (pw, ph) = when (pageSize) {
                        "a4" -> 595 to 842
                        "letter" -> 612 to 792
                        else -> {
                            // Image at 150 dpi, expressed in points.
                            val s = 72f / 150f
                            max(1, (bmp.width * s).roundToInt()) to max(1, (bmp.height * s).roundToInt())
                        }
                    }
                    val page = doc.startPage(PdfDocument.PageInfo.Builder(pw, ph, i + 1).create())
                    val c = page.canvas
                    c.drawColor(Color.WHITE)
                    val m = if (pageSize == "fit") 0 else margin
                    val scale = min((pw - 2f * m) / bmp.width, (ph - 2f * m) / bmp.height)
                    val w = bmp.width * scale
                    val h = bmp.height * scale
                    val left = (pw - w) / 2f
                    val top = (ph - h) / 2f
                    c.drawBitmap(bmp, null, android.graphics.RectF(left, top, left + w, top + h), Paint(Paint.FILTER_BITMAP_FLAG))
                    doc.finishPage(page)
                    bmp.recycle()
                }
                val out = File(outPath).apply { parentFile?.mkdirs() }
                FileOutputStream(out).use { doc.writeTo(it) }
                promise.resolve(out.absolutePath)
            } catch (e: OutOfMemoryError) {
                promise.reject("E_MEMORY", "Too many large images at once. Try fewer images.")
            } catch (e: Exception) {
                promise.reject("E_IMAGE", e.message ?: "Could not build the PDF.", e)
            } finally {
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
                bmp = decode(uriString, 3000)
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

    private fun maxDecodeEdge(opts: ReadableMap): Int {
        // Decode no larger than needed, so a 50 MP photo does not exhaust memory.
        val explicit = max(opts.int("width", 0), opts.int("height", 0))
        val edge = opts.int("maxEdge", 0)
        return when {
            explicit > 0 -> max(explicit, 1) * 2
            edge > 0 -> edge * 2
            // ~19 MP: big enough for any phone photo, small enough not to run out of memory.
            else -> 5000
        }
    }

    /** Decodes with EXIF orientation applied, sampled down so the long edge is near maxEdge. */
    private fun decode(uriString: String, maxEdge: Int): Bitmap {
        val uri = if (uriString.startsWith("/")) Uri.fromFile(File(uriString)) else Uri.parse(uriString)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val source = ImageDecoder.createSource(ctx.contentResolver, uri)
            return ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                val long = max(info.size.width, info.size.height)
                if (long > maxEdge) {
                    val s = maxEdge.toFloat() / long
                    decoder.setTargetSize(max(1, (info.size.width * s).toInt()), max(1, (info.size.height * s).toInt()))
                }
            }.let { if (it.config != Bitmap.Config.ARGB_8888) it.copy(Bitmap.Config.ARGB_8888, true) else it }
        }

        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        ctx.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxEdge) sample *= 2
        val opts = BitmapFactory.Options().apply {
            inSampleSize = sample
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        val raw = ctx.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) }
            ?: throw IllegalStateException("This image format is not supported on this phone.")
        val orientation = try {
            ctx.contentResolver.openInputStream(uri)?.use {
                ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
            } ?: ExifInterface.ORIENTATION_NORMAL
        } catch (_: Exception) {
            ExifInterface.ORIENTATION_NORMAL
        }
        val m = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> m.postRotate(90f)
            ExifInterface.ORIENTATION_ROTATE_180 -> m.postRotate(180f)
            ExifInterface.ORIENTATION_ROTATE_270 -> m.postRotate(270f)
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> m.postScale(-1f, 1f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> m.postScale(1f, -1f)
            else -> return raw
        }
        return replace(raw, Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, m, true))
    }

    private fun targetSize(w: Int, h: Int, opts: ReadableMap): Pair<Int, Int> {
        val ew = opts.int("width", 0)
        val eh = opts.int("height", 0)
        val keep = !opts.hasKey("keepAspect") || opts.bool("keepAspect")
        if (ew > 0 || eh > 0) {
            return when {
                ew > 0 && eh > 0 && !keep -> ew to eh
                ew > 0 && eh > 0 -> {
                    val s = min(ew.toFloat() / w, eh.toFloat() / h)
                    max(1, (w * s).roundToInt()) to max(1, (h * s).roundToInt())
                }
                ew > 0 -> ew to max(1, (h * ew.toFloat() / w).roundToInt())
                else -> max(1, (w * eh.toFloat() / h).roundToInt()) to eh
            }
        }
        val pct = opts.int("scale", 100)
        if (pct in 1..99) {
            return max(1, w * pct / 100) to max(1, h * pct / 100)
        }
        val edge = opts.int("maxEdge", 0)
        if (edge > 0 && max(w, h) > edge) {
            val s = edge.toFloat() / max(w, h)
            return max(1, (w * s).roundToInt()) to max(1, (h * s).roundToInt())
        }
        return w to h
    }

    private fun centreCrop(src: Bitmap, aspect: String): Bitmap {
        val parts = aspect.split(":").mapNotNull { it.toFloatOrNull() }
        if (parts.size != 2 || parts[0] <= 0 || parts[1] <= 0) return src
        val want = parts[0] / parts[1]
        val have = src.width.toFloat() / src.height
        val (cw, ch) = if (have > want) (src.height * want).roundToInt() to src.height
        else src.width to (src.width / want).roundToInt()
        val x = (src.width - cw) / 2
        val y = (src.height - ch) / 2
        return replace(src, Bitmap.createBitmap(src, x, y, max(1, cw), max(1, ch)))
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
                    // JPEG has no transparency: flatten onto white rather than black.
                    if (bmp.hasAlpha()) {
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

    private fun ReadableMap.str(k: String) = if (hasKey(k) && !isNull(k)) getString(k) else null
    private fun ReadableMap.int(k: String, d: Int) = if (hasKey(k) && !isNull(k)) getDouble(k).toInt() else d
    private fun ReadableMap.bool(k: String) = hasKey(k) && !isNull(k) && getBoolean(k)
}
