// AWS SES sender (SMTP transport via nodemailer).
//
// SES SMTP credentials are NOT the same as IAM access keys: they are generated
// in the SES console (SMTP settings → Create SMTP credentials). The IAM user
// behind them should only have `ses:SendRawEmail` on the verified From identity
// (least privilege).
//
// Security notes:
// - Plain credentials live in .env (chmod 600). Rotate via SES console.
// - Connection is TLS-only (implicit on 465, STARTTLS-required on 587).
// - We never log the OTP code, the recipient email in clear text, or the
//   SMTP password. Callers must pass an already validated 6-digit code.
// - sendOtpEmail returns { ok, ... } and never throws SMTP details to the
//   route handler — that prevents leaking provider errors to clients.

import nodemailer from "nodemailer";

const HTML_ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

let cachedTransport = null;
let cachedTransportKey = null;

function readSmtpConfig() {
  const host = (process.env.SES_SMTP_HOST || "").trim();
  const portRaw = (process.env.SES_SMTP_PORT || "465").trim();
  const port = Number.parseInt(portRaw, 10);
  const user = (process.env.SES_SMTP_USER || "").trim();
  const pass = (process.env.SES_SMTP_PASSWORD || "").trim();

  const missing = [
    !host && "SES_SMTP_HOST",
    !user && "SES_SMTP_USER",
    !pass && "SES_SMTP_PASSWORD",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`SES SMTP is not configured (missing: ${missing.join(", ")})`);
  }
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`SES_SMTP_PORT is invalid: ${portRaw}`);
  }
  return { host, port, user, pass };
}

function readSenderConfig() {
  const name = (process.env.MAIL_FROM_NAME || "220v").trim();
  const email = (process.env.MAIL_FROM_EMAIL || "").trim();
  if (!email) {
    throw new Error("MAIL_FROM_EMAIL is not configured");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("MAIL_FROM_EMAIL is not a valid email address");
  }
  return { name, email };
}

function buildTransport() {
  const cfg = readSmtpConfig();
  const key = `${cfg.host}|${cfg.port}|${cfg.user}`;
  if (cachedTransport && cachedTransportKey === key) {
    return cachedTransport;
  }
  const secure = cfg.port === 465;
  cachedTransport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure,
    requireTLS: !secure,
    auth: { user: cfg.user, pass: cfg.pass },
    pool: true,
    maxConnections: 3,
    maxMessages: 50,
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 15_000,
    tls: { minVersion: "TLSv1.2" },
  });
  cachedTransportKey = key;
  return cachedTransport;
}

function buildOtpMessage(code) {
  const safeCode = escapeHtml(code);
  const subject = `Ваш код для входа в 220v — ${code}`;
  const text = [
    "Здравствуйте!",
    "",
    `Ваш код для входа в 220v: ${code}`,
    "",
    "Код действителен 10 минут. Никому его не сообщайте — сотрудники 220v никогда не запрашивают код.",
    "Если вы не запрашивали вход, просто проигнорируйте это письмо.",
    "",
    "— Команда 220v",
  ].join("\n");

  // Палитра подобрана под главную страницу (src/index.css / src/pages/Index.tsx):
  // - фон  hsl(40 30% 95%)  ≈ #f6f3ee  (warm cream, bg-background)
  // - card hsl(40 40% 99%)  ≈ #fefdfa  (bg-card)
  // - muted hsl(38 30% 92%) ≈ #f1ece4  (bg-muted — внутренняя «кремовая» панель)
  // - text foreground  hsl(30 20% 20%) ≈ #3d3329
  // - text muted-fg    hsl(30 15% 45%) ≈ #847362
  // - border hsl(35 25% 85%) ≈ #e2dacf
  // - primary hsl(36 80% 50%) ≈ #e6941a (оранжево-янтарный CTA)
  const html = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light only" />
    <meta name="supported-color-schemes" content="light" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f6f3ee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#3d3329;">
    <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;font-size:1px;line-height:1px;mso-hide:all;">
      Ваш код для входа в 220v — действителен 10 минут.
    </span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6f3ee;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fefdfa;border:1px solid #e2dacf;border-radius:18px;box-shadow:0 10px 30px rgba(61,51,41,0.08);overflow:hidden;">
            <tr>
              <td style="padding:32px 32px 8px 32px;text-align:center;">
                <div style="font-size:26px;font-weight:800;letter-spacing:0.6px;color:#3d3329;text-transform:uppercase;">
                  Leto<span style="color:#e6941a;">VPN</span>
                </div>
                <div style="margin-top:8px;font-size:14px;color:#847362;letter-spacing:0.3px;">
                  Открой доступ в безопасный интернет
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:20px 24px 28px 24px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1ece4;border:1px solid #e2dacf;border-radius:16px;">
                  <tr>
                    <td style="padding:28px 24px 8px 24px;text-align:center;">
                      <div style="font-size:20px;font-weight:800;letter-spacing:0.8px;color:#3d3329;text-transform:uppercase;line-height:1.25;">
                        Код для входа
                      </div>
                      <div style="margin-top:8px;font-size:14px;color:#847362;">
                        Введите этот код на странице входа
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:18px 24px 22px 24px;text-align:center;">
                      <div style="display:inline-block;padding:18px 30px;background:#ffffff;border:1px solid #e2dacf;border-radius:12px;box-shadow:0 4px 12px rgba(61,51,41,0.06);font-size:34px;font-weight:800;letter-spacing:10px;color:#3d3329;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;">
                        ${safeCode}
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 28px 6px 28px;color:#3d3329;font-size:14px;line-height:1.6;text-align:center;">
                      Код действителен <strong style="color:#b8730f;">10 минут</strong>. Никому его не сообщайте — сотрудники 220v никогда не запрашивают код.
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:10px 28px 26px 28px;color:#847362;font-size:13px;line-height:1.6;text-align:center;">
                      Если вы не запрашивали вход, просто проигнорируйте это письмо.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:14px 32px 24px 32px;border-top:1px solid #e2dacf;background:#fefdfa;color:#847362;font-size:12px;text-align:center;line-height:1.6;">
                © 220v · <a href="mailto:support@220v.shop" style="color:#e6941a;text-decoration:none;">support@220v.shop</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

export async function sendOtpEmail({ email, code }) {
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "invalid_recipient" };
  }
  if (typeof code !== "string" || !/^\d{4,8}$/.test(code)) {
    return { ok: false, error: "invalid_code" };
  }

  let from;
  let transport;
  try {
    from = readSenderConfig();
    transport = buildTransport();
  } catch (err) {
    return {
      ok: false,
      error: "mailer_not_configured",
      detail: err?.message || "mailer not configured",
    };
  }

  const { subject, text, html } = buildOtpMessage(code);

  try {
    const info = await transport.sendMail({
      from: { name: from.name, address: from.email },
      to: email,
      subject,
      text,
      html,
      headers: {
        "X-Entity-Ref-ID": `otp-${Date.now().toString(36)}`,
        "Auto-Submitted": "auto-generated",
      },
    });
    return { ok: true, messageId: info?.messageId || null };
  } catch (err) {
    const errCode =
      (err && (err.responseCode || err.code)) || null;
    return {
      ok: false,
      error: "smtp_error",
      detail: errCode ? String(errCode) : err?.message || "smtp failure",
    };
  }
}

export async function verifyMailerConfig() {
  const transport = buildTransport();
  return transport.verify();
}

export function _resetMailerForTests() {
  cachedTransport = null;
  cachedTransportKey = null;
}
