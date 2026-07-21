import type { PageSignals, PositioningAnalysis } from "./types";

type TaxonomyItem = { label: string; keywords: string[] };

const roles: TaxonomyItem[] = [
  { label: "Développeur frontend", keywords: ["frontend", "front-end", "react", "next.js", "nextjs", "vue.js", "vuejs", "angular", "interface web", "ui developer"] },
  { label: "Développeur backend", keywords: ["backend", "back-end", "api", "microservices", "django", "laravel", "spring boot", "node.js", "base de données"] },
  { label: "Développeur full-stack", keywords: ["full-stack", "full stack", "fullstack", "mern", "mean stack"] },
  { label: "Développeur mobile", keywords: ["mobile developer", "développeur mobile", "react native", "flutter", "android", "swift", "kotlin", "ios"] },
  { label: "Data & intelligence artificielle", keywords: ["data scientist", "data engineer", "machine learning", "intelligence artificielle", "artificial intelligence", "deep learning", "llm", "computer vision"] },
  { label: "DevOps & cloud", keywords: ["devops", "cloud engineer", "cloud architect", "kubernetes", "terraform", "infrastructure as code", "ci/cd", "platform engineer"] },
  { label: "Cybersécurité", keywords: ["cybersécurité", "cybersecurity", "pentest", "security engineer", "sécurité informatique", "soc analyst"] },
  { label: "Product designer / UX", keywords: ["product designer", "ux designer", "ui/ux", "user experience", "design system", "user research", "figma"] },
  { label: "Product / project manager", keywords: ["product manager", "project manager", "chef de projet", "product owner", "roadmap", "gestion de projet"] },
];

const sectors: TaxonomyItem[] = [
  { label: "SaaS B2B", keywords: ["saas", "b2b", "crm", "erp", "dashboard", "tableau de bord", "outil métier", "subscription platform"] },
  { label: "E-commerce & retail", keywords: ["e-commerce", "ecommerce", "marketplace", "boutique en ligne", "shopping", "checkout", "retail", "panier"] },
  { label: "Fintech & finance", keywords: ["fintech", "finance", "banking", "banque", "paiement", "payment", "trading", "comptabilité", "assurance"] },
  { label: "Santé & medtech", keywords: ["santé", "healthcare", "medical", "médical", "clinique", "patient", "medtech", "pharma"] },
  { label: "Éducation & edtech", keywords: ["edtech", "éducation", "education", "e-learning", "learning platform", "formation", "école", "étudiant"] },
  { label: "Transport & logistique", keywords: ["logistique", "logistics", "transport", "livraison", "delivery", "mobilité", "fleet", "shipping"] },
  { label: "Immobilier", keywords: ["immobilier", "real estate", "property", "logement", "housing"] },
  { label: "Voyage & hospitalité", keywords: ["travel", "voyage", "tourisme", "hospitality", "hôtel", "hotel", "réservation", "booking"] },
  { label: "Média & industries créatives", keywords: ["media", "média", "streaming", "music", "musique", "photographie", "creative industry", "entertainment"] },
  { label: "Secteur public & impact", keywords: ["secteur public", "government", "gouvernement", "mairie", "administration", "ngo", "ong", "association", "humanitaire"] },
  { label: "Industrie & IoT", keywords: ["industrie", "industrial", "manufacturing", "iot", "internet of things", "usine", "automation"] },
  { label: "Data & IA", keywords: ["artificial intelligence", "intelligence artificielle", "machine learning", "data platform", "analytics platform", "llm", "generative ai"] },
  { label: "Cybersécurité", keywords: ["cybersecurity", "cybersécurité", "security platform", "pentest", "fraud detection", "détection de fraude"] },
];

const technologies: Array<[string, string[]]> = [
  ["React", ["react", "next.js", "nextjs"]], ["Vue", ["vue.js", "vuejs", "nuxt"]], ["Angular", ["angular"]],
  ["TypeScript", ["typescript"]], ["JavaScript", ["javascript"]], ["Node.js", ["node.js", "nodejs"]],
  ["Python", ["python", "django", "fastapi"]], ["PHP", ["php", "laravel", "symfony"]],
  ["Java", ["java", "spring boot"]], ["Flutter", ["flutter"]], ["React Native", ["react native"]],
  ["Cloud", ["cloudflare", "aws", "azure", "google cloud", "gcp"]], ["DevOps", ["docker", "kubernetes", "terraform", "ci/cd"]],
  ["Data / IA", ["machine learning", "data science", "intelligence artificielle", "artificial intelligence", "llm"]],
  ["UX/UI", ["figma", "user research", "design system", "ui/ux"]],
];

function normalized(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function hasKeyword(corpus: string, keyword: string) {
  const target = normalized(keyword);
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(corpus);
}

function rank(corpus: string, taxonomy: TaxonomyItem[], multiplier = 1) {
  return taxonomy.map((item) => {
    const matches = item.keywords.filter((keyword) => hasKeyword(corpus, keyword));
    return { ...item, matches, score: matches.length * multiplier };
  }).sort((left, right) => right.score - left.score || left.label.localeCompare(right.label));
}

function topLabel(items: ReturnType<typeof rank>, fallback: string) {
  return items[0]?.score > 0 ? items[0].label : fallback;
}

function relatedRoles(first: string, second: string) {
  const groups = [
    ["Développeur frontend", "Développeur full-stack", "Product designer / UX"],
    ["Développeur backend", "Développeur full-stack", "DevOps & cloud", "Data & intelligence artificielle"],
    ["Product designer / UX", "Product / project manager"],
  ];
  return groups.some((group) => group.includes(first) && group.includes(second));
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function evidenceFragments(signals: PageSignals, keywords: string[]) {
  const fragments = [...(signals.projectSamples || []), ...(signals.contentSample || "").split(/\n|(?<=[.!?])\s+/)]
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter((value) => value.length >= 24 && value.length <= 280);
  return unique(fragments.filter((fragment) => keywords.some((keyword) => hasKeyword(normalized(fragment), keyword))).slice(0, 4));
}

export function analyzePositioningFallback(signals: PageSignals): PositioningAnalysis {
  const declaredText = [signals.title, signals.description, ...(signals.h1 || [])].join(" ");
  const projectText = (signals.projectSamples || []).join(" ") || signals.contentSample || "";
  const fullText = [declaredText, signals.contentSample || "", projectText].join(" ");
  const declaredRanking = rank(normalized(declaredText), roles, 3);
  const demonstratedRanking = rank(normalized(projectText), roles, 3).map((item) => ({
    ...item,
    score: item.score + (rank(normalized(fullText), roles).find((candidate) => candidate.label === item.label)?.score || 0),
  })).sort((left, right) => right.score - left.score);
  const sectorRanking = rank(normalized(projectText), sectors, 3).map((item) => ({
    ...item,
    score: item.score + (rank(normalized(fullText), sectors).find((candidate) => candidate.label === item.label)?.score || 0),
  })).sort((left, right) => right.score - left.score);

  const unknownRole = "Positionnement non précisé";
  const unknownSector = "Secteur non déterminé";
  const declaredRole = topLabel(declaredRanking, unknownRole);
  const demonstratedRole = topLabel(demonstratedRanking, unknownRole);
  const primarySector = topLabel(sectorRanking, unknownSector);
  const secondarySectors = sectorRanking.filter((item, index) => index > 0 && item.score >= 3).slice(0, 2).map((item) => item.label);
  const bothKnown = declaredRole !== unknownRole && demonstratedRole !== unknownRole;
  const alignmentScore = !bothKnown ? (declaredRole === demonstratedRole ? 45 : 52) : declaredRole === demonstratedRole ? 88 : relatedRoles(declaredRole, demonstratedRole) ? 68 : 42;
  const winningKeywords = unique([
    ...(demonstratedRanking[0]?.matches || []),
    ...(sectorRanking[0]?.matches || []),
  ]);
  const evidence = evidenceFragments(signals, winningKeywords);
  if (!evidence.length && signals.title) evidence.push(`Titre observé : ${signals.title.slice(0, 180)}`);
  const expertise = technologies.filter(([, keywords]) => keywords.some((keyword) => hasKeyword(normalized(fullText), keyword))).map(([label]) => label).slice(0, 6);
  if (!expertise.length && demonstratedRole !== unknownRole) expertise.push(demonstratedRole);

  const signalStrength = (demonstratedRanking[0]?.score || 0) + (sectorRanking[0]?.score || 0);
  const confidence = demonstratedRole === unknownRole && primarySector === unknownSector
    ? 25
    : Math.min(92, 32 + Math.min(35, signalStrength * 3) + Math.min(15, evidence.length * 4) + ((signals.projectSamples?.length || 0) > 0 ? 10 : 0));
  const gaps: string[] = [];
  const recommendations: string[] = [];
  if (declaredRole === unknownRole) {
    gaps.push("Le rôle recherché n’est pas formulé assez explicitement dans le titre ou la présentation.");
    recommendations.push("Annonce clairement le rôle visé dès le premier écran.");
  }
  if (demonstratedRole === unknownRole) {
    gaps.push("Les projets ne fournissent pas assez de matière pour identifier une expertise dominante.");
    recommendations.push("Décris pour chaque projet le problème, ta contribution, la stack et le résultat.");
  }
  if (primarySector === unknownSector) {
    gaps.push("Aucun secteur d’activité dominant ne ressort avec suffisamment de confiance.");
    recommendations.push("Précise le contexte métier ou le type de client de tes projets principaux.");
  }
  if (bothKnown && alignmentScore < 60) {
    gaps.push(`Le rôle annoncé (${declaredRole}) et les preuves visibles (${demonstratedRole}) racontent deux histoires différentes.`);
    recommendations.push("Mets en premier les projets qui prouvent directement le positionnement que tu veux vendre.");
  }
  if (evidence.length < 2) {
    gaps.push("Le positionnement repose encore sur peu de preuves textuelles vérifiables.");
    recommendations.push("Ajoute des résultats mesurables et le secteur de chaque réalisation.");
  }

  const summary = primarySector === unknownSector
    ? `${demonstratedRole === unknownRole ? "Aucune expertise dominante" : demonstratedRole} ressort, mais le secteur ciblé reste difficile à établir à partir des preuves visibles.`
    : `${demonstratedRole} ressort principalement dans un contexte ${primarySector}. L’alignement avec le rôle annoncé est estimé à ${alignmentScore}/100.`;

  return {
    declaredRole,
    demonstratedRole,
    primarySector,
    secondarySectors,
    expertise,
    alignmentScore,
    confidence,
    summary,
    evidence: evidence.slice(0, 4),
    gaps: unique(gaps).slice(0, 4),
    recommendations: unique(recommendations).slice(0, 4),
    source: "deterministic",
  };
}
