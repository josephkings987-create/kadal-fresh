const PROVIDER_REQUIRED_MESSAGE = 'Customer sign-in requires an SMS provider. Configure SMS_OTP_WEBHOOK_URL and SMS_OTP_WEBHOOK_TOKEN (HTTPS in production).';

class SmsProviderConfigurationError extends Error {
  constructor() {
    super(PROVIDER_REQUIRED_MESSAGE);
    this.name = 'SmsProviderConfigurationError';
  }
}

class SmsProviderDeliveryError extends Error {
  constructor() {
    super('Could not deliver the verification code. Please try again.');
    this.name = 'SmsProviderDeliveryError';
  }
}

async function sendOtp(phone, otp) {
  const endpoint = process.env.SMS_OTP_WEBHOOK_URL;
  const token = process.env.SMS_OTP_WEBHOOK_TOKEN;
  const production = process.env.NODE_ENV === 'production';

  if (!endpoint || (production && !token)) {
    if (!production && !endpoint && process.env.DEV_OTP_EXPOSE === 'true') {
      return { developmentOnly: true };
    }
    throw new SmsProviderConfigurationError();
  }

  let url;
  try { url = new URL(endpoint); } catch (_) { throw new SmsProviderConfigurationError(); }
  if (production && url.protocol !== 'https:') throw new SmsProviderConfigurationError();

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ phone, otp, message: `Your Kadal Fresh verification code is ${otp}.` }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (_) {
    throw new SmsProviderDeliveryError();
  }

  if (!response.ok) throw new SmsProviderDeliveryError();
  return { developmentOnly: false };
}

module.exports = { sendOtp, SmsProviderConfigurationError, SmsProviderDeliveryError };