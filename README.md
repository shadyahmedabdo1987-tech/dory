<div align="center">

<img src="assets/icon.png" width="112" alt="الجمعية" />

# الجمعية · Gam3eya

**نظّم جمعيتك من موبايلك — الأدوار، التحصيل، والتذكير على واتساب.**

Organize rotating savings circles (ROSCAs) — turns, collections and WhatsApp reminders.

![Platforms](https://img.shields.io/badge/platforms-Android%20%7C%20iOS-0F5C4D)
![Expo](https://img.shields.io/badge/Expo-SDK%2054-000020?logo=expo)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-C9A23F)

</div>

---

## ليه "الجمعية"؟

الجمعية نظام ادخار بيستخدمه ملايين الناس في مصر والوطن العربي، وأغلبهم لسه بيديروه بالورقة والكشكول ورسايل الواتساب. التطبيق ده بيخلّي اللي ماسك الجمعية يعرف في ثانية: مين دفع، مين متأخر، الدور على مين، وإمتى.

## المميزات

| | |
|---|---|
| 🗓️ **جدول الأدوار تلقائي** | شهري أو أسبوعي، وبيظبط آخر الشهر (31 يناير ← 28 فبراير) |
| 🎲 **القرعة** | ترتيب عشوائي عادل للأدوار بضغطة، أو رتّب بنفسك |
| ✅ **تحصيل الأقساط** | علّم مين دفع في كل دور، و"الكل دفع" بضغطة واحدة |
| 💰 **تسليم القبض** | سجّل إن صاحب الدور استلم، وتابع نسبة إنجاز الجمعية |
| ⚠️ **المتأخرات** | إجمالي المتأخرات على كل الجمعيات، وكشف حساب لكل عضو |
| 💬 **تذكير واتساب** | رسالة جاهزة لكل عضو متأخر، وملخص للجروب فيه مين لسه ما دفعش |
| 🔒 **خصوصية كاملة** | كل البيانات متخزنة على الموبايل، مفيش سيرفر ومفيش حساب |
| 🌙 **عربي من الأساس** | واجهة RTL، خط Cairo، أرقام وتواريخ عربي |

> التطبيق **بينظّم** الجمعية بس، وما بيمسكش فلوس ولا بيحوّل أي مبالغ.

## التقنيات

- **[Expo](https://expo.dev) SDK 54** + **React Native 0.81** (New Architecture) — كود واحد لأندرويد وآيفون
- **Expo Router** للتنقل بين الشاشات بنظام الملفات
- **TypeScript strict**
- **Zustand** + **AsyncStorage** لتخزين البيانات على الجهاز
- منطق الجمعية (`src/core`) مكتوب TypeScript نقي من غير أي اعتماد على React، ومتغطي باختبارات

```
app/                    الشاشات (Expo Router)
  index.tsx             الرئيسية: كل الجمعيات والإحصائيات
  new.tsx               جمعية جديدة
  circle/[id].tsx       تفاصيل الجمعية: التحصيل / الأدوار / الأعضاء
  circle/edit/[id].tsx  تعديل الجمعية
src/
  core/                 منطق الجمعية (نقي + متختبر)
  store/                حالة التطبيق والتخزين
  features/             مكونات الشاشات المركّبة
  ui/                   نظام التصميم: الألوان، الخطوط، المكونات
tests/                  اختبارات الوحدة (node:test)
```

## التشغيل

المتطلبات: **Node.js 22.6+** وتطبيق **Expo Go** على الموبايل.

```bash
git clone https://github.com/<your-user>/gam3eya.git
cd gam3eya
npm install
npx expo install --fix   # يظبط نسخ المكتبات على Expo SDK
npm start                # امسح الـ QR بتطبيق Expo Go
```

| الأمر | الوظيفة |
|---|---|
| `npm start` | تشغيل سيرفر التطوير |
| `npm test` | اختبارات منطق الجمعية |
| `npm run typecheck` | فحص TypeScript |
| `npm run check` | الاتنين مع بعض |

## النشر على المتاجر

البناء بيتم عن طريق [EAS Build](https://docs.expo.dev/build/introduction/):

```bash
npm install -g eas-cli
eas login
eas build --platform android --profile production   # ملف .aab لجوجل بلاي
eas build --platform ios --profile production       # محتاج حساب Apple Developer
eas submit --platform android
```

## خطة التطوير

شوف [docs/ROADMAP.md](docs/ROADMAP.md) — من ضمنها: استيراد الأعضاء من جهات الاتصال، إشعارات قبل ميعاد القسط، نسخة احتياطية، مشاركة الجمعية مع الأعضاء، ونسخة **Pro**.

## المساهمة

اقرأ [CONTRIBUTING.md](CONTRIBUTING.md).

## الرخصة

[MIT](LICENSE) © 2026 Shady Ahmed Abdo
