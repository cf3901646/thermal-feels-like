package com.morandi.thermalmeter;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        
        final WebView webView = bridge.getWebView();
        
        // 诊断版逻辑：每隔 1s 注入一次，持续 5 次，确保 JS 捕获成功
        for (int i = 1; i <= 5; i++) {
            webView.postDelayed(new Runnable() {
                @Override
                public void run() {
                    int resourceId = getResources().getIdentifier("status_bar_height", "dimen", "android");
                    if (resourceId > 0) {
                        int heightPx = getResources().getDimensionPixelSize(resourceId);
                        float density = getResources().getDisplayMetrics().density;
                        float logicalHeight = heightPx / density;
                        
                        // 注入调试日志和变量
                        webView.evaluateJavascript("window.NATIVE_SAFE_TOP = " + logicalHeight + "; console.log('DEBUG: Native Height Injected: " + logicalHeight + "');", null);
                    }
                }
            }, 500 + (i * 1000));
        }
    }
}
