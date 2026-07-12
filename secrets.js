const { safeStorage } = require('electron');

// Encrypts a secret string at rest using the OS keychain (via Electron's
// safeStorage) with a '$enc:' prefix marking it as encrypted. Falls back to
// storing plaintext if the platform has no keychain available (rare — CI/
// headless Linux) rather than losing the value outright. Shared by every
// integration that persists a credential to disk (DB connections, GlitchTip
// API tokens, ...) so there is exactly one place to audit/change this.
function encrypt(plain) {
  if (!plain) return null;
  try {
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      const buf = safeStorage.encryptString(plain);
      // verify the round-trip before persisting, so we never store data we can't decrypt back
      safeStorage.decryptString(buf);
      return '$enc:' + buf.toString('base64');
    }
  } catch (_) {}
  return plain;
}

function decrypt(stored) {
  if (!stored || typeof stored !== 'string') return stored;
  if (stored.startsWith('$enc:')) {
    try { return safeStorage.decryptString(Buffer.from(stored.slice(5), 'base64')); }
    catch (_) { return ''; }
  }
  return stored;
}

module.exports = { encrypt, decrypt };
