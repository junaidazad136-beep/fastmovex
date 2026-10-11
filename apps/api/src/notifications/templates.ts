/** Every notification FastMoveX sends, in English and Arabic. Variables: {{name}}. Kept in code so they are reviewed like code. */
export type NotificationType =
  | 'ORDER_PLACED' | 'GUEST_ORDER_PLACED' | 'ORDER_CONFIRMED' | 'ORDER_SHIPPED' | 'ORDER_OUT_FOR_DELIVERY' | 'ORDER_DELIVERED' | 'ORDER_CANCELLED'
  | 'PAYMENT_FAILED' | 'REFUND_COMPLETED' | 'RETURN_UPDATE' | 'PRICE_DROP' | 'BACK_IN_STOCK'
  | 'SELLER_APPROVED' | 'SELLER_REJECTED' | 'SELLER_NEW_ORDER' | 'PAYOUT_PAID' | 'TICKET_REPLY' | 'PROMOTION' | 'CART_REMINDER' | 'QUESTION_ANSWERED'
  | 'NEW_SIGN_IN' | 'ACCOUNT_LOCKED' | 'DELIVERY_FAILED' | 'ACCOUNT_DELETION_SCHEDULED' | 'ORDER_CHANGED' | 'RETURN_PICKUP_SCHEDULED'
  | StaffAlertType;

/** Alerts for staff (admin bell). In-app always unless switched off; by email when the staff member chose it. */
export const STAFF_ALERTS = ['STAFF_NEW_ORDER', 'STAFF_DELIVERY_FAILED', 'STAFF_REFUND_PENDING', 'STAFF_LOW_STOCK', 'STAFF_STOCKTAKE_SUBMITTED', 'STAFF_CASH_SHORT'] as const;
export type StaffAlertType = (typeof STAFF_ALERTS)[number];

type T = { title: string; body: string };
/**
 * WhatsApp: the approved template's name in WhatsApp Manager and which variables fill {{1}}, {{2}}, … in order.
 * `name` (the customer's first name) is always available. Texts to submit to Meta are in DEPLOYMENT.md.
 */
type WA = { template: string; params: string[] };
export const TEMPLATES: Record<NotificationType, { en: T; ar: T; sms?: boolean; email?: boolean; marketing?: boolean; whatsapp?: WA }> = {
  ORDER_PLACED: { email: true, whatsapp: { template: 'fastmovex_order_placed', params: ['name', 'orderNumber', 'total', 'delivery'] }, en: { title: 'Order received', body: 'We received your order {{orderNumber}}. Total {{total}}.{{slotLine}}' }, ar: { title: 'تم استلام طلبك', body: 'استلمنا طلبك {{orderNumber}}. الإجمالي {{total}}.{{slotLine}}' } },
  // Guests have no account inbox: the email carries the tracking link (or how to look the order up).
  GUEST_ORDER_PLACED: { email: true, whatsapp: { template: 'fastmovex_order_placed', params: ['name', 'orderNumber', 'total', 'delivery'] }, en: { title: 'Order received', body: 'Thank you! We received your order {{orderNumber}}. Total {{total}}.{{slotLine}} {{trackLine}}' }, ar: { title: 'تم استلام طلبك', body: 'شكراً لك! استلمنا طلبك {{orderNumber}}. الإجمالي {{total}}.{{slotLine}} {{trackLine}}' } },
  ORDER_CONFIRMED: { en: { title: 'Order confirmed', body: 'Your order {{orderNumber}} is confirmed.' }, ar: { title: 'تم تأكيد طلبك', body: 'تم تأكيد طلبك {{orderNumber}}.' } },
  ORDER_SHIPPED: { en: { title: 'On its way', body: '{{store}} shipped part of your order {{orderNumber}}.' }, ar: { title: 'طلبك في الطريق', body: 'قام {{store}} بشحن جزء من طلبك {{orderNumber}}.' } },
  // FastMoveX drivers hand over only against the customer's 4-digit code: it travels with this message ({{codeLine}} is empty otherwise)
  ORDER_OUT_FOR_DELIVERY: { sms: true, email: true, whatsapp: { template: 'fastmovex_out_for_delivery_code', params: ['name', 'orderNumber', 'code'] }, en: { title: 'Out for delivery', body: 'Your order {{orderNumber}} from {{store}} arrives today.{{codeLine}}' }, ar: { title: 'خرج للتوصيل', body: 'طلبك {{orderNumber}} من {{store}} يصل اليوم.{{codeLine}}' } },
  ORDER_DELIVERED: { whatsapp: { template: 'fastmovex_order_delivered', params: ['name', 'orderNumber'] }, en: { title: 'Delivered', body: 'Your order {{orderNumber}} from {{store}} was delivered. Tell us how it went!' }, ar: { title: 'تم التوصيل', body: 'تم توصيل طلبك {{orderNumber}} من {{store}}. شاركنا رأيك!' } },
  ORDER_CANCELLED: { email: true, whatsapp: { template: 'fastmovex_order_cancelled', params: ['orderNumber'] }, en: { title: 'Order cancelled', body: 'Part of your order {{orderNumber}} from {{store}} was cancelled. Any payment will be refunded.' }, ar: { title: 'تم إلغاء الطلب', body: 'تم إلغاء جزء من طلبك {{orderNumber}} من {{store}}. سيتم استرداد أي مبلغ مدفوع.' } },
  PAYMENT_FAILED: { en: { title: 'Payment failed', body: 'Payment for order {{orderNumber}} did not go through. Please try again.' }, ar: { title: 'فشل الدفع', body: 'لم يكتمل الدفع للطلب {{orderNumber}}. يرجى المحاولة مرة أخرى.' } },
  REFUND_COMPLETED: { email: true, en: { title: 'Refund sent', body: 'We refunded {{amount}} for order {{orderNumber}}.' }, ar: { title: 'تم الاسترداد', body: 'تم استرداد {{amount}} للطلب {{orderNumber}}.' } },
  RETURN_UPDATE: { en: { title: 'Return update', body: 'Your return for {{product}} was {{status}}.' }, ar: { title: 'تحديث الإرجاع', body: 'تم تحديث طلب إرجاع {{product}}: {{status}}.' } },
  // Alerts the customer switched on for a saved product (wishlist): sent without marketing consent, they asked for them.
  PRICE_DROP: { email: true, whatsapp: { template: 'fastmovex_price_drop', params: ['name', 'product', 'price', 'link'] }, en: { title: 'Price dropped', body: '{{product}} is now {{price}}. {{link}}' }, ar: { title: 'انخفض السعر', body: '{{product}} أصبح الآن {{price}}. {{link}}' } },
  BACK_IN_STOCK: { email: true, whatsapp: { template: 'fastmovex_back_in_stock', params: ['name', 'product', 'link'] }, en: { title: 'Back in stock', body: '{{product}} is available again. {{link}}' }, ar: { title: 'متوفر مجدداً', body: '{{product}} متوفر الآن. {{link}}' } },
  // The store answered a customer's product question (they asked for it, so no marketing consent needed).
  QUESTION_ANSWERED: { email: true, whatsapp: { template: 'fastmovex_question_answered', params: ['name', 'product', 'link'] }, en: { title: 'Your question was answered', body: 'We answered your question about {{product}}. {{link}}' }, ar: { title: 'تمت الإجابة على سؤالك', body: 'أجبنا على سؤالك حول {{product}}. {{link}}' } },
  SELLER_APPROVED: { email: true, en: { title: 'Welcome to FastMoveX', body: 'Your store {{store}} is approved. You can start listing products.' }, ar: { title: 'مرحباً بك في FastMoveX', body: 'تمت الموافقة على متجرك {{store}}. يمكنك البدء بإضافة المنتجات.' } },
  SELLER_REJECTED: { email: true, en: { title: 'Application needs changes', body: 'Your seller application needs updates: {{reason}}' }, ar: { title: 'طلبك يحتاج إلى تعديل', body: 'طلب البائع الخاص بك يحتاج إلى تحديث: {{reason}}' } },
  SELLER_NEW_ORDER: { en: { title: 'New order', body: 'New order {{orderNumber}} — {{items}} item(s).' }, ar: { title: 'طلب جديد', body: 'طلب جديد {{orderNumber}} — {{items}} منتج.' } },
  PAYOUT_PAID: { email: true, en: { title: 'Payout sent', body: 'We sent {{amount}} to your bank account ending {{last4}}.' }, ar: { title: 'تم التحويل', body: 'تم تحويل {{amount}} إلى حسابك المنتهي بـ {{last4}}.' } },
  TICKET_REPLY: { email: true, en: { title: 'Support replied', body: 'New reply on ticket {{ticket}}.' }, ar: { title: 'رد من الدعم', body: 'رد جديد على التذكرة {{ticket}}.' } },
  PROMOTION: { marketing: true, en: { title: '{{title}}', body: '{{body}}' }, ar: { title: '{{title}}', body: '{{body}}' } },
  // Security notices: always sent (no consent needed), by email and in-app
  NEW_SIGN_IN: {
    email: true,
    en: { title: 'New sign-in to your FastMoveX account', body: 'Your account was signed in from {{device}} on {{time}} (Qatar time). If this was not you, change your password now and contact us.' },
    ar: { title: 'تسجيل دخول جديد إلى حسابك في فاست موف إكس', body: 'تم تسجيل الدخول إلى حسابك من {{device}} في {{time}} (بتوقيت قطر). إذا لم تكن أنت، غيّر كلمة المرور فوراً وتواصل معنا.' },
  },
  ACCOUNT_LOCKED: {
    email: true,
    en: { title: 'Sign-in paused for 15 minutes', body: 'After {{n}} wrong attempts, signing in to your FastMoveX account is paused for 15 minutes. If this was not you, reset your password.' },
    ar: { title: 'تم إيقاف تسجيل الدخول مؤقتاً', body: 'بعد {{n}} محاولات خاطئة، تم إيقاف تسجيل الدخول إلى حسابك في فاست موف إكس لمدة 15 دقيقة. إذا لم تكن أنت، أعد تعيين كلمة المرور.' },
  },
  // A driver could not deliver: the customer chooses a new time on the order page
  DELIVERY_FAILED: {
    sms: true, email: true, whatsapp: { template: 'fastmovex_delivery_failed', params: ['name', 'orderNumber', 'link'] },
    en: { title: 'We could not deliver your order', body: 'Our driver could not deliver order {{orderNumber}} ({{reason}}). Choose a new delivery time: {{link}}' },
    ar: { title: 'لم نتمكن من توصيل طلبك', body: 'لم يتمكن السائق من توصيل الطلب {{orderNumber}} ({{reason}}). اختر موعداً جديداً للتوصيل: {{link}}' },
  },
  // Account deletion asked for: the customer can still change their mind by signing in before the date
  ACCOUNT_DELETION_SCHEDULED: {
    email: true,
    en: { title: 'Your FastMoveX account will be deleted', body: 'We received your request. Your account and personal details will be deleted on {{date}}. Changed your mind? Sign in before then and choose "Keep my account". Orders and invoices are kept without your name, as the law requires.' },
    ar: { title: 'سيتم حذف حسابك في فاست موف إكس', body: 'استلمنا طلبك. سيتم حذف حسابك وبياناتك الشخصية في {{date}}. غيّرت رأيك؟ سجّل الدخول قبل ذلك واختر "الإبقاء على حسابي". نحتفظ بالطلبات والفواتير دون اسمك كما يقتضي القانون.' },
  },
  // Abandoned cart: a promotion in the eyes of the law and WhatsApp, so only with marketing consent.
  CART_REMINDER: {
    marketing: true, email: true, whatsapp: { template: 'fastmovex_cart_reminder', params: ['name', 'items', 'link'] },
    en: { title: 'Your cart is waiting', body: 'Hi {{name}}, you left {{items}} in your FastMoveX cart. Complete your order here: {{link}}' },
    ar: { title: 'سلتك بانتظارك', body: 'مرحباً {{name}}، تركت {{items}} في سلة فاست موف إكس. أكمل طلبك من هنا: {{link}}' },
  },
  // The order was changed after checkout (by our team, by the customer, or items refused at the door): what changed and the money
  ORDER_CHANGED: {
    email: true,
    en: { title: 'Your order {{orderNumber}} was updated', body: '{{summary}}{{moneyLine}}' },
    ar: { title: 'تم تحديث طلبك {{orderNumber}}', body: '{{summary}}{{moneyLine}}' },
  },
  // A driver will collect the customer's approved return
  RETURN_PICKUP_SCHEDULED: {
    email: true, sms: true,
    en: { title: 'We will collect your return', body: 'Our driver will collect {{product}} on {{date}}. Please have it ready in its packaging.' },
    ar: { title: 'سنستلم المرتجع منك', body: 'سيستلم السائق {{product}} يوم {{date}}. يرجى تجهيزه في عبوته.' },
  },
  // ---- staff alerts (admin bell); {{link}} is the admin page, added to the email when ADMIN_URL is set
  STAFF_NEW_ORDER: { en: { title: 'New order {{orderNumber}}', body: '{{customer}} · {{items}} item(s) · {{total}} · {{payment}}{{slotLine}}' }, ar: { title: 'طلب جديد {{orderNumber}}', body: '{{customer}} · {{items}} منتج · {{total}} · {{payment}}{{slotLine}}' } },
  STAFF_DELIVERY_FAILED: { en: { title: 'Delivery failed: {{orderNumber}}', body: '{{driver}}: {{reason}}{{farLine}}' }, ar: { title: 'فشل التوصيل: {{orderNumber}}', body: '{{driver}}: {{reason}}{{farLine}}' } },
  STAFF_REFUND_PENDING: { en: { title: 'Refund to approve', body: '{{amount}} for order {{orderNumber}} — {{reason}}' }, ar: { title: 'استرداد بانتظار الموافقة', body: '{{amount}} للطلب {{orderNumber}} — {{reason}}' } },
  STAFF_LOW_STOCK: { en: { title: '{{count}} product(s) running low', body: '{{list}}' }, ar: { title: '{{count}} منتج على وشك النفاد', body: '{{list}}' } },
  STAFF_STOCKTAKE_SUBMITTED: { en: { title: 'Stocktake {{number}} to approve', body: '{{warehouse}} · {{lines}} line(s) counted, {{diffs}} with a difference · by {{by}}' }, ar: { title: 'جرد {{number}} بانتظار الموافقة', body: '{{warehouse}} · {{lines}} سطر، {{diffs}} بفرق · بواسطة {{by}}' } },
  STAFF_CASH_SHORT: { en: { title: 'Cash short {{amount}}', body: '{{driver}} handed over {{received}} of {{expected}} ({{number}}){{noteLine}}' }, ar: { title: 'نقص نقدي {{amount}}', body: '{{driver}} سلّم {{received}} من {{expected}} ({{number}}){{noteLine}}' } },
};

/** Replaces {{key}}; unknown keys become empty. Values are plain text (never HTML), capped in length. */
export function render(tpl: string, vars: Record<string, string | number | null | undefined>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(vars[k] ?? '').slice(0, 300));
}

/** 12345 minor units in QAR -> "QAR 123.45". KWD/BHD/OMR use 3 decimals. */
export function formatMoney(minor: bigint | string, currency: string, minorUnits = 2): string {
  const v = BigInt(minor);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(minorUnits);
  const frac = minorUnits ? `.${(abs % base).toString().padStart(minorUnits, '0')}` : '';
  return `${neg ? '-' : ''}${currency} ${(abs / base).toString()}${frac}`;
}
