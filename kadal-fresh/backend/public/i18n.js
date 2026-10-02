(function () {
  const storageKey = 'kf_language_preference';
  const dictionaries = window.KADAL_TRANSLATIONS || {};
  const knownApiErrors = {
    'Username and password are required.': 'error.usernamePasswordRequired',
    'Incorrect username or password.': 'error.badCredentials',
    'All password fields are required.': 'error.passwordFieldsRequired',
    'Current password and new password are required.': 'error.newPasswordRequired',
    'New passwords do not match.': 'error.passwordMismatch',
    'New password must be different from the current password.': 'error.samePassword',
    'New password must be at least 12 characters and no more than 72 UTF-8 bytes.': 'error.passwordPolicy',
    'Current password is incorrect.': 'error.currentPassword',
    'Admin not found.': 'error.adminMissing',
    'Enter a valid 10-digit mobile number.': 'error.phoneInvalid',
    'Enter a valid email address.': 'error.emailInvalid',
    'Enter your phone or email and password.': 'error.customerLoginRequired',
    'Enter a valid 10-digit mobile number or email address.': 'error.customerIdentifierInvalid',
    'Incorrect phone/email or password.': 'error.customerBadCredentials',
    'Password must be at least 12 characters and no more than 72 UTF-8 bytes.': 'error.passwordPolicy',
    'An account with this phone number already exists. Log in or contact the shop to recover access.': 'error.customerPhoneExists',
    'An account with this email address already exists.': 'error.customerEmailExists',
    'An account with this phone number or email already exists.': 'error.customerAlreadyExists',
    'Customer account not found.': 'error.customerMissing',
    'Enter a valid name.': 'error.nameInvalid',
    'A valid delivery address is required.': 'error.addressInvalid',
    'Invalid location coordinates.': 'error.coordinatesInvalid',
    'Address not found.': 'error.addressMissing',
    'This address is attached to an order and cannot be deleted.': 'error.addressInUse',
    'Category name must be between 1 and 80 characters.': 'error.categoryName',
    'A category with that name already exists.': 'error.categoryDuplicate',
    'No category changes provided.': 'error.categoryNoChanges',
    'Category not found.': 'error.categoryMissing',
    'Cash on Delivery is the only available payment method.': 'error.codOnly',
    'Cart is empty or invalid.': 'error.cartInvalid',
    'Customer account not found.': 'error.customerMissing',
    'Selected address is not valid.': 'error.selectedAddress',
    'A delivery address of 1 to 500 characters is required.': 'error.addressLength',
    'Invalid cart item.': 'error.cartItemInvalid',
    'Maximum quantity per item is 50.': 'error.quantityMax',
    'Could not place order.': 'error.orderCreate',
    'Order not found.': 'error.orderMissing',
    'Invalid status value.': 'error.orderStatus',
    'Cancelled orders cannot be reopened.': 'error.orderCannotReopen',
    'Delivered orders cannot be cancelled.': 'error.deliveredCannotCancel',
    'A paid COD order cannot be cancelled.': 'error.paidCannotCancel',
    'Invalid payment status.': 'error.paymentStatus',
    'Cancelled orders cannot have a successful payment status.': 'error.cancelledPayment',
    'Image must be 5 MB or smaller.': 'error.imageTooLarge',
    'Use a JPEG, PNG, or WebP image.': 'error.imageType',
    'Uploaded file content is not a valid JPEG, PNG, or WebP image.': 'error.imageInvalid',
    'Weight options must be whole gram values between 1 and 100000.': 'error.weightsInvalid',
    'Selected category does not exist.': 'error.categoryMissingProduct',
    'Stock must be a whole number of grams between 0 and 100000000.': 'error.stockInvalid',
    'Availability flags must be true or false.': 'error.flagsInvalid',
    'Product not found.': 'error.productMissing',
    'Enter a valid name (up to 120 characters) and a positive price per kg.': 'error.productFields',
    'Add at least one valid weight option.': 'error.weightRequired',
    'Could not save product.': 'error.productSave',
    'Authentication required.': 'error.authRequired',
    'Session expired or invalid. Please log in again.': 'error.sessionInvalid',
    'Admin access required.': 'error.adminRequired',
    'Password change required before using the admin dashboard.': 'error.passwordChangeRequired',
    'Customer access required.': 'error.customerRequired',
    'Admin account is no longer available.': 'error.adminMissingSession',
    'Admin session has expired. Please log in again.': 'error.sessionInvalid',
    'Not found.': 'error.notFound',
    'Request failed.': 'common.requestFailed',
    'Too many requests. Please try again later.': 'common.rateLimit',
    'Internal server error.': 'error.internalServer',
    'Something went wrong.': 'error.generic',
    'Invalid image upload.': 'error.imageInvalidUpload'
  };

  let language = 'en';
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === 'en' || saved === 'ta') language = saved;
  } catch (_) { }

  function interpolate(text, params) {
    return String(text).replace(/\{([\w]+)\}/g, (_, key) => params && params[key] !== undefined ? String(params[key]) : `{${key}}`);
  }

  function t(key, params) {
    const selected = dictionaries[language] || dictionaries.en || {};
    return interpolate(selected[key] ?? (dictionaries.en || {})[key] ?? key, params);
  }

  function applyStaticTranslations(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach(element => { element.textContent = t(element.dataset.i18n); });
    scope.querySelectorAll('[data-i18n-placeholder]').forEach(element => { element.setAttribute('placeholder', t(element.dataset.i18nPlaceholder)); });
    scope.querySelectorAll('[data-i18n-aria-label]').forEach(element => { element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel)); });
    scope.querySelectorAll('[data-i18n-title]').forEach(element => { element.setAttribute('title', t(element.dataset.i18nTitle)); });
    scope.querySelectorAll('[data-i18n-content]').forEach(element => { element.setAttribute('content', t(element.dataset.i18nContent)); });
    if (scope === document) {
      const title = document.querySelector('title[data-i18n]');
      if (title) document.title = t(title.dataset.i18n);
    }
  }

  function setLanguage(next) {
    if (!dictionaries[next] || next === language) return;
    language = next;
    try { localStorage.setItem(storageKey, language); } catch (_) { }
    document.documentElement.lang = language === 'ta' ? 'ta' : 'en';
    applyStaticTranslations();
    document.querySelectorAll('[data-api-error]').forEach(element => {
      element.textContent = translateError(element.dataset.apiError);
    });
    document.querySelectorAll('[data-i18n-message]').forEach(element => {
      element.textContent = t(element.dataset.i18nMessage);
    });
    document.querySelectorAll('[data-language]').forEach(button => {
      const active = button.dataset.language === language;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    window.dispatchEvent(new CustomEvent('kf-language-change', { detail: { language } }));
  }

  function translateError(message) {
    const raw = String(message || '');
    if (Object.prototype.hasOwnProperty.call(dictionaries.en || {}, raw)
      || Object.prototype.hasOwnProperty.call(dictionaries.ta || {}, raw)) return t(raw);
    if (knownApiErrors[raw]) return t(knownApiErrors[raw]);
    let match = raw.match(/^"(.+)" is no longer available\.$/);
    if (match) return t('error.productUnavailable', { name: match[1] });
    match = raw.match(/^Not enough stock for "(.+)"\.$/);
    if (match) return t('error.stockInsufficient', { name: match[1] });
    match = raw.match(/^Selected weight is not available for "(.+)"\.$/);
    if (match) return t('error.weightUnavailable', { name: match[1] });
    match = raw.match(/^(.+) is required\.$/);
    if (match) {
      const fields = { shop_name: t('admin.shopName'), phone: t('admin.phone'), email: t('admin.email'), business_hours: t('admin.businessHours') };
      return t('error.settingsRequired', { field: fields[match[1]] || match[1] });
    }
    match = raw.match(/^(.+) must be a non-negative number\.$/);
    if (match) return t('error.settingsNumber', { field: match[1] });
    return raw || t('common.unknownError');
  }

  window.t = t;
  window.setLanguage = setLanguage;
  window.getLanguage = () => language;
  window.applyStaticTranslations = applyStaticTranslations;
  window.translateApiError = translateError;
  window.setApiErrorText = function (element, message) {
    if (!element) return;
    element.dataset.apiError = String(message || '');
    element.textContent = translateError(element.dataset.apiError);
  };
  window.setTranslationMessage = function (element, key) {
    if (!element) return;
    element.dataset.i18nMessage = key;
    element.textContent = t(key);
  };

  document.documentElement.lang = language === 'ta' ? 'ta' : 'en';
  applyStaticTranslations();
  document.querySelectorAll('[data-language]').forEach(button => {
    const active = button.dataset.language === language;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
})();