require('dotenv').config();
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
const readline = require('readline');

// ═══════════════════════════════════════════════════════════
// ⚙️ الإعدادات
// ═══════════════════════════════════════════════════════════

const USE_PAIRING_CODE = process.env.USE_PAIRING_CODE === 'true';
const PHONE_NUMBER = process.env.PHONE_NUMBER || '';

console.log('\n╔════════════════════════════════════════════════╗');
console.log('║                                                ║');
console.log('║   🔐 سكريبت توليد SESSION_DATA - Ubuntu      ║');
console.log('║                                                ║');
console.log('╚════════════════════════════════════════════════╝\n');

if (USE_PAIRING_CODE && !PHONE_NUMBER) {
    console.error('❌ خطأ: PHONE_NUMBER مطلوب عند استخدام Pairing Code\n');
    console.log('💡 أضف في ملف .env:');
    console.log('   PHONE_NUMBER=201234567890  # رقمك بدون + أو 00');
    console.log('   USE_PAIRING_CODE=true\n');
    process.exit(1);
}

console.log(`⚙️ الوضع: ${USE_PAIRING_CODE ? '🔑 Pairing Code' : '📱 QR Code'}`);
if (USE_PAIRING_CODE) {
    console.log(`📱 الرقم: ${PHONE_NUMBER}`);
}
console.log('');

// ═══════════════════════════════════════════════════════════
// 🔧 Helper Functions
// ═══════════════════════════════════════════════════════════

function generateQRLinks(qrData) {
    const encoded = encodeURIComponent(qrData);
    return {
        primary: `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encoded}`,
        alternative: `https://chart.googleapis.com/chart?chs=500x500&cht=qr&chl=${encoded}`
    };
}

function displayQRLinks(links) {
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║                                                        ║');
    console.log('║           📱 روابط QR Code - افتح أي رابط!           ║');
    console.log('║                                                        ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');
    
    console.log('🔗 الرابط الرئيسي:');
    console.log(`   ${links.primary}\n`);
    
    console.log('🔗 رابط بديل:');
    console.log(`   ${links.alternative}\n`);
    
    console.log('📱 الخطوات:');
    console.log('   1. افتح الرابط في المتصفح');
    console.log('   2. امسح الكود بواتساب');
    console.log('   3. انتظر الاتصال (10 ثواني)...\n');
    
    console.log('═'.repeat(60) + '\n');
}

// ═══════════════════════════════════════════════════════════
// 🔐 توليد SESSION_DATA
// ═══════════════════════════════════════════════════════════

let globalSessionData = null;
let sock = null;

async function generateSession() {
    try {
        console.log('🚀 بدء توليد SESSION_DATA...\n');
        
        // حذف الجلسة القديمة
        const authPath = path.join(__dirname, 'auth_info');
        if (fs.existsSync(authPath)) {
            fs.rmSync(authPath, { recursive: true, force: true });
            console.log('🗑️ تم حذف الجلسة القديمة\n');
        }
        
        // جلب أحدث إصدار
        const { version, isLatest } = await fetchLatestBaileysVersion();
        console.log(`📦 Baileys v${version.join('.')} ${isLatest ? '✅' : '⚠️'}\n`);
        
        // تحميل حالة المصادقة
        const { state, saveCreds } = await useMultiFileAuthState('auth_info');
        
        // إنشاء الاتصال
        sock = makeWASocket({
            version,
            logger: P({ level: 'silent' }),
            printQRInTerminal: false,
            
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, P({ level: 'silent' }))
            },
            
            // ⭐ إعدادات Ubuntu المستقرة
            browser: Browsers.ubuntu('Desktop'),
            markOnlineOnConnect: false,
            syncFullHistory: false,
            
            defaultQueryTimeoutMs: 60000,
            connectTimeoutMs: 60000,
            qrTimeout: 60000,
            
            getMessage: async () => undefined,
            
            emitOwnEvents: false,
            fireInitQueries: true,
            generateHighQualityLinkPreview: false,
            
            mobile: false,
            shouldIgnoreJid: jid => jid === 'status@broadcast'
        });

        // حفظ التحديثات
        sock.ev.on('creds.update', saveCreds);

        // ⭐ طلب Pairing Code إذا مفعّل
        if (USE_PAIRING_CODE && !state.creds.registered) {
            console.log('🔑 جاري طلب Pairing Code...\n');
            
            await delay(3000);
            
            try {
                const code = await sock.requestPairingCode(PHONE_NUMBER);
                
                console.log('\n' + '═'.repeat(60));
                console.log('🔑 PAIRING CODE:');
                console.log('═'.repeat(60));
                console.log('\n        ' + code + '\n');
                console.log('═'.repeat(60));
                
                console.log('\n📱 الخطوات:');
                console.log('1. افتح واتساب');
                console.log('2. الإعدادات > الأجهزة المرتبطة');
                console.log('3. ربط جهاز');
                console.log('4. ربط باستخدام رقم الهاتف');
                console.log(`5. أدخل الكود: ${code}\n`);
                
            } catch (error) {
                console.error('❌ فشل طلب Pairing Code:', error.message);
                console.log('💡 تأكد أن رقم الهاتف صحيح\n');
                process.exit(1);
            }
        }

        // ═══════════════════════════════════════════════════════════
        // 📱 معالجة الاتصال
        // ═══════════════════════════════════════════════════════════
        
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            // عرض QR Code
            if (qr && !USE_PAIRING_CODE) {
                const links = generateQRLinks(qr);
                displayQRLinks(links);
            }
            
            // الاتصال مغلق
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                
                console.log(`\n❌ الاتصال مغلق - كود: ${statusCode}\n`);
                
                if (statusCode === DisconnectReason.loggedOut ||
                    statusCode === DisconnectReason.badSession) {
                    console.log('🔄 إعادة المحاولة...\n');
                    await delay(3000);
                    return generateSession();
                }
                
                if (statusCode === 515) {
                    console.log('⚠️ خطأ 515 - انتظار 30 ثانية...\n');
                    await delay(30000);
                    return generateSession();
                }
                
                console.log('🔄 إعادة المحاولة...\n');
                await delay(5000);
                return generateSession();
            }
            
            // الاتصال ناجح
            else if (connection === 'open') {
                console.log('\n✅ ════════════════════════════════════');
                console.log('   🎉 متصل بواتساب بنجاح!');
                console.log(`   📱 الرقم: ${sock.user.id.split(':')[0]}`);
                console.log(`   👤 الاسم: ${sock.user.name || 'غير محدد'}`);
                console.log('════════════════════════════════════\n');
                
                // ⭐ انتظار 10 ثواني لضمان حفظ كامل
                console.log('⏳ جاري حفظ بيانات الجلسة (10 ثواني)...\n');
                await delay(10000);
                
                // تصدير SESSION_DATA
                try {
                    const credsPath = path.join(__dirname, 'auth_info', 'creds.json');
                    
                    if (!fs.existsSync(credsPath)) {
                        throw new Error('ملف creds.json غير موجود');
                    }
                    
                    const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
                    
                    const sessionData = { creds };
                    const sessionStr = Buffer.from(JSON.stringify(sessionData)).toString('base64');
                    globalSessionData = sessionStr;
                    
                    console.log('\n╔════════════════════════════════════════════════════════╗');
                    console.log('║                                                        ║');
                    console.log('║              ✅ نجح! SESSION_DATA جاهز                ║');
                    console.log('║                                                        ║');
                    console.log('╚════════════════════════════════════════════════════════╝\n');
                    
                    console.log('📋 انسخ SESSION_DATA التالي بالكامل:\n');
                    console.log('─'.repeat(60));
                    console.log(sessionStr);
                    console.log('─'.repeat(60));
                    
                    // حفظ في ملف
                    const sessionFile = path.join(__dirname, 'SESSION_DATA.txt');
                    fs.writeFileSync(sessionFile, sessionStr);
                    console.log(`\n💾 تم الحفظ أيضاً في: ${sessionFile}\n`);
                    
                    console.log('📝 الخطوات التالية:');
                    console.log('1. انسخ SESSION_DATA أعلاه (كل النص!)');
                    console.log('2. افتح: https://console.clever-cloud.com');
                    console.log('3. اختر تطبيق البوت');
                    console.log('4. Environment Variables > Add a variable');
                    console.log('5. Name: SESSION_DATA');
                    console.log('6. Value: [الصق النص المنسوخ]');
                    console.log('7. Update changes');
                    console.log('8. Restart البوت');
                    console.log('9. ✅ البوت سيعمل بدون إعادة مسح QR!\n');
                    
                    console.log('⚠️ تحذيرات مهمة:');
                    console.log('• لا تشارك SESSION_DATA مع أي شخص');
                    console.log('• انسخ كل النص (لا تقطع منه شيء)');
                    console.log('• تأكد من عدم وجود مسافات في البداية أو النهاية\n');
                    
                    console.log('✅ يمكنك إيقاف هذا السكريبت الآن (Ctrl+C)\n');
                    
                    // الانتظار ثم الخروج
                    setTimeout(() => {
                        console.log('👋 تم! يمكنك إغلاق السكريبت\n');
                        process.exit(0);
                    }, 5000);
                    
                } catch (error) {
                    console.error('❌ فشل تصدير SESSION_DATA:', error.message);
                    process.exit(1);
                }
            }
            
            // جاري الاتصال
            else if (connection === 'connecting') {
                console.log('🔄 جاري الاتصال بواتساب...');
            }
        });

        console.log('✅ جاهز لتوليد الجلسة...\n');
        
    } catch (error) {
        console.error('❌ خطأ في التوليد:', error);
        console.log('🔄 إعادة المحاولة بعد 10 ثواني...\n');
        await delay(10000);
        return generateSession();
    }
}

// ═══════════════════════════════════════════════════════════
// 🛑 معالجة الإيقاف
// ═══════════════════════════════════════════════════════════

async function cleanup() {
    console.log('\n\n👋 إيقاف السكريبت...\n');
    
    if (globalSessionData) {
        console.log('✅ SESSION_DATA موجود - يمكنك استخدامه');
        console.log(`💾 محفوظ في: SESSION_DATA.txt\n`);
    } else {
        console.log('⚠️ لم يتم توليد SESSION_DATA بعد\n');
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
console.log('║    🔐 مولّد SESSION_DATA - إصدار Ubuntu      ║');
console.log('║        استخدمه مرة واحدة للحصول على           ║');
console.log('║         SESSION_DATA ثم أضفه في ENV           ║');
console.log('║                                                ║');
console.log('╚════════════════════════════════════════════════╝\n');

generateSession();
