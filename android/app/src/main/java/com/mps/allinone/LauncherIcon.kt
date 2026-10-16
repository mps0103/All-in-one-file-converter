package com.mps.allinone

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.content.res.Resources

/**
 * The home-screen icon follows the phone's light or dark mode.
 *
 * Android has no light and dark versions of one launcher icon, so the manifest
 * carries the launcher entry twice, as two aliases of MainActivity with different
 * icons, and exactly one is enabled. LauncherDark (the dark-blue icon) is the one
 * enabled at install. This swaps them when the phone's mode no longer matches.
 *
 * It runs as the app leaves the screen, so the change happens while the user is
 * looking at the home screen rather than at the app, and the launcher's refresh
 * never interrupts anything. A mode change while the app is closed shows up the
 * next time the app is opened and left.
 */
object LauncherIcon {

    private const val DARK = "com.mps.allinone.LauncherDark"
    private const val LIGHT = "com.mps.allinone.LauncherLight"

    fun match(context: Context) {
        // The phone's own setting, not this app's: the app can be set to a theme of its own.
        val night = (Resources.getSystem().configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES
        val pm = context.packageManager
        val want = ComponentName(context.packageName, if (night) DARK else LIGHT)
        val other = ComponentName(context.packageName, if (night) LIGHT else DARK)
        if (isEnabled(pm, want) && !isEnabled(pm, other)) return
        // The wanted one first, so the app is never without a launcher entry.
        pm.setComponentEnabledSetting(want, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP)
        pm.setComponentEnabledSetting(other, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP)
    }

    private fun isEnabled(pm: PackageManager, c: ComponentName) =
        when (pm.getComponentEnabledSetting(c)) {
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED -> true
            // Never changed at run time: as the manifest has it, where only the dark one is on.
            PackageManager.COMPONENT_ENABLED_STATE_DEFAULT -> c.className == DARK
            else -> false
        }
}
