package com.mps.allinone.pdf

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDPage
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream
import com.tom_roush.pdfbox.pdmodel.common.PDRectangle
import com.tom_roush.pdfbox.pdmodel.font.PDType1Font
import com.tom_roush.pdfbox.pdmodel.graphics.image.JPEGFactory
import com.tom_roush.pdfbox.pdmodel.graphics.state.RenderingMode
import java.io.File

class PdfOcrModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    init {
        PDFBoxResourceLoader.init(reactContext.applicationContext)
    }

    override fun getName() = "PdfOcr"

    private fun clean(path: String) = path.removePrefix("file://")

    /**
     * Rasterises every page, reads it with ML Kit, and writes a new PDF where
     * the page image carries an invisible text layer behind it. The result is
     * selectable and searchable while looking identical to the scan.
     *
     * Runs on its own thread: Tasks.await blocks, and the native modules
     * thread should not be held for the length of a multi-page scan.
     */
    @ReactMethod
    fun makeSearchable(srcPath: String, destPath: String, dpi: Int, promise: Promise) {
        Thread {
            var fd: ParcelFileDescriptor? = null
            var renderer: PdfRenderer? = null
            try {
                val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
                fd = ParcelFileDescriptor.open(
                    File(clean(srcPath)),
                    ParcelFileDescriptor.MODE_READ_ONLY
                )
                renderer = PdfRenderer(fd)

                val out = PDDocument()
                val font = PDType1Font.HELVETICA
                var wordsFound = 0

                for (i in 0 until renderer.pageCount) {
                    val page = renderer.openPage(i)
                    val scale = dpi / 72f
                    val bw = (page.width * scale).toInt().coerceAtLeast(1)
                    val bh = (page.height * scale).toInt().coerceAtLeast(1)

                    val bitmap = Bitmap.createBitmap(bw, bh, Bitmap.Config.ARGB_8888)
                    bitmap.eraseColor(Color.WHITE)
                    page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_PRINT)
                    val pageWidthPt = page.width.toFloat()
                    val pageHeightPt = page.height.toFloat()
                    page.close()

                    val text = Tasks.await(recognizer.process(InputImage.fromBitmap(bitmap, 0)))

                    val pdPage = PDPage(PDRectangle(pageWidthPt, pageHeightPt))
                    out.addPage(pdPage)

                    val image = JPEGFactory.createFromImage(out, bitmap, 0.8f)
                    PDPageContentStream(out, pdPage).use { cs ->
                        cs.drawImage(image, 0f, 0f, pageWidthPt, pageHeightPt)

                        for (block in text.textBlocks) {
                            for (line in block.lines) {
                                for (element in line.elements) {
                                    val box = element.boundingBox ?: continue
                                    val word = sanitize(element.text)
                                    if (word.isBlank()) continue

                                    // ML Kit boxes are in bitmap pixels with a
                                    // top-left origin; PDF space is points from
                                    // the bottom left.
                                    val x = box.left / scale
                                    val y = pageHeightPt - (box.bottom / scale)
                                    val boxHeight = box.height() / scale
                                    val boxWidth = box.width() / scale
                                    val fontSize = (boxHeight * 0.8f).coerceAtLeast(1f)

                                    val naturalWidth =
                                        font.getStringWidth(word) / 1000f * fontSize
                                    if (naturalWidth <= 0f) continue

                                    cs.beginText()
                                    cs.setRenderingMode(RenderingMode.NEITHER)
                                    cs.setFont(font, fontSize)
                                    // Stretch each word to match the box it came from,
                                    // so selection highlights line up with the image.
                                    cs.setHorizontalScaling(boxWidth / naturalWidth * 100f)
                                    cs.newLineAtOffset(x, y)
                                    cs.showText(word)
                                    cs.endText()
                                    wordsFound++
                                }
                            }
                        }
                    }
                    bitmap.recycle()
                }

                out.save(File(clean(destPath)))
                out.close()
                recognizer.close()

                promise.resolve(
                    Arguments.createMap().apply {
                        putString("path", destPath)
                        putInt("words", wordsFound)
                        putInt("pages", renderer.pageCount)
                    }
                )
            } catch (e: SecurityException) {
                promise.reject("E_ENCRYPTED", "This file is password protected.", e)
            } catch (e: OutOfMemoryError) {
                promise.reject("E_MEMORY", "This scan is too large to process at this quality.")
            } catch (e: Exception) {
                promise.reject("E_IO", e.message, e)
            } finally {
                try { renderer?.close() } catch (_: Exception) {}
                try { fd?.close() } catch (_: Exception) {}
            }
        }.start()
    }

    /** Plain text only, no PDF written. */
    @ReactMethod
    fun readText(srcPath: String, dpi: Int, promise: Promise) {
        Thread {
            var fd: ParcelFileDescriptor? = null
            var renderer: PdfRenderer? = null
            try {
                val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
                fd = ParcelFileDescriptor.open(
                    File(clean(srcPath)),
                    ParcelFileDescriptor.MODE_READ_ONLY
                )
                renderer = PdfRenderer(fd)
                val builder = StringBuilder()

                for (i in 0 until renderer.pageCount) {
                    val page = renderer.openPage(i)
                    val scale = dpi / 72f
                    val bitmap = Bitmap.createBitmap(
                        (page.width * scale).toInt().coerceAtLeast(1),
                        (page.height * scale).toInt().coerceAtLeast(1),
                        Bitmap.Config.ARGB_8888
                    )
                    bitmap.eraseColor(Color.WHITE)
                    page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_PRINT)
                    page.close()

                    builder.append(Tasks.await(recognizer.process(InputImage.fromBitmap(bitmap, 0))).text)
                    builder.append("\n\n")
                    bitmap.recycle()
                }

                recognizer.close()
                promise.resolve(builder.toString().trim())
            } catch (e: Exception) {
                promise.reject("E_IO", e.message, e)
            } finally {
                try { renderer?.close() } catch (_: Exception) {}
                try { fd?.close() } catch (_: Exception) {}
            }
        }.start()
    }

    /**
     * PDType1Font.HELVETICA is WinAnsi only and throws on anything outside it.
     * The visible layer is the image, so dropping stray glyphs from the hidden
     * layer costs nothing but a few unsearchable words.
     */
    private fun sanitize(input: String): String =
        input.filter { it.code in 32..126 || it.code in 160..255 }
}
