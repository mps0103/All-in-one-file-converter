package com.mps.allinone

import android.annotation.SuppressLint
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.TextureView
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.SeekParameters
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.Event
import java.io.File

/**
 * The trim screen's video: one ExoPlayer drawing into a TextureView, the phone's
 * hardware decoder doing the work, so no frame is ever held as a bitmap.
 *
 * Paused, it shows the frame at previewMs (a handle being dragged), fast and
 * near while previewExact is false and the exact frame once it is true. Playing,
 * it plays startMs..endMs once and goes back to the start. It reports its place
 * as "onProgress" {positionMs, playing} about ten times a second while playing.
 *
 * The player exists only while the view is on screen: it is made when the view
 * is attached and released when it is detached, which the screen does by
 * unmounting it as the app goes to the background.
 */
@OptIn(UnstableApi::class)
@SuppressLint("ViewConstructor")
class TrimPlayerView(private val rc: ThemedReactContext) : TextureView(rc) {

    private var player: ExoPlayer? = null
    private var src: String? = null
    private var startMs = 0L
    private var endMs = 0L
    private var previewMs = -1L
    private var previewExact = true
    private var wantPlaying = false
    private val main = Handler(Looper.getMainLooper())

    private val tick = object : Runnable {
        override fun run() {
            val p = player ?: return
            val pos = p.currentPosition
            if (p.isPlaying && endMs > startMs && pos >= endMs) {
                // The end of the kept part: stop, and be ready to play it again.
                p.pause()
                p.seekTo(startMs)
                wantPlaying = false
                emit(startMs, false)
                return
            }
            emit(pos, p.isPlaying)
            if (p.isPlaying) main.postDelayed(this, 100)
        }
    }

    fun setSrc(s: String?) {
        if (s == src) return
        src = s
        release()
        if (isAttachedToWindow) create()
    }

    fun setStart(ms: Long) {
        startMs = ms
    }

    fun setEnd(ms: Long) {
        endMs = ms
    }

    /** A new frame to show; the same one again when it now has to be exact. */
    fun setPreviewMs(ms: Long) {
        if (ms == previewMs) return
        previewMs = ms
        seekPreview()
    }

    fun setPreviewExact(exact: Boolean) {
        if (exact == previewExact) return
        previewExact = exact
        if (exact) seekPreview()
    }

    private fun seekPreview() {
        val p = player ?: return
        if (wantPlaying || previewMs < 0) return
        p.setSeekParameters(if (previewExact) SeekParameters.EXACT else SeekParameters.CLOSEST_SYNC)
        p.seekTo(previewMs)
    }

    fun setPlaying(on: Boolean) {
        if (on == wantPlaying) return
        wantPlaying = on
        val p = player ?: return
        if (on) {
            val pos = p.currentPosition
            p.setSeekParameters(SeekParameters.EXACT)
            if (pos < startMs || (endMs > startMs && pos >= endMs - 50)) p.seekTo(startMs)
            p.play()
            main.removeCallbacks(tick)
            main.post(tick)
        } else {
            p.pause()
            emit(p.currentPosition, false)
        }
    }

    private fun create() {
        val s = src ?: return
        val p = ExoPlayer.Builder(rc).build()
        player = p
        p.setVideoTextureView(this)
        p.setMediaItem(MediaItem.fromUri(if (s.startsWith("/")) Uri.fromFile(File(s)) else Uri.parse(s)))
        p.repeatMode = Player.REPEAT_MODE_OFF
        p.addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (isPlaying) {
                    main.removeCallbacks(tick)
                    main.post(tick)
                }
            }
        })
        p.prepare()
        p.seekTo(if (previewMs >= 0) previewMs else startMs)
        if (wantPlaying) p.play()
    }

    private fun release() {
        main.removeCallbacks(tick)
        player?.let {
            it.clearVideoTextureView(this)
            it.release()
        }
        player = null
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (player == null) create()
    }

    override fun onDetachedFromWindow() {
        release()
        super.onDetachedFromWindow()
    }

    private fun emit(positionMs: Long, playing: Boolean) {
        val surface = UIManagerHelper.getSurfaceId(this)
        UIManagerHelper.getEventDispatcherForReactTag(rc as ReactContext, id)
            ?.dispatchEvent(ProgressEvent(surface, id, positionMs, playing))
    }

    private class ProgressEvent(surfaceId: Int, viewId: Int, private val positionMs: Long, private val playing: Boolean) :
        Event<ProgressEvent>(surfaceId, viewId) {
        override fun getEventName() = EVENT
        override fun getEventData(): WritableMap = Arguments.createMap().apply {
            putDouble("positionMs", positionMs.toDouble())
            putBoolean("playing", playing)
        }
    }

    companion object {
        const val EVENT = "topProgress"
    }
}

class TrimPlayerManager : SimpleViewManager<TrimPlayerView>() {
    override fun getName() = "TrimPlayer"

    override fun createViewInstance(ctx: ThemedReactContext) = TrimPlayerView(ctx)

    override fun onDropViewInstance(view: TrimPlayerView) {
        view.setSrc(null)
        super.onDropViewInstance(view)
    }

    @ReactProp(name = "src")
    fun setSrc(view: TrimPlayerView, src: String?) = view.setSrc(src)

    @ReactProp(name = "startMs", defaultDouble = 0.0)
    fun setStart(view: TrimPlayerView, v: Double) = view.setStart(v.toLong())

    @ReactProp(name = "endMs", defaultDouble = 0.0)
    fun setEnd(view: TrimPlayerView, v: Double) = view.setEnd(v.toLong())

    @ReactProp(name = "previewMs", defaultDouble = -1.0)
    fun setPreviewMs(view: TrimPlayerView, v: Double) = view.setPreviewMs(v.toLong())

    @ReactProp(name = "previewExact", defaultBoolean = true)
    fun setPreviewExact(view: TrimPlayerView, v: Boolean) = view.setPreviewExact(v)

    @ReactProp(name = "playing", defaultBoolean = false)
    fun setPlaying(view: TrimPlayerView, v: Boolean) = view.setPlaying(v)

    override fun getExportedCustomDirectEventTypeConstants(): Map<String, Any> =
        mapOf(TrimPlayerView.EVENT to mapOf("registrationName" to "onProgress"))

}
