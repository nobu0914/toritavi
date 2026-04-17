/**
 * Guest mode: no login, localStorage-backed journeys.
 * Cookie `toritavi_guest=1` tells middleware to let the user through.
 * localStorage flag mirrors the cookie so client code can branch quickly.
 */

const GUEST_KEY = "toritavi_guest";
const COOKIE_MAX_AGE_DAYS = 30;

export function isGuestMode(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(GUEST_KEY) === "1";
}

export function enableGuestMode(): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(GUEST_KEY, "1");
  const maxAge = COOKIE_MAX_AGE_DAYS * 24 * 60 * 60;
  document.cookie = `toritavi_guest=1; path=/; max-age=${maxAge}; SameSite=Lax`;
}

export function disableGuestMode(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(GUEST_KEY);
  document.cookie = "toritavi_guest=; path=/; max-age=0; SameSite=Lax";
}
