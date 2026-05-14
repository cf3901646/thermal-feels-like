package com.morandi.thermalmeter;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // GitHub 核心方案：强制开启 DecorFitsSystemWindows(false)，允许系统将 Safe Area Insets 传递给 WebView
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
    }
}
