#!/usr/bin/env python3
"""Serveur de démonstration local pour PortfolioLens, sans compte Cloudflare."""

import hashlib
import ipaddress
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "dist" / "client"
STORE = ROOT / "work" / "local-audits.json"
try:
    REPORTS = json.loads(STORE.read_text()) if STORE.exists() else {}
except (OSError, json.JSONDecodeError):
    REPORTS = {}


class PortfolioParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = ""
        self.description = ""
        self.lang = ""
        self.h1 = []
        self.h2_count = 0
        self.image_count = 0
        self.missing_alt = 0
        self.link_count = 0
        self.project_links = 0
        self.has_viewport = False
        self.has_main = False
        self.has_nav = False
        self.has_github = False
        self.has_linkedin = False
        self.text_parts = []
        self.current = None
        self.current_parts = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        tag = tag.lower()
        if tag == "html": self.lang = values.get("lang", "")
        if tag == "title": self.current, self.current_parts = "title", []
        if tag == "h1": self.current, self.current_parts = "h1", []
        if tag == "h2": self.h2_count += 1
        if tag == "main" or values.get("role") == "main": self.has_main = True
        if tag == "nav" or values.get("role") == "navigation": self.has_nav = True
        if tag == "meta":
            if values.get("name", "").lower() == "description": self.description = values.get("content", "")
            if values.get("name", "").lower() == "viewport": self.has_viewport = True
        if tag == "img":
            self.image_count += 1
            if not values.get("alt", "").strip(): self.missing_alt += 1
        if tag == "a" and values.get("href"):
            href = values["href"].lower()
            self.link_count += 1
            self.has_github |= "github.com" in href
            self.has_linkedin |= "linkedin.com" in href
            if re.search(r"project|projet|work|case-study|realisation", href): self.project_links += 1

    def handle_endtag(self, tag):
        if tag == self.current:
            value = " ".join(self.current_parts).strip()
            if tag == "title": self.title = value
            elif tag == "h1" and value: self.h1.append(value)
            self.current, self.current_parts = None, []

    def handle_data(self, data):
        value = data.strip()
        if value:
            self.text_parts.append(value)
            if self.current: self.current_parts.append(value)


def private_host(host):
    if host in {"localhost", "localhost.localdomain"} or host.endswith((".local", ".internal")):
        return True
    try:
        return ipaddress.ip_address(host).is_private or ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def clamp(value):
    return max(0, min(100, round(value)))


def analyse(raw_url):
    if not re.match(r"^https?://", raw_url, re.I): raw_url = "https://" + raw_url
    parsed = urllib.parse.urlparse(raw_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or private_host(parsed.hostname.lower()):
        raise ValueError("Utilise une URL publique valide.")

    request = urllib.request.Request(raw_url, headers={"User-Agent": "PortfolioLens/1.0"})
    started = time.time()
    try:
        response = urllib.request.urlopen(request, timeout=15)
        body = response.read(1_500_000).decode(response.headers.get_content_charset() or "utf-8", "replace")
        status = response.status
        final_url = response.url
        headers = {key.lower(): value for key, value in response.headers.items()}
    except urllib.error.HTTPError as error:
        body = error.read(1_500_000).decode("utf-8", "replace")
        status, final_url = error.code, raw_url
        headers = {key.lower(): value for key, value in error.headers.items()}

    parser = PortfolioParser()
    parser.feed(body)
    text = " ".join(parser.text_parts)
    lower = text.lower()
    has_projects = bool(re.search(r"projets?|projects?|réalisations?|case stud", lower))
    has_contact = bool(re.search(r"contact|e-?mail|discutons|hire me|embaucher", lower)) or "mailto:" in body.lower()
    has_skills = bool(re.search(r"compétences|skills|technologies|stack|expertise", lower))
    if has_projects and parser.project_links == 0: parser.project_links = min(2, parser.link_count)
    signals = {
        "url": final_url, "statusCode": status, "loadTimeMs": round((time.time() - started) * 1000),
        "title": parser.title, "description": parser.description, "lang": parser.lang,
        "h1": parser.h1[:5], "h2Count": parser.h2_count, "textLength": len(text),
        "imageCount": parser.image_count, "missingAltCount": parser.missing_alt,
        "linkCount": parser.link_count, "projectLinkCount": parser.project_links,
        "hasViewport": parser.has_viewport, "hasMain": parser.has_main, "hasNav": parser.has_nav,
        "hasContact": has_contact, "hasSkills": has_skills, "hasProjects": has_projects,
        "hasGithub": parser.has_github, "hasLinkedin": parser.has_linkedin,
        "hasCsp": "content-security-policy" in headers,
        "hasFrameProtection": "x-frame-options" in headers or "frame-ancestors" in headers.get("content-security-policy", ""),
        "hasReferrerPolicy": "referrer-policy" in headers, "usesHttps": final_url.startswith("https://"),
        "headings": parser.h1[:5], "contentSample": text[:12_000],
        "projectSamples": [text[:1_200]] if has_projects else [],
    }
    return make_report(signals, parsed.hostname.lower().removeprefix("www."))


def local_positioning(s):
    declared = " ".join([s.get("title", ""), s.get("description", ""), *s.get("h1", [])]).lower()
    content = " ".join([declared, s.get("contentSample", ""), *s.get("projectSamples", [])]).lower()
    role_rules = [
        ("Développeur full-stack", ["full-stack", "full stack", "fullstack"]),
        ("Développeur frontend", ["frontend", "front-end", "react", "vue.js", "vuejs", "angular", "next.js"]),
        ("Développeur backend", ["backend", "back-end", "api", "django", "laravel", "spring boot"]),
        ("Développeur mobile", ["mobile developer", "flutter", "react native", "android", "ios"]),
        ("Data & intelligence artificielle", ["machine learning", "data scientist", "intelligence artificielle", "artificial intelligence", "llm"]),
        ("DevOps & cloud", ["devops", "kubernetes", "terraform", "cloud engineer"]),
        ("Product designer / UX", ["product designer", "ux designer", "ui/ux", "figma"]),
        ("Product / project manager", ["product manager", "project manager", "chef de projet", "product owner"]),
    ]
    sector_rules = [
        ("SaaS B2B", ["saas", "b2b", "crm", "erp", "dashboard", "tableau de bord"]),
        ("E-commerce & retail", ["e-commerce", "ecommerce", "marketplace", "checkout", "boutique en ligne"]),
        ("Fintech & finance", ["fintech", "finance", "banking", "banque", "paiement", "payment"]),
        ("Santé & medtech", ["santé", "healthcare", "medical", "patient", "medtech"]),
        ("Éducation & edtech", ["edtech", "éducation", "e-learning", "formation"]),
        ("Transport & logistique", ["logistique", "transport", "livraison", "delivery", "mobilité"]),
        ("Immobilier", ["immobilier", "real estate", "property"]),
        ("Voyage & hospitalité", ["travel", "voyage", "tourisme", "hôtel", "booking"]),
    ]
    def best(text, rules, default):
        scored = [(sum(keyword in text for keyword in keywords), label, keywords) for label, keywords in rules]
        score, label, keywords = max(scored, default=(0, default, []))
        return (label if score else default), score, [keyword for keyword in keywords if keyword in text]
    declared_role, _, _ = best(declared, role_rules, "Positionnement non précisé")
    demonstrated_role, role_score, role_hits = best(content, role_rules, "Positionnement non précisé")
    sector, sector_score, sector_hits = best(content, sector_rules, "Secteur non déterminé")
    if declared_role == "Positionnement non précisé" or demonstrated_role == "Positionnement non précisé": alignment = 52
    elif declared_role == demonstrated_role: alignment = 88
    else: alignment = 58
    confidence = min(90, 30 + (role_score + sector_score) * 10)
    evidence = []
    for fragment in re.split(r"(?<=[.!?])\s+", s.get("contentSample", "")):
        if 24 <= len(fragment) <= 280 and any(keyword in fragment.lower() for keyword in role_hits + sector_hits): evidence.append(fragment.strip())
        if len(evidence) == 4: break
    if not evidence and s.get("title"): evidence = [f"Titre observé : {s['title']}"]
    gaps, actions = [], []
    if declared_role == "Positionnement non précisé": gaps.append("Le rôle recherché n’est pas formulé explicitement."); actions.append("Annonce clairement le rôle visé dès le premier écran.")
    if sector == "Secteur non déterminé": gaps.append("Aucun secteur dominant ne ressort des projets."); actions.append("Précise le contexte métier de chaque projet.")
    if alignment < 60: gaps.append("Le rôle annoncé et les preuves visibles ne racontent pas encore la même histoire."); actions.append("Mets en premier les projets qui prouvent le rôle ciblé.")
    summary = f"{demonstrated_role} ressort principalement dans un contexte {sector}. L’alignement avec le rôle annoncé est estimé à {alignment}/100."
    return {"declaredRole": declared_role, "demonstratedRole": demonstrated_role, "primarySector": sector, "secondarySectors": [], "expertise": list(dict.fromkeys(role_hits))[:6], "alignmentScore": alignment, "confidence": confidence, "summary": summary, "evidence": evidence, "gaps": gaps[:4], "recommendations": actions[:4], "source": "deterministic"}


def make_report(s, hostname):
    findings, recommendations = [], []
    def issue(category, severity, title, detail):
        findings.append({"category": category, "severity": severity, "title": title, "detail": detail})
        impact = "Fort" if severity == "high" else "Moyen" if severity == "medium" else "Faible"
        recommendations.append({"title": title, "detail": detail, "impact": impact})

    recruiter = 35 + (15 if 15 <= len(s["title"]) <= 65 else 0) + (12 if len(s["description"]) >= 80 else 0) + (14 if s["hasContact"] else -10) + (12 if s["hasGithub"] else 0) + (7 if s["hasLinkedin"] else 0)
    technical = 42 + (15 if s["usesHttps"] else -20) + (13 if 200 <= s["statusCode"] < 400 else 0) + (20 if s["loadTimeMs"] < 2000 else 10 if s["loadTimeMs"] < 4000 else 0) + (10 if s["hasViewport"] else 0)
    alt_ratio = 1 if s["imageCount"] == 0 else 1 - s["missingAltCount"] / s["imageCount"]
    accessibility = 35 + (15 if s["lang"] else 0) + (15 if len(s["h1"]) == 1 else 0) + (10 if s["hasMain"] else 0) + (10 if s["hasNav"] else 0) + 15 * alt_ratio - (15 if s["missingAltCount"] else 0)
    projects = 25 + (25 if s["hasProjects"] else -10) + (20 if s["projectLinkCount"] >= 2 else 0) + (15 if s["hasGithub"] else 0) + (10 if s["hasSkills"] else 0) + (5 if s["h2Count"] >= 2 else 0)
    security = 35 + (25 if s["usesHttps"] else -20) + (15 if s["hasCsp"] else 0) + (15 if s["hasFrameProtection"] else 0) + (10 if s["hasReferrerPolicy"] else 0)
    scores = {"recruiter": clamp(recruiter), "technical": clamp(technical), "accessibility": clamp(accessibility), "projects": clamp(projects), "security": clamp(security)}
    overall = clamp(scores["recruiter"]*.28 + scores["technical"]*.22 + scores["accessibility"]*.18 + scores["projects"]*.22 + scores["security"]*.10)

    if not s["hasContact"]: issue("recruiter", "high", "Contact difficile à trouver", "Ajoute une action de contact visible dès le premier écran.")
    if not s["hasProjects"]: issue("projects", "high", "Projets difficiles à identifier", "Ajoute une section Projets avec contexte, contribution et résultat.")
    if s["missingAltCount"]: issue("accessibility", "high", "Images sans alternative", f"Ajoute un texte alternatif à {s['missingAltCount']} image(s).")
    if not s["hasCsp"]: issue("security", "medium", "CSP absente", "Ajoute une Content-Security-Policy adaptée à tes ressources.")
    if len(s["description"]) < 80: issue("recruiter", "medium", "Présentation trop courte", "Explique clairement qui tu es, ce que tu construis et pour qui.")
    if not recommendations: recommendations.append({"title": "Ajouter une étude de cas", "detail": "Montre le problème, tes décisions et le résultat mesurable d’un projet majeur.", "impact": "Moyen"})
    verdict = "Prêt à convaincre" if overall >= 85 else "Solide, encore perfectible" if overall >= 70 else "Du potentiel à révéler" if overall >= 50 else "Le message doit être clarifié"
    summary = f"{hostname} possède une base {'convaincante' if overall >= 70 else 'à renforcer'}. Les recommandations ci-dessous ciblent les signaux qu’un recruteur peut vérifier rapidement."
    audit_id = hashlib.sha256(f"{hostname}{time.time()}".encode()).hexdigest()[:12]
    return {"id": audit_id, "url": s["url"], "hostname": hostname, "createdAt": datetime.now(timezone.utc).isoformat(), "overallScore": overall, "scores": scores, "summary": summary, "verdict": verdict, "findings": findings, "recommendations": recommendations[:5], "signals": s, "positioning": local_positioning(s), "aiEnhanced": False}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs): super().__init__(*args, directory=str(STATIC), **kwargs)

    def send_json(self, payload, status=200, extra_headers=None):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        for name, value in (extra_headers or {}).items(): self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/config": return self.send_json({"turnstileSiteKey": None})
        if self.path == "/api/health": return self.send_json({"ok": True, "service": "PortfolioLens local"})
        if self.path.startswith("/api/admin/dashboard"):
            if "pl_admin_local=1" not in self.headers.get("Cookie", ""): return self.send_json({"error": "Authentification requise."}, 401)
            return self.send_json({"dashboard": local_dashboard()})
        match = re.fullmatch(r"/api/audits/([a-f0-9]{12})", self.path)
        if match:
            if match.group(1) not in REPORTS: return self.send_json({"error": "Rapport introuvable."}, 404)
            audit = dict(REPORTS[match.group(1)])
            if not audit.get("positioning"): audit["positioning"] = local_positioning(audit["signals"])
            return self.send_json({"audit": audit})
        if self.path.startswith("/report/") or self.path in {"/admin", "/privacy"}:
            self.path = "/index.html"
        return super().do_GET()

    def do_POST(self):
        if self.path == "/api/analytics/events": return self.send_json({"ok": True}, 202)
        if self.path == "/api/admin/logout": return self.send_json({"ok": True}, 200, {"Set-Cookie": "pl_admin_local=; Path=/; Max-Age=0"})
        if self.path == "/api/admin/login":
            length = min(int(self.headers.get("Content-Length", "0")), 4_096)
            payload = json.loads(self.rfile.read(length) or b"{}")
            expected = os.environ.get("PORTFOLIOLENS_LOCAL_ADMIN_PASSWORD", "local")
            if payload.get("password") != expected: return self.send_json({"error": "Mot de passe incorrect."}, 401)
            return self.send_json({"ok": True}, 200, {"Set-Cookie": "pl_admin_local=1; Path=/; HttpOnly; SameSite=Strict"})
        if self.path != "/api/audits": return self.send_json({"error": "Route introuvable."}, 404)
        try:
            length = min(int(self.headers.get("Content-Length", "0")), 20_000)
            payload = json.loads(self.rfile.read(length))
            audit = analyse(str(payload.get("url", "")).strip())
            REPORTS[audit["id"]] = audit
            STORE.parent.mkdir(exist_ok=True)
            STORE.write_text(json.dumps(REPORTS, ensure_ascii=False))
            return self.send_json({"audit": audit, "mode": "fallback"}, 201)
        except ValueError as error:
            return self.send_json({"error": str(error)}, 400)
        except Exception as error:
            print("Audit error:", repr(error))
            return self.send_json({"error": "Impossible de charger ce site depuis le serveur local."}, 502)


def local_dashboard():
    audits = list(REPORTS.values())
    count = len(audits)
    score_keys = ["recruiter", "technical", "accessibility", "projects", "security"]
    averages = {key: round(sum(audit["scores"].get(key, 0) for audit in audits) / count) if count else 0 for key in score_keys}
    issue_definitions = [
        ("missing_csp", "Content Security Policy absente", lambda s: not s.get("hasCsp")),
        ("missing_frame", "Protection anti-iframe absente", lambda s: not s.get("hasFrameProtection")),
        ("missing_contact", "Contact difficile à détecter", lambda s: not s.get("hasContact")),
        ("missing_projects", "Section projets non détectée", lambda s: not s.get("hasProjects")),
        ("missing_proofs", "Moins de deux preuves de projet", lambda s: s.get("projectLinkCount", 0) < 2),
        ("missing_github", "Lien GitHub non détecté", lambda s: not s.get("hasGithub")),
    ]
    issues = []
    for key, label, predicate in issue_definitions:
        affected = sum(1 for audit in audits if predicate(audit["signals"]))
        if affected: issues.append({"key": key, "label": label, "count": affected, "percentage": round(affected * 100 / count)})
    issues.sort(key=lambda item: item["percentage"], reverse=True)
    today = datetime.now(timezone.utc).date()
    trend = []
    for offset in range(29, -1, -1):
        day = today.fromordinal(today.toordinal() - offset).isoformat()
        daily_audits = sum(1 for audit in audits if audit["createdAt"][:10] == day)
        trend.append({"day": day, "pageViews": 0, "audits": daily_audits})
    portfolio_history = {}
    history_rows = []
    for audit in sorted(audits, key=lambda item: item["createdAt"]):
        previous = portfolio_history.get(audit["hostname"])
        passage = 1 if previous is None else previous["passage"] + 1
        history_rows.append({
            "id": audit["id"], "hostname": audit["hostname"], "url": audit["url"],
            "overallScore": audit["overallScore"],
            "previousScore": None if previous is None else previous["score"],
            "scoreDelta": None if previous is None else audit["overallScore"] - previous["score"],
            "analysisCount": passage, "reportAvailable": True, "createdAt": audit["createdAt"],
        })
        portfolio_history[audit["hostname"]] = {"passage": passage, "score": audit["overallScore"]}
    recent = list(reversed(history_rows))[:30]
    positioned = [audit["positioning"] for audit in audits if audit.get("positioning")]
    def positioning_distribution(key):
        counts = {}
        for item in positioned:
            label = item.get(key)
            if label and label not in {"Secteur non déterminé", "Positionnement non précisé"}: counts[label] = counts.get(label, 0) + 1
        total = len(positioned) or 1
        return [{"label": label, "count": value, "percentage": round(value * 100 / total)} for label, value in sorted(counts.items(), key=lambda pair: (-pair[1], pair[0]))]
    for row in history_rows:
        positioning = REPORTS[row["id"]].get("positioning", {})
        row.update({"primarySector": positioning.get("primarySector"), "demonstratedRole": positioning.get("demonstratedRole"), "alignmentScore": positioning.get("alignmentScore"), "positioningConfidence": positioning.get("confidence")})
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(), "periodDays": 30,
        "totals": {"pageViews": 0, "uniqueVisitors": 0, "sessions": 0, "audits": count, "conversionRate": 0, "averageScore": round(sum(audit["overallScore"] for audit in audits) / count) if count else 0},
        "scoreAverages": averages, "trend": trend, "commonIssues": issues, "devices": [], "countries": [],
        "positioning": {"analyzed": len(positioned), "coverageRate": round(len(positioned) * 100 / count) if count else 0, "averageAlignment": round(sum(item.get("alignmentScore", 0) for item in positioned) / len(positioned)) if positioned else 0, "topSectors": positioning_distribution("primarySector"), "topRoles": positioning_distribution("demonstratedRole")},
        "recentAudits": recent,
    }


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 4173), Handler)
    print("PortfolioLens local : http://127.0.0.1:4173", flush=True)
    server.serve_forever()
