import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { AuditResult, CreateAuditResponse, ScoreKey } from "../shared/types";

const scoreLabels: Record<ScoreKey, string> = {
  recruiter: "Clarté recruteur",
  technical: "Qualité technique",
  accessibility: "Indicateurs d’accessibilité",
  projects: "Preuves & projets",
  security: "Sécurité",
};

const wcagOverviewUrl = "https://www.w3.org/WAI/standards-guidelines/wcag/";

const creator = {
  name: "Gabriel Emrick Dahissiho",
  role: "IT Project Manager · Product Designer",
  portfolio: "https://bookemrick.online/",
  github: "https://github.com/Rico-cms",
};

const signalDefinitions: Record<ScoreKey, { question: string; description: string; criteria: string[] }> = {
  recruiter: {
    question: "Un recruteur comprend-il rapidement qui tu es et pourquoi te contacter ?",
    description: "Ce signal mesure la lisibilité de ton positionnement en quelques secondes : titre, présentation, contact et profils professionnels.",
    criteria: ["Titre de page précis et descriptif", "Présentation suffisamment claire", "Contact visible", "Liens GitHub et LinkedIn", "Contenu assez substantiel"],
  },
  technical: {
    question: "Le portfolio repose-t-il sur des fondamentaux web fiables ?",
    description: "Nous observons la réponse HTTP, le temps de chargement initial, HTTPS et la configuration mobile. Ce score n’est pas un remplacement de Core Web Vitals.",
    criteria: ["Page disponible sans erreur", "Réponse rapide du document", "Connexion HTTPS", "Viewport adapté au mobile"],
  },
  accessibility: {
    question: "Quels fondamentaux d’accessibilité sont détectables automatiquement dans le HTML ?",
    description: "Cet indicateur vérifie une sélection limitée de signaux techniques liés aux WCAG 2.2. Il ne constitue ni un audit exhaustif ni une certification de conformité.",
    criteria: ["WCAG 3.1.1 (A) — Langue de la page déclarée", "WCAG 1.3.1 (A) — Structure et relations sémantiques", "WCAG 1.1.1 (A) — Alternatives textuelles des images", "Présence d’un titre H1 principal et de repères main/nav"],
  },
  projects: {
    question: "Tes compétences sont-elles soutenues par des preuves consultables ?",
    description: "Ce signal cherche des projets clairement identifiés, des liens vers des réalisations ou études de cas, ton GitHub et une présentation de ta stack.",
    criteria: ["Section projets explicite", "Au moins deux preuves ou démos", "Profil GitHub accessible", "Compétences ou technologies présentées", "Structure avec plusieurs sections"],
  },
  security: {
    question: "Le site applique-t-il les protections web essentielles ?",
    description: "Nous examinons les protections visibles dans la connexion et les en-têtes HTTP. Une note basse ne signifie pas automatiquement qu’une vulnérabilité est exploitable.",
    criteria: ["HTTPS actif", "Content-Security-Policy", "Protection contre l’intégration en iframe", "Referrer-Policy"],
  },
};

function signalFacts(key: ScoreKey, audit: AuditResult) {
  const s = audit.signals;
  const facts: Record<ScoreKey, { label: string; value: string; good: boolean }[]> = {
    recruiter: [
      { label: "Titre", value: s.title || "Absent", good: s.title.length >= 15 && s.title.length <= 65 },
      { label: "Description", value: s.description ? `${s.description.length} caractères` : "Absente", good: s.description.length >= 80 },
      { label: "Contact", value: s.hasContact ? "Détecté" : "Non détecté", good: s.hasContact },
      { label: "Profils", value: [s.hasGithub && "GitHub", s.hasLinkedin && "LinkedIn"].filter(Boolean).join(" + ") || "Non détectés", good: s.hasGithub || s.hasLinkedin },
    ],
    technical: [
      { label: "Réponse HTTP", value: String(s.statusCode), good: s.statusCode >= 200 && s.statusCode < 400 },
      { label: "Temps initial", value: `${s.loadTimeMs} ms`, good: s.loadTimeMs < 2000 },
      { label: "HTTPS", value: s.usesHttps ? "Actif" : "Absent", good: s.usesHttps },
      { label: "Viewport mobile", value: s.hasViewport ? "Présent" : "Absent", good: s.hasViewport },
    ],
    accessibility: [
      { label: "Langue", value: s.lang || "Non déclarée", good: Boolean(s.lang) },
      { label: "Titres H1", value: String(s.h1.length), good: s.h1.length === 1 },
      { label: "Structure", value: [s.hasMain && "main", s.hasNav && "nav"].filter(Boolean).join(" + ") || "Non détectée", good: s.hasMain && s.hasNav },
      { label: "Images sans alt", value: `${s.missingAltCount} sur ${s.imageCount}`, good: s.missingAltCount === 0 },
    ],
    projects: [
      { label: "Section projets", value: s.hasProjects ? "Détectée" : "Non détectée", good: s.hasProjects },
      { label: "Liens de preuve", value: String(s.projectLinkCount), good: s.projectLinkCount >= 2 },
      { label: "GitHub", value: s.hasGithub ? "Détecté" : "Non détecté", good: s.hasGithub },
      { label: "Stack technique", value: s.hasSkills ? "Présentée" : "Non détectée", good: s.hasSkills },
    ],
    security: [
      { label: "HTTPS", value: s.usesHttps ? "Actif" : "Absent", good: s.usesHttps },
      { label: "CSP", value: s.hasCsp ? "Présente" : "Absente", good: s.hasCsp },
      { label: "Anti-iframe", value: s.hasFrameProtection ? "Présent" : "Absent", good: s.hasFrameProtection },
      { label: "Referrer-Policy", value: s.hasReferrerPolicy ? "Présente" : "Absente", good: s.hasReferrerPolicy },
    ],
  };
  return facts[key];
}

function SignalDetail({ signal, audit, printable = false }: { signal: ScoreKey; audit: AuditResult; printable?: boolean }) {
  const definition = signalDefinitions[signal];
  const relatedFindings = audit.findings.filter((finding) => finding.category === signal);
  return (
    <article id={printable ? undefined : `signal-detail-${signal}`} className={`signal-detail ${printable ? "signal-detail-printable" : ""}`}>
      <div className="signal-detail-head">
        <div><span>Comprendre le score</span><h3>{scoreLabels[signal]} · {audit.scores[signal]}/100</h3></div>
        <p>{definition.question}</p>
      </div>
      <p className="signal-description">{definition.description}</p>
      {signal === "accessibility" && <div className="scope-warning" role="note"><strong>Portée limitée</strong><span>Un résultat de 100/100 signifie uniquement que les signaux automatisés ci-dessous ont été détectés. Le contraste, la navigation au clavier, l’ordre du focus, les formulaires et l’expérience avec les technologies d’assistance demandent encore une vérification humaine.</span></div>}
      <div className="fact-grid">
        {signalFacts(signal, audit).map((fact) => <div key={fact.label}><i className={fact.good ? "fact-good" : "fact-missing"} /> <span>{fact.label}</span><strong>{fact.value}</strong></div>)}
      </div>
      <div className="signal-explanation-grid">
        <div><h4>Critères pris en compte</h4><ul>{definition.criteria.map((criterion) => <li key={criterion}>{criterion}</li>)}</ul></div>
        <div><h4>Ce qui explique cette note</h4>{relatedFindings.length ? <ul>{relatedFindings.map((finding) => <li key={finding.title}>{finding.title} — {finding.detail}</li>)}</ul> : <p>Aucun problème important n’a été détecté pour ce signal.</p>}</div>
      </div>
    </article>
  );
}

function scoreStatus(key: ScoreKey, score: number) {
  if (key === "accessibility") return score >= 80 ? "Signaux détectés" : score >= 60 ? "Signaux à renforcer" : "Vérification prioritaire";
  return score >= 80 ? "Très solide" : score >= 60 ? "À renforcer" : "Prioritaire";
}

function WcagMethodology() {
  return (
    <section className="wcag-methodology" aria-labelledby="wcag-methodology-title">
      <div className="wcag-intro">
        <span className="section-kicker">Méthodologie d’accessibilité</span>
        <h2 id="wcag-methodology-title">Des indicateurs utiles,<br /><em>pas une certification.</em></h2>
        <p>PortfolioLens s’appuie sur les WCAG 2.2 comme cadre de référence. Une conformité WCAG se détermine sur des critères de succès testables, aux niveaux A, AA et AAA, et ne peut pas être conclue à partir de quatre contrôles automatiques.</p>
        <a href={wcagOverviewUrl} target="_blank" rel="noreferrer">Consulter la référence officielle W3C <span>↗</span></a>
      </div>
      <div className="wcag-columns">
        <article>
          <span>Contrôles automatisés</span>
          <h3>Ce que PortfolioLens observe</h3>
          <ul>
            <li><b>1.1.1 · Niveau A</b><small>Présence d’alternatives textuelles sur les images.</small></li>
            <li><b>1.3.1 · Niveau A</b><small>Structure sémantique : titres et repères principaux.</small></li>
            <li><b>3.1.1 · Niveau A</b><small>Langue principale déclarée dans le document.</small></li>
          </ul>
        </article>
        <article>
          <span>Revue humaine nécessaire</span>
          <h3>Ce que le score ne valide pas</h3>
          <ul>
            <li><b>1.4.3 · Niveau AA</b><small>Contraste réel du texte et des composants.</small></li>
            <li><b>2.1.1 · Niveau A</b><small>Utilisation complète au clavier.</small></li>
            <li><b>2.4.7 · Niveau AA</b><small>Visibilité et cohérence du focus.</small></li>
          </ul>
        </article>
      </div>
    </section>
  );
}

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: { sitekey: string; callback: (token: string) => void; "expired-callback": () => void; theme: string }) => string;
      remove: (widgetId: string) => void;
      reset: (widgetId?: string) => void;
    };
  }
}

let turnstileLoader: Promise<void> | null = null;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve();
  if (!turnstileLoader) turnstileLoader = new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () => resolve();
    document.head.appendChild(script);
  });
  return turnstileLoader;
}

function Turnstile({ onToken }: { onToken: (token: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let widgetId: string | undefined;
    let active = true;
    fetch("/api/config").then((response) => response.json()).then(async (config: { turnstileSiteKey?: string | null }) => {
      if (!config.turnstileSiteKey || !container.current) return;
      await loadTurnstile();
      if (active && container.current && window.turnstile) widgetId = window.turnstile.render(container.current, {
        sitekey: config.turnstileSiteKey,
        callback: onToken,
        "expired-callback": () => onToken(""),
        theme: "light",
      });
    }).catch(() => undefined);
    return () => { active = false; if (widgetId) window.turnstile?.remove(widgetId); };
  }, [onToken]);
  return <div className="turnstile-container" ref={container} />;
}

function Logo() {
  return <a className="logo" href="/" aria-label="PortfolioLens, accueil"><span className="logo-mark">P</span><span>Portfolio<span>Lens</span></span></a>;
}

function ArrowIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M11 6l4 4-4 4" /></svg>;
}

function SparkIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c.6 5.4 3.5 8.4 9 9-5.5.6-8.4 3.6-9 9-.6-5.4-3.5-8.4-9-9 5.5-.6 8.4-3.6 9-9Z" /></svg>;
}

function ScoreRing({ score, large = false }: { score: number; large?: boolean }) {
  const color = score >= 80 ? "#b9f35b" : score >= 60 ? "#f4c75f" : "#ff7b69";
  return (
    <div className={`score-ring ${large ? "score-ring-large" : ""}`} style={{ "--score": score, "--ring-color": color } as React.CSSProperties}>
      <div><strong>{score}</strong><span>/100</span></div>
    </div>
  );
}

function Header() {
  return (
    <header className="site-header">
      <Logo />
      <nav aria-label="Navigation principale">
        <a href="#fonctionnement">Fonctionnement</a>
        <a href="#criteres">Critères</a>
        <a href="#createur">Le créateur</a>
        <a className="nav-cta" href="#audit">Analyser mon portfolio</a>
      </nav>
    </header>
  );
}

function CreatorSection({ compact = false }: { compact?: boolean }) {
  return (
    <section className={`creator-section ${compact ? "creator-section-compact" : ""}`} id="createur">
      <div className="creator-monogram" aria-hidden="true"><span>GE</span><i /></div>
      <div className="creator-story">
        <span className="section-kicker">Derrière PortfolioLens</span>
        <h2>Conçu par<br /><em>Gabriel Emrick.</em></h2>
        <p>IT Project Manager et Product Designer basé à Abidjan, Gabriel transforme des idées complexes en produits, interfaces et systèmes plus clairs.</p>
        <p>PortfolioLens est né d’une conviction simple : un bon portfolio ne doit pas seulement être beau. Il doit aider un recruteur à comprendre rapidement une valeur, vérifier des preuves et savoir pourquoi prendre contact.</p>
        <div className="creator-links">
          <a href={creator.portfolio} target="_blank" rel="noreferrer">Voir mon portfolio <span>↗</span></a>
          <a href={creator.github} target="_blank" rel="noreferrer">Explorer mon GitHub <span>↗</span></a>
        </div>
      </div>
      <aside className="creator-meta">
        <div><span>Nom</span><strong>{creator.name}</strong></div>
        <div><span>Rôle</span><strong>{creator.role}</strong></div>
        <div><span>Basé à</span><strong>Abidjan, Côte d’Ivoire</strong></div>
        <div><span>Approche</span><strong>Stratégie · Design · Produit</strong></div>
      </aside>
    </section>
  );
}

function AuditForm({ initialUrl = "" }: { initialUrl?: string }) {
  const [url, setUrl] = useState(initialUrl);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/audits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, turnstileToken }),
      });
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) throw new Error("L’API d’audit n’est pas démarrée. Utilise npm run dev:local.");
      const body = (await response.json()) as CreateAuditResponse | { error: string };
      if (!response.ok || !("audit" in body)) throw new Error("error" in body ? body.error : "L’analyse a échoué.");
      window.history.pushState({}, "", `/report/${body.audit.id}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible d’analyser ce site.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="audit-form" onSubmit={submit} id="audit">
      <label htmlFor="portfolio-url">Adresse de ton portfolio</label>
      <div className="url-row">
        <span className="url-prefix">↗</span>
        <input id="portfolio-url" type="url" required placeholder="https://tonportfolio.dev" value={url} onChange={(event) => setUrl(event.target.value)} />
        <button type="submit" disabled={loading}>
          {loading ? <><span className="spinner" /> Analyse en cours…</> : <>Lancer l’audit <ArrowIcon /></>}
        </button>
      </div>
      <div className="form-meta">
        <span><i /> Gratuit · Aucun compte requis</span>
        <span>Analyse généralement terminée en moins de 30 secondes</span>
      </div>
      <Turnstile onToken={setTurnstileToken} />
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  );
}

function Home() {
  return (
    <>
      <Header />
      <main>
        <section className="hero">
          <div className="eyebrow"><SparkIcon /> L’audit pensé pour les portfolios développeurs</div>
          <h1>Ton portfolio convainc-il<br />en <em>30 secondes</em> ?</h1>
          <p className="hero-copy">Obtiens un diagnostic concret de ce qu’un recruteur comprend, vérifie et retient — avant même ton prochain entretien.</p>
          <AuditForm />
          <div className="proof-line"><span>Analyse propulsée par</span><b>☁ Cloudflare</b><b>Workers AI</b><b>Browser Run</b></div>
        </section>

        <section className="criteria" id="criteres">
          <div className="section-heading">
            <span>Ce que nous vérifions</span>
            <h2>Plus qu’un simple score.<br /><em>Des preuves actionnables.</em></h2>
          </div>
          <div className="criteria-grid">
            <article><span>01</span><h3>Lecture recruteur</h3><p>Ton rôle, ta valeur et ton niveau sont-ils évidents dès le premier écran ?</p></article>
            <article><span>02</span><h3>Preuves & projets</h3><p>Tes réalisations racontent-elles le problème, ta contribution et le résultat ?</p></article>
            <article><span>03</span><h3>Qualité technique</h3><p>Structure, vitesse, mobile et métadonnées : les fondamentaux sont-ils solides ?</p></article>
            <article><span>04</span><h3>Indicateurs d’accessibilité</h3><p>Quels fondamentaux WCAG 2.2 peut-on vérifier automatiquement dans la page ?</p></article>
          </div>
        </section>

        <section className="process" id="fonctionnement">
          <div><span className="section-kicker">Simple, rapide, vérifiable</span><h2>Un regard neuf sur<br />ton meilleur argument.</h2></div>
          <ol>
            <li><b>1</b><div><h3>Nous ouvrons ton site</h3><p>Un vrai navigateur charge la page comme le ferait un visiteur.</p></div></li>
            <li><b>2</b><div><h3>Nous mesurons les signaux</h3><p>Contenu, structure, preuves, accessibilité et en-têtes de sécurité.</p></div></li>
            <li><b>3</b><div><h3>Tu repars avec un plan</h3><p>Les améliorations sont classées par impact, sans jargon inutile.</p></div></li>
          </ol>
        </section>
        <CreatorSection />
      </main>
      <footer><Logo /><p>Construit à l’edge, avec soin.</p><span>© {new Date().getFullYear()}</span></footer>
    </>
  );
}

function Report({ id }: { id: string }) {
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [error, setError] = useState("");
  const [selectedSignal, setSelectedSignal] = useState<ScoreKey | null>(null);
  useEffect(() => {
    fetch(`/api/audits/${encodeURIComponent(id)}`).then(async (response) => {
      if (!response.ok) throw new Error("Rapport introuvable.");
      const body = await response.json() as { audit: AuditResult };
      setAudit(body.audit);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Rapport introuvable."));
  }, [id]);

  const date = useMemo(() => audit ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" }).format(new Date(audit.createdAt)) : "", [audit]);
  if (error) return <><Header /><main className="report-state"><h1>{error}</h1><a className="button-link" href="/">Lancer un nouvel audit</a></main></>;
  if (!audit) return <><Header /><main className="report-state"><span className="spinner spinner-dark" /><p>Chargement du rapport…</p></main></>;

  const exportPdf = () => {
    const originalTitle = document.title;
    document.title = `Audit-PortfolioLens-${audit.hostname}`;
    window.print();
    window.setTimeout(() => { document.title = originalTitle; }, 500);
  };

  return (
    <>
      <Header />
      <main className="report-page">
        <div className="report-topline">
          <a href="/">← Nouvel audit</a>
          <div><button onClick={() => navigator.clipboard.writeText(location.href)}>Copier le lien</button><button className="pdf-button" onClick={exportPdf}>↓ Exporter en PDF</button></div>
        </div>
        <section className="report-hero">
          <div>
            <span className="report-label">Rapport PortfolioLens</span>
            <h1>{audit.hostname}</h1>
            <a href={audit.url} target="_blank" rel="noreferrer">{audit.url} ↗</a>
            <p>Analysé le {date}</p>
          </div>
          <ScoreRing score={audit.overallScore} large />
        </section>

        <section className="verdict-card">
          <div className="verdict-icon"><SparkIcon /></div>
          <div><span>Le verdict</span><h2>{audit.verdict}</h2><p>{audit.summary}</p></div>
          {audit.aiEnhanced && <span className="ai-badge">Enrichi par l’IA</span>}
        </section>

        <section className="score-section">
          <div className="section-title-row"><div><span>Vue d’ensemble</span><h2>Les cinq signaux décisifs</h2></div><p>Chaque score repose sur des éléments observables dans la page.</p></div>
          <div className="score-grid">
            {(Object.entries(audit.scores) as [ScoreKey, number][]).map(([key, score]) => (
              <article key={key} className={selectedSignal === key ? "score-card-active" : ""}>
                <button type="button" aria-expanded={selectedSignal === key} aria-controls={`signal-detail-${key}`} onClick={() => setSelectedSignal(selectedSignal === key ? null : key)}>
                  <ScoreRing score={score} /><h3>{scoreLabels[key]}</h3><p>{scoreStatus(key, score)}</p><span className="detail-link">{selectedSignal === key ? "Fermer" : "Voir le détail"} {selectedSignal === key ? "↑" : "↓"}</span>
                </button>
              </article>
            ))}
          </div>
          {selectedSignal && <SignalDetail signal={selectedSignal} audit={audit} />}
        </section>

        <WcagMethodology />

        <section className="pdf-signal-details">
          <h2>Détail des cinq signaux décisifs</h2>
          {(Object.keys(scoreLabels) as ScoreKey[]).map((key) => <SignalDetail key={key} signal={key} audit={audit} printable />)}
        </section>

        <section className="recommendations">
          <div className="section-title-row"><div><span>Plan d’action</span><h2>Les prochaines améliorations</h2></div><p>Commence par le premier point : la liste est déjà classée par impact.</p></div>
          <div className="recommendation-list">
            {audit.recommendations.map((item, index) => (
              <article key={`${item.title}-${index}`}>
                <span className="rec-number">{String(index + 1).padStart(2, "0")}</span>
                <div><h3>{item.title}</h3><p>{item.detail}</p></div>
                <span className={`impact impact-${item.impact.toLowerCase()}`}>Impact {item.impact}</span>
              </article>
            ))}
          </div>
        </section>

        <section className="signals-section">
          <div><span>Données observées</span><h2>Un audit transparent</h2><p>PortfolioLens sépare les observations techniques de l’interprétation générée.</p></div>
          <dl>
            <div><dt>Temps de réponse</dt><dd>{audit.signals.loadTimeMs} ms</dd></div>
            <div><dt>Titres H1</dt><dd>{audit.signals.h1.length}</dd></div>
            <div><dt>Images sans alt</dt><dd>{audit.signals.missingAltCount}/{audit.signals.imageCount}</dd></div>
            <div><dt>Liens détectés</dt><dd>{audit.signals.linkCount}</dd></div>
            <div><dt>HTTPS</dt><dd>{audit.signals.usesHttps ? "Oui" : "Non"}</dd></div>
            <div><dt>Content Security Policy</dt><dd>{audit.signals.hasCsp ? "Présente" : "Absente"}</dd></div>
          </dl>
        </section>
        <div className="report-cta"><h2>Une autre version à tester ?</h2><AuditForm initialUrl={audit.url} /></div>
        <CreatorSection compact />
      </main>
      <footer><Logo /><p>Construit à l’edge, avec soin.</p><span>© {new Date().getFullYear()}</span></footer>
    </>
  );
}

export default function App() {
  const [, setPath] = useState(location.pathname);
  useEffect(() => {
    const update = () => setPath(location.pathname);
    addEventListener("popstate", update);
    return () => removeEventListener("popstate", update);
  }, []);
  const match = location.pathname.match(/^\/report\/([^/]+)$/);
  return match ? <Report id={match[1]} /> : <Home />;
}
