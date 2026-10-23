/* Shared by the browser (window.FB_CATEGORIES) and the server (require).
   Each category's icon is the symbol `cat-<id>` in /img/icons.svg. */
(function (root) {
  const CATEGORIES = {
    expense: [
      { id: 'food', color: '#e8590c', en: 'Food & Dining', bn: 'খাবার-দাবার' },
      { id: 'groceries', color: '#2f9e44', en: 'Groceries / Bazar', bn: 'বাজার' },
      { id: 'transport', color: '#1c7ed6', en: 'Transport', bn: 'যাতায়াত' },
      { id: 'rent', color: '#7048e8', en: 'House Rent', bn: 'বাসা ভাড়া' },
      { id: 'bills', color: '#f59f00', en: 'Bills & Utilities', bn: 'বিল ও ইউটিলিটি' },
      { id: 'mobile', color: '#0ca678', en: 'Mobile & Internet', bn: 'মোবাইল ও ইন্টারনেট' },
      { id: 'shopping', color: '#d6336c', en: 'Shopping', bn: 'কেনাকাটা' },
      { id: 'health', color: '#e03131', en: 'Health', bn: 'স্বাস্থ্য' },
      { id: 'education', color: '#4263eb', en: 'Education', bn: 'শিক্ষা' },
      { id: 'entertainment', color: '#ae3ec9', en: 'Entertainment', bn: 'বিনোদন' },
      { id: 'family', color: '#f76707', en: 'Family & Gifts', bn: 'পরিবার ও উপহার' },
      { id: 'other', color: '#868e96', en: 'Other', bn: 'অন্যান্য' },
    ],
    income: [
      { id: 'salary', color: '#2b8a3e', en: 'Salary', bn: 'বেতন' },
      { id: 'business', color: '#1971c2', en: 'Business', bn: 'ব্যবসা' },
      { id: 'freelance', color: '#5f3dc4', en: 'Freelance', bn: 'ফ্রিল্যান্স' },
      { id: 'gift', color: '#c2255c', en: 'Gift / Received', bn: 'উপহার / প্রাপ্তি' },
      { id: 'investment', color: '#0b7285', en: 'Investment / Profit', bn: 'বিনিয়োগ / মুনাফা' },
      { id: 'other_income', color: '#e67700', en: 'Other Income', bn: 'অন্যান্য আয়' },
    ],
  };
  if (typeof module === 'object' && module.exports) module.exports = CATEGORIES;
  else root.FB_CATEGORIES = CATEGORIES;
})(typeof self !== 'undefined' ? self : this);
