package com.mps.allinone

import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Google Play billing, spoken to directly.
 *
 * This replaced react-native-iap. Play now requires Billing Library 8, and that
 * library was still pinned to 7 with no upgrade that did not also mean turning on
 * the New Architecture and adopting Nitro modules — a large change to the whole
 * app for the sake of one screen. The app only ever needed the handful of calls
 * below, so it makes them itself.
 *
 * Everything here is deliberately thin: it reports what Play said and never decides
 * what the user is entitled to. That decision lives in services/billing.ts, so there
 * is one place to read it.
 */
class BillingModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {

    override fun getName() = "BillingBridge"

    private var client: BillingClient? = null

    /**
     * Product details from the last getPlans call. launchBillingFlow needs the
     * ProductDetails object itself rather than an id, and it cannot be rebuilt on
     * this side, so what Play handed back is kept until it is used.
     */
    private val details = mutableMapOf<String, ProductDetails>()

    // Held so a connection attempt is answered exactly once. Play calls the setup
    // listener again after every automatic reconnection, and resolving a promise
    // twice is a hard error in React Native.
    private var connecting: Promise? = null

    private fun emit(event: String, body: WritableMap) {
        ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(event, body)
    }

    private fun purchaseMap(p: Purchase): WritableMap = Arguments.createMap().apply {
        putString("productId", p.products.firstOrNull() ?: "")
        putString("purchaseToken", p.purchaseToken)
        putBoolean("acknowledged", p.isAcknowledged)
        // A pending purchase — cash at a shop, or a parent to approve — has not been
        // paid for yet and must not unlock anything.
        putBoolean("purchased", p.purchaseState == Purchase.PurchaseState.PURCHASED)
        putDouble("purchaseTime", p.purchaseTime.toDouble())
    }

    /**
     * Play refunds any purchase that is not acknowledged within three days, so this
     * runs on every purchase and again on every restore, in case the app was killed
     * between the payment and the acknowledgement.
     */
    private fun acknowledge(p: Purchase) {
        if (p.purchaseState != Purchase.PurchaseState.PURCHASED || p.isAcknowledged) return
        val params = AcknowledgePurchaseParams.newBuilder().setPurchaseToken(p.purchaseToken).build()
        client?.acknowledgePurchase(params) { /* a failure is picked up by the next restore */ }
    }

    private val purchasesUpdated = PurchasesUpdatedListener { result, purchases ->
        when {
            result.responseCode == BillingClient.BillingResponseCode.OK && purchases != null ->
                purchases.forEach {
                    acknowledge(it)
                    emit("billingPurchase", purchaseMap(it))
                }

            result.responseCode == BillingClient.BillingResponseCode.USER_CANCELED ->
                emit(
                    "billingError",
                    Arguments.createMap().apply {
                        putString("code", "cancelled")
                        putString("message", "The purchase was cancelled.")
                    },
                )

            else ->
                emit(
                    "billingError",
                    Arguments.createMap().apply {
                        putString("code", result.responseCode.toString())
                        putString("message", result.debugMessage.ifBlank { "Play could not complete the purchase." })
                    },
                )
        }
    }

    /** Opens the connection to Play. Safe to call again; a live client is reused. */
    @ReactMethod
    fun start(promise: Promise) {
        if (client?.isReady == true) return promise.resolve(true)

        val built = BillingClient.newBuilder(ctx)
            .setListener(purchasesUpdated)
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .enableAutoServiceReconnection()
            .build()
        client = built
        connecting = promise

        built.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                val waiting = connecting ?: return
                connecting = null
                if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                    waiting.resolve(true)
                } else {
                    // No Play Store, an emulator, or a device without Play services.
                    waiting.reject("unavailable", result.debugMessage.ifBlank { "Play billing is unavailable." })
                }
            }

            override fun onBillingServiceDisconnected() {
                // enableAutoServiceReconnection handles the retry. Nothing to do here.
            }
        })
    }

    @ReactMethod
    fun stop(promise: Promise) {
        client?.endConnection()
        client = null
        details.clear()
        promise.resolve(true)
    }

    private fun describe(d: ProductDetails): WritableMap = Arguments.createMap().apply {
        putString("productId", d.productId)
        putString("title", d.title)
        putString("type", d.productType)
        putString("price", d.oneTimePurchaseOfferDetails?.formattedPrice ?: "")
        // A subscription is priced per base plan rather than per product, so every
        // offer is handed over and services/billing.ts picks the one it wants.
        val offers = Arguments.createArray()
        d.subscriptionOfferDetails?.forEach { offer ->
            offers.pushMap(
                Arguments.createMap().apply {
                    putString("basePlanId", offer.basePlanId)
                    putString("offerToken", offer.offerToken)
                    putString("price", offer.pricingPhases.pricingPhaseList.firstOrNull()?.formattedPrice ?: "")
                },
            )
        }
        putArray("offers", offers)
    }

    private fun queryType(type: String, ids: List<String>, done: (List<ProductDetails>) -> Unit) {
        val live = client
        if (live == null || ids.isEmpty()) return done(emptyList())
        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(
                ids.map {
                    QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(it)
                        .setProductType(type)
                        .build()
                },
            )
            .build()
        live.queryProductDetailsAsync(params) { result, found ->
            if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                done(emptyList())
            } else {
                done(found.productDetailsList)
            }
        }
    }

    /**
     * @param subIds     subscription product ids
     * @param productIds one-time product ids
     *
     * An id Play does not recognise is simply absent from the result rather than an
     * error, so a half-configured console still shows the plans that do exist.
     */
    @ReactMethod
    fun getPlans(subIds: ReadableArray, productIds: ReadableArray, promise: Promise) {
        val subs = (0 until subIds.size()).mapNotNull { subIds.getString(it) }
        val once = (0 until productIds.size()).mapNotNull { productIds.getString(it) }

        queryType(BillingClient.ProductType.SUBS, subs) { subDetails ->
            queryType(BillingClient.ProductType.INAPP, once) { inappDetails ->
                val all = subDetails + inappDetails
                details.clear()
                all.forEach { details[it.productId] = it }
                val out = Arguments.createArray()
                all.forEach { out.pushMap(describe(it)) }
                promise.resolve(out)
            }
        }
    }

    /**
     * Opens Play's payment sheet. It resolves as soon as the sheet is up — what the
     * user then does arrives on the billingPurchase or billingError event, because
     * Play reports the outcome through the listener and not through this call.
     *
     * @param offerToken the chosen base plan for a subscription; empty for a one-time product.
     */
    @ReactMethod
    fun purchase(productId: String, offerToken: String, promise: Promise) {
        val live = client ?: return promise.reject("no_connection", "Billing is not connected.")
        val activity = reactApplicationContext.currentActivity ?: return promise.reject("no_activity", "App is not in the foreground.")
        val product = details[productId]
            ?: return promise.reject("no_product", "That plan is not available right now.")

        val selected = BillingFlowParams.ProductDetailsParams.newBuilder()
            .setProductDetails(product)
            .apply { if (offerToken.isNotEmpty()) setOfferToken(offerToken) }
            .build()

        val result = live.launchBillingFlow(
            activity,
            BillingFlowParams.newBuilder().setProductDetailsParamsList(listOf(selected)).build(),
        )
        if (result.responseCode == BillingClient.BillingResponseCode.OK) {
            promise.resolve(true)
        } else {
            promise.reject(
                result.responseCode.toString(),
                result.debugMessage.ifBlank { "Play could not open the payment sheet." },
            )
        }
    }

    /**
     * Everything the account currently owns. Called on every launch, so a reinstall
     * or a new phone keeps what was paid for, and so anything left unacknowledged is
     * acknowledged before Play's three days run out.
     */
    @ReactMethod
    fun restore(promise: Promise) {
        val live = client ?: return promise.reject("no_connection", "Billing is not connected.")
        val owned = mutableListOf<Purchase>()

        val inapp = QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build()
        val subs = QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.SUBS).build()

        live.queryPurchasesAsync(subs) { subResult, subPurchases ->
            if (subResult.responseCode == BillingClient.BillingResponseCode.OK) owned += subPurchases
            live.queryPurchasesAsync(inapp) { inResult, inPurchases ->
                if (inResult.responseCode == BillingClient.BillingResponseCode.OK) owned += inPurchases
                owned.forEach { acknowledge(it) }
                val out = Arguments.createArray()
                owned.forEach { out.pushMap(purchaseMap(it)) }
                promise.resolve(out)
            }
        }
    }
}
