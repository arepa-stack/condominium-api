export class Config {
    static readonly ENV = process.env.NODE_ENV || 'development';
    static readonly PORT = process.env.PORT || 3000;
    static readonly SUPABASE_URL = process.env.SUPABASE_URL || '';
    static readonly SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || '';
    static readonly SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    static readonly RESEND_API_KEY = process.env.RESEND_API_KEY || '';
    static readonly RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'Condominio <onboarding@resend.dev>';
    static readonly APP_WEB_URL = process.env.APP_WEB_URL || 'https://app.nibs-tech.com';
    // Backend's own public origin — base for the /open-app deep-link redirect used in emails.
    static readonly DEEPLINK_BASE_URL = process.env.DEEPLINK_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    static readonly ANDROID_PACKAGE = process.env.ANDROID_PACKAGE || 'com.nibs.aptocondominios';
    static readonly ANDROID_SCHEME = process.env.ANDROID_SCHEME || 'apto';
    // Internal-test link for now; swap for the public listing once published.
    static readonly PLAY_STORE_URL = process.env.PLAY_STORE_URL || 'https://play.google.com/apps/internaltest/4701736783461143945';
    // Venezuelan exchange rates (dolarapi.com). No API key required.
    static readonly DOLARAPI_BASE_URL = process.env.DOLARAPI_BASE_URL || 'https://ve.dolarapi.com';
    static readonly EXCHANGE_RATE_TTL_SECONDS = Number(process.env.EXCHANGE_RATE_TTL_SECONDS || 3600);
    static readonly INVITATION_EXPIRES_DAYS = Number(process.env.INVITATION_EXPIRES_DAYS || 7);
    static readonly DEFAULT_MAX_RESIDENTS_PER_UNIT = Number(process.env.DEFAULT_MAX_RESIDENTS_PER_UNIT || 2);
}
