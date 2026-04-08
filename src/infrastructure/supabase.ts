import { createClient } from '@supabase/supabase-js';
import { Config } from '../core/config';

const url = Config.SUPABASE_URL || 'http://localhost:54321';
const key = Config.SUPABASE_KEY || 'test-anon-key';

export const supabase = createClient(url, key, {
    auth: {
        persistSession: false
    }
});

export const supabaseAdmin = Config.SUPABASE_SERVICE_KEY
    ? createClient(url, Config.SUPABASE_SERVICE_KEY, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false
        }
    })
    : supabase; // Fallback to anon client if no service key (will fail for RLS, but safe)
