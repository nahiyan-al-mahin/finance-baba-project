'use strict';
// Email templates (English / Bangla). Plain inline-styled HTML so they render in Gmail and phone mail apps.
const { APP_URL } = require('./config');

const T = {
  en: {
    hello: (name) => `Hi ${name},`,
    codeSubject: 'Your Finance Baba verification code',
    codeIntro: 'Use this code to confirm your email address:',
    codeNote: 'The code expires in 15 minutes. If you did not ask for it, you can ignore this email.',
    overSubject: 'You are over your monthly target',
    overIntro: (month) => `You have gone over your spending target for ${month}.`,
    target: 'Target',
    spent: 'Spent so far',
    over: 'Over by',
    overTip: 'Open Finance Baba to see where the money went this month.',
    reportSubject: (month) => `Your Finance Baba report for ${month}`,
    reportIntro: (month) => `Here is your finance summary for ${month}. The full report with every entry is attached as a PDF.`,
    income: 'Income',
    expense: 'Expense',
    net: 'Net balance',
    withinTarget: 'Within your target',
    overTarget: 'Over your target',
    reportOff: 'You can turn these monthly emails off in Settings → Email & monthly reports.',
    open: 'Open Finance Baba',
    footer: 'Built by Mahin Uddin and Claude Opus 5.5 · 2026',
  },
  bn: {
    hello: (name) => `হ্যালো ${name},`,
    codeSubject: 'আপনার ফাইন্যান্স বাবা যাচাই কোড',
    codeIntro: 'আপনার ইমেইল নিশ্চিত করতে এই কোডটি ব্যবহার করুন:',
    codeNote: 'কোডটি ১৫ মিনিট পর মেয়াদোত্তীর্ণ হবে। আপনি না চাইলে এই ইমেইলটি উপেক্ষা করুন।',
    overSubject: 'আপনি মাসিক লক্ষ্য ছাড়িয়ে গেছেন',
    overIntro: (month) => `${month}-এর খরচের লক্ষ্য আপনি ছাড়িয়ে গেছেন।`,
    target: 'লক্ষ্য',
    spent: 'এখন পর্যন্ত খরচ',
    over: 'বেশি হয়েছে',
    overTip: 'এই মাসে টাকা কোথায় গেল দেখতে ফাইন্যান্স বাবা খুলুন।',
    reportSubject: (month) => `${month}-এর ফাইন্যান্স বাবা রিপোর্ট`,
    reportIntro: (month) => `${month}-এর আর্থিক সারাংশ নিচে দেওয়া হলো। প্রতিটি এন্ট্রিসহ পূর্ণ রিপোর্ট PDF হিসেবে সংযুক্ত।`,
    income: 'আয়',
    expense: 'খরচ',
    net: 'নিট ব্যালেন্স',
    withinTarget: 'লক্ষ্যের মধ্যে আছেন',
    overTarget: 'লক্ষ্য ছাড়িয়ে গেছেন',
    reportOff: 'সেটিংস → ইমেইল ও মাসিক রিপোর্ট থেকে এই মাসিক ইমেইল বন্ধ করতে পারেন।',
    open: 'ফাইন্যান্স বাবা খুলুন',
    footer: 'তৈরি করেছেন মাহিন উদ্দিন ও Claude Opus 5.5 · ২০২৬',
  },
};

const L = (lang) => T[lang] || T.en;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function money(n, lang) {
  const num = new Intl.NumberFormat(lang === 'bn' ? 'bn-BD' : 'en-US', { maximumFractionDigits: 2 }).format(Math.abs(n));
  return `${n < 0 ? '−' : ''}৳${num}`;
}

function monthName(ym, lang) {
  return new Intl.DateTimeFormat(lang === 'bn' ? 'bn-BD' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ym}-01T00:00:00Z`));
}

function layout(lang, body) {
  const t = L(lang);
  return `<!doctype html><html><body style="margin:0;background:#faf5ea;font-family:Segoe UI,Roboto,Arial,'Noto Sans Bengali',sans-serif;color:#2b2620">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf5ea;padding:24px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fffdf7;border:1px solid #eadfca;border-radius:18px;box-shadow:0 10px 30px -12px rgba(74,52,20,.25)">
      <tr><td style="background:#0f766e;border-radius:18px 18px 0 0;padding:18px 24px;color:#fff;font-size:18px;font-weight:700">Finance Baba</td></tr>
      <tr><td style="padding:24px">${body}
        <p style="margin:24px 0 0"><a href="${APP_URL}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;padding:10px 18px;border-radius:12px;font-weight:700">${esc(t.open)}</a></p>
      </td></tr>
      <tr><td style="padding:14px 24px;border-top:1px dashed #eadfca;color:#776c5d;font-size:12px">${esc(t.footer)}</td></tr>
    </table>
  </td></tr></table></body></html>`;
}

const row = (label, value, color = '#2b2620') =>
  `<tr><td style="padding:6px 0;color:#776c5d">${esc(label)}</td><td align="right" style="padding:6px 0;font-weight:700;color:${color}">${esc(value)}</td></tr>`;

function verificationCode({ lang, name, code }) {
  const t = L(lang);
  return {
    subject: t.codeSubject,
    text: `${t.hello(name)}\n\n${t.codeIntro}\n\n${code}\n\n${t.codeNote}`,
    html: layout(
      lang,
      `<p>${esc(t.hello(name))}</p><p>${esc(t.codeIntro)}</p>
       <p style="font-size:32px;font-weight:800;letter-spacing:8px;text-align:center;background:#f4ecdc;border-radius:14px;padding:14px 0;margin:18px 0">${esc(code)}</p>
       <p style="color:#776c5d;font-size:13px">${esc(t.codeNote)}</p>`
    ),
  };
}

function overTarget({ lang, name, month, target, spent }) {
  const t = L(lang);
  const m = monthName(month, lang);
  return {
    subject: t.overSubject,
    text: `${t.hello(name)}\n\n${t.overIntro(m)}\n${t.target}: ${money(target, lang)}\n${t.spent}: ${money(spent, lang)}\n${t.over}: ${money(spent - target, lang)}\n\n${t.overTip}\n${APP_URL}`,
    html: layout(
      lang,
      `<p>${esc(t.hello(name))}</p><p style="font-size:16px;font-weight:700;color:#c2410c">${esc(t.overIntro(m))}</p>
       <table role="presentation" width="100%" style="border-collapse:collapse">${row(t.target, money(target, lang))}${row(t.spent, money(spent, lang), '#c2410c')}${row(t.over, money(spent - target, lang), '#c2410c')}</table>
       <p>${esc(t.overTip)}</p>`
    ),
  };
}

function monthlyReport({ lang, name, month, totals, target }) {
  const t = L(lang);
  const m = monthName(month, lang);
  let targetLine = '';
  if (target) {
    const over = totals.expense > target;
    targetLine = row(`${t.target}: ${money(target, lang)}`, over ? t.overTarget : t.withinTarget, over ? '#c2410c' : '#2f7d32');
  }
  return {
    subject: t.reportSubject(m),
    text: `${t.hello(name)}\n\n${t.reportIntro(m)}\n\n${t.income}: ${money(totals.income, lang)}\n${t.expense}: ${money(totals.expense, lang)}\n${t.net}: ${money(totals.net, lang)}\n\n${t.reportOff}`,
    html: layout(
      lang,
      `<p>${esc(t.hello(name))}</p><p>${esc(t.reportIntro(m))}</p>
       <table role="presentation" width="100%" style="border-collapse:collapse">
         ${row(t.income, money(totals.income, lang), '#2f7d32')}${row(t.expense, money(totals.expense, lang), '#c2410c')}${row(t.net, money(totals.net, lang))}${targetLine}
       </table>
       <p style="color:#776c5d;font-size:13px;margin-top:18px">${esc(t.reportOff)}</p>`
    ),
  };
}

module.exports = { verificationCode, overTarget, monthlyReport, monthName };
