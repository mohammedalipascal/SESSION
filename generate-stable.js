const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const http = require('http');

console.log('\n🔐 مولد جلسة واتساب - Koyeb Edition\n');

let connectionClosed = false;
let qrCodeData = null;
let sessionData = null;
let connectionStatus = 'waiting'; // waiting, qr_ready, connected, error

// ═══════════════════════════════════════════════════════════
// 🌐 HTTP Server لعرض QR Code في المتصفح
// ═══════════════════════════════════════════════════════════

const server = http.createServer((req, res) => {
    if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        
        if (sessionData) {
            // ✅ الجلسة جاهزة
            res.end(`
<!DOCTYPE html>
<html dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>✅ الجلسة جاهزة</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            padding: 20px;
        }
        .container {
            background: white;
            border-radius: 20px;
            padding: 40px;
            max-width: 900px;
            width: 100%;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }
        h1 {
            color: #25D366;
            text-align: center;
            margin-bottom: 20px;
            font-size: 2em;
        }
        .success-icon {
            text-align: center;
            font-size: 80px;
            margin: 20px 0;
        }
        .session-box {
            background: #f8f9fa;
            border: 2px solid #25D366;
            border-radius: 10px;
            padding: 20px;
            margin: 20px 0;
            word-wrap: break-word;
            font-family: 'Courier New', monospace;
            font-size: 11px;
            max-height: 400px;
            overflow-y: auto;
            line-height: 1.5;
        }
        .btn {
            background: #25D366;
            color: white;
            border: none;
            padding: 15px 30px;
            border-radius: 10px;
            cursor: pointer;
            font-size: 16px;
            width: 100%;
            margin-top: 10px;
            transition: all 0.3s;
        }
        .btn:hover {
            background: #128C7E;
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(37, 211, 102, 0.3);
        }
        .steps {
            background: #fff3cd;
            border-left: 5px solid #ffc107;
            padding: 20px;
            margin: 20px 0;
            border-radius: 5px;
        }
        .steps ol {
            margin: 10px 0;
            padding-right: 25px;
        }
        .steps li {
            margin: 10px 0;
            line-height: 1.6;
        }
        code {
            background: #e9ecef;
            padding: 2px 6px;
            border-radius: 3px;
            font-family: monospace;
        }
        .copy-status {
            text-align: center;
            margin-top: 10px;
            color: #28a745;
            font-weight: bold;
            display: none;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="success-icon">✅</div>
        <h1>SESSION_DATA جاهز!</h1>
        
        <div class="steps">
            <strong style="font-size: 18px;">📋 الخطوات التالية:</strong>
            <ol>
                <li>اضغط على زر <strong>"نسخ SESSION_DATA"</strong> بالأسفل</li>
                <li>افتح ملف <code>.env</code> في مشروع البوت</li>
                <li>الصق السطر المنسوخ في ملف <code>.env</code></li>
                <li>شغّل البوت: <code>node index.js</code></li>
            </ol>
        </div>
        
        <div class="session-box" id="sessionBox">${sessionData}</div>
        
        <button class="btn" onclick="copySession()">📋 نسخ SESSION_DATA</button>
        <div class="copy-status" id="copyStatus">✅ تم النسخ بنجاح!</div>
        
        <div style="text-align: center; margin-top: 30px; color: #666;">
            <small>💾 تم الحفظ أيضاً في ملف SESSION_DATA.txt على السيرفر</small>
        </div>
    </div>
    
    <script>
        function copySession() {
            const text = document.getElementById('sessionBox').textContent;
            navigator.clipboard.writeText(text).then(() => {
                const status = document.getElementById('copyStatus');
                status.style.display = 'block';
                setTimeout(() => {
                    status.style.display = 'none';
                }, 3000);
            }).catch(err => {
                alert('خطأ في النسخ. حاول النسخ يدوياً');
            });
        }
    </script>
</body>
</html>
            `);
        } else if (qrCodeData) {
            // 📱 عرض QR Code
            res.end(`
<!DOCTYPE html>
<html dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>📱 امسح QR Code</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            padding: 20px;
        }
        .container {
            background: white;
            border-radius: 20px;
            padding: 40px;
            text-align: center;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            max-width: 600px;
            width: 100%;
        }
        h1 {
            color: #25D366;
            margin-bottom: 10px;
            font-size: 2em;
        }
        .qr-container {
            background: white;
            border: 4px solid #25D366;
            border-radius: 20px;
            padding: 30px;
            margin: 30px auto;
            display: inline-block;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        }
        #qrcode {
            display: block;
        }
        .steps {
            background: #e3f2fd;
            border-left: 5px solid #2196F3;
            padding: 25px;
            margin: 25px 0;
            text-align: right;
            border-radius: 8px;
        }
        .steps strong {
            display: block;
            margin-bottom: 15px;
            font-size: 18px;
            color: #1976d2;
        }
        .steps ol {
            padding-right: 25px;
            margin: 0;
        }
        .steps li {
            margin: 12px 0;
            font-size: 16px;
            line-height: 1.6;
        }
        .timer {
            font-size: 28px;
            color: #ff5722;
            font-weight: bold;
            margin: 20px 0;
            padding: 15px;
            background: #fff3e0;
            border-radius: 10px;
        }
        .status {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            margin-top: 25px;
            padding: 15px;
            background: #f5f5f5;
            border-radius: 10px;
        }
        .loading {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 3px solid #f3f3f3;
            border-top: 3px solid #25D366;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        .pulse {
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.05); }
        }
    </style>
    <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
</head>
<body>
    <div class="container">
        <h1>📱 امسح QR Code</h1>
        
        <div class="steps">
            <strong>📋 خطوات المسح:</strong>
            <ol>
                <li>افتح <strong>واتساب</strong> على موبايلك 📱</li>
                <li>اذهب إلى: <strong>الإعدادات ⚙️ ← الأجهزة المرتبطة 📲</strong></li>
                <li>اضغط <strong>"ربط جهاز" ➕</strong></li>
                <li>امسح الكود من الأسفل 👇</li>
            </ol>
        </div>
        
        <div class="timer" id="timer">⏰ 60 ثانية</div>
        
        <div class="qr-container pulse">
            <canvas id="qrcode"></canvas>
        </div>
        
        <div class="status">
            <div class="loading"></div>
            <span style="font-size: 16px; color: #666;">في انتظار المسح...</span>
        </div>
    </div>
    
    <script>
        // عرض QR Code
        const qrData = '${qrCodeData}';
        QRCode.toCanvas(document.getElementById('qrcode'), qrData, {
            width: 280,
            margin: 2,
            color: {
                dark: '#000000',
                light: '#FFFFFF'
            }
        }, function (error) {
            if (error) console.error(error);
        });
        
        // عداد تنازلي
        let seconds = 60;
        const timerEl = document.getElementById('timer');
        const countdown = setInterval(() => {
            seconds--;
            timerEl.textContent = '⏰ ' + seconds + ' ثانية';
            
            if (seconds <= 10) {
                timerEl.style.color = '#d32f2f';
                timerEl.style.animation = 'pulse 0.5s infinite';
            }
            
            if (seconds <= 0) {
                clearInterval(countdown);
                timerEl.textContent = '❌ انتهى الوقت! حدّث الصفحة';
                timerEl.style.background = '#ffebee';
            }
        }, 1000);
        
        // تحديث تلقائي للتحقق من الجلسة
        const checkInterval = setInterval(() => {
            fetch('/status')
                .then(r => r.json())
                .then(data => {
                    if (data.ready) {
                        clearInterval(checkInterval);
                        clearInterval(countdown);
                        window.location.reload();
                    }
                })
                .catch(err => console.log('Checking...'));
        }, 2000);
    </script>
</body>
</html>
            `);
        } else {
            // 🔄 جاري الاتصال
            res.end(`
<!DOCTYPE html>
<html dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🔄 جاري الاتصال...</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
        }
        .container {
            background: white;
            border-radius: 20px;
            padding: 60px;
            text-align: center;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            max-width: 500px;
        }
        h1 {
            color: #25D366;
            margin-bottom: 20px;
        }
        .spinner {
            border: 8px solid #f3f3f3;
            border-top: 8px solid #25D366;
            border-radius: 50%;
            width: 80px;
            height: 80px;
            animation: spin 1s linear infinite;
            margin: 30px auto;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        p {
            color: #666;
            font-size: 16px;
            margin-top: 20px;
        }
        .info {
            background: #e3f2fd;
            padding: 15px;
            border-radius: 8px;
            margin-top: 20px;
            font-size: 14px;
            color: #1976d2;
        }
    </style>
    <meta http-equiv="refresh" content="3">
</head>
<body>
    <div class="container">
        <h1>🔄 جاري الاتصال بواتساب...</h1>
        <div class="spinner"></div>
        <p>الرجاء الانتظار بضع ثوانٍ...</p>
        <div class="info">
            ⏳ يتم تحضير QR Code<br>
            ستظهر الصفحة تلقائياً
        </div>
    </div>
</body>
</html>
            `);
        }
    } else if (req.url === '/status') {
        // API للتحقق من الحالة
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            ready: sessionData !== null,
            hasQR: qrCodeData !== null,
            status: connectionStatus
        }));
    } else if (req.url === '/qr-text') {
        // API لإرجاع QR كنص (للاستخدام المتقدم)
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(qrCodeData || 'No QR available yet');
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log('\n═══════════════════════════════════════════════');
    console.log('🌐 السيرفر يعمل الآن!');
    console.log('═══════════════════════════════════════════════');
    console.log(`\n📱 افتح هذا الرابط في المتصفح:`);
    console.log(`   http://localhost:${PORT}`);
    console.log(`\n🌍 على Koyeb/Railway/Render:`);
    console.log(`   https://your-app-name.koyeb.app`);
    console.log('\n═══════════════════════════════════════════════\n');
});

// ═══════════════════════════════════════════════════════════
// 🤖 إنشاء الجلسة
// ═══════════════════════════════════════════════════════════

async function createSession() {
    try {
        const authPath = './auth_info';
        if (fs.existsSync(authPath)) {
            fs.rmSync(authPath, { recursive: true, force: true });
            console.log('🗑️  حذف الجلسة القديمة\n');
        }

        console.log('📦 جاري التحقق من أحدث إصدار Baileys...');
        const { version, isLatest } = await fetchLatestBaileysVersion();
        console.log(`✅ إصدار Baileys: ${version.join('.')}`);
        console.log(`${isLatest ? '✅ أحدث إصدار' : '⚠️ يوجد تحديث'}\n`);

        const { state, saveCreds } = await useMultiFileAuthState('auth_info');

        const sock = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
            },
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            browser: ['WhatsApp Bot', 'Chrome', '4.0.0'],
            defaultQueryTimeoutMs: 60000,
            syncFullHistory: false,
            markOnlineOnConnect: false,
            getMessage: async (key) => {
                return { conversation: '' };
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                qrCodeData = qr;
                connectionStatus = 'qr_ready';
                console.log('\n📱 ═══════════════════════════════════');
                console.log('   QR Code جاهز!');
                console.log('   افتح الرابط في المتصفح لمسحه');
                console.log('═══════════════════════════════════\n');
            }

            if (connection === 'open') {
                connectionStatus = 'connected';
                console.log('\n✅ ═══════════════════════════════════');
                console.log('   اتصال ناجح! 🎉');
                console.log('   الرقم:', sock.user?.id?.split(':')[0]);
                console.log('   الاسم:', sock.user?.name);
                console.log('═══════════════════════════════════\n');

                console.log('⏳ جاري حفظ بيانات الجلسة...\n');
                await new Promise(resolve => setTimeout(resolve, 5000));

                const credsPath = './auth_info/creds.json';

                if (fs.existsSync(credsPath)) {
                    const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
                    
                    if (!creds.noiseKey || !creds.signedIdentityKey) {
                        throw new Error('بيانات الجلسة غير كاملة');
                    }
                    
                    const session = { creds };
                    const sessionString = Buffer.from(JSON.stringify(session)).toString('base64');

                    sessionData = `SESSION_DATA=${sessionString}`;
                    
                    console.log('═'.repeat(70));
                    console.log('✅ SESSION_DATA جاهز!\n');
                    console.log(sessionData.substring(0, 100) + '...\n');
                    console.log('═'.repeat(70));

                    fs.writeFileSync('SESSION_DATA.txt', sessionData);
                    console.log('\n💾 تم الحفظ في: SESSION_DATA.txt');
                    console.log('🌐 افتح الرابط في المتصفح لنسخ SESSION_DATA الكامل\n');

                    connectionClosed = true;
                }
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const reason = lastDisconnect?.error?.output?.payload?.error || 'Unknown';
                
                connectionStatus = 'error';
                console.log(`\n❌ الاتصال مغلق - كود: ${statusCode}, السبب: ${reason}\n`);
                
                if (statusCode === 515) {
                    console.log('⚠️ خطأ 515 - IP محظور من WhatsApp');
                    console.log('💡 جرب تغيير المنطقة (Region) في إعدادات Koyeb\n');
                } else if (statusCode === 401 || statusCode === 403) {
                    console.log('⚠️ QR منتهي - حدّث الصفحة للحصول على QR جديد\n');
                } else if (!connectionClosed) {
                    console.log('🔄 إعادة المحاولة بعد 5 ثواني...\n');
                    setTimeout(() => {
                        qrCodeData = null;
                        connectionStatus = 'waiting';
                        createSession();
                    }, 5000);
                }
            }

            if (connection === 'connecting') {
                connectionStatus = 'connecting';
                console.log('🔄 جاري الاتصال بواتساب...');
            }
        });

    } catch (error) {
        console.error('❌ خطأ:', error.message);
        connectionStatus = 'error';
        console.log('🔄 إعادة المحاولة بعد 5 ثواني...\n');
        setTimeout(() => {
            qrCodeData = null;
            createSession();
        }, 5000);
    }
}

// معالجة الإيقاف
process.on('SIGINT', () => {
    console.log('\n\n👋 إيقاف السيرفر...\n');
    server.close();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n\n👋 إيقاف السيرفر (SIGTERM)...\n');
    server.close();
    process.exit(0);
});

// بدء التشغيل
console.log('🚀 بدء عملية إنشاء الجلسة...\n');
createSession();
