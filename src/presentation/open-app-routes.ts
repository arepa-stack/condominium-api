import { Elysia } from 'elysia';
import { Config } from '@/core/config';

// Smart deep-link redirect used by transactional emails (e.g. resident approved).
// Android  -> intent:// that opens the APK if installed, else Play Store (native
//             browser_fallback_url — no JS timers needed).
// iOS      -> "coming soon" page (no iOS build yet).
// Desktop  -> web app.
// ponytail: server-side User-Agent sniff. Good enough for an email link; no need
// for a device-detection lib.

const APP_NAME = 'Apto';

// intent:// with a Play Store fallback baked in. Opening it navigates to the app
// when installed, or to browser_fallback_url otherwise.
const intentUrl = () => {
    const fallback = encodeURIComponent(Config.PLAY_STORE_URL);
    return `intent://login#Intent;scheme=${Config.ANDROID_SCHEME};package=${Config.ANDROID_PACKAGE};S.browser_fallback_url=${fallback};end`;
};

const androidPage = () => {
    const intent = intentUrl();
    return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Abriendo ${APP_NAME}…</title>
<style>
  :root{color-scheme:light dark}
  body{font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:48px 24px;text-align:center;line-height:1.55}
  a.btn{display:inline-block;margin-top:20px;padding:12px 24px;font-weight:600;border-radius:8px;background:#16a34a;color:#fff;text-decoration:none}
</style>
<script>window.location.href=${JSON.stringify(intent)};</script>
</head><body>
<h1>Abriendo ${APP_NAME}…</h1>
<p>Si la app no se abre automáticamente, toca el botón.</p>
<a class="btn" href="${intent}">Abrir ${APP_NAME}</a>
</body></html>`;
};

const iosPage = () => `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${APP_NAME} para iOS — próximamente</title>
<style>
  :root{color-scheme:light dark}
  body{font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:48px 24px;text-align:center;line-height:1.55}
</style>
</head><body>
<h1>Próximamente en iOS 🍏</h1>
<p>La app <strong>${APP_NAME}</strong> aún no está disponible para iPhone. Estamos trabajando en ello.</p>
<p>Mientras tanto puedes acceder desde un dispositivo Android o desde la web.</p>
</body></html>`;

export const openAppRoutes = new Elysia()
    .get('/open-app', ({ request, set }) => {
        const ua = request.headers.get('user-agent') || '';
        if (/android/i.test(ua)) {
            set.headers['content-type'] = 'text/html; charset=utf-8';
            return androidPage();
        }
        if (/iphone|ipad|ipod/i.test(ua)) {
            set.headers['content-type'] = 'text/html; charset=utf-8';
            return iosPage();
        }
        // Desktop / everything else -> web app.
        set.redirect = Config.APP_WEB_URL;
        return;
    }, {
        detail: {
            tags: ['Onboarding - Public'],
            summary: 'Deep-link redirect: opens the APK (or Play Store), iOS coming-soon, or web',
        },
    });
