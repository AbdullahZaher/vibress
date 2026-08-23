# Vibress Plugin Localization Guide

This guide describes how to build, translate, and package Vibress plugins with full multilingual and RTL support.

---

## 1. Using the `@vibress/i18n` SDK

Plugins can import formatting and localization utilities directly from `@vibress/i18n`:

```ts
import {
  createTranslator,
  formatDate,
  formatNumber,
  formatCurrency,
  formatRelativeTime,
  getDirection,
  isRtl,
} from "@vibress/i18n";
```

---

## 2. Defining Plugin Translation Dictionaries

Plugins must namespace their message keys under their unique plugin ID to prevent collisions with core or other plugins:

```ts
const pluginEn = {
  "myplugin.title": "Analytics Dashboard",
  "myplugin.views": "Total Views: {count}",
  "myplugin.actions.export": "Export CSV",
};

const pluginAr = {
  "myplugin.title": "لوحة تحليلات البيانات",
  "myplugin.views": "إجمالي المشاهدات: {count}",
  "myplugin.actions.export": "تصدير ملف CSV",
};

const translator = createTranslator({
  locale: "ar-SA",
  fallbackLocale: "en",
});

translator.mergeDictionary("en", pluginEn);
translator.mergeDictionary("ar-SA", pluginAr);

console.log(translator.t("myplugin.views", { count: 1500 }));
// Output: "إجمالي المشاهدات: 1500"
```

---

## 3. Accessing Request Locale in API Endpoints

In Fastify backend routes or event hooks, extract the resolved request locale and direction from request headers:

```ts
fastify.get("/api/plugins/my-plugin/data", async (req, reply) => {
  const locale = (req.headers["x-vibress-locale"] as string) || "en-US";
  const direction = (req.headers["x-vibress-direction"] as string) || getDirection(locale);

  return reply.send({
    locale,
    direction,
    isRtl: isRtl(locale),
  });
});
```

---

## 4. Building RTL-Ready UI in Studio & Admin

When providing custom UI components in Admin or Studio:
1. Always use logical CSS properties (`margin-inline-start`, `padding-inline-end`, `inset-inline-start`).
2. Wrap directional icons (e.g. arrows, chevrons) in RTL-transform rules.
3. Test mixed Bidi strings (Arabic sentences containing English words, URLs, numbers).
