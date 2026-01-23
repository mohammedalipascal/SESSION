const { 
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    Browsers,
    delay
} = require('@whiskeysockets/baileys');
const P = require('pino');
const fs = require('fs');
const path = require('path');
const http = require('http');

console.log('\n╔════════════════════════════════════════════════╗');
console.log('║                                                ║');
console.log('║   🔐 مولّد SESSION_DATA - النسخة المستقرة     ║');
console.log('║        يعمل على Render/Clever Cloud ✅        ║');
console.log('║                                                ║');
console.log('║   🔄 إعادة محاولة تلقائية عند خطأ 515       ║');
console.log('║      (حتى 10 محاولات × 5 ثواني)             ║');
console.log('║                                                ║');
console.log('╚════════════════════════════════════════════════╝\n');

// ═══════════════════════════════════════════════════════════
// 🌐 HTTP Server (مطلوب لـ Render)
// ═══════════════════════════════════════════════════════════

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        status: 'generating_session',
        message: 'QR Code active, waiting for scan...',
        time: new Date().toISOString()
    }));
});

server.listen(PORT, () => {
    console.log(`🌐 HTTP Server: http://localhost:${PORT}\n`);
});

// ═══════════════════════════════════════════════════════════
// 🔧 Helper Functions
// ═══════════════════════════════════════════════════════════

function generateQRLinks(qrData) {
    const encoded = encodeURIComponent(qrData);
    return {
        primary: `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encoded}`,
        alternative: `https://chart.googleapis.com/chart?chs=500x500&cht=qr&chl=${encoded}`,
        qrcode: `https://qrcode.tec-it.com/API/QRCode?data=${encoded}&size=large`
    };
}

function displayQRLinks(links, attempt) {
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║                                                        ║');
    console.log(`║           📱 QR Code #${attempt} - امسحه فوراً!              ║`);
    console.log('║                                                        ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');
    
    console.log('🔗 روابط QR Code (اختر أي رابط):');
    console.log(`\n1️⃣ ${links.primary}\n`);
    console.log(`2️⃣ ${links.alternative}\n`);
    console.log(`3️⃣ ${links.qrcode}\n`);
    
    console.log('📱 خطوات:');
    console.log('   1. افتح أي رابط في متصفح جديد');
    console.log('   2. واتساب > الأجهزة المرتبطة > ربط جهاز');
    console.log('   3. امسح الكود');
    console.log('   4. انتظر "✅ نجح"\n');
    console.log('═'.repeat(60) + '\n');
}

// ═══════════════════════════════════════════════════════════
// 🔐 توليد SESSION_DATA
// ═══════════════════════════════════════════════════════════

let globalSessionData = null;
let sock = null;
let qrAttempt = 0;
let reconnectAttempts = 0;
const MAX_QR_ATTEMPTS = 5;
const MAX_RECONNECT = 10;
const startTime = Date.now(); // ⭐ تتبع الوقت

// ⭐ المتغير الأهم - علشان نعرف إمتى الجلسة كاملة
let sessionFullyReady = false;

async function generateSession() {
    try {
        if (reconnectAttempts > 0) {
            console.log(`\n🔄 ═══════════════════════════════════════════════`);
            console.log(`   محاولة إعادة الاتصال #${reconnectAttempts}/${MAX_RECONNECT}`);
            console.log(`═══════════════════════════════════════════════\n`);
        } else {
            console.log('🚀 بدء توليد SESSION_DATA...\n');
        }
        
        if (reconnectAttempts === 0) {
            const authPath = path.join(__dirname, 'auth_info');
            if (fs.existsSync(authPath)) {
                fs.rmSync(authPath, { recursive: true, force: true });
                console.log('🗑️ تم حذف الجلسة القديمة\n');
            }
        }
        
        const { version, isLatest } = await fetchLatestBaileysVersion();
        console.log(`📦 Baileys v${version.join('.')} ${isLatest ? '✅' : '⚠️'}\n`);
        
        const { state, saveCreds } = await useMultiFileAuthState('auth_info');
        
        sock = makeWASocket({
            version,
            logger: P({ level: 'silent' }),
            printQRInTerminal: false,
            
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, P({ level: 'silent' }))
            },
            
            browser: Browsers.ubuntu('Desktop'),
            markOnlineOnConnect: false,
            syncFullHistory: false,
            
            defaultQueryTimeoutMs: 60000,
            connectTimeoutMs: 60000,
            
            getMessage: async () => undefined,
            emitOwnEvents: false,
            fireInitQueries: true,
            generateHighQualityLinkPreview: false,
            mobile: false,
            shouldIgnoreJid: jid => jid === 'status@broadcast',
            
            keepAliveIntervalMs: 30000,
            retryRequestDelayMs: 250
        });

        // ⭐ حفظ التحديثات - هنا المفتاح!
        sock.ev.on('creds.update', async () => {
            await saveCreds();
            
            // ⭐ بعد كل تحديث، نفحص لو الجلسة كاملة
            const credsPath = path.join(__dirname, 'auth_info', 'creds.json');
            if (fs.existsSync(credsPath)) {
                try {
                    const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
                    
                    // ⭐ لو registered = true، يبقى الجلسة كاملة!
                    if (creds.registered && !sessionFullyReady) {
                        sessionFullyReady = true;
                        console.log('\n✅ الجلسة مكتملة ومسجلة!\n');
                        
                        // ⭐ انتظار ثواني قليلة للتأكد
                        await delay(5000);
                        
                        // حفظ SESSION_DATA
                        await saveSessionData();
                    }
                } catch (e) {
                    // تجاهل أخطاء القراءة المؤقتة
                }
            }
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                qrAttempt++;
                
                if (qrAttempt > MAX_QR_ATTEMPTS) {
                    console.error('\n❌ تجاوز الحد الأقصى لمحاولات QR\n');
                    process.exit(1);
                }
                
                const links = generateQRLinks(qr);
                displayQRLinks(links, qrAttempt);
            }
            
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                
                console.log(`\n❌ الاتصال مغلق - كود: ${statusCode}\n`);
                
                // ⭐⭐⭐ معالجة خاصة لخطأ 515 - إعادة المحاولة التلقائية! ⭐⭐⭐
                if (statusCode === 515) {
                    console.log('🚫 ═══════════════════════════════════════════════');
                    console.log('   خطأ 515 - WhatsApp رفض الاتصال');
                    console.log('═══════════════════════════════════════════════\n');
                    
                    if (reconnectAttempts < MAX_RECONNECT) {
                        reconnectAttempts++;
                        const delayTime = 5000; // ⭐ 5 ثواني ثابتة
                        
                        console.log(`🔄 إعادة المحاولة التلقائية ${reconnectAttempts}/${MAX_RECONNECT}`);
                        console.log(`⏰ الانتظار: ${delayTime/1000} ثواني...\n`);
                        
                        await delay(delayTime);
                        
                        console.log('🚀 بدء محاولة جديدة...\n');
                        console.log('─'.repeat(60) + '\n');
                        
                        return generateSession(); // ⭐ إعادة المحاولة
                    } else {
                        console.log(`❌ فشل الاتصال بعد ${MAX_RECONNECT} محاولات\n`);
                        console.log('💡 الحلول المقترحة:');
                        console.log('   1. أغلق جميع جلسات واتساب ويب');
                        console.log('   2. احذف الأجهزة المرتبطة من الهاتف');
                        console.log('   3. انتظر 10 دقائق');
                        console.log('   4. أعد تشغيل السكريبت\n');
                        process.exit(1);
                    }
                }
                
                if (statusCode === DisconnectReason.restartRequired) {
                    await delay(2000);
                    reconnectAttempts++;
                    return generateSession();
                }
                
                if (statusCode === DisconnectReason.loggedOut ||
                    statusCode === DisconnectReason.badSession ||
                    statusCode === 401 || statusCode === 403 || statusCode === 440) {
                    await delay(3000);
                    reconnectAttempts++;
                    return generateSession();
                }
                
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                if (shouldReconnect && reconnectAttempts < MAX_RECONNECT) {
                    reconnectAttempts++;
                    const delayTime = Math.min(reconnectAttempts * 2000, 10000);
                    console.log(`🔄 إعادة المحاولة ${reconnectAttempts}/${MAX_RECONNECT} بعد ${delayTime/1000}ث...\n`);
                    await delay(delayTime);
                    return generateSession();
                } else if (reconnectAttempts >= MAX_RECONNECT) {
                    console.log('❌ فشل بعد عدة محاولات\n');
                    process.exit(1);
                }
            }
            
            else if (connection === 'open') {
                qrAttempt = 0;
                reconnectAttempts = 0;
                
                console.log('\n✅ ════════════════════════════════════');
                console.log('   🎉 متصل بواتساب بنجاح!');
                console.log(`   📱 الرقم: ${sock.user.id.split(':')[0]}`);
                console.log(`   👤 الاسم: ${sock.user.name || 'غير محدد'}`);
                console.log('════════════════════════════════════\n');
                
                // ⭐ لا نحفظ هنا! نستنى creds.update يقول إن registered = true
                console.log('⏳ انتظار اكتمال التسجيل...');
                console.log('   (هيتم التحديث تلقائياً)\n');
            }
            
            else if (connection === 'connecting') {
                console.log('🔄 جاري الاتصال بواتساب...');
            }
        });

        console.log('✅ جاهز لتوليد QR Code...\n');
        
    } catch (error) {
        console.error('❌ خطأ في التوليد:', error);
        
        if (reconnectAttempts < MAX_RECONNECT) {
            reconnectAttempts++;
            console.log(`🔄 إعادة المحاولة ${reconnectAttempts}/${MAX_RECONNECT} بعد 10ث...\n`);
            await delay(10000);
            return generateSession();
        } else {
            console.log('❌ فشل بعد عدة محاولات\n');
            process.exit(1);
        }
    }
}

// ═══════════════════════════════════════════════════════════
// 💾 حفظ SESSION_DATA
// ═══════════════════════════════════════════════════════════

async function saveSessionData() {
    try {
        const credsPath = path.join(__dirname, 'auth_info', 'creds.json');
        
        if (!fs.existsSync(credsPath)) {
            throw new Error('ملف creds.json غير موجود');
        }
        
        const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
        
        if (!creds.registered) {
            console.log('⚠️ الجلسة لم تكتمل بعد...\n');
            return;
        }
        
        const sessionData = { creds };
        const sessionStr = Buffer.from(JSON.stringify(sessionData)).toString('base64');
        globalSessionData = sessionStr;
        
        console.log('╔════════════════════════════════════════════════════════╗');
        console.log('║                                                        ║');
        console.log('║              ✅ نجح! SESSION_DATA جاهز                ║');
        console.log('║                                                        ║');
        console.log('╚════════════════════════════════════════════════════════╝\n');
        
        console.log('📊 معلومات الجلسة:');
        console.log(`   • رقم الهاتف: ${creds.me?.id || 'غير معروف'}`);
        console.log(`   • الاسم: ${creds.me?.name || 'غير معروف'}`);
        console.log(`   • مسجل: ${creds.registered ? 'نعم ✅' : 'لا ❌'}`);
        console.log(`   • حجم البيانات: ${sessionStr.length} حرف\n`);
        
        console.log('📋 SESSION_DATA (انسخ كل النص):');
        console.log('\n' + '─'.repeat(60));
        console.log(sessionStr);
        console.log('─'.repeat(60) + '\n');
        
        const sessionFile = path.join(__dirname, 'SESSION_DATA.txt');
        fs.writeFileSync(sessionFile, sessionStr);
        console.log(`💾 تم الحفظ في: ${sessionFile}\n`);
        
        console.log('📝 الخطوات التالية:\n');
        console.log('1. انسخ SESSION_DATA أعلاه (كل السطر الطويل)');
        console.log('2. في Clever Cloud: Environment Variables');
        console.log('3. Add: SESSION_DATA = <الصق_الكود>');
        console.log('4. أضف المتغيرات الأخرى:');
        console.log('   • BOT_NAME = Botly');
        console.log('   • BOT_OWNER = مقداد');
        console.log('   • OWNER_NUMBER = 249962204268');
        console.log('   • REPLY_IN_GROUPS = false');
        console.log('5. Update changes');
        console.log('6. Restart البوت\n');
        
        console.log('📊 إحصائيات:');
        console.log(`   • محاولات إعادة الاتصال: ${reconnectAttempts}`);
        console.log(`   • محاولات QR: ${qrAttempt}`);
        console.log(`   • الوقت الإجمالي: ${Math.floor((Date.now() - startTime) / 1000)}ث\n`);
        
        console.log('💡 سيتوقف تلقائياً بعد 5 دقائق...\n');
        
        await delay(300000);
        console.log('👋 تم! إيقاف تلقائي\n');
        process.exit(0);
        
    } catch (error) {
        console.error('❌ فشل حفظ SESSION_DATA:', error.message);
        process.exit(1);
    }
}

// ═══════════════════════════════════════════════════════════
// 🛑 معالجة الإيقاف
// ═══════════════════════════════════════════════════════════

async function cleanup() {
    console.log('\n\n👋 إيقاف السكريبت...\n');
    
    if (globalSessionData) {
        console.log('✅ SESSION_DATA موجود:');
        console.log('─'.repeat(60));
        console.log(globalSessionData);
        console.log('─'.repeat(60) + '\n');
    }
    
    if (sock) {
        try {
            await sock.logout();
        } catch (e) {}
    }
    
    server.close();
    process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// ═══════════════════════════════════════════════════════════
// 🚀 بدء التوليد
// ═══════════════════════════════════════════════════════════

generateSession();
