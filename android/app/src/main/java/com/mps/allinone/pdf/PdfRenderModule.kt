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
import com.facebook.react.bridge.WritableArray
import java.io.File
import java.io.FileOutputStream

class PdfRenderModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "PdfRender"

    private fun clean(path: String) = path.removePrefix("file://")

    private fun openRenderer(path: String): Pair<ParcelFileDescriptor, PdfRenderer> {
        val fd = ParcelFileDescriptor.open(
            File(clean(path)),
            ParcelFileDescriptor.MODE_READ_ONLY
        )
        return fd to PdfRenderer(fd)
    }

    @ReactMethod
    fun pageCount(srcPath: String, promise: Promise) {
        try {
            val (fd, renderer) = openRenderer(srcPath)
            val count = renderer.pageCount
            renderer.close()
            fd.close()
            promise.resolve(count)
        } catch (e: SecurityException) {
            promise.reject("E_ENCRYPTED", "This file is password protected.", e)
        } catch (e: Exception) {
            promise.reject("E_IO", e.message, e)
        }
    }

    /**
     * Renders one page to a PNG in the cache folder and returns its path.
     * targetWidth is in pixels; height follows the page aspect ratio.
     */
    @ReactMethod
    fun renderPage(srcPath: String, pageIndex: Int, targetWidth: Int, promise: Promise) {
        try {
            val (fd, renderer) = openRenderer(srcPath)
            if (pageIndex < 0 || pageIndex >= renderer.pageCount) {
                renderer.close(); fd.close()
                promise.reject("E_RANGE", "No page $pageIndex in this file.")
                return
            }

            val page = renderer.openPage(pageIndex)
            val scale = targetWidth.toFloat() / page.width
            val height = (page.height * scale).toInt().coerceAtLeast(1)

            val bitmap = Bitmap.createBitmap(targetWidth, height, Bitmap.Config.ARGB_8888)
            bitmap.eraseColor(Color.WHITE) // pages are transparent by default
            page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
            page.close()
            renderer.close()
            fd.close()

            val outFile = File(
                reactContext.cacheDir,
                "page-${File(clean(srcPath)).nameWithoutExtension}-$pageIndex-$targetWidth.png"
            )
            FileOutputStream(outFile).use { bitmap.compress(Bitmap.CompressFormat.PNG, 90, it) }
            bitmap.recycle()

            promise.resolve("file://${outFile.absolutePath}")
        } catch (e: SecurityException) {
            promise.reject("E_ENCRYPTED", "This file is password protected.", e)
        } catch (e: Exception) {
            promise.reject("E_IO", e.message, e)
        }
    }

    /**
     * Exports pages as images into destDir at the given DPI.
     * format is "png" or "jpg". Returns the written paths in page order.
     */
    @ReactMethod
    fun exportPages(
        srcPath: String,
        destDir: String,
        dpi: Int,
        format: String,
        promise: Promise
    ) {
        try {
            val dir = File(clean(destDir)).apply { mkdirs() }
            val (fd, renderer) = openRenderer(srcPath)
            val out: WritableArray = Arguments.createArray()
            val isPng = format.lowercase() == "png"
            val stem = File(clean(srcPath)).nameWithoutExtension

            for (i in 0 until renderer.pageCount) {
                val page = renderer.openPage(i)
                // PdfRenderer page units are points at 72dpi.
                val scale = dpi / 72f
                val w = (page.width * scale).toInt().coerceAtLeast(1)
                val h = (page.height * scale).toInt().coerceAtLeast(1)

                val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                bitmap.eraseColor(Color.WHITE)
                page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_PRINT)
                page.close()

                val file = File(dir, "$stem-${i + 1}.${if (isPng) "png" else "jpg"}")
                FileOutputStream(file).use {
                    bitmap.compress(
                        if (isPng) Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG,
                        if (isPng) 90 else 85,
                        it
                    )
                }
                bitmap.recycle()
                out.pushString("file://${file.absolutePath}")
            }

            renderer.close()
            fd.close()
            promise.resolve(out)
        } catch (e: SecurityException) {
            promise.reject("E_ENCRYPTED", "This file is password protected.", e)
        } catch (e: OutOfMemoryError) {
            promise.reject("E_MEMORY", "That page is too large to render at this quality.")
        } catch (e: Exception) {
            promise.reject("E_IO", e.message, e)
        }
    }
}
