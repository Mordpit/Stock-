const API_URL = 'http://localhost:5001/api';
const REFRESH_INTERVAL = 60000; // 60 วินาที (ลดการโหลดเครื่อง)

let refreshTimer;
let notifiedStocks = new Set();
let selectedPeriods = JSON.parse(localStorage.getItem('selectedPeriods') || '{}');
let currentSort = localStorage.getItem('stockSort') || 'default';
let currentSectorFilter = 'all';

// โหลดข้อมูลหุ้นเมื่อเริ่มต้น
document.addEventListener('DOMContentLoaded', () => {
    // ขอ permission สำหรับ notifications
    requestNotificationPermission();

    loadStocks();
    startAutoRefresh();
    startWorldClock();
    loadTelegramConfig();

    // Form submission
    document.getElementById('addStockForm').addEventListener('submit', handleAddStock);

    // Settings modal
    document.getElementById('settingsBtn').addEventListener('click', openSettingsModal);
    document.getElementById('settingsModalClose').addEventListener('click', closeSettingsModal);
    document.getElementById('settingsModal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeSettingsModal();
    });
    document.getElementById('telegramSettingsForm').addEventListener('submit', saveTelegramSettings);
    document.getElementById('telegramTestBtn').addEventListener('click', testTelegramNotification);

    // Event delegation สำหรับปุ่มแก้ไขและลบ - จะทำงานแม้ HTML ถูก re-render
    document.getElementById('stocksGrid').addEventListener('click', (e) => {
        const target = e.target.closest('button');
        if (!target) return;

        if (target.classList.contains('btn-edit')) {
            const symbol = target.dataset.symbol;
            const currentTarget = parseFloat(target.dataset.target);
            editStock(symbol, currentTarget);
        } else if (target.classList.contains('btn-danger')) {
            const symbol = target.dataset.symbol;
            deleteStock(symbol);
        } else if (target.classList.contains('period-btn')) {
            // Handle period selection
            const symbol = target.dataset.symbol;
            const period = target.dataset.period;
            handlePeriodChange(symbol, period, target);
        }
    });

    // Sort dropdown
    const sortDropdownBtn = document.getElementById('sortDropdownBtn');
    const sortDropdownMenu = document.getElementById('sortDropdownMenu');
    const currentSortIcon = document.getElementById('currentSortIcon');
    const sortOptions = document.querySelectorAll('.sort-option');

    // Set initial active option and icon
    sortOptions.forEach(opt => {
        if (opt.dataset.sort === currentSort) {
            opt.classList.add('active');
            currentSortIcon.textContent = opt.dataset.icon;
        }
    });

    // Toggle dropdown
    sortDropdownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        sortDropdownMenu.classList.toggle('show');
    });

    // Handle option selection
    sortOptions.forEach(opt => {
        opt.addEventListener('click', () => {
            currentSort = opt.dataset.sort;
            localStorage.setItem('stockSort', currentSort);

            // Update icon and active state
            currentSortIcon.textContent = opt.dataset.icon;
            sortOptions.forEach(o => o.classList.remove('active'));
            opt.classList.add('active');

            // Close dropdown and refresh
            sortDropdownMenu.classList.remove('show');
            displayStocks(cachedStocksData);
        });
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
        sortDropdownMenu.classList.remove('show');
        sectorDropdownMenu.classList.remove('show');
    });

    // Sector filter dropdown
    const sectorDropdownBtn = document.getElementById('sectorDropdownBtn');
    const sectorDropdownMenu = document.getElementById('sectorDropdownMenu');
    const currentSectorLabel = document.getElementById('currentSectorLabel');

    // Toggle sector dropdown
    sectorDropdownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        sectorDropdownMenu.classList.toggle('show');
        sortDropdownMenu.classList.remove('show');
    });

    // Prevent closing when clicking sort dropdown
    sortDropdownBtn.addEventListener('click', () => {
        sectorDropdownMenu.classList.remove('show');
    });

    // Edit modal
    document.getElementById('editStockForm').addEventListener('submit', saveEditStock);
    document.getElementById('modalClose').addEventListener('click', closeEditModal);
    document.getElementById('modalCancel').addEventListener('click', closeEditModal);
    document.getElementById('editModal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeEditModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeEditModal();
    });
});

/**
 * โหลดข้อมูลหุ้นจาก API
 */
async function loadStocks() {
    const stocksGrid = document.getElementById('stocksGrid');
    const refreshIndicator = document.getElementById('refreshIndicator');

    try {
        refreshIndicator.classList.add('active');

        const response = await fetch(`${API_URL}/stocks`);
        if (!response.ok) {
            throw new Error('ไม่สามารถโหลดข้อมูลได้');
        }

        const data = await response.json();
        displayStocks(data.stocks);

        // ตรวจสอบการแจ้งเตือน
        checkAlerts(data.stocks);

        // อัพเดทอัตราแลกเปลี่ยน
        updateExchangeRates();

    } catch (error) {
        console.error('Error loading stocks:', error);
        showError('เกิดข้อผิดพลาดในการโหลดข้อมูล: ' + error.message);
        stocksGrid.innerHTML = '<div class="error-message">ไม่สามารถโหลดข้อมูลหุ้นได้</div>';
    } finally {
        refreshIndicator.classList.remove('active');
    }
}

/**
 * อัพเดทอัตราแลกเปลี่ยน
 */
async function updateExchangeRates() {
    try {
        const response = await fetch(`${API_URL}/rates`);
        if (!response.ok) return;

        const rates = await response.json();
        const ticker = document.getElementById('currencyTicker');

        if (rates && ticker) {
            ticker.innerHTML = `
                <div class="currency-item">
                    <span class="currency-pair">USD/THB</span>
                    <span class="currency-value ${rates.USD.change >= 0 ? 'up' : 'down'}">
                        ${rates.USD.rate.toFixed(2)} 
                        <span style="font-size: 0.85em;">${rates.USD.change >= 0 ? '▲' : '▼'} ${Math.abs(rates.USD.change).toFixed(2)}%</span>
                    </span>
                </div>
                <div class="currency-item">
                    <span class="currency-pair">JPY/THB (100¥)</span>
                    <span class="currency-value ${rates.JPY.change >= 0 ? 'up' : 'down'}">
                        ${rates.JPY.rate.toFixed(2)}
                        <span style="font-size: 0.85em;">${rates.JPY.change >= 0 ? '▲' : '▼'} ${Math.abs(rates.JPY.change).toFixed(2)}%</span>
                    </span>
                </div>
                <div class="currency-item">
                    <span class="currency-pair">CNY/THB</span>
                    <span class="currency-value ${rates.CNY.change >= 0 ? 'up' : 'down'}">
                        ${rates.CNY.rate.toFixed(2)}
                        <span style="font-size: 0.85em;">${rates.CNY.change >= 0 ? '▲' : '▼'} ${Math.abs(rates.CNY.change).toFixed(2)}%</span>
                    </span>
                </div>
            `;
        }
    } catch (e) {
        console.error('Error fetching rates:', e);
    }
}

/**
 * แสดงรายการหุ้น
 */
async function displayStocks(stocks) {
    const stocksGrid = document.getElementById('stocksGrid');

    // เก็บข้อมูลหุ้นไว้ใน cache
    cachedStocksData = stocks || [];

    if (!stocks || stocks.length === 0) {
        stocksGrid.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📊</div>
                <p>ยังไม่มีหุ้นในรายการติดตาม</p>
                <p style="font-size: 0.9rem; margin-top: 10px;">เพิ่มหุ้นแรกของคุณเพื่อเริ่มต้น</p>
            </div>
        `;
        return;
    }

    // ดึง change_percent จาก 1D สำหรับ sort
    await Promise.all(stocks.map(async (stock) => {
        if (!stock.error) {
            try {
                const response = await fetch(`${API_URL}/change/${stock.symbol}?period=1d`);
                if (response.ok) {
                    const data = await response.json();
                    if (data.change_percent !== null && data.change_percent !== undefined) {
                        stock.change_percent = data.change_percent;
                    }
                }
            } catch (e) { /* keep original */ }
        }
    }));

    // สร้างรายการ sectors ที่มีในหุ้นทั้งหมด
    const sectors = new Set();
    stocks.forEach(stock => {
        if (stock.sector && stock.sector !== 'Other') {
            sectors.add(stock.sector);
        }
    });

    // อัพเดท sector dropdown menu
    const sectorDropdownMenu = document.getElementById('sectorDropdownMenu');
    const currentSectorLabel = document.getElementById('currentSectorLabel');
    if (sectorDropdownMenu) {
        sectorDropdownMenu.innerHTML = `
            <div class="sector-option ${currentSectorFilter === 'all' ? 'active' : ''}" data-sector="all">ทุกประเภท</div>
            ${Array.from(sectors).sort().map(sector =>
            `<div class="sector-option ${currentSectorFilter === sector ? 'active' : ''}" data-sector="${sector}">${sector}</div>`
        ).join('')}
        `;

        // เพิ่ม event listeners สำหรับ sector options
        const sectorOptions = sectorDropdownMenu.querySelectorAll('.sector-option');
        sectorOptions.forEach(opt => {
            opt.addEventListener('click', () => {
                currentSectorFilter = opt.dataset.sector;
                currentSectorLabel.textContent = currentSectorFilter === 'all' ? 'ทุกประเภท' : currentSectorFilter;

                // Close dropdown and refresh
                sectorDropdownMenu.classList.remove('show');
                displayStocks(cachedStocksData);
            });
        });
    }

    // Filter stocks by sector
    let filteredStocks = currentSectorFilter === 'all'
        ? stocks
        : stocks.filter(stock => stock.sector === currentSectorFilter);

    // Sort and render ด้วย change_percent ที่ถูกต้องแล้ว
    const sorted = sortStocks([...filteredStocks]);
    stocksGrid.innerHTML = sorted.map(stock => createStockCard(stock)).join('');

    // แสดงกราฟและอัพเดท % ตาม period ที่เลือก
    sorted.forEach(stock => {
        if (!stock.error) {
            const period = selectedPeriods[stock.symbol] || '1d';
            renderChart(stock.symbol, stock.target, stock.target_sell || 0, period);

            // อัพเดท % ให้ตรงกับ period ที่เลือก (ถ้าไม่ใช่ 1D)
            if (period !== '1d') {
                const card = document.querySelector(`#chart-${stock.symbol}`)?.closest('.stock-card');
                if (card) {
                    updateChangePercent(stock.symbol, period, card);
                }
            }
        }
    });
}

/**
 * เรียงลำดับหุ้นตามตัวเลือก
 */
function sortStocks(stocks) {
    switch (currentSort) {
        case 'growth':
            return stocks.sort((a, b) => (b.change_percent || 0) - (a.change_percent || 0));
        case 'decline':
            return stocks.sort((a, b) => (a.change_percent || 0) - (b.change_percent || 0));
        case 'name':
            return stocks.sort((a, b) => a.symbol.localeCompare(b.symbol));
        default:
            return stocks;
    }
}

/**
 * สร้างการ์ดหุ้น
 */
function createStockCard(stock) {
    const isReached = stock.reached;
    const isReachedSell = stock.reached_sell;
    const cardClass = (isReached || isReachedSell) ? 'stock-card alert' : 'stock-card';

    let alertBadge = '';
    if (isReached) alertBadge += '<span class="alert-badge">🚨 ถึงราคาเข้าซื้อแล้ว!</span>';
    if (isReachedSell) alertBadge += '<span class="alert-badge" style="background: linear-gradient(135deg, var(--accent-1), var(--accent-2));">🎯 ถึงราคาเป้าหมายแล้ว!</span>';

    // กำหนดสีราคาปัจจุบันตามการเติบโต
    let priceClass = 'price-value current';
    if (stock.change_percent !== null && stock.change_percent !== undefined) {
        priceClass = stock.change_percent >= 0 ? 'price-value current price-up' : 'price-value current price-down';
    }
    const errorInfo = stock.error ? `<div style="color: var(--danger); font-size: 0.85rem; margin-top: 10px;">${stock.error}</div>` : '';

    // สร้างแสดงเปอร์เซ็นต์การเปลี่ยนแปลง
    let changeDisplay = '';
    if (stock.change_percent !== null && stock.change_percent !== undefined) {
        const isPositive = stock.change_percent >= 0;
        const changeClass = isPositive ? 'change-positive' : 'change-negative';
        const changeIcon = isPositive ? '▲' : '▼';
        const changeText = isPositive ? `+${stock.change_percent.toFixed(2)}%` : `${stock.change_percent.toFixed(2)}%`;
        changeDisplay = `<span class="price-change ${changeClass}">${changeIcon} ${changeText}</span>`;
    }

    // กำหนดสี badge ตาม sector
    const sectorColors = {
        'Technology': '#2f81f7',
        'Financial Services': '#2ea043',
        'Healthcare': '#da3633',
        'Energy': '#d29922',
        'Consumer Cyclical': '#a371f7',
        'Consumer Defensive': '#8956ff',
        'Communication Services': '#1f6feb',
        'Industrials': '#58a6ff',
        'Real Estate': '#f78166',
        'Basic Materials': '#79c0ff',
        'Utilities': '#56d364'
    };
    const sectorColor = sectorColors[stock.sector] || '#7d8590';
    const sectorBadge = stock.sector ? `<span class="sector-badge" style="background-color: ${sectorColor}20; color: ${sectorColor}; border-color: ${sectorColor}40;">${stock.sector}</span>` : '';

    // แสดงราคาเป้าหมาย (ถ้ามี)
    const targetSell = stock.target_sell || 0;
    const targetSellRow = targetSell > 0 ? `
                <div class="price-row">
                    <span class="price-label">ราคาเป้าหมาย</span>
                    <span class="price-value" style="color: var(--accent-1);">$${targetSell.toFixed(2)}</span>
                </div>` : '';

    return `
        <div class="${cardClass}">
            <div class="stock-header">
                <div class="stock-info">
                    <h3>${stock.symbol}</h3>
                    <p class="stock-name">${stock.name}</p>
                    ${sectorBadge}
                </div>
                <div style="display: flex; flex-direction: column; gap: 5px; align-items: flex-end;">
                    ${alertBadge}
                </div>
            </div>
            
            <div class="stock-prices">
                <div class="price-row">
                    <span class="price-label">ราคาปัจจุบัน</span>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span class="${priceClass}">$${stock.current.toFixed(2)}</span>
                        ${changeDisplay}
                    </div>
                </div>
                <div class="price-row">
                    <span class="price-label">ราคาเข้าซื้อ</span>
                    <span class="price-value target">$${stock.target.toFixed(2)}</span>
                </div>
                ${targetSellRow}
            </div>
            
            ${errorInfo}
            
            <div class="chart-period-selector">
                <button class="period-btn${(selectedPeriods[stock.symbol] || '1d') === '1d' ? ' active' : ''}" data-symbol="${stock.symbol}" data-period="1d">1D</button>
                <button class="period-btn${(selectedPeriods[stock.symbol] || '1d') === '1wk' ? ' active' : ''}" data-symbol="${stock.symbol}" data-period="1wk">5D</button>
                <button class="period-btn${(selectedPeriods[stock.symbol] || '1d') === '1mo' ? ' active' : ''}" data-symbol="${stock.symbol}" data-period="1mo">1M</button>
                <button class="period-btn${(selectedPeriods[stock.symbol] || '1d') === '1y' ? ' active' : ''}" data-symbol="${stock.symbol}" data-period="1y">1Y</button>
                <button class="period-btn${(selectedPeriods[stock.symbol] || '1d') === '5y' ? ' active' : ''}" data-symbol="${stock.symbol}" data-period="5y">5Y</button>
            </div>
            
            <div class="chart-container">
                <canvas id="chart-${stock.symbol}"></canvas>
            </div>
            
            <div class="stock-actions">
                <button class="btn btn-edit" data-symbol="${stock.symbol}" data-target="${stock.target}" data-target-sell="${targetSell}">✏️ แก้ไข</button>
                <button class="btn btn-danger" data-symbol="${stock.symbol}">🗑️ ลบ</button>
            </div>
        </div>
    `;
}

/**
 * เพิ่มหุ้นใหม่
 */
async function handleAddStock(e) {
    e.preventDefault();

    const symbol = document.getElementById('stockSymbol').value.trim().toUpperCase();
    const target = parseFloat(document.getElementById('targetPrice').value);
    const targetSell = parseFloat(document.getElementById('targetSellPrice').value) || 0;

    if (!symbol || !target || target <= 0) {
        showError('กรุณากรอกข้อมูลให้ครบถ้วน');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/stocks`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ symbol, target, target_sell: targetSell })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'ไม่สามารถเพิ่มหุ้นได้');
        }

        // Clear form
        document.getElementById('addStockForm').reset();

        // Reload stocks
        await loadStocks();

        hideError();

    } catch (error) {
        console.error('Error adding stock:', error);
        showError(error.message);
    }
}

/**
 * แก้ไขหุ้น - เปิด modal form
 */
function editStock(symbol, currentTarget) {
    const btn = document.querySelector(`[data-symbol="${symbol}"].btn-edit`);
    const currentTargetSell = btn ? parseFloat(btn.dataset.targetSell) || 0 : 0;

    // หาชื่อหุ้นจาก cached data
    const stock = cachedStocksData.find(s => s.symbol === symbol);
    const stockName = (stock && stock.name && stock.name !== symbol) ? `${symbol} - ${stock.name}` : symbol;

    // เติมค่าลงฟอร์ม
    document.getElementById('editSymbol').value = symbol;
    document.getElementById('editStockName').value = stockName;
    document.getElementById('editTarget').value = currentTarget;
    document.getElementById('editTargetSell').value = currentTargetSell || '';

    // เปิด modal
    document.getElementById('editModal').classList.add('active');
    document.getElementById('editTarget').focus();
}

/**
 * ปิด modal
 */
function closeEditModal() {
    document.getElementById('editModal').classList.remove('active');
}

/**
 * บันทึกการแก้ไขหุ้น
 */
async function saveEditStock(e) {
    e.preventDefault();

    const symbol = document.getElementById('editSymbol').value;
    const target = parseFloat(document.getElementById('editTarget').value);
    const targetSell = parseFloat(document.getElementById('editTargetSell').value) || 0;

    if (isNaN(target) || target <= 0) {
        showError('ราคาเข้าซื้อไม่ถูกต้อง');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/stocks/${symbol}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ target, target_sell: targetSell })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'ไม่สามารถอัพเดทได้');
        }

        closeEditModal();
        await loadStocks();

    } catch (error) {
        console.error('Error updating stock:', error);
        showError(error.message);
    }
}

/**
 * ลบหุ้น
 */
async function deleteStock(symbol) {
    if (!confirm(`ต้องการลบ ${symbol} ออกจากรายการหรือไม่?`)) {
        return;
    }

    try {
        const response = await fetch(`${API_URL}/stocks/${symbol}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'ไม่สามารถลบได้');
        }

        await loadStocks();
        hideError();

    } catch (error) {
        console.error('Error deleting stock:', error);
        showError(error.message);
    }
}

/**
 * ตรวจสอบการแจ้งเตือน
 */
function checkAlerts(stocks) {
    stocks.forEach(stock => {
        // แจ้งเตือนเมื่อถึงราคาเข้าซื้อ
        if (stock.reached && !notifiedStocks.has(stock.symbol + '_buy')) {
            showNotification(stock, 'buy');
            sendTelegramAlert(stock, 'buy');
            notifiedStocks.add(stock.symbol + '_buy');
        } else if (!stock.reached && notifiedStocks.has(stock.symbol + '_buy')) {
            notifiedStocks.delete(stock.symbol + '_buy');
        }

        // แจ้งเตือนเมื่อถึงราคาเป้าหมาย
        if (stock.reached_sell && !notifiedStocks.has(stock.symbol + '_sell')) {
            showNotification(stock, 'sell');
            sendTelegramAlert(stock, 'sell');
            notifiedStocks.add(stock.symbol + '_sell');
        } else if (!stock.reached_sell && notifiedStocks.has(stock.symbol + '_sell')) {
            notifiedStocks.delete(stock.symbol + '_sell');
        }
    });
}

/**
 * เริ่มการอัพเดทอัตโนมัติ
 */
function startAutoRefresh() {
    refreshTimer = setInterval(() => {
        loadStocks();
        updateExchangeRates();
    }, REFRESH_INTERVAL);
}

/**
 * หยุดการอัพเดทอัตโนมัติ
 */
function stopAutoRefresh() {
    if (refreshTimer) {
        clearInterval(refreshTimer);
    }
}

/**
 * แสดงข้อความผิดพลาด
 */
function showError(message) {
    const errorElement = document.getElementById('errorMessage');
    errorElement.textContent = message;
    errorElement.style.display = 'block';

    // Auto hide after 5 seconds
    setTimeout(hideError, 5000);
}

/**
 * ซ่อนข้อความผิดพลาด
 */
function hideError() {
    const errorElement = document.getElementById('errorMessage');
    errorElement.style.display = 'none';
}

/**
 * ขอ permission สำหรับการแจ้งเตือน
 */
function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                console.log('✅ Notification permission granted');
            }
        });
    }
}

/**
 * แสดงการแจ้งเตือนแบบ Desktop Notification
 */
function showNotification(stock, type = 'buy') {
    if ('Notification' in window && Notification.permission === 'granted') {
        let title, body, icon;

        if (type === 'buy') {
            title = '💰 หุ้นถึงราคาเข้าซื้อแล้ว!';
            body = `${stock.symbol} (${stock.name})\nราคาปัจจุบัน: $${stock.current.toFixed(2)}\nราคาเข้าซื้อ: $${stock.target.toFixed(2)}`;
            icon = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="75" font-size="75">📉</text></svg>';
        } else {
            title = '🎯 หุ้นถึงราคาเป้าหมายแล้ว!';
            body = `${stock.symbol} (${stock.name})\nราคาปัจจุบัน: $${stock.current.toFixed(2)}\nราคาเป้าหมาย: $${stock.target_sell.toFixed(2)}`;
            icon = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="75" font-size="75">�</text></svg>';
        }

        const notification = new Notification(title, {
            body: body,
            icon: icon,
            badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="75" font-size="75">🎯</text></svg>',
            tag: stock.symbol,
            requireInteraction: false,
            vibrate: [200, 100, 200]
        });

        // Auto close after 10 seconds
        setTimeout(() => notification.close(), 10000);

        // เล่นเสียงแจ้งเตือน
        playNotificationSound();
    }
}

/**
 * เล่นเสียงแจ้งเตือน
 */
function playNotificationSound() {
    try {
        // สร้างเสียง beep ง่ายๆ ด้วย Web Audio API
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.value = 800;
        oscillator.type = 'sine';

        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.5);
    } catch (error) {
        console.log('Could not play notification sound:', error);
    }
}

/**
 * จัดการการเปลี่ยนช่วงเวลากราฟ
 */
async function handlePeriodChange(symbol, period, clickedButton) {
    // บันทึก period ที่เลือกลง localStorage
    selectedPeriods[symbol] = period;
    localStorage.setItem('selectedPeriods', JSON.stringify(selectedPeriods));

    // อัพเดท active state ของปุ่ม
    const card = clickedButton.closest('.stock-card');
    const allPeriodBtns = card.querySelectorAll('.period-btn');
    allPeriodBtns.forEach(btn => btn.classList.remove('active'));
    clickedButton.classList.add('active');

    // เรนเดอร์กราฟใหม่ด้วย period ที่เลือก
    const data = loadStocksData();
    const stock = data.find(s => s.symbol === symbol);
    if (stock) {
        renderChart(symbol, stock.target, stock.target_sell || 0, period);

        // อัพเดทเปอร์เซ็นต์การเปลี่ยนแปลงตาม period
        await updateChangePercent(symbol, period, card);
    }
}

/**
 * อัพเดทเปอร์เซ็นต์การเปลี่ยนแปลงตามช่วงเวลา
 */
async function updateChangePercent(symbol, period, card) {
    try {
        const response = await fetch(`${API_URL}/change/${symbol}?period=${period}`);
        if (!response.ok) {
            throw new Error('ไม่สามารถดึงข้อมูลการเปลี่ยนแปลงได้');
        }

        const data = await response.json();
        if (data.change_percent !== null && data.change_percent !== undefined) {
            const isPositive = data.change_percent >= 0;
            const changeClass = isPositive ? 'change-positive' : 'change-negative';
            const changeIcon = isPositive ? '▲' : '▼';
            const changeText = isPositive ? `+${data.change_percent.toFixed(2)}%` : `${data.change_percent.toFixed(2)}%`;

            // อัพเดทเปอร์เซ็นต์
            const changeElement = card.querySelector('.price-change');
            if (changeElement) {
                changeElement.className = `price-change ${changeClass}`;
                changeElement.innerHTML = `${changeIcon} ${changeText}`;
            }

            // อัพเดทสีราคาปัจจุบันตามการเปลี่ยนแปลง
            const priceElement = card.querySelector('.price-value.current');
            if (priceElement) {
                priceElement.classList.remove('price-up', 'price-down');
                priceElement.classList.add(isPositive ? 'price-up' : 'price-down');
            }
        }
    } catch (error) {
        console.error(`Error updating change percent for ${symbol}:`, error);
    }
}

/**
 * เก็บข้อมูลหุ้นล่าสุด (สำหรับใช้ใน handlePeriodChange)
 */
let cachedStocksData = [];
function loadStocksData() {
    return cachedStocksData;
}

/**
 * แสดงกราฟราคาหุ้น
 */
async function renderChart(symbol, targetPrice, targetSellPrice, period = '1wk') {
    try {
        const response = await fetch(`${API_URL}/history/${symbol}?period=${period}`);
        if (!response.ok) {
            throw new Error('ไม่สามารถดึงข้อมูลกราฟได้');
        }

        const data = await response.json();
        const ctx = document.getElementById(`chart-${symbol}`);

        if (!ctx) return;

        // ทำลาย chart เก่าถ้ามี
        const existingChart = Chart.getChart(ctx);
        if (existingChart) {
            existingChart.destroy();
        }

        // กำหนดสีตามการเติบโต: เขียว = เพิ่ม, แดง = ลด
        const firstPrice = data.prices[0];
        const lastPrice = data.prices[data.prices.length - 1];
        const isGrowing = lastPrice >= firstPrice;

        const lineColor = isGrowing ? 'rgba(16, 185, 129, 1)' : 'rgba(239, 68, 68, 1)';
        const fillColor = isGrowing ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)';

        // สร้าง datasets
        const datasets = [
            {
                label: 'ราคา',
                data: data.prices,
                borderColor: lineColor,
                backgroundColor: fillColor,
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointRadius: 0,
                pointHoverRadius: 5,
                pointHoverBackgroundColor: lineColor,
            },
            {
                label: 'ราคาเข้าซื้อ',
                data: Array(data.dates.length).fill(targetPrice),
                borderColor: 'rgba(251, 191, 36, 0.8)',
                borderWidth: 2,
                borderDash: [5, 5],
                fill: false,
                pointRadius: 0,
            }
        ];

        // เพิ่มเส้นราคาเป้าหมาย (ถ้ามีค่า)
        if (targetSellPrice > 0) {
            datasets.push({
                label: 'ราคาเป้าหมาย',
                data: Array(data.dates.length).fill(targetSellPrice),
                borderColor: 'rgba(99, 102, 241, 0.8)',
                borderWidth: 2,
                borderDash: [8, 4],
                fill: false,
                pointRadius: 0,
            });
        }

        // สร้างกราฟใหม่
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.dates,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: {
                            color: 'rgba(255, 255, 255, 0.8)',
                            font: {
                                size: 11
                            },
                            boxWidth: 30,
                            padding: 10
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        titleColor: '#fff',
                        bodyColor: '#fff',
                        borderColor: 'rgba(99, 102, 241, 0.5)',
                        borderWidth: 1,
                        padding: 10,
                        displayColors: true,
                        callbacks: {
                            label: function (context) {
                                let label = context.dataset.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                label += '$' + context.parsed.y.toFixed(2);
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        display: true,
                        grid: {
                            display: false
                        },
                        ticks: {
                            color: 'rgba(255, 255, 255, 0.5)',
                            font: {
                                size: 10
                            },
                            maxTicksLimit: 7
                        }
                    },
                    y: {
                        display: true,
                        grid: {
                            color: 'rgba(255, 255, 255, 0.05)'
                        },
                        ticks: {
                            color: 'rgba(255, 255, 255, 0.5)',
                            font: {
                                size: 10
                            },
                            callback: function (value) {
                                return '$' + value.toFixed(0);
                            }
                        }
                    }
                },
                interaction: {
                    intersect: false,
                    mode: 'index'
                }
            }
        });
    } catch (error) {
        console.error(`Error rendering chart for ${symbol}:`, error);
    }
}

/**
 * เริ่มต้นนาฬิกาโลก
 */
function startWorldClock() {
    updateWorldClock();
    setInterval(updateWorldClock, 1000);
}

/**
 * อัพเดทเวลาทั่วโลก
 */
function updateWorldClock() {
    const options = { hour: '2-digit', minute: '2-digit', hour12: false };

    // Bangkok (UTC+7)
    const bkkTime = new Date().toLocaleTimeString('en-GB', { ...options, timeZone: 'Asia/Bangkok' });
    document.getElementById('time-bkk').textContent = bkkTime;

    // New York (UTC-5/UTC-4)
    const nycTime = new Date().toLocaleTimeString('en-GB', { ...options, timeZone: 'America/New_York' });
    document.getElementById('time-nyc').textContent = nycTime;

    // Beijing (UTC+8)
    const beiTime = new Date().toLocaleTimeString('en-GB', { ...options, timeZone: 'Asia/Shanghai' });
    document.getElementById('time-bei').textContent = beiTime;

    // Tokyo (UTC+9)
    const tyoTime = new Date().toLocaleTimeString('en-GB', { ...options, timeZone: 'Asia/Tokyo' });
    document.getElementById('time-tyo').textContent = tyoTime;
}

// Stop auto-refresh when page is hidden
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopAutoRefresh();
    } else {
        loadStocks();
        startAutoRefresh();
    }
});

// ==========================================
// Telegram Notification Functions
// ==========================================

let telegramEnabled = false;

/**
 * โหลดการตั้งค่า Telegram จาก backend
 */
async function loadTelegramConfig() {
    try {
        const response = await fetch(`${API_URL}/telegram/config`);
        if (!response.ok) return;
        const data = await response.json();
        telegramEnabled = data.has_token && !!data.chat_id;

        // อัพเดท status dot
        const dot = document.getElementById('telegramStatusDot');
        if (dot) {
            dot.className = telegramEnabled
                ? 'telegram-dot telegram-dot-active'
                : 'telegram-dot telegram-dot-inactive';
        }
    } catch (e) {
        console.log('Could not load Telegram config:', e);
    }
}

/**
 * เปิด Settings modal + โหลดค่าเดิม
 */
async function openSettingsModal() {
    document.getElementById('settingsModal').classList.add('active');
    hideTelegramFeedback();
    try {
        const response = await fetch(`${API_URL}/telegram/config`);
        if (response.ok) {
            const data = await response.json();
            const tokenInput = document.getElementById('telegramBotToken');
            const tokenStatus = document.getElementById('telegramTokenStatus');
            const chatIdInput = document.getElementById('telegramChatId');

            if (data.has_token) {
                tokenInput.placeholder = data.masked_token;
                tokenInput.value = '';
                tokenStatus.textContent = '\u2705 มีการตั้งค่าแล้ว (กรอกใหม่เพื่อเปลี่ยน)';
                tokenStatus.style.color = '#56d364';
            } else {
                tokenStatus.textContent = '';
            }
            chatIdInput.value = data.chat_id || '';
        }
    } catch (e) { /* ignore */ }
}

/**
 * ปิด Settings modal
 */
function closeSettingsModal() {
    document.getElementById('settingsModal').classList.remove('active');
}

/**
 * บันทึกการตั้งค่า Telegram
 */
async function saveTelegramSettings(e) {
    e.preventDefault();
    const botToken = document.getElementById('telegramBotToken').value.trim();
    const chatId = document.getElementById('telegramChatId').value.trim();

    // ถ้าไม่ได้กรอก token ใหม่ให้โหลดค่าเดิมมาใช้
    let finalToken = botToken;
    if (!finalToken) {
        try {
            const cfg = await fetch(`${API_URL}/telegram/config`);
            if (cfg.ok) {
                // token ถูกซ่อน เราต้องการให้ user กรอกใหม่
                showTelegramFeedback('กรุณากรอก Bot Token ด้วย', false);
                return;
            }
        } catch (e) { /* ignore */ }
    }

    if (!chatId) {
        showTelegramFeedback('กรุณากรอก Chat ID', false);
        return;
    }

    try {
        const response = await fetch(`${API_URL}/telegram/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bot_token: finalToken, chat_id: chatId })
        });
        const data = await response.json();
        if (response.ok) {
            showTelegramFeedback('\u2705 ' + data.message, true);
            await loadTelegramConfig();
        } else {
            showTelegramFeedback('\u274c ' + (data.error || 'เกิดข้อผิดพลาด'), false);
        }
    } catch (err) {
        showTelegramFeedback('\u274c ไม่สามารถเชื่อมต่อได้: ' + err.message, false);
    }
}

/**
 * ทดสอบการส่งข้อความ Telegram
 */
async function testTelegramNotification() {
    const btn = document.getElementById('telegramTestBtn');
    btn.disabled = true;
    btn.textContent = '\uD83D\uDD04 กำลังส่ง...';
    hideTelegramFeedback();

    try {
        const response = await fetch(`${API_URL}/telegram/test`, { method: 'POST' });
        const data = await response.json();
        if (response.ok) {
            showTelegramFeedback('\u2705 ' + data.message, true);
        } else {
            showTelegramFeedback('\u274c ' + (data.error || 'เกิดข้อผิดพลาด'), false);
        }
    } catch (err) {
        showTelegramFeedback('\u274c ไม่สามารถเชื่อมต่อได้: ' + err.message, false);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '&#128172; ทดสอบส่งข้อความ';
    }
}

/**
 * ส่งการแจ้งเตือนราคาหุ้นผ่าน Telegram
 */
async function sendTelegramAlert(stock, type) {
    if (!telegramEnabled) return;
    try {
        await fetch(`${API_URL}/telegram/notify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                symbol: stock.symbol,
                name: stock.name,
                current: stock.current,
                target: type === 'buy' ? stock.target : stock.target_sell,
                type: type
            })
        });
    } catch (e) {
        console.log('Could not send Telegram alert:', e);
    }
}

/**
 * แสดง feedback ใน Settings modal
 */
function showTelegramFeedback(message, isSuccess) {
    const el = document.getElementById('telegramFeedback');
    el.textContent = message;
    el.style.display = 'block';
    el.className = 'telegram-feedback ' + (isSuccess ? 'feedback-success' : 'feedback-error');
}

function hideTelegramFeedback() {
    const el = document.getElementById('telegramFeedback');
    if (el) el.style.display = 'none';
}
