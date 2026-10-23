/* Shared by the browser (window.FB_CATEGORIES) and the server (require). */
(function (root) {
  const CATEGORIES = {
    expense: [
      { id: 'food', icon: '🍛', en: 'Food & Dining', bn: 'খাবার-দাবার' },
      { id: 'groceries', icon: '🛒', en: 'Groceries / Bazar', bn: 'বাজার' },
      { id: 'transport', icon: '🚌', en: 'Transport', bn: 'যাতায়াত' },
      { id: 'rent', icon: '🏠', en: 'House Rent', bn: 'বাসা ভাড়া' },
      { id: 'bills', icon: '💡', en: 'Bills & Utilities', bn: 'বিল ও ইউটিলিটি' },
      { id: 'mobile', icon: '📱', en: 'Mobile & Internet', bn: 'মোবাইল ও ইন্টারনেট' },
      { id: 'shopping', icon: '🛍️', en: 'Shopping', bn: 'কেনাকাটা' },
      { id: 'health', icon: '💊', en: 'Health', bn: 'স্বাস্থ্য' },
      { id: 'education', icon: '📚', en: 'Education', bn: 'শিক্ষা' },
      { id: 'entertainment', icon: '🎬', en: 'Entertainment', bn: 'বিনোদন' },
      { id: 'family', icon: '👪', en: 'Family & Gifts', bn: 'পরিবার ও উপহার' },
      { id: 'other', icon: '📦', en: 'Other', bn: 'অন্যান্য' },
    ],
    income: [
      { id: 'salary', icon: '💼', en: 'Salary', bn: 'বেতন' },
      { id: 'business', icon: '🏪', en: 'Business', bn: 'ব্যবসা' },
      { id: 'freelance', icon: '💻', en: 'Freelance', bn: 'ফ্রিল্যান্স' },
      { id: 'gift', icon: '🎁', en: 'Gift / Received', bn: 'উপহার / প্রাপ্তি' },
      { id: 'investment', icon: '📈', en: 'Investment / Profit', bn: 'বিনিয়োগ / মুনাফা' },
      { id: 'other_income', icon: '💰', en: 'Other Income', bn: 'অন্যান্য আয়' },
    ],
  };
  if (typeof module === 'object' && module.exports) module.exports = CATEGORIES;
  else root.FB_CATEGORIES = CATEGORIES;
})(typeof self !== 'undefined' ? self : this);
