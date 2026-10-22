/** Turns Firebase / network errors into short Egyptian-Arabic messages. */

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const MESSAGES: Record<string, string> = {
  // App-level
  'dory/circle-full': 'الجمعية كملت عدد أعضائها. زوّد العدد من الإعدادات الأول.',
  'dory/instapay-invalid': 'رقم أو إيميل إنستاباي مش صحيح. مثال: 01012345678 أو name@instapay',
  'dory/name-missing': 'اكتب اسمك زي ما صاحب الجمعية عارفك.',
  'dory/circle-closed': 'الجمعية دي مش بتستقبل أعضاء جدد دلوقتي. كلّم صاحب الجمعية.',
  'dory/invite-not-found': 'كود الجمعية مش صحيح. اتأكد منه مع صاحب الجمعية.',
  'dory/phone-not-found': 'الرقم ده مش مسجل في الجمعية. لو دي أول مرة، ابعت طلب انضمام باسمك.',
  'dory/already-linked': 'الرقم ده داخل الجمعية من موبايل تاني دلوقتي. اعمل تسجيل خروج من هناك الأول، أو اطلب من صاحب الجمعية يفك الربط.',
  'dory/invalid-phone': 'اكتب رقم موبايل صحيح.',
  'dory/offline-timeout': 'النت ضعيف. التعديل هيتحفظ أول ما الاتصال يرجع.',
  'dory/receipt-missing': 'لازم ترفع صورة التحويل لما تدفع إنستاباي أو فودافون كاش.',
  'dory/receipt-too-large': 'الصورة كبيرة جدًا. جرّب صورة تانية أو قصّ الصورة.',
  'dory/payout-receipt-missing': 'ارفق صورة التحويل قبل ما تسجّل إنك حوّلت القبض.',
  'dory/account-missing': 'اكتب رقم فودافون كاش أو عنوان إنستاباي.',
  'dory/account-invalid': 'الرقم أو العنوان مش صحيح. اتأكد منه.',
  'dory/invalid-group-link': 'ده مش لينك جروب واتساب. انسخ لينك الدعوة من إعدادات الجروب.',
  'dory/not-configured': 'التطبيق مش متوصل بالسيرفر. كلم الدعم الفني.',

  // Firestore
  'permission-denied': 'مش مسموح لك تعمل العملية دي.',
  unavailable: 'مفيش اتصال بالسيرفر دلوقتي. جرّب تاني بعد شوية.',
  'deadline-exceeded': 'السيرفر اتأخر في الرد. جرّب تاني.',
  'not-found': 'البيانات دي مش موجودة، ممكن تكون اتمسحت.',
  aborted: 'حصل تعديل في نفس الوقت من جهاز تاني. جرّب تاني.',
  'resource-exhausted': 'ضغط كبير على السيرفر. جرّب كمان دقيقة.',
  'failed-precondition': 'العملية مش متاحة دلوقتي. جرّب تاني.',

  // Auth
  'auth/invalid-email': 'رقم الموبايل مكتوب غلط.',
  'auth/invalid-credential': 'الرقم أو الرقم السري غلط.',
  'auth/wrong-password': 'الرقم أو الرقم السري غلط.',
  'auth/user-not-found': 'مفيش حساب بالرقم ده.',
  'auth/email-already-in-use': 'الرقم ده عليه حساب بالفعل. سجّل دخول.',
  'auth/weak-password': 'الرقم السري لازم يكون ٦ حروف أو أرقام أو أكتر.',
  'auth/too-many-requests': 'محاولات كتير. استنى شوية وجرّب تاني.',
  'auth/network-request-failed': 'مفيش نت. اتأكد من الاتصال وجرّب تاني.',
  'auth/credential-already-in-use': 'الرقم ده مربوط بحساب تاني.',
  'dory/receipt-required': 'لازم ترفق صورة إيصال التحويل لأي دفع بإنستاباي أو فودافون كاش.',
  'dory/signin-failed': 'الباسورد غلط. لو نسيته، اطلب من صاحب الجمعية يفك الربط وبعدها تختار باسورد جديد.',
  'dory/receipt-used': 'الإيصال ده اتستخدم قبل كده في الجمعية. ارفع إيصال التحويل بتاعك إنت.',
  'dory/own-circle': 'إنت صاحب الجمعية دي ومسجّل فيها بالفعل. علشان تجرب كعضو، استخدم موبايل تاني أو اعمل تسجيل خروج من حساب صاحب الجمعية الأول.',
  'dory/phone-taken': 'الرقم ده متسجل لعضو في الجمعية. لو ده إنت، ادخل بكود الجمعية ورقمك.',
  'auth/requires-recent-login': 'لأمان حسابك، اخرج وادخل تاني وبعدين غيّر الإيميل.',
  'auth/operation-not-allowed': 'تغيير الإيميل مش متاح دلوقتي. جرّب بعدين.',
  'auth/missing-password': 'اكتب الباسورد الحالي.',
};

export function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) return String((error as { code: unknown }).code);
  return 'unknown';
}

export function arabicError(error: unknown): string {
  const code = errorCode(error);
  const known = MESSAGES[code] ?? MESSAGES[code.replace(/^firestore\//, '')];
  if (known) return known;
  // Our own validation messages (thrown as plain Errors) are already user-facing.
  if (error instanceof Error && /[\u0600-\u06FF]/.test(error.message)) return error.message;
  return 'حصلت مشكلة غير متوقعة. جرّب تاني.';
}

/**
 * Firestore writes made offline only resolve once the server acknowledges them.
 * The write is already queued locally, so after `ms` we stop waiting and tell
 * the user it will sync, instead of leaving a spinner forever.
 */
export async function withTimeout<T>(promise: Promise<T>, ms = 12_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AppError('dory/offline-timeout', MESSAGES['dory/offline-timeout'])), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Retries reads on transient network errors with exponential backoff. */
export async function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      const code = errorCode(e);
      if (!['unavailable', 'deadline-exceeded', 'auth/network-request-failed'].includes(code)) throw e;
      await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    }
  }
  throw lastError;
}
