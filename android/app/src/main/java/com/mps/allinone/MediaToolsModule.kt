package com.mps.allinone

import android.graphics.Bitmap
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.media.MediaMuxer
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.Effect
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.Presentation
import androidx.media3.effect.ScaleAndRotateTransformation
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import androidx.media3.transformer.VideoEncoderSettings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * The offline audio and video engine.
 *
 * Video goes through AndroidX Media3 Transformer, which uses the phone's own
 * hardware codecs: trim, merge, compress, change resolution, rotate, mute and
 * convert to MP4.
 *
 * Audio goes through a small pipeline of our own built on MediaCodec, so every
 * step is under our control: decode any format the phone can play (MP3, AAC,
 * M4A, WAV, FLAC, OGG, OPUS, AMR, and the audio inside any video), trim to the
 * millisecond, change volume, fade in and out, join several files, and encode to
 * M4A or AAC at a chosen bit rate, or to lossless WAV.
 */
@OptIn(UnstableApi::class)
class MediaToolsModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {

    override fun getName() = "MediaTools"

    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private val cancelled = AtomicBoolean(false)
    @Volatile private var transformer: Transformer? = null

    // NativeEventEmitter needs these two to exist.
    @ReactMethod fun addListener(eventName: String) = Unit
    @ReactMethod fun removeListeners(count: Int) = Unit

    private fun progress(percent: Int, stage: String) {
        try {
            ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("mediaProgress", Arguments.createMap().apply {
                    putInt("percent", percent.coerceIn(0, 100))
                    putString("stage", stage)
                })
        } catch (_: Exception) {
        }
    }

    @ReactMethod
    fun cancel() {
        cancelled.set(true)
        main.post { try { transformer?.cancel() } catch (_: Exception) {} }
    }

    // ------------------------------------------------------------------- probe

    @ReactMethod
    fun probe(uriString: String, promise: Promise) {
        worker.execute {
            val r = MediaMetadataRetriever()
            try {
                r.setDataSource(ctx, toUri(uriString))
                fun key(k: Int) = r.extractMetadata(k)
                promise.resolve(Arguments.createMap().apply {
                    putDouble("durationMs", (key(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L).toDouble())
                    putInt("width", key(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0)
                    putInt("height", key(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0)
                    putInt("rotation", key(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0)
                    putInt("bitrate", key(MediaMetadataRetriever.METADATA_KEY_BITRATE)?.toIntOrNull() ?: 0)
                    putBoolean("hasVideo", key(MediaMetadataRetriever.METADATA_KEY_HAS_VIDEO) == "yes")
                    putBoolean("hasAudio", key(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO) == "yes")
                    putString("mime", key(MediaMetadataRetriever.METADATA_KEY_MIMETYPE) ?: "")
                })
            } catch (e: Exception) {
                promise.reject("E_PROBE", "This file cannot be read as audio or video on this phone.", e)
            } finally {
                try { r.release() } catch (_: Exception) {}
            }
        }
    }

    /**
     * A small JPEG preview frame for the video tool screens, written to the cache;
     * resolves to its file uri. On Android 8.1 and later the frame is decoded at the
     * small size directly — a 4K frame is 33 MB as a bitmap, the preview 0.3 MB.
     */
    @ReactMethod
    fun thumbnail(uriString: String, timeMs: Double, width: Int, promise: Promise) {
        worker.execute {
            val r = MediaMetadataRetriever()
            try {
                r.setDataSource(ctx, toUri(uriString))
                val us = (timeMs * 1000).toLong()
                val frame = (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                    // Fits the frame inside the box keeping its shape: width-bound, as below.
                    r.getScaledFrameAtTime(us, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, width, width * 4)
                } else {
                    r.getFrameAtTime(us, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
                }) ?: throw IllegalStateException("No frame")
                val scaled = if (frame.width > width) {
                    Bitmap.createScaledBitmap(frame, width, (frame.height * width.toFloat() / frame.width).roundToInt(), true)
                } else frame
                val dir = File(ctx.cacheDir, "thumbs").apply { mkdirs() }
                // One preview at a time is ever on screen; older ones are let go.
                dir.listFiles()?.forEach { it.delete() }
                val out = File(dir, "thumb-${System.currentTimeMillis()}.jpg")
                FileOutputStream(out).use { scaled.compress(Bitmap.CompressFormat.JPEG, 80, it) }
                if (scaled !== frame) scaled.recycle()
                frame.recycle()
                promise.resolve("file://${out.absolutePath}")
            } catch (e: Exception) {
                promise.reject("E_THUMB", e.message, e)
            } finally {
                try { r.release() } catch (_: Exception) {}
            }
        }
    }

    /**
     * The trim screen's frame strip: count small JPEGs spread evenly over the video,
     * each heightPx tall, in the cache. Each is sent as a "thumbStrip" event
     * {index, uri, job} the moment it is written, so the strip fills in as they
     * come; the promise resolves with all of them in order. Every frame is decoded
     * at the small size (Android 8.1+) and recycled once saved, and a new strip or
     * clearThumbnails() stops one still being made.
     */
    @ReactMethod
    fun thumbnails(uriString: String, count: Int, heightPx: Int, promise: Promise) {
        val job = stripJob.incrementAndGet()
        strip.execute {
            val r = MediaMetadataRetriever()
            try {
                r.setDataSource(ctx, toUri(uriString))
                val durUs = (r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L) * 1000
                val n = count.coerceIn(1, 30)
                val h = heightPx.coerceIn(16, 400)
                val dir = File(ctx.cacheDir, STRIP_DIR).apply { mkdirs() }
                dir.listFiles()?.forEach { it.delete() }
                val uris = Arguments.createArray()
                for (i in 0 until n) {
                    if (stripJob.get() != job) break
                    // The middle of each slice, so the first frame is not a black lead-in.
                    val us = (durUs * (i + 0.5) / n).toLong()
                    val frame = (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                        // Fits inside h * 4 by h: height-bound for any normal video.
                        r.getScaledFrameAtTime(us, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, h * 4, h)
                    } else {
                        r.getFrameAtTime(us, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
                    }) ?: continue
                    val scaled = if (frame.height > h) {
                        Bitmap.createScaledBitmap(frame, max(1, (frame.width * h.toFloat() / frame.height).roundToInt()), h, true)
                    } else frame
                    val out = File(dir, "s$job-$i.jpg")
                    FileOutputStream(out).use { scaled.compress(Bitmap.CompressFormat.JPEG, 75, it) }
                    if (scaled !== frame) scaled.recycle()
                    frame.recycle()
                    val uri = "file://${out.absolutePath}"
                    uris.pushString(uri)
                    try {
                        ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                            .emit("thumbStrip", Arguments.createMap().apply {
                                putInt("index", i)
                                putString("uri", uri)
                                putInt("job", job)
                            })
                    } catch (_: Exception) {
                    }
                }
                promise.resolve(Arguments.createMap().apply {
                    putInt("job", job)
                    putArray("uris", uris)
                })
            } catch (e: Exception) {
                promise.reject("E_THUMB", e.message ?: "Could not read frames from this video.", e)
            } finally {
                try { r.release() } catch (_: Exception) {}
            }
        }
    }

    /** The trim screen has closed: any strip still being made stops, and its files go. */
    @ReactMethod
    fun clearThumbnails() {
        stripJob.incrementAndGet()
        strip.execute { File(ctx.cacheDir, STRIP_DIR).listFiles()?.forEach { it.delete() } }
    }

    /** Its own thread, so the strip never waits behind a probe or a running job. */
    private val strip = Executors.newSingleThreadExecutor()
    private val stripJob = AtomicInteger(0)

    // ------------------------------------------------------------------- video

    /**
     * opts:
     *  startMs / endMs   trim (single input only), endMs 0 = to the end
     *  maxHeight         e.g. 480 / 720 / 1080, 0 = keep
     *  videoBitrate      bits per second, 0 = let the encoder decide
     *  rotate            0 | 90 | 180 | 270
     *  mute              drop the sound
     *  outPath           .mp4 to write
     *  mergeWidth / mergeHeight  common frame for merging clips of different sizes
     */
    @ReactMethod
    fun transformVideo(uris: ReadableArray, opts: ReadableMap, promise: Promise) {
        cancelled.set(false)
        val outPath = opts.str("outPath") ?: return promise.reject("E_ARGS", "No output path.")
        File(outPath).parentFile?.mkdirs()
        val list = (0 until uris.size()).mapNotNull { uris.getString(it) }.map { toUri(it) }
        if (list.isEmpty()) return promise.reject("E_ARGS", "Choose a video first.")

        main.post {
            try {
                val startMs = opts.dbl("startMs").toLong()
                val endMs = opts.dbl("endMs").toLong()
                val maxHeight = opts.dbl("maxHeight").toInt()
                val rotate = opts.dbl("rotate").toInt()
                val mute = opts.bool("mute")
                val mergeW = opts.dbl("mergeWidth").toInt()
                val mergeH = opts.dbl("mergeHeight").toInt()

                val items = list.map { uri ->
                    val builder = MediaItem.Builder().setUri(uri)
                    if (list.size == 1 && (startMs > 0 || endMs > 0)) {
                        val clip = MediaItem.ClippingConfiguration.Builder().setStartPositionMs(startMs)
                        if (endMs > startMs) clip.setEndPositionMs(endMs)
                        builder.setClippingConfiguration(clip.build())
                    }
                    val video = mutableListOf<Effect>()
                    if (rotate % 360 != 0) {
                        video += ScaleAndRotateTransformation.Builder().setRotationDegrees(rotate.toFloat()).build()
                    }
                    if (mergeW > 0 && mergeH > 0) {
                        video += Presentation.createForWidthAndHeight(mergeW, mergeH, Presentation.LAYOUT_SCALE_TO_FIT)
                    } else if (maxHeight > 0) {
                        video += Presentation.createForHeight(maxHeight)
                    }
                    EditedMediaItem.Builder(builder.build())
                        .setRemoveAudio(mute)
                        .setEffects(Effects(emptyList(), video))
                        .build()
                }

                @Suppress("DEPRECATION")
                val sequence = EditedMediaItemSequence(items)
                val composition = Composition.Builder(listOf(sequence)).apply {
                    // Joining a silent clip to one with sound needs a track to fill.
                    if (items.size > 1 && !mute) experimentalSetForceAudioTrack(true)
                }.build()

                val encoder = DefaultEncoderFactory.Builder(ctx).apply {
                    val bitrate = opts.dbl("videoBitrate").toInt()
                    if (bitrate > 0) {
                        setRequestedVideoEncoderSettings(VideoEncoderSettings.Builder().setBitrate(bitrate).build())
                    }
                }.build()

                val t = Transformer.Builder(ctx)
                    .setVideoMimeType(MimeTypes.VIDEO_H264)
                    .setAudioMimeType(MimeTypes.AUDIO_AAC)
                    .setEncoderFactory(encoder)
                    .addListener(object : Transformer.Listener {
                        override fun onCompleted(composition: Composition, exportResult: ExportResult) {
                            transformer = null
                            progress(100, "Done")
                            val f = File(outPath)
                            promise.resolve(Arguments.createMap().apply {
                                putString("path", f.absolutePath)
                                putDouble("size", f.length().toDouble())
                                putDouble("durationMs", exportResult.durationMs.toDouble())
                            })
                        }

                        override fun onError(
                            composition: Composition,
                            exportResult: ExportResult,
                            exportException: ExportException,
                        ) {
                            transformer = null
                            File(outPath).delete()
                            if (cancelled.get()) {
                                promise.reject("cancelled", "Stopped.")
                            } else {
                                promise.reject("E_VIDEO", friendly(exportException), exportException)
                            }
                        }
                    })
                    .build()
                transformer = t
                t.start(composition, outPath)
                pollProgress(t)
            } catch (e: Exception) {
                transformer = null
                promise.reject("E_VIDEO", e.message ?: "Could not process this video.", e)
            }
        }
    }

    private fun pollProgress(t: Transformer) {
        val holder = ProgressHolder()
        main.postDelayed(object : Runnable {
            override fun run() {
                if (transformer !== t) return
                if (t.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE) {
                    progress(holder.progress, "Processing video")
                }
                main.postDelayed(this, 350)
            }
        }, 350)
    }

    private fun friendly(e: ExportException): String = when (e.errorCode) {
        ExportException.ERROR_CODE_DECODER_INIT_FAILED,
        ExportException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED ->
            "This phone cannot decode this video format."
        ExportException.ERROR_CODE_ENCODER_INIT_FAILED,
        ExportException.ERROR_CODE_ENCODING_FORMAT_UNSUPPORTED ->
            "This phone's encoder does not support that size. Try a lower resolution."
        ExportException.ERROR_CODE_IO_FILE_NOT_FOUND -> "The video could not be opened."
        else -> e.message ?: "Could not process this video."
    }

    // ------------------------------------------------------------------- audio

    /**
     * opts:
     *  format     "mp3" | "m4a" | "aac" | "wav"
     *  bitrate    bits per second for mp3 / m4a / aac (48000..320000)
     *  startMs / endMs   trim, applied to a single input
     *  volume     1.0 = unchanged, 0..3
     *  fadeInMs / fadeOutMs
     *  outPath
     */
    @ReactMethod
    fun transformAudio(uris: ReadableArray, opts: ReadableMap, promise: Promise) {
        cancelled.set(false)
        worker.execute {
            val outPath = opts.str("outPath")
            try {
                if (outPath == null) throw IllegalArgumentException("No output path.")
                val list = (0 until uris.size()).mapNotNull { uris.getString(it) }.map { toUri(it) }
                if (list.isEmpty()) throw IllegalArgumentException("Choose a file first.")
                val out = File(outPath).apply { parentFile?.mkdirs() }
                val format = opts.str("format") ?: "m4a"
                val bitrate = opts.dbl("bitrate").toInt().takeIf { it > 0 } ?: 192_000
                val startUs = (opts.dbl("startMs") * 1000).toLong()
                val endUsOpt = (opts.dbl("endMs") * 1000).toLong()
                val gain = if (opts.hasKey("volume")) opts.dbl("volume").toFloat() else 1f
                val fadeInMs = opts.dbl("fadeInMs")
                val fadeOutMs = opts.dbl("fadeOutMs")

                // Cutting an MP3 to an MP3 with nothing else changed: copy the frames
                // as they are, so the kept part loses no quality to a second encode.
                // Only for a trim — a plain MP3 to MP3 run is a request for a new bit rate.
                val trimming = startUs > 0 || endUsOpt > 0
                if (list.size == 1 && format == "mp3" && trimming && gain == 1f && fadeInMs <= 0 && fadeOutMs <= 0 &&
                    trackMime(list[0]) == MimeTypes.AUDIO_MPEG
                ) {
                    val endUs = if (endUsOpt > startUs) endUsOpt else durationUs(list[0])
                    if (copyMp3Frames(list[0], startUs, endUs, out)) {
                        progress(100, "Done")
                        promise.resolve(Arguments.createMap().apply {
                            putString("path", out.absolutePath)
                            putDouble("size", out.length().toDouble())
                            putDouble("durationMs", (endUs - startUs) / 1000.0)
                        })
                        return@execute
                    }
                    // The copy did not come out the right length: re-encode instead.
                }

                // Expected output length, for progress and for placing the fade out.
                val durations = list.map { durationUs(it) }
                val segments = list.mapIndexed { i, uri ->
                    val s = if (list.size == 1) startUs else 0L
                    val e = if (list.size == 1 && endUsOpt > s) endUsOpt else durations[i]
                    Triple(uri, s, e)
                }
                val totalFrames = segments.sumOf { (_, s, e) -> ((e - s).coerceAtLeast(0) * OUT_RATE / 1_000_000) }
                    .coerceAtLeast(1)
                val shaper = Shaper(
                    gain = gain,
                    fadeInFrames = (fadeInMs * OUT_RATE / 1000).toLong(),
                    fadeOutFrames = (fadeOutMs * OUT_RATE / 1000).toLong(),
                    totalFrames = totalFrames,
                )

                val sink: PcmSink = when (format) {
                    "mp3" -> Mp3Sink(out, bitrate)
                    "wav" -> WavSink(out)
                    "aac" -> AacSink(out, bitrate, adts = true)
                    else -> AacSink(out, bitrate, adts = false)
                }
                try {
                    var written = 0L
                    var lastPct = -1
                    for ((uri, s, e) in segments) {
                        val resampler = Resampler()
                        decode(uri, s, e) { pcm, frames, rate, channels ->
                            val stereo = toStereo(pcm, frames, channels)
                            val (res, n) = resampler.process(stereo, frames, rate)
                            shaper.apply(res, n)
                            sink.write(res, n * 2)
                            written += n
                            val pct = (written * 100 / totalFrames).toInt().coerceAtMost(99)
                            if (pct != lastPct) {
                                lastPct = pct
                                progress(pct, "Processing audio")
                            }
                        }
                    }
                    sink.finish()
                } catch (e: Throwable) {
                    sink.abort()
                    throw e
                }
                if (out.length() == 0L) throw IllegalStateException("No audio was found in this file.")
                progress(100, "Done")
                promise.resolve(Arguments.createMap().apply {
                    putString("path", out.absolutePath)
                    putDouble("size", out.length().toDouble())
                    putDouble("durationMs", (totalFrames * 1000.0 / OUT_RATE))
                })
            } catch (e: CancelledException) {
                outPath?.let { File(it).delete() }
                promise.reject("cancelled", "Stopped.")
            } catch (e: NoAudioException) {
                outPath?.let { File(it).delete() }
                promise.reject("E_NO_AUDIO", "This file has no sound track.")
            } catch (e: OutOfMemoryError) {
                outPath?.let { File(it).delete() }
                promise.reject("E_MEMORY", "Not enough memory for this file.")
            } catch (e: Exception) {
                outPath?.let { File(it).delete() }
                promise.reject("E_AUDIO", e.message ?: "Could not process this audio.", e)
            }
        }
    }

    /**
     * Peak levels for drawing the sound: the file decoded with the same pipeline the
     * audio tools use, split into [bars] equal slices of time, each the loudest
     * sample in it from 0 to 1.
     */
    @ReactMethod
    fun waveform(uriString: String, bars: Int, promise: Promise) {
        worker.execute {
            try {
                // Jobs run one at a time on this worker, so clearing the flag here
                // cannot undo the Stop of a running conversion.
                cancelled.set(false)
                val uri = toUri(uriString)
                val n = bars.coerceIn(10, 1000)
                val durUs = durationUs(uri).coerceAtLeast(1)
                val peaks = FloatArray(n)
                var framesSeen = 0L
                decode(uri, 0, 0) { pcm, frames, rate, channels ->
                    for (f in 0 until frames) {
                        val tUs = (framesSeen + f) * 1_000_000L / rate
                        val bar = (tUs * n / durUs).toInt().coerceIn(0, n - 1)
                        var peak = 0
                        for (c in 0 until channels) {
                            val s = pcm[f * channels + c].toInt()
                            val a = if (s < 0) -s else s
                            if (a > peak) peak = a
                        }
                        val v = peak / 32768f
                        if (v > peaks[bar]) peaks[bar] = v
                    }
                    framesSeen += frames
                }
                promise.resolve(Arguments.createArray().apply { peaks.forEach { pushDouble(it.toDouble()) } })
            } catch (e: NoAudioException) {
                promise.reject("E_NO_AUDIO", "This file has no sound track.")
            } catch (e: Exception) {
                promise.reject("E_WAVEFORM", e.message ?: "The sound could not be read.", e)
            }
        }
    }

    // --------------------------------------------------------- audio internals

    private class CancelledException : Exception()
    private class NoAudioException : Exception()

    private fun durationUs(uri: Uri): Long {
        val ex = MediaExtractor()
        try {
            ex.setDataSource(ctx, uri, null)
            for (i in 0 until ex.trackCount) {
                val f = ex.getTrackFormat(i)
                if (f.getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true && f.containsKey(MediaFormat.KEY_DURATION)) {
                    return f.getLong(MediaFormat.KEY_DURATION)
                }
            }
        } catch (_: Exception) {
        } finally {
            ex.release()
        }
        val r = MediaMetadataRetriever()
        return try {
            r.setDataSource(ctx, uri)
            (r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L) * 1000
        } catch (_: Exception) {
            0L
        } finally {
            try { r.release() } catch (_: Exception) {}
        }
    }

    /** MIME type of the first audio track, or null. */
    private fun trackMime(uri: Uri): String? {
        val ex = MediaExtractor()
        return try {
            ex.setDataSource(ctx, uri, null)
            (0 until ex.trackCount).map { ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME) }
                .firstOrNull { it?.startsWith("audio/") == true }
        } catch (_: Exception) {
            null
        } finally {
            ex.release()
        }
    }

    /**
     * Copies the MP3 frames between startUs and endUs into [out] untouched. Every MP3
     * frame carries its own header, so frames laid end to end are a valid file.
     *
     * Returns false, with nothing left behind, if the result is not within 100 ms of
     * the asked length — a VBR file without a seek table can land the start in the
     * wrong place, and the caller then re-encodes instead.
     */
    private fun copyMp3Frames(uri: Uri, startUs: Long, endUs: Long, out: File): Boolean {
        val ex = MediaExtractor()
        try {
            ex.setDataSource(ctx, uri, null)
            val track = (0 until ex.trackCount).firstOrNull {
                ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME) == MimeTypes.AUDIO_MPEG
            } ?: return false
            ex.selectTrack(track)
            if (startUs > 0) ex.seekTo(startUs, MediaExtractor.SEEK_TO_CLOSEST_SYNC)
            val buf = ByteBuffer.allocate(64 * 1024)
            val bytes = ByteArray(buf.capacity())
            val span = (endUs - startUs).coerceAtLeast(1)
            var lastPct = -1
            FileOutputStream(out).buffered(1 shl 16).use { sink ->
                while (true) {
                    if (cancelled.get()) throw CancelledException()
                    buf.clear()
                    val n = ex.readSampleData(buf, 0)
                    if (n < 0) break
                    val t = ex.sampleTime
                    if (endUs > 0 && t >= endUs) break
                    buf.get(bytes, 0, n)
                    sink.write(bytes, 0, n)
                    val pct = ((t - startUs).coerceAtLeast(0) * 100 / span).toInt().coerceIn(0, 99)
                    if (pct != lastPct) {
                        lastPct = pct
                        progress(pct, "Cutting audio")
                    }
                    ex.advance()
                }
            }
        } catch (e: CancelledException) {
            out.delete()
            throw e
        } catch (_: Exception) {
            out.delete()
            return false
        } finally {
            ex.release()
        }

        val want = (endUs - startUs) / 1000
        val got = MediaMetadataRetriever().let { r ->
            try {
                r.setDataSource(out.absolutePath)
                r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
            } catch (_: Exception) {
                null
            } finally {
                try { r.release() } catch (_: Exception) {}
            }
        }
        if (got == null || kotlin.math.abs(got - want) > 100) {
            out.delete()
            return false
        }
        return true
    }

    /** Streams 16-bit PCM between startUs and endUs (endUs 0 = to the end) to [onPcm]. */
    private fun decode(uri: Uri, startUs: Long, endUs: Long, onPcm: (ShortArray, Int, Int, Int) -> Unit) {
        val ex = MediaExtractor()
        ex.setDataSource(ctx, uri, null)
        val track = (0 until ex.trackCount).firstOrNull {
            ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
        } ?: run { ex.release(); throw NoAudioException() }
        ex.selectTrack(track)
        val format = ex.getTrackFormat(track)
        val mime = format.getString(MediaFormat.KEY_MIME)!!
        if (startUs > 0) ex.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)

        val codec = MediaCodec.createDecoderByType(mime)
        codec.configure(format, null, null, 0)
        codec.start()
        var rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        var floatPcm = false
        val info = MediaCodec.BufferInfo()
        var inputDone = false
        var outputDone = false
        var scratch = ShortArray(0)
        try {
            while (!outputDone) {
                if (cancelled.get()) throw CancelledException()
                // Every input buffer the codec has free right now, without waiting.
                // One buffer per pass plus a 10 ms wait for output kept the decoder
                // idle most of the time: a 3.5 minute song took almost two minutes.
                while (!inputDone) {
                    val i = codec.dequeueInputBuffer(0)
                    if (i < 0) break
                    val buf = codec.getInputBuffer(i)!!
                    val n = ex.readSampleData(buf, 0)
                    val t = ex.sampleTime
                    if (n < 0 || (endUs > 0 && t > endUs)) {
                        codec.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                        inputDone = true
                    } else {
                        codec.queueInputBuffer(i, 0, n, t, 0)
                        ex.advance()
                    }
                }
                val o = codec.dequeueOutputBuffer(info, 2_000)
                if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    val f = codec.outputFormat
                    rate = f.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                    channels = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                    floatPcm = Build.VERSION.SDK_INT >= Build.VERSION_CODES.N &&
                        f.containsKey(MediaFormat.KEY_PCM_ENCODING) &&
                        f.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT
                } else if (o >= 0) {
                    if (info.size > 0 && channels > 0) {
                        val buf = codec.getOutputBuffer(o)!!
                        buf.position(info.offset)
                        buf.limit(info.offset + info.size)
                        buf.order(ByteOrder.LITTLE_ENDIAN)
                        val samples = if (floatPcm) info.size / 4 else info.size / 2
                        if (scratch.size < samples) scratch = ShortArray(samples)
                        if (floatPcm) {
                            val fb = buf.asFloatBuffer()
                            for (k in 0 until samples) {
                                scratch[k] = (fb.get(k).coerceIn(-1f, 1f) * 32767f).toInt().toShort()
                            }
                        } else {
                            buf.asShortBuffer().get(scratch, 0, samples)
                        }
                        var first = 0
                        var frames = samples / channels
                        val t0 = info.presentationTimeUs
                        if (startUs > 0 && t0 < startUs) {
                            first = ((startUs - t0) * rate / 1_000_000).toInt().coerceAtMost(frames)
                        }
                        if (endUs > 0) {
                            val lastAllowed = ((endUs - t0) * rate / 1_000_000).toInt()
                            frames = min(frames, lastAllowed.coerceAtLeast(0))
                        }
                        val count = frames - first
                        if (count > 0) {
                            val chunk = if (first == 0) scratch.copyOf(count * channels)
                            else scratch.copyOfRange(first * channels, (first + count) * channels)
                            onPcm(chunk, count, rate, channels)
                        }
                    }
                    codec.releaseOutputBuffer(o, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
                }
            }
        } finally {
            try { codec.stop() } catch (_: Exception) {}
            codec.release()
            ex.release()
        }
    }

    private fun toStereo(pcm: ShortArray, frames: Int, channels: Int): ShortArray {
        if (channels == 2) return pcm
        val out = ShortArray(frames * 2)
        for (f in 0 until frames) {
            if (channels == 1) {
                out[2 * f] = pcm[f]
                out[2 * f + 1] = pcm[f]
            } else {
                out[2 * f] = pcm[f * channels]
                out[2 * f + 1] = pcm[f * channels + 1]
            }
        }
        return out
    }

    /** Streaming linear resampler to 44.1 kHz stereo. One per input file. */
    private class Resampler {
        private var pos = 0.0
        private var prevL = 0
        private var prevR = 0
        private var primed = false

        fun process(src: ShortArray, frames: Int, rate: Int): Pair<ShortArray, Int> {
            if (rate == OUT_RATE) return src to frames
            if (frames == 0) return src to 0
            if (!primed) {
                prevL = src[0].toInt(); prevR = src[1].toInt(); primed = true
            }
            val step = rate.toDouble() / OUT_RATE
            val estimate = ((frames - pos) / step).toInt() + 2
            val out = ShortArray(estimate.coerceAtLeast(2) * 2)
            var n = 0
            // Index 0 is the previous chunk's last frame, 1..frames are this chunk.
            fun l(i: Int) = if (i == 0) prevL else src[(i - 1) * 2].toInt()
            fun r(i: Int) = if (i == 0) prevR else src[(i - 1) * 2 + 1].toInt()
            // Every position below `frames` has both neighbours in this chunk. Stopping
            // earlier left pos negative after the shift below, so the first sample of
            // the next chunk was extrapolated past index 0 and clicked at each boundary.
            while (pos < frames && n * 2 + 1 < out.size) {
                val i = pos.toInt()
                val frac = pos - i
                out[n * 2] = (l(i) + (l(i + 1) - l(i)) * frac).roundToInt().toShort()
                out[n * 2 + 1] = (r(i) + (r(i + 1) - r(i)) * frac).roundToInt().toShort()
                n++
                pos += step
            }
            pos -= frames
            prevL = src[(frames - 1) * 2].toInt()
            prevR = src[(frames - 1) * 2 + 1].toInt()
            return out to n
        }
    }

    /** Volume and fades, applied in place on 44.1 kHz stereo frames. */
    private class Shaper(
        val gain: Float,
        val fadeInFrames: Long,
        val fadeOutFrames: Long,
        val totalFrames: Long,
    ) {
        private var at = 0L
        fun apply(pcm: ShortArray, frames: Int) {
            val plain = gain == 1f && fadeInFrames <= 0 && fadeOutFrames <= 0
            if (plain) { at += frames; return }
            for (f in 0 until frames) {
                var g = gain
                val pos = at + f
                if (fadeInFrames > 0 && pos < fadeInFrames) g *= pos.toFloat() / fadeInFrames
                val left = totalFrames - pos
                if (fadeOutFrames > 0 && left < fadeOutFrames) g *= (left.coerceAtLeast(0).toFloat() / fadeOutFrames)
                for (c in 0..1) {
                    val k = f * 2 + c
                    pcm[k] = (pcm[k] * g).toInt().coerceIn(-32768, 32767).toShort()
                }
            }
            at += frames
        }
    }

    private interface PcmSink {
        /** samples = interleaved stereo shorts to take from [pcm]. */
        fun write(pcm: ShortArray, samples: Int)
        fun finish()
        fun abort()
    }

    private class WavSink(private val file: File) : PcmSink {
        private val out = FileOutputStream(file).buffered(1 shl 16)
        private var bytes = 0L
        private val buf = ByteBuffer.allocate(1 shl 16).order(ByteOrder.LITTLE_ENDIAN)

        init { out.write(ByteArray(44)) }

        override fun write(pcm: ShortArray, samples: Int) {
            var off = 0
            while (off < samples) {
                buf.clear()
                val n = min(samples - off, buf.capacity() / 2)
                for (k in 0 until n) buf.putShort(pcm[off + k])
                out.write(buf.array(), 0, n * 2)
                bytes += n * 2
                off += n
            }
        }

        override fun finish() {
            out.flush(); out.close()
            RandomAccessFile(file, "rw").use { raf ->
                val h = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
                h.put("RIFF".toByteArray()); h.putInt((36 + bytes).toInt())
                h.put("WAVE".toByteArray()); h.put("fmt ".toByteArray())
                h.putInt(16); h.putShort(1); h.putShort(2)
                h.putInt(OUT_RATE); h.putInt(OUT_RATE * 4); h.putShort(4); h.putShort(16)
                h.put("data".toByteArray()); h.putInt(bytes.toInt())
                raf.seek(0); raf.write(h.array())
            }
        }

        override fun abort() {
            try { out.close() } catch (_: Exception) {}
            file.delete()
        }
    }

    /** MP3 through LAME (libmp3lame.so), constant bit rate, 44.1 kHz stereo. */
    private inner class Mp3Sink(private val file: File, bitrate: Int) : PcmSink {
        private val out = FileOutputStream(file).buffered(1 shl 16)
        private var handle = Mp3Encoder.init(OUT_RATE, 2, (bitrate / 1000).coerceIn(32, 320), 2)

        init {
            if (handle == 0L) {
                out.close()
                file.delete()
                throw IllegalStateException("The MP3 encoder could not start.")
            }
        }

        override fun write(pcm: ShortArray, samples: Int) {
            if (cancelled.get()) throw CancelledException()
            out.write(Mp3Encoder.encode(handle, pcm, samples / 2))
        }

        override fun finish() {
            out.write(Mp3Encoder.flush(handle))
            release()
            out.flush()
            out.close()
        }

        override fun abort() {
            release()
            try { out.close() } catch (_: Exception) {}
            file.delete()
        }

        private fun release() {
            if (handle != 0L) {
                Mp3Encoder.close(handle)
                handle = 0L
            }
        }
    }

    private inner class AacSink(private val file: File, bitrate: Int, private val adts: Boolean) : PcmSink {
        private val encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
        private val muxer: MediaMuxer? = if (adts) null else MediaMuxer(file.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        private val raw = if (adts) FileOutputStream(file).buffered(1 shl 16) else null
        private var track = -1
        private var queuedFrames = 0L
        private val info = MediaCodec.BufferInfo()
        private var frameBytes = ByteArray(0)

        init {
            val f = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, OUT_RATE, 2)
            f.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
            f.setInteger(MediaFormat.KEY_BIT_RATE, bitrate.coerceIn(32_000, 320_000))
            f.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 1 shl 15)
            encoder.configure(f, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            encoder.start()
        }

        override fun write(pcm: ShortArray, samples: Int) {
            var off = 0
            while (off < samples) {
                if (cancelled.get()) throw CancelledException()
                val i = encoder.dequeueInputBuffer(10_000)
                if (i >= 0) {
                    val buf = encoder.getInputBuffer(i)!!
                    buf.clear()
                    var n = min(buf.capacity() / 2, samples - off)
                    n -= n % 2
                    buf.order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().put(pcm, off, n)
                    val pts = queuedFrames * 1_000_000L / OUT_RATE
                    encoder.queueInputBuffer(i, 0, n * 2, pts, 0)
                    queuedFrames += n / 2
                    off += n
                }
                drain(false)
            }
        }

        override fun finish() {
            var queued = false
            var guard = 0
            while (!queued && guard++ < 500) {
                val i = encoder.dequeueInputBuffer(10_000)
                if (i >= 0) {
                    encoder.queueInputBuffer(i, 0, 0, queuedFrames * 1_000_000L / OUT_RATE, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                    queued = true
                } else drain(false)
            }
            drain(true)
            try { encoder.stop() } catch (_: Exception) {}
            encoder.release()
            if (muxer != null) {
                if (track < 0) {
                    muxer.release()
                    file.delete()
                    throw NoAudioException()
                }
                muxer.stop()
                muxer.release()
            }
            raw?.flush()
            raw?.close()
        }

        override fun abort() {
            try { encoder.stop() } catch (_: Exception) {}
            try { encoder.release() } catch (_: Exception) {}
            try { if (track >= 0) muxer?.stop() } catch (_: Exception) {}
            try { muxer?.release() } catch (_: Exception) {}
            try { raw?.close() } catch (_: Exception) {}
            file.delete()
        }

        private fun drain(endOfStream: Boolean) {
            var idle = 0
            while (true) {
                val o = encoder.dequeueOutputBuffer(info, if (endOfStream) 10_000 else 0)
                when {
                    o == MediaCodec.INFO_TRY_AGAIN_LATER -> {
                        if (!endOfStream || idle++ > 300) return
                    }
                    o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        if (muxer != null) {
                            track = muxer.addTrack(encoder.outputFormat)
                            muxer.start()
                        } else {
                            track = 0
                        }
                    }
                    o >= 0 -> {
                        val buf = encoder.getOutputBuffer(o)!!
                        val config = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
                        if (!config && info.size > 0 && track >= 0) {
                            buf.position(info.offset)
                            buf.limit(info.offset + info.size)
                            if (muxer != null) {
                                muxer.writeSampleData(track, buf, info)
                            } else if (raw != null) {
                                if (frameBytes.size < info.size) frameBytes = ByteArray(info.size)
                                buf.get(frameBytes, 0, info.size)
                                raw.write(adtsHeader(info.size + 7))
                                raw.write(frameBytes, 0, info.size)
                            }
                        }
                        encoder.releaseOutputBuffer(o, false)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
                    }
                }
            }
        }

        /** AAC-LC, 44.1 kHz, stereo. */
        private fun adtsHeader(packetLen: Int): ByteArray {
            val profile = 2
            val freqIdx = 4
            val chanCfg = 2
            return byteArrayOf(
                0xFF.toByte(),
                0xF1.toByte(),
                (((profile - 1) shl 6) + (freqIdx shl 2) + (chanCfg shr 2)).toByte(),
                (((chanCfg and 3) shl 6) + (packetLen shr 11)).toByte(),
                ((packetLen and 0x7FF) shr 3).toByte(),
                (((packetLen and 7) shl 5) + 0x1F).toByte(),
                0xFC.toByte(),
            )
        }
    }

    // ---------------------------------------------------------------- helpers

    private fun toUri(s: String): Uri =
        if (s.startsWith("/")) Uri.fromFile(File(s)) else Uri.parse(s)

    private fun ReadableMap.str(k: String) = if (hasKey(k) && !isNull(k)) getString(k) else null
    private fun ReadableMap.dbl(k: String) = if (hasKey(k) && !isNull(k)) getDouble(k) else 0.0
    private fun ReadableMap.bool(k: String) = hasKey(k) && !isNull(k) && getBoolean(k)

    companion object {
        const val OUT_RATE = 44_100
        const val STRIP_DIR = "strip"
    }
}
