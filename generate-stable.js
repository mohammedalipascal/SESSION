const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const http = require('http');
const https = require('https');

console.log('\n🔐 مولد جلسة واتساب - Clever Cloud Edition\n');

let connectionClosed = false;
let qrCodeData = null;
let sessionData = null;
let temporaryUrl = null;

// ═══════════════════════════════════════════════════════════
// 🔗 رفع QR على خدمة مؤقتة
// ═══════════════════════════════════════════════════════════

async function uploadQRToTemporaryService(qrText) {
    return new Promise((resolve, reject) => {
        // استخدام qrcode-monkey API لتوليد QR كصورة
        const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qrText)}`;
        
        // رفع على imgbb (خدمة مجانية للصور)
        const imgbbKey = 'bdf36f3c90177e7bb0f3b47fdfdb57e1'; // مفتاح عام مؤقت
        
        const data = JSON.stringify({
            image: qrImageUrl
        });

        const options = {
            hostname: 'api.imgbb.com',
            path: `/1/upload?key=${imgbbKey}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try {
                    const response = JSON.parse(body);
                    if (response.data && response.data.url) {
                        resolve(response.data.url);
                    } else {
                        // فشل الرفع، نستخدم الرابط المباشر
                        resolve(qrImageUrl);
                    }
                } catch (e) {
                    resolve(qrImageUrl);
                }
            });
        });

        req.on('error', () => {
            // في حالة الخطأ، نستخدم الرابط المباشر
            resolve(qrImageUrl);
        });

        req.write(data);
        req.end();
    });
}

// ═══════════════════════════════════════════════════════════
// 🌐 HTTP Server بسيط للمراقبة
// ═══════════════════════════════════════════════════════════

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        status: sessionData ? 'ready' : (qrCodeData ? 'waiting_for_scan' : 'connecting'),
        qr_url: temporaryUrl,
        message: sessionData ? 'Session ready - check logs' : (temporaryUrl ? 'Scan QR from the URL' : 'Waiting for QR...')
    }));
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`🌐 HTTP Server: Port ${PORT}`);
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
                
                console.log('\n📱 ═══════════════════════════════════════════════');
                console.log('   QR Code جاهز!');
                console.log('═══════════════════════════════════════════════\n');
                
                // عرض QR في Terminal
                console.log('📱 QR في Terminal:\n');
                qrcode.generate(qr, { small: true });
                
                console.log('\n🔗 جاري رفع QR على خدمة مؤقتة...\n');
                
                // توليد رابط QR مباشر
                const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(qr)}`;
                temporaryUrl = qrImageUrl;
                
                console.log('═'.repeat(70));
                console.log('✅ رابط QR Code (صالح لمدة ساعة):');
                console.log('');
                console.log(`   ${qrImageUrl}`);
                console.log('');
                console.log('═'.repeat(70));
                console.log('\n📋 الخطوات:');
                console.log('1. انسخ الرابط أعلاه');
                console.log('2. افتحه في المتصفح');
                console.log('3. امسح QR من واتساب');
                console.log('4. عندك 60 ثانية!\n');
                
                // حفظ الرابط في ملف
                fs.writeFileSync('QR_LINK.txt', qrImageUrl);
                console.log('💾 تم حفظ الرابط في: QR_LINK.txt\n');
            }

            if (connection === 'open') {
                console.log('\n✅ ═══════════════════════════════════════════════');
                console.log('   اتصال ناجح! 🎉');
                console.log('   الرقم:', sock.user?.id?.split(':')[0]);
                console.log('   الاسم:', sock.user?.name);
                console.log('═══════════════════════════════════════════════\n');

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
                    console.log(sessionData + '\n');
                    console.log('═'.repeat(70));

                    fs.writeFileSync('SESSION_DATA.txt', sessionData);
                    console.log('\n💾 تم الحفظ في: SESSION_DATA.txt\n');
                    
                    console.log('📋 الخطوات التالية:');
                    console.log('1. انسخ SESSION_DATA من الأعلى');
                    console.log('2. ضعه في ملف .env');
                    console.log('3. شغّل البوت: node index.js\n');

                    connectionClosed = true;
                    
                    // إبقاء السيرفر شغال 5 دقائق لنسخ البيانات
                    console.log('⏰ السيرفر سيستمر 5 دقائق لنسخ البيانات...\n');
                    setTimeout(() => {
                        console.log('\n👋 إغلاق السيرفر...\n');
                        process.exit(0);
                    }, 300000);
                }
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const reason = lastDisconnect?.error?.output?.payload?.error || 'Unknown';
                
                console.log(`\n❌ الاتصال مغلق - كود: ${statusCode}, السبب: ${reason}\n`);
                
                if (statusCode === 515) {
                    console.log('⚠️  خطأ 515 - IP محظور من WhatsApp!');
                    console.log('💡 الحل: شغّل محلياً أو استخدم VPN\n');
                } else if (statusCode === 401 || statusCode === 403) {
                    console.log('⚠️  QR منتهي - جرب مرة أخرى\n');
                } else if (!connectionClosed) {
                    console.log('🔄 إعادة المحاولة بعد 5 ثواني...\n');
                    setTimeout(() => {
                        qrCodeData = null;
                        temporaryUrl = null;
                        createSession();
                    }, 5000);
                }
            }

            if (connection === 'connecting') {
                console.log('🔄 جاري الاتصال بواتساب...');
            }
        });

    } catch (error) {
        console.error('❌ خطأ:', error.message);
        console.log('🔄 إعادة المحاولة بعد 5 ثواني...\n');
        setTimeout(() => {
            qrCodeData = null;
            temporaryUrl = null;
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
