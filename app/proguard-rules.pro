# The web UI calls these methods by name through addJavascriptInterface
-keepclassmembers class com.adi6499.expenses.NativeBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
