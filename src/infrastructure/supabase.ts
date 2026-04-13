import { createClient } from '@supabase/supabase-js';
import { Config } from '../core/config';

const url = Config.SUPABASE_URL || 'http://localhost:54321';
const key = Config.SUPABASE_KEY || 'test-anon-key';

export const supabase = createClient(url, key, {
    auth: {
        persistSession: false
    }
});

// Boot-time check: supabaseAdmin MUST be the service role client. The
// backend writes to RLS-protected tables (payments, invoices, credit
// ledger) and those writes rely on service_role bypassing RLS. If the
// service key is missing, the previous code silently fell back to the
// anon client — which produced confusing runtime failures like
// "credit ledger entry never persists" because RLS denied the INSERT
// without surfacing a clear error to the use case. Fail loud instead.
if (!Config.SUPABASE_SERVICE_KEY) {
    const msg =
        '[supabase] SUPABASE_SERVICE_ROLE_KEY is not set. ' +
        'The backend cannot write to RLS-protected tables without it. ' +
        'Set it in .env and restart. Previous fallback behavior (anon client) ' +
        'silently broke credit ledger inserts in production — no more fallback.';
    if (Config.ENV === 'test') {
        // In the test environment we still want tests to run even without a
        // real Supabase instance. Log the warning but do not throw.
        console.warn(msg);
    } else {
        throw new Error(msg);
    }
}

export const supabaseAdmin = Config.SUPABASE_SERVICE_KEY
    ? createClient(url, Config.SUPABASE_SERVICE_KEY, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false
        }
    })
    : supabase;

console.log(
    '[supabase] supabaseAdmin client:',
    Config.SUPABASE_SERVICE_KEY ? 'service_role' : 'anon (fallback — RLS writes will fail!)'
);
