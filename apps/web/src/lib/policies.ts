import type { Locale } from './i18n/config';
import { privacyAr, privacyEn, termsAr, termsEn } from './policies-legal';

/**
 * Customer and seller policies, in English and Arabic. Kept in code (not the CMS) because they describe how the
 * platform works — return windows, payouts, warranty steps — and change together with it.
 */
export interface PolicySection {
  id: string;
  h: string;
  p?: string[];
  list?: string[];
  steps?: string[];
  table?: { head: string[]; rows: string[][] };
  note?: string;
}
export interface Policy { title: string; intro: string; updated: string; sections: PolicySection[] }

export const POLICY_UPDATED = '2026-10-13';

const returnsEn: Policy = {
  title: 'Returns, refunds and warranty',
  intro: 'What you can return, how long you have, and how faulty items are repaired, replaced or refunded on FastMoveX.',
  updated: POLICY_UPDATED,
  sections: [
    {
      id: 'periods',
      h: 'How long you have',
      p: ['The return period starts on the day your order is delivered. Each product page also shows its own return period and warranty.'],
      table: {
        head: ['Category', 'Return period', 'Condition'],
        rows: [
          ['Mobiles, laptops, tablets, TVs, gaming', '7 days', 'Box still sealed — or faulty'],
          ['Small electronics (earbuds, chargers, smart watches)', '7 days', 'Box still sealed — or faulty'],
          ['Home, kitchen and appliances', '7 days', 'Unused, in the original packaging'],
          ['Clothing, shoes and bags', '14 days', 'Unworn, with tags'],
          ['Perfume, oud and bakhoor', '7 days', 'Seal unbroken'],
          ['Makeup, skincare and personal care', '7 days', 'Seal unbroken'],
          ['Books, toys and stationery', '7 days', 'Unused'],
        ],
      },
    },
    {
      id: 'not-returnable',
      h: 'What cannot be returned',
      p: ['These items cannot be returned once opened or used, for hygiene and safety — unless they arrived wrong, damaged or faulty:'],
      list: [
        'Opened perfume, oud, bakhoor, makeup, skincare and personal care',
        'Food, groceries and health products',
        'Underwear and swimwear without the original seal',
        'Opened earbuds and headphones that are working',
        'Gift cards and personalised or made-to-order items',
      ],
    },
    {
      id: 'wrong-damaged',
      h: 'Wrong, damaged or missing items',
      p: [
        'Tell us within 48 hours of delivery, with a photo. We collect it free of charge and send the right item or give you a full refund.',
        'Please do not use an item that arrived damaged — keep it with its box until we collect it.',
      ],
    },
    {
      id: 'warranty',
      h: 'Faulty items and warranty',
      steps: [
        'Faulty within 7 days of delivery: we replace it or give you a full refund.',
        'Faulty after 7 days, during the warranty: we collect it, the seller or the brand repairs it, and we bring it back to you.',
        'If it cannot be repaired within 14 days, we replace it. If a replacement is not available, we refund you.',
      ],
      p: [
        'Electronics come with at least 12 months of warranty, or the brand’s warranty when longer — shown on the product page.',
        'The warranty does not cover damage from drops, water, misuse, or opening or repairing the item yourself.',
      ],
    },
    {
      id: 'how',
      h: 'How to return an item',
      steps: [
        'Open My account → Orders, choose the order and tap Return next to the item.',
        'Tell us why and add a photo if the item is wrong, damaged or faulty.',
        'The seller replies within 24 hours. If they do not, FastMoveX decides.',
        'A FastMoveX driver collects the item from your address. Keep it in its original box with all accessories, manuals and gifts.',
        'We check it within 2 working days and send your refund.',
      ],
    },
    {
      id: 'fees',
      h: 'Collection fee',
      list: [
        'Wrong, damaged or faulty item: free.',
        'Change of mind: QAR 10, taken from your refund.',
      ],
    },
    {
      id: 'refunds',
      h: 'Your refund',
      p: ['Refunds are sent within 5 working days after we check the item. If it comes back used, damaged or incomplete, we may refuse the return or reduce the refund and will tell you why, with photos.'],
      table: {
        head: ['You paid by', 'Refund goes to', 'Time'],
        rows: [
          ['Card, Apple Pay or Google Pay', 'The same card', '5 working days (your bank may take 3–7 days more)'],
          ['Cash on delivery', 'Your bank account (IBAN) — we will ask for it', '5 working days'],
        ],
      },
    },
    {
      id: 'help',
      h: 'Need help?',
      p: ['Write to us from [Contact us](/contact), or open a support ticket from your order. Your rights under Qatar’s Consumer Protection Law (No. 8 of 2008) are not affected by this policy.'],
    },
  ],
};

const returnsAr: Policy = {
  title: 'الإرجاع والاسترداد والضمان',
  intro: 'ما يمكنك إرجاعه، والمدة المتاحة لك، وكيف يتم إصلاح المنتجات المعيبة أو استبدالها أو استرداد ثمنها على فاست موف إكس.',
  updated: POLICY_UPDATED,
  sections: [
    {
      id: 'periods',
      h: 'المدة المتاحة للإرجاع',
      p: ['تبدأ مدة الإرجاع من يوم توصيل طلبك. كما تعرض صفحة كل منتج مدة الإرجاع والضمان الخاصة به.'],
      table: {
        head: ['القسم', 'مدة الإرجاع', 'الشرط'],
        rows: [
          ['الجوالات واللابتوبات والأجهزة اللوحية والتلفزيونات والألعاب', '7 أيام', 'العلبة مغلقة — أو المنتج معيب'],
          ['الإلكترونيات الصغيرة (السماعات والشواحن والساعات الذكية)', '7 أيام', 'العلبة مغلقة — أو المنتج معيب'],
          ['المنزل والمطبخ والأجهزة المنزلية', '7 أيام', 'غير مستخدم وفي عبوته الأصلية'],
          ['الملابس والأحذية والحقائب', '14 يوماً', 'غير ملبوس ومعه البطاقات'],
          ['العطور والعود والبخور', '7 أيام', 'الختم سليم'],
          ['المكياج والعناية بالبشرة والعناية الشخصية', '7 أيام', 'الختم سليم'],
          ['الكتب والألعاب والقرطاسية', '7 أيام', 'غير مستخدم'],
        ],
      },
    },
    {
      id: 'not-returnable',
      h: 'ما لا يمكن إرجاعه',
      p: ['لا يمكن إرجاع هذه المنتجات بعد فتحها أو استخدامها لأسباب صحية وسلامة — إلا إذا وصلت خطأً أو تالفة أو معيبة:'],
      list: [
        'العطور والعود والبخور والمكياج ومنتجات العناية الشخصية بعد فتحها',
        'المواد الغذائية والبقالة والمنتجات الصحية',
        'الملابس الداخلية وملابس السباحة بدون الختم الأصلي',
        'السماعات المفتوحة التي تعمل بشكل سليم',
        'بطاقات الهدايا والمنتجات المخصصة أو المصنوعة حسب الطلب',
      ],
    },
    {
      id: 'wrong-damaged',
      h: 'منتج خطأ أو تالف أو ناقص',
      p: [
        'أبلغنا خلال 48 ساعة من التوصيل مع صورة. نستلمه مجاناً ونرسل المنتج الصحيح أو نعيد لك المبلغ كاملاً.',
        'يرجى عدم استخدام المنتج الذي وصل تالفاً — احتفظ به مع علبته حتى نستلمه.',
      ],
    },
    {
      id: 'warranty',
      h: 'المنتجات المعيبة والضمان',
      steps: [
        'عيب خلال 7 أيام من التوصيل: نستبدله أو نعيد لك المبلغ كاملاً.',
        'عيب بعد 7 أيام وخلال فترة الضمان: نستلمه، ويصلحه البائع أو الوكيل، ثم نعيده إليك.',
        'إذا تعذّر الإصلاح خلال 14 يوماً نستبدله، وإذا لم يتوفر البديل نعيد لك المبلغ.',
      ],
      p: [
        'تأتي الإلكترونيات بضمان لا يقل عن 12 شهراً، أو بضمان الوكيل إذا كان أطول — كما هو موضح في صفحة المنتج.',
        'لا يشمل الضمان الأضرار الناتجة عن السقوط أو الماء أو سوء الاستخدام أو فتح المنتج أو إصلاحه بنفسك.',
      ],
    },
    {
      id: 'how',
      h: 'كيف ترجع منتجاً',
      steps: [
        'افتح حسابي ← الطلبات، واختر الطلب ثم اضغط «إرجاع» بجانب المنتج.',
        'اذكر السبب وأرفق صورة إذا كان المنتج خطأً أو تالفاً أو معيباً.',
        'يرد البائع خلال 24 ساعة، وإن لم يرد تتخذ فاست موف إكس القرار.',
        'يستلم سائق فاست موف إكس المنتج من عنوانك. احتفظ به في علبته الأصلية مع كل الملحقات والدليل والهدايا.',
        'نفحصه خلال يومَي عمل ثم نرسل المبلغ المسترد.',
      ],
    },
    {
      id: 'fees',
      h: 'رسوم الاستلام',
      list: [
        'منتج خطأ أو تالف أو معيب: مجاناً.',
        'تغيير الرأي: 10 ر.ق تُخصم من المبلغ المسترد.',
      ],
    },
    {
      id: 'refunds',
      h: 'استرداد المبلغ',
      p: ['نرسل المبلغ المسترد خلال 5 أيام عمل بعد فحص المنتج. إذا عاد مستخدماً أو تالفاً أو ناقصاً فقد نرفض الإرجاع أو نخصم جزءاً من المبلغ مع توضيح السبب بالصور.'],
      table: {
        head: ['طريقة الدفع', 'يُعاد المبلغ إلى', 'المدة'],
        rows: [
          ['بطاقة أو Apple Pay أو Google Pay', 'البطاقة نفسها', '5 أيام عمل (وقد يحتاج البنك 3–7 أيام إضافية)'],
          ['الدفع عند الاستلام', 'حسابك البنكي (IBAN) — سنطلبه منك', '5 أيام عمل'],
        ],
      },
    },
    {
      id: 'help',
      h: 'تحتاج مساعدة؟',
      p: ['راسلنا من [تواصل معنا](/contact)، أو افتح تذكرة دعم من طلبك. لا تمس هذه السياسة حقوقك بموجب قانون حماية المستهلك القطري رقم (8) لسنة 2008.'],
    },
  ],
};

const sellerEn: Policy = {
  title: 'Seller policy',
  intro: 'The rules for selling on FastMoveX: who can sell, what you may list, how orders, returns, warranty and payouts work, and how you must treat customer data. Please read it before you open a seller account.',
  updated: POLICY_UPDATED,
  sections: [
    {
      id: 'who',
      h: '1. Who can sell',
      list: [
        'A business registered in Qatar with a valid Commercial Registration (CR).',
        'A bank account in Qatar in the business’s or owner’s name, for payouts.',
        'A phone number we and our drivers can reach during working hours.',
        'We check every application, usually within 1–2 working days, and may ask for more documents.',
      ],
    },
    {
      id: 'what',
      h: '2. What you may sell',
      p: ['Only new, genuine products that you have in stock and are allowed to sell in Qatar. Not allowed:'],
      list: [
        'Counterfeit or copied brands, or items without proof of origin when we ask',
        'Used or refurbished items listed as new',
        'Weapons, alcohol, tobacco and vapes, and adult products',
        'Prescription medicines and items that need a licence you do not hold',
        'Recalled, expired or unsafe products',
        'Food without the required municipality approval',
      ],
    },
    {
      id: 'listing',
      h: '3. Listing your products',
      list: [
        'Real, clear photos of the product itself; the correct price, specifications and stock.',
        'Every product is checked by FastMoveX before it goes live.',
        'Electronics must show their warranty (at least 12 months, or the brand’s warranty).',
        'Keep stock up to date: an order you cannot send counts as a cancellation.',
      ],
    },
    {
      id: 'fees',
      h: '4. Commission',
      p: [
        'FastMoveX takes a commission only on what you sell: between 5% and 15% of the item price, depending on the category. Your rate is written in your seller agreement and shown on every order.',
        'The delivery fee the customer pays belongs to FastMoveX. Discounts you offer are paid by you.',
      ],
    },
    {
      id: 'orders',
      h: '5. Orders and packing',
      steps: [
        'A new order appears in Seller Center with a sound and a notification.',
        'Within 24 hours (48 hours on Fridays) tap Print: the 10 × 15 cm label and the packing list come out.',
        'Pack the items in a strong box, put the packing list inside and the label on top.',
        'Tap “Ready for pickup”. A FastMoveX driver scans the label, collects the parcel and delivers it.',
      ],
      p: ['You may deliver an order yourself instead; you then update its status, and the customer’s 4-digit code confirms delivery.'],
    },
    {
      id: 'payouts',
      h: '6. Getting paid',
      list: [
        'Cash on delivery is collected by our driver and counted in your balance.',
        'Your money is held for the customer’s return period after delivery (7 days; clothing 14 days), then becomes ready.',
        'Every Sunday we send everything that is ready to your bank — within 14 days of delivery for most orders. You can also ask for a payout earlier.',
        'Minimum payout QAR 50. Every amount is in your statement in Seller Center.',
      ],
    },
    {
      id: 'returns',
      h: '7. Returns',
      list: [
        'Customers return items under our [Returns, refunds and warranty policy](/help/returns).',
        'Approve or refuse a return request within 24 hours; after that, FastMoveX decides.',
        'Wrong, damaged, faulty or not-as-described items: the refund and the collection cost come out of your balance.',
        'Change of mind: the customer pays the collection fee; the item comes back to you.',
        'If an item comes back used or damaged by the customer, tell us within 2 working days with photos; we may refuse the return or reduce the refund.',
      ],
    },
    {
      id: 'warranty',
      h: '8. Warranty',
      list: [
        'Faulty within 7 days of delivery: you replace it or the customer is refunded.',
        'Faulty later, during the warranty: we collect it, you (or the brand) repair it within 14 days, and we deliver it back.',
        'If you cannot repair it in time, replace it; if you cannot, the customer is refunded from your balance.',
        'The cost of collecting and returning warranty items is yours.',
      ],
    },
    {
      id: 'data',
      h: '9. Customer data and privacy',
      p: ['You see a customer’s name, phone number and address only to prepare and deliver their order. You must:'],
      list: [
        'Use it for that order only — never for marketing, calls or messages of your own',
        'Never share, sell or copy it, and keep printed labels and lists away from others',
        'Destroy printed labels and lists once the order is delivered',
        'Follow Qatar’s Personal Data Privacy Protection Law (No. 13 of 2016)',
      ],
      note: 'Misusing customer data closes your seller account.',
    },
    {
      id: 'performance',
      h: '10. Performance and penalties',
      table: {
        head: ['Problem', 'What happens'],
        rows: [
          ['Order not ready within 24 hours', 'Warning; if it repeats, your products are hidden'],
          ['Order cancelled because you had no stock', 'QAR 10 per cancellation; above 5% of orders, a review'],
          ['Counterfeit or prohibited item', 'Account closed and payouts held'],
          ['Many wrong or damaged items', 'Review; products may be hidden'],
        ],
      },
      p: ['Good sellers — fast packing, few cancellations, good reviews — are shown more on the home page.'],
    },
    {
      id: 'account',
      h: '11. Your account',
      list: [
        'We may pause an account that breaks this policy; we tell you why.',
        'You may close your account at any time once open orders and returns are finished; your remaining balance is paid out.',
        'We tell you by email at least 14 days before this policy changes.',
      ],
    },
  ],
};

const sellerAr: Policy = {
  title: 'سياسة البائعين',
  intro: 'قواعد البيع على فاست موف إكس: من يمكنه البيع، وما يُسمح بعرضه، وكيف تتم الطلبات والإرجاع والضمان وتحويل الأرباح، وكيف تتعامل مع بيانات العملاء. يرجى قراءتها قبل فتح حساب البائع.',
  updated: POLICY_UPDATED,
  sections: [
    {
      id: 'who',
      h: '1. من يمكنه البيع',
      list: [
        'نشاط تجاري مسجّل في قطر بسجل تجاري ساري المفعول.',
        'حساب بنكي في قطر باسم النشاط أو المالك لتحويل الأرباح.',
        'رقم هاتف يمكننا ويمكن للسائقين الوصول إليه خلال ساعات العمل.',
        'نراجع كل طلب عادةً خلال يوم إلى يومي عمل، وقد نطلب مستندات إضافية.',
      ],
    },
    {
      id: 'what',
      h: '2. ما يُسمح ببيعه',
      p: ['فقط المنتجات الجديدة والأصلية المتوفرة لديك والمسموح ببيعها في قطر. غير مسموح:'],
      list: [
        'الماركات المقلّدة، أو المنتجات بدون إثبات مصدرها عند الطلب',
        'المنتجات المستعملة أو المجدّدة المعروضة على أنها جديدة',
        'الأسلحة والكحول والتبغ والسجائر الإلكترونية ومنتجات البالغين',
        'الأدوية التي تحتاج وصفة طبية والمنتجات التي تحتاج ترخيصاً لا تملكه',
        'المنتجات المسحوبة أو منتهية الصلاحية أو غير الآمنة',
        'المواد الغذائية بدون موافقة البلدية المطلوبة',
      ],
    },
    {
      id: 'listing',
      h: '3. عرض منتجاتك',
      list: [
        'صور حقيقية وواضحة للمنتج نفسه، وسعر ومواصفات ومخزون صحيحة.',
        'تراجع فاست موف إكس كل منتج قبل عرضه.',
        'يجب أن تُظهر الإلكترونيات مدة الضمان (12 شهراً على الأقل، أو ضمان الوكيل).',
        'حدّث المخزون باستمرار: الطلب الذي لا تستطيع إرساله يُحسب إلغاءً.',
      ],
    },
    {
      id: 'fees',
      h: '4. العمولة',
      p: [
        'تأخذ فاست موف إكس عمولة على ما تبيعه فقط: من 5% إلى 15% من سعر المنتج حسب القسم. نسبتك مكتوبة في اتفاقية البائع وتظهر في كل طلب.',
        'رسوم التوصيل التي يدفعها العميل تعود لفاست موف إكس، والخصومات التي تقدمها تتحملها أنت.',
      ],
    },
    {
      id: 'orders',
      h: '5. الطلبات والتغليف',
      steps: [
        'يظهر الطلب الجديد في مركز البائعين مع صوت وإشعار.',
        'خلال 24 ساعة (48 ساعة يوم الجمعة) اضغط «طباعة»: يخرج ملصق 10 × 15 سم وقائمة التعبئة.',
        'غلّف المنتجات في صندوق متين، وضع قائمة التعبئة داخله والملصق فوقه.',
        'اضغط «جاهز للاستلام». يمسح سائق فاست موف إكس الملصق ويستلم الطرد ويوصله.',
      ],
      p: ['يمكنك توصيل الطلب بنفسك بدلاً من ذلك، وعندها تحدّث حالته بنفسك، ويؤكد رمز العميل المكوّن من 4 أرقام التوصيل.'],
    },
    {
      id: 'payouts',
      h: '6. استلام أرباحك',
      list: [
        'يحصّل سائقنا مبلغ الدفع عند الاستلام ويُضاف إلى رصيدك.',
        'يُحجز المبلغ خلال فترة الإرجاع بعد التوصيل (7 أيام، والملابس 14 يوماً) ثم يصبح جاهزاً.',
        'كل يوم أحد نحوّل كل المبالغ الجاهزة إلى بنكك — خلال 14 يوماً من التوصيل لمعظم الطلبات. ويمكنك طلب التحويل قبل ذلك.',
        'أقل مبلغ للتحويل 50 ر.ق، وكل مبلغ يظهر في كشف حسابك في مركز البائعين.',
      ],
    },
    {
      id: 'returns',
      h: '7. الإرجاع',
      list: [
        'يرجع العملاء المنتجات وفق [سياسة الإرجاع والاسترداد والضمان](/help/returns).',
        'وافق على طلب الإرجاع أو ارفضه خلال 24 ساعة، وبعدها تتخذ فاست موف إكس القرار.',
        'المنتج الخطأ أو التالف أو المعيب أو المخالف للوصف: يُخصم المبلغ المسترد وتكلفة الاستلام من رصيدك.',
        'تغيير رأي العميل: يدفع العميل رسوم الاستلام ويعود المنتج إليك.',
        'إذا عاد المنتج مستخدماً أو تالفاً بفعل العميل فأبلغنا خلال يومي عمل مع صور، وقد نرفض الإرجاع أو نخصم من المبلغ المسترد.',
      ],
    },
    {
      id: 'warranty',
      h: '8. الضمان',
      list: [
        'عيب خلال 7 أيام من التوصيل: تستبدل المنتج أو يُعاد المبلغ للعميل.',
        'عيب بعد ذلك وخلال الضمان: نستلم المنتج، وتصلحه أنت (أو الوكيل) خلال 14 يوماً، ثم نعيده للعميل.',
        'إذا لم تستطع الإصلاح في الوقت المحدد فاستبدله، وإن تعذّر ذلك يُعاد المبلغ للعميل من رصيدك.',
        'تكلفة استلام منتجات الضمان وإعادتها عليك.',
      ],
    },
    {
      id: 'data',
      h: '9. بيانات العملاء والخصوصية',
      p: ['ترى اسم العميل ورقم هاتفه وعنوانه فقط لتجهيز طلبه وتوصيله. يجب عليك:'],
      list: [
        'استخدامها لهذا الطلب فقط — وليس للتسويق أو الاتصال أو الرسائل الخاصة بك',
        'عدم مشاركتها أو بيعها أو نسخها، وإبعاد الملصقات والقوائم المطبوعة عن الآخرين',
        'إتلاف الملصقات والقوائم المطبوعة بعد توصيل الطلب',
        'الالتزام بقانون حماية خصوصية البيانات الشخصية القطري رقم (13) لسنة 2016',
      ],
      note: 'إساءة استخدام بيانات العملاء تؤدي إلى إغلاق حساب البائع.',
    },
    {
      id: 'performance',
      h: '10. الأداء والمخالفات',
      table: {
        head: ['المشكلة', 'ما يحدث'],
        rows: [
          ['الطلب غير جاهز خلال 24 ساعة', 'تنبيه، وعند التكرار تُخفى منتجاتك'],
          ['إلغاء الطلب لعدم توفر المخزون', '10 ر.ق عن كل إلغاء، وفوق 5% من الطلبات مراجعة للحساب'],
          ['منتج مقلّد أو ممنوع', 'إغلاق الحساب وحجز التحويلات'],
          ['تكرار المنتجات الخطأ أو التالفة', 'مراجعة، وقد تُخفى المنتجات'],
        ],
      },
      p: ['البائعون المتميزون — تجهيز سريع وإلغاءات قليلة وتقييمات جيدة — يظهرون أكثر في الصفحة الرئيسية.'],
    },
    {
      id: 'account',
      h: '11. حسابك',
      list: [
        'قد نوقف الحساب الذي يخالف هذه السياسة مؤقتاً، ونوضح لك السبب.',
        'يمكنك إغلاق حسابك في أي وقت بعد إنهاء الطلبات والمرتجعات المفتوحة، ويُحوَّل رصيدك المتبقي.',
        'نبلغك بالبريد الإلكتروني قبل 14 يوماً على الأقل من أي تغيير في هذه السياسة.',
      ],
    },
  ],
};

export const POLICIES = {
  returns: { en: returnsEn, ar: returnsAr },
  seller: { en: sellerEn, ar: sellerAr },
  terms: { en: termsEn, ar: termsAr },
  privacy: { en: privacyEn, ar: privacyAr },
} as const;
export type PolicyKind = keyof typeof POLICIES;

export function policy(kind: PolicyKind, locale: Locale): Policy {
  return POLICIES[kind][locale];
}
