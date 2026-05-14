package com.morandi.thermalmeter;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        // 1. 开启 Edge-to-Edge 模式
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        
        // 2. 终极方案：原生层直接测量状态栏高度并注入到 JS
        final WebView webView = bridge.getWebView();
        webView.postDelayed(new Runnable() {
            @Override
            public void run() {
                int resourceId = getResources().getIdentifier("status_bar_height", "dimen", "android");
                if (resourceId > 0) {
                    int heightPx = getResources().getDimensionPixelSize(resourceId);
                    float density = getResources().getDisplayMetrics().density;
                    float logicalHeight = heightPx / density;
                    
                    // 强行注入全局变量到 JS 环境
                    webView.evaluateJavascript("window.NATIVE_SAFE_TOP = " + logicalHeight + ";", null);
                }
            }
        }, 500); // 延迟 500ms 确保 WebView 环境已就绪
    }
}
