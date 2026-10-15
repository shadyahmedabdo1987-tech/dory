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

## ٦. الإشعارات

فيه نوعين من الإشعارات:
- **التذكير بمواعيد الأقساط والقبض:** بيتعمل على الموبايل نفسه، ومش محتاج أي إعداد. شغال من أول يوم.
- **الإشعارات اللحظية:** لما عضو يدوس "دفعت" صاحب الجمعية بيوصله إشعار، ولما صاحب الجمعية يأكد العضو بيوصله إشعار. النوع ده محتاج الخطوات دي:

1. **باقة Blaze:** الـ Cloud Functions محتاجة الباقة دي. أول ٢ مليون استدعاء في الشهر مجانًا، فالتكلفة الفعلية قريبة من الصفر.
2. **مشروع EAS:**
   ```bash
   eas init                      # بيطلع EAS project id
   ```
   حط الـ id ده في `EAS_PROJECT_ID` (في `.env` وفي EAS env).
3. **أندرويد (FCM):** من Firebase → Project settings → Service accounts → **Generate new private key**، وبعدها:
   ```bash
   eas credentials -p android    # Google Service Account → FCM V1 → ارفع الملف
   ```
4. **آيفون (APNs):** EAS بيعمل مفتاح الإشعارات تلقائيًا وقت أول build لآيفون.
5. **رفع الـ Functions:**
   ```bash
   npx firebase deploy --only functions
   ```
   > ⚠️ لازم منطقة الـ Functions تبقى هي نفس منطقة Firestore. الافتراضي `europe-west1`. لو اخترت منطقة تانية لـ Firestore في الخطوة ٣، اكتبها في ملف `functions/.env`:
   > `FUNCTIONS_REGION=me-central1`

## ٧. App Check (حماية السيرفر من أي حد برا التطبيق)

1. Firebase console → **Project settings → Your apps**: ضيف تطبيق **Android** (package: `com.alabdo.dory`) وتطبيق **iOS** (bundle: `com.alabdo.dory`).
2. نزّل `google-services.json` و `GoogleService-Info.plist`، وارفعهم لـ EAS كملفات:
   ```bash
   eas env:create --environment production --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json
   eas env:create --environment production --name GOOGLE_SERVICE_INFO_PLIST --type file --value ./GoogleService-Info.plist
   ```
   > الملفين دول مش متسجلين في GitHub (موجودين في `.gitignore`).
3. **App Check → Apps**:
   - أندرويد: فعّل **Play Integrity**، وحط بصمة SHA-256 بتاعة التطبيق (هتلاقيها في Play Console → App integrity).
   - آيفون: فعّل **App Attest** و **DeviceCheck**، باستخدام مفتاح من Apple Developer.
4. اعمل build للمتجر واتأكد إن التطبيق شغال كويس. في **App Check → APIs → Cloud Firestore** هتلاقي نسبة الطلبات الموثّقة (Verified requests).
5. لما النسبة توصل قريب من ١٠٠٪، اضغط **Enforce**.
   > ⚠️ ما تفعّلش Enforce قبل ما الناس تحدّث للنسخة اللي فيها App Check، وإلا النسخ القديمة هتتقفل.

**وقت التطوير:** في Expo Go، App Check بيتقفل لوحده (`EXPO_PUBLIC_APP_CHECK=off`). ولو هتجرب على development build، سجّل debug token من **App Check → Manage debug tokens** وحطه في `EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN`.

## ٨. التجربة محليًا (اختياري)
```bash
npm run emulators                # Firestore + Auth على جهازك
# وفي .env:
EXPO_PUBLIC_FIREBASE_EMULATOR_HOST=192.168.1.10   # IP جهازك على الشبكة
```

## ٩. قبل النشر للجمهور
- **App Check**: فعّل Enforce بعد ما تتأكد منه (الخطوة ٧).
- **Budget alerts** (Google Cloud → Billing): تنبيه لو التكلفة عدّت مبلغ معين.
- **الباقة**: الباقة المجانية (Spark) فيها ٥٠ ألف قراءة و٢٠ ألف كتابة في اليوم، ودي كفاية للبداية. لما المستخدمين يزيدوا، انقل لباقة **Blaze** (الدفع حسب الاستخدام). تكلفتها قليلة جدًا مقارنة بعدد المستخدمين.
- **النسخ الاحتياطي**: فعّل **Point-in-time recovery** أو Scheduled backups من إعدادات Firestore.
