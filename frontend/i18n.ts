import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import zhTranslation from './locales/zh.json';
import enTranslation from './locales/en.json';

// Get saved language from localStorage or default to Chinese
const savedLanguage = localStorage.getItem('app_language') || 'zh';

i18n
    .use(initReactI18next)
    .init({
        resources: {
            en: {
                translation: enTranslation
            },
            zh: {
                translation: zhTranslation
            }
        },
        lng: savedLanguage,
        fallbackLng: 'zh',
        interpolation: {
            escapeValue: false // React already escapes values to prevent XSS
        }
    });

// Save to localStorage when language changes
i18n.on('languageChanged', (lng) => {
    localStorage.setItem('app_language', lng);
});

/**
 * 把后端返回的错误码(如 'AUTH_CAPTCHA_WRONG')映射成本地化文案。
 * 后端用 errorResponse('AUTH_XXX') 把机器码当 message 下发,前端在展示前必须翻译,
 * 否则用户会看到英文错误码。无对应翻译时回退原文(避免显示空白)。
 */
export const translateBackendError = (msg?: string | null): string => {
    if (!msg) return '';
    const key = `backend_errors.${msg}`;
    const translated = i18n.t(key);
    return translated === key ? msg : translated;
};

export default i18n;
