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

export default i18n;
