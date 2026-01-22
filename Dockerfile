# استخدام Node.js 18 Alpine (صورة خفيفة)
FROM node:18-alpine

# تثبيت الأدوات الأساسية
RUN apk add --no-cache \
    git \
    curl \
    python3 \
    make \
    g++

# إنشاء مجلد العمل
WORKDIR /app

# نسخ package.json و package-lock.json
COPY package*.json ./

# تثبيت المكتبات
RUN npm install --production

# نسخ باقي الملفات
COPY . .

# إنشاء مجلد للجلسة
RUN mkdir -p auth_info

# منفذ HTTP (اختياري للمراقبة)
EXPOSE 8080

# تشغيل مولد الجلسة
CMD ["node", "generate-stable.js"]
