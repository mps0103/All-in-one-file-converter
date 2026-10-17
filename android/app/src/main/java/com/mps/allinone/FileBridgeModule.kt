package com.mps.allinone

import android.app.Activity
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import android.util.Base64
import androidx.core.content.FileProvider
import com.facebook.react.bridge.*
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.encryption.InvalidPasswordException
import com.tom_roush.pdfbox.text.PDFTextStripper
import java.io.File
import java.io.FileOutputStream
import java.util.zip.ZipInputStream

/**
 * Every byte stays on the device. Nothing here opens a socket.
 */
class FileBridgeModule(private val ctx: ReactApplicationContext) :
    ReactContextBaseJavaModule(ctx), ActivityEventListener {

    private var pickPromise: Promise? = null

    // Whether the pick in flight was started by pickFiles, which answers with an
    // array, rather than pickFile, which answers with one file.
    private var pickMultiple = false

    init {
        ctx.addActivityEventListener(this)
        PDFBoxResourceLoader.init(ctx.applicationContext)
    }

    override fun getName() = "FileBridge"

    /**
     * debugBuild says whether this is a debug build of the app, which is not the
     * same question as React Native's __DEV__.
     *
     * __DEV__ means "the JavaScript came from Metro". A debug APK built to run on
     * its own carries a production JS bundle, so __DEV__ is false in it and the
     * developer settings vanished from exactly the build meant for testing. This
     * comes from BuildConfig instead, which is false in anything Play could ship.
     */
    override fun getConstants(): Map<String, Any> = mapOf("debugBuild" to BuildConfig.DEBUG)

    // ---------------------------------------------------------------- picking

    @ReactMethod
    fun pickFile(mimeTypes: ReadableArray, promise: Promise) = startPick(mimeTypes, false, promise)

    /** Same picker, but the user may choose several files. Resolves to an array. */
    @ReactMethod
    fun pickFiles(mimeTypes: ReadableArray, promise: Promise) = startPick(mimeTypes, true, promise)

    private fun startPick(mimeTypes: ReadableArray, multiple: Boolean, promise: Promise) {
        val activity = reactApplicationContext.currentActivity ?: return promise.reject("no_activity", "App is not in the foreground.")
        pickPromise = promise
        pickMultiple = multiple
        val types = Array(mimeTypes.size()) { mimeTypes.getString(it) }
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = if (types.size == 1) types[0] else "*/*"
            if (types.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, types)
            if (multiple) putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION,
            )
        }
        try {
            activity.startActivityForResult(intent, PICK_REQUEST)
        } catch (e: Exception) {
            pickPromise = null
            promise.reject("no_picker", "No file manager available on this device.")
        }
    }

    override fun onActivityResult(a: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != PICK_REQUEST) return
        val promise = pickPromise ?: return
        val multiple = pickMultiple
        pickPromise = null
        pickMultiple = false

        // A multiple pick puts the files in clipData; choosing exactly one still
        // arrives in data, so both have to be read whichever button was pressed.
        val uris = mutableListOf<Uri>()
        data?.clipData?.let { clip -> for (i in 0 until clip.itemCount) uris += clip.getItemAt(i).uri }
        if (uris.isEmpty()) data?.data?.let { uris += it }

        if (resultCode != Activity.RESULT_OK || uris.isEmpty()) {
            promise.reject("cancelled", "No file chosen.")
            return
        }

        // Without this the grant dies with the process and Recent files would list
        // documents it can no longer open. The system caps how many a single app may
        // hold, so a failure here is not worth failing the pick over.
        uris.forEach { uri ->
            try {
                ctx.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            } catch (e: Exception) {
                // Not every provider offers a persistable grant; the file still opens now.
            }
        }

        if (multiple) {
            val list = Arguments.createArray()
            uris.forEach { list.pushMap(describe(it)) }
            promise.resolve(list)
        } else {
            promise.resolve(describe(uris.first()))
        }
    }

    override fun onNewIntent(intent: Intent) = Unit

    /**
     * Name, size and type for a uri the app did not pick itself — the one handed over
     * by an "Open with" intent. Read permission rides on the intent that delivered it.
     */
    /**
     * Copies a handed-over file into the app's own storage and describes the copy.
     *
     * An "Open with" uri is borrowed, not given. The sending app grants read
     * permission for the one intent that carried it, and some apps go further:
     * WhatsApp mints a brand new single-use uri every time a file is shared, so even
     * the same file arrives under a different address each time. Once the grant
     * lapses the address is dead, and Recent files — which stored it — could only
     * answer with a permission denial, which is what it did.
     *
     * So the bytes are taken while they can be. Everything downstream then works
     * from a file this app owns, and reopening it a week later is nobody else's
     * decision.
     *
     * A file too large to be worth duplicating is described where it lies. It opens
     * now, and if it is gone from Recent files later, that is the better trade
     * against filling the phone.
     */
    @ReactMethod
    fun keepIncoming(uriString: String, promise: Promise) {
        try {
            val uri = Uri.parse(uriString)
            val described = describe(uri)
            val size = described.getDouble("size").toLong()

            if (size > MAX_KEPT_BYTES) return promise.resolve(described)

            val dir = File(ctx.filesDir, "incoming").apply { mkdirs() }
            prune(dir)

            val name = described.getString("name") ?: "file"
            // A folder per copy keeps the file under its own name. A timestamp prefix on
            // the name itself leaked into outputs: tools that name results after the
            // input path saved "1792017711183_report-p1-1.png".
            val slot = File(dir, System.currentTimeMillis().toString()).apply { mkdirs() }
            val copy = File(slot, WorkbenchModule.safeName(name.takeLast(80)))
            ctx.contentResolver.openInputStream(uri).use { input ->
                FileOutputStream(copy).use { out ->
                    input?.copyTo(out, DEFAULT_BUFFER_SIZE)
                        ?: throw IllegalStateException("That file could not be read.")
                }
            }

            promise.resolve(
                Arguments.createMap().apply {
                    putString("uri", Uri.fromFile(copy).toString())
                    putString("name", name)
                    putDouble("size", copy.length().toDouble())
                    putString("mime", described.getString("mime") ?: "application/octet-stream")
                },
            )
        } catch (e: Exception) {
            // Failing to copy is not failing to open. Fall back to the borrowed uri,
            // which still works for as long as the grant does.
            try {
                promise.resolve(describe(Uri.parse(uriString)))
            } catch (inner: Exception) {
                promise.reject("describe_failed", inner.message ?: "That file could not be read.")
            }
        }
    }

    /**
     * Keeps the copies from growing without end: anything older than a month goes,
     * and then the oldest go until the folder is back under its limit. Recent files
     * shows a short list, so a copy nobody can reach from it is only taking up room.
     */
    private fun prune(dir: File) {
        // Entries are per-copy folders, or plain files left by older versions.
        fun bytes(f: File) = f.walkBottomUp().filter { it.isFile }.sumOf { it.length() }
        val entries = dir.listFiles()?.sortedBy { it.lastModified() } ?: return
        val cutoff = System.currentTimeMillis() - KEEP_FOR_MS
        var total = entries.sumOf { bytes(it) }
        for (entry in entries) {
            if (total <= MAX_FOLDER_BYTES && entry.lastModified() >= cutoff) break
            total -= bytes(entry)
            entry.deleteRecursively()
        }
    }

    @ReactMethod
    fun describeUri(uriString: String, promise: Promise) {
        try {
            promise.resolve(describe(Uri.parse(uriString)))
        } catch (e: Exception) {
            promise.reject("describe_failed", e.message ?: "That file could not be read.")
        }
    }

    private fun describe(uri: Uri): WritableMap {
        val map = Arguments.createMap()
        var name = uri.lastPathSegment ?: "file"
        var size = 0.0
        ctx.contentResolver.query(uri, null, null, null, null)?.use { c ->
            if (c.moveToFirst()) {
                val n = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                val s = c.getColumnIndex(OpenableColumns.SIZE)
                if (n >= 0) name = c.getString(n)
                if (s >= 0 && !c.isNull(s)) size = c.getLong(s).toDouble()
            }
        }
        map.putString("uri", uri.toString())
        map.putString("name", name)
        map.putDouble("size", size)
        map.putString("mime", ctx.contentResolver.getType(uri) ?: "application/octet-stream")
        return map
    }

    // ----------------------------------------------------------- pdf preview

    /**
     * Page images for the viewer, drawn by the framework's own PdfRenderer so the
     * app carries no extra rendering library. The document is copied to the cache
     * first because PdfRenderer needs a seekable file descriptor, which a content
     * uri from a cloud provider does not always give.
     *
     * Each page is written to a PNG in the cache and its file uri returned, so JS
     * holds a short path rather than the image as a base64 string, and a page that
     * scrolls away and back is read from disk instead of drawn again. The renderer
     * and its descriptor are open only for the one page.
     */
    @ReactMethod
    fun renderPdfPage(uriString: String, index: Int, targetWidth: Int, password: String, promise: Promise) {
        var descriptor: ParcelFileDescriptor? = null
        var renderer: PdfRenderer? = null
        try {
            val width = targetWidth.coerceIn(320, 2000)
            val pageFile = File(renderedPagesDir(), "${uriString.hashCode()}-$index-$width.png")
            val sizeFile = File(pageFile.path + ".size")
            if (pageFile.length() > 0 && sizeFile.exists()) {
                val (w, h) = sizeFile.readText().split("x").map { it.toInt() }
                promise.resolve(renderedPage(pageFile, w, h))
                return
            }
            val cached = cachePdf(Uri.parse(uriString), password)
            descriptor = ParcelFileDescriptor.open(cached, ParcelFileDescriptor.MODE_READ_ONLY)
            renderer = PdfRenderer(descriptor)
            if (index < 0 || index >= renderer.pageCount) {
                promise.reject("bad_page", "That page is not in this document.")
                return
            }
            renderer.openPage(index).use { page ->
                val height = (width.toFloat() * page.height / page.width).toInt().coerceAtLeast(1)
                val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
                try {
                    // A page is transparent wherever nothing is drawn, so it needs a white
                    // ground or the text lands on whatever is behind the image.
                    bitmap.eraseColor(Color.WHITE)
                    page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                    FileOutputStream(pageFile).use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
                } finally {
                    bitmap.recycle()
                }
                sizeFile.writeText("${width}x$height")
                promise.resolve(renderedPage(pageFile, width, height))
            }
        } catch (e: PasswordRequired) {
            promise.reject("password", e.message)
        } catch (e: Exception) {
            promise.reject("render_failed", e.message ?: "This PDF could not be drawn.")
        } finally {
            try { renderer?.close() } catch (_: Exception) {}
            try { descriptor?.close() } catch (_: Exception) {}
        }
    }

    @ReactMethod
    fun pdfPageCount(uriString: String, password: String, promise: Promise) {
        var descriptor: ParcelFileDescriptor? = null
        var renderer: PdfRenderer? = null
        try {
            val cached = cachePdf(Uri.parse(uriString), password)
            descriptor = ParcelFileDescriptor.open(cached, ParcelFileDescriptor.MODE_READ_ONLY)
            renderer = PdfRenderer(descriptor)
            promise.resolve(renderer.pageCount)
        } catch (e: PasswordRequired) {
            promise.reject("password", e.message)
        } catch (e: Exception) {
            promise.reject("render_failed", e.message ?: "This PDF could not be opened.")
        } finally {
            try { renderer?.close() } catch (_: Exception) {}
            try { descriptor?.close() } catch (_: Exception) {}
        }
    }

    /**
     * Drops the viewer's page images. Called when the viewer closes: a page is cheap
     * to draw again and there is no reason to keep them on the phone.
     */
    @ReactMethod
    fun clearRenderedPages(promise: Promise) {
        renderedPagesDir().deleteRecursively()
        promise.resolve(null)
    }

    private fun renderedPagesDir() = File(ctx.cacheDir, "viewer-pages").apply { mkdirs() }

    private fun renderedPage(file: File, width: Int, height: Int): WritableMap = Arguments.createMap().apply {
        putString("uri", "file://${file.absolutePath}")
        putInt("width", width)
        putInt("height", height)
    }

    /** Signals "this document is locked" so JS can put a password box on screen. */
    private class PasswordRequired(message: String) : Exception(message)

    /** True when PdfRenderer can open the file unaided, i.e. it is not encrypted. */
    private fun opensWithRenderer(file: File): Boolean {
        var descriptor: ParcelFileDescriptor? = null
        var renderer: PdfRenderer? = null
        return try {
            descriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
            renderer = PdfRenderer(descriptor)
            true
        } catch (e: Exception) {
            false
        } finally {
            try { renderer?.close() } catch (_: Exception) {}
            try { descriptor?.close() } catch (_: Exception) {}
        }
    }

    /**
     * One cache copy per uri, reused across page renders so scrolling is not I/O
     * bound.
     *
     * PdfRenderer cannot open an encrypted document at all — there is no API to give
     * it a password — so a locked PDF is opened with PDFBox instead, which is already
     * in the APK for text extraction, stripped of its encryption, and written to the
     * cache. It is that decrypted copy PdfRenderer draws. The copy lives in cacheDir,
     * which is private to the app and cleared by Android under storage pressure.
     */
    private fun cachePdf(uri: Uri, password: String): File {
        val target = File(ctx.cacheDir, "preview-" + uri.toString().hashCode() + ".pdf")
        if (target.exists() && target.length() > 0) return target

        val raw = File(ctx.cacheDir, "raw-" + uri.toString().hashCode() + ".pdf")
        try {
            ctx.contentResolver.openInputStream(uri).use { input ->
                input ?: throw IllegalStateException("That file could not be opened.")
                FileOutputStream(raw).use { output -> input.copyTo(output, DEFAULT_BUFFER_SIZE) }
            }

            // The common case is an ordinary PDF, so try the cheap path first: if
            // PdfRenderer opens the file itself there is nothing to decrypt and the
            // copy can be used as it is. PDFBox is only loaded for a locked document,
            // where it is the sole way through.
            if (opensWithRenderer(raw)) {
                raw.copyTo(target, overwrite = true)
                return target
            }

            val document = try {
                PDDocument.load(raw, password)
            } catch (e: InvalidPasswordException) {
                throw PasswordRequired(
                    if (password.isEmpty()) "This PDF is locked. Enter its password to open it."
                    else "That password did not open this PDF.",
                )
            }

            document.use { doc ->
                doc.isAllSecurityToBeRemoved = true
                doc.save(target)
            }
            return target
        } catch (e: Exception) {
            target.delete()
            throw e
        } finally {
            raw.delete()
        }
    }

    // ------------------------------------------------------------ read / save

    @ReactMethod
    fun readBase64(uriString: String, promise: Promise) {
        try {
            ctx.contentResolver.openInputStream(Uri.parse(uriString)).use { input ->
                val bytes = input?.readBytes() ?: throw IllegalStateException("File could not be opened.")
                promise.resolve(Base64.encodeToString(bytes, Base64.NO_WRAP))
            }
        } catch (e: Exception) {
            promise.reject("read_failed", e.message, e)
        }
    }

    /** Writes into the public Downloads folder. Returns the content uri and a readable path. */
    @ReactMethod
    fun saveToDownloads(base64: String, fileName: String, mime: String, promise: Promise) {
        try {
            val bytes = Base64.decode(base64, Base64.NO_WRAP)
            val uri: Uri
            val shownPath: String
            var savedName = fileName
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, fileName)
                    put(MediaStore.Downloads.MIME_TYPE, mime)
                    put(MediaStore.Downloads.IS_PENDING, 1)
                }
                val resolver = ctx.contentResolver
                uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                    ?: throw IllegalStateException("Downloads folder is not writable.")
                resolver.openOutputStream(uri)?.use { it.write(bytes) }
                values.clear()
                values.put(MediaStore.Downloads.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
                // MediaStore renames to "name (1).ext" when the name is taken; report that.
                resolver.query(uri, arrayOf(MediaStore.MediaColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                    if (c.moveToFirst()) savedName = c.getString(0) ?: fileName
                }
                shownPath = "Downloads/$savedName"
            } else {
                val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                if (!dir.exists()) dir.mkdirs()
                // Never overwrite an earlier file of the same name, as Android 10+ never does.
                var out = File(dir, fileName)
                var n = 1
                while (out.exists()) {
                    out = File(dir, "${fileName.substringBeforeLast('.')} ($n).${fileName.substringAfterLast('.', "")}".trimEnd('.'))
                    n++
                }
                FileOutputStream(out).use { it.write(bytes) }
                android.media.MediaScannerConnection.scanFile(ctx, arrayOf(out.absolutePath), arrayOf(mime), null)
                uri = FileProvider.getUriForFile(ctx, ctx.packageName + ".provider", out)
                shownPath = out.absolutePath
                savedName = out.name
            }
            val map = Arguments.createMap()
            map.putString("uri", uri.toString())
            map.putString("path", shownPath)
            map.putString("name", savedName)
            map.putString("mime", mime)
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("save_failed", e.message, e)
        }
    }

    // ------------------------------------------------------------------- pdf

    /** Text layer of a PDF, one entry per page. Empty strings mean a scanned page. */
    @ReactMethod
    fun extractPdfText(uriString: String, password: String, promise: Promise) {
        try {
            ctx.contentResolver.openInputStream(Uri.parse(uriString)).use { input ->
                PDDocument.load(input, password).use { doc ->
                    val stripper = PDFTextStripper()
                    stripper.sortByPosition = true
                    val pages = Arguments.createArray()
                    var withText = 0
                    for (i in 1..doc.numberOfPages) {
                        stripper.startPage = i
                        stripper.endPage = i
                        val text = stripper.getText(doc).trim()
                        if (text.isNotEmpty()) withText++
                        pages.pushString(text)
                    }
                    val map = Arguments.createMap()
                    map.putInt("pageCount", doc.numberOfPages)
                    map.putInt("pagesWithText", withText)
                    map.putArray("pages", pages)
                    promise.resolve(map)
                }
            }
        } catch (e: Exception) {
            promise.reject("pdf_read_failed", e.message, e)
        }
    }

    // ------------------------------------------------------------ open /share

    @ReactMethod
    fun openFile(uriString: String, mime: String, promise: Promise) {
        try {
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(Uri.parse(uriString), mime)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            ctx.startActivity(Intent.createChooser(intent, "Open with").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("open_failed", "No app on this device can open that file.", e)
        }
    }

    @ReactMethod
    fun shareFile(uriString: String, mime: String, promise: Promise) {
        try {
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = mime
                putExtra(Intent.EXTRA_STREAM, Uri.parse(uriString))
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            ctx.startActivity(Intent.createChooser(intent, "Share file").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("share_failed", e.message, e)
        }
    }

    // ------------------------------------------------------- format sniffing

    /**
     * What a file actually is, judged by its first bytes rather than its name.
     *
     * Needed because a file arriving from another app through "Open with" often
     * carries neither. A chat app may hand over a uri whose display name has no
     * extension and whose provider reports application/octet-stream for anything
     * it did not create, and the app was then left with nothing to go on.
     *
     * Returns one of: pdf, docx, xlsx, pptx, zip, 7z, rar, gz, bz2, xz, tar,
     * text, unknown.
     */
    @ReactMethod
    fun sniffFormat(uriString: String, promise: Promise) {
        try {
            val uri = Uri.parse(uriString)
            val head = ByteArray(512)
            var filled = 0
            ctx.contentResolver.openInputStream(uri)?.use { input ->
                while (filled < head.size) {
                    val n = input.read(head, filled, head.size - filled)
                    if (n <= 0) break
                    filled += n
                }
            } ?: return promise.resolve("unknown")

            promise.resolve(
                when {
                    startsWith(head, filled, 0x25, 0x50, 0x44, 0x46) -> "pdf" // %PDF
                    startsWith(head, filled, 0x50, 0x4B, 0x03, 0x04) -> insideZip(uri)
                    startsWith(head, filled, 0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C) -> "7z"
                    startsWith(head, filled, 0x52, 0x61, 0x72, 0x21) -> "rar"
                    startsWith(head, filled, 0xFD, 0x37, 0x7A, 0x58, 0x5A) -> "xz"
                    startsWith(head, filled, 0x1F, 0x8B) -> "gz"
                    startsWith(head, filled, 0x42, 0x5A, 0x68) -> "bz2"
                    // tar has no leading magic; its marker sits at offset 257.
                    filled > 262 && String(head, 257, 5, Charsets.US_ASCII) == "ustar" -> "tar"
                    looksLikeText(head, filled) -> "text"
                    else -> "unknown"
                },
            )
        } catch (e: Exception) {
            promise.resolve("unknown")
        }
    }

    private fun startsWith(buf: ByteArray, filled: Int, vararg bytes: Int): Boolean {
        if (filled < bytes.size) return false
        return bytes.withIndex().all { (i, b) -> buf[i] == b.toByte() }
    }

    /**
     * docx, xlsx and pptx are all zip files, so the container has to be opened to
     * tell them apart. Only the entry names are needed and they appear near the
     * front, so the scan stops early rather than reading a large workbook twice.
     */
    private fun insideZip(uri: Uri): String {
        try {
            ctx.contentResolver.openInputStream(uri)?.use { input ->
                ZipInputStream(input).use { zip ->
                    var seen = 0
                    while (seen < 40) {
                        val entry = zip.nextEntry ?: break
                        val name = entry.name
                        when {
                            name.startsWith("xl/") -> return "xlsx"
                            name.startsWith("word/") -> return "docx"
                            name.startsWith("ppt/") -> return "pptx"
                        }
                        seen++
                    }
                }
            }
        } catch (e: Exception) {
            // A zip that cannot be walked is still a zip.
        }
        return "zip"
    }

    /** No NUL bytes and mostly printable: good enough to offer it as text. */
    private fun looksLikeText(buf: ByteArray, filled: Int): Boolean {
        if (filled == 0) return false
        var printable = 0
        for (i in 0 until filled) {
            val b = buf[i].toInt() and 0xFF
            if (b == 0) return false
            if (b >= 0x20 || b == 0x09 || b == 0x0A || b == 0x0D) printable++
        }
        return printable * 100 / filled >= 95
    }

    companion object {
        private const val PICK_REQUEST = 7341

        /** Past this, a handed-over file is read where it lies rather than duplicated. */
        private const val MAX_KEPT_BYTES = 256L * 1024 * 1024

        /** How much the kept copies may occupy in total. */
        private const val MAX_FOLDER_BYTES = 512L * 1024 * 1024

        private const val KEEP_FOR_MS = 30L * 24 * 60 * 60 * 1000
    }
}
