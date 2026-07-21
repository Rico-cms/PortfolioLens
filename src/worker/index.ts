import puppeteer from "@cloudflare/puppeteer";
import { buildFallbackSummary, scoreSignals } from "../shared/scoring";
import type {
  AdminDashboardData,
  AnalyticsEventName,
  AnalyticsEventPayload,
  AuditResult,
  PageSignals,
  Recommendation,
  ScoreKey,
} from "../shared/types";

type AuditCapture = { signals: PageSignals; screenshot?: Uint8Array; mode: "browser" | "fallback" };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/health") return json({ ok: true, service: "PortfolioLens" });
      if (url.pathname === "/api/config") return json({ turnstileSiteKey: env.TURNSTILE_SITE_KEY || null });
      if (url.pathname === "/api/analytics/events" && request.method === "POST") return recordAnalyticsEvent(request, env, ctx);
      if (url.pathname === "/api/admin/login" && request.method === "POST") return adminLogin(request, env);
      if (url.pathname === "/api/admin/logout" && request.method === "POST") return adminLogout();
      if (url.pathname === "/api/admin/dashboard" && request.method === "GET") return adminDashboard(request, env);
      if (url.pathname === "/api/admin/export.csv" && request.method === "GET") return exportAdminDataset(request, env);
      if (url.pathname === "/api/audits" && request.method === "POST") return createAudit(request, env, ctx);
      const reportMatch = url.pathname.match(/^\/api\/audits\/([a-zA-Z0-9_-]+)$/);
      if (reportMatch && request.method === "GET") return getAudit(reportMatch[1], env);
      const screenshotMatch = url.pathname.match(/^\/api\/screenshots\/([a-zA-Z0-9_-]+\.webp)$/);
      if (screenshotMatch && request.method === "GET") return getScreenshot(screenshotMatch[1], env);
      if (url.pathname.startsWith("/api/")) return json({ error: "Route introuvable." }, 404);
      const assetResponse = await env.ASSETS.fetch(request);
      if (url.pathname !== "/admin") return assetResponse;
      const headers = new Headers(assetResponse.headers);
      headers.set("x-robots-tag", "noindex, nofollow, noarchive");
      headers.set("cache-control", "private, no-store");
      return new Response(assetResponse.body, { status: assetResponse.status, statusText: assetResponse.statusText, headers });
    } catch (error) {
      console.error("Unhandled request error", error);
      return json({ error: "Une erreur inattendue est survenue." }, 500);
    }
  },
};

async function createAudit(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await request.json<{ url?: string; turnstileToken?: string }>().catch(() => ({ url: undefined, turnstileToken: undefined }));
  if (!body.url) return json({ error: "Ajoute l’adresse de ton portfolio." }, 400);

  const target = normalizeAndValidateUrl(body.url);
  if (!target) return json({ error: "Utilise une URL publique valide commençant par http:// ou https://." }, 400);

  if (env.TURNSTILE_SECRET) {
    const valid = await verifyTurnstile(body.turnstileToken, request, env.TURNSTILE_SECRET);
    if (!valid) return json({ error: "La vérification anti-bot a échoué. Réessaie." }, 403);
  }

  const id = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const captured = await capturePortfolio(target, env);
  const scored = scoreSignals(captured.signals);
  const aiCopy = await enhanceWithAi(captured.signals, scored.overallScore, scored.recommendations, env);
  const screenshotKey = captured.screenshot && env.SCREENSHOTS ? `${id}.webp` : null;

  const audit: AuditResult = {
    id,
    url: target.href,
    hostname: target.hostname.replace(/^www\./, ""),
    createdAt: new Date().toISOString(),
    overallScore: scored.overallScore,
    scores: scored.scores,
    summary: aiCopy?.summary || buildFallbackSummary(scored.overallScore, target.hostname),
    verdict: aiCopy?.verdict || verdictFor(scored.overallScore),
    findings: scored.findings,
    recommendations: aiCopy?.recommendations?.length ? aiCopy.recommendations : scored.recommendations,
    signals: captured.signals,
    screenshotUrl: screenshotKey ? `/api/screenshots/${screenshotKey}` : undefined,
    aiEnhanced: Boolean(aiCopy),
  };

  const writes: Promise<unknown>[] = [
    env.DB.prepare(
      "INSERT INTO audits (id, url, hostname, overall_score, result_json, screenshot_key) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(id, audit.url, audit.hostname, audit.overallScore, JSON.stringify(audit), screenshotKey).run(),
    env.DB.prepare(
      `INSERT INTO audit_observations (
        audit_id, overall_score, recruiter_score, technical_score, accessibility_score,
        projects_score, security_score, has_contact, has_github, has_linkedin,
        has_projects, project_link_count, has_csp, has_frame_protection,
        has_referrer_policy, has_lang, missing_alt_count, image_count, load_time_ms, uses_https,
        hostname, portfolio_url, status_code, title, description_length, text_length,
        h1_count, h2_count, has_viewport, has_main, has_nav, has_skills, link_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      audit.overallScore,
      audit.scores.recruiter,
      audit.scores.technical,
      audit.scores.accessibility,
      audit.scores.projects,
      audit.scores.security,
      booleanNumber(audit.signals.hasContact),
      booleanNumber(audit.signals.hasGithub),
      booleanNumber(audit.signals.hasLinkedin),
      booleanNumber(audit.signals.hasProjects),
      audit.signals.projectLinkCount,
      booleanNumber(audit.signals.hasCsp),
      booleanNumber(audit.signals.hasFrameProtection),
      booleanNumber(audit.signals.hasReferrerPolicy),
      booleanNumber(Boolean(audit.signals.lang)),
      audit.signals.missingAltCount,
      audit.signals.imageCount,
      audit.signals.loadTimeMs,
      booleanNumber(audit.signals.usesHttps),
      audit.hostname,
      audit.url,
      audit.signals.statusCode,
      audit.signals.title.slice(0, 300),
      audit.signals.description.length,
      audit.signals.textLength,
      audit.signals.h1.length,
      audit.signals.h2Count,
      booleanNumber(audit.signals.hasViewport),
      booleanNumber(audit.signals.hasMain),
      booleanNumber(audit.signals.hasNav),
      booleanNumber(audit.signals.hasSkills),
      audit.signals.linkCount,
    ).run(),
  ];
  if (captured.screenshot && screenshotKey && env.SCREENSHOTS) {
    writes.push(env.SCREENSHOTS.put(screenshotKey, captured.screenshot, {
      httpMetadata: { contentType: "image/webp", cacheControl: "public, max-age=86400" },
    }));
  }
  await Promise.all(writes);

  ctx.waitUntil(cleanOldAudits(env));
  return json({ audit, mode: captured.mode }, 201);
}

async function getAudit(id: string, env: Env) {
  const row = await env.DB.prepare("SELECT result_json FROM audits WHERE id = ? LIMIT 1").bind(id).first<{ result_json: string }>();
  if (!row) return json({ error: "Rapport introuvable." }, 404);
  return json({ audit: JSON.parse(row.result_json) }, 200, { "cache-control": "public, max-age=60" });
}

async function getScreenshot(key: string, env: Env) {
  if (!env.SCREENSHOTS) return json({ error: "Stockage de captures non activé." }, 404);
  const object = await env.SCREENSHOTS.get(key);
  if (!object) return json({ error: "Capture introuvable." }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=86400");
  return new Response(object.body, { headers });
}

const analyticsEvents = new Set<AnalyticsEventName>(["page_view", "audit_started", "audit_completed", "consent_granted"]);

async function recordAnalyticsEvent(request: Request, env: Env, ctx: ExecutionContext) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return json({ error: "Origine refusée." }, 403);
  if (!cookieValue(request, "pl_consent")?.startsWith("accepted")) return new Response(null, { status: 204 });
  if (Number(request.headers.get("content-length") || 0) > 8_192) return json({ error: "Événement trop volumineux." }, 413);

  const body = await request.json<Partial<AnalyticsEventPayload>>().catch(() => null);
  if (!body || !analyticsEvents.has(body.event as AnalyticsEventName)) return json({ error: "Événement invalide." }, 400);
  if (!validOpaqueId(body.visitorId) || !validOpaqueId(body.sessionId)) return json({ error: "Identifiant invalide." }, 400);

  const path = normalizeAnalyticsPath(body.path || "/");
  const visitorHash = await digestIdentifier(body.visitorId!, env.APP_ORIGIN);
  const sessionHash = await digestIdentifier(body.sessionId!, env.APP_ORIGIN);
  const referrerHost = sanitizeHostname(body.referrerHost);
  const locale = typeof body.locale === "string" ? body.locale.slice(0, 20) : null;
  const userAgent = request.headers.get("user-agent") || "";
  const country = typeof request.cf?.country === "string" ? request.cf.country.slice(0, 2).toUpperCase() : null;

  const write = env.DB.prepare(
    `INSERT INTO analytics_events (
      visitor_hash, session_hash, event_name, path, referrer_host, country_code, device_type, locale
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(visitorHash, sessionHash, body.event, path, referrerHost, country, deviceType(userAgent), locale).run();
  ctx.waitUntil(write);

  const random = crypto.getRandomValues(new Uint8Array(1))[0];
  if (random === 0) ctx.waitUntil(cleanAnalyticsData(env));
  return new Response(null, { status: 202 });
}

async function adminLogin(request: Request, env: Env) {
  if (!env.ADMIN_PASSWORD) return noStoreJson({ error: "L’espace administrateur n’est pas encore activé." }, 503);
  if (Number(request.headers.get("content-length") || 0) > 4_096) return noStoreJson({ error: "Requête trop volumineuse." }, 413);
  const body = await request.json<{ password?: string }>().catch(() => ({ password: undefined }));
  const password = typeof body.password === "string" ? body.password : "";
  if (!password || !(await secureTextEqual(password, env.ADMIN_PASSWORD))) {
    return noStoreJson({ error: "Mot de passe incorrect." }, 401);
  }

  const token = await createAdminSession(env.ADMIN_PASSWORD);
  return noStoreJson({ ok: true }, 200, {
    "set-cookie": `pl_admin=${token}; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=43200`,
  });
}

function adminLogout() {
  return noStoreJson({ ok: true }, 200, {
    "set-cookie": "pl_admin=; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0",
  });
}

async function adminDashboard(request: Request, env: Env) {
  if (!(await isAdminAuthenticated(request, env))) return noStoreJson({ error: "Authentification requise." }, 401);
  const periodDays = dashboardPeriod(new URL(request.url).searchParams.get("days"));
  const modifier = `-${periodDays} days`;
  const trendDays = Math.min(periodDays, 30);
  const trendModifier = `-${trendDays - 1} days`;

  const [analytics, observations, averages, issues, viewsByDay, auditsByDay, devices, countries, recentAudits] = await Promise.all([
    env.DB.prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN event_name = 'page_view' THEN 1 ELSE 0 END), 0) AS page_views,
        COUNT(DISTINCT visitor_hash) AS unique_visitors,
        COUNT(DISTINCT session_hash) AS sessions
      FROM analytics_events WHERE created_at >= datetime('now', ?)`,
    ).bind(modifier).first<{ page_views: number; unique_visitors: number; sessions: number }>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS audits, COALESCE(AVG(overall_score), 0) AS average_score
       FROM audit_observations WHERE created_at >= datetime('now', ?)`,
    ).bind(modifier).first<{ audits: number; average_score: number }>(),
    env.DB.prepare(
      `SELECT
        COALESCE(AVG(recruiter_score), 0) AS recruiter,
        COALESCE(AVG(technical_score), 0) AS technical,
        COALESCE(AVG(accessibility_score), 0) AS accessibility,
        COALESCE(AVG(projects_score), 0) AS projects,
        COALESCE(AVG(security_score), 0) AS security
       FROM audit_observations WHERE created_at >= datetime('now', ?)`,
    ).bind(modifier).first<Record<ScoreKey, number>>(),
    env.DB.prepare(
      `SELECT
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN has_csp = 0 THEN 1 ELSE 0 END), 0) AS missing_csp,
        COALESCE(SUM(CASE WHEN has_frame_protection = 0 THEN 1 ELSE 0 END), 0) AS missing_frame_protection,
        COALESCE(SUM(CASE WHEN has_referrer_policy = 0 THEN 1 ELSE 0 END), 0) AS missing_referrer_policy,
        COALESCE(SUM(CASE WHEN has_contact = 0 THEN 1 ELSE 0 END), 0) AS missing_contact,
        COALESCE(SUM(CASE WHEN has_projects = 0 THEN 1 ELSE 0 END), 0) AS missing_projects,
        COALESCE(SUM(CASE WHEN project_link_count < 2 THEN 1 ELSE 0 END), 0) AS missing_project_proofs,
        COALESCE(SUM(CASE WHEN has_github = 0 THEN 1 ELSE 0 END), 0) AS missing_github,
        COALESCE(SUM(CASE WHEN has_linkedin = 0 THEN 1 ELSE 0 END), 0) AS missing_linkedin,
        COALESCE(SUM(CASE WHEN has_lang = 0 THEN 1 ELSE 0 END), 0) AS missing_lang,
        COALESCE(SUM(CASE WHEN missing_alt_count > 0 THEN 1 ELSE 0 END), 0) AS missing_alt,
        COALESCE(SUM(CASE WHEN load_time_ms >= 2000 THEN 1 ELSE 0 END), 0) AS slow_load
       FROM audit_observations WHERE created_at >= datetime('now', ?)`,
    ).bind(modifier).first<Record<string, number>>(),
    env.DB.prepare(
      `SELECT date(created_at) AS day, COUNT(*) AS count FROM analytics_events
       WHERE event_name = 'page_view' AND created_at >= datetime('now', ?)
       GROUP BY date(created_at) ORDER BY day`,
    ).bind(trendModifier).all<{ day: string; count: number }>(),
    env.DB.prepare(
      `SELECT date(created_at) AS day, COUNT(*) AS count FROM audit_observations
       WHERE created_at >= datetime('now', ?) GROUP BY date(created_at) ORDER BY day`,
    ).bind(trendModifier).all<{ day: string; count: number }>(),
    env.DB.prepare(
      `SELECT device_type AS label, COUNT(*) AS count FROM analytics_events
       WHERE event_name = 'page_view' AND created_at >= datetime('now', ?)
       GROUP BY device_type ORDER BY count DESC`,
    ).bind(modifier).all<{ label: string; count: number }>(),
    env.DB.prepare(
      `SELECT country_code AS label, COUNT(*) AS count FROM analytics_events
       WHERE event_name = 'page_view' AND country_code IS NOT NULL AND created_at >= datetime('now', ?)
       GROUP BY country_code ORDER BY count DESC LIMIT 8`,
    ).bind(modifier).all<{ label: string; count: number }>(),
    env.DB.prepare(
      `WITH history AS (
        SELECT
          audit_id AS id,
          hostname,
          portfolio_url,
          overall_score,
          created_at,
          LAG(overall_score) OVER (PARTITION BY hostname ORDER BY created_at) AS previous_score,
          ROW_NUMBER() OVER (PARTITION BY hostname ORDER BY created_at) AS analysis_count
        FROM audit_observations
        WHERE hostname IS NOT NULL
      )
      SELECT
        history.*,
        CASE WHEN audits.id IS NULL THEN 0 ELSE 1 END AS report_available
      FROM history
      LEFT JOIN audits ON audits.id = history.id
      ORDER BY history.created_at DESC
      LIMIT 30`,
    ).all<{
      id: string;
      hostname: string;
      portfolio_url: string | null;
      overall_score: number;
      previous_score: number | null;
      analysis_count: number;
      report_available: number;
      created_at: string;
    }>(),
  ]);

  const auditTotal = numberValue(observations?.audits);
  const sessionTotal = numberValue(analytics?.sessions);
  const issueTotal = numberValue(issues?.total);
  const pageViews = numberValue(analytics?.page_views);
  const scoreKeys: ScoreKey[] = ["recruiter", "technical", "accessibility", "projects", "security"];
  const scoreAverages = Object.fromEntries(scoreKeys.map((key) => [key, rounded(averages?.[key])])) as Record<ScoreKey, number>;

  const issueDefinitions: Array<[string, string]> = [
    ["missing_csp", "Content Security Policy absente"],
    ["missing_frame_protection", "Protection anti-iframe absente"],
    ["missing_referrer_policy", "Referrer-Policy absente"],
    ["missing_contact", "Contact difficile à détecter"],
    ["missing_projects", "Section projets non détectée"],
    ["missing_project_proofs", "Moins de deux preuves de projet"],
    ["missing_github", "Lien GitHub non détecté"],
    ["missing_linkedin", "Lien LinkedIn non détecté"],
    ["missing_lang", "Langue de page non déclarée"],
    ["missing_alt", "Au moins une image sans alternative"],
    ["slow_load", "Chargement initial supérieur à 2 secondes"],
  ];

  const data: AdminDashboardData = {
    generatedAt: new Date().toISOString(),
    periodDays,
    totals: {
      pageViews,
      uniqueVisitors: numberValue(analytics?.unique_visitors),
      sessions: sessionTotal,
      audits: auditTotal,
      conversionRate: sessionTotal ? Math.min(100, rounded((auditTotal / sessionTotal) * 100, 1)) : 0,
      averageScore: rounded(observations?.average_score),
    },
    scoreAverages,
    trend: buildTrend(trendDays, viewsByDay.results, auditsByDay.results),
    commonIssues: issueDefinitions
      .map(([key, label]) => ({ key, label, count: numberValue(issues?.[key]), percentage: issueTotal ? rounded((numberValue(issues?.[key]) / issueTotal) * 100) : 0 }))
      .filter((item) => item.count > 0)
      .sort((left, right) => right.percentage - left.percentage),
    devices: distribution(devices.results, pageViews),
    countries: distribution(countries.results, pageViews),
    recentAudits: recentAudits.results.map((row) => ({
      id: row.id,
      hostname: row.hostname,
      url: row.portfolio_url || `https://${row.hostname}`,
      overallScore: row.overall_score,
      previousScore: row.previous_score,
      scoreDelta: row.previous_score === null ? null : row.overall_score - row.previous_score,
      analysisCount: row.analysis_count,
      reportAvailable: Boolean(row.report_available),
      createdAt: row.created_at,
    })),
  };
  return noStoreJson({ dashboard: data });
}

async function exportAdminDataset(request: Request, env: Env) {
  if (!(await isAdminAuthenticated(request, env))) return noStoreJson({ error: "Authentification requise." }, 401);
  const periodDays = dashboardPeriod(new URL(request.url).searchParams.get("days"));
  const rows = await env.DB.prepare(
    `WITH history AS (
      SELECT
        *,
        ROW_NUMBER() OVER (PARTITION BY hostname ORDER BY created_at) AS analysis_number,
        LAG(overall_score) OVER (PARTITION BY hostname ORDER BY created_at) AS previous_score
      FROM audit_observations
    )
    SELECT
      created_at,
      hostname,
      portfolio_url,
      analysis_number,
      overall_score,
      previous_score,
      CASE WHEN previous_score IS NULL THEN NULL ELSE overall_score - previous_score END AS score_delta,
      recruiter_score,
      technical_score,
      accessibility_score,
      projects_score,
      security_score,
      status_code,
      load_time_ms,
      title,
      length(COALESCE(title, '')) AS title_length,
      description_length,
      text_length,
      h1_count,
      h2_count,
      image_count,
      missing_alt_count,
      link_count,
      project_link_count,
      has_viewport,
      has_main,
      has_nav,
      has_contact,
      has_skills,
      has_projects,
      has_github,
      has_linkedin,
      has_csp,
      has_frame_protection,
      has_referrer_policy,
      has_lang,
      uses_https
    FROM history
    WHERE created_at >= datetime('now', ?)
    ORDER BY created_at DESC
    LIMIT 5000`,
  ).bind(`-${periodDays} days`).all<Record<string, string | number | null>>();
  const columns = [
    "created_at", "hostname", "portfolio_url", "analysis_number", "overall_score", "previous_score", "score_delta",
    "recruiter_score", "technical_score", "accessibility_score", "projects_score", "security_score",
    "status_code", "load_time_ms", "title", "title_length", "description_length", "text_length", "h1_count", "h2_count",
    "image_count", "missing_alt_count", "link_count", "project_link_count", "has_viewport", "has_main", "has_nav",
    "has_contact", "has_skills", "has_projects", "has_github", "has_linkedin", "has_csp", "has_frame_protection",
    "has_referrer_policy", "has_lang", "uses_https",
  ];
  const csv = `\uFEFF${[columns.join(","), ...rows.results.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\n")}`;
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="portfoliolens-donnees-completes-${periodDays}j.csv"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function dashboardPeriod(raw: string | null) {
  const parsed = Number(raw);
  return [7, 30, 90, 365].includes(parsed) ? parsed : 30;
}

function buildTrend(days: number, views: Array<{ day: string; count: number }>, audits: Array<{ day: string; count: number }>) {
  const viewMap = new Map(views.map((row) => [row.day, numberValue(row.count)]));
  const auditMap = new Map(audits.map((row) => [row.day, numberValue(row.count)]));
  return Array.from({ length: days }, (_, index) => {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - (days - 1 - index));
    const day = date.toISOString().slice(0, 10);
    return { day, pageViews: viewMap.get(day) || 0, audits: auditMap.get(day) || 0 };
  });
}

function distribution(rows: Array<{ label: string; count: number }>, total: number) {
  return rows.map((row) => ({ label: row.label, count: numberValue(row.count), percentage: total ? rounded((numberValue(row.count) / total) * 100) : 0 }));
}

function normalizeAnalyticsPath(path: string) {
  if (path.startsWith("/report/")) return "/report/:id";
  if (path === "/privacy") return "/privacy";
  return "/";
}

function sanitizeHostname(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().slice(0, 120);
  return /^[a-z0-9.-]+$/.test(normalized) ? normalized : null;
}

function deviceType(userAgent: string) {
  if (/ipad|tablet/i.test(userAgent)) return "Tablette";
  if (/mobile|iphone|android/i.test(userAgent)) return "Mobile";
  return "Ordinateur";
}

function validOpaqueId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9-]{16,64}$/i.test(value);
}

async function digestIdentifier(value: string, salt: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${value}`));
  return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cookieValue(request: Request, name: string) {
  const cookies = request.headers.get("cookie") || "";
  const entry = cookies.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : null;
}

async function createAdminSession(secret: string) {
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ exp: Date.now() + 43_200_000 })));
  return `${payload}.${await hmacSignature(payload, secret)}`;
}

async function isAdminAuthenticated(request: Request, env: Env) {
  if (!env.ADMIN_PASSWORD) return false;
  const token = cookieValue(request, "pl_admin");
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  try {
    const decoded = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload))) as { exp?: number };
    if (!decoded.exp || decoded.exp < Date.now()) return false;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.ADMIN_PASSWORD), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    return crypto.subtle.verify("HMAC", key, base64UrlDecode(signature), new TextEncoder().encode(payload));
  } catch {
    return false;
  }
}

async function hmacSignature(payload: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return base64UrlEncode(new Uint8Array(signature));
}

async function secureTextEqual(left: string, right: string) {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(left)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(right)),
  ]);
  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

function base64UrlEncode(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function numberValue(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function rounded(value: unknown, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(numberValue(value) * factor) / factor;
}

function booleanNumber(value: boolean) {
  return value ? 1 : 0;
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function noStoreJson(value: unknown, status = 200, extraHeaders: HeadersInit = {}) {
  return json(value, status, { "cache-control": "private, no-store", "x-content-type-options": "nosniff", ...extraHeaders });
}

function normalizeAndValidateUrl(raw: string): URL | null {
  try {
    const withProtocol = /^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
    const url = new URL(withProtocol);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return null;
    if (isPrivateIp(host)) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function isPrivateIp(host: string) {
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return true;
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
    (parts[0] === 169 && parts[1] === 254) || (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || parts[0] >= 224;
}

async function capturePortfolio(target: URL, env: Env): Promise<AuditCapture> {
  try {
    const browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
    const startedAt = Date.now();
    const response = await page.goto(target.href, { waitUntil: "domcontentloaded", timeout: 20_000 });
    const loadTimeMs = Date.now() - startedAt;
    const documentSignals = await page.evaluate(() => {
      const text = document.body?.innerText || "";
      const normalized = text.toLowerCase();
      const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"));
      const projectWords = /(projet|project|work|réalisation|case study|étude de cas)/i;
      return {
        title: document.title || "",
        description: document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content || "",
        lang: document.documentElement.lang || "",
        h1: Array.from(document.querySelectorAll("h1")).map((node) => node.textContent?.trim() || "").filter(Boolean).slice(0, 5),
        h2Count: document.querySelectorAll("h2").length,
        textLength: text.trim().length,
        imageCount: document.images.length,
        missingAltCount: Array.from(document.images).filter((image) => !image.hasAttribute("alt") || !image.alt.trim()).length,
        linkCount: links.length,
        projectLinkCount: links.filter((link) => projectWords.test(`${link.textContent} ${link.href}`)).length,
        hasViewport: Boolean(document.querySelector('meta[name="viewport"]')),
        hasMain: Boolean(document.querySelector("main, [role=main]")),
        hasNav: Boolean(document.querySelector("nav, [role=navigation]")),
        hasContact: /(contact|email|e-mail|écrivez|discutons|hire me|embaucher)/i.test(normalized) || Boolean(document.querySelector('a[href^="mailto:"]')),
        hasSkills: /(compétences|skills|technologies|stack|expertise)/i.test(normalized),
        hasProjects: projectWords.test(normalized),
        hasGithub: links.some((link) => link.hostname.includes("github.com")),
        hasLinkedin: links.some((link) => link.hostname.includes("linkedin.com")),
      };
    });
    const screenshot = await page.screenshot({ type: "webp", quality: 72, fullPage: true, captureBeyondViewport: false }) as Uint8Array;
    const headers = response?.headers() || {};
    await browser.close();
    return {
      mode: "browser",
      screenshot,
      signals: {
        url: target.href, statusCode: response?.status() || 0, loadTimeMs, ...documentSignals,
        hasCsp: Boolean(headers["content-security-policy"]),
        hasFrameProtection: Boolean(headers["x-frame-options"] || headers["content-security-policy"]?.includes("frame-ancestors")),
        hasReferrerPolicy: Boolean(headers["referrer-policy"]),
        usesHttps: target.protocol === "https:",
      },
    };
  } catch (error) {
    console.warn("Browser capture unavailable, using fetch fallback", error);
    return captureWithFetch(target);
  }
}

async function captureWithFetch(target: URL): Promise<AuditCapture> {
  const startedAt = Date.now();
  const response = await fetch(target.href, { redirect: "follow", headers: { "user-agent": "PortfolioLens/1.0 (+https://portfoliolens.workers.dev)" } });
  const html = (await response.text()).slice(0, 1_500_000);
  const text = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const attr = (tag: string, name: string) => new RegExp(`<${tag}[^>]*${name}=["']([^"']*)["']`, "i").exec(html)?.[1] || "";
  const count = (pattern: RegExp) => (html.match(pattern) || []).length;
  const h1 = Array.from(html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)).map((match) => match[1].replace(/<[^>]+>/g, " ").trim()).filter(Boolean).slice(0, 5);
  const lower = `${text} ${html}`.toLowerCase();
  const projectWords = /(projet|project|work|réalisation|case study|étude de cas)/i;
  const headers = response.headers;
  return { mode: "fallback", signals: {
    url: target.href, statusCode: response.status, loadTimeMs: Date.now() - startedAt,
    title: /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1].trim() || "",
    description: /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1] || /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i.exec(html)?.[1] || "",
    lang: attr("html", "lang"), h1, h2Count: count(/<h2\b/gi), textLength: text.length,
    imageCount: count(/<img\b/gi), missingAltCount: Array.from(html.matchAll(/<img\b[^>]*>/gi)).filter((match) => !/\balt=["'][^"']*["']/i.test(match[0])).length,
    linkCount: count(/<a\b[^>]+href=/gi), projectLinkCount: Array.from(html.matchAll(/<a\b[^>]+href=["'][^"']+["'][^>]*>([\s\S]*?)<\/a>/gi)).filter((match) => projectWords.test(match[0])).length,
    hasViewport: /<meta[^>]+name=["']viewport["']/i.test(html), hasMain: /<(main\b|[^>]+role=["']main["'])/i.test(html),
    hasNav: /<(nav\b|[^>]+role=["']navigation["'])/i.test(html), hasContact: /(contact|mailto:|discutons|hire me)/i.test(lower),
    hasSkills: /(compétences|skills|technologies|stack|expertise)/i.test(text), hasProjects: projectWords.test(text),
    hasGithub: /github\.com/i.test(html), hasLinkedin: /linkedin\.com/i.test(html),
    hasCsp: headers.has("content-security-policy"), hasFrameProtection: headers.has("x-frame-options") || headers.get("content-security-policy")?.includes("frame-ancestors") === true,
    hasReferrerPolicy: headers.has("referrer-policy"), usesHttps: response.url.startsWith("https://"),
  }};
}

async function enhanceWithAi(signals: PageSignals, score: number, defaults: Recommendation[], env: Env): Promise<{ summary: string; verdict: string; recommendations: Recommendation[] } | null> {
  try {
    const prompt = `Tu es un recruteur tech exigeant mais constructif. Analyse les signaux JSON d'un portfolio développeur. Réponds uniquement avec un JSON valide: {"verdict":"6 mots maximum","summary":"2 phrases en français","recommendations":[{"title":"court","detail":"action concrète","impact":"Fort|Moyen|Faible"}]}. Donne exactement 4 recommandations, sans inventer de contenu absent. Score: ${score}/100. Signaux: ${JSON.stringify(signals)}. Recommandations déterministes disponibles: ${JSON.stringify(defaults)}.`;
    const result = await env.AI.run(env.AI_MODEL || "@cf/meta/llama-3.2-3b-instruct", {
      messages: [{ role: "system", content: "Tu réponds en JSON strict, sans bloc Markdown." }, { role: "user", content: prompt }],
      max_tokens: 650,
      temperature: 0.25,
    }) as { response?: string };
    const raw = result.response?.match(/\{[\s\S]*\}/)?.[0];
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { summary?: string; verdict?: string; recommendations?: Recommendation[] };
    if (!parsed.summary || !parsed.verdict || !Array.isArray(parsed.recommendations)) return null;
    return { summary: parsed.summary.slice(0, 600), verdict: parsed.verdict.slice(0, 100), recommendations: parsed.recommendations.slice(0, 5) };
  } catch (error) {
    console.warn("AI enhancement unavailable", error);
    return null;
  }
}

async function verifyTurnstile(token: string | undefined, request: Request, secret: string) {
  if (!token) return false;
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  form.append("remoteip", request.headers.get("cf-connecting-ip") || "");
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const result = await response.json<{ success: boolean }>();
  return result.success;
}

async function cleanOldAudits(env: Env) {
  const old = await env.DB.prepare("SELECT screenshot_key FROM audits WHERE created_at < datetime('now', '-30 days') LIMIT 50").all<{ screenshot_key: string | null }>();
  const keys = old.results.map((row) => row.screenshot_key).filter((key): key is string => Boolean(key));
  if (keys.length && env.SCREENSHOTS) await env.SCREENSHOTS.delete(keys);
  await env.DB.prepare("DELETE FROM audits WHERE created_at < datetime('now', '-30 days')").run();
  await cleanAnalyticsData(env);
}

async function cleanAnalyticsData(env: Env) {
  await Promise.all([
    env.DB.prepare("DELETE FROM analytics_events WHERE created_at < datetime('now', '-90 days')").run(),
    env.DB.prepare("DELETE FROM audit_observations WHERE created_at < datetime('now', '-365 days')").run(),
  ]);
}

function verdictFor(score: number) {
  if (score >= 85) return "Prêt à convaincre";
  if (score >= 70) return "Solide, encore perfectible";
  if (score >= 50) return "Du potentiel à révéler";
  return "Le message doit être clarifié";
}

function json(value: unknown, status = 200, extraHeaders: HeadersInit = {}) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders } });
}
