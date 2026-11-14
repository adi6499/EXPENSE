package com.adi6499.expenses

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.res.Configuration
import android.database.ContentObserver
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.provider.Telephony
import android.speech.RecognizerIntent
import android.content.ClipData
import androidx.core.content.FileProvider
import java.io.File
import android.view.ViewGroup
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewFeature
import org.json.JSONObject

class MainActivity : ComponentActivity() {

    lateinit var webView: WebView
    private lateinit var container: FrameLayout
    private lateinit var bridge: NativeBridge

    /** True once the web app has called Native.ready(); before that, JS callbacks are dropped. */
    @Volatile var pageReady = false
    /** An action (e.g. "add" from the launcher shortcut or reminder) waiting for the web app to start. */
    @Volatile var pendingAction: String? = null
    /** A bank message shared to the app before the web app had started. */
    @Volatile var pendingSharedText: String? = null

    // System bar sizes in CSS pixels, pushed to the web app as --safe-top / --safe-bottom
    @Volatile var insetTop = 0f
    @Volatile var insetBottom = 0f

    // One file request at a time: the id the web app is waiting on
    private var pendingFileId: String? = null
    private var pendingExportText: String? = null
    private var pendingExportBytes: ByteArray? = null
    private var cameraUri: Uri? = null
    private var cameraFile: File? = null

    val createDocumentLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val id = pendingFileId ?: return@registerForActivityResult
        val text = pendingExportText
        val bytes = pendingExportBytes
        pendingFileId = null
        pendingExportText = null
        pendingExportBytes = null
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null || (text == null && bytes == null)) {
            resolve(id, JSONObject().put("ok", false).put("cancelled", true))
            return@registerForActivityResult
        }
        try {
            val stream = try {
                contentResolver.openOutputStream(uri, "wt")
            } catch (_: Exception) {
                contentResolver.openOutputStream(uri, "w")
            }
            stream?.use { it.write(bytes ?: text!!.toByteArray(Charsets.UTF_8)) } ?: error("Could not open the file")
            resolve(id, JSONObject().put("ok", true))
        } catch (e: Exception) {
            resolve(id, JSONObject().put("ok", false).put("error", e.message ?: "Could not save the file"))
        }
    }

    val openDocumentLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val id = pendingFileId ?: return@registerForActivityResult
        pendingFileId = null
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            resolve(id, JSONObject().put("ok", false).put("cancelled", true))
            return@registerForActivityResult
        }
        try {
            val text = contentResolver.openInputStream(uri)?.use { it.readBytes().toString(Charsets.UTF_8) }
                ?: error("Could not open the file")
            val name = uri.lastPathSegment?.substringAfterLast('/') ?: "file"
            resolve(id, JSONObject().put("ok", true).put("text", text).put("name", name))
        } catch (e: Exception) {
            resolve(id, JSONObject().put("ok", false).put("error", e.message ?: "Could not read the file"))
        }
    }

    val confirmCredentialLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val id = pendingFileId ?: return@registerForActivityResult
        pendingFileId = null
        resolve(id, JSONObject().put("ok", result.resultCode == Activity.RESULT_OK))
    }

    val notificationPermissionLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val id = pendingFileId ?: return@registerForActivityResult
        pendingFileId = null
        resolve(id, JSONObject().put("ok", granted))
    }

    val smsPermissionLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { _ ->
        val id = pendingFileId ?: return@registerForActivityResult
        pendingFileId = null
        val granted = BankSms.isGranted(this)
        // Denied, and Android will not ask again: only the phone's Settings can turn it on now
        val blocked = !granted && !shouldShowRequestPermissionRationale(android.Manifest.permission.READ_SMS)
        resolve(id, JSONObject().put("ok", granted).put("blocked", blocked))
        updateSmsWatch()
    }

    // While the app is open, a new SMS refreshes the list straight away
    private val mainHandler = Handler(Looper.getMainLooper())
    private val smsPing = Runnable { callJs("window.__onSms && window.__onSms()") }
    private var smsWatching = false
    private val smsObserver = object : ContentObserver(mainHandler) {
        override fun onChange(selfChange: Boolean) {
            mainHandler.removeCallbacks(smsPing)
            mainHandler.postDelayed(smsPing, 1500)
        }
    }

    /** Watches the SMS inbox while the app is on screen and reading bank SMS is on. */
    fun updateSmsWatch() {
        val want = inForeground && BankSms.isEnabled(this) && BankSms.isGranted(this)
        if (want == smsWatching) return
        try {
            if (want) contentResolver.registerContentObserver(Telephony.Sms.CONTENT_URI, true, smsObserver)
            else contentResolver.unregisterContentObserver(smsObserver)
            smsWatching = want
        } catch (_: Exception) {
            smsWatching = false
        }
    }

    /** A photo taken with the camera or picked from the gallery, shrunk to a JPEG for the web app. */
    val photoPickerLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val id = pendingFileId ?: return@registerForActivityResult
        pendingFileId = null
        val picked = result.data?.data
        val fromCamera = cameraFile?.takeIf { it.exists() && it.length() > 0 }?.let { cameraUri }
        val uri = if (result.resultCode == Activity.RESULT_OK) picked ?: fromCamera else null
        if (uri == null) {
            resolve(id, JSONObject().put("ok", false).put("cancelled", true))
            return@registerForActivityResult
        }
        Thread {
            val answer = try {
                JSONObject().put("ok", true).put("dataUrl", Photos.loadScaled(this, uri))
            } catch (e: Exception) {
                JSONObject().put("ok", false).put("error", "Couldn't open that picture")
            }
            cameraFile?.delete()
            resolve(id, answer)
        }.start()
    }

    fun pickPhoto(id: String) {
        startFileRequest(id)
        val gallery = Intent(Intent.ACTION_GET_CONTENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE)
        val extras = mutableListOf<Intent>()
        try {
            val file = File(File(cacheDir, "camera").apply { mkdirs() }, "photo.jpg").apply { delete() }
            val uri = FileProvider.getUriForFile(this, "$packageName.files", file)
            cameraFile = file
            cameraUri = uri
            extras += Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                putExtra(MediaStore.EXTRA_OUTPUT, uri)
                clipData = ClipData.newRawUri("", uri)
                addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
        } catch (_: Exception) {
            cameraFile = null
            cameraUri = null
        }
        val chooser = Intent.createChooser(gallery, "Bill photo").apply {
            if (extras.isNotEmpty()) putExtra(Intent.EXTRA_INITIAL_INTENTS, extras.toTypedArray())
        }
        try {
            photoPickerLauncher.launch(chooser)
        } catch (e: Exception) {
            pendingFileId = null
            resolve(id, JSONObject().put("ok", false).put("error", "No camera or gallery app found"))
        }
    }

    /** "Spent 450 on petrol" spoken through the phone's own voice typing. */
    val speechLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val id = pendingFileId ?: return@registerForActivityResult
        pendingFileId = null
        val text = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
        if (result.resultCode != Activity.RESULT_OK || text.isNullOrBlank()) {
            resolve(id, JSONObject().put("ok", false).put("error", ""))
        } else {
            resolve(id, JSONObject().put("ok", true).put("text", text))
        }
    }

    fun speechIntent(): Intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-IN")
        putExtra(RecognizerIntent.EXTRA_PROMPT, "Say the amount and what it was for")
    }

    fun startFileRequest(id: String, exportText: String? = null, exportBytes: ByteArray? = null) {
        // A request that never came back (e.g. the picker was killed) is answered as cancelled
        pendingFileId?.let { resolve(it, JSONObject().put("ok", false).put("cancelled", true)) }
        pendingFileId = id
        pendingExportText = exportText
        pendingExportBytes = exportBytes
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        applySystemBars(isSystemDark())

        container = FrameLayout(this)
        webView = WebView(this)
        container.addView(webView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(container)

        val background = if (isSystemDark()) Color.BLACK else Color.rgb(242, 242, 247)
        webView.setBackgroundColor(background)
        container.setBackgroundColor(background)

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            // Follow the phone's font size a little, but not so much that the layout breaks
            textZoom = (resources.configuration.fontScale * 100).toInt().coerceIn(90, 115)
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(webView.settings, false)
        }
        webView.isVerticalScrollBarEnabled = false
        webView.isHorizontalScrollBarEnabled = false

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .addPathHandler("/photos/", WebViewAssetLoader.InternalStoragePathHandler(this, Photos.dir(this)))
            .build()

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == APP_HOST) return false
                // Links to anything else open in the phone's browser
                try { startActivity(Intent(Intent.ACTION_VIEW, request.url)) } catch (_: Exception) {}
                return true
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                // The web page crashed: start fresh instead of taking the whole app down
                recreate()
                return true
            }
        }
        webView.webChromeClient = WebChromeClient()

        bridge = NativeBridge(this)
        webView.addJavascriptInterface(bridge, "Native")

        ViewCompat.setOnApplyWindowInsetsListener(container) { _, insets ->
            val density = resources.displayMetrics.density
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val imeVisible = insets.isVisible(WindowInsetsCompat.Type.ime())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            // Shrink the page above the keyboard, like adjustResize does without edge-to-edge
            container.setPadding(0, 0, 0, if (imeVisible) ime.bottom else 0)
            insetTop = bars.top / density
            insetBottom = if (imeVisible) 0f else bars.bottom / density
            callJs("window.__setInsets && window.__setInsets($insetTop, $insetBottom)")
            WindowInsetsCompat.CONSUMED
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (!pageReady) {
                    finish()
                    return
                }
                webView.evaluateJavascript("window.__onBack ? window.__onBack() : false") { handled ->
                    if (handled != "true") moveTaskToBack(true)
                }
            }
        })

        readLaunchAction(intent)
        webView.loadUrl("https://$APP_HOST/assets/www/index.html")
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        readLaunchAction(intent)
    }

    private fun readLaunchAction(intent: Intent?) {
        if (intent?.action == Intent.ACTION_SEND) {
            val text = intent.getStringExtra(Intent.EXTRA_TEXT)?.take(2000)
            intent.removeExtra(Intent.EXTRA_TEXT) // not again if the screen is rebuilt
            if (text.isNullOrBlank()) return
            if (pageReady) callJs("window.__onSharedText && window.__onSharedText(${JSONObject.quote(text)})")
            else pendingSharedText = text
            return
        }
        val action = if (intent?.data?.scheme == "expenses") intent.data?.host else intent?.getStringExtra(EXTRA_ACTION)
        if (action.isNullOrBlank()) return
        if (pageReady) {
            callJs("window.__onAction && window.__onAction(${JSONObject.quote(action)})")
        } else {
            pendingAction = action
        }
    }

    override fun onResume() {
        super.onResume()
        inForeground = true
        BankSms.clearNotification(this)
        updateSmsWatch()
        callJs("window.__onResume && window.__onResume()")
    }

    override fun onPause() {
        super.onPause()
        inForeground = false
        updateSmsWatch()
        callJs("window.__onPause && window.__onPause()")
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        callJs("window.__onSystemTheme && window.__onSystemTheme(${isSystemDark()})")
    }

    fun isSystemDark(): Boolean =
        (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

    fun applySystemBars(dark: Boolean) {
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = !dark
            isAppearanceLightNavigationBars = !dark
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.isNavigationBarContrastEnforced = false
        }
        if (::webView.isInitialized) {
            val background = if (dark) Color.BLACK else Color.rgb(242, 242, 247)
            webView.setBackgroundColor(background)
            container.setBackgroundColor(background)
        }
    }

    /** Answers a promise the web app is waiting on (see js/native.js). */
    fun resolve(id: String, payload: JSONObject) {
        callJs("window.__native && window.__native.resolve(${JSONObject.quote(id)}, ${payload})")
    }

    fun callJs(script: String) {
        if (!pageReady || !::webView.isInitialized) return
        runOnUiThread { webView.evaluateJavascript(script, null) }
    }

    override fun onDestroy() {
        if (::webView.isInitialized) {
            container.removeView(webView)
            webView.destroy()
        }
        super.onDestroy()
    }

    companion object {
        const val APP_HOST = "appassets.androidplatform.net"
        const val EXTRA_ACTION = "action"
        /** True while Expenses is on screen (then a new bank SMS needs no notification). */
        @Volatile var inForeground = false
    }
}
