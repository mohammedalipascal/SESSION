const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const fs = require('fs');

console.log('\n🔐 مولد الجلسة - الإصدار النهائي\n');
console.log('⚠️  نصائح مهمة:');
console.log('   ✅ أغلق VPN تماماً');
console.log('   ✅ استخدم شبكة Wi-Fi منزلية عادية');
console.log('   ✅ تأكد أن واتساب محدث');
console.log('   ✅ جرب من موبايل data إذا فشلت المحاولة\n');

let connectionClosed = false;
const MAX_QR_RETRIES = 1; // محاولة واحدة فقط
let qrAttempts = 0;

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
            browser: ['Windows', 'Chrome', '10.0'], // تغيير البراوزر
            defaultQueryTimeoutMs: 60000,
            syncFullHistory: false,
            markOnlineOnConnect: false,
            connectTimeoutMs: 60000,
            getMessage: async (key) => {
                return { conversation: '' };
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                qrAttempts++;
                
                if (qrAttempts > MAX_QR_RETRIES) {
                    console.log('\n❌ تجاوزت الحد الأقصى لمحاولات QR');
                    console.log('⏰ انتظر 1-2 ساعة وحاول مرة أخرى\n');
                    process.exit(1);
                }
                
                console.log('\n📱 ═══════════════════════════════════════════════');
                console.log(`   QR Code جاهز (محاولة ${qrAttempts}/${MAX_QR_RETRIES})`);
                console.log('═══════════════════════════════════════════════\n');
                
                // عرض QR في Terminal
                qrcode.generate(qr, { small: true });
                
                console.log('\n⏰ عندك 60 ثانية لمسح الكود بسرعة!\n');
                console.log('💡 نصيحة: افتح كاميرا واتساب مسبقاً وامسح فوراً\n');
            }

            if (connection === 'open') {
                console.log('\n✅ ═══════════════════════════════════════════════');
                console.log('   اتصال ناجح! 🎉🎉🎉');
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

                    const sessionData = `SESSION_DATA=${sessionString}`;
                    
                    console.log('═'.repeat(70));
                    console.log('✅ SESSION_DATA جاهز!\n');
                    console.log(sessionData + '\n');
                    console.log('═'.repeat(70));

                    // حفظ في ملف
                    fs.writeFileSync('SESSION_DATA.txt', sessionData);
                    console.log('\n💾 تم الحفظ في: SESSION_DATA.txt\n');
                    
                    console.log('📋 الخطوات التالية:');
                    console.log('1. انسخ SESSION_DATA من الأعلى أو من ملف SESSION_DATA.txt');
                    console.log('2. اذهب إلى Render/Clever Cloud Dashboard');
                    console.log('3. Environment Variables → أضف متغير جديد:');
                    console.log('   Key: SESSION_DATA');
                    console.log('   Value: (الصق الكود الكامل)');
                    console.log('4. احفظ وأعد نشر التطبيق\n');

                    connectionClosed = true;
                    
                    console.log('✅ تم! يمكنك إغلاق السكريبت الآن (Ctrl+C)\n');
                    
                    // إغلاق بعد 30 ثانية
                    setTimeout(() => {
                        console.log('👋 إغلاق تلقائي...\n');
                        process.exit(0);
                    }, 30000);
                }
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const reason = lastDisconnect?.error?.output?.payload?.error || 'Unknown';
                
                console.log(`\n❌ الاتصال مغلق\n`);
                console.log(`   كود الخطأ: ${statusCode}`);
                console.log(`   السبب: ${reason}\n`);
                
                if (statusCode === 515) {
                    console.log('═'.repeat(70));
                    console.log('⚠️  خطأ 515 - واتساب حظر هذا الـ IP مؤقتاً\n');
                    console.log('🔧 الحلول المجربة:\n');
                    console.log('1️⃣  انتظر 1-2 ساعة ثم حاول مرة أخرى');
                    console.log('2️⃣  غيّر الشبكة تماماً:');
                    console.log('   • من Wi-Fi → موبايل data (4G/5G)');
                    console.log('   • أو العكس');
                    console.log('3️⃣  جرب من مكان مختلف (بيت صديق، مقهى)');
                    console.log('4️⃣  استخدم Hotspot من موبايل مختلف');
                    console.log('5️⃣  أغلق VPN تماماً إذا كان مفعّل');
                    console.log('6️⃣  أعد تشغيل الراوتر وانتظر 5 دقائق\n');
                    console.log('💡 نصيحة: واتساب بيحظر IPs بشكل مؤقت بعد عدة محاولات');
                    console.log('   الانتظار ساعة عادةً بيحل المشكلة\n');
                    console.log('═'.repeat(70));
                } else if (statusCode === 401 || statusCode === 403) {
                    console.log('⚠️  QR منتهي أو غير صحيح');
                    console.log('💡 شغّل السكريبت مرة أخرى وامسح QR بسرعة\n');
                } else if (statusCode === 408 || statusCode === DisconnectReason.timedOut) {
                    console.log('⚠️  انتهت مهلة الاتصال');
                    console.log('💡 تحقق من اتصال الإنترنت وحاول مرة أخرى\n');
                } else if (statusCode === DisconnectReason.loggedOut) {
                    console.log('⚠️  تم تسجيل الخروج من الجلسة\n');
                } else {
                    console.log('⚠️  خطأ غير متوقع\n');
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
        console.error('\n❌ خطأ فادح:', error.message);
        console.log('\n💡 تحقق من:');
        console.log('   • تثبيت المكتبات: npm install');
        console.log('   • اتصال الإنترنت');
        console.log('   • إصدار Node.js (يُفضل v18 أو أحدث)\n');
        process.exit(1);
    }
}

// معالجة الإيقاف
process.on('SIGINT', () => {
    console.log('\n\n👋 إيقاف السكريبت...\n');
    process.exit(0);
});

process.on('unhandledRejection', (error) => {
    console.error('\n❌ Unhandled Rejection:', error);
    process.exit(1);
});

// بدء التشغيل
console.log('🚀 بدء عملية إنشاء الجلسة...\n');
createSession();
