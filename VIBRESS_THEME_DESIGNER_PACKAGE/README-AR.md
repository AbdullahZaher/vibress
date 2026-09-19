# حزمة مصممي ومطوري ثيمات Vibress (Theme Designer Package)

مرحبًا بك في الحزمة التوثيقية والعملية الرسمية لتطوير قوالب ومظاهر (Themes) منصة **Vibress**.

هذه الحزمة مخصصة لمهندسي الواجهات الأمامية (Frontend Developers) ومصممي تجربة وواجهة المستخدم (UI/UX Designers) لبناء ثيمات احترافية متكاملة تعمل مباشرة على منصة Vibress دون الحاجة لكتابة كود Backend، ودون تعديل كود المنصة الأساسي، ودون الحاجة لأي عملية Rebuild أو Restart.

---

## 🎯 فلسفة نظام الثيمات في Vibress

* **فصل كامل للمسؤوليات**: الثيم مسؤول فقط عن طبقة العرض والتقديم (HTML/CSS/Liquid). منصة Vibress تتولى إدارة قواعد البيانات، النشر، الأعضاء، الاشتراكات، والتوجيه.
* **محرك LiquidJS الآمن**: تعتمد القوالب على محرك Liquid القياسي مع مرشحات (Filters) ووسوم (Tags) مخصصة ونماذج عرض (View Models) واضحة.
* **أمان مطلق (Strict No-JS في حزمة الثيم)**: لا يُسمح بملفات JavaScript أو برمجيات خبيثة داخل حزمة الثيم لضمان أقصى درجات الأمان والعزل. التنسيق يتم عبر CSS الحديث والأصول الثابتة.
* **تثبيت فوري بدون Rebuild**: يرفع الثيم كملف `.zip` من لوحة الإدارة (`Settings -> Themes`)، ويتم فحصه آليًا، ومعاينته برابط مؤقت معزول، وتفعيله فورًا.

---

## 📁 محتويات الحزمة

1. **`00-START-HERE.md`**: دليلك الأول للبدء وفهم تدفق العمل خطوة بخطوة.
2. **`01-VIBRESS-THEME-OVERVIEW.md`**: المعمارية العامة ومسار تحويل البيانات إلى HTML.
3. **`02-THEME-PACKAGE-SPECIFICATION.md`**: هيكل ملف ZIP والملفات الإلزامية والاختيارية.
4. **`03-THEME-API-V1.md`**: إمكانيات وحدود الإصدار الأول من Theme API.
5. **`04-LIQUID-TEMPLATING-GUIDE.md`**: دليل كتابة قوالب Liquid وتراكيب التحكم والتكرار.
6. **`05-VIEW-MODELS-REFERENCE.md`**: مرجع كامل لجميع الكائنات المتاحة (`site`, `post`, `page`, `author`, `tag`, `pagination`).
7. **`06-ROUTES-AND-HELPERS.md`**: دوال التوجيه وروابط المقالات والأصول.
8. **`07-THEME-SETTINGS-GUIDE.md`**: كيفية بناء خيارات تخصيص في `settings.json` لمدير الموقع.
9. **`07B-COMMENTS-AND-COMMUNITY-GUIDE.md`**: الدليل الشامل لدمج التعليقات، وسم `{% comments %}`، عداد التعليقات `post.comment_count`، وهيكلية RTL.
10. **`08-ASSETS-AND-STYLING.md`**: التعامل مع ملفات CSS، الخطوط، والصور.
11. **`09-SECURITY-RULES.md`**: القواعد الأمنية الصارمة وأنواع الملفات المحظورة.
12. **`10-RESPONSIVE-RTL-ACCESSIBILITY.md`**: معايير دعم الهواتف، الاتجاه العربي (RTL)، وسهولة الوصول (a11y).
13. **`11-THEME-TESTING-GUIDE.md`**: كيفية اختبار الثيم محليًا والتحقق من سلامته.
14. **`12-PACKAGING-AND-DELIVERY.md`**: تعليمات ضغط الثيم وتسليمه كملف ZIP نهائي جاهز للنشر.
15. **`13-DESIGN-BRIEF-TEMPLATE.md`**: نموذج وثيقة متطلبات التصميم.
16. **`14-DELIVERY-CHECKLIST.md`**: قائمة التدقيق قبل التسليم.
17. **`15-EXAMPLE-NEWS-BRIEF.md` / `16-EXAMPLE-BLOG-BRIEF.md` / `17-EXAMPLE-LANDING-PAGE-BRIEF.md`**: نماذج وتطبيقات عملية لثيمات إخبارية، مدونات، وصفحات هبوط.
18. **`starter-theme/`**: القالب النموذجي المصدري المفتوح لبدء العمل منه مباشرة.
19. **`examples/`**: أمثلة حية لـ `theme.json` و `settings.json` ومقتطفات Liquid.
20. **`scripts/validate-theme.mjs`**: أداة فحص آلية للتحقق من مطابقة الثيم لمواصفات Vibress.
21. **`vibress-theme-starter.zip`**: حزمة الثيم المرجعي مضغوطة وجاهزة للرفع الفوري للتجربة.

---

## 💬 نظام التعليقات والمجتمع (Comments & Discussion)

تدعم منصة Vibress نظام تعليقات تفاعلي متكامل للأعضاء والقراء:
* **وسم Liquid الرسمي**: يتم تضمين قسم التعليقات داخل `post.liquid` باستخدام `{% comments %}`.
* **عداد التعليقات التجميعي**: يوفر نموذج العرض `post.comment_count` و `post.commentCount` العدد الإجمالي للتعليقات المنشورة دون استعلامات إضافية (Zero N+1 Queries).
* **دعم كامل للغة العربية والاتجاه RTL**: استخدام خصائص CSS المنطقية (`margin-inline`, `padding-inline`, `border-inline-start`) لضمان محاذاة وتداخل الردود بصورة طبيعية باللغتين العربية والإنجليزية.
* **نماذج البيانات المعتمدة**: كائنات `CommentViewModel` و `SiteCommentsConfig`.
* راجع الدليل الكامل: **[`07B-COMMENTS-AND-COMMUNITY-GUIDE.md`](./07B-COMMENTS-AND-COMMUNITY-GUIDE.md)**.

---

## 🚀 كيف تبدأ؟
ابدأ بقراءة ملف **[`00-START-HERE.md`](./00-START-HERE.md)** واستخدم مجلد **`starter-theme/`** كنقطة انطلاق لثيمك الجديد.
