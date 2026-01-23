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
console.log('║   🔐 مولّد SESSION_DATA - نسخة محسّنة         ║');
console.log('║        جلسة كاملة وآمنة ✅                     ║');
console.log('║                                                ║');
console.log('╚════════════════════════════════════════════════╝\n');

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        status: 'generating_session',
        time: new Date().toISOString()
    }));
});

server.listen(PORT, () => {
    console.log(`🌐 HTTP Server: http://localhost:${PORT}\n`);
});

function generateQRLinks(qrData) {
    const encoded = encodeURIComponent(qrData);
    return {
        primary: `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encoded}`,
        alternative: `https://chart.googleapis.com/chart?chs=500x500&cht=qr&chl=${encoded}`
    };
}

function displayQRLinks(links, attempt) {
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log(`║          📱 QR Code #${attempt} - امسحه الآن!                ║`);
    console.log('╚════════════════════════════════════════════════════════╝\n');
    
    console.log('🔗 الروابط:');
    console.log(`\n1️⃣ ${links.primary}\n`);
    console.log(`2️⃣ ${links.alternative}\n`);
    console.log('═'.repeat(60) + '\n');
}

// ⭐ حفظ الجلسة الكاملة بتنسيق صحيح
function packCompleteSession() {
    const authPath = path.join(__dirname, 'auth_info');
    
    if (!fs.existsSync(authPath)) {
        throw new Error('مجلد auth_info غير موجود');
    }
    
    const sessionFiles = {};
    const files = fs.readdirSync(authPath);
    
    // قراءة كل الملفات
    for (const file of files) {
        const filePath = path.join(authPath, file);
        if (fs.statSync(filePath).isFile()) {
            sessionFiles[file] = fs.readFileSync(filePath, 'utf-8');
        }
    }
    
    // التحقق من وجود الملفات الأساسية
    if (!sessionFiles['creds.json']) {
        throw new Error('creds.json غير موجود');
    }
    
    return sessionFiles;
}

let globalSessionData = null;
let sock = null;
let qrAttempt = 0;
let reconnectAttempts = 0;
const MAX_QR_ATTEMPTS = 5;
const MAX_RECONNECT = 10;
const startTime = Date.now();

async function generateSession() {
    try {
        if (reconnectAttempts > 0) {
            console.log(`\n🔄 محاولة #${reconnectAttempts}/${MAX_RECONNECT}\n`);
        } else {
            console.log('🚀 بدء التوليد...\n');
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
            fireInitQueries: false,
            generateHighQualityLinkPreview: false,
            mobile: false,
            shouldIgnoreJid: jid => jid === 'status@broadcast',
            
            keepAliveIntervalMs: 30000,
            retryRequestDelayMs: 250
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                qrAttempt++;
                
                if (qrAttempt > MAX_QR_ATTEMPTS) {
                    console.error('\n❌ تجاوز الحد الأقصى\n');
                    process.exit(1);
                }
                
                const links = generateQRLinks(qr);
                displayQRLinks(links, qrAttempt);
            }
            
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                
                console.log(`\n❌ الاتصال مغلق - كود: ${statusCode}\n`);
                
                if (statusCode === 515) {
                    console.log('🚫 خطأ 515 - إعادة المحاولة\n');
                    
                    if (reconnectAttempts < MAX_RECONNECT) {
                        reconnectAttempts++;
                        console.log(`🔄 محاولة ${reconnectAttempts}/${MAX_RECONNECT} بعد 5ث...\n`);
                        await delay(5000);
                        return generateSession();
                    } else {
                        console.log('❌ فشل بعد 10 محاولات\n');
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
                    console.log(`🔄 إعادة بعد ${delayTime/1000}ث...\n`);
                    await delay(delayTime);
                    return generateSession();
                }
            }
            
            else if (connection === 'open') {
                qrAttempt = 0;
                reconnectAttempts = 0;
                
                console.log('\n✅ ════════════════════════════════════');
                console.log('   🎉 متصل بنجاح!');
                console.log(`   📱 ${sock.user.id.split(':')[0]}`);
                console.log(`   👤 ${sock.user.name || 'غير محدد'}`);
                console.log('════════════════════════════════════\n');
                
                console.log('⏳ انتظار حفظ كل البيانات (30 ثانية)...\n');
                
                // ⭐ انتظار أطول لضمان حفظ كل المفاتيح
                await delay(30000);
                
                try {
                    console.log('\n📦 تجميع SESSION الكاملة...\n');
                    
                    // ⭐ حفظ الجلسة الكاملة مع كل الملفات
                    const completeSession = packCompleteSession();
                    
                    // تحويل لـ Base64
                    const sessionStr = Buffer.from(JSON.stringify(completeSession)).toString('base64');
                    globalSessionData = sessionStr;
                    
                    console.log('\n╔════════════════════════════════════════════════════════╗');
                    console.log('║                                                        ║');
                    console.log('║              ✅ SESSION_DATA جاهز!                     ║');
                    console.log('║                                                        ║');
                    console.log('╚════════════════════════════════════════════════════════╝\n');
                    
                    console.log('📋 SESSION_DATA (انسخ كل النص):');
                    console.log('\n' + '─'.repeat(60));
                    console.log(sessionStr);
                    console.log('─'.repeat(60) + '\n');
                    
                    const sessionFile = path.join(__dirname, 'SESSION_DATA.txt');
                    fs.writeFileSync(sessionFile, sessionStr);
                    console.log(`💾 محفوظ في: SESSION_DATA.txt\n`);
                    
                    // إحصائيات
                    const filesCount = Object.keys(completeSession).length;
                    console.log('📊 معلومات:');
                    console.log(`   • عدد الملفات: ${filesCount}`);
                    console.log(`   • حجم: ${sessionStr.length} حرف`);
                    console.log(`   • محاولات: ${reconnectAttempts}`);
                    console.log(`   • وقت: ${Math.floor((Date.now() - startTime) / 1000)}ث\n`);
                    
                    console.log('📝 الخطوات:\n');
                    console.log('1. انسخ SESSION_DATA أعلاه');
                    console.log('2. Clever Cloud > Environment Variables');
                    console.log('3. Add: SESSION_DATA = <الكود>');
                    console.log('4. أضف المتغيرات الأخرى:');
                    console.log('   AI_ENABLED=true');
                    console.log('   AI_API_KEY=<your_key>');
                    console.log('   BOT_NAME=Botly');
                    console.log('   BOT_OWNER=مقداد');
                    console.log('   OWNER_NUMBER=249962204268');
                    console.log('   REPLY_IN_GROUPS=false');
                    console.log('5. Deploy\n');
                    
                    console.log('💡 سيتوقف بعد 5 دقائق...\n');
                    
                    await delay(300000);
                    process.exit(0);
                    
                } catch (error) {
                    console.error('❌ فشل الحفظ:', error.message);
                    process.exit(1);
                }
            }
            
            else if (connection === 'connecting') {
                console.log('🔄 جاري الاتصال...');
            }
        });

        console.log('✅ جاهز لتوليد QR...\n');
        
    } catch (error) {
        console.error('❌ خطأ:', error);
        
        if (reconnectAttempts < MAX_RECONNECT) {
            reconnectAttempts++;
            console.log(`🔄 إعادة بعد 10ث...\n`);
            await delay(10000);
            return generateSession();
        } else {
            process.exit(1);
        }
    }
}

async function cleanup() {
    console.log('\n\n👋 إيقاف...\n');
    
    if (globalSessionData) {
        console.log('✅ SESSION_DATA:');
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

generateSession();
