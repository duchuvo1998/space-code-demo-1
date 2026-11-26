const STORAGE_KEY = "canva-gemini-course:v1:locale";
const SUPPORTED_LOCALES = new Set(["en", "vi"]);

let locale = "vi";
let messages = {};
let localeRequest = 0;

async function loadMessages(nextLocale) {
  const module = nextLocale === "en"
    ? await import("./locales/en.mjs")
    : await import("./locales/vi.mjs");
  return module.default;
}

function interpolate(message, values) {
  return message.replace(/\{(\w+)\}/g, (match, key) =>
    Object.hasOwn(values, key) ? String(values[key]) : match
  );
}

export function translate(key, values = {}) {
  return interpolate(messages[key] || key, values);
}

export function getLocale() {
  return locale;
}

export function applyTranslations(root = document) {
  root.querySelectorAll("[data-i18n]").forEach(element => {
    element.textContent = translate(element.dataset.i18n);
  });
  root.querySelectorAll("[data-i18n-placeholder], [data-i18n-title], [data-i18n-aria-label]").forEach(element => {
    for (const attribute of ["placeholder", "title", "aria-label"]) {
      const key = element.dataset[`i18n${attribute[0].toUpperCase()}${attribute.slice(1).replace("-", "")}`];
      if (key) element.setAttribute(attribute, translate(key));
    }
  });
  document.documentElement.lang = locale;
  root.querySelectorAll("[data-locale]").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.locale === locale));
  });
}

export async function setLocale(nextLocale) {
  if (!SUPPORTED_LOCALES.has(nextLocale)) return false;
  const request = ++localeRequest;
  const nextMessages = await loadMessages(nextLocale);
  if (request !== localeRequest) return false;
  locale = nextLocale;
  messages = nextMessages;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, locale);
  } catch {
    // Keep the selected language for this session if browser storage is unavailable.
  }
  if (typeof document !== "undefined") applyTranslations();
  return true;
}

export async function initializeLocale() {
  try {
    const savedLocale = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (SUPPORTED_LOCALES.has(savedLocale)) locale = savedLocale;
  } catch {
    locale = "vi";
  }
  messages = await loadMessages(locale);
  if (typeof document !== "undefined") applyTranslations();
  return locale;
}
