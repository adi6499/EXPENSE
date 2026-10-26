package com.adi6499.expenses

import android.Manifest
import android.app.KeyguardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.os.Build
import android.os.CancellationSignal
import android.view.HapticFeedbackConstants
import android.webkit.JavascriptInterface
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File

/**
 * Everything the web app can ask the phone to do. Exposed to JavaScript as `window.Native`.
 * Methods run on a background thread; anything touching the UI hops to the main thread.
 * Async requests take an `id` and answer later through MainActivity.resolve(id, …).
 */
class NativeBridge(private val activity: MainActivity) {

    private val dataFile get() = File(activity.filesDir, "expenses.json")
    private val backupFile get() = File(activity.filesDir, "expenses.json.bak")
    private val lock = Any()

    @JavascriptInterface
    fun ready() {
        activity.pageReady = true
        activity.callJs("window.__setInsets && window.__setInsets(${activity.insetTop}, ${activity.insetBottom})")
    }

    @JavascriptInterface
    fun consumeLaunchAction(): String {
        val action = activity.pendingAction ?: ""
        activity.pendingAction = null
        return action
    }

    @JavascriptInterface
    fun getInsets(): String =
        JSONObject().put("top", activity.insetTop.toDouble()).put("bottom", activity.insetBottom.toDouble()).toString()

    @JavascriptInterface
    fun appVersion(): String = BuildConfig.VERSION_NAME

    // ---- Data: one JSON file in the app's private storage, with the previous version kept as .bak

    @JavascriptInterface
    fun loadData(): String = synchronized(lock) {
        for (file in listOf(dataFile, backupFile)) {
            try {
                if (file.exists()) {
                    val text = file.readText(Charsets.UTF_8)
                    if (text.isNotBlank()) return text
                }
            } catch (_: Exception) {
            }
        }
        ""
    }

    @JavascriptInterface
    fun saveData(json: String): Boolean = synchronized(lock) {
        try {
            val tmp = File(activity.filesDir, "expenses.json.tmp")
            tmp.writeText(json, Charsets.UTF_8)
            if (dataFile.exists()) {
                backupFile.delete()
                dataFile.renameTo(backupFile)
            }
            if (!tmp.renameTo(dataFile)) {
                tmp.copyTo(dataFile, overwrite = true)
                tmp.delete()
            }
            true
        } catch (_: Exception) {
            false
        }
    }

    // ---- Files

    /** Lets the person pick where to save a file (Downloads, Drive, …). */
    @JavascriptInterface
    fun saveFile(id: String, fileName: String, mimeType: String, content: String) {
        activity.runOnUiThread {
            activity.startFileRequest(id, content)
            val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = mimeType
                putExtra(Intent.EXTRA_TITLE, fileName)
            }
            try {
                activity.createDocumentLauncher.launch(intent)
            } catch (e: Exception) {
                activity.resolve(id, JSONObject().put("ok", false).put("error", "No app on this phone can save files"))
            }
        }
    }

    /** Opens the Android share sheet (WhatsApp, Gmail, Drive, …) with the file attached. */
    @JavascriptInterface
    fun shareFile(id: String, fileName: String, mimeType: String, content: String) {
        try {
            val dir = File(activity.cacheDir, "exports").apply { mkdirs() }
            val file = File(dir, fileName.replace(Regex("[^A-Za-z0-9._ -]"), "_"))
            file.writeText(content, Charsets.UTF_8)
            val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.files", file)
            val send = Intent(Intent.ACTION_SEND).apply {
                type = mimeType
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_SUBJECT, fileName)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.runOnUiThread {
                try {
                    activity.startActivity(Intent.createChooser(send, fileName))
                    activity.resolve(id, JSONObject().put("ok", true))
                } catch (e: Exception) {
                    activity.resolve(id, JSONObject().put("ok", false).put("error", "No app to share with"))
                }
            }
        } catch (e: Exception) {
            activity.resolve(id, JSONObject().put("ok", false).put("error", e.message ?: "Could not share the file"))
        }
    }

    /** Lets the person pick a CSV or backup file; answers with its text. */
    @JavascriptInterface
    fun openFile(id: String) {
        activity.runOnUiThread {
            activity.startFileRequest(id)
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "*/*"
                putExtra(
                    Intent.EXTRA_MIME_TYPES,
                    arrayOf("text/*", "application/json", "application/octet-stream", "application/vnd.ms-excel")
                )
            }
            try {
                activity.openDocumentLauncher.launch(intent)
            } catch (e: Exception) {
                activity.resolve(id, JSONObject().put("ok", false).put("error", "No file picker on this phone"))
            }
        }
    }

    // ---- App lock

    /** True when the phone has a screen lock (PIN, pattern, password or fingerprint) set up. */
    @JavascriptInterface
    fun canLock(): Boolean {
        val keyguard = activity.getSystemService(KeyguardManager::class.java)
        return keyguard?.isDeviceSecure == true
    }

    @JavascriptInterface
    fun authenticate(id: String, title: String) {
        activity.runOnUiThread {
            val done = { ok: Boolean, error: String? ->
                activity.resolve(id, JSONObject().put("ok", ok).put("error", error ?: ""))
            }
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    val builder = BiometricPrompt.Builder(activity)
                        .setTitle(title)
                        .setSubtitle("Use your fingerprint, face or screen lock")
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        builder.setAllowedAuthenticators(
                            BiometricManager.Authenticators.BIOMETRIC_WEAK or BiometricManager.Authenticators.DEVICE_CREDENTIAL
                        )
                    } else {
                        @Suppress("DEPRECATION")
                        builder.setDeviceCredentialAllowed(true)
                    }
                    builder.build().authenticate(
                        CancellationSignal(),
                        activity.mainExecutor,
                        object : BiometricPrompt.AuthenticationCallback() {
                            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult?) = done(true, null)
                            override fun onAuthenticationError(errorCode: Int, errString: CharSequence?) =
                                done(false, errString?.toString())
                        }
                    )
                } else {
                    val keyguard = activity.getSystemService(KeyguardManager::class.java)
                    @Suppress("DEPRECATION")
                    val intent = keyguard?.createConfirmDeviceCredentialIntent(title, null)
                    if (intent == null) {
                        done(true, null) // no screen lock set: nothing to check against
                    } else {
                        activity.startFileRequest(id)
                        activity.confirmCredentialLauncher.launch(intent)
                    }
                }
            } catch (e: Exception) {
                done(false, e.message)
            }
        }
    }

    // ---- Feel

    @JavascriptInterface
    fun haptic(kind: String) {
        val constant = when (kind) {
            "success" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY
            "warning", "error" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) HapticFeedbackConstants.REJECT else HapticFeedbackConstants.LONG_PRESS
            "medium" -> HapticFeedbackConstants.VIRTUAL_KEY
            "selection" -> HapticFeedbackConstants.CLOCK_TICK
            else -> HapticFeedbackConstants.KEYBOARD_TAP
        }
        activity.runOnUiThread { activity.webView.performHapticFeedback(constant) }
    }

    @JavascriptInterface
    fun isSystemDark(): Boolean = activity.isSystemDark()

    @JavascriptInterface
    fun setAppearance(dark: Boolean) {
        activity.runOnUiThread { activity.applySystemBars(dark) }
    }

    // ---- Daily reminder

    @JavascriptInterface
    fun setReminder(id: String, enabled: Boolean, hour: Int, minute: Int) {
        Reminders.save(activity, enabled, hour, minute)
        Reminders.schedule(activity)
        if (!enabled || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        ) {
            activity.resolve(id, JSONObject().put("ok", true))
            return
        }
        // Android 13+: notifications need permission
        activity.runOnUiThread {
            activity.startFileRequest(id)
            activity.notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}
