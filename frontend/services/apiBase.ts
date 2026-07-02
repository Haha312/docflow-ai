const configuredApiUrl = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

if (import.meta.env.PROD && !configuredApiUrl) {
    throw new Error('VITE_API_URL is required for production builds');
}

const devApiUrl = import.meta.env.DEV ? ['http://localhost', '3001'].join(':') : '';

export const API_BASE_URL = configuredApiUrl || devApiUrl;
