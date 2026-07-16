import { Elysia, t } from 'elysia';
import { emailService } from '@/infrastructure/email';
import { logger } from '@/core/logger';

// Public account-deletion request page, required by Google Play Data Safety.
// GET renders a form; POST emails the request to the admin inbox.
// ponytail: no DB record, just an email to the admin. Add a table if volume
// ever needs tracking/auditing.
const ADMIN_INBOX = 'adminnibstech@gmail.com';
const APP_NAME = 'Apto';
const DEVELOPER_NAME = 'NIBS Tech';

const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const page = (bodyInner: string) => `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Eliminar cuenta - ${APP_NAME}</title>
<style>
  :root{color-scheme:light dark}
  body{font-family:system-ui,sans-serif;max-width:640px;margin:0 auto;padding:24px;line-height:1.55}
  h1{font-size:1.5rem} label{display:block;margin:16px 0 4px;font-weight:600}
  input,textarea{width:100%;padding:10px;font-size:1rem;border:1px solid #999;border-radius:8px;box-sizing:border-box}
  button{margin-top:20px;padding:12px 20px;font-size:1rem;font-weight:600;border:0;border-radius:8px;background:#2563eb;color:#fff;cursor:pointer}
  ul{padding-left:20px} .note{background:rgba(127,127,127,.12);padding:12px 16px;border-radius:8px}
</style></head><body>${bodyInner}</body></html>`;

const formBody = `
<h1>Eliminar tu cuenta</h1>
<p>App <strong>${APP_NAME}</strong>, desarrollada por <strong>${DEVELOPER_NAME}</strong>.</p>
<p>Puedes eliminar tu cuenta directamente desde la app, sin necesidad de escribirnos.</p>
<h2>Pasos para eliminar tu cuenta</h2>
<ol>
  <li>Abre la app <strong>${APP_NAME}</strong> e inicia sesión.</li>
  <li>Ve a <strong>Perfil</strong>.</li>
  <li>Toca <strong>Eliminar cuenta</strong>.</li>
  <li>Indica el motivo (opcional) y confirma.</li>
</ol>
<p>Tu cuenta se desactiva de inmediato y no podrás volver a iniciar sesión.</p>
<h2>Datos que se eliminan</h2>
<ul>
  <li>Nombre, correo electrónico y número de teléfono.</li>
  <li>Credenciales de acceso (no podrás volver a iniciar sesión).</li>
</ul>
<h2>Datos que se conservan</h2>
<p class="note">Los registros contables/financieros (pagos y comprobantes) se conservan
hasta 5 años por obligaciones legales y fiscales, y luego se eliminan.</p>
<h2>¿Perdiste el acceso a la app?</h2>
<p>Si no puedes iniciar sesión, envíanos tu solicitud con el correo de tu cuenta y la
procesaremos manualmente en un plazo de hasta 30 días.</p>
<form method="POST" action="/account-deletion">
  <label for="email">Correo de tu cuenta *</label>
  <input id="email" name="email" type="email" required placeholder="tu@correo.com">
  <label for="reason">Motivo (opcional)</label>
  <textarea id="reason" name="reason" rows="3"></textarea>
  <button type="submit">Enviar solicitud</button>
</form>`;

export const accountDeletionRoutes = new Elysia()
    .get('/account-deletion', ({ set }) => {
        set.headers['content-type'] = 'text/html; charset=utf-8';
        return page(formBody);
    }, { detail: { tags: ['Account Deletion'], summary: 'Account deletion request page' } })
    .post('/account-deletion', async ({ body, set }) => {
        set.headers['content-type'] = 'text/html; charset=utf-8';
        const email = String(body.email || '').trim();
        const reason = String(body.reason || '').trim();

        try {
            await emailService.send({
                to: ADMIN_INBOX,
                subject: `Solicitud de eliminación de cuenta: ${email}`,
                html: `<p>Nueva solicitud de eliminación de cuenta.</p>
                       <p><strong>Correo:</strong> ${esc(email)}</p>
                       <p><strong>Motivo:</strong> ${esc(reason) || '(no indicado)'}</p>`,
                text: `Solicitud de eliminación de cuenta\nCorreo: ${email}\nMotivo: ${reason || '(no indicado)'}`,
            });
        } catch (err) {
            logger.error({ err }, 'account-deletion email failed');
            set.status = 500;
            return page(`<h1>Error</h1><p>No se pudo enviar la solicitud. Escríbenos a
                <a href="mailto:${ADMIN_INBOX}">${ADMIN_INBOX}</a>.</p>`);
        }

        return page(`<h1>Solicitud recibida</h1>
            <p>Recibimos tu solicitud para <strong>${esc(email)}</strong>.
            El equipo de ${DEVELOPER_NAME} procesará la eliminación en un plazo de hasta 30 días.</p>`);
    }, {
        body: t.Object({ email: t.String(), reason: t.Optional(t.String()) }),
        detail: { tags: ['Account Deletion'], summary: 'Submit account deletion request' },
    });
