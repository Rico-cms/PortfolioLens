/// <reference types="@cloudflare/workers-types" />

interface Env {
  ASSETS: Fetcher;
  AI: Ai;
  BROWSER: Fetcher;
  DB: D1Database;
  SCREENSHOTS: R2Bucket;
  APP_ORIGIN: string;
  AI_MODEL: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
}
