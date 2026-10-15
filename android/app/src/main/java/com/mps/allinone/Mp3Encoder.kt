package com.mps.allinone

/**
 * The LAME MP3 encoder in libmp3lame.so (src/main/cpp). One encoder per handle:
 * init() returns it, encode() and flush() return the MP3 bytes produced so far,
 * close() frees it. 0 from init() means the settings were refused.
 */
object Mp3Encoder {
    init {
        System.loadLibrary("mp3lame")
    }

    @JvmStatic external fun init(sampleRate: Int, channels: Int, bitrateKbps: Int, quality: Int): Long

    /** [pcm] holds interleaved 16-bit samples; [frames] samples per channel are read from its start. */
    @JvmStatic external fun encode(handle: Long, pcm: ShortArray, frames: Int): ByteArray

    @JvmStatic external fun flush(handle: Long): ByteArray

    @JvmStatic external fun close(handle: Long)
}
