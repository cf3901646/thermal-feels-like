/**
 * 智能体感温度计 4.3 - 纯净重构版
 * 
 * 主要功能：
 * - 室内外体感温差计算 (基于 Steadman 模型)
 * - 逐小时预报 (过去3h - 未来12h)
 * - 7天每日趋势
 * - 高清中文高德地图
 * - 移动端原生适配 (Capacitor)
 */

document.addEventListener('DOMContentLoaded', async () => {
    // 动态缩放引擎：强制所有手机显示比例一致 (基准宽度 385px)
    function adjustZoom() {
        const targetWidth = 385;
        const currentWidth = window.innerWidth;
        const scale = currentWidth / targetWidth;
        document.documentElement.style.zoom = scale;
    }
    adjustZoom();
    window.addEventListener('resize', adjustZoom);
    window.addEventListener('orientationchange', () => setTimeout(adjustZoom, 200));


    // ==========================================
    // 1. 全局变量与 DOM 元素
    // ==========================================
    const els = {
        locStatus: document.getElementById('location-status'),
        loading: document.getElementById('loading-overlay'),
        dailyCards: document.getElementById('daily-cards'),
        hourlyCards: document.getElementById('hourly-cards'),
        dialog: document.getElementById('detail-dialog'),
        dialogDate: document.getElementById('dialog-date'),
        dialogIcon: document.getElementById('dialog-icon'),
        dialogDesc: document.getElementById('dialog-desc'),
        dialogTemp: document.getElementById('dialog-temp'),
        dialogHumidity: document.getElementById('dialog-humidity'),
        dialogWind: document.getElementById('dialog-wind'),
        dialogSun: document.getElementById('dialog-sun'),
        dialogIndoor: document.getElementById('dialog-indoor'),
        dialogOutdoor: document.getElementById('dialog-outdoor'),
        btnCloseDialog: document.getElementById('btn-close-dialog'),
        btnCloseIcon: document.getElementById('close-dialog-icon'),
        
        // 当前天气元素
        currentSection: document.getElementById('current-weather-section'),
        currentIcon: document.getElementById('current-icon'),
        currentApparentOutdoor: document.getElementById('current-apparent-outdoor'),
        currentApparentIndoor: document.getElementById('current-apparent-indoor'),
        currentReal: document.getElementById('current-real-temp'),
        currentDesc: document.getElementById('current-desc'),
        currentHumidity: document.getElementById('current-humidity'),
        currentWind: document.getElementById('current-wind'),
        currentRadiation: document.getElementById('current-radiation'),
        currentRadLevel: document.getElementById('current-rad-level'),
        
        // 地理位置管理中心
        locBar: document.getElementById('city-display-clicker'),
        locPanel: document.getElementById('location-panel'),
        mapWrap: document.getElementById('map-container-wrap'),
        btnLoc: document.getElementById('btn-manager-loc'),
        btnMap: document.getElementById('btn-manager-map'),
        btnFav: document.getElementById('btn-favorite'),
        searchInput: document.getElementById('city-search-input'),
        searchLoading: document.getElementById('search-loading'),
        searchResults: document.getElementById('search-results'),
        favList: document.getElementById('favorites-list'),
        
        // 下拉刷新相关
        ptrContainer: document.getElementById('pull-to-refresh'),
        ptrIcon: document.querySelector('.ptr-icon'),
        ptrText: document.querySelector('.ptr-text')
    };

    const CACHE_KEY = 'thermal_weather_cache';
    const FAV_KEY = 'thermal_fav_locations';
    let isRefreshing = false;
    let startY = 0;
    let searchTimeout = null;

    let indoorChartInstance = null;
    let outdoorChartInstance = null;
    let cachedDailyData = null;
    let processedDailyData = null;

    // 统一自定义地图图标 (红色 SVG)
    const customMapIcon = L.divIcon({
        html: `<svg width="32" height="42" viewBox="0 0 32 42" xmlns="http://www.w3.org/2000/svg"><path d="M16 0C7.16 0 0 7.16 0 16c0 12 16 26 16 26s16-14 16-26c0-8.84-7.16-16-16-16z" fill="#d19090"/><circle cx="16" cy="16" r="6" fill="#ffffff"/></svg>`,
        className: 'custom-map-marker',
        iconSize: [32, 42],
        iconAnchor: [16, 42]
    });

    els.btnCloseDialog.addEventListener('click', () => els.dialog.close());
    els.btnCloseIcon.addEventListener('click', () => els.dialog.close());
    els.dialog.addEventListener('click', (e) => { if (e.target === els.dialog) els.dialog.close(); });
    
    els.locBar.addEventListener('click', () => {
        els.locPanel.classList.toggle('hidden');
        els.mapWrap.classList.add('hidden'); // 打开面板时关闭地图
        if (!els.locPanel.classList.contains('hidden')) renderFavorites();
    });

    els.btnLoc.addEventListener('click', (e) => {
        e.stopPropagation();
        requestGeolocation();
        els.locPanel.classList.add('hidden');
    });

    els.btnMap.addEventListener('click', (e) => {
        e.stopPropagation();
        els.mapWrap.classList.toggle('hidden');
        els.locPanel.classList.add('hidden'); // 打开地图时关闭面板
        if (!els.mapWrap.classList.contains('hidden')) {
            setTimeout(() => { if (map) map.invalidateSize(); }, 300);
        }
    });

    els.btnFav.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleCurrentFavorite();
    });

    els.searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        const query = e.target.value.trim();
        if (query.length < 2) {
            els.searchResults.innerHTML = '';
            return;
        }
        searchTimeout = setTimeout(() => searchCities(query), 500);
    });

    // 点击外部关闭面板
    document.addEventListener('click', (e) => {
        if (!els.locPanel.contains(e.target) && !els.locBar.contains(e.target)) {
            els.locPanel.classList.add('hidden');
        }
    });

    // ==========================================
    // 2. 工具函数
    // ==========================================
    function getWeatherDescription(code) {
        // 返回 [描述, 本地图标文件名]
        const map = {
            0: { desc: '晴朗', fluent: 'sunny' }, 
            1: { desc: '晴间多云', fluent: 'partly_cloudy' },
            2: { desc: '多云', fluent: 'partly_cloudy' }, 
            3: { desc: '阴天', fluent: 'cloudy' },
            45: { desc: '有雾', fluent: 'foggy' }, 
            48: { desc: '雾霾', fluent: 'foggy' },
            51: { desc: '细雨', fluent: 'rainy' }, 
            53: { desc: '小雨', fluent: 'rainy' },
            55: { desc: '中雨', fluent: 'rainy' },
            56: { desc: '冻细雨', fluent: 'snowy' },
            57: { desc: '强冻细雨', fluent: 'snowy' },
            61: { desc: '小雨', fluent: 'rainy' }, 
            63: { desc: '中雨', fluent: 'rainy' }, 
            65: { desc: '大雨', fluent: 'rainy' },
            66: { desc: '冻雨', fluent: 'snowy' },
            67: { desc: '强冻雨', fluent: 'snowy' },
            71: { desc: '小雪', fluent: 'snowy' }, 
            73: { desc: '中雪', fluent: 'snowy' },
            75: { desc: '大雪', fluent: 'snowy' }, 
            77: { desc: '雪粒', fluent: 'snowy' },
            80: { desc: '阵雨', fluent: 'rainy' },
            81: { desc: '中阵雨', fluent: 'rainy' },
            82: { desc: '强阵雨', fluent: 'rainy' },
            85: { desc: '阵雪', fluent: 'snowy' },
            86: { desc: '强阵雪', fluent: 'snowy' },
            95: { desc: '雷阵雨', fluent: 'stormy' },
            96: { desc: '雷雨伴冰雹', fluent: 'stormy' }, 
            99: { desc: '强雷雨伴冰雹', fluent: 'stormy' }
        };
        return map[code] || { desc: `代码 ${code}`, fluent: 'partly_cloudy' };
    }

    function getFluentIconUrl(name) {
        return `./${name}.png`;
    }

    // --- 城市搜索与收藏逻辑 ---
    async function searchCities(query) {
        els.searchLoading.classList.remove('hidden');
        try {
            const resp = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=10&accept-language=zh-CN&countrycodes=cn&addressdetails=1&email=thermal_app@example.com`);
            const data = await resp.json();
            renderSearchResults(data);
        } catch (e) {
            console.error('搜索失败', e);
        } finally {
            els.searchLoading.classList.add('hidden');
        }
    }

    function renderSearchResults(results) {
        els.searchResults.innerHTML = results.length ? '' : '<div class="list-item">未找到结果</div>';
        results.forEach(res => {
            const addr = res.address || {};
            // 提取最精准的名称：优先 区/县，然后是 市/镇
            const name = addr.district || addr.county || addr.city || addr.municipality || addr.town || res.display_name.split(',')[0];
            const sub = [addr.city, addr.province, addr.country].filter(i => i && i !== name).slice(0, 2).join(', ');
            const item = document.createElement('div');
            item.className = 'list-item';
            item.innerHTML = `<div><strong>${name}</strong> <small style="color:var(--text-tertiary)">${sub}</small></div>`;
            item.onclick = () => {
                const lat = parseFloat(res.lat);
                const lon = parseFloat(res.lon);
                applyNewLocation(lat, lon, name);
                els.locPanel.classList.add('hidden');
                // 清空搜索内容
                els.searchInput.value = '';
                els.searchResults.innerHTML = '';
            };
            els.searchResults.appendChild(item);
        });
    }

    function applyNewLocation(lat, lon, name) {
        myLat = lat; myLon = lon;
        map.setView([lat, lon], 11);
        if (marker) marker.setLatLng([lat, lon]);
        else marker = L.marker([lat, lon], { icon: customMapIcon }).addTo(map);
        els.mapWrap.classList.add('hidden');
        fetchForecastData(lat, lon, false, name);
    }

    function toggleCurrentFavorite() {
        const cache = loadCache();
        if (!cache) return;
        const favs = loadFavorites();
        const index = favs.findIndex(f => f.name === cache.cityName);
        if (index > -1) {
            favs.splice(index, 1);
            els.btnFav.querySelector('.star-icon').classList.remove('active');
        } else {
            favs.push({ name: cache.cityName, lat: cache.lat, lon: cache.lon });
            els.btnFav.querySelector('.star-icon').classList.add('active');
        }
        localStorage.setItem(FAV_KEY, JSON.stringify(favs));
        renderFavorites();
    }

    function loadFavorites() {
        return JSON.parse(localStorage.getItem(FAV_KEY) || '[]');
    }

    function renderFavorites() {
        const favs = loadFavorites();
        els.favList.innerHTML = favs.length ? '' : '<div class="list-item">暂无收藏</div>';
        favs.forEach((f, idx) => {
            const item = document.createElement('div');
            item.className = 'list-item';
            item.innerHTML = `
                <span>${f.name}</span>
                <button class="delete-btn" onclick="event.stopPropagation(); window.deleteFav(${idx})">
                    <svg class="svg-icon" style="width:14px;height:14px;" viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                </button>
            `;
            item.onclick = () => {
                applyNewLocation(f.lat, f.lon, f.name);
                els.locPanel.classList.add('hidden');
            };
            els.favList.appendChild(item);
        });
    }

    window.deleteFav = (idx) => {
        const favs = loadFavorites();
        favs.splice(idx, 1);
        localStorage.setItem(FAV_KEY, JSON.stringify(favs));
        renderFavorites();
        updateFavStarState();
    };

    function updateFavStarState(cityName = null) {
        let nameToCheck = cityName;
        if (!nameToCheck) {
            const cache = loadCache();
            if (cache) nameToCheck = cache.cityName;
        }
        if (!nameToCheck) return;
        
        const favs = loadFavorites();
        const isFav = favs.some(f => f.name === nameToCheck);
        els.btnFav.querySelector('.star-icon').classList.toggle('active', isFav);
    }

    function getRadiationLevel(w) {
        if (w <= 0) return { label: '无', color: 'var(--text-tertiary)' };
        if (w <= 200) return { label: '极弱', color: 'var(--text-secondary)' };
        if (w <= 400) return { label: '弱', color: 'var(--text-main)' };
        if (w <= 600) return { label: '中等', color: '#ff9800' };
        if (w <= 800) return { label: '强', color: '#ff5722' };
        return { label: '极强', color: '#d32f2f' };
    }

    function formatDateStr(dateStr) {
        const date = new Date(dateStr + 'T12:00:00');
        const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        return {
            short: `${date.getMonth() + 1}/${date.getDate()}`,
            day: days[date.getDay()],
            full: `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${days[date.getDay()]}`
        };
    }

    // ==========================================
    // 3. 计算逻辑
    // ==========================================
    function calcIndoorAT(outdoorAT, Ta, ws_kmh, radMJ, isMaxTemp, wallTa) {
        // 1. 灵动权重模型：室内气温由室外空气(70%)和墙体热惯性(30%)共同决定
        const Ta_indoor = wallTa ? (0.7 * Ta + 0.3 * wallTa) : Ta;
        const deltaTa = Ta - Ta_indoor;

        // 2. 动态环境补偿 (包含夏季通风与冬季保温)
        const ws = ws_kmh / 3.6;
        let envBonus = 0; 
        
        if (Ta >= 25) {
            // 夏季：通风模式下，室内保留 40% 的风力，补偿流失的 60% 风冷收益
            const windRetention = 0.4;
            envBonus = Math.min(ws * (1 - windRetention) * 0.5, 3.0); 
        } else if (Ta <= 15) {
            // 冬季：保温模式。室内屏蔽了寒风。
            // 我们通过补回 (气温 - 风冷体感) 的差值，来体现墙体的防风保温作用
            // 此时室内体感应基于“静止空气”加上墙体残留热量
            const windChillEffect = Math.max(Ta - outdoorAT, 0);
            envBonus = windChillEffect + 1.0; // 额外 +1.0 代表室内电器/人员的微量产热
        }

        // 3. 最终计算
        let indoorAT = outdoorAT - deltaTa + envBonus;
        
        // 4. 边界保护
        return Math.min(Math.max(indoorAT, Ta_indoor - 2), Ta_indoor + 5);
    }

    // 辅助函数：计算过去 N 小时的滑动平均值，模拟墙体热惰性
    function calcMovingAverage(temps, index, window = 12) {
        let sum = 0;
        let count = 0;
        for (let i = Math.max(0, index - window + 1); i <= index; i++) {
            sum += temps[i];
            count++;
        }
        return count > 0 ? (sum / count) : temps[index];
    }

    function calcOutdoorATWithSun(apparentTemp, Ta, radMJ, isMaxTemp) {
        if (!isMaxTemp || radMJ <= 0 || Ta < 10) return apparentTemp;
        const tempFactor = Math.min(Math.max((Ta - 10) / 30, 0.4), 1.0);
        // 修正：将系数从 0.28 提升至 1.6，使 1000W/m² (3.6MJ/h) 对应约 5.7°C 的增益
        return apparentTemp + Math.min(radMJ * 1.6 * tempFactor, 8.0);
    }

    // ==========================================
    // 4. 渲染逻辑
    // ==========================================
    function initOrUpdateCharts(labels, indoorData, outdoorData) {
        if (!labels || labels.length === 0) return;
        
        // 容错：如果数据全为0且不是刻意为之，可能数据未加载，暂不渲染
        const hasData = outdoorData.max.some(v => v !== 0);
        if (!hasData) return;

        // 简化标签：安卓端多行标签有时会导致渲染失败，改为单行
        const simpleLabels = labels.map(l => Array.isArray(l) ? l[0] : l);

        const cfg = {
            inGradFill: 'rgba(139,162,138,0.15)',
            inGradBase: 'rgba(139,162,138,0.02)',
            inMaxBorder: '#8ba28a',
            inMinBorder: '#7A90A4',
            outGradFill: 'rgba(209,144,144,0.15)',
            outGradBase: 'rgba(209,144,144,0.02)',
            outMaxBorder: '#d19090',
            outMinBorder: '#D9A0A0'
        };

        const commonOptions = {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { 
                    position: 'bottom', 
                    labels: { usePointStyle: true, boxWidth: 8, font: { size: 12, family: "'Inter', sans-serif" } }
                },
                tooltip: {
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    titleColor: '#000',
                    bodyColor: '#333',
                    borderColor: '#e5e5ea',
                    borderWidth: 1,
                    padding: 10,
                    boxPadding: 4,
                    cornerRadius: 8
                }
            },
            scales: {
                y: { grid: { color: '#f0f0f0', drawBorder: false }, border: { display: false } },
                x: { grid: { display: false }, border: { display: false } }
            },
            elements: {
                point: { radius: 4, pointStyle: 'circle', backgroundColor: '#ffffff', borderWidth: 2, hoverRadius: 6 },
                line: { borderWidth: 2 }
            }
        };

        try {
            if (indoorChartInstance) indoorChartInstance.destroy();
            const canvasIndoor = document.getElementById('indoorChart');
            if (!canvasIndoor) return;
            const ctxIndoor = canvasIndoor.getContext('2d');
            const gradIndoor = ctxIndoor.createLinearGradient(0, 0, 0, 200);
            gradIndoor.addColorStop(0, cfg.inGradFill);
            gradIndoor.addColorStop(1, cfg.inGradBase);
            
            indoorChartInstance = new Chart(ctxIndoor, {
                type: 'line',
                data: {
                    labels: simpleLabels,
                    datasets: [
                        { label: '室内体感 (高)', data: indoorData.max, borderColor: cfg.inMaxBorder, backgroundColor: gradIndoor, fill: true, tension: 0.4, pointRadius: 3 },
                        { label: '室内体感 (低)', data: indoorData.min, borderColor: cfg.inMinBorder, backgroundColor: 'transparent', tension: 0.4, pointRadius: 3 }
                    ]
                },
                options: commonOptions
            });

            if (outdoorChartInstance) outdoorChartInstance.destroy();
            const canvasOutdoor = document.getElementById('outdoorChart');
            if (!canvasOutdoor) return;
            const ctxOutdoor = canvasOutdoor.getContext('2d');
            const gradOutdoor = ctxOutdoor.createLinearGradient(0, 0, 0, 200);
            gradOutdoor.addColorStop(0, cfg.outGradFill);
            gradOutdoor.addColorStop(1, cfg.outGradBase);
            
            outdoorChartInstance = new Chart(ctxOutdoor, {
                type: 'line',
                data: {
                    labels: simpleLabels,
                    datasets: [
                        { label: '室外体感 (高)', data: outdoorData.max, borderColor: cfg.outMaxBorder, backgroundColor: gradOutdoor, fill: true, tension: 0.4, pointRadius: 3 },
                        { label: '室外体感 (低)', data: outdoorData.min, borderColor: cfg.outMinBorder, backgroundColor: 'transparent', tension: 0.4, pointRadius: 3 }
                    ]
                },
                options: commonOptions
            });
        } catch (e) {
            console.error('图表渲染失败', e);
        }
    }

    function renderDailyCards(daily) {
        els.dailyCards.innerHTML = '';
        
        // 计算 8 日内的全局最低和最高温，用于区间条比例计算
        const globalMin = Math.min(...daily.temperature_2m_min);
        const globalMax = Math.max(...daily.temperature_2m_max);
        const totalRange = globalMax - globalMin;

        for (let i = 0; i < daily.time.length; i++) {
            const dateObj = formatDateStr(daily.time[i]);
            const weather = getWeatherDescription(daily.weather_code[i]);
            const isToday = (i === 0);
            
            const minT = daily.temperature_2m_min[i];
            const maxT = daily.temperature_2m_max[i];
            
            // 计算区间条的偏移和宽度百分比
            const leftOffset = ((minT - globalMin) / totalRange) * 100;
            const barWidth = ((maxT - minT) / totalRange) * 100;

            const row = document.createElement('div');
            row.className = `daily-row ${isToday ? 'is-today' : ''}`;
            row.innerHTML = `
                <div class="day-name-group">
                    <span class="day-name">${isToday ? '今天' : dateObj.day}</span>
                    <span class="day-date">${dateObj.short}</span>
                </div>
                <img class="day-icon" src="${getFluentIconUrl(weather.fluent)}" alt="${weather.desc}">
                <span class="temp-low">${Math.round(minT)}°</span>
                <div class="temp-bar-container">
                    <div class="temp-bar-active" style="left: ${leftOffset}%; width: ${barWidth}%"></div>
                </div>
                <span class="temp-high">${Math.round(maxT)}°</span>
            `;
            row.addEventListener('click', () => showDayDetail(i));
            els.dailyCards.appendChild(row);
        }
    }

    function renderHourlyCards(hourly, current) {
        els.hourlyCards.innerHTML = '';
        const nowEpoch = new Date().getTime();
        let currentIndex = 0;
        let minDiff = Infinity;
        for (let i = 0; i < hourly.time.length; i++) {
            const t = new Date(hourly.time[i]).getTime();
            const diff = Math.abs(t - nowEpoch);
            if (diff < minDiff) { minDiff = diff; currentIndex = i; }
        }

        const start = Math.max(0, currentIndex - 3);
        const end = Math.min(hourly.time.length - 1, currentIndex + 20);
        
        const colWidth = 75;
        const totalCols = end - start + 1;
        const totalWidth = totalCols * colWidth;

        const wrapper = document.createElement('div');
        wrapper.className = 'hourly-unified-wrapper';
        wrapper.style.width = `${totalWidth}px`;
        
        const colsWrapper = document.createElement('div');
        colsWrapper.className = 'hourly-columns-wrapper';

        const outData = [];
        const inData = [];

        for (let i = start; i <= end; i++) {
            const isNow = (i === currentIndex);
            const time = new Date(hourly.time[i]);
            
            // 核心同步：若是“现在”，强制使用实时观测值，否则使用预报值
            const weather = (isNow && current) ? getWeatherDescription(current.weather_code) : getWeatherDescription(hourly.weather_code[i]);
            const app = (isNow && current) ? current.apparent_temperature : hourly.apparent_temperature[i];
            const ta = (isNow && current) ? current.temperature_2m : hourly.temperature_2m[i];
            const rad = (isNow && current) ? current.shortwave_radiation : hourly.shortwave_radiation[i];
            const ws = (isNow && current) ? current.wind_speed_10m : hourly.wind_speed_10m[i];
            const isDay = (isNow && current) ? !!current.is_day : !!hourly.is_day[i];

            // 使用 12 小时滑动平均代表墙体温度 (Thermal Mass)
            const wallTa = calcMovingAverage(hourly.temperature_2m, i, 12);

            const outAT = calcOutdoorATWithSun(app, ta, rad/1000*3.6, isDay);
            const inAT = calcIndoorAT(app, ta, ws, 0, isDay, wallTa);
            
            outData.push(outAT);
            inData.push(inAT);

            const col = document.createElement('div');
            col.className = `hourly-col ${isNow ? 'current' : ''}`;
            col.innerHTML = `
                <span class="hour-time">${isNow ? '现在' : time.getHours() + ':00'}</span>
                <img class="hour-icon" src="${getFluentIconUrl(weather.fluent)}" alt="${weather.desc}">
                <div class="hour-temp-wrap"><span class="temp-val text-outdoor">${Math.round(outAT)}°</span><span class="temp-label text-outdoor">室外</span></div>
                <div class="sparkline-spacer"></div>
                <div class="hour-temp-wrap"><span class="temp-val text-indoor">${Math.round(inAT)}°</span><span class="temp-label text-indoor">室内</span></div>
            `;
            colsWrapper.appendChild(col);
        }

        wrapper.appendChild(colsWrapper);
        els.hourlyCards.appendChild(wrapper);

        // 重构：抛弃不可靠的延迟渲染和动态高度计算，使用确定的绝对尺寸
        const canvasHeight = 90; // 与 CSS .sparkline-spacer 保持一致
        const canvasTop = 130;   // 曲线距顶部偏移，匹配排版

        const canvas = document.createElement('canvas');
        canvas.className = 'hourly-sparkline-canvas';
        const dpr = window.devicePixelRatio || 1;
        
        canvas.width = totalWidth * dpr;
        canvas.height = canvasHeight * dpr;
        canvas.style.width = `${totalWidth}px`;
        canvas.style.height = `${canvasHeight}px`;
        canvas.style.top = `${canvasTop}px`; 
        
        wrapper.insertBefore(canvas, colsWrapper);

        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        
        const allTemps = [...outData, ...inData];
        const minT = Math.min(...allTemps);
        const maxT = Math.max(...allTemps);
        const range = Math.max(maxT - minT, 4); 
        const padding = 15;
        const usableHeight = canvasHeight - padding * 2;

        const getPts = (data) => data.map((val, idx) => ({
            // 线条锚点必须精准对准 75px 格子的中心
            x: (idx * colWidth) + (colWidth / 2),
            y: padding + usableHeight - ((val - minT) / range) * usableHeight
        }));

        const outPts = getPts(outData);
        const inPts = getPts(inData);

        const drawSmoothCurve = (points, color) => {
            if (points.length < 2) return;
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            
            const tension = 0.3; // 平滑度系数
            for (let i = 0; i < points.length - 1; i++) {
                const p1 = points[i];
                const p2 = points[i + 1];
                
                // 计算控制点，参考前后点的走势
                const p0 = points[i - 1] || p1;
                const p3 = points[i + 2] || p2;
                
                const cp1x = p1.x + (p2.x - p1.x) * tension;
                const cp1y = p1.y + (p2.y - p0.y) * tension;
                
                const cp2x = p2.x - (p2.x - p1.x) * tension;
                const cp2y = p2.y - (p3.y - p1.y) * tension;
                
                ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
            }
            ctx.strokeStyle = color;
            ctx.lineWidth = 3; // 稍微加粗线条，更有质感
            ctx.lineCap = 'round';
            ctx.stroke();
        };

        drawSmoothCurve(outPts, '#d19090'); 
        drawSmoothCurve(inPts, '#8ba28a');
        
        // 自动滚动到当前时间
        if(currentIndex > 0) {
            const scrollX = Math.max(0, (currentIndex * colWidth) - (els.hourlyCards.clientWidth / 2) + (colWidth / 2));
            els.hourlyCards.scrollLeft = scrollX;
        }
    }

    function showDayDetail(index) {
        if (!cachedDailyData || !processedDailyData) return;
        const d = cachedDailyData;
        const p = processedDailyData;
        const todayStr = new Date().toISOString().split('T')[0];
        const offset = d.time.indexOf(todayStr);
        const realIdx = index + (offset !== -1 ? offset : 0);

        const weather = getWeatherDescription(d.weather_code[realIdx]);
        const dateObj = formatDateStr(d.time[realIdx]);
        els.dialogDate.textContent = dateObj.full;
        els.dialogIcon.innerHTML = `<img src="${getFluentIconUrl(weather.fluent)}" style="width:120px;height:120px;">`;
        els.dialogIcon.className = `dialog-weather-icon`;
        els.dialogDesc.textContent = weather.desc;
        els.dialogTemp.textContent = `${Math.round(d.temperature_2m_max[realIdx])}° / ${Math.round(d.temperature_2m_min[realIdx])}°`;
        els.dialogHumidity.textContent = `${Math.round(d.relative_humidity_2m_mean[realIdx])}%`;
        
        const ws = d.wind_speed_10m_max[realIdx];
        els.dialogWind.textContent = `${ws.toFixed(1)} km/h`;
        
        const rad = d.shortwave_radiation_sum[realIdx];
        const avgRadW = (rad * 1000000) / (12 * 3600); 
        const radLevel = getRadiationLevel(avgRadW);
        els.dialogSun.textContent = `${rad.toFixed(1)} MJ/m² (${radLevel.label})`;
        els.dialogSun.style.color = radLevel.color;

        const dayData = p[d.time[realIdx]];
        if (dayData) {
            els.dialogOutdoor.textContent = `${Math.round(dayData.outMax)}° / ${Math.round(dayData.outMin)}°`;
            els.dialogIndoor.textContent = `${Math.round(dayData.inMax)}° / ${Math.round(dayData.inMin)}°`;
        } else {
            els.dialogOutdoor.textContent = '--';
            els.dialogIndoor.textContent = '--';
        }
        
        els.dialog.showModal();
    }

    // ==========================================
    // 5. 地图与定位
    // ==========================================
    async function fetchCityName(lat, lon) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒超时
        try {
            const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=zh-CN`, { signal: controller.signal });
            const data = await resp.json();
            clearTimeout(timeoutId);
            const addr = data.address;
            // 优先级调整：区/县 > 市 > 镇/村
            return addr.district || addr.county || addr.city || addr.municipality || addr.town || addr.village || '未知位置';
        } catch (e) {
            return '定位点';
        }
    }

    let map = L.map('map', { zoomControl: false, attributionControl: false }).setView([39.9042, 116.4074], 4);
    L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=2&style=8&x={x}&y={y}&z={z}', { subdomains: '1234', minZoom: 3, maxZoom: 18 }).addTo(map);
    let marker = null; let myLat = null; let myLon = null;

    // 点击地图选点
    map.on('click', (e) => {
        myLat = e.latlng.lat; myLon = e.latlng.lng;
        if (marker) marker.setLatLng(e.latlng); 
        else marker = L.marker(e.latlng, { icon: customMapIcon }).addTo(map);
        els.mapWrap.classList.add('hidden'); // 选点后自动关闭
        fetchForecastData(myLat, myLon);
    });

    function saveCache(data, lat, lon, cityName) {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
            timestamp: Date.now(),
            lat, lon, cityName, data
        }));
    }

    function loadCache() {
        const cache = localStorage.getItem(CACHE_KEY);
        if (cache) {
            try {
                return JSON.parse(cache);
            } catch (e) { return null; }
        }
        return null;
    }

    async function renderWeatherData(data, lat, lon, cachedCityName = null, forcedName = null) {
        if (!data || !data.daily) return;
        cachedDailyData = data.daily;
        const d = data.daily;
        const hourly = data.hourly;

        // 1. 渲染当前天气
        if (data.current) {
            const cur = data.current;
            const weather = getWeatherDescription(cur.weather_code);
            els.currentIcon.innerHTML = `<img src="${getFluentIconUrl(weather.fluent)}" class="weather-icon-img-large">`;
            els.currentDesc.textContent = weather.desc;
            
            const nowEpoch = new Date().getTime();
            let curIdx = 0; let minDiff = Infinity;
            if (hourly && hourly.time) {
                for (let i = 0; i < hourly.time.length; i++) {
                    const t = new Date(hourly.time[i]).getTime();
                    const diff = Math.abs(t - nowEpoch);
                    if (diff < minDiff) { minDiff = diff; curIdx = i; }
                }
            }
            const wallTa = (hourly && hourly.temperature_2m) ? calcMovingAverage(hourly.temperature_2m, curIdx, 12) : cur.temperature_2m;

            const outAT = calcOutdoorATWithSun(cur.apparent_temperature, cur.temperature_2m, cur.shortwave_radiation/1000*3.6, !!cur.is_day);
            const inAT = calcIndoorAT(cur.apparent_temperature, cur.temperature_2m, cur.wind_speed_10m, 0, !!cur.is_day, wallTa);
            els.currentApparentOutdoor.textContent = `${Math.round(outAT)}°`;
            els.currentApparentIndoor.textContent = `${Math.round(inAT)}°`;
            els.currentReal.textContent = `气温: ${Math.round(cur.temperature_2m)}°C`;
            els.currentHumidity.textContent = `${Math.round(cur.relative_humidity_2m)}%`;
            els.currentWind.textContent = `${cur.wind_speed_10m.toFixed(1)} km/h`;
            els.currentRadiation.textContent = `${cur.shortwave_radiation} W/m²`;
            const rl = getRadiationLevel(cur.shortwave_radiation);
            els.currentRadLevel.textContent = rl.label; els.currentRadLevel.style.color = rl.color;
        }

        // 2. 聚合逐小时数据
        if (hourly && hourly.time) {
            const dailyMap = {};
            for (let i = 0; i < hourly.time.length; i++) {
                const date = hourly.time[i].split('T')[0];
                if (!dailyMap[date]) dailyMap[date] = { out: [], in: [] };
                
                const wallTa = calcMovingAverage(hourly.temperature_2m, i, 12);
                const outAT = calcOutdoorATWithSun(hourly.apparent_temperature[i], hourly.temperature_2m[i], hourly.shortwave_radiation[i]/1000*3.6, !!hourly.is_day[i]);
                const inAT = calcIndoorAT(hourly.apparent_temperature[i], hourly.temperature_2m[i], hourly.wind_speed_10m[i], 0, !!hourly.is_day[i], wallTa);
                
                dailyMap[date].out.push(outAT);
                dailyMap[date].in.push(inAT);
            }

            processedDailyData = {};
            for (const date in dailyMap) {
                const outs = dailyMap[date].out.filter(v => v != null);
                const ins = dailyMap[date].in.filter(v => v != null);
                if (outs.length > 0) {
                    processedDailyData[date] = {
                        outMax: Math.max(...outs),
                        outMin: Math.min(...outs),
                        inMax: Math.max(...ins),
                        inMin: Math.min(...ins)
                    };
                }
            }
        }

        // 3. 过滤数据
        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const todayIdx = d.time.indexOf(todayStr);
        const startIdx = todayIdx !== -1 ? todayIdx : 1;
        const filtered = {}; for (const k in d) filtered[k] = d[k].slice(startIdx);
        
        const labels = filtered.time.map(t => [formatDateStr(t).short, t === todayStr ? '今天' : formatDateStr(t).day]);
        
        const outData = {
            max: filtered.time.map(t => processedDailyData[t]?.outMax || 0),
            min: filtered.time.map(t => processedDailyData[t]?.outMin || 0)
        };
        const inData = {
            max: filtered.time.map(t => processedDailyData[t]?.inMax || 0),
            min: filtered.time.map(t => processedDailyData[t]?.inMin || 0)
        };
        
        // 延迟 100ms 绘制图表，确保容器尺寸已稳定
        setTimeout(() => {
            initOrUpdateCharts(labels, inData, outData);
        }, 100);
        
        renderDailyCards(filtered);
        if (data.hourly) renderHourlyCards(data.hourly, data.current);
        
        // 显示城市和板块
        // 优先级：forcedName > cachedCityName > fetchCityName
        const cityName = forcedName || cachedCityName || await fetchCityName(lat, lon);
        els.locStatus.textContent = cityName;
        els.currentSection.style.display = 'flex';
        
        updateFavStarState(cityName);
        return cityName;
    }

    async function fetchForecastData(lat, lon, silent = false, forcedName = null) {
        if (!silent) {
            els.loading.classList.remove('hidden');
            els.locStatus.textContent = '正在加载气象数据';
        } else {
            // 静默更新时，如果当前还在显示默认状态，更新状态文案
            if (els.locStatus.textContent.includes('获取位置') || els.locStatus.textContent.includes('读取中')) {
                els.locStatus.textContent = '正在更新数据...';
            }
        }
        try {
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,shortwave_radiation&hourly=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,shortwave_radiation,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,sunrise,sunset,wind_speed_10m_max,relative_humidity_2m_max,relative_humidity_2m_min,relative_humidity_2m_mean,shortwave_radiation_sum&timezone=auto&past_days=1`;
            const resp = await fetch(url);
            const data = await resp.json();
            
            const cityName = await renderWeatherData(data, lat, lon, null, forcedName);
            saveCache(data, lat, lon, cityName);
            
            // 如果是下拉刷新，完成时重置动画
            if (isRefreshing) {
                els.ptrIcon.classList.remove('spinning');
                els.ptrContainer.style.height = '0';
                setTimeout(() => { els.ptrText.textContent = '下拉刷新'; }, 300);
                isRefreshing = false;
            }
        } catch (err) { 
            if (!silent) els.locStatus.textContent = '数据请求失败'; 
            if (isRefreshing) {
                els.ptrIcon.classList.remove('spinning');
                els.ptrContainer.style.height = '0';
                els.ptrText.textContent = '刷新失败';
                isRefreshing = false;
            }
        }
        finally { els.loading.classList.add('hidden'); }
    }

    async function requestGeolocation() {
        const cached = loadCache();
        if (cached) {
            // 如果有缓存，瞬间加载缓存数据
            await renderWeatherData(cached.data, cached.lat, cached.lon, cached.cityName);
            
            // 立即隐藏加载遮罩
            els.loading.classList.add('hidden');
            
            // 后台静默刷新最新数据
            fetchForecastData(cached.lat, cached.lon, true);
        } else {
            // 仅在完全没有缓存时才显示加载状态
            els.loading.classList.remove('hidden');
            els.locStatus.textContent = '正在获取位置...';
        }

        if (!navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(pos => {
            const applyLocation = (lat, lon) => {
                myLat = lat; myLon = lon;
                map.setView([myLat, myLon], 11);
                if (marker) marker.setLatLng([myLat, myLon]); 
                else marker = L.marker([myLat, myLon], { icon: customMapIcon }).addTo(map);
                els.mapWrap.classList.add('hidden');
                
                // 如果没有缓存，或者定位的位置发生了显著变化，则重新获取
                if (!cached || Math.abs(cached.lat - lat) > 0.05 || Math.abs(cached.lon - lon) > 0.05) {
                    fetchForecastData(myLat, myLon, !!cached);
                }
            };
            applyLocation(pos.coords.latitude, pos.coords.longitude);
        }, err => { 
            if (!cached) {
                els.locStatus.textContent = '定位失败，请手动选点'; 
                els.loading.classList.add('hidden');
            }
        }, { enableHighAccuracy: true, timeout: 15000 });
    }

    // 下拉刷新事件监听
    document.body.addEventListener('touchstart', (e) => {
        if (window.scrollY === 0 && !isRefreshing) {
            startY = e.touches[0].clientY;
        }
    }, { passive: true });

    document.body.addEventListener('touchmove', (e) => {
        if (window.scrollY === 0 && !isRefreshing && startY > 0) {
            const y = e.touches[0].clientY;
            const diff = y - startY;
            if (diff > 0) {
                els.ptrContainer.style.height = `${Math.min(diff * 0.5, 100)}px`;
                if (diff > 80) els.ptrText.textContent = '释放刷新';
                else els.ptrText.textContent = '下拉刷新';
                if (e.cancelable) e.preventDefault();
            }
        }
    }, { passive: false });

    document.body.addEventListener('touchend', (e) => {
        if (window.scrollY === 0 && !isRefreshing && startY > 0) {
            const diff = e.changedTouches[0].clientY - startY;
            startY = 0;
            if (diff > 80) {
                isRefreshing = true;
                els.ptrContainer.style.height = '60px';
                els.ptrText.textContent = '正在刷新...';
                els.ptrIcon.classList.add('spinning');
                
                if (myLat !== null && myLon !== null) {
                    fetchForecastData(myLat, myLon, true);
                } else if (loadCache()) {
                    const c = loadCache();
                    fetchForecastData(c.lat, c.lon, true);
                } else {
                    requestGeolocation();
                }
            } else {
                els.ptrContainer.style.height = '0';
            }
        }
        startY = 0;
    });

    if (window.Capacitor) {
        const { App, StatusBar } = window.Capacitor.Plugins;
        if (StatusBar) {
            StatusBar.setStyle({ style: 'DARK' }); // 浅色背景用黑字
            // 开启叠加模式：让背景延伸到状态栏下方，配合 CSS 的 safe-area 使用
            StatusBar.setOverlaysWebView({ overlay: true });
            StatusBar.setBackgroundColor({ color: '#00000000' }); // 设为透明
        }
        App.addListener('backButton', () => {
            if (els.dialog.open) {
                els.dialog.close();
            } else if (!els.locPanel.classList.contains('hidden')) {
                els.locPanel.classList.add('hidden');
            } else if (!els.mapWrap.classList.contains('hidden')) {
                els.mapWrap.classList.add('hidden');
            } else {
                App.exitApp();
            }
        });
    }
    
    // 初始化
    const initCache = loadCache();
    if (initCache) {
        myLat = initCache.lat;
        myLon = initCache.lon;
        updateFavStarState();
    }
    // 监听窗口大小变化，重绘趋势曲线
    window.addEventListener('resize', () => {
        const cache = loadCache();
        if (cache && cache.data && cache.data.hourly) {
            renderHourlyCards(cache.data.hourly, cache.data.current);
        }
    });

    await requestGeolocation();
});
