package com.mps.allinone

import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.audiofx.LoudnessEnhancer
import android.net.Uri
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min

/**
 * "Listen before you cut": plays a part of an audio file the way the audio tools
 * will write it, so a trim, a fade or a volume change can be heard first.
 *
 *  - play(fromMs, toMs) plays only that part and stops (or loops) at toMs.
 *  - setEffects() applies the tool's fade-in, fade-out and volume to the preview:
 *    fades by ramping MediaPlayer.setVolume, volume above 100% through a
 *    LoudnessEnhancer, since setVolume cannot go past 1.
 *  - "previewPosition" {positionMs, playing} is sent about every 100 ms.
 *
 * Everything runs on the main thread, which MediaPlayer requires. The player is
 * let go when the app goes to the background, and JS releases it when the screen
 * closes.
 */
class AudioPreviewModule(private val ctx: ReactApplicationContext) :
    ReactContextBaseJavaModule(ctx), LifecycleEventListener {

    override fun getName() = "AudioPreview"

    private val main = Handler(Looper.getMainLooper())
    private var player: MediaPlayer? = null
    private var enhancer: LoudnessEnhancer? = null
    private var fromMs = 0
    private var toMs = 0
    private var loop = false
    private var gain = 1f
    private var fadeInMs = 0
    private var fadeOutMs = 0
    private var tick = 0

    init {
        ctx.addLifecycleEventListener(this)
    }

    // NativeEventEmitter needs these two to exist.
    @ReactMethod fun addListener(eventName: String) = Unit
    @ReactMethod fun removeListeners(count: Int) = Unit

    @ReactMethod
    fun load(uriString: String, promise: Promise) {
        main.post {
            releasePlayer()
            try {
                val uri = if (uriString.startsWith("/")) Uri.fromFile(File(uriString)) else Uri.parse(uriString)
                val mp = MediaPlayer()
                mp.setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build(),
                )
                mp.setDataSource(ctx, uri)
                mp.setOnPreparedListener {
                    player = mp
                    // Effects may have been set before the file finished loading.
                    applyLoudness()
                    promise.resolve(it.duration.toDouble())
                }
                mp.setOnErrorListener { _, what, _ ->
                    releasePlayer()
                    promise.reject("E_PREVIEW", "This file cannot be played on this phone ($what).")
                    true
                }
                mp.setOnCompletionListener { onReachedEnd() }
                mp.prepareAsync()
            } catch (e: Exception) {
                releasePlayer()
                promise.reject("E_PREVIEW", e.message ?: "This file cannot be played.", e)
            }
        }
    }

    /**
     * Fade lengths are measured from the start and to the end of the part being
     * played, which is how the tools apply them to what they write. gain is 1.0 for
     * unchanged, up to 3.0.
     */
    @ReactMethod
    fun setEffects(gain: Double, fadeInMs: Double, fadeOutMs: Double, loop: Boolean) {
        main.post {
            this.gain = gain.toFloat().coerceIn(0f, 3f)
            this.fadeInMs = max(0, fadeInMs.toInt())
            this.fadeOutMs = max(0, fadeOutMs.toInt())
            this.loop = loop
            applyLoudness()
            applyVolume()
        }
    }

    @ReactMethod
    fun play(fromMs: Double, toMs: Double) {
        main.post {
            val mp = player ?: return@post
            this.fromMs = max(0, fromMs.toInt())
            this.toMs = if (toMs > 0) min(toMs.toInt(), mp.duration) else mp.duration
            seekExact(mp, this.fromMs)
            applyVolume()
            mp.start()
            startTicking()
        }
    }

    @ReactMethod
    fun pause() {
        main.post {
            player?.let { if (it.isPlaying) it.pause() }
            emit()
        }
    }

    @ReactMethod
    fun seekTo(ms: Double) {
        main.post {
            player?.let { seekExact(it, ms.toInt()) }
            emit()
        }
    }

    /** Pauses and goes back to the start of the part. */
    @ReactMethod
    fun stop() {
        main.post {
            player?.let {
                if (it.isPlaying) it.pause()
                seekExact(it, fromMs)
            }
            emit()
        }
    }

    @ReactMethod
    fun release() {
        main.post { releasePlayer() }
    }

    // ------------------------------------------------------------- internals

    private fun seekExact(mp: MediaPlayer, ms: Int) {
        mp.seekTo(ms.toLong(), MediaPlayer.SEEK_CLOSEST)
    }

    /** 50 ms for a smooth fade ramp; the position goes out on every second tick. */
    private val ticker = object : Runnable {
        override fun run() {
            val mp = player ?: return
            if (!mp.isPlaying) {
                emit()
                return
            }
            if (mp.currentPosition >= toMs) {
                onReachedEnd()
                return
            }
            applyVolume()
            if (tick++ % 2 == 0) emit()
            main.postDelayed(this, 50)
        }
    }

    private fun startTicking() {
        main.removeCallbacks(ticker)
        tick = 0
        main.post(ticker)
    }

    private fun onReachedEnd() {
        val mp = player ?: return
        if (loop) {
            seekExact(mp, fromMs)
            applyVolume()
            if (!mp.isPlaying) mp.start()
            startTicking()
        } else {
            if (mp.isPlaying) mp.pause()
            main.removeCallbacks(ticker)
            emit(positionOverride = toMs)
        }
    }

    /** Fade envelope at the current position, with gain up to 1 through setVolume. */
    private fun applyVolume() {
        val mp = player ?: return
        val pos = try { mp.currentPosition } catch (_: Exception) { return }
        var g = min(gain, 1f)
        val intoPart = pos - fromMs
        val leftInPart = toMs - pos
        if (fadeInMs > 0 && intoPart < fadeInMs) g *= (max(0, intoPart).toFloat() / fadeInMs)
        if (fadeOutMs > 0 && leftInPart < fadeOutMs) g *= (max(0, leftInPart).toFloat() / fadeOutMs)
        try { mp.setVolume(g, g) } catch (_: Exception) {}
    }

    /** Volume above 100%: setVolume tops out at 1, so the extra comes from a loudness enhancer. */
    private fun applyLoudness() {
        val mp = player ?: return
        if (gain <= 1f) {
            enhancer?.enabled = false
            return
        }
        try {
            val e = enhancer ?: LoudnessEnhancer(mp.audioSessionId).also { enhancer = it }
            e.setTargetGain((2000 * log10(gain.toDouble())).toInt()) // millibels
            e.enabled = true
        } catch (_: Exception) {
            // Not every phone offers the effect; the preview then plays at 100%.
        }
    }

    private fun emit(positionOverride: Int? = null) {
        val mp = player ?: return
        val pos = positionOverride ?: try { mp.currentPosition } catch (_: Exception) { 0 }
        try {
            ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("previewPosition", Arguments.createMap().apply {
                    putDouble("positionMs", pos.toDouble())
                    putBoolean("playing", try { mp.isPlaying } catch (_: Exception) { false })
                })
        } catch (_: Exception) {
        }
    }

    private fun releasePlayer() {
        main.removeCallbacks(ticker)
        try { enhancer?.release() } catch (_: Exception) {}
        enhancer = null
        try { player?.release() } catch (_: Exception) {}
        player = null
    }

    override fun onHostResume() = Unit

    override fun onHostPause() {
        // Leaving the app stops the preview; the screen loads the file again when it is next used.
        main.post {
            if (player != null) {
                releasePlayer()
                try {
                    ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                        .emit("previewPosition", Arguments.createMap().apply {
                            putDouble("positionMs", -1.0)
                            putBoolean("playing", false)
                        })
                } catch (_: Exception) {
                }
            }
        }
    }

    override fun onHostDestroy() {
        main.post { releasePlayer() }
    }

    override fun invalidate() {
        main.post { releasePlayer() }
        super.invalidate()
    }
}
