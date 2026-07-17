import type { AuditResult, Finding, PageSignals, Recommendation, ScoreKey } from "./types";

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

export function scoreSignals(signals: PageSignals): {
  scores: Record<ScoreKey, number>;
  overallScore: number;
  findings: Finding[];
  recommendations: Recommendation[];
} {
  const findings: Finding[] = [];
  const add = (category: ScoreKey, severity: Finding["severity"], title: string, detail: string) =>
    findings.push({ category, severity, title, detail });

  let recruiter = 35;
  if (signals.title.length >= 15 && signals.title.length <= 65) recruiter += 15;
  else add("recruiter", "medium", "Titre peu convaincant", "Utilise un titre précis : rôle, spécialité et proposition de valeur.");
  if (signals.description.length >= 80) recruiter += 12;
  else add("recruiter", "medium", "Présentation trop courte", "Explique en deux phrases qui tu es, ce que tu construis et pour qui.");
  if (signals.hasContact) recruiter += 14;
  else {
    recruiter -= 10;
    add("recruiter", "high", "Contact difficile à trouver", "Ajoute une action de contact visible dès le premier écran.");
  }
  if (signals.hasGithub) recruiter += 12;
  if (signals.hasLinkedin) recruiter += 7;
  if (signals.textLength >= 800) recruiter += 5;

  let technical = 42;
  if (signals.usesHttps) technical += 15;
  else technical -= 20;
  if (signals.statusCode >= 200 && signals.statusCode < 400) technical += 13;
  else add("technical", "high", "Page indisponible", `Le site a répondu avec le statut HTTP ${signals.statusCode}.`);
  if (signals.loadTimeMs < 2000) technical += 20;
  else if (signals.loadTimeMs < 4000) technical += 10;
  else add("technical", "medium", "Chargement lent", `Le document principal a pris environ ${(signals.loadTimeMs / 1000).toFixed(1)} s.`);
  if (signals.hasViewport) technical += 10;
  else add("technical", "high", "Viewport mobile absent", "Ajoute une balise viewport pour assurer un rendu mobile correct.");

  let accessibility = 35;
  if (signals.lang) accessibility += 15;
  else add("accessibility", "medium", "Langue non déclarée", "Ajoute l’attribut lang sur l’élément html.");
  if (signals.h1.length === 1) accessibility += 15;
  else add("accessibility", "medium", "Hiérarchie H1 à corriger", `La page contient ${signals.h1.length} titre(s) H1.`);
  if (signals.hasMain) accessibility += 10;
  else add("accessibility", "medium", "Zone principale non identifiée", "Structure le contenu avec un élément main.");
  if (signals.hasNav) accessibility += 10;
  const altRatio = signals.imageCount === 0 ? 1 : 1 - signals.missingAltCount / signals.imageCount;
  accessibility += altRatio * 15;
  if (signals.missingAltCount > 0) {
    accessibility -= 15;
    add("accessibility", "high", "Images sans alternative", `${signals.missingAltCount} image(s) semblent ne pas avoir de texte alternatif.`);
  }

  let projects = 25;
  if (signals.hasProjects) projects += 25;
  else {
    projects -= 10;
    add("projects", "high", "Projets difficiles à identifier", "Ajoute une section Projets explicite avec contexte, contribution et résultat.");
  }
  if (signals.projectLinkCount >= 2) projects += 20;
  else add("projects", "medium", "Peu de preuves consultables", "Ajoute des liens vers les démos, dépôts ou études de cas.");
  if (signals.hasGithub) projects += 15;
  if (signals.hasSkills) projects += 10;
  if (signals.h2Count >= 2) projects += 5;

  let security = 35;
  if (signals.usesHttps) security += 25;
  else {
    security -= 20;
    add("security", "high", "Connexion non sécurisée", "Sers le portfolio exclusivement en HTTPS.");
  }
  if (signals.hasCsp) security += 15;
  else add("security", "medium", "CSP absente", "Ajoute une Content-Security-Policy adaptée à tes ressources.");
  if (signals.hasFrameProtection) security += 15;
  else add("security", "low", "Protection anti-iframe absente", "Définis frame-ancestors dans la CSP ou X-Frame-Options.");
  if (signals.hasReferrerPolicy) security += 10;

  const scores = {
    recruiter: clamp(recruiter),
    technical: clamp(technical),
    accessibility: clamp(accessibility),
    projects: clamp(projects),
    security: clamp(security),
  };
  const overallScore = clamp(
    scores.recruiter * 0.28 + scores.technical * 0.22 + scores.accessibility * 0.18 + scores.projects * 0.22 + scores.security * 0.1,
  );

  if (scores.technical >= 80) add("technical", "positive", "Base technique solide", "Le site répond correctement et présente de bons fondamentaux techniques.");
  if (scores.projects >= 80) add("projects", "positive", "Projets bien mis en avant", "Les réalisations et leurs preuves sont faciles à identifier.");

  const recommendations: Recommendation[] = findings
    .filter((finding) => finding.severity !== "positive")
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
    .slice(0, 5)
    .map((finding) => ({
      title: finding.title,
      detail: finding.detail,
      impact: finding.severity === "high" ? "Fort" : finding.severity === "medium" ? "Moyen" : "Faible",
    }));

  return { scores, overallScore, findings, recommendations };
}

function severityRank(severity: Finding["severity"]) {
  return { high: 0, medium: 1, low: 2, positive: 3 }[severity];
}

export function buildFallbackSummary(score: number, hostname: string) {
  if (score >= 85) return `${hostname} inspire confiance et rend les compétences faciles à vérifier. Quelques finitions peuvent encore renforcer l’impact.`;
  if (score >= 70) return `${hostname} possède une base convaincante, mais plusieurs signaux importants peuvent être rendus plus évidents pour un recruteur pressé.`;
  if (score >= 50) return `${hostname} présente ton travail, mais manque encore de preuves et de hiérarchie pour convertir une visite rapide en prise de contact.`;
  return `${hostname} gagnerait à clarifier immédiatement ton positionnement, tes meilleurs projets et la manière de te contacter.`;
}

export function emptyAudit(overrides: Partial<AuditResult> = {}): AuditResult {
  return {
    id: "demo",
    url: "https://portfolio.example",
    hostname: "portfolio.example",
    createdAt: new Date().toISOString(),
    overallScore: 0,
    scores: { recruiter: 0, technical: 0, accessibility: 0, projects: 0, security: 0 },
    summary: "",
    verdict: "",
    findings: [],
    recommendations: [],
    signals: {} as PageSignals,
    aiEnhanced: false,
    ...overrides,
  };
}
