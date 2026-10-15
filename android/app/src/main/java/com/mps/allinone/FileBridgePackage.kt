package com.mps.allinone

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import com.mps.allinone.pdf.PdfCompressModule
import com.mps.allinone.pdf.PdfCryptoModule
import com.mps.allinone.pdf.PdfExtractModule
import com.mps.allinone.pdf.PdfOcrModule
import com.mps.allinone.pdf.PdfRenderModule

/** Every native module of the app, registered in one place. */
class FileBridgePackage : ReactPackage {
    override fun createNativeModules(ctx: ReactApplicationContext): List<NativeModule> =
        listOf(
            FileBridgeModule(ctx),
            ArchiveModule(ctx),
            BillingModule(ctx),
            WorkbenchModule(ctx),
            ImageToolsModule(ctx),
            MediaToolsModule(ctx),
            AudioPreviewModule(ctx),
            PdfCompressModule(ctx),
            PdfCryptoModule(ctx),
            PdfExtractModule(ctx),
            PdfOcrModule(ctx),
            PdfRenderModule(ctx),
        )

    override fun createViewManagers(ctx: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}
