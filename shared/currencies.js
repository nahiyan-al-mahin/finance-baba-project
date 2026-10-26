/* Supported currencies (browser: window.FB_CURRENCIES, server: require).
   `fallback` = approximate units per 1 USD, used only if no live rate could ever be fetched. */
(function (root) {
  const CURRENCIES = {
    default: 'BDT',
    fallbackDate: '2025-10-01',
    list: [
      { code: 'BDT', fallback: 122 },
      { code: 'USD', fallback: 1 },
      { code: 'EUR', fallback: 0.86 },
      { code: 'GBP', fallback: 0.75 },
      { code: 'INR', fallback: 88 },
      { code: 'SAR', fallback: 3.75 },
      { code: 'AED', fallback: 3.6725 },
      { code: 'QAR', fallback: 3.64 },
      { code: 'KWD', fallback: 0.306 },
      { code: 'OMR', fallback: 0.385 },
      { code: 'BHD', fallback: 0.376 },
      { code: 'MYR', fallback: 4.22 },
      { code: 'SGD', fallback: 1.29 },
      { code: 'CAD', fallback: 1.39 },
      { code: 'AUD', fallback: 1.52 },
      { code: 'NZD', fallback: 1.71 },
      { code: 'JPY', fallback: 148 },
      { code: 'CNY', fallback: 7.12 },
      { code: 'KRW', fallback: 1390 },
      { code: 'PKR', fallback: 282 },
      { code: 'NPR', fallback: 140 },
      { code: 'LKR', fallback: 301 },
      { code: 'TRY', fallback: 41.5 },
      { code: 'CHF', fallback: 0.8 },
      { code: 'HKD', fallback: 7.78 },
      { code: 'THB', fallback: 32.4 },
      { code: 'IDR', fallback: 16500 },
      { code: 'ZAR', fallback: 17.4 },
    ],
  };
  CURRENCIES.codes = CURRENCIES.list.map((c) => c.code);
  if (typeof module === 'object' && module.exports) module.exports = CURRENCIES;
  else root.FB_CURRENCIES = CURRENCIES;
})(typeof self !== 'undefined' ? self : this);
