const API = window.location.origin + '/api';
let token = localStorage.getItem('token');
let currentClientId = null;

// Selectors
const screens = {
    login: document.getElementById('login-screen'),
    dashboard: document.getElementById('dashboard')
};

const forms = {
    login: document.getElementById('login-form'),
    addClient: document.getElementById('add-client-form'),
    obfuscation: document.getElementById('obfuscation-form'),
    password: document.getElementById('password-form')
};

const modals = {
    add: document.getElementById('add-modal'),
    client: document.getElementById('client-modal'),
    settings: document.getElementById('settings-modal')
};

document.addEventListener('DOMContentLoaded', () => {
    if (token) showDashboard();
    
    // Auth & Navigation
    forms.login.addEventListener('submit', handleLogin);
    document.getElementById('logout-btn').addEventListener('click', handleLogout);
    
    // Modal controls
    document.getElementById('add-client-btn').addEventListener('click', () => showModal(modals.add));
    document.getElementById('settings-btn').addEventListener('click', openSettings);
    
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', (e) => hideModal(e.target.closest('.modal')));
    });
    
    document.querySelectorAll('.modal-backdrop').forEach(bd => {
        bd.addEventListener('click', (e) => hideModal(e.target.closest('.modal')));
    });
    
    // Actions
    forms.addClient.addEventListener('submit', handleAddClient);
    document.getElementById('update-ips-btn').addEventListener('click', handleUpdateIps);
    document.getElementById('download-config-btn').addEventListener('click', handleDownloadConfig);
    document.getElementById('copy-config-btn').addEventListener('click', handleCopyConfig);
    document.getElementById('toggle-client-btn').addEventListener('click', handleToggleClient);
    document.getElementById('delete-client-btn').addEventListener('click', handleDeleteClient);
    
    // Settings actions
    forms.password.addEventListener('submit', handleChangePassword);
    document.getElementById('save-obfuscation-btn').addEventListener('click', handleSaveObfuscation);
    
    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');
        });
    });
});

async function api(endpoint, options = {}) {
    const res = await fetch(`${API}${endpoint}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options.headers,
            'Authorization': `Bearer ${token}`
        }
    });
    
    if (res.status === 401) {
        handleLogout();
        return null;
    }
    
    if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.detail || 'Request failed');
    }
    
    return res;
}

async function handleLogin(e) {
    e.preventDefault();
    const btn = forms.login.querySelector('button');
    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Загрузка...`;
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorEl = document.getElementById('login-error');
    
    try {
        const res = await fetch(`${API}/auth/login`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({username, password})
        });
        
        if (!res.ok) throw new Error('Неверные учетные данные или сработал лимит защиты');
        
        const data = await res.json();
        token = data.access_token;
        localStorage.setItem('token', token);
        errorEl.classList.add('hidden');
        showDashboard();
    } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
    } finally {
        btn.innerHTML = `<span>Войти</span> <i class="fa-solid fa-arrow-right"></i>`;
    }
}

function handleLogout() {
    token = null;
    localStorage.removeItem('token');
    screens.dashboard.classList.add('hidden');
    screens.login.classList.remove('hidden');
}

function showDashboard() {
    screens.login.classList.add('hidden');
    screens.dashboard.classList.remove('hidden');
    refreshAll();
    setInterval(refreshAll, 10000); // 10s for lively dashboard
}

function refreshAll() {
    if (!token) return;
    loadStats();
    loadSystemStats();
    loadRoutingStatus();
    loadClients();
}

async function loadStats() {
    const res = await api('/stats');
    if (!res) return;
    const data = await res.json();
    
    document.getElementById('total-clients').textContent = data.total_clients;
    document.getElementById('active-clients').textContent = data.active_clients;
    document.getElementById('total-upload').textContent = formatBytes(data.total_upload);
    document.getElementById('total-download').textContent = formatBytes(data.total_download);
    document.getElementById('server-uptime').textContent = data.server_uptime;
}

async function loadSystemStats() {
    const res = await api('/system/stats').catch(() => null);
    if (!res) return;
    const data = await res.json();
    
    // CPU
    document.getElementById('res-cpu-text').textContent = `${data.cpu}%`;
    document.getElementById('res-cpu-bar').style.width = `${data.cpu}%`;
    
    // RAM
    const ramTotal = (data.ram.total / 1e9).toFixed(1);
    const ramUsed = (data.ram.used / 1e9).toFixed(1);
    document.getElementById('res-ram-text').textContent = `${data.ram.percent}%`;
    document.getElementById('res-ram-label').textContent = `${ramUsed}/${ramTotal} GB`;
    document.getElementById('res-ram-bar').style.width = `${data.ram.percent}%`;
    
    // Disk
    const diskTotal = (data.disk.total / 1e9).toFixed(1);
    const diskUsed = (data.disk.used / 1e9).toFixed(1);
    document.getElementById('res-disk-text').textContent = `${data.disk.percent}%`;
    document.getElementById('res-disk-label').textContent = `${diskUsed}/${diskTotal} GB`;
    document.getElementById('res-disk-bar').style.width = `${data.disk.percent}%`;
}

async function loadRoutingStatus() {
    const res = await api('/routing/status');
    if (!res) return;
    const data = await res.json();
    
    const tunnelEl = document.getElementById('tunnel-status');
    tunnelEl.textContent = data.tunnel.status === 'up' ? 'Работает' : 'Отключен';
    tunnelEl.className = 'status-badge ' + (data.tunnel.status === 'up' ? 'online' : 'offline');
    
    const ipsetEl = document.getElementById('ipset-status');
    ipsetEl.textContent = data.ipset.status === 'active' ? `${data.ipset.entries} адресов` : 'Неактивен';
    ipsetEl.className = 'status-badge ' + (data.ipset.status === 'active' ? 'online' : 'offline');
}

async function loadClients() {
    const res = await api('/clients');
    if (!res) return;
    const clients = await res.json();
    const list = document.getElementById('clients-list');
    
    if (clients.length === 0) {
        list.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2rem; color: #94a3b8;">Нет VPN клиентов.</td></tr>`;
        return;
    }
    
    list.innerHTML = clients.map(client => `
        <tr class="client-row" onclick="openClientDetails(${client.id})">
            <td><div class="status-dot ${client.is_active ? 'active' : ''}"></div></td>
            <td style="font-weight: 500;">${escapeHtml(client.name)}</td>
            <td style="font-family: monospace;">${client.address}</td>
            <td class="table-stats"><span><i class="fa-solid fa-arrow-up"></i> ${formatBytes(client.upload_bytes)}</span></td>
            <td class="table-stats"><span><i class="fa-solid fa-arrow-down"></i> ${formatBytes(client.download_bytes)}</span></td>
            <td style="color: var(--text-secondary); font-size: 0.85rem;">${client.last_handshake ? formatTime(client.last_handshake) : 'Никогда'}</td>
        </tr>
    `).join('');
}

async function handleUpdateIps() {
    const btn = document.getElementById('update-ips-btn');
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Обновляем...';
    btn.disabled = true;
    try {
        await api('/routing/update-ips', {method: 'POST'});
        await loadRoutingStatus();
    } catch (err) {
        alert('Ошибка обновления: ' + err.message);
    }
    btn.innerHTML = 'Обновить IP РФ';
    btn.disabled = false;
}

async function handleAddClient(e) {
    e.preventDefault();
    const name = document.getElementById('client-name').value;
    const btn = forms.addClient.querySelector('button');
    btn.disabled = true;
    
    try {
        const res = await api('/clients', {
            method: 'POST',
            body: JSON.stringify({name})
        });
        if (!res) return;
        hideModal(modals.add);
        document.getElementById('client-name').value = '';
        refreshAll();
        
        const client = await res.json();
        openClientDetails(client.id);
    } catch (err) {
        alert('Ошибка: ' + err.message);
    }
    btn.disabled = false;
}

async function openClientDetails(id) {
    currentClientId = id;
    try {
        const qrRes = await api(`/clients/${id}/qr`);
        if (!qrRes) return;
        
        const blob = await qrRes.blob();
        document.getElementById('client-qr-img').src = URL.createObjectURL(blob);
        
        const clients = await (await api('/clients')).json();
        const client = clients.find(c => c.id == id);
        
        document.getElementById('client-modal-title').innerHTML = `Конфиг: <b>${escapeHtml(client.name)}</b>`;
        document.getElementById('client-config-text').textContent = client.config;
        
        const toggleBtn = document.getElementById('toggle-client-btn');
        toggleBtn.innerHTML = client.is_active ? '<i class="fa-solid fa-power-off"></i> Выключить' : '<i class="fa-solid fa-power-off"></i> Включить';
        
        showModal(modals.client);
    } catch(err) {
        console.error(err);
    }
}

async function handleDownloadConfig() {
    if(!currentClientId) return;
    try {
        const res = await api(`/clients/${currentClientId}/config`);
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `amnezia-client-${currentClientId}.conf`;
        a.click();
    } catch(err) { alert(err.message); }
}

function handleCopyConfig() {
    const txt = document.getElementById('client-config-text').textContent;
    navigator.clipboard.writeText(txt).then(() => {
        const btn = document.getElementById('copy-config-btn');
        btn.innerHTML = '<i class="fa-solid fa-check"></i>';
        setTimeout(() => btn.innerHTML = '<i class="fa-regular fa-copy"></i>', 2000);
    });
}

async function handleToggleClient() {
    if(!currentClientId) return;
    try {
        await api(`/clients/${currentClientId}/toggle`, {method: 'POST'});
        hideModal(modals.client);
        refreshAll();
    } catch(err) { alert(err.message); }
}

async function handleDeleteClient() {
    if(!currentClientId) return;
    if(!confirm('Удалить клиента навсегда?')) return;
    try {
        await api(`/clients/${currentClientId}`, {method: 'DELETE'});
        hideModal(modals.client);
        refreshAll();
    } catch(err) { alert(err.message); }
}

async function openSettings() {
    try {
        const res = await api('/server/config');
        if (!res) return;
        const conf = await res.json();
        
        // Populate inputs
        const obfKeys = ['jc', 'jmin', 'jmax', 's1', 's2', 'h1', 'h2', 'h3', 'h4'];
        forms.obfuscation.innerHTML = obfKeys.map(k => `
            <div>
                <label>${k.toUpperCase()}</label>
                <div class="input-group">
                    <input type="number" id="obf-${k}" value="${conf[k] || 0}" required>
                </div>
            </div>
        `).join('');
        
        showModal(modals.settings);
    } catch(err) { console.error(err); }
}

async function handleSaveObfuscation(e) {
    e.preventDefault();
    const btn = document.getElementById('save-obfuscation-btn');
    btn.disabled = true;
    
    const obfKeys = ['jc', 'jmin', 'jmax', 's1', 's2', 'h1', 'h2', 'h3', 'h4'];
    const payload = {};
    obfKeys.forEach(k => payload[k] = parseInt(document.getElementById(`obf-${k}`).value));
    
    try {
        await api('/server/obfuscation', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        alert('Успешно обновлено! Конфиги клиентов нужно будет скачать заново.');
        hideModal(modals.settings);
    } catch(err) { alert(err.message); }
    btn.disabled = false;
}

async function handleChangePassword(e) {
    e.preventDefault();
    const btn = forms.password.querySelector('button');
    btn.disabled = true;
    const newPass = document.getElementById('new-password').value;
    
    try {
        await api('/auth/change-password', {
            method: 'POST',
            body: JSON.stringify({username: 'admin', password: newPass}) // username is dummy
        });
        alert('Пароль успешно изменен. Пожалуйста, войдите снова.');
        handleLogout();
    } catch(err) { alert(err.message); }
    btn.disabled = false;
}

// Helpers
function showModal(el) { el.classList.remove('hidden'); }
function hideModal(el) { el.classList.add('hidden'); }

function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatTime(dateStr) {
    const d = new Date(dateStr), now = new Date(), diffMs = now - d;
    if (diffMs < 60000) return 'только что';
    if (diffMs < 3600000) return Math.floor(diffMs/60000) + ' мин назад';
    if (diffMs < 86400000) return Math.floor(diffMs/3600000) + ' ч назад';
    return d.toLocaleDateString('ru-RU');
}
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
