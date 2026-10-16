package com.mps.allinone

import android.app.Application
import android.content.ComponentCallbacks2
import com.facebook.common.internal.Supplier
import com.facebook.drawee.backends.pipeline.Fresco
import com.facebook.imagepipeline.cache.MemoryCacheParams
import com.facebook.imagepipeline.core.DownsampleMode
import com.facebook.imagepipeline.core.ImagePipelineConfig
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.load
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.defaults.DefaultReactNativeHost
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.shell.MainPackageConfig
import com.facebook.react.soloader.OpenSourceMergedSoMapping
import com.facebook.soloader.SoLoader
import java.util.concurrent.TimeUnit

class MainApplication : Application(), ReactApplication {

    override val reactNativeHost: ReactNativeHost =
        object : DefaultReactNativeHost(this) {
            override fun getPackages(): List<ReactPackage> =
                PackageList(this@MainApplication, MainPackageConfig(imagePipelineConfig())).packages.apply {
                    add(FileBridgePackage())
                }

            override fun getJSMainModuleName(): String = "index"

            override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

            override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
            override val isHermesEnabled: Boolean = BuildConfig.IS_HERMES_ENABLED
        }

    /**
     * React Native's own image setup, with a smaller picture cache. Fresco's default
     * keeps decoded pictures up to a quarter of the heap limit (64 MB here), and the
     * viewer's pages filled it as they scrolled past. Every picture this app shows is
     * a local file, so one that has left the cache comes back from disk in a moment.
     * (The default's OkHttp fetcher and cookie forwarding are for web images, which
     * the app never loads.)
     */
    private fun imagePipelineConfig(): ImagePipelineConfig =
        ImagePipelineConfig.newBuilder(this)
            .setDownsampleMode(DownsampleMode.AUTO)
            .setBitmapMemoryCacheParamsSupplier(object : Supplier<MemoryCacheParams> {
                override fun get() = MemoryCacheParams(
                    BITMAP_CACHE_BYTES,
                    BITMAP_CACHE_ENTRIES,
                    BITMAP_CACHE_BYTES / 2,
                    BITMAP_CACHE_ENTRIES / 2,
                    Int.MAX_VALUE,
                    TimeUnit.MINUTES.toMillis(5),
                )
            })
            .build()

    override val reactHost: ReactHost
        get() = getDefaultReactHost(applicationContext, reactNativeHost)

    override fun onCreate() {
        super.onCreate()
        SoLoader.init(this, OpenSourceMergedSoMapping)
        if (BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) load()
    }

    /**
     * The app's screens are out of sight (UI_HIDDEN) or Android is short of memory.
     * Pictures are what this app holds most of — viewer pages, previews — and every
     * one can be read back from disk, so Fresco's in-memory caches are emptied and
     * JS is told, which lets go of the pictures it has on screen until the app is
     * back. Play's memory vitals weigh what an app keeps while in the background.
     */
    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        if (level < ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN) return
        try {
            if (Fresco.hasBeenInitialized()) Fresco.getImagePipeline().clearMemoryCaches()
        } catch (_: Exception) {
        }
        try {
            if (!reactNativeHost.hasInstance()) return
            val context = reactNativeHost.reactInstanceManager.currentReactContext ?: return
            if (!context.hasActiveReactInstance()) return
            context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("memoryTrim", Arguments.createMap().apply { putInt("level", level) })
        } catch (_: Exception) {
        }
    }
}

/** Decoded pictures kept in memory, in use or not: about eight viewer pages. */
private const val BITMAP_CACHE_BYTES = 32 * 1024 * 1024
private const val BITMAP_CACHE_ENTRIES = 64
