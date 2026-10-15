package com.mps.allinone.pdf

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.encryption.AccessPermission
import com.tom_roush.pdfbox.pdmodel.encryption.InvalidPasswordException
import com.tom_roush.pdfbox.pdmodel.encryption.StandardProtectionPolicy
import java.io.File

class PdfCryptoModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    init {
        PDFBoxResourceLoader.init(reactContext.applicationContext)
    }

    override fun getName() = "PdfCrypto"

    private fun clean(path: String) = path.removePrefix("file://")

    @ReactMethod
    fun isEncrypted(srcPath: String, promise: Promise) {
        try {
            PDDocument.load(File(clean(srcPath))).use { doc ->
                promise.resolve(doc.isEncrypted)
            }
        } catch (e: InvalidPasswordException) {
            // Needs a password to even open, so it is certainly encrypted.
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("E_IO", e.message, e)
        }
    }

    @ReactMethod
    fun addPassword(
        srcPath: String,
        destPath: String,
        userPassword: String,
        ownerPassword: String,
        allowPrinting: Boolean,
        allowCopy: Boolean,
        promise: Promise
    ) {
        try {
            PDDocument.load(File(clean(srcPath))).use { doc ->
                val permissions = AccessPermission().apply {
                    setCanPrint(allowPrinting)
                    setCanExtractContent(allowCopy)
                    setCanModify(false)
                    setCanModifyAnnotations(false)
                    setCanFillInForm(false)
                    setCanAssembleDocument(false)
                }

                // 128-bit AES. PDFBox-Android supports up to 256 on API 26+,
                // but 128 keeps older readers working.
                val policy = StandardProtectionPolicy(
                    ownerPassword.ifEmpty { userPassword },
                    userPassword,
                    permissions
                ).apply { encryptionKeyLength = 128 }

                doc.protect(policy)
                doc.save(File(clean(destPath)))
            }
            promise.resolve(destPath)
        } catch (e: Exception) {
            promise.reject("E_IO", e.message, e)
        }
    }

    @ReactMethod
    fun removePassword(
        srcPath: String,
        destPath: String,
        password: String,
        promise: Promise
    ) {
        try {
            PDDocument.load(File(clean(srcPath)), password).use { doc ->
                if (!doc.isEncrypted) {
                    promise.reject("E_NOT_ENCRYPTED", "This file has no password.")
                    return
                }
                doc.isAllSecurityToBeRemoved = true
                doc.save(File(clean(destPath)))
            }
            promise.resolve(destPath)
        } catch (e: InvalidPasswordException) {
            promise.reject("E_WRONG_PASSWORD", "That password did not open the file.", e)
        } catch (e: Exception) {
            promise.reject("E_IO", e.message, e)
        }
    }
}
