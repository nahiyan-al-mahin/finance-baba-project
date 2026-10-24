'use strict';
// Outgoing email over SMTP (Gmail with an App Password, Brevo, Zoho, ...).
// Without SMTP settings, MAIL_LOG=1 prints emails to the console for local testing.
const nodemailer = require('nodemailer');
const { SMTP, MAIL_FROM, MAIL_LOG } = require('./config');

let transport = null;
if (SMTP.host && SMTP.user && SMTP.pass) {
  transport = nodemailer.createTransport({
    host: SMTP.host,
    port: SMTP.port,
    secure: SMTP.port === 465,
    auth: { user: SMTP.user, pass: SMTP.pass },
  });
} else if (MAIL_LOG) {
  transport = {
    async sendMail(msg) {
      const files = (msg.attachments || []).map((a) => a.filename).join(', ');
      console.log(`\n[mail] To: ${msg.to}\n[mail] Subject: ${msg.subject}\n${msg.text}${files ? `\n[mail] Attachments: ${files}` : ''}\n`);
    },
  };
}

const mail = {
  /** True when emails can actually be delivered (or logged in development). */
  enabled: () => !!transport,

  async send({ to, subject, text, html, attachments }) {
    if (!transport) throw new Error('Email is not configured (set SMTP_HOST, SMTP_USER, SMTP_PASS).');
    const fromName = 'Finance Baba';
    const from = MAIL_FROM.includes('<') ? MAIL_FROM : `"${fromName}" <${MAIL_FROM || SMTP.user}>`;
    await transport.sendMail({ from, to, subject, text, html, attachments });
  },

  /** Tests: capture emails in memory instead of sending them. */
  useTestTransport() {
    const outbox = [];
    transport = { sendMail: async (msg) => outbox.push(msg) };
    return outbox;
  },
};

module.exports = { mail };
