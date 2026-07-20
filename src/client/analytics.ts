import type { AnalyticsEventName, AnalyticsEventPayload } from "../shared/types";

export type ConsentChoice = "accepted" | "declined";

const CONSENT_COOKIE = "pl_consent";
const VISITOR_COOKIE = "pl_visitor";
const CONSENT_MAX_AGE = 60 * 60 * 24 * 180;

export function readConsent(): ConsentChoice | null {
  const value = readCookie(CONSENT_COOKIE);
  return value === "accepted" || value === "declined" ? value : null;
}

export function saveConsent(choice: ConsentChoice) {
  setCookie(CONSENT_COOKIE, choice, CONSENT_MAX_AGE);
  if (choice === "accepted") getOrCreateVisitorId();
  else {
    setCookie(VISITOR_COOKIE, "", 0);
    sessionStorage.removeItem("pl_session");
  }
  window.dispatchEvent(new CustomEvent("portfoliolens:consent", { detail: choice }));
}

export function openCookieSettings() {
  window.dispatchEvent(new Event("portfoliolens:cookie-settings"));
}

export function analyticsPath(pathname = location.pathname) {
  if (pathname.startsWith("/report/")) return "/report/:id";
  if (pathname === "/privacy") return "/privacy";
  return "/";
}

export function trackEvent(event: AnalyticsEventName, pathname = location.pathname) {
  if (readConsent() !== "accepted") return;
  const visitorId = getOrCreateVisitorId();
  const sessionId = getOrCreateSessionId();
  const path = analyticsPath(pathname);
  const payload: AnalyticsEventPayload = {
    event,
    visitorId,
    sessionId,
    path,
    locale: navigator.language,
    referrerHost: safeReferrerHost(),
  };
  const body = JSON.stringify(payload);
  if (navigator.sendBeacon) {
    navigator.sendBeacon("/api/analytics/events", new Blob([body], { type: "application/json" }));
    return;
  }
  fetch("/api/analytics/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
}

export function trackPageView(pathname: string) {
  if (readConsent() !== "accepted") return;
  const path = analyticsPath(pathname);
  const key = `pl_viewed:${path}`;
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, "1");
  trackEvent("page_view", pathname);
}

function getOrCreateVisitorId() {
  const existing = readCookie(VISITOR_COOKIE);
  if (existing) return existing;
  const value = crypto.randomUUID();
  setCookie(VISITOR_COOKIE, value, CONSENT_MAX_AGE);
  return value;
}

function getOrCreateSessionId() {
  const existing = sessionStorage.getItem("pl_session");
  if (existing) return existing;
  const value = crypto.randomUUID();
  sessionStorage.setItem("pl_session", value);
  return value;
}

function readCookie(name: string) {
  const prefix = `${name}=`;
  const entry = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : null;
}

function setCookie(name: string, value: string, maxAge: number) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function safeReferrerHost() {
  if (!document.referrer) return undefined;
  try {
    const host = new URL(document.referrer).hostname;
    return host === location.hostname ? undefined : host;
  } catch {
    return undefined;
  }
}
