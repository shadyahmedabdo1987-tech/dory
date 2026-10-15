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

const MESSAGES: Record<string, string> = {
  // App-level
  'dory/invite-not-found': 'كود الجمعية مش صحيح. اتأكد منه مع صاحب الجمعية.',
  'dory/phone-not-found': 'الرقم ده مش مسجل في الجمعية. اتأكد إنه نفس الرقم اللي صاحب الجمعية كتبه.',
  'dory/already-linked': 'الرقم ده متسجل بالفعل على موبايل تاني. اطلب من صاحب الجمعية يفك الربط.',
  'dory/invalid-phone': 'اكتب رقم موبايل صحيح.',
  'dory/offline-timeout': 'النت ضعيف. التعديل هيتحفظ أول ما الاتصال يرجع.',
  'dory/receipt-missing': 'لازم ترفع صورة التحويل لما تدفع إنستاباي أو فودافون كاش.',
  'dory/receipt-too-large': 'الصورة كبيرة جدًا. جرّب صورة تانية أو قصّ الصورة.',
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
  'auth/invalid-email': 'الإيميل مكتوب غلط.',
  'auth/invalid-credential': 'الإيميل أو كلمة السر غلط.',
  'auth/wrong-password': 'الإيميل أو كلمة السر غلط.',
  'auth/user-not-found': 'مفيش حساب بالإيميل ده.',
  'auth/email-already-in-use': 'الإيميل ده عليه حساب بالفعل. سجّل دخول.',
  'auth/weak-password': 'كلمة السر لازم تكون ٦ حروف أو أكتر.',
  'auth/too-many-requests': 'محاولات كتير. استنى شوية وجرّب تاني.',
  'auth/network-request-failed': 'مفيش نت. اتأكد من الاتصال وجرّب تاني.',
  'auth/credential-already-in-use': 'الإيميل ده مربوط بحساب تاني.',
};

export function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) return String((error as { code: unknown }).code);
  return 'unknown';
}

export function arabicError(error: unknown): string {
  const code = errorCode(error);
  return MESSAGES[code] ?? MESSAGES[code.replace(/^firestore\//, '')] ?? 'حصلت مشكلة غير متوقعة. جرّب تاني.';
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
