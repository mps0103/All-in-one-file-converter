package com.mps.allinone

import android.content.ContentValues
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.github.junrar.Archive
import net.lingala.zip4j.ZipFile
import net.lingala.zip4j.exception.ZipException
import net.lingala.zip4j.io.outputstream.ZipOutputStream
import net.lingala.zip4j.model.ZipParameters
import net.lingala.zip4j.model.enums.AesKeyStrength
import net.lingala.zip4j.model.enums.CompressionMethod
import net.lingala.zip4j.model.enums.EncryptionMethod
import org.apache.commons.compress.archivers.sevenz.SevenZArchiveEntry
import org.apache.commons.compress.archivers.sevenz.SevenZFile
import org.apache.commons.compress.archivers.sevenz.SevenZOutputFile
import org.apache.commons.compress.archivers.tar.TarArchiveEntry
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.archivers.tar.TarArchiveOutputStream
import org.apache.commons.compress.compressors.CompressorStreamFactory
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorOutputStream
import org.apache.commons.compress.compressors.gzip.GzipCompressorOutputStream
import org.apache.commons.compress.compressors.xz.XZCompressorOutputStream
import java.io.OutputStream
import java.io.BufferedInputStream
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream

/**
 * Archive extraction. Every decoder here is a pure-JVM library bundled in the APK,
 * so extraction works with the phone offline.
 */
class ArchiveModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {

    override fun getName() = "ArchiveBridge"

    // NativeEventEmitter needs these two to exist.
    @ReactMethod fun addListener(eventName: String) = Unit
    @ReactMethod fun removeListeners(count: Int) = Unit

    private fun emit(stage: String, done: Int, total: Int) {
        val map = Arguments.createMap().apply {
            putString("stage", stage)
            putInt("done", done)
            putInt("total", total)
        }
        ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("archiveProgress", map)
    }

    /**
     * @param password only used for protected ZIP archives; pass an empty string otherwise.
     */
    @ReactMethod
    fun extract(uriString: String, password: String, promise: Promise) {
        val work = File(ctx.cacheDir, "extract_${System.currentTimeMillis()}")
        try {
            val uri = Uri.parse(uriString)
            val displayName = queryName(uri)
            val baseName = displayName.replace(Regex("\\.(tar\\.(gz|bz2|xz)|tgz|[^.]+)$", RegexOption.IGNORE_CASE), "")
                .ifBlank { "archive" }

            emit("Copying the archive", 0, 0)
            val source = File(ctx.cacheDir, "src_${System.currentTimeMillis()}_$displayName")
            ctx.contentResolver.openInputStream(uri).use { input ->
                FileOutputStream(source).use { out ->
                    input?.copyTo(out, DEFAULT_BUFFER_SIZE) ?: throw IllegalStateException("The archive could not be opened.")
                }
            }

            work.mkdirs()
            when (detect(source, displayName)) {
                Kind.ZIP -> unzip(source, work, password)
                Kind.SEVEN_Z -> unSevenZ(source, work)
                Kind.RAR -> unrar(source, work)
                Kind.TAR -> untar(source.inputStream(), work)
                Kind.COMPRESSED -> uncompress(source, work, baseName)
            }
            source.delete()

            val produced = work.walkTopDown().filter { it.isFile }.toList()
            if (produced.isEmpty()) throw IllegalStateException("The archive was empty.")

            emit("Saving to Downloads", 0, produced.size)
            val folder = sanitise(baseName)
            val out = Arguments.createArray()
            produced.forEachIndexed { index, file ->
                val relative = file.relativeTo(work).path.replace('\\', '/')
                out.pushMap(publish(file, folder, relative))
                emit("Saving to Downloads", index + 1, produced.size)
            }

            val result = Arguments.createMap()
            result.putArray("files", out)
            result.putString("folder", "Downloads/$folder")
            promise.resolve(result)
        } catch (e: ZipException) {
            promise.reject(
                if (e.message?.contains("password", true) == true) "password" else "archive_failed",
                if (e.message?.contains("password", true) == true)
                    "This ZIP is password protected. Enter the password and try again."
                else e.message,
                e,
            )
        } catch (e: Exception) {
            promise.reject("archive_failed", e.message ?: "That archive could not be opened.", e)
        } finally {
            work.deleteRecursively()
        }
    }

    /**
     * Entry names and sizes only, for the viewer. Nothing is written to the
     * Downloads folder: the archive is copied to the cache, its table of contents
     * read, and the copy deleted again, so listing costs a fraction of extracting.
     *
     * A .gz, .bz2 or .xz is a single compressed stream with no table of contents at
     * all, so it reports the one file it will produce, which is what extracting it
     * actually does.
     */
    @ReactMethod
    fun listEntries(uriString: String, password: String, promise: Promise) {
        var source: File? = null
        try {
            val uri = Uri.parse(uriString)
            val displayName = queryName(uri)
            val baseName = displayName.replace(Regex("\\.(tar\\.(gz|bz2|xz)|tgz|[^.]+)$", RegexOption.IGNORE_CASE), "")
                .ifBlank { "archive" }

            val copy = File(ctx.cacheDir, "list_${System.currentTimeMillis()}_$displayName")
            ctx.contentResolver.openInputStream(uri).use { input ->
                FileOutputStream(copy).use { out ->
                    input?.copyTo(out, DEFAULT_BUFFER_SIZE)
                        ?: throw IllegalStateException("The archive could not be opened.")
                }
            }
            source = copy

            val entries = mutableListOf<Pair<String, Long>>()
            when (detect(copy, displayName)) {
                Kind.ZIP -> ZipFile(copy).use { zip ->
                    if (zip.isEncrypted && password.isNotEmpty()) zip.setPassword(password.toCharArray())
                    zip.fileHeaders.forEach { h ->
                        if (!h.isDirectory) entries.add(h.fileName to h.uncompressedSize)
                    }
                }
                Kind.SEVEN_Z -> SevenZFile(copy).use { z ->
                    var entry = z.nextEntry
                    while (entry != null) {
                        if (!entry.isDirectory) entries.add(entry.name to entry.size)
                        entry = z.nextEntry
                    }
                }
                Kind.RAR -> Archive(copy).use { archive ->
                    archive.fileHeaders.forEach { h ->
                        if (!h.isDirectory) entries.add(h.fileName to h.fullUnpackSize)
                    }
                }
                Kind.TAR -> {
                    val buffered = BufferedInputStream(copy.inputStream())
                    val stream = try {
                        CompressorStreamFactory().createCompressorInputStream(buffered)
                    } catch (e: Exception) {
                        buffered // a plain .tar
                    }
                    TarArchiveInputStream(stream).use { tar ->
                        var entry = tar.nextTarEntry
                        while (entry != null) {
                            if (!entry.isDirectory) entries.add(entry.name to entry.size)
                            entry = tar.nextTarEntry
                        }
                    }
                }
                Kind.COMPRESSED -> entries.add(sanitise(baseName) to -1L)
            }

            val out = Arguments.createArray()
            entries.forEach { (name, size) ->
                val map = Arguments.createMap()
                map.putString("name", name)
                map.putDouble("size", size.toDouble())
                out.pushMap(map)
            }
            promise.resolve(out)
        } catch (e: ZipException) {
            promise.reject(
                if (e.message?.contains("password", true) == true) "password" else "list_failed",
                e.message ?: "This archive could not be read.",
            )
        } catch (e: Exception) {
            promise.reject("list_failed", e.message ?: "This archive could not be read.")
        } finally {
            source?.delete()
        }
    }

    // ------------------------------------------------------------- detection

    private enum class Kind { ZIP, SEVEN_Z, RAR, TAR, COMPRESSED }

    private fun detect(file: File, name: String): Kind {
        val lower = name.lowercase()
        val magic = ByteArray(8)
        file.inputStream().use { it.read(magic) }

        return when {
            magic.startsWith(0x50, 0x4B) -> Kind.ZIP
            magic.startsWith(0x37, 0x7A, 0xBC, 0xAF) -> Kind.SEVEN_Z
            magic.startsWith(0x52, 0x61, 0x72, 0x21) -> Kind.RAR
            lower.endsWith(".tar") -> Kind.TAR
            lower.endsWith(".tar.gz") || lower.endsWith(".tgz") ||
                lower.endsWith(".tar.bz2") || lower.endsWith(".tbz2") ||
                lower.endsWith(".tar.xz") -> Kind.TAR
            magic.startsWith(0x1F, 0x8B) || magic.startsWith(0x42, 0x5A, 0x68) ||
                magic.startsWith(0xFD, 0x37, 0x7A, 0x58) -> Kind.COMPRESSED
            else -> throw IllegalStateException("This file is not an archive the app can open.")
        }
    }

    private fun ByteArray.startsWith(vararg bytes: Int) =
        bytes.withIndex().all { (i, b) -> size > i && this[i] == b.toByte() }

    // ------------------------------------------------------------ extractors

    private fun unzip(source: File, target: File, password: String) {
        ZipFile(source).use { zip ->
            if (zip.isEncrypted) {
                if (password.isBlank()) {
                    throw ZipException("This ZIP needs a password.")
                }
                zip.setPassword(password.toCharArray())
            }
            val headers = zip.fileHeaders
            headers.forEachIndexed { index, header ->
                emit("Extracting", index + 1, headers.size)
                zip.extractFile(header, target.absolutePath)
            }
        }
    }

    private fun unSevenZ(source: File, target: File) {
        SevenZFile(source).use { seven ->
            var entry = seven.nextEntry
            var count = 0
            while (entry != null) {
                if (!entry.isDirectory) {
                    val out = safeChild(target, entry.name)
                    out.parentFile?.mkdirs()
                    FileOutputStream(out).use { sink ->
                        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                        while (true) {
                            val read = seven.read(buffer)
                            if (read <= 0) break
                            sink.write(buffer, 0, read)
                        }
                    }
                    emit("Extracting", ++count, 0)
                }
                entry = seven.nextEntry
            }
        }
    }

    private fun unrar(source: File, target: File) {
        Archive(source).use { archive ->
            if (archive.isEncrypted) {
                throw IllegalStateException("This RAR file is encrypted and cannot be opened here.")
            }
            var count = 0
            var header = archive.nextFileHeader()
            while (header != null) {
                if (!header.isDirectory) {
                    val out = safeChild(target, header.fileName.replace('\\', '/'))
                    out.parentFile?.mkdirs()
                    FileOutputStream(out).use { sink -> archive.extractFile(header, sink) }
                    emit("Extracting", ++count, 0)
                }
                header = archive.nextFileHeader()
            }
        }
    }

    private fun untar(raw: InputStream, target: File) {
        val buffered = BufferedInputStream(raw)
        val stream = try {
            CompressorStreamFactory().createCompressorInputStream(buffered)
        } catch (e: Exception) {
            buffered // a plain .tar
        }
        TarArchiveInputStream(stream).use { tar ->
            var count = 0
            var entry = tar.nextTarEntry
            while (entry != null) {
                if (!entry.isDirectory) {
                    val out = safeChild(target, entry.name)
                    out.parentFile?.mkdirs()
                    FileOutputStream(out).use { sink -> tar.copyTo(sink, DEFAULT_BUFFER_SIZE) }
                    emit("Extracting", ++count, 0)
                }
                entry = tar.nextTarEntry
            }
        }
    }

    /** A .gz, .bz2 or .xz holding a single file rather than a tar. */
    private fun uncompress(source: File, target: File, baseName: String) {
        emit("Extracting", 1, 1)
        BufferedInputStream(source.inputStream()).use { input ->
            CompressorStreamFactory().createCompressorInputStream(input).use { stream ->
                val out = File(target, sanitise(baseName))
                FileOutputStream(out).use { sink -> stream.copyTo(sink, DEFAULT_BUFFER_SIZE) }
            }
        }
    }

    // ------------------------------------------------------------ publishing

    /** Blocks entry names that try to escape the extraction folder. */
    private fun safeChild(root: File, entryName: String): File {
        val child = File(root, entryName)
        if (!child.canonicalPath.startsWith(root.canonicalPath + File.separator)) {
            throw IllegalStateException("This archive contains an unsafe file path.")
        }
        return child
    }

    // ------------------------------------------------------- making an archive

    /** One file on its way into an archive, with the name and size it will carry. */
    private data class Source(val uri: Uri, val name: String, val size: Long)

    /**
     * Packs the chosen files into a single archive and saves it to Downloads.
     *
     * @param format zip, 7z, tar, tar.gz, tar.bz2 or tar.xz
     * @param password encrypts the archive; only zip can carry one. Empty for none.
     *
     * Nothing is copied first: each file is streamed from its uri straight into the
     * archive, so packing a gigabyte does not need a spare gigabyte of cache. The one
     * exception is a file whose provider will not say how big it is, because tar has
     * to write the length into the header before the bytes.
     */
    @ReactMethod
    fun createArchive(
        uris: ReadableArray,
        format: String,
        password: String,
        baseName: String,
        promise: Promise,
    ) {
        val staged = mutableListOf<File>()
        val out = File(ctx.cacheDir, "${safeName(baseName, "archive")}.$format")
        try {
            if (password.isNotEmpty() && format != "zip") {
                throw IllegalArgumentException("Only a zip can be password protected.")
            }

            val sources = collect(uris)
            if (sources.isEmpty()) throw IllegalStateException("No files were chosen.")

            out.parentFile?.mkdirs()
            out.delete()

            when (format) {
                "zip" -> writeZip(sources, out, password)
                "7z" -> writeSevenZ(sources, out)
                "tar", "tar.gz", "tar.bz2", "tar.xz" -> writeTar(sources, out, format, staged)
                else -> throw IllegalArgumentException("$format archives cannot be created.")
            }

            emit("Saving the archive", sources.size, sources.size)
            val result = publish(out, "", out.name)
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("create_failed", e.message ?: "The archive could not be made.")
        } finally {
            out.delete()
            staged.forEach { it.delete() }
        }
    }

    /**
     * Names are made unique before anything is written. Two files picked from
     * different folders can easily share a name, and an archive holding the same name
     * twice confuses most tools that open it — some show one, some overwrite.
     */
    private fun collect(uris: ReadableArray): List<Source> {
        val used = mutableSetOf<String>()
        val sources = mutableListOf<Source>()
        for (i in 0 until uris.size()) {
            val uri = Uri.parse(uris.getString(i) ?: continue)
            var name = safeName(queryName(uri), "file")
            if (!used.add(name.lowercase())) {
                val stem = name.substringBeforeLast('.', name)
                val ext = name.substringAfterLast('.', "")
                var n = 2
                do {
                    name = if (ext.isEmpty()) "$stem ($n)" else "$stem ($n).$ext"
                    n++
                } while (!used.add(name.lowercase()))
            }
            sources += Source(uri, name, querySize(uri))
        }
        return sources
    }

    private fun querySize(uri: Uri): Long {
        ctx.contentResolver.query(uri, null, null, null, null)?.use { c ->
            val idx = c.getColumnIndex(OpenableColumns.SIZE)
            if (c.moveToFirst() && idx >= 0 && !c.isNull(idx)) return c.getLong(idx)
        }
        return -1L
    }

    private fun open(uri: Uri): InputStream =
        ctx.contentResolver.openInputStream(uri)
            ?: throw IllegalStateException("A chosen file could not be read.")

    private fun writeZip(sources: List<Source>, out: File, password: String) {
        val stream = if (password.isEmpty()) {
            ZipOutputStream(FileOutputStream(out))
        } else {
            ZipOutputStream(FileOutputStream(out), password.toCharArray())
        }
        stream.use { zip ->
            sources.forEachIndexed { i, src ->
                emit("Adding ${src.name}", i, sources.size)
                val params = ZipParameters().apply {
                    fileNameInZip = src.name
                    compressionMethod = CompressionMethod.DEFLATE
                    if (password.isNotEmpty()) {
                        isEncryptFiles = true
                        // AES-256 rather than the zip standard's own cipher, which is
                        // old enough to be broken by anyone who cares to.
                        encryptionMethod = EncryptionMethod.AES
                        aesKeyStrength = AesKeyStrength.KEY_STRENGTH_256
                    }
                }
                zip.putNextEntry(params)
                open(src.uri).use { it.copyTo(zip, DEFAULT_BUFFER_SIZE) }
                zip.closeEntry()
            }
        }
    }

    private fun writeSevenZ(sources: List<Source>, out: File) {
        SevenZOutputFile(out).use { seven ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            sources.forEachIndexed { i, src ->
                emit("Adding ${src.name}", i, sources.size)
                val entry = SevenZArchiveEntry().apply {
                    name = src.name
                    if (src.size >= 0) size = src.size
                }
                seven.putArchiveEntry(entry)
                open(src.uri).use { input ->
                    while (true) {
                        val read = input.read(buffer)
                        if (read <= 0) break
                        seven.write(buffer, 0, read)
                    }
                }
                seven.closeArchiveEntry()
            }
        }
    }

    /**
     * @param staged collects any temporary copies, so the caller can delete them
     *               whether this finishes or throws.
     */
    private fun writeTar(sources: List<Source>, out: File, format: String, staged: MutableList<File>) {
        val raw = FileOutputStream(out)
        val compressed: OutputStream = when (format) {
            "tar.gz" -> GzipCompressorOutputStream(raw)
            "tar.bz2" -> BZip2CompressorOutputStream(raw)
            "tar.xz" -> XZCompressorOutputStream(raw)
            else -> raw
        }
        TarArchiveOutputStream(compressed).use { tar ->
            // Long names and large files are both commonplace; without these a name
            // over 100 characters is truncated and anything past 8 GB cannot be stored.
            tar.setLongFileMode(TarArchiveOutputStream.LONGFILE_POSIX)
            tar.setBigNumberMode(TarArchiveOutputStream.BIGNUMBER_POSIX)

            sources.forEachIndexed { i, src ->
                emit("Adding ${src.name}", i, sources.size)
                // tar writes each file's length into its header, before the bytes, so a
                // size the provider would not give up has to be measured by copying.
                var size = src.size
                var from = src.uri
                if (size < 0) {
                    val copy = File(ctx.cacheDir, "stage_${System.currentTimeMillis()}_$i")
                    staged += copy
                    open(src.uri).use { input -> FileOutputStream(copy).use { input.copyTo(it) } }
                    size = copy.length()
                    from = Uri.fromFile(copy)
                }
                val entry = TarArchiveEntry(src.name).apply { setSize(size) }
                tar.putArchiveEntry(entry)
                val written = open(from).use { it.copyTo(tar, DEFAULT_BUFFER_SIZE) }
                // The header was written before the bytes, so a provider that reported
                // the wrong length has already corrupted this entry. commons-compress
                // notices too, but says only that the count disagreed; naming the file
                // is the difference between a fixable problem and a mystery.
                if (written != size) {
                    throw IllegalStateException(
                        "\"${src.name}\" changed size while it was being packed. " +
                            "Try again, or leave that file out.",
                    )
                }
                tar.closeArchiveEntry()
            }
        }
    }

    private fun publish(file: File, folder: String, relative: String): WritableMap {
        val mime = MimeTypeMap.getSingleton()
            .getMimeTypeFromExtension(file.extension.lowercase()) ?: "application/octet-stream"
        val subPath = relative.substringBeforeLast('/', "")
        val uri: Uri
        val shown: String

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val relPath = listOf(Environment.DIRECTORY_DOWNLOADS, folder, subPath)
                .filter { it.isNotBlank() }.joinToString("/") + "/"
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, file.name)
                put(MediaStore.Downloads.MIME_TYPE, mime)
                put(MediaStore.Downloads.RELATIVE_PATH, relPath)
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val resolver = ctx.contentResolver
            uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: throw IllegalStateException("Downloads folder is not writable.")
            resolver.openOutputStream(uri)?.use { out -> file.inputStream().use { it.copyTo(out) } }
            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
            shown = relPath + file.name
        } else {
            val dir = File(
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                listOf(folder, subPath).filter { it.isNotBlank() }.joinToString("/"),
            )
            dir.mkdirs()
            val out = File(dir, file.name)
            file.copyTo(out, overwrite = true)
            uri = androidx.core.content.FileProvider.getUriForFile(ctx, ctx.packageName + ".provider", out)
            shown = out.absolutePath
        }

        return Arguments.createMap().apply {
            putString("uri", uri.toString())
            putString("path", shown)
            putString("name", file.name)
            putString("mime", mime)
        }
    }

    /**
     * Makes a name safe to write, without rewriting it.
     *
     * Deliberately not sanitise(): that keeps only [\w-. ()], and \w is ASCII, so a
     * Hindi, Arabic or even accented name came out as a row of spaces. Inside an
     * archive that is worse than untidy — two such names collide and the second is
     * stored as " (2)". A name belongs to whoever made the file.
     *
     * What does have to go is anything that would turn an entry name into a path:
     * separators, a leading dot, and control characters.
     */
    private fun safeName(name: String, fallback: String): String {
        val cleaned = buildString {
            for (ch in name) {
                when {
                    // Separators and the characters Windows and Android refuse. A
                    // separator matters most: an entry name is a path inside the
                    // archive, and one containing a slash unpacks into a folder of
                    // its own — or, with "..", outside the one it was meant for.
                    ch == '\\' || ch == '/' || ch == ':' || ch == '*' || ch == '?' ||
                        ch == '"' || ch == '<' || ch == '>' || ch == '|' -> append('_')
                    // Control characters, which no file name has any business holding.
                    ch.code < 0x20 || ch.code == 0x7F -> Unit
                    else -> append(ch)
                }
            }
        }.trim().trimStart('.').trim()
        return cleaned.ifBlank { fallback }
    }

    private fun sanitise(name: String) =
        name.replace(Regex("[^\\w\\-. ()]+"), " ").replace(Regex("\\s+"), " ").trim()
            .ifBlank { "archive" }

    private fun queryName(uri: Uri): String {
        var name = uri.lastPathSegment ?: "archive"
        ctx.contentResolver.query(uri, null, null, null, null)?.use { c ->
            val idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (c.moveToFirst() && idx >= 0) name = c.getString(idx)
        }
        return name
    }
}
