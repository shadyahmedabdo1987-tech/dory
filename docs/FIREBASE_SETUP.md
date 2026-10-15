# تجهيز Firebase (مرة واحدة)

الخطوات دي بتتعمل مرة واحدة بس من صاحب التطبيق. بعدها أي حد يحمّل "دوري" من المتجر هيشتغل على نفس السيرفر من غير ما يعمل أي حاجة.

## ١. إنشاء المشروع
1. ادخل على [console.firebase.google.com](https://console.firebase.google.com) واضغط **Add project**.
2. اسم المشروع: `dory-app` (أو أي اسم تحبه). Google Analytics اختياري.

## ٢. تفعيل الدخول (Authentication)
**Build → Authentication → Get started → Sign-in method**، وفعّل:
- **Email/Password**: ده لأصحاب الجمعيات.
- **Anonymous**: ده للأعضاء، اللي بيدخلوا بالكود ورقم الموبايل.

## ٣. قاعدة البيانات (Firestore)
1. **Build → Firestore Database → Create database**.
2. اختار **Production mode**.
3. اختار مكان قريب من المستخدمين، زي `europe-west1` أو `me-central1`.
   > ⚠️ المكان ده ما ينفعش يتغير بعد كده.

## ٤. رفع قواعد الحماية
```bash
npm install
npx firebase login
npx firebase use --add          # اختار المشروع
npm run deploy:rules             # بيرفع firestore.rules و firestore.indexes.json
```
> لازم القواعد تترفع قبل أي استخدام. من غيرها، التطبيق هيرفض كل العمليات.

## ٥. مفاتيح التطبيق
1. **Project settings (⚙️) → Your apps → Web app (</>)** وسجّل تطبيق جديد.
2. انسخ قيم `firebaseConfig` في ملف `.env`:
```bash
cp .env.example .env
```
3. وفي نسخ المتجر، حطها في EAS:
```bash
eas env:create --environment production --name EXPO_PUBLIC_FIREBASE_API_KEY --value "..." --visibility plaintext
# وكرّر نفس الأمر لباقي المتغيرات
```
> المفاتيح دي مش أسرار، Firebase مصمّم إنها تتحط جوه التطبيق. الحماية الحقيقية هي `firestore.rules`.

## ٦. التجربة محليًا (اختياري)
```bash
npm run emulators                # Firestore + Auth على جهازك
# وفي .env:
EXPO_PUBLIC_FIREBASE_EMULATOR_HOST=192.168.1.10   # IP جهازك على الشبكة
```

## ٧. قبل النشر للجمهور
- **App Check** (Build → App Check): بيحمي السيرفر من أي استخدام من برا التطبيق، بـ Play Integrity على أندرويد و App Attest على آيفون.
- **Budget alerts** (Google Cloud → Billing): تنبيه لو التكلفة عدّت مبلغ معين.
- **الباقة**: الباقة المجانية (Spark) فيها ٥٠ ألف قراءة و٢٠ ألف كتابة في اليوم، ودي كفاية للبداية. لما المستخدمين يزيدوا، انقل لباقة **Blaze** (الدفع حسب الاستخدام). تكلفتها قليلة جدًا مقارنة بعدد المستخدمين.
- **النسخ الاحتياطي**: فعّل **Point-in-time recovery** أو Scheduled backups من إعدادات Firestore.
