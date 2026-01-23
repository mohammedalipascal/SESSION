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

// ═══════════════════════════════════════════════════════════
// ⚙️ الإعدادات
// ═══════════════════════════════════════════════════════════

console.log('\n╔════════════════════════════════════════════════╗');
console.log('║                                                ║');
console.log('║   🔐 مولّد SESSION_DATA - مع إعادة المحاولة  ║');
console.log('║        Baileys 6.7.9 - Auto Retry Mode        ║');
console.log('║                                                ║');
console.log('╚════════════════════════════════════════════════╝\n');

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
    console.log(`\n1️⃣ الرابط الأول:\n   ${links.primary}\n`);
    console.log(`2️⃣ الرابط الثاني:\n   ${links.alternative}\n`);
    console.log(`3️⃣ الرابط الثالث:\n   ${links.qrcode}\n`);
    
    console.log('📱 خطوات سريعة:');
    console.log('   1. افتح أي رابط أعلاه في المتصفح');
    console.log('   2. واتساب > الأجهزة المرتبطة > ربط جهاز');
    console.log('   3. امسح الكود فوراً (خلال 20 ثانية)');
    console.log('   4. لا تغلق الصفحة حتى يظهر "✅ نجح"\n');
    
    console.log('⏰ الكود صالح لمدة 60 ثانية فقط!\n');
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
const MAX_RECONNECT = 10; // ⭐ زيادة عدد المحاولات

async function generateSession() {
    try {
        console.log('🚀 بدء توليد SESSION_DATA...\n');
        
        // حذف الجلسة القديمة في المحاولة الأولى فقط
        if (reconnectAttempts === 0) {
            const authPath = path.join(__dirname, 'auth_info');
            if (fs.existsSync(authPath)) {
                fs.rmSync(authPath, { recursive: true, force: true });
                console.log('🗑️ تم حذف الجلسة القديمة\n');
            }
        }
        
        // جلب أحدث إصدار
        const { version, isLatest } = await fetchLatestBaileysVersion();
        console.log(`📦 Baileys v${version.join('.')} ${isLatest ? '✅' : '⚠️'}\n`);
        
        // تحميل حالة المصادقة
        const { state, saveCreds } = await useMultiFileAuthState('auth_info');
        
        // ⭐ إنشاء الاتصال بإعدادات مستقرة
        sock = makeWASocket({
            version,
            logger: P({ level: 'silent' }),
            printQRInTerminal: false,
            
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, P({ level: 'silent' }))
            },
            
            // ⭐ الإعدادات الأساسية المستقرة
            browser: Browsers.ubuntu('Desktop'),
            markOnlineOnConnect: false,
            syncFullHistory: false,
            
            // ⭐ Timeout settings
            defaultQueryTimeoutMs: 60000,
            connectTimeoutMs: 60000,
            
            // ⭐ إعدادات إضافية
            getMessage: async () => undefined,
            emitOwnEvents: false,
            fireInitQueries: true,
            generateHighQualityLinkPreview: false,
            mobile: false,
            shouldIgnoreJid: jid => jid === 'status@broadcast',
            
            // ⭐ مهم جداً لتجنب 515
            keepAliveIntervalMs: 30000,
            retryRequestDelayMs: 250
        });

        // حفظ التحديثات
        sock.ev.on('creds.update', saveCreds);

        // ═══════════════════════════════════════════════════════════
        // 📱 معالجة الاتصال
        // ═══════════════════════════════════════════════════════════
        
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            // عرض QR Code
            if (qr) {
                qrAttempt++;
                
                if (qrAttempt > MAX_QR_ATTEMPTS) {
                    console.error('\n❌ تجاوز الحد الأقصى لمحاولات QR');
                    console.log('\n💡 الحل:');
                    console.log('1. أغلق جميع جلسات واتساب ويب');
                    console.log('2. احذف الأجهزة المرتبطة من الهاتف');
                    console.log('3. انتظر 10 دقائق');
                    console.log('4. أعد تشغيل السكريبت\n');
                    process.exit(1);
                }
                
                const links = generateQRLinks(qr);
                displayQRLinks(links, qrAttempt);
            }
            
            // الاتصال مغلق
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                console.log(`\n❌ الاتصال مغلق - كود: ${statusCode}\n`);
                
                // ⭐ معالجة خاصة لخطأ 515 - إعادة المحاولة!
                if (statusCode === 515) {
                    console.log('⚠️ خطأ 515 - سيتم إعادة المحاولة تلقائياً\n');
                    
                    if (reconnectAttempts < MAX_RECONNECT) {
                        reconnectAttempts++;
                        const delayTime = 5000; // 5 ثواني فقط
                        
                        console.log(`🔄 إعادة المحاولة ${reconnectAttempts}/${MAX_RECONNECT} بعد ${delayTime/1000}ث...\n`);
                        await delay(delayTime);
                        return generateSession();
                    } else {
                        console.log('❌ فشل بعد عدة محاولات\n');
                        console.log('💡 الحل:');
                        console.log('1. أغلق جميع جلسات واتساب ويب');
                        console.log('2. احذف الأجهزة المرتبطة');
                        console.log('3. انتظر 10 دقائق');
                        console.log('4. أعد تشغيل السكريبت\n');
                        process.exit(1);
                    }
                }
                
                // معالجة باقي الأخطاء
                if (statusCode === DisconnectReason.restartRequired) {
                    console.log('🔄 إعادة التشغيل مطلوبة\n');
                    await delay(2000);
                    reconnectAttempts++;
                    return generateSession();
                }
                
                if (statusCode === DisconnectReason.loggedOut ||
                    statusCode === DisconnectReason.badSession ||
                    statusCode === 401 || statusCode === 403 || statusCode === 440) {
                    console.log('🚪 الجلسة منتهية - إعادة المحاولة\n');
                    await delay(3000);
                    reconnectAttempts++;
                    return generateSession();
                }
                
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
            
            // الاتصال ناجح
            else if (connection === 'open') {
                qrAttempt = 0;
                reconnectAttempts = 0; // إعادة تعيين العداد
                
                console.log('\n✅ ════════════════════════════════════');
                console.log('   🎉 متصل بواتساب بنجاح!');
                console.log(`   📱 الرقم: ${sock.user.id.split(':')[0]}`);
                console.log(`   👤 الاسم: ${sock.user.name || 'غير محدد'}`);
                console.log('════════════════════════════════════\n');
                
                // ⭐ انتظار طويل لضمان حفظ كامل
                console.log('⏳ جاري حفظ بيانات الجلسة كاملة...');
                console.log('   (لا تغلق السكريبت - انتظر 15 ثانية)\n');
                
                await delay(15000);
                
                // تصدير SESSION_DATA
                try {
                    const credsPath = path.join(__dirname, 'auth_info', 'creds.json');
                    
                    if (!fs.existsSync(credsPath)) {
                        throw new Error('ملف creds.json غير موجود');
                    }
                    
                    let creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
                    
                    // ⭐ التحقق من التسجيل
                    if (!creds.registered) {
                        console.log('\n⚠️ الجلسة غير مسجلة بعد - انتظار 10 ثواني إضافية...\n');
                        await delay(10000);
                        
                        // إعادة قراءة الملف
                        creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
                        
                        if (!creds.registered) {
                            throw new Error('الجلسة لم تكتمل! حاول مسح QR مرة أخرى');
                        }
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
                    
                    // حفظ في ملف
                    const sessionFile = path.join(__dirname, 'SESSION_DATA.txt');
                    fs.writeFileSync(sessionFile, sessionStr);
                    console.log(`💾 تم الحفظ في: ${sessionFile}\n`);
                    
                    console.log('📝 الخطوات التالية:\n');
                    console.log('1. انسخ SESSION_DATA أعلاه (كل السطر الطويل)');
                    console.log('2. افتح: https://console.clever-cloud.com');
                    console.log('3. اختر تطبيق البوت');
                    console.log('4. Environment Variables');
                    console.log('5. Add a variable:');
                    console.log('   • Name: SESSION_DATA');
                    console.log('   • Value: [الصق النص المنسوخ]');
                    console.log('6. أضف باقي المتغيرات:');
                    console.log('   • BOT_NAME = Botly');
                    console.log('   • BOT_OWNER = مقداد');
                    console.log('   • OWNER_NUMBER = 249962204268');
                    console.log('   • REPLY_IN_GROUPS = false');
                    console.log('7. Update changes');
                    console.log('8. Restart البوت');
                    console.log('9. ✅ البوت سيعمل بدون إعادة مسح!\n');
                    
                    console.log('⚠️ تحذيرات:');
                    console.log('• لا تشارك SESSION_DATA مع أحد');
                    console.log('• انسخ النص كاملاً (لا تقطع منه)');
                    console.log('• تأكد من عدم وجود مسافات زائدة\n');
                    
                    console.log('💡 يمكنك إيقاف السكريبت الآن (Ctrl+C)\n');
                    console.log('أو انتظر - سيتوقف تلقائياً بعد 5 دقائق...\n');
                    
                    // الانتظار ثم الإيقاف
                    await delay(300000);
                    console.log('👋 تم! إيقاف تلقائي\n');
                    process.exit(0);
                    
                } catch (error) {
                    console.error('❌ فشل تصدير SESSION_DATA:', error.message);
                    console.log('\n💡 جرب:');
                    console.log('1. تأكد من صلاحيات الكتابة');
                    console.log('2. أعد تشغيل السكريبت\n');
                    process.exit(1);
                }
            }
            
            // جاري الاتصال
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
// 🛑 معالجة الإيقاف
// ═══════════════════════════════════════════════════════════

async function cleanup() {
    console.log('\n\n👋 إيقاف السكريبت...\n');
    
    if (globalSessionData) {
        console.log('✅ SESSION_DATA موجود:');
        console.log('─'.repeat(60));
        console.log(globalSessionData);
        console.log('─'.repeat(60));
        console.log(`\n💾 محفوظ في: SESSION_DATA.txt\n`);
    } else {
        console.log('⚠️ لم يتم توليد SESSION_DATA بعد');
        console.log('💡 تأكد من مسح QR Code قبل الإيقاف\n');
    }
    
    if (sock) {
        try {
            await sock.logout();
        } catch (e) {}
    }
    
    process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// ═══════════════════════════════════════════════════════════
// 🚀 بدء التوليد
// ═══════════════════════════════════════════════════════════

console.log('╔════════════════════════════════════════════════╗');
console.log('║                                                ║');
console.log('║    🔐 SESSION_DATA Generator - Auto Retry     ║');
console.log('║        يعيد المحاولة تلقائياً عند 515         ║');
console.log('║                                                ║');
console.log('╚════════════════════════════════════════════════╝\n');

generateSession();
