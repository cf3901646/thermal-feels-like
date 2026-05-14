package com.morandi.thermalmeter;

import android.os.Bundle;
import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 步骤 1: 开启 Edge-to-Edge 沉浸模式
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        // 步骤 2: 强制状态栏图标为深色（灰色），匹配浅色 Morandi 背景
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(true); // true = 深色图标（用于浅色背景）

        // 步骤 2: 监听真实 Insets，在测量完成时立即注入
        View decorView = getWindow().getDecorView();
        ViewCompat.setOnApplyWindowInsetsListener(decorView, (v, insets) -> {
            // 获取状态栏的真实像素高度
            Insets statusBarInsets = insets.getInsets(WindowInsetsCompat.Type.statusBars());
            int statusBarPx = statusBarInsets.top;

            if (statusBarPx > 0) {
                float density = getResources().getDisplayMetrics().density;
                float statusBarDp = statusBarPx / density;

                // 直接将 CSS 变量注入到网页的 :root 上，完全绕过 JS 变量
                String js = "document.documentElement.style.setProperty('--native-safe-top', '" + statusBarDp + "px');";
                bridge.getWebView().post(() ->
                    bridge.getWebView().evaluateJavascript(js, null)
                );
            }

            return insets;
        });
    }
}
