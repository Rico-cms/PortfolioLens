import puppeteer from "@cloudflare/puppeteer";
import { buildFallbackSummary, scoreSignals } from "../shared/scoring";
import type { AuditResult, PageSignals, Recommendation } from "../shared/types";

type AuditCapture = { signals: PageSignals; screenshot?: Uint8Array; mode: "browser" | "fallback" };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/health") return json({ ok: true, service: "PortfolioLens" });
      if (url.pathname === "/api/config") return json({ turnstileSiteKey: env.TURNSTILE_SITE_KEY || null });
      if (url.pathname === "/api/audits" && request.method === "POST") return createAudit(request, env, ctx);
      const reportMatch = url.pathname.match(/^\/api\/audits\/([a-zA-Z0-9_-]+)$/);
      if (reportMatch && request.method === "GET") return getAudit(reportMatch[1], env);
      const screenshotMatch = url.pathname.match(/^\/api\/screenshots\/([a-zA-Z0-9_-]+\.webp)$/);
      if (screenshotMatch && request.method === "GET") return getScreenshot(screenshotMatch[1], env);
      if (url.pathname.startsWith("/api/")) return json({ error: "Route introuvable." }, 404);
      return env.ASSETS.fetch(request);
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
  const screenshotKey = captured.screenshot ? `${id}.webp` : null;

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
  ];
  if (captured.screenshot && screenshotKey) {
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
  const object = await env.SCREENSHOTS.get(key);
  if (!object) return json({ error: "Capture introuvable." }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=86400");
  return new Response(object.body, { headers });
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
  if (keys.length) await env.SCREENSHOTS.delete(keys);
  await env.DB.prepare("DELETE FROM audits WHERE created_at < datetime('now', '-30 days')").run();
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
