package com.experimental.camera

import android.Manifest
import android.content.ContentValues
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebChromeClient
import android.webkit.ValueCallback
import android.webkit.WebView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat

class MainActivity : ComponentActivity() {

    private lateinit var web: WebView
    private var pendingPermissionRequest: PermissionRequest? = null
    private var filePathCallback: ValueCallback<Array<android.net.Uri>>? = null

    // assets/www served over https://appassets.androidplatform.net — secure
    // context: ES modules, fetch, getUserMedia all work (file:// CORS-blocks
    // module scripts and was the white-screen root cause).
    private val assetLoader = WebViewAssetLoader.Builder()
        .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
        .build()

    // Runtime CAMERA/MIC permissions -> then answer the WebView's PermissionRequest
    private val mediaPermissions =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { _ ->
            pendingPermissionRequest?.let { req ->
                val camOk = checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
                val micOk = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
                val wantsVideo = req.resources.any { it == PermissionRequest.RESOURCE_VIDEO_CAPTURE }
                val wantsAudio = req.resources.any { it == PermissionRequest.RESOURCE_AUDIO_CAPTURE }
                val allowed = req.resources.filter {
                    (it == PermissionRequest.RESOURCE_VIDEO_CAPTURE && camOk) ||
                    (it == PermissionRequest.RESOURCE_AUDIO_CAPTURE && micOk)
                }.toTypedArray()
                if (allowed.isNotEmpty() && (!wantsVideo || camOk) && (!wantsAudio || micOk))
                    req.grant(allowed) else req.deny()
                pendingPermissionRequest = null
            }
        }

    // <input type="file"> bridge (file-input gotcha: dead without this)
    private val filePicker =
        registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            filePathCallback?.onReceiveValue(if (uri != null) arrayOf(uri) else null)
            filePathCallback = null
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            hide(WindowInsetsCompat.Type.systemBars())
        }

        web = WebView(this)
        web.setBackgroundColor(Color.BLACK)
        setContentView(web)

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowContentAccess = true
        }

        web.addJavascriptInterface(ExpCamBridge(), "Android")

        web.webViewClient = object : WebViewClientCompat() {
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean = false
            // WebViewAssetLoader intercept gotcha: without this the appassets
            // URL hits the real network -> ERR_CACHE_MISS white screen.
            override fun shouldInterceptRequest(
                view: WebView, request: WebResourceRequest
            ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                val wantsCamera = request.resources.any { it == PermissionRequest.RESOURCE_VIDEO_CAPTURE }
                val wantsMic = request.resources.any { it == PermissionRequest.RESOURCE_AUDIO_CAPTURE }
                val needed = mutableListOf<String>()
                if (wantsCamera && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED)
                    needed.add(Manifest.permission.CAMERA)
                if (wantsMic && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
                    needed.add(Manifest.permission.RECORD_AUDIO)
                if (needed.isEmpty()) request.grant(request.resources)
                else if (wantsCamera || wantsMic) {
                    pendingPermissionRequest = request
                    mediaPermissions.launch(needed.toTypedArray())
                } else request.deny()
            }

            override fun onShowFileChooser(
                webView: WebView,
                callback: ValueCallback<Array<android.net.Uri>>,
                params: FileChooserParams
            ): Boolean {
                filePathCallback?.onReceiveValue(null)
                filePathCallback = callback
                val accepts = params.acceptTypes.filter { it.isNotEmpty() }.toTypedArray()
                filePicker.launch(if (accepts.isNotEmpty()) accepts else arrayOf("*/*"))
                return true
            }

            // JS console -> logcat (diagnostics: white screens, getUserMedia errors)
            override fun onConsoleMessage(message: ConsoleMessage?): Boolean {
                message?.let {
                    Log.d("ExpCamWeb", "[${'$'}{it.messageLevel()}] ${'$'}{it.message()} (${'$'}{it.sourceId()}:${'$'}{it.lineNumber()})")
                }
                return true
            }
        }

        web.loadUrl("https://appassets.androidplatform.net/assets/www/index.html")
    }

    /** JS bridge: window.Android.saveVideo -> MediaStore (gallery-visible) */
    inner class ExpCamBridge {
        @JavascriptInterface
        fun saveVideo(base64Data: String, filename: String, mime: String): Boolean =
            saveToStore(base64Data, filename, mime, Environment.DIRECTORY_MOVIES)

        @JavascriptInterface
        fun saveImage(base64Data: String, filename: String): Boolean =
            saveToStore(base64Data, filename, "image/png", Environment.DIRECTORY_PICTURES)
    }

    private fun saveToStore(base64Data: String, filename: String, mime: String, dir: String): Boolean {
        return try {
            val bytes = Base64.decode(base64Data, Base64.DEFAULT)
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, filename)
                put(MediaStore.MediaColumns.MIME_TYPE, mime)
                put(MediaStore.MediaColumns.RELATIVE_PATH, "$dir/ExperimentalCamera")
            }
            val collection = if (dir == Environment.DIRECTORY_MOVIES)
                MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            else
                MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            val uri = contentResolver.insert(collection, values) ?: return false
            contentResolver.openOutputStream(uri)?.use { it.write(bytes) } ?: return false
            runOnUiThread { Toast.makeText(this, "Saved: $filename", Toast.LENGTH_SHORT).show() }
            true
        } catch (e: Exception) {
            e.printStackTrace()
            false
        }
    }

    override fun onDestroy() {
        filePathCallback?.onReceiveValue(null)
        if (::web.isInitialized) web.destroy()
        super.onDestroy()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (::web.isInitialized && web.canGoBack()) web.goBack() else super.onBackPressed()
    }
}
