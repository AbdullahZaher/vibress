# Vibress Plugin Localization Guide

This guide describes how to build, translate, and package Vibress plugins with full multilingual and RTL support.

---

> **Policy update (accepted; implementation pending):** [Publication Language Policy](../14-decisions/publication-language-policy.md) supersedes all example fallbacks that presume `en` or `ar` is always enabled. A plugin must receive the **host-validated publication locale context** through a documented contract, rather than selecting a language from an untrusted header or accessing publication tables. Locale-context API rollout is tracked in [T1/T5](LOCALIZATION_POLICY_IMPLEMENTATION_PLAN.md).

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

// Receive these values from the host's verified publication context.
// This helper is independent of the host's future context API shape.
function translateWidget(activeLocale: string, primaryLocale: string) {
  const translator = createTranslator({
    locale: activeLocale,
    fallbackLocale: primaryLocale,
  });
  translator.mergeDictionary("en", pluginEn);
  translator.mergeDictionary("ar-SA", pluginAr);
  return translator.t("myplugin.views", { count: 1500 });
}

console.log(translateWidget("ar-SA", "ar-SA"));
// Example Arabic output: "إجمالي المشاهدات: 1500"
```

---

## 3. Accessing Request Locale in API Endpoints

Use the **resolved, publication-scoped locale** provided by the host's documented plugin context contract. Raw `x-vibress-locale` and `x-vibress-direction` headers from a caller are not authorization and must not become a substitute for the publication's enabled-locale check. Until that host contract is implemented, the following is a **pure formatting example**, not a runnable Fastify integration:

```ts
function formatPluginLocale(context: {
  locale: string; // host-resolved and validated against enabled locales
}) {
  return {
    locale: context.locale,
    direction: getDirection(context.locale),
    isRtl: isRtl(context.locale),
  };
}
```

For a single-language publication, plugins must not introduce extra-language controls or English UI fallbacks. UI dictionaries must cover each advertised supported language.

---

## 4. Building RTL-Ready UI in Studio & Admin

When providing custom UI components in Admin or Studio:
1. Always use logical CSS properties (`margin-inline-start`, `padding-inline-end`, `inset-inline-start`).
2. Wrap directional icons (e.g. arrows, chevrons) in RTL-transform rules.
3. Test mixed Bidi strings (Arabic sentences containing English words, URLs, numbers).
