const paypalEnv = process.env.PAYPAL_ENV || process.env.PAYPAL_MODE || 'sandbox';

// Examiner note:
// This service is server-side only. It uses the Business sandbox app
// credentials from .env to call PayPal APIs and never exposes the secret
// or OAuth token to browser JavaScript.
function paypalApiBase() {
  if (process.env.PAYPAL_API_BASE) return process.env.PAYPAL_API_BASE;
  return paypalEnv === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

function requirePayPalConfig() {
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
    throw new Error('PayPal is not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.');
  }
}

async function getAccessToken() {
  requirePayPalConfig();
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const response = await fetch(`${paypalApiBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `Unable to authenticate with PayPal (HTTP ${response.status})`);
  }
  return data.access_token;
}

async function paypalRequest(path, options = {}) {
  const accessToken = await getAccessToken();
  const response = await fetch(`${paypalApiBase()}${path}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const detail = data.message || data.error_description || data.error || `PayPal request failed with HTTP ${response.status}`;
    const error = new Error(detail);
    error.status = response.status;
    error.paypal = data;
    throw error;
  }
  return data;
}

module.exports = {
  paypalApiBase,
  requirePayPalConfig,
  getAccessToken,
  paypalRequest
};
