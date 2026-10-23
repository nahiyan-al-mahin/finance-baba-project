'use strict';
const path = require('path');
const PDFDocument = require('pdfkit');
const CATEGORIES = require('../../shared/categories');
const { ROOT } = require('../config');
const { parse } = require('../dates');

// Noto Sans Bengali covers both Bangla and Latin, so one font serves both languages.
const FONT = path.join(ROOT, 'public', 'fonts', 'NotoSansBengali.ttf');

const COLORS = { brand: '#0f766e', brandLight: '#e6f4f2', text: '#1f2937', muted: '#6b7280', line: '#e5e7eb', income: '#15803d', expense: '#b91c1c', zebra: '#f9fafb' };

const LABELS = {
  en: {
    app: 'Finance Baba',
    monthTitle: 'Monthly Finance Report',
    yearTitle: 'Yearly Finance Report',
    preparedFor: 'Prepared for',
    accountId: 'Account ID',
    period: 'Period',
    generated: 'Generated',
    income: 'Total income',
    expense: 'Total expense',
    net: 'Net balance',
    avgDaily: 'Avg. daily spend',
    entries: 'Entries',
    savingsRate: 'Savings rate',
    vsPrev: 'Spending vs previous period',
    spendByCat: 'Spending by category',
    incomeByCat: 'Income by category',
    dailyBreakdown: 'Day-by-day totals',
    monthlyBreakdown: 'Month-by-month totals',
    allTx: 'All transactions (full details)',
    date: 'Date',
    month: 'Month',
    type: 'Type',
    category: 'Category',
    note: 'Occasion / details',
    amount: 'Amount',
    share: 'Share',
    incomeShort: 'Income',
    expenseShort: 'Expense',
    netShort: 'Net',
    none: 'No entries recorded for this period.',
    page: 'Page',
    of: 'of',
    confidential: 'Confidential — generated from your encrypted Finance Baba account.',
  },
  bn: {
    app: 'ফাইন্যান্স বাবা',
    monthTitle: 'মাসিক আর্থিক প্রতিবেদন',
    yearTitle: 'বার্ষিক আর্থিক প্রতিবেদন',
    preparedFor: 'যার জন্য',
    accountId: 'অ্যাকাউন্ট আইডি',
    period: 'সময়কাল',
    generated: 'তৈরির তারিখ',
    income: 'মোট আয়',
    expense: 'মোট খরচ',
    net: 'নিট ব্যালেন্স',
    avgDaily: 'দৈনিক গড় খরচ',
    entries: 'এন্ট্রি',
    savingsRate: 'সঞ্চয়ের হার',
    vsPrev: 'আগের সময়ের তুলনায় খরচ',
    spendByCat: 'খাত অনুযায়ী খরচ',
    incomeByCat: 'খাত অনুযায়ী আয়',
    dailyBreakdown: 'দিনভিত্তিক হিসাব',
    monthlyBreakdown: 'মাসভিত্তিক হিসাব',
    allTx: 'সকল লেনদেন (বিস্তারিত)',
    date: 'তারিখ',
    month: 'মাস',
    type: 'ধরন',
    category: 'খাত',
    note: 'উপলক্ষ / বিবরণ',
    amount: 'পরিমাণ',
    share: 'অংশ',
    incomeShort: 'আয়',
    expenseShort: 'খরচ',
    netShort: 'নিট',
    none: 'এই সময়ে কোনো এন্ট্রি নেই।',
    page: 'পৃষ্ঠা',
    of: '/',
    confidential: 'গোপনীয় — আপনার এনক্রিপ্টেড ফাইন্যান্স বাবা অ্যাকাউন্ট থেকে তৈরি।',
  },
};

function makeFormatters(lang) {
  const locale = lang === 'bn' ? 'bn-BD' : 'en-US';
  const num = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const int = new Intl.NumberFormat(locale);
  const dateLocale = lang === 'bn' ? 'bn-BD' : 'en-GB';
  return {
    money: (n) => `${n < 0 ? '−' : ''}৳ ${num.format(Math.abs(n))}`,
    int: (n) => int.format(n),
    pct: (n) => `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n)}%`,
    date: (d) => new Intl.DateTimeFormat(dateLocale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(parse(d)),
    day: (d) => new Intl.DateTimeFormat(dateLocale, { day: 'numeric', month: 'short', weekday: 'short', timeZone: 'UTC' }).format(parse(d)),
    month: (ym) => new Intl.DateTimeFormat(dateLocale, { month: 'long', timeZone: 'UTC' }).format(parse(`${ym}-01`)),
    monthYear: (d) => new Intl.DateTimeFormat(dateLocale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(parse(d)),
    year: (d) => new Intl.DateTimeFormat(dateLocale, { year: 'numeric', timeZone: 'UTC' }).format(parse(d)),
  };
}

function categoryName(type, id, lang) {
  const cat = CATEGORIES[type].find((c) => c.id === id);
  return cat ? cat[lang] : id;
}

/** Streams a PDF report for a month or a year into `out` (an HTTP response). */
function writeReport(out, { lang, summary, profile, publicId }) {
  const L = LABELS[lang] || LABELS.en;
  const f = makeFormatters(lang);
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: `${L.app} — ${summary.period === 'year' ? L.yearTitle : L.monthTitle}`, Author: L.app } });
  doc.registerFont('main', FONT);
  doc.font('main');
  doc.pipe(out);

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom - 20;
  const ensureSpace = (h) => {
    if (doc.y + h > bottom()) doc.addPage();
  };

  // ---- Header band
  doc.rect(0, 0, doc.page.width, 110).fill(COLORS.brand);
  doc.fillColor('#ffffff').fontSize(11).text(L.app, left, 28);
  doc.fontSize(22).text(summary.period === 'year' ? L.yearTitle : L.monthTitle, left, 44);
  const periodLabel = summary.period === 'year' ? f.year(summary.range.start) : f.monthYear(summary.range.start);
  doc.fontSize(12).text(periodLabel, left, 76);

  doc.fillColor(COLORS.text).fontSize(10);
  const metaY = 125;
  doc.text(`${L.preparedFor}: ${profile.displayName}`, left, metaY);
  doc.text(`${L.accountId}: ${publicId}`, left, metaY + 15);
  doc.text(`${L.period}: ${f.date(summary.range.start)} – ${f.date(summary.range.end)}`, left + width / 2, metaY);
  doc.text(`${L.generated}: ${f.date(summary.today)}`, left + width / 2, metaY + 15);
  doc.y = metaY + 45;

  // ---- Summary cards
  const t = summary.totals;
  const cards = [
    [L.income, f.money(t.income), COLORS.income],
    [L.expense, f.money(t.expense), COLORS.expense],
    [L.net, f.money(t.net), t.net >= 0 ? COLORS.income : COLORS.expense],
    [L.avgDaily, f.money(summary.avgDailyExpense), COLORS.text],
  ];
  const gap = 10;
  const cardW = (width - gap * 3) / 4;
  const cardY = doc.y;
  cards.forEach(([label, value, color], i) => {
    const x = left + i * (cardW + gap);
    doc.roundedRect(x, cardY, cardW, 58, 6).fill(COLORS.brandLight);
    doc.fillColor(COLORS.muted).fontSize(9).text(label, x + 10, cardY + 10, { width: cardW - 20 });
    doc.fillColor(color).fontSize(13).text(value, x + 10, cardY + 28, { width: cardW - 20 });
  });
  doc.y = cardY + 70;

  const extras = [`${L.entries}: ${f.int(t.count)}`];
  if (summary.savingsRatePct !== null) extras.push(`${L.savingsRate}: ${f.pct(summary.savingsRatePct)}`);
  if (summary.expenseChangePct !== null) extras.push(`${L.vsPrev}: ${summary.expenseChangePct > 0 ? '+' : ''}${f.pct(summary.expenseChangePct)}`);
  doc.fillColor(COLORS.muted).fontSize(9).text(extras.join('    •    '), left, doc.y, { width });
  doc.moveDown(1.2);

  const sectionTitle = (title) => {
    ensureSpace(60);
    doc.fillColor(COLORS.brand).fontSize(13).text(title, left, doc.y);
    doc.moveTo(left, doc.y + 2).lineTo(left + width, doc.y + 2).lineWidth(1).strokeColor(COLORS.brand).stroke();
    doc.y += 8;
  };

  /** Simple table with page breaks and a repeated header row. */
  const table = (columns, rows, { rowColor } = {}) => {
    const drawHeader = () => {
      const y = doc.y;
      doc.rect(left, y, width, 20).fill(COLORS.brand);
      let x = left;
      doc.fontSize(9).fillColor('#ffffff');
      for (const col of columns) {
        doc.text(col.label, x + 5, y + 5, { width: col.width - 10, align: col.align || 'left', lineBreak: false });
        x += col.width;
      }
      doc.y = y + 20;
    };
    ensureSpace(45);
    drawHeader();
    rows.forEach((row, idx) => {
      doc.fontSize(9);
      const h = Math.max(18, ...columns.map((col, i) => doc.heightOfString(String(row[i]), { width: col.width - 10 }) + 8));
      if (doc.y + h > bottom()) {
        doc.addPage();
        drawHeader();
      }
      const y = doc.y;
      if (idx % 2) doc.rect(left, y, width, h).fill(COLORS.zebra);
      let x = left;
      columns.forEach((col, i) => {
        doc.fillColor((rowColor && rowColor(row, i, idx)) || COLORS.text).fontSize(9).text(String(row[i]), x + 5, y + 4, { width: col.width - 10, align: col.align || 'left' });
        x += col.width;
      });
      doc.y = y + h;
    });
    doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(0.5).strokeColor(COLORS.line).stroke();
    doc.y += 14;
  };

  if (!summary.entries.length) {
    doc.fillColor(COLORS.muted).fontSize(12).text(L.none, left, doc.y + 20, { width, align: 'center' });
  } else {
    // ---- Category breakdowns with bars
    const catTable = (title, type, list) => {
      if (!list.length) return;
      sectionTitle(title);
      const barW = 150;
      const max = list[0].pct;
      for (const item of list) {
        ensureSpace(20);
        const y = doc.y;
        doc.fillColor(COLORS.text).fontSize(9).text(categoryName(type, item.category, lang), left, y + 2, { width: 150 });
        doc.rect(left + 160, y + 5, barW, 8).fill(COLORS.line);
        doc.rect(left + 160, y + 5, Math.max(1, (barW * item.pct) / max), 8).fill(type === 'income' ? COLORS.income : COLORS.expense);
        doc.fillColor(COLORS.muted).text(f.pct(item.pct), left + 320, y + 2, { width: 60, align: 'right' });
        doc.fillColor(COLORS.text).text(f.money(item.amount), left + 390, y + 2, { width: width - 390, align: 'right' });
        doc.y = y + 18;
      }
      doc.y += 10;
    };
    catTable(L.spendByCat, 'expense', summary.expenseByCategory);
    catTable(L.incomeByCat, 'income', summary.incomeByCategory);

    // ---- Per-day (month) or per-month (year) totals
    const isYear = summary.period === 'year';
    sectionTitle(isYear ? L.monthlyBreakdown : L.dailyBreakdown);
    const buckets = summary.series.filter((b) => isYear || b.count > 0);
    table(
      [
        { label: isYear ? L.month : L.date, width: width * 0.34 },
        { label: L.incomeShort, width: width * 0.22, align: 'right' },
        { label: L.expenseShort, width: width * 0.22, align: 'right' },
        { label: L.netShort, width: width * 0.22, align: 'right' },
      ],
      buckets.map((b) => [isYear ? f.month(b.key) : f.day(b.key), f.money(b.income), f.money(b.expense), f.money(b.income - b.expense)]),
      { rowColor: (row, i, idx) => (i === 3 && buckets[idx].income < buckets[idx].expense ? COLORS.expense : null) }
    );

    // ---- Full transaction list
    sectionTitle(L.allTx);
    table(
      [
        { label: L.date, width: width * 0.16 },
        { label: L.type, width: width * 0.1 },
        { label: L.category, width: width * 0.2 },
        { label: L.note, width: width * 0.34 },
        { label: L.amount, width: width * 0.2, align: 'right' },
      ],
      summary.entries.map((e) => [
        f.date(e.date),
        e.type === 'income' ? L.incomeShort : L.expenseShort,
        categoryName(e.type, e.category, lang),
        e.note,
        `${e.type === 'income' ? '+' : '−'} ${f.money(e.amount)}`,
      ]),
      { rowColor: (row, i, idx) => (i === 4 ? (summary.entries[idx].type === 'income' ? COLORS.income : COLORS.expense) : null) }
    );
  }

  // ---- Footer on every page
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const saved = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - 30;
    doc.fontSize(8).fillColor(COLORS.muted);
    doc.text(L.confidential, left, y, { width: width * 0.75, lineBreak: false });
    doc.text(`${L.page} ${f.int(i + 1)} ${L.of} ${f.int(range.count)}`, left + width * 0.75, y, { width: width * 0.25, align: 'right', lineBreak: false });
    doc.page.margins.bottom = saved;
  }
  doc.end();
}

module.exports = { writeReport };
