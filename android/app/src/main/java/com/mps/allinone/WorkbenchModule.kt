package com.mps.allinone

import android.content.ContentValues
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import java.io.File

/**
 * Shared file plumbing for every tool that works on real files rather than base64:
 * the PDF engines, image tools and the audio/video engine.
 *
 *  - stage():   copies a picked content:// uri into the app cache so path-based
 *               engines (PDFBox, PdfRenderer) can open it.
 *  - tempFile(): a fresh path in the cache for an engine to write to.
 *  - publish(): moves a finished file from the cache into the public Downloads
 *               folder (or Ringtones) and describes it the same way FileBridge does,
 *               so the result screen, history and share all work unchanged.
 */
class WorkbenchModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {

    override fun getName() = "Workbench"

    private val workDir: File
        get() = File(ctx.cacheDir, "work").apply { mkdirs() }

    /**
     * "dark" or "light": the home-screen icon to show. Called by JS as the app goes
     * to the background, and only switches when the other one is showing.
     */
    @ReactMethod
    fun setLauncherIcon(which: String) {
        try {
            LauncherIcon.set(ctx, which != "light")
        } catch (_: Exception) {
            // Some launchers or work profiles refuse component changes; the icon simply stays.
        }
    }

    // ------------------------------------------------------------------ input

    @ReactMethod
    fun stage(uriString: String, promise: Promise) {
        try {
            promise.resolve(stageUri(ctx, uriString).absolutePath)
        } catch (e: Exception) {
            promise.reject("stage_failed", e.message ?: "Could not read that file.", e)
        }
    }

    @ReactMethod
    fun tempFile(name: String, promise: Promise) {
        val dir = File(workDir, "out-${System.nanoTime()}").apply { mkdirs() }
        promise.resolve(File(dir, safeName(name)).absolutePath)
    }

    @ReactMethod
    fun tempDir(promise: Promise) {
        promise.resolve(File(workDir, "dir-${System.nanoTime()}").apply { mkdirs() }.absolutePath)
    }

    /** Writes base64 bytes to a path (used by the JS PDF engine for multi-file output). */
    @ReactMethod
    fun writeBase64(base64: String, path: String, promise: Promise) {
        try {
            val f = File(path.removePrefix("file://")).apply { parentFile?.mkdirs() }
            f.writeBytes(android.util.Base64.decode(base64, android.util.Base64.NO_WRAP))
            promise.resolve(f.absolutePath)
        } catch (e: Exception) {
            promise.reject("write_failed", e.message, e)
        }
    }

    /** Name, size, type and — when it is media or an image — its dimensions and length. */
    @ReactMethod
    fun info(uriString: String, promise: Promise) {
        try {
            val uri = Uri.parse(uriString)
            val map = Arguments.createMap()
            var name = uri.lastPathSegment ?: "file"
            var size = -1L
            if (uri.scheme == "content") {
                ctx.contentResolver.query(uri, null, null, null, null)?.use { c ->
                    if (c.moveToFirst()) {
                        val n = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                        val s = c.getColumnIndex(OpenableColumns.SIZE)
                        if (n >= 0) name = c.getString(n) ?: name
                        if (s >= 0 && !c.isNull(s)) size = c.getLong(s)
                    }
                }
            } else {
                val f = File(uriString.removePrefix("file://"))
                name = f.name
                size = f.length()
                map.putDouble("modified", f.lastModified().toDouble())
            }
            val mime = ctx.contentResolver.getType(uri) ?: mimeFor(name)
            map.putString("name", name)
            map.putDouble("size", size.toDouble())
            map.putString("mime", mime)
            map.putString("extension", name.substringAfterLast('.', "").uppercase())

            if (mime.startsWith("image/")) {
                val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                ctx.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, o) }
                if (o.outWidth > 0) {
                    map.putInt("width", o.outWidth)
                    map.putInt("height", o.outHeight)
                }
            } else if (mime.startsWith("video/") || mime.startsWith("audio/")) {
                val r = MediaMetadataRetriever()
                try {
                    r.setDataSource(ctx, uri)
                    r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
                        ?.let { map.putDouble("durationMs", it.toDouble()) }
                    r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull()
                        ?.let { map.putInt("width", it) }
                    r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull()
                        ?.let { map.putInt("height", it) }
                    r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_BITRATE)?.toIntOrNull()
                        ?.let { map.putInt("bitrate", it) }
                } catch (_: Exception) {
                } finally {
                    try { r.release() } catch (_: Exception) {}
                }
            }
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("info_failed", e.message, e)
        }
    }

    // ----------------------------------------------------------------- output

    /** kind: "download" (default) or "ringtone". folder: optional sub folder in Downloads. */
    @ReactMethod
    fun publish(path: String, displayName: String, kind: String, folder: String, promise: Promise) {
        try {
            val file = File(path.removePrefix("file://"))
            if (!file.exists() || file.length() == 0L) throw IllegalStateException("Nothing was written.")
            promise.resolve(publishFile(file, safeName(displayName.ifBlank { file.name }), kind, folder))
        } catch (e: Exception) {
            promise.reject("save_failed", e.message ?: "Could not save the file.", e)
        }
    }

    /** Publishes every file in a directory, in name order, into Downloads/folder. */
    @ReactMethod
    fun publishDir(dirPath: String, folder: String, promise: Promise) {
        try {
            val dir = File(dirPath.removePrefix("file://"))
            val files = dir.listFiles()?.filter { it.isFile && it.length() > 0 }
                ?.sortedWith(compareBy({ it.name.length }, { it.name })) ?: emptyList()
            if (files.isEmpty()) throw IllegalStateException("Nothing was written.")
            val list = Arguments.createArray()
            files.forEach { list.pushMap(publishFile(it, it.name, "download", folder)) }
            promise.resolve(list)
        } catch (e: Exception) {
            promise.reject("save_failed", e.message ?: "Could not save the files.", e)
        }
    }

    @ReactMethod
    fun fileSize(path: String, promise: Promise) {
        promise.resolve(File(path.removePrefix("file://")).length().toDouble())
    }

    @ReactMethod
    fun cacheSize(promise: Promise) {
        promise.resolve(ctx.cacheDir.walkBottomUp().filter { it.isFile }.sumOf { it.length() }.toDouble())
    }

    @ReactMethod
    fun clearCache(promise: Promise) {
        val before = ctx.cacheDir.walkBottomUp().filter { it.isFile }.sumOf { it.length() }
        ctx.cacheDir.listFiles()?.forEach { it.deleteRecursively() }
        promise.resolve(before.toDouble())
    }

    private fun publishFile(file: File, name: String, kind: String, folder: String): WritableMap {
        val mime = mimeFor(name)
        val ringtone = kind == "ringtone"
        val uri: Uri
        val shown: String

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val resolver = ctx.contentResolver
            val values = ContentValues()
            val collection: Uri
            val relPath: String
            if (ringtone) {
                relPath = Environment.DIRECTORY_RINGTONES + "/"
                collection = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
                values.put(MediaStore.Audio.Media.DISPLAY_NAME, name)
                values.put(MediaStore.Audio.Media.MIME_TYPE, mime)
                values.put(MediaStore.Audio.Media.RELATIVE_PATH, relPath)
                values.put(MediaStore.Audio.Media.IS_RINGTONE, 1)
                values.put(MediaStore.Audio.Media.IS_MUSIC, 0)
                values.put(MediaStore.Audio.Media.IS_PENDING, 1)
            } else {
                relPath = listOf(Environment.DIRECTORY_DOWNLOADS, folder)
                    .filter { it.isNotBlank() }.joinToString("/") + "/"
                collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI
                values.put(MediaStore.Downloads.DISPLAY_NAME, name)
                values.put(MediaStore.Downloads.MIME_TYPE, mime)
                values.put(MediaStore.Downloads.RELATIVE_PATH, relPath)
                values.put(MediaStore.Downloads.IS_PENDING, 1)
            }
            uri = resolver.insert(collection, values)
                ?: throw IllegalStateException("The storage folder is not writable.")
            resolver.openOutputStream(uri)?.use { out -> file.inputStream().use { it.copyTo(out) } }
            values.clear()
            values.put(MediaStore.MediaColumns.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
            // The display name can be changed by the provider when it already exists.
            var finalName = name
            resolver.query(uri, arrayOf(MediaStore.MediaColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) finalName = c.getString(0) ?: name
            }
            shown = relPath + finalName
            file.delete()
            return describe(uri, shown, finalName, mime, file)
        } else {
            val base = Environment.getExternalStoragePublicDirectory(
                if (ringtone) Environment.DIRECTORY_RINGTONES else Environment.DIRECTORY_DOWNLOADS,
            )
            val dir = if (!ringtone && folder.isNotBlank()) File(base, folder) else base
            dir.mkdirs()
            var out = File(dir, name)
            var n = 1
            while (out.exists()) {
                out = File(dir, "${name.substringBeforeLast('.')} ($n).${name.substringAfterLast('.', "")}".trimEnd('.'))
                n++
            }
            file.copyTo(out)
            file.delete()
            // Old Android only lists a new ringtone or download after a media scan.
            android.media.MediaScannerConnection.scanFile(ctx, arrayOf(out.absolutePath), arrayOf(mime), null)
            uri = FileProvider.getUriForFile(ctx, ctx.packageName + ".provider", out)
            shown = out.absolutePath
            return describe(uri, shown, out.name, mime, out)
        }
    }

    private fun describe(uri: Uri, path: String, name: String, mime: String, sized: File): WritableMap =
        Arguments.createMap().apply {
            putString("uri", uri.toString())
            putString("path", path)
            putString("name", name)
            putString("mime", mime)
            var bytes = sized.length()
            if (bytes <= 0) {
                try {
                    ctx.contentResolver.openFileDescriptor(uri, "r")?.use { bytes = it.statSize }
                } catch (_: Exception) {}
            }
            putDouble("size", bytes.toDouble())
        }

    companion object {
        /** Copies a content:// uri into the cache and returns the copy. Plain paths pass through. */
        fun stageUri(ctx: ReactApplicationContext, uriString: String): File {
            if (uriString.startsWith("/") || uriString.startsWith("file://")) {
                val f = File(Uri.decode(uriString.removePrefix("file://")))
                if (f.exists()) return f
            }
            val uri = Uri.parse(uriString)
            var name = "input"
            ctx.contentResolver.query(uri, null, null, null, null)?.use { c ->
                val n = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (c.moveToFirst() && n >= 0) name = c.getString(n) ?: name
            }
            val dir = File(File(ctx.cacheDir, "work"), "in-${System.nanoTime()}").apply { mkdirs() }
            val out = File(dir, safeName(name))
            ctx.contentResolver.openInputStream(uri)?.use { input ->
                out.outputStream().use { input.copyTo(it) }
            } ?: throw IllegalStateException("Could not open that file.")
            return out
        }

        fun safeName(name: String): String {
            val cleaned = buildString {
                for (ch in name) {
                    when {
                        ch == '\\' || ch == '/' || ch == ':' || ch == '*' || ch == '?' ||
                            ch == '"' || ch == '<' || ch == '>' || ch == '|' -> append('_')
                        ch.code < 0x20 || ch.code == 0x7F -> Unit
                        else -> append(ch)
                    }
                }
            }.trim().trimStart('.').trim()
            return cleaned.ifBlank { "file" }
        }

        fun mimeFor(name: String): String {
            val ext = name.substringAfterLast('.', "").lowercase()
            return when (ext) {
                "mp3" -> "audio/mpeg"
                "m4a" -> "audio/mp4"
                "aac" -> "audio/aac"
                // MediaStore's own type for .wav. With "audio/wav" it did not treat .wav
                // as the extension, and a name clash came out as "song.wav (1)".
                "wav" -> "audio/x-wav"
                "mp4" -> "video/mp4"
                "webp" -> "image/webp"
                else -> MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
            }
        }
    }
}
