/*
 * JNI bridge to the LAME MP3 encoder, used by MediaToolsModule's Mp3Sink.
 *
 * One encoder per handle: init() returns it, encode() and flush() return the
 * MP3 bytes produced so far, close() frees it. PCM is 16-bit interleaved.
 */
#include <jni.h>
#include <stdlib.h>
#include "lame.h"

/* LAME's documented worst case for one call: 1.25 * samples + 7200 bytes. */
static jint mp3_buffer_size(jint frames) {
    return (jint) (1.25 * frames) + 7200;
}

JNIEXPORT jlong JNICALL
Java_com_mps_allinone_Mp3Encoder_init(JNIEnv *env, jclass cls, jint sampleRate, jint channels,
                                      jint bitrateKbps, jint quality) {
    lame_global_flags *gf = lame_init();
    if (gf == NULL) return 0;
    lame_set_in_samplerate(gf, sampleRate);
    lame_set_num_channels(gf, channels);
    lame_set_mode(gf, channels == 1 ? MONO : JOINT_STEREO);
    lame_set_VBR(gf, vbr_off);
    lame_set_brate(gf, bitrateKbps);
    lame_set_quality(gf, quality);
    lame_set_write_id3tag_automatic(gf, 0);
    if (lame_init_params(gf) < 0) {
        lame_close(gf);
        return 0;
    }
    return (jlong) (intptr_t) gf;
}

JNIEXPORT jbyteArray JNICALL
Java_com_mps_allinone_Mp3Encoder_encode(JNIEnv *env, jclass cls, jlong handle, jshortArray pcm,
                                        jint frames) {
    lame_global_flags *gf = (lame_global_flags *) (intptr_t) handle;
    if (gf == NULL || frames <= 0) return (*env)->NewByteArray(env, 0);

    jint cap = mp3_buffer_size(frames);
    unsigned char *out = (unsigned char *) malloc((size_t) cap);
    if (out == NULL) return NULL;

    jshort *samples = (*env)->GetShortArrayElements(env, pcm, NULL);
    int n = lame_get_num_channels(gf) == 1
            ? lame_encode_buffer(gf, samples, samples, frames, out, cap)
            : lame_encode_buffer_interleaved(gf, samples, frames, out, cap);
    (*env)->ReleaseShortArrayElements(env, pcm, samples, JNI_ABORT);

    jbyteArray result = (*env)->NewByteArray(env, n > 0 ? n : 0);
    if (n > 0) (*env)->SetByteArrayRegion(env, result, 0, n, (const jbyte *) out);
    free(out);
    return result;
}

JNIEXPORT jbyteArray JNICALL
Java_com_mps_allinone_Mp3Encoder_flush(JNIEnv *env, jclass cls, jlong handle) {
    lame_global_flags *gf = (lame_global_flags *) (intptr_t) handle;
    if (gf == NULL) return (*env)->NewByteArray(env, 0);
    unsigned char out[7200];
    int n = lame_encode_flush(gf, out, sizeof(out));
    jbyteArray result = (*env)->NewByteArray(env, n > 0 ? n : 0);
    if (n > 0) (*env)->SetByteArrayRegion(env, result, 0, n, (const jbyte *) out);
    return result;
}

JNIEXPORT void JNICALL
Java_com_mps_allinone_Mp3Encoder_close(JNIEnv *env, jclass cls, jlong handle) {
    lame_global_flags *gf = (lame_global_flags *) (intptr_t) handle;
    if (gf != NULL) lame_close(gf);
}
