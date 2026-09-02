import { createI18n } from "vue-i18n";
import en from "./locales/en";
import zhCN from "./locales/zh-CN";

export type UiLocale = "zh-CN" | "en";

const savedLocale = localStorage.getItem("ui_locale");
const locale: UiLocale =
  savedLocale === "zh-CN" || savedLocale === "en" ? savedLocale : "zh-CN";

export const i18n = createI18n({
  legacy: false,
  locale,
  fallbackLocale: "zh-CN",
  messages: {
    "zh-CN": zhCN,
    en,
  },
});
