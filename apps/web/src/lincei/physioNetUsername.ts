/**
 * The PhysioNet username, remembered on this device so only the password is
 * typed again. The password is never stored: it lives in its field and the
 * one request that carries it.
 */
const USERNAME_STORAGE_KEY = "lincei:physionet-username";

export function readRememberedUsername(): string {
  try {
    return window.localStorage.getItem(USERNAME_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function rememberUsername(username: string) {
  try {
    window.localStorage.setItem(USERNAME_STORAGE_KEY, username);
  } catch {
    // Storage is a convenience; signing in does not depend on it.
  }
}
