package com.mps.allinone.pdf

import android.graphics.Bitmap
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.cos.COSBase
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.graphics.image.PDImageXObject
import com.tom_roush.pdfbox.text.PDFTextStripper
import java.io.File
import java.io.FileOutputStream
import java.util.Collections
import java.util.IdentityHashMap

class PdfExtractModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    init {
        PDFBoxResourceLoader.init(reactContext.applicationContext)
    }

    override fun getName() = "PdfExtract"

    private fun clean(path: String) = path.removePrefix("file://")

    /** Writes the text layer to destPath. Scans have no text layer — use OCR for those. */
    @ReactMethod
    fun extractText(srcPath: String, destPath: String, promise: Promise) {
        try {
            PDDocument.load(File(clean(srcPath))).use { doc ->
                val text = PDFTextStripper().apply {
                    sortByPosition = true
                }.getText(doc)

                File(clean(destPath)).writeText(text)

                promise.resolve(
                    Arguments.createMap().apply {
                        putString("path", destPath)
                        putInt("characters", text.trim().length)
                    }
                )
            }
        } catch (e: Exception) {
            promise.reject("E_IO", e.message, e)
        }
    }

    /** Saves every embedded image into destDir and returns the written paths. */
    @ReactMethod
    fun extractImages(srcPath: String, destDir: String, promise: Promise) {
        try {
            val dir = File(clean(destDir)).apply { mkdirs() }
            val stem = File(clean(srcPath)).nameWithoutExtension
            val out: WritableArray = Arguments.createArray()
            var index = 0

            PDDocument.load(File(clean(srcPath))).use { doc ->
                // Keyed on the image stream itself: the PDImageXObject wrapper can be a new
                // object on every page, so an image shown on each page was saved each time.
                val seen = Collections.newSetFromMap(IdentityHashMap<COSBase, Boolean>())
                for ((pageNo, page) in doc.pages.withIndex()) {
                    val resources = page.resources ?: continue
                    for (name in resources.xObjectNames.toList()) {
                        val xObject = try {
                            resources.getXObject(name)
                        } catch (e: Exception) {
                            null
                        } ?: continue

                        if (xObject !is PDImageXObject) continue
                        if (!seen.add(xObject.cosObject)) continue

                        val bitmap: Bitmap = try {
                            xObject.image
                        } catch (e: Exception) {
                            continue
                        } ?: continue

                        if (bitmap.isRecycled) continue

                        index++
                        val file = File(dir, "$stem-p${pageNo + 1}-$index.png")
                        FileOutputStream(file).use {
                            bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
                        }
                        if (!bitmap.isRecycled) bitmap.recycle()
                        out.pushString("file://${file.absolutePath}")
                    }
                }
            }
            promise.resolve(out)
        } catch (e: OutOfMemoryError) {
            promise.reject("E_MEMORY", "An image in this file is too large to extract.")
        } catch (e: Exception) {
            promise.reject("E_IO", e.message, e)
        }
    }
}
