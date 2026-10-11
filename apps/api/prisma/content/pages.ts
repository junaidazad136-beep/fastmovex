/**
 * Starting text for the content pages created by the base seed. Admins edit them in the admin panel
 * (Settings › Pages); the seed never overwrites a page that exists. Privacy and Terms are templates:
 * have them reviewed by a lawyer in Qatar before launch.
 */
export const DEFAULT_PAGES: { slug: string; title: string; titleAr: string; body: string; bodyAr: string; sortOrder: number }[] = [
  {
    slug: 'about',
    title: 'About FastMoveX',
    titleAr: 'عن فاست موف إكس',
    sortOrder: 0,
    body: `FastMoveX is an online store made in Doha for families across Qatar. We bring together everyday essentials, home and kitchen, beauty, electronics and gifts in one place — at fair prices, delivered to your door.

## What we promise
- **Genuine products** from trusted brands and suppliers
- **Fast delivery** across Qatar, with cash on delivery available
- **Easy returns** within the return window shown on each product
- **Real support** from a local team that answers in English and Arabic

## Get in touch
Questions, feedback or a business enquiry? Visit our [Contact page](/contact) — we reply within one working day.`,
    bodyAr: `فاست موف إكس متجر إلكتروني انطلق من الدوحة ليخدم العائلات في جميع أنحاء قطر. نجمع لك مستلزمات المنزل والمطبخ والجمال والإلكترونيات والهدايا في مكان واحد — بأسعار عادلة وتوصيل حتى باب بيتك.

## ما نعدك به
- **منتجات أصلية** من علامات تجارية وموردين موثوقين
- **توصيل سريع** في جميع أنحاء قطر مع خيار الدفع عند الاستلام
- **إرجاع سهل** خلال مدة الإرجاع الموضحة على كل منتج
- **دعم حقيقي** من فريق محلي يجيب بالعربية والإنجليزية

## تواصل معنا
لديك سؤال أو ملاحظة أو استفسار تجاري؟ زر [صفحة التواصل](/contact) — نرد خلال يوم عمل واحد.`,
  },
  {
    slug: 'privacy',
    title: 'Privacy policy',
    titleAr: 'سياسة الخصوصية',
    sortOrder: 10,
    body: `This policy explains what personal data FastMoveX collects, why, and the choices you have. We handle personal data in line with Qatar's personal data protection law (Law No. 13 of 2016).

## What we collect
- **Account and contact details:** name, email, mobile number
- **Delivery details:** addresses and delivery notes
- **Orders and payments:** what you bought and how you paid. Card details are handled by our payment provider; FastMoveX never stores your full card number
- **Use of the website:** pages viewed and searches, to improve the store and keep it secure

## Why we use it
- To take, deliver and support your orders, returns and refunds
- To send order updates by email, SMS or in the app
- To send offers — **only if you agreed**, and you can stop at any time from your account
- To prevent fraud and meet legal obligations

## Who we share it with
Only with the companies that help us serve you — delivery partners, the payment provider, and email and SMS services — and only what they need. We do not sell your personal data.

## How long we keep it
Order and payment records are kept as long as the law requires. Other data is deleted or anonymised when no longer needed.

## Your choices
You can see and update your details in your account, turn offers off, or ask us to delete your account through the [Contact page](/contact).

## Changes
We will post any change to this policy on this page with its new date.`,
    bodyAr: `توضح هذه السياسة البيانات الشخصية التي تجمعها فاست موف إكس وسبب جمعها والخيارات المتاحة لك. نتعامل مع البيانات الشخصية وفقاً لقانون حماية خصوصية البيانات الشخصية في قطر (القانون رقم 13 لسنة 2016).

## ما الذي نجمعه
- **بيانات الحساب والتواصل:** الاسم والبريد الإلكتروني ورقم الجوال
- **بيانات التوصيل:** العناوين وملاحظات التوصيل
- **الطلبات والمدفوعات:** ما اشتريته وطريقة الدفع. تتولى شركة الدفع بيانات البطاقة، ولا تحتفظ فاست موف إكس برقم بطاقتك كاملاً
- **استخدام الموقع:** الصفحات التي تزورها وعمليات البحث، لتحسين المتجر والحفاظ على أمانه

## لماذا نستخدمها
- لتنفيذ طلباتك وتوصيلها ومتابعة الإرجاع والاسترداد
- لإرسال تحديثات الطلب عبر البريد أو الرسائل النصية أو التطبيق
- لإرسال العروض — **فقط إذا وافقت**، ويمكنك إيقافها في أي وقت من حسابك
- لمنع الاحتيال والوفاء بالالتزامات القانونية

## مع من نشاركها
فقط مع الشركات التي تساعدنا في خدمتك — شركاء التوصيل وشركة الدفع وخدمات البريد والرسائل — وبالقدر الذي تحتاجه فقط. لا نبيع بياناتك الشخصية.

## مدة الاحتفاظ
نحتفظ بسجلات الطلبات والمدفوعات للمدة التي يفرضها القانون، ونحذف البيانات الأخرى أو نجعلها مجهولة عندما لا نعود بحاجة إليها.

## خياراتك
يمكنك عرض بياناتك وتعديلها من حسابك، وإيقاف العروض، أو طلب حذف حسابك عبر [صفحة التواصل](/contact).

## التغييرات
ننشر أي تغيير على هذه السياسة في هذه الصفحة مع تاريخه الجديد.`,
  },
  {
    slug: 'terms',
    title: 'Terms and conditions',
    titleAr: 'الشروط والأحكام',
    sortOrder: 20,
    body: `These terms apply when you use the FastMoveX website and apps and when you buy from FastMoveX. By placing an order you agree to them.

## Orders
- An order is accepted when we confirm it by email or in your account
- We may cancel an order if a product is out of stock, a price was clearly wrong, or payment was not completed; any payment is refunded in full

## Prices and payment
- Prices are in Qatari riyals (QAR). The total shown at checkout, including delivery, is what you pay
- You can pay by card, Apple Pay, Google Pay or cash on delivery where offered

## Delivery
- We deliver across Qatar to the address you give. Delivery fees and free-delivery amounts are shown before you pay
- Please check your order when it arrives and tell us within 48 hours if anything is missing or damaged

## Returns and refunds
- Most products can be returned within the return window shown on the product page, unused and in their original packaging
- Refunds go back to the original payment method; cash-on-delivery orders are refunded by bank transfer

## Your account
Keep your password private. You are responsible for orders placed from your account.

## Contact
Questions about these terms? Use our [Contact page](/contact).`,
    bodyAr: `تنطبق هذه الشروط عند استخدامك موقع فاست موف إكس وتطبيقاتها وعند الشراء من فاست موف إكس. بتقديم طلبك فإنك توافق عليها.

## الطلبات
- يُعتبر الطلب مقبولاً عندما نؤكده عبر البريد الإلكتروني أو في حسابك
- قد نلغي الطلب إذا نفد المنتج أو كان السعر خاطئاً بشكل واضح أو لم يكتمل الدفع، ونسترد أي مبلغ مدفوع بالكامل

## الأسعار والدفع
- الأسعار بالريال القطري. الإجمالي المعروض عند الدفع، شاملاً التوصيل، هو ما تدفعه
- يمكنك الدفع بالبطاقة أو Apple Pay أو Google Pay أو نقداً عند الاستلام حيثما يتوفر

## التوصيل
- نوصل إلى العنوان الذي تحدده في جميع أنحاء قطر، وتظهر رسوم التوصيل وحد التوصيل المجاني قبل الدفع
- يرجى فحص طلبك عند استلامه وإبلاغنا خلال 48 ساعة إذا كان هناك نقص أو تلف

## الإرجاع والاسترداد
- يمكن إرجاع معظم المنتجات خلال مدة الإرجاع الموضحة في صفحة المنتج، غير مستخدمة وفي عبوتها الأصلية
- يُسترد المبلغ إلى وسيلة الدفع الأصلية، وتُسترد طلبات الدفع عند الاستلام بتحويل بنكي

## حسابك
حافظ على سرية كلمة المرور. أنت مسؤول عن الطلبات المقدمة من حسابك.

## التواصل
لديك سؤال عن هذه الشروط؟ استخدم [صفحة التواصل](/contact).`,
  },
];
