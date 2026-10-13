import type { Policy } from './policies';

/**
 * Terms of use and the privacy policy, in English and Arabic. Written to match how the platform actually works
 * (cancellation rules, delivery codes, data export and deletion). Have them reviewed by a lawyer in Qatar.
 * Text may use **bold** and [links](/path) — rendered by `inline()` from RichText.
 */
const UPDATED = '2026-10-13';

export const termsEn: Policy = {
  title: 'Terms of use',
  intro: 'The rules for shopping on FastMoveX: how orders, payment, cancellation and delivery work, and what we and you each agree to. By using FastMoveX or placing an order, you accept these terms.',
  updated: UPDATED,
  sections: [
    {
      id: 'about',
      h: '1. About FastMoveX',
      p: [
        'FastMoveX is an online marketplace in Qatar. Products are sold either by FastMoveX or by independent sellers in Qatar; every product page shows **“Sold by”** so you always know who the seller is.',
        'Whoever the seller is, FastMoveX takes your payment, delivers your order and handles your returns, refunds and support — you deal with us.',
      ],
    },
    {
      id: 'account',
      h: '2. Your account',
      list: [
        'You must be 18 or older to open an account, or shop with the permission of a parent or guardian.',
        'Give your real name, mobile number and address, and keep them up to date.',
        'Keep your password private. Orders placed from your account are your responsibility.',
        'We may suspend an account used for fraud, abuse of offers or returns, or to harm other users.',
      ],
    },
    {
      id: 'orders',
      h: '3. Placing an order',
      list: [
        'Your order is accepted when we confirm it by email, SMS or in My orders.',
        'We may cancel an order — and refund anything you paid in full — if an item is out of stock, a price was clearly wrong, payment was not completed, or the order looks fraudulent.',
        'We may limit the quantity of an item per customer, especially on offers.',
      ],
    },
    {
      id: 'prices',
      h: '4. Prices and payment',
      list: [
        'All prices are in Qatari riyals (QAR). The total on the checkout page — items, delivery fee and any discount — is exactly what you pay.',
        'Card, Apple Pay and Google Pay are processed by a licensed payment provider. FastMoveX never sees or stores your full card number.',
        '**Cash on delivery:** pay the driver the amount shown, in cash, when each shipment arrives. If cash-on-delivery orders are refused at the door again and again, we may turn cash on delivery off for your account.',
      ],
    },
    {
      id: 'cancel',
      h: '5. Cancelling an order',
      list: [
        'You can cancel from **My account → Orders** until the seller starts preparing it. Paid orders are refunded in full.',
        'Once it is being prepared or is on its way, it can no longer be cancelled — receive it and return it under the [Returns, refunds and warranty policy](/help/returns).',
      ],
    },
    {
      id: 'delivery',
      h: '6. Delivery',
      list: [
        'We deliver across Qatar. Items from different stores may arrive in separate shipments; the delivery fee is shown before you pay.',
        'Our driver calls you before arriving. Give the driver the **4-digit delivery code** from your order — this proves the parcel reached you. Never share the code before you have the parcel.',
        'If we cannot reach you, we try again. If delivery still fails, the order is cancelled and anything you paid is refunded.',
        'Check your parcel when it arrives. Tell us within **48 hours** if anything is wrong, missing or damaged.',
      ],
    },
    {
      id: 'returns',
      h: '7. Returns, refunds and warranty',
      p: ['What you can return, how long you have, how faulty items are repaired or replaced, and how refunds are paid are all in the [Returns, refunds and warranty policy](/help/returns). It forms part of these terms.'],
    },
    {
      id: 'offers',
      h: '8. Offers and coupons',
      list: [
        'Each offer or coupon has its own conditions and end date, shown with it.',
        'Coupons cannot be exchanged for cash, and usually only one can be used per order.',
        'If an item bought with a discount is returned, the refund is the amount you actually paid.',
        'We may cancel discounts gained by misuse — for example many accounts for one person.',
      ],
    },
    {
      id: 'reviews',
      h: '9. Reviews and questions',
      list: [
        'Reviews must be honest and about your own experience with the product.',
        'No offensive language, advertising, links, or anyone’s personal details. We may remove reviews that break these rules.',
        'By posting a review you allow FastMoveX to show it on the website and apps.',
      ],
    },
    {
      id: 'use',
      h: '10. Fair use',
      p: ['Please do not:'],
      list: [
        'Use false details, someone else’s card or account, or place orders you do not intend to receive',
        'Return items that are not the ones you received, or that you have used or damaged',
        'Copy the website’s content or collect its data with bots or scripts',
        'Try to break into, overload or interfere with the website',
      ],
    },
    {
      id: 'liability',
      h: '11. Our responsibility',
      p: [
        'We work to keep product information, prices and stock correct and the website available, but mistakes and interruptions can happen; we will put them right as described in these terms.',
        'We are not responsible for losses that are not a foreseeable result of our failure. **Nothing in these terms limits your rights under Qatar’s Consumer Protection Law (Law No. 8 of 2008).**',
      ],
    },
    {
      id: 'law',
      h: '12. Law, changes and contact',
      list: [
        'These terms are governed by the laws of the State of Qatar, and the courts of Qatar decide any dispute.',
        'We may update these terms; the new date is shown at the top of this page. The terms in force when you placed an order apply to that order.',
        'Questions? Write to us from [Contact us](/contact) or open a ticket in [Help](/help).',
      ],
    },
  ],
};

export const termsAr: Policy = {
  title: 'شروط الاستخدام',
  intro: 'قواعد التسوق على فاست موف إكس: كيف تتم الطلبات والدفع والإلغاء والتوصيل، وما نلتزم به نحن وأنت. باستخدامك فاست موف إكس أو تقديم طلب، فإنك توافق على هذه الشروط.',
  updated: UPDATED,
  sections: [
    {
      id: 'about',
      h: '1. عن فاست موف إكس',
      p: [
        'فاست موف إكس سوق إلكتروني في قطر. تُباع المنتجات إما من فاست موف إكس أو من بائعين مستقلين في قطر، وتعرض كل صفحة منتج **«يبيعه»** لتعرف دائماً من هو البائع.',
        'أياً كان البائع، تستلم فاست موف إكس دفعتك وتوصل طلبك وتتولى الإرجاع والاسترداد والدعم — تعاملك معنا نحن.',
      ],
    },
    {
      id: 'account',
      h: '2. حسابك',
      list: [
        'يجب أن يكون عمرك 18 عاماً أو أكثر لفتح حساب، أو أن تتسوق بإذن ولي الأمر.',
        'أدخل اسمك الحقيقي ورقم جوالك وعنوانك وحافظ على تحديثها.',
        'حافظ على سرية كلمة المرور. أنت مسؤول عن الطلبات المقدمة من حسابك.',
        'قد نوقف الحساب الذي يُستخدم في الاحتيال أو إساءة استخدام العروض أو الإرجاع أو الإضرار بالمستخدمين الآخرين.',
      ],
    },
    {
      id: 'orders',
      h: '3. تقديم الطلب',
      list: [
        'يُقبل طلبك عندما نؤكده بالبريد الإلكتروني أو الرسائل النصية أو في «طلباتي».',
        'قد نلغي الطلب — ونسترد كل ما دفعته كاملاً — إذا نفد المنتج أو كان السعر خاطئاً بشكل واضح أو لم يكتمل الدفع أو بدا الطلب احتيالياً.',
        'قد نحدد كمية المنتج لكل عميل، خاصة في العروض.',
      ],
    },
    {
      id: 'prices',
      h: '4. الأسعار والدفع',
      list: [
        'جميع الأسعار بالريال القطري. الإجمالي في صفحة الدفع — المنتجات ورسوم التوصيل وأي خصم — هو بالضبط ما تدفعه.',
        'تتم مدفوعات البطاقة وApple Pay وGoogle Pay عبر مزود دفع مرخص. لا ترى فاست موف إكس رقم بطاقتك كاملاً ولا تحتفظ به.',
        '**الدفع عند الاستلام:** ادفع للسائق المبلغ المعروض نقداً عند وصول كل شحنة. إذا تكرر رفض طلبات الدفع عند الاستلام عند الباب، فقد نوقف هذه الخدمة لحسابك.',
      ],
    },
    {
      id: 'cancel',
      h: '5. إلغاء الطلب',
      list: [
        'يمكنك الإلغاء من **حسابي ← الطلبات** حتى يبدأ البائع في تجهيز الطلب. تُسترد الطلبات المدفوعة بالكامل.',
        'بعد بدء التجهيز أو خروج الطلب للتوصيل لا يمكن إلغاؤه — استلمه ثم أرجعه وفق [سياسة الإرجاع والاسترداد والضمان](/help/returns).',
      ],
    },
    {
      id: 'delivery',
      h: '6. التوصيل',
      list: [
        'نوصل في جميع أنحاء قطر. قد تصل منتجات المتاجر المختلفة في شحنات منفصلة، وتظهر رسوم التوصيل قبل الدفع.',
        'يتصل بك السائق قبل الوصول. أعطِ السائق **رمز التسليم المكوّن من 4 أرقام** الموجود في طلبك — فهو يثبت أن الطرد وصلك. لا تشارك الرمز قبل استلام الطرد.',
        'إذا لم نتمكن من الوصول إليك نحاول مرة أخرى. وإذا تعذّر التوصيل يُلغى الطلب ويُسترد ما دفعته.',
        'افحص طردك عند وصوله، وأبلغنا خلال **48 ساعة** إذا كان فيه خطأ أو نقص أو تلف.',
      ],
    },
    {
      id: 'returns',
      h: '7. الإرجاع والاسترداد والضمان',
      p: ['ما يمكنك إرجاعه، والمدة المتاحة، وكيف تُصلح المنتجات المعيبة أو تُستبدل، وكيف يُرد المبلغ — كل ذلك في [سياسة الإرجاع والاسترداد والضمان](/help/returns)، وهي جزء من هذه الشروط.'],
    },
    {
      id: 'offers',
      h: '8. العروض والقسائم',
      list: [
        'لكل عرض أو قسيمة شروطها وتاريخ انتهائها، وتظهر معها.',
        'لا يمكن استبدال القسائم بالنقد، وعادةً تُستخدم قسيمة واحدة فقط في الطلب.',
        'عند إرجاع منتج اشتريته بخصم، يُرد المبلغ الذي دفعته فعلاً.',
        'قد نلغي الخصومات التي تم الحصول عليها بإساءة الاستخدام — مثل عدة حسابات لشخص واحد.',
      ],
    },
    {
      id: 'reviews',
      h: '9. التقييمات والأسئلة',
      list: [
        'يجب أن تكون التقييمات صادقة وعن تجربتك الشخصية مع المنتج.',
        'يُمنع الكلام المسيء والإعلانات والروابط والبيانات الشخصية لأي شخص. قد نحذف التقييمات المخالفة.',
        'بنشر تقييمك فإنك تسمح لفاست موف إكس بعرضه على الموقع والتطبيقات.',
      ],
    },
    {
      id: 'use',
      h: '10. الاستخدام العادل',
      p: ['يُرجى عدم:'],
      list: [
        'استخدام بيانات غير صحيحة أو بطاقة أو حساب شخص آخر، أو تقديم طلبات لا تنوي استلامها',
        'إرجاع منتجات غير التي استلمتها، أو منتجات استخدمتها أو أتلفتها',
        'نسخ محتوى الموقع أو جمع بياناته بالبرامج الآلية',
        'محاولة اختراق الموقع أو إثقاله أو تعطيله',
      ],
    },
    {
      id: 'liability',
      h: '11. مسؤوليتنا',
      p: [
        'نعمل على أن تكون معلومات المنتجات والأسعار والمخزون صحيحة وأن يبقى الموقع متاحاً، لكن قد تحدث أخطاء أو انقطاعات، وسنصححها كما هو موضح في هذه الشروط.',
        'لسنا مسؤولين عن الخسائر التي لا تكون نتيجة متوقعة لتقصيرنا. **لا شيء في هذه الشروط يحدّ من حقوقك بموجب قانون حماية المستهلك القطري (القانون رقم 8 لسنة 2008).**',
      ],
    },
    {
      id: 'law',
      h: '12. القانون والتغييرات والتواصل',
      list: [
        'تخضع هذه الشروط لقوانين دولة قطر، وتختص محاكم قطر بالفصل في أي نزاع.',
        'قد نحدّث هذه الشروط، ويظهر التاريخ الجديد أعلى هذه الصفحة. تنطبق على كل طلب الشروطُ السارية وقت تقديمه.',
        'لديك سؤال؟ راسلنا من [تواصل معنا](/contact) أو افتح تذكرة في [المساعدة](/help).',
      ],
    },
  ],
};

export const privacyEn: Policy = {
  title: 'Privacy policy',
  intro: 'What personal data FastMoveX collects, why, who sees it, and the choices you have. We handle personal data in line with Qatar’s Personal Data Privacy Protection Law (Law No. 13 of 2016).',
  updated: UPDATED,
  sections: [
    {
      id: 'collect',
      h: '1. What we collect',
      table: {
        head: ['Data', 'Examples'],
        rows: [
          ['Account', 'Name, email, mobile number, password (stored encrypted), language'],
          ['Delivery', 'Addresses, map pin, delivery notes, chosen time slot'],
          ['Orders and payments', 'What you bought, totals, payment method, card type and last 4 digits only'],
          ['Delivery proof', 'Who received the parcel, an optional doorstep photo, and the driver’s location if a delivery fails'],
          ['Support', 'Your messages, tickets, return requests and the photos you send'],
          ['Reviews', 'Your ratings and reviews, shown with your first name'],
          ['Website use', 'Pages and products viewed and searches — counted anonymously, without your name'],
        ],
      },
    },
    {
      id: 'why',
      h: '2. Why we use it',
      list: [
        'To take your order, deliver it, and handle cancellations, returns, refunds and warranty repairs',
        'To send order and delivery updates by SMS, email or WhatsApp',
        'To keep your account safe and prevent fraud',
        'To improve the store — what people search for and which pages work',
        'To send offers and news — **only if you agreed**. You can turn them off at any time in your account',
        'To meet legal duties, such as keeping invoices and answering lawful requests from authorities',
      ],
    },
    {
      id: 'share',
      h: '3. Who sees your data',
      table: {
        head: ['Who', 'What they see', 'Why'],
        rows: [
          ['The seller of your item', 'Your name, phone number and delivery address — never your email or payment details', 'To pack and label your parcel'],
          ['Our delivery driver', 'Your name, phone, address, map pin, and the cash amount for cash on delivery', 'To deliver your parcel'],
          ['Payment provider', 'Your card payment details', 'To take the payment and refunds'],
          ['SMS, email and messaging services', 'Your phone number or email and the message', 'To send you updates'],
          ['Hosting and IT providers', 'Stored data, under contract', 'To run the website securely'],
          ['Authorities', 'Only what the law requires', 'When legally required'],
        ],
      },
      note: 'We never sell your personal data. Sellers must use it only for your order and may not contact you for marketing.',
    },
    {
      id: 'where',
      h: '4. Where it is stored and how it is protected',
      list: [
        'Your data is stored with secure cloud providers, some of whose servers are outside Qatar (including in the European Union), with the safeguards the law requires.',
        'Connections are encrypted (HTTPS), passwords are stored encrypted, and staff see only what their job needs.',
        'If a data breach could harm you, we will tell you and the authorities as the law requires.',
      ],
    },
    {
      id: 'keep',
      h: '5. How long we keep it',
      list: [
        'Your account: until you delete it.',
        'Orders, invoices and payments: as long as tax and commercial laws require, even after your account is deleted — with your name and contact details removed.',
        'Delivery photos, support messages and other data: deleted or made anonymous when no longer needed.',
      ],
    },
    {
      id: 'rights',
      h: '6. Your rights and choices',
      list: [
        '**See and download your data:** My account → Your data and privacy → Download my data.',
        '**Correct it:** edit your name, phone and addresses in My account at any time.',
        '**Delete your account:** My account → Your data and privacy → Delete my account. You have 14 days to change your mind; then your personal details are erased.',
        '**Stop marketing:** turn off “Offers and news” in My account, or use the unsubscribe link in any email.',
        '**Object or complain:** write to us from [Contact us](/contact). You may also complain to the competent data-protection authority in Qatar.',
      ],
    },
    {
      id: 'cookies',
      h: '7. Cookies and similar storage',
      p: [
        'We use only what the website needs to work: keeping you signed in, your cart, your language and security. Visit statistics are first-party and anonymous.',
        'We do not use third-party advertising cookies. If that ever changes, we will ask for your consent first.',
      ],
    },
    {
      id: 'children',
      h: '8. Children',
      p: ['FastMoveX is not meant for children under 18 to use on their own, and we do not knowingly collect their data. If you think a child has given us personal data, contact us and we will delete it.'],
    },
    {
      id: 'changes',
      h: '9. Changes and contact',
      p: ['We will post any change on this page with its new date, and tell you by email about important changes. Questions about your data? Write to us from [Contact us](/contact).'],
    },
  ],
};

export const privacyAr: Policy = {
  title: 'سياسة الخصوصية',
  intro: 'البيانات الشخصية التي تجمعها فاست موف إكس، ولماذا، ومن يطّلع عليها، والخيارات المتاحة لك. نتعامل مع البيانات الشخصية وفقاً لقانون حماية خصوصية البيانات الشخصية في قطر (القانون رقم 13 لسنة 2016).',
  updated: UPDATED,
  sections: [
    {
      id: 'collect',
      h: '1. ما الذي نجمعه',
      table: {
        head: ['البيانات', 'أمثلة'],
        rows: [
          ['الحساب', 'الاسم والبريد الإلكتروني ورقم الجوال وكلمة المرور (محفوظة مشفّرة) واللغة'],
          ['التوصيل', 'العناوين وموقع الخريطة وملاحظات التوصيل والموعد المختار'],
          ['الطلبات والمدفوعات', 'ما اشتريته والمبالغ وطريقة الدفع، ونوع البطاقة وآخر 4 أرقام فقط'],
          ['إثبات التسليم', 'من استلم الطرد، وصورة اختيارية عند الباب، وموقع السائق إذا تعذّر التوصيل'],
          ['الدعم', 'رسائلك وتذاكرك وطلبات الإرجاع والصور التي ترسلها'],
          ['التقييمات', 'تقييماتك ومراجعاتك، وتظهر مع اسمك الأول'],
          ['استخدام الموقع', 'الصفحات والمنتجات التي تشاهدها وعمليات البحث — تُحسب دون اسمك'],
        ],
      },
    },
    {
      id: 'why',
      h: '2. لماذا نستخدمها',
      list: [
        'لتنفيذ طلبك وتوصيله ومتابعة الإلغاء والإرجاع والاسترداد وإصلاحات الضمان',
        'لإرسال تحديثات الطلب والتوصيل عبر الرسائل النصية أو البريد أو واتساب',
        'لحماية حسابك ومنع الاحتيال',
        'لتحسين المتجر — ما يبحث عنه الناس وأي الصفحات تعمل جيداً',
        'لإرسال العروض والأخبار — **فقط إذا وافقت**، ويمكنك إيقافها في أي وقت من حسابك',
        'للوفاء بالالتزامات القانونية، مثل الاحتفاظ بالفواتير والرد على الطلبات النظامية من الجهات المختصة',
      ],
    },
    {
      id: 'share',
      h: '3. من يطّلع على بياناتك',
      table: {
        head: ['من', 'ما يراه', 'لماذا'],
        rows: [
          ['بائع المنتج', 'اسمك ورقم هاتفك وعنوان التوصيل — وليس بريدك الإلكتروني أو بيانات الدفع أبداً', 'لتغليف طردك ووضع الملصق عليه'],
          ['سائق التوصيل', 'اسمك وهاتفك وعنوانك وموقع الخريطة والمبلغ النقدي عند الدفع عند الاستلام', 'لتوصيل طردك'],
          ['مزود الدفع', 'بيانات الدفع بالبطاقة', 'لتحصيل الدفعة والمبالغ المستردة'],
          ['خدمات الرسائل والبريد', 'رقم هاتفك أو بريدك ونص الرسالة', 'لإرسال التحديثات إليك'],
          ['مزودو الاستضافة والتقنية', 'البيانات المحفوظة، بموجب عقد', 'لتشغيل الموقع بأمان'],
          ['الجهات المختصة', 'ما يفرضه القانون فقط', 'عندما يلزم القانون بذلك'],
        ],
      },
      note: 'لا نبيع بياناتك الشخصية أبداً. يجب على البائعين استخدامها لطلبك فقط، ولا يحق لهم التواصل معك لأغراض تسويقية.',
    },
    {
      id: 'where',
      h: '4. أين تُحفظ وكيف تُحمى',
      list: [
        'تُحفظ بياناتك لدى مزودي خدمات سحابية آمنين، وبعض خوادمهم خارج قطر (ومنها في الاتحاد الأوروبي)، مع الضمانات التي يفرضها القانون.',
        'الاتصالات مشفّرة (HTTPS)، وكلمات المرور محفوظة مشفّرة، ولا يطّلع الموظفون إلا على ما يحتاجه عملهم.',
        'إذا وقع اختراق قد يضرّك، نبلغك ونبلغ الجهات المختصة كما يفرض القانون.',
      ],
    },
    {
      id: 'keep',
      h: '5. مدة الاحتفاظ',
      list: [
        'حسابك: حتى تحذفه.',
        'الطلبات والفواتير والمدفوعات: المدة التي تفرضها قوانين الضرائب والتجارة، حتى بعد حذف حسابك — مع حذف اسمك وبيانات التواصل.',
        'صور التسليم ورسائل الدعم والبيانات الأخرى: تُحذف أو تُجعل مجهولة عندما لا نعود بحاجة إليها.',
      ],
    },
    {
      id: 'rights',
      h: '6. حقوقك وخياراتك',
      list: [
        '**عرض بياناتك وتنزيلها:** حسابي ← بياناتك وخصوصيتك ← تنزيل بياناتي.',
        '**تصحيحها:** عدّل اسمك وهاتفك وعناوينك من حسابي في أي وقت.',
        '**حذف حسابك:** حسابي ← بياناتك وخصوصيتك ← حذف حسابي. لديك 14 يوماً للتراجع، ثم تُمحى بياناتك الشخصية.',
        '**إيقاف التسويق:** أوقف «العروض والأخبار» من حسابي، أو استخدم رابط إلغاء الاشتراك في أي بريد.',
        '**الاعتراض أو الشكوى:** راسلنا من [تواصل معنا](/contact)، ويمكنك أيضاً تقديم شكوى إلى الجهة المختصة بحماية البيانات في قطر.',
      ],
    },
    {
      id: 'cookies',
      h: '7. ملفات تعريف الارتباط والتخزين المشابه',
      p: [
        'نستخدم فقط ما يحتاجه الموقع ليعمل: إبقاؤك مسجلاً للدخول، وسلة التسوق، واللغة، والأمان. إحصاءات الزيارات خاصة بنا ومجهولة.',
        'لا نستخدم ملفات تعريف ارتباط إعلانية من جهات خارجية، وإذا تغيّر ذلك سنطلب موافقتك أولاً.',
      ],
    },
    {
      id: 'children',
      h: '8. الأطفال',
      p: ['فاست موف إكس غير مخصص لاستخدام من هم دون 18 عاماً بمفردهم، ولا نجمع بياناتهم عن علم. إذا كنت تعتقد أن طفلاً أعطانا بيانات شخصية فتواصل معنا وسنحذفها.'],
    },
    {
      id: 'changes',
      h: '9. التغييرات والتواصل',
      p: ['ننشر أي تغيير في هذه الصفحة مع تاريخه الجديد، ونبلغك بالبريد الإلكتروني بالتغييرات المهمة. لديك سؤال عن بياناتك؟ راسلنا من [تواصل معنا](/contact).'],
    },
  ],
};
