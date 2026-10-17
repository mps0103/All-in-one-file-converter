package com.mps.allinone

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager

/**
 * The home-screen icon follows the app's own Dark / Light / System theme.
 *
 * Android has no light and dark versions of one launcher icon, so the manifest
 * carries the launcher entry twice, as two aliases of MainActivity with different
 * icons, and exactly one is enabled. LauncherDark (the dark-blue icon) is the one
 * enabled at install. JS works out which one the theme wants and calls set() as
 * the app goes to the background, so the change happens while the user is
 * looking at the home screen rather than at the app, and a launcher's refresh
 * never interrupts anything.
 */
object LauncherIcon {

    private const val DARK = "com.mps.allinone.LauncherDark"
    private const val LIGHT = "com.mps.allinone.LauncherLight"

    /** Enables the dark or light entry and disables the other; nothing when it already is. */
    fun set(context: Context, dark: Boolean) {
        val pm = context.packageManager
        val want = ComponentName(context.packageName, if (dark) DARK else LIGHT)
        val other = ComponentName(context.packageName, if (dark) LIGHT else DARK)
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
