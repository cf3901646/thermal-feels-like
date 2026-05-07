/**
 * 智能体感温度计 4.1 - 重构版
 *
 * 核心架构变更：
 * - 室外体感：直接使用 Open-Meteo API 自带的 apparent_temperature_max/min
 *   （API内部使用已验证的Steadman模型，不会发散）
 * - 室内体感：基于室外体感，反推去除"风"和"日照"的贡献，加入室内湿度效果
 * - 彻底废弃自写的 Rothfusz/BOM 公式（在极端条件下均会严重发散）
 */

document.addEventListener('DOMContentLoaded', () => {

    // ==========================================
    // 1. 全局变量
    // ==========================================
    const els = {
        locStatus: document.getElementById('location-status'),
        loading: document.getElementById('loading-overlay'),
        dailyCards: document.getElementById('daily-cards'),
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
        
        // 新增：当前天气元素
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
        
        // 新增：悬浮地图相关
        mapWidget: document.getElementById('floating-map-widget'),
        btnToggleMap: document.getElementById('btn-toggle-map'),
        btnCloseMap: document.getElementById('btn-close-map')
    };

    let indoorChartInstance = null;
    let outdoorChartInstance = null;
    let cachedDailyData = null;

    els.btnCloseDialog.addEventListener('click', () => els.dialog.close());
    els.btnCloseIcon.addEventListener('click', () => els.dialog.close());
    els.dialog.addEventListener('click', (e) => { if (e.target === els.dialog) els.dialog.close(); });
    
    // 悬浮地图折叠/展开逻辑
    els.btnToggleMap.addEventListener('click', () => {
        els.mapWidget.classList.remove('collapsed');
        setTimeout(() => { if (map) map.invalidateSize(); }, 300); // 确信地图大小正确渲染
        if (myLat === null) requestGeolocation(); // 若未定位，点击图标自动触发定位
    });
    els.btnCloseMap.addEventListener('click', () => els.mapWidget.classList.add('collapsed'));

    // ==========================================
    // 2. 工具函数
    // ==========================================
    function getWeatherDescription(code) {
        const map = {
            0: { desc: '晴朗', icon: '☀️' }, 1: { desc: '多云', icon: '🌤️' },
            2: { desc: '局部多云', icon: '⛅' }, 3: { desc: '阴天', icon: '☁️' },
            45: { desc: '有雾', icon: '🌫️' }, 48: { desc: '结霜有雾', icon: '🌫️' },
            51: { desc: '毛毛雨', icon: '🌦️' }, 53: { desc: '中毛毛雨', icon: '🌦️' },
            55: { desc: '强毛毛雨', icon: '🌧️' }, 61: { desc: '小雨', icon: '🌧️' },
            63: { desc: '中雨', icon: '🌧️' }, 65: { desc: '大雨', icon: '🌧️' },
            71: { desc: '小雪', icon: '🌨️' }, 73: { desc: '中雪', icon: '🌨️' },
            75: { desc: '大雪', icon: '❄️' }, 95: { desc: '雷阵雨', icon: '⛈️' },
            96: { desc: '雷阵雨伴冰雹', icon: '⛈️' }, 99: { desc: '强雷阵雨伴冰雹', icon: '⛈️' }
        };
        return map[code] || { desc: '未知', icon: '❓' };
    }

    // 获取日照强度参考级别
    function getRadiationLevel(w) {
        if (w <= 0) return { label: '无', color: 'var(--text-tertiary)' };
        if (w <= 200) return { label: '极弱', color: 'var(--text-secondary)' };
        if (w <= 400) return { label: '弱', color: 'var(--text-main)' };
        if (w <= 600) return { label: '中等', color: '#ff9800' };
        if (w <= 800) return { label: '强', color: '#ff5722' };
        return { label: '极强', color: '#d32f2f' };
    }

    function formatDateStr(dateStr) {
        const date = new Date(dateStr + 'T12:00:00'); // 避免时区导致日期偏移
        const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        return {
            short: `${date.getMonth() + 1}/${date.getDate()}`,
            day: days[date.getDay()],
            full: `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${days[date.getDay()]}`
        };
    }

    // ==========================================
    // 3. 核心计算引擎（修复版）
    // ==========================================

    /**
     * 【核心】从API给出的室外体感温度，推算室内体感温度
     *
     * 思路：
     *  室外体感 = 实际气温 + 湿度效果 + 风效果（负值=降温/正值=暖和） + 太阳辐射效果
     *  室内体感 = 实际气温 + 湿度效果（室内略低）+ 极小风效果 + 极少辐射效果
     *
     * 因此：
     *  室内体感 ≈ 室外体感 - 风的贡献 - 太阳辐射的贡献 + 室内特有调整
     *
     * @param {number} outdoorAT   - API返回的室外体感温度
     * @param {number} Ta          - 实际气温
     * @param {number} ws_kmh      - 风速 km/h
     * @param {number} radMJ       - 日辐射量 MJ/m²
     * @param {boolean} isMaxTemp  - true=最高温时段，false=最低温时段
     */
    function calcIndoorAT(outdoorAT, Ta, ws_kmh, radMJ, isMaxTemp) {
        const ws = ws_kmh / 3.6; // km/h → m/s

        // ── 风的贡献（室外有风降温，室内基本无风）──
        // API apparent_temperature 已含风效应（含蒸发散热/风寒）
        // 室内只有微风，需要"加回"室外风速带来的那部分差值
        let windContribution = 0;
        if (Ta >= 27) {
            // 热天：室外风加速汗液蒸发，每 1 m/s 约降 0.5°C（上限5°C）
            windContribution = -(Math.min(ws * 0.5, 5.0));
        } else if (Ta <= 10) {
            // 冷天：室外体感(含风寒) - 气温 = 风的贡献（负数）
            windContribution = outdoorAT - Ta;
        } else {
            // 10~27°C：轻微降温效果
            windContribution = -(ws * 0.2);
        }

        // ── 太阳辐射贡献（户外直晒 vs 室内遮蔽）──
        // Open-Meteo 体感基于阴凉处；户外暴晒的人会再热 3~7°C
        // 室内无直晒，这部分要从室内体感中去掉
        let solarContribution = 0;
        if (isMaxTemp && radMJ > 0 && Ta >= 10) {
            // 气温越高，辐射与体温叠加效果越强
            const tempFactor = Math.min(Math.max((Ta - 10) / 30, 0.3), 1.0);
            solarContribution = Math.min(radMJ * 0.30 * tempFactor, 7.0);
        }

        // ── 室内闷热调整 ──
        // 无风环境下，衣物散热能力下降，比同温有风环境更闷
        const stuffiness = (Ta >= 27 && ws > 1) ? 1.5 : (Ta >= 15 ? 0.5 : 0);

        // 室内体感 = 室外体感(阴凉) - 风贡献(补回) - 阳光(扣掉) + 闷热
        let indoorAT = outdoorAT - windContribution - solarContribution + stuffiness;

        // ── 物理约束 ──
        // 室内无风，不会因风寒大幅降低体感
        // 下界：低温(<10°C)时可稍低于气温（建筑散热慢，室内比室外暖），上界 Ta-2
        //       其他温度区间室内通常在气温 ±3°C 内
        const lowerBound = Ta <= 10 ? Ta - 1 : Ta - 2;
        indoorAT = Math.max(indoorAT, lowerBound);
        indoorAT = Math.min(indoorAT, Ta + 12); // 极端潮湿也有上限
        return indoorAT;
    }

    /**
     * 室外体感加阳光修正
     * Open-Meteo apparent_temperature 按阴凉处算，户外直晒需要加成
     */
    function calcOutdoorATWithSun(apparentTemp, Ta, radMJ, isMaxTemp) {
        if (!isMaxTemp || radMJ <= 0 || Ta < 10) return apparentTemp;
        // 气温越高，阳光效果越显著（高温+直晒叠加更难受）
        const tempFactor = Math.min(Math.max((Ta - 10) / 30, 0.4), 1.0);
        const sunBonus = Math.min(radMJ * 0.28 * tempFactor, 6.0);
        return apparentTemp + sunBonus;
    }

    // ==========================================
    // 4. 图表渲染
    // ==========================================
    function initOrUpdateCharts(labels, indoorData, outdoorData) {
        Chart.defaults.font.family = 'Inter';
        Chart.defaults.color = '#555555';

        const commonOptions = {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } },
                tooltip: {
                    mode: 'index', intersect: false,
                    backgroundColor: 'rgba(17,17,17,0.9)',
                    callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}°C` }
                }
            },
            scales: {
                y: { grid: { color: '#e0e0e0' }, ticks: { callback: v => v.toFixed(0) + '°' } },
                x: { grid: { display: false } }
            },
            interaction: { mode: 'nearest', axis: 'x', intersect: false }
        };

        if (indoorChartInstance) indoorChartInstance.destroy();
        indoorChartInstance = new Chart(
            document.getElementById('indoorChart').getContext('2d'),
            {
                type: 'line',
                data: {
                    labels,
                    datasets: [
                        { label: '室内体感 (高)', data: indoorData.max, borderColor: '#E65100', backgroundColor: 'rgba(230,81,0,0.1)', borderWidth: 2, fill: true, tension: 0.4 },
                        { label: '室内体感 (低)', data: indoorData.min, borderColor: '#0277BD', backgroundColor: 'transparent', borderWidth: 2, tension: 0.4 }
                    ]
                },
                options: commonOptions
            }
        );

        if (outdoorChartInstance) outdoorChartInstance.destroy();
        outdoorChartInstance = new Chart(
            document.getElementById('outdoorChart').getContext('2d'),
            {
                type: 'line',
                data: {
                    labels,
                    datasets: [
                        { label: '室外体感 (高)', data: outdoorData.max, borderColor: '#D32F2F', backgroundColor: 'rgba(211,47,47,0.1)', borderWidth: 2, fill: true, tension: 0.4 },
                        { label: '室外体感 (低)', data: outdoorData.min, borderColor: '#00838F', backgroundColor: 'transparent', borderWidth: 2, tension: 0.4 }
                    ]
                },
                options: commonOptions
            }
        );
    }

    // ==========================================
    // 5. 日期卡片渲染
    // ==========================================
    function renderDailyCards(daily) {
        els.dailyCards.innerHTML = '';
        for (let i = 0; i < daily.time.length; i++) {
            const dateObj = formatDateStr(daily.time[i]);
            const weather = getWeatherDescription(daily.weather_code[i]);
            const card = document.createElement('div');
            card.className = 'daily-card';
            card.innerHTML = `
                <span class="day-name">${i === 0 ? '今天' : dateObj.day}</span>
                <span class="day-date" style="font-size:0.75rem;color:#71787e">${dateObj.short}</span>
                <span class="day-icon">${weather.icon}</span>
                <span class="day-temp">${Math.round(daily.temperature_2m_max[i])}° / ${Math.round(daily.temperature_2m_min[i])}°</span>
            `;
            card.addEventListener('click', () => showDayDetail(i));
            els.dailyCards.appendChild(card);
        }
    }

    function showDayDetail(index) {
        if (!cachedDailyData) return;
        const d = cachedDailyData;
        const weather = getWeatherDescription(d.weather_code[index]);
        const dateObj = formatDateStr(d.time[index]);

        els.dialogDate.textContent = index === 0 ? `今天 (${dateObj.full})` : dateObj.full;
        els.dialogIcon.textContent = weather.icon;
        els.dialogDesc.textContent = weather.desc;
        els.dialogTemp.textContent = `${Math.round(d.temperature_2m_max[index])}° / ${Math.round(d.temperature_2m_min[index])}°`;
        els.dialogHumidity.textContent = `${Math.round(d.relative_humidity_2m_mean[index])}%`;

        const ws = d.wind_speed_10m_max[index];
        els.dialogWind.textContent = `${ws.toFixed(1)} km/h`;

        const formatTime = iso => new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        els.dialogSun.textContent = `${formatTime(d.sunrise[index])} / ${formatTime(d.sunset[index])}`;

        // 使用API提供的体感温度为基础
        const outATMax = calcOutdoorATWithSun(d.apparent_temperature_max[index], d.temperature_2m_max[index], d.shortwave_radiation_sum[index], true);
        const outATMin = d.apparent_temperature_min[index]; // 最低温时段通常无日照

        const inATMax = calcIndoorAT(d.apparent_temperature_max[index], d.temperature_2m_max[index], ws, d.shortwave_radiation_sum[index], true);
        const inATMin = calcIndoorAT(d.apparent_temperature_min[index], d.temperature_2m_min[index], ws * 0.4, 0, false);

        els.dialogOutdoor.textContent = `${outATMax.toFixed(1)}° / ${outATMin.toFixed(1)}°`;
        els.dialogIndoor.textContent = `${inATMax.toFixed(1)}° / ${inATMin.toFixed(1)}°`;

        els.dialog.showModal();
    }

    // ==========================================
    // 6. 地图与网络请求
    // ==========================================
    let map = L.map('map').setView([39.9042, 116.4074], 4);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '© OpenStreetMap'
    }).addTo(map);
    let marker = null;
    let myLat = null; // 记住用户真实定位坐标
    let myLon = null;

    // 点击地图选点
    map.on('click', (e) => {
        myLat = e.latlng.lat;
        myLon = e.latlng.lng;
        if (marker) marker.setLatLng(e.latlng);
        else marker = L.marker(e.latlng).addTo(map);
        fetchForecastData(myLat, myLon);
    });

    async function fetchForecastData(lat, lon) {
        els.loading.classList.remove('hidden');
        els.locStatus.textContent = '正在获取气象数据...';
        try {
            // 新增 current 字段
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
                `&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,shortwave_radiation` +
                `&daily=weather_code,temperature_2m_max,temperature_2m_min,` +
                `apparent_temperature_max,apparent_temperature_min,` +
                `sunrise,sunset,wind_speed_10m_max,` +
                `relative_humidity_2m_max,relative_humidity_2m_min,relative_humidity_2m_mean,` +
                `shortwave_radiation_sum&timezone=auto`;

            const resp = await fetch(url);
            const data = await resp.json();

            if (data && data.daily) {
                cachedDailyData = data.daily;
                const d = data.daily;
                
                // 渲染当前天气
                if (data.current) {
                    const cur = data.current;
                    const weather = getWeatherDescription(cur.weather_code);
                    
                    els.currentSection.style.display = 'block';
                    els.currentIcon.textContent = weather.icon;
                    els.currentDesc.textContent = weather.desc;
                    
                    // 计算瞬时户外体感：如果白天且有辐射，加入阳光加成
                    let currentOutAT = cur.apparent_temperature;
                    if (cur.is_day && cur.shortwave_radiation > 0 && cur.temperature_2m >= 10) {
                        const tempFactor = Math.min(Math.max((cur.temperature_2m - 10) / 30, 0.4), 1.0);
                        // 瞬时辐射W/m²转换为温度加成 (1000W/m2≈8度)
                        const sunBonus = Math.min((cur.shortwave_radiation / 1000) * 8.0 * tempFactor, 7.0);
                        currentOutAT += sunBonus;
                    }
                    
                    // 计算瞬时室内体感：反推逻辑，去除风效、辐射，加入闷热修正
                    const currentInAT = calcIndoorAT(cur.apparent_temperature, cur.temperature_2m, cur.wind_speed_10m, cur.shortwave_radiation, !!cur.is_day);
                    
                    els.currentApparentOutdoor.textContent = `${Math.round(currentOutAT)}°`;
                    els.currentApparentIndoor.textContent = `${Math.round(currentInAT)}°`;
                    els.currentReal.textContent = `气象站实测气温: ${Math.round(cur.temperature_2m)}°C`;
                    els.currentHumidity.textContent = `${Math.round(cur.relative_humidity_2m)}%`;
                    els.currentWind.textContent = `${cur.wind_speed_10m.toFixed(1)} km/h`;
                    els.currentRadiation.textContent = `${cur.shortwave_radiation} W/m²`;
                    
                    const radLevel = getRadiationLevel(cur.shortwave_radiation);
                    els.currentRadLevel.textContent = radLevel.label;
                    els.currentRadLevel.style.color = radLevel.color;
                }

                const labels = d.time.map(t => formatDateStr(t).short);

                // 室外体感：API值 + 阳光加成
                const outdoorData = {
                    max: d.apparent_temperature_max.map((at, i) =>
                        calcOutdoorATWithSun(at, d.temperature_2m_max[i], d.shortwave_radiation_sum[i], true)
                    ),
                    min: d.apparent_temperature_min.slice()
                };

                // 室内体感：从室外体感反推
                const indoorData = {
                    max: d.apparent_temperature_max.map((at, i) =>
                        calcIndoorAT(at, d.temperature_2m_max[i], d.wind_speed_10m_max[i], d.shortwave_radiation_sum[i], true)
                    ),
                    min: d.apparent_temperature_min.map((at, i) =>
                        calcIndoorAT(at, d.temperature_2m_min[i], d.wind_speed_10m_max[i] * 0.4, 0, false)
                    )
                };

                initOrUpdateCharts(labels, indoorData, outdoorData);
                renderDailyCards(d);
                els.locStatus.textContent = `定位点: ${lat.toFixed(2)}, ${lon.toFixed(2)}`;
            }
        } catch (err) {
            console.error('数据获取失败', err);
            els.locStatus.textContent = '网络请求失败，请重试';
        } finally {
            els.loading.classList.add('hidden');
        }
    }

    function requestGeolocation() {
        els.locStatus.textContent = '获取真实定位中...';

        const applyLocation = (lat, lon) => {
            myLat = lat;
            myLon = lon;
            map.setView([lat, lon], 11);
            if (marker) marker.setLatLng([lat, lon]);
            else marker = L.marker([lat, lon]).addTo(map);
            
            // 成功获取定位后折叠地图面板
            els.mapWidget.classList.add('collapsed');

            fetchForecastData(lat, lon);
        };

        if (!navigator.geolocation) {
            console.warn('浏览器不支持定位');
            els.locStatus.textContent = '浏览器不支持定位，请手动点选地图';
            return;
        }

        navigator.geolocation.getCurrentPosition(
            pos => applyLocation(pos.coords.latitude, pos.coords.longitude),
            err => {
                console.warn('原生定位失败', err);
                let reason = '定位失败';
                if (err.code === 1) reason = '您拒绝了定位权限';
                if (err.code === 2) reason = '系统定位服务未开启';
                if (err.code === 3) reason = '获取真实定位超时';
                els.locStatus.textContent = `${reason}，请在地图上手动点击`;
            },
            { enableHighAccuracy: true, timeout: 6000, maximumAge: 0 }
        );
    }

    // 初始化时直接请求定位
    requestGeolocation();
});
