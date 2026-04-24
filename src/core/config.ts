export class Config {
    static readonly ENV = process.env.NODE_ENV || 'development';
    static readonly PORT = process.env.PORT || 3000;
    static readonly SUPABASE_URL = process.env.SUPABASE_URL || '';
    static readonly SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || '';
    static readonly SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    static readonly RESEND_API_KEY = process.env.RESEND_API_KEY || '';
    static readonly RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'Condominio <onboarding@resend.dev>';
    static readonly APP_WEB_URL = process.env.APP_WEB_URL || 'https://app.nibs-tech.com';
    static readonly INVITATION_EXPIRES_DAYS = Number(process.env.INVITATION_EXPIRES_DAYS || 7);
    static readonly DEFAULT_MAX_RESIDENTS_PER_UNIT = Number(process.env.DEFAULT_MAX_RESIDENTS_PER_UNIT || 2);
}
