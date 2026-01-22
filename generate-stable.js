const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

console.log('\n🔐 مولد جلسة واتساب - نسخة محسّنة\n');

let connectionClosed = false;
const MAX_RETRIES = 3;
let retryCount = 0;

async function createSession() {
    try {
        // حذف الجلسة القديمة
        const authPath = './auth_info';
        if (fs.existsSync(authPath)) {
            fs.rmSync(authPath, { recursive: true, force: true });
            console.log('🗑️  حذف الجلسة القديمة\n');
        }

        // ✅ جلب أحدث إصدار من Baileys
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
            printQRInTerminal: false, // ✅ تعطيل الطريقة القديمة
            logger: pino({ level: 'silent' }),
            browser: ['WhatsApp Bot', 'Chrome', '4.0.0'],
            defaultQueryTimeoutMs: undefined,
            syncFullHistory: false,
            markOnlineOnConnect: false,
            getMessage: async (key) => {
                return { conversation: '' };
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            // ✅ عرض QR يدوياً باستخدام qrcode-terminal
            if (qr) {
                console.log('\n📱 ═══════════════════════════════════');
                console.log('   امسح QR Code من الأسفل 👇');
                console.log('   واتساب → إعدادات → الأجهزة المرتبطة');
                console.log('═══════════════════════════════════\n');
                
                qrcode.generate(qr, { small: true });
                
                console.log('\n⏰ عندك 30 ثانية لمسح الكود!\n');
            }

            if (connection === 'open') {
                console.log('\n✅ ═══════════════════════════════════');
                console.log('   اتصال ناجح! 🎉');
                console.log('   الرقم:', sock.user?.id?.split(':')[0] || 'غير معروف');
                console.log('   الاسم:', sock.user?.name || 'غير معروف');
                console.log('═══════════════════════════════════\n');

                console.log('⏳ جاري حفظ بيانات الجلسة...\n');

                // انتظار حفظ البيانات
                await new Promise(resolve => setTimeout(resolve, 5000));

                const credsPath = './auth_info/creds.json';

                if (fs.existsSync(credsPath)) {
                    try {
                        const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
                        
                        // التأكد من وجود البيانات الأساسية
                        if (!creds.noiseKey || !creds.signedIdentityKey) {
                            throw new Error('بيانات الجلسة غير كاملة');
                        }

                        const session = { creds };
                        const sessionString = Buffer.from(JSON.stringify(session)).toString('base64');

                        console.log('═'.repeat(70));
                        console.log('✅ SESSION_DATA جاهز!\n');
                        console.log(`SESSION_DATA=${sessionString}\n`);
                        console.log('═'.repeat(70));
                        console.log('\n📋 الخطوات التالية:');
                        console.log('1. انسخ السطر أعلاه (SESSION_DATA=...)');
                        console.log('2. افتح ملف .env');
                        console.log('3. الصق السطر في ملف .env');
                        console.log('4. شغّل البوت: node index.js\n');

                        // حفظ في ملف نصي
                        fs.writeFileSync('SESSION_DATA.txt', `SESSION_DATA=${sessionString}`);
                        console.log('💾 تم الحفظ أيضاً في: SESSION_DATA.txt\n');

                        connectionClosed = true;
                        
                        // إغلاق الاتصال بشكل صحيح
                        setTimeout(async () => {
                            try {
                                await sock.logout();
                            } catch (e) {}
                            process.exit(0);
                        }, 2000);

                    } catch (error) {
                        console.error('❌ خطأ في معالجة الجلسة:', error.message);
                        process.exit(1);
                    }
                } else {
                    console.error('❌ ملف creds.json غير موجود!');
                    process.exit(1);
                }
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const reason = lastDisconnect?.error?.output?.payload?.error || 'Unknown';

                console.log(`\n❌ الاتصال مغلق - كود: ${statusCode}, السبب: ${reason}\n`);

                // معالجة الأخطاء الشائعة
                if (statusCode === 405) {
                    console.log('⚠️  خطأ 405 - حلول مقترحة:\n');
                    console.log('1. تحديث Baileys:');
                    console.log('   npm update @whiskeysockets/baileys\n');
                    console.log('2. إعادة تثبيت المكتبات:');
                    console.log('   rm -rf node_modules package-lock.json');
                    console.log('   npm install\n');

                } else if (statusCode === 515) {
                    console.log('⚠️  خطأ 515 - مشكلة في الشبكة:\n');
                    console.log('1. غيّر شبكة الإنترنت (جرب موبايل data)');
                    console.log('2. استخدم VPN');
                    console.log('3. أعد تشغيل الراوتر');
                    console.log('4. تأكد أن واتساب محدث لآخر إصدار\n');

                } else if (statusCode === 401 || statusCode === 403) {
                    console.log('⚠️  خطأ في المصادقة - QR منتهي أو غير صحيح\n');
                    console.log('جرب مرة أخرى وامسح QR بسرعة\n');

                } else if (statusCode === DisconnectReason.loggedOut) {
                    console.log('⚠️  تم تسجيل الخروج من الجلسة\n');

                } else if (statusCode === DisconnectReason.timedOut) {
                    console.log('⚠️  انتهت مهلة الاتصال\n');
                    if (retryCount < MAX_RETRIES) {
                        retryCount++;
                        console.log(`🔄 إعادة المحاولة (${retryCount}/${MAX_RETRIES})...\n`);
                        setTimeout(() => createSession(), 5000);
                        return;
                    }
                }

                if (!connectionClosed) {
                    process.exit(1);
                }
            }

            if (connection === 'connecting') {
                console.log('🔄 جاري الاتصال بواتساب...');
            }
        });

    } catch (error) {
        console.error('❌ خطأ عام:', error.message);
        console.log('\n📋 تحقق من:');
        console.log('1. تثبيت المكتبات: npm install');
        console.log('2. اتصال الإنترنت');
        console.log('3. إصدار Node.js (يُفضل v18 أو أحدث)\n');
        process.exit(1);
    }
}

// معالجة الإيقاف المفاجئ
process.on('SIGINT', () => {
    console.log('\n\n👋 إيقاف المولد...\n');
    process.exit(0);
});

process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled Rejection:', error);
    process.exit(1);
});

// بدء التشغيل
console.log('🚀 بدء عملية إنشاء الجلسة...\n');
createSession().catch(err => {
    console.error('❌ خطأ فادح:', err);
    process.exit(1);
});
