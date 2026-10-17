package com.mps.allinone

import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

    override fun getMainComponentName(): String = "AllInOneFileConverter"

    /** Hands the system splash over to the JS splash without a white flash between them. */
    override fun onCreate(savedInstanceState: Bundle?) {
        setTheme(R.style.AppTheme)
        // Android 15 draws every app edge to edge whether it asks to or not, and the
        // attributes that used to colour the bars — android:statusBarColor and
        // android:navigationBarColor — are deprecated and ignored there. Asking for it
        // here instead gets the same transparent bars on Android 7 through 16, so the
        // app looks the same everywhere rather than only on the newest phones.
        //
        // auto() follows the phone's dark mode; the JS side then sets the status bar
        // icons to match the theme the user picked inside the app.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
        )
        normalise(intent)
        super.onCreate(null)
    }

    override fun onNewIntent(intent: Intent) {
        normalise(intent)
        super.onNewIntent(intent)
    }

    /**
     * "Share to" delivers the file as EXTRA_STREAM, while React Native's Linking
     * only reports intent.data. Copying the stream into data lets the one JS
     * handler serve both "Open with" and "Share to".
     */
    private fun normalise(i: Intent?) {
        if (i?.action != Intent.ACTION_SEND || i.data != null) return
        val stream: Uri? = if (Build.VERSION.SDK_INT >= 33) {
            i.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        } else {
            @Suppress("DEPRECATION")
            i.getParcelableExtra(Intent.EXTRA_STREAM)
        }
        if (stream != null) i.data = stream
    }

    override fun createReactActivityDelegate(): ReactActivityDelegate =
        DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
