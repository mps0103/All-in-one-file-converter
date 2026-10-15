/*
 * Hand-written stand-in for the config.h that LAME's ./configure would generate.
 * Only the encoder library is built (no frontend, no mpglib decoder), and only
 * for Android's Bionic libc, so the answers are fixed.
 */
#ifndef LAME_ANDROID_CONFIG_H
#define LAME_ANDROID_CONFIG_H

#define STDC_HEADERS 1
#define HAVE_ERRNO_H 1
#define HAVE_FCNTL_H 1
#define HAVE_LIMITS_H 1
#define HAVE_STDINT_H 1
#define HAVE_INTTYPES_H 1
#define HAVE_STRING_H 1
#define HAVE_STDLIB_H 1
#define HAVE_UNISTD_H 1

#define PACKAGE "lame"
#define VERSION "3.100"

typedef float ieee754_float32_t;
typedef double ieee754_float64_t;
typedef long double ieee854_float80_t;

#endif
