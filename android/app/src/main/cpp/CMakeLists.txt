# Two native libraries are built here:
#  - libmp3lame.so: the LAME 3.100 MP3 encoder (LGPL, see lame/COPYING) plus the
#    small JNI bridge in mp3_encoder.c. Built as its own shared library so the LGPL
#    code stays a separately replaceable component.
#  - libappmodules.so: React Native's own library for the New Architecture. Gradle
#    builds it from React Native's default CMakeLists.txt only when the app has no
#    CMakeLists.txt of its own, so this one has to include it. The project must be
#    called appmodules: React Native names the library after the project.
cmake_minimum_required(VERSION 3.22.1)
project(appmodules C CXX)

file(GLOB LAME_SOURCES ${CMAKE_CURRENT_SOURCE_DIR}/lame/libmp3lame/*.c)

add_library(mp3lame SHARED
        ${LAME_SOURCES}
        ${CMAKE_CURRENT_SOURCE_DIR}/mp3_encoder.c)

target_include_directories(mp3lame PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/lame
        ${CMAKE_CURRENT_SOURCE_DIR}/lame/include
        ${CMAKE_CURRENT_SOURCE_DIR}/lame/libmp3lame)

target_compile_definitions(mp3lame PRIVATE HAVE_CONFIG_H NDEBUG)

# LAME's own sources are kept exactly as released, warnings and all.
set_source_files_properties(${LAME_SOURCES} PROPERTIES COMPILE_OPTIONS "-w")
target_compile_options(mp3lame PRIVATE -O2 -fvisibility=hidden)

# Google Play requires 16 KB page alignment for native libraries.
target_link_options(mp3lame PRIVATE "-Wl,-z,max-page-size=16384")

target_link_libraries(mp3lame m)

# React Native's app setup, after LAME on purpose: it turns on link-time
# optimisation for every target defined after it, and LAME stays built as before.
include(${REACT_ANDROID_DIR}/cmake-utils/ReactNative-application.cmake)
