import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AdminDashboardData, ScoreKey } from "../shared/types";

const scoreLabels: Record<ScoreKey, string> = {
  recruiter: "Clarté recruteur",
  technical: "Qualité technique",
  accessibility: "Accessibilité",
  projects: "Preuves & projets",
  security: "Sécurité",
};

const numberFormat = new Intl.NumberFormat("fr-FR");

export function AdminPage({ logo }: { logo: ReactNode }) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [dashboard, setDashboard] = useState<AdminDashboardData | null>(null);
  const [days, setDays] = useState(30);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const loadDashboard = useCallback(async (period: number) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/dashboard?days=${period}`, { credentials: "same-origin" });
      if (response.status === 401) {
        setAuthenticated(false);
        setDashboard(null);
        return;
      }
      const body = await response.json() as { dashboard?: AdminDashboardData; error?: string };
      if (!response.ok || !body.dashboard) throw new Error(body.error || "Impossible de charger le tableau de bord.");
      setAuthenticated(true);
      setDashboard(body.dashboard);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible de charger le tableau de bord.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadDashboard(days); }, [days, loadDashboard]);

  if (authenticated === false) return <AdminLogin logo={logo} onSuccess={() => loadDashboard(days)} />;
  if (authenticated === null && loading) return <AdminShell logo={logo}><div className="admin-loading"><span className="spinner" /><p>Ouverture de ton espace…</p></div></AdminShell>;

  const logout = async () => {
    await fetch("/api/admin/logout", { method: "POST", credentials: "same-origin" });
    setAuthenticated(false);
    setDashboard(null);
  };

  return (
    <AdminShell logo={logo}>
      <div className="admin-toolbar">
        <div><span className="admin-kicker">Espace propriétaire</span><h1>Ce qui se passe<br /><em>sur PortfolioLens.</em></h1><p>Données agrégées, tendances et enseignements directement exploitables.</p></div>
        <div className="admin-toolbar-actions">
          <label>Période<select value={days} onChange={(event) => setDays(Number(event.target.value))}><option value="7">7 jours</option><option value="30">30 jours</option><option value="90">90 jours</option><option value="365">12 mois</option></select></label>
          <a href={`/api/admin/export.csv?days=${days}`}>↓ Export CSV complet</a>
          <button type="button" onClick={logout}>Se déconnecter</button>
        </div>
      </div>
      {error && <p className="admin-error" role="alert">{error} <button type="button" onClick={() => loadDashboard(days)}>Réessayer</button></p>}
      {dashboard && <DashboardContent dashboard={dashboard} loading={loading} />}
    </AdminShell>
  );
}

function AdminLogin({ logo, onSuccess }: { logo: ReactNode; onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Connexion impossible.");
      setPassword("");
      onSuccess();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Connexion impossible.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AdminShell logo={logo}>
      <main className="admin-login">
        <div className="admin-login-copy"><span className="admin-kicker">PortfolioLens · Admin</span><h1>Ton poste<br />d’observation.</h1><p>Consulte l’audience, les audits et les problèmes les plus fréquents sans exposer les visiteurs.</p></div>
        <form onSubmit={submit}>
          <span>Accès privé</span><h2>Bienvenue, Gabriel.</h2>
          <label htmlFor="admin-password">Mot de passe administrateur</label>
          <input id="admin-password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
          <button type="submit" disabled={loading}>{loading ? "Vérification…" : "Ouvrir le tableau de bord →"}</button>
          {error && <p role="alert">{error}</p>}
        </form>
      </main>
    </AdminShell>
  );
}

function AdminShell({ logo, children }: { logo: ReactNode; children: ReactNode }) {
  return <div className="admin-shell"><header><div>{logo}</div><a href="/">Voir le site ↗</a></header><main>{children}</main></div>;
}

function DashboardContent({ dashboard, loading }: { dashboard: AdminDashboardData; loading: boolean }) {
  const trendMax = useMemo(() => Math.max(1, ...dashboard.trend.flatMap((item) => [item.pageViews, item.audits])), [dashboard.trend]);
  const metricCards = [
    ["Visites", dashboard.totals.pageViews, "Pages vues avec consentement"],
    ["Visiteurs", dashboard.totals.uniqueVisitors, "Identifiants pseudonymisés"],
    ["Sessions", dashboard.totals.sessions, "Sessions mesurées"],
    ["Audits", dashboard.totals.audits, "Portfolios analysés"],
    ["Conversion", `${dashboard.totals.conversionRate}%`, "Audits par session"],
    ["Score moyen", `${dashboard.totals.averageScore}/100`, "Tous les audits de la période"],
  ] as const;

  return (
    <div className={loading ? "admin-dashboard admin-dashboard-loading" : "admin-dashboard"}>
      <section className="admin-metrics" aria-label="Indicateurs principaux">
        {metricCards.map(([label, value, detail]) => <article key={label}><span>{label}</span><strong>{typeof value === "number" ? numberFormat.format(value) : value}</strong><p>{detail}</p></article>)}
      </section>

      <section className="admin-panel admin-trend-panel">
        <div className="admin-panel-heading"><div><span>Audience & usage</span><h2>La dynamique des 30 derniers jours</h2></div><div className="chart-legend"><i /> Vues <i /> Audits</div></div>
        <div className="trend-chart" aria-label="Évolution quotidienne des vues et audits">
          {dashboard.trend.map((item) => <div className="trend-day" key={item.day} title={`${item.day} : ${item.pageViews} vues, ${item.audits} audits`}><div className="trend-bars"><i style={{ height: `${Math.max(2, (item.pageViews / trendMax) * 100)}%` }} /><b style={{ height: `${Math.max(2, (item.audits / trendMax) * 100)}%` }} /></div><span>{new Date(`${item.day}T00:00:00Z`).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}</span></div>)}
        </div>
      </section>

      <div className="admin-two-columns">
        <section className="admin-panel">
          <div className="admin-panel-heading"><div><span>Insight principal</span><h2>Ce qui manque le plus souvent</h2></div></div>
          {dashboard.commonIssues.length ? <div className="issue-list">{dashboard.commonIssues.slice(0, 8).map((issue, index) => <article key={issue.key}><span>{String(index + 1).padStart(2, "0")}</span><div><div><strong>{issue.label}</strong><b>{issue.percentage}%</b></div><i><span style={{ width: `${issue.percentage}%` }} /></i><p>{issue.count} portfolio{issue.count > 1 ? "s" : ""} sur {dashboard.totals.audits}</p></div></article>)}</div> : <EmptyState text="Les prochains audits feront apparaître les tendances." />}
        </section>

        <section className="admin-panel">
          <div className="admin-panel-heading"><div><span>Les cinq signaux</span><h2>Scores moyens</h2></div></div>
          <div className="average-scores">{(Object.entries(dashboard.scoreAverages) as [ScoreKey, number][]).map(([key, value]) => <div key={key}><span>{scoreLabels[key]}</span><i><b style={{ width: `${value}%` }} /></i><strong>{value}</strong></div>)}</div>
          <div className="admin-distributions">
            <Distribution title="Appareils" items={dashboard.devices} />
            <Distribution title="Pays" items={dashboard.countries} />
          </div>
        </section>
      </div>

      <section className="admin-panel positioning-overview">
        <div className="admin-panel-heading"><div><span>Cartographie professionnelle</span><h2>Ce que les portfolios cherchent à démontrer</h2></div><p>Secteurs et rôles probables, calculés uniquement lorsque des preuves suffisantes sont visibles.</p></div>
        <div className="positioning-admin-grid">
          <div className="positioning-admin-kpis">
            <article><span>Analyses enrichies</span><strong>{dashboard.positioning.analyzed}</strong><p>{dashboard.positioning.coverageRate}% des audits de la période</p></article>
            <article><span>Alignement moyen</span><strong>{dashboard.positioning.averageAlignment}/100</strong><p>Entre le rôle annoncé et les preuves détectées</p></article>
          </div>
          <div className="admin-distributions positioning-distributions">
            <Distribution title="Secteurs dominants" items={dashboard.positioning.topSectors} />
            <Distribution title="Rôles démontrés" items={dashboard.positioning.topRoles} />
          </div>
        </div>
      </section>

      <section className="admin-panel recent-audits">
        <div className="admin-panel-heading"><div><span>Historique</span><h2>Les 30 dernières analyses</h2></div><p>L’adresse et les scores sont conservés 12 mois pour suivre l’évolution d’un même portfolio.</p></div>
        {dashboard.recentAudits.length ? <div className="admin-table-wrap"><table><thead><tr><th>Portfolio</th><th>Passage</th><th>Date</th><th>Score</th><th>Évolution</th><th>Positionnement</th><th>Alignement</th><th>Rapport</th></tr></thead><tbody>{dashboard.recentAudits.map((audit) => <tr key={audit.id}><td><a className="portfolio-address" href={audit.url} target="_blank" rel="noreferrer"><strong>{audit.hostname}</strong><small>{audit.url}</small></a></td><td>#{audit.analysisCount}</td><td>{new Date(audit.createdAt).toLocaleDateString("fr-FR", { dateStyle: "medium" })}</td><td><b>{audit.overallScore}/100</b></td><td>{audit.scoreDelta === null ? <span className="score-delta score-delta-neutral">Premier passage</span> : <span className={`score-delta ${audit.scoreDelta > 0 ? "score-delta-up" : audit.scoreDelta < 0 ? "score-delta-down" : "score-delta-neutral"}`}>{audit.scoreDelta > 0 ? "+" : ""}{audit.scoreDelta} points</span>}</td><td><span className="positioning-cell"><strong>{audit.primarySector || "Non analysé"}</strong><small>{audit.demonstratedRole || "—"}{audit.positioningConfidence !== null ? ` · confiance ${audit.positioningConfidence}%` : ""}</small></span></td><td>{audit.alignmentScore !== null ? `${audit.alignmentScore}/100` : "—"}</td><td>{audit.reportAvailable ? <a href={`/report/${audit.id}`}>Ouvrir ↗</a> : <span className="report-expired">Détail expiré</span>}</td></tr>)}</tbody></table></div> : <EmptyState text="Aucune analyse enregistrée pour le moment." />}
      </section>
      <p className="admin-generated">Actualisé le {new Date(dashboard.generatedAt).toLocaleString("fr-FR")}. Les statistiques d’audience excluent les visiteurs ayant refusé les cookies.</p>
    </div>
  );
}

function Distribution({ title, items }: { title: string; items: Array<{ label: string; count: number; percentage: number }> }) {
  return <div><h3>{title}</h3>{items.length ? items.slice(0, 5).map((item) => <p key={item.label}><span>{item.label}</span><strong>{item.percentage}%</strong></p>) : <p><span>Pas encore de données</span></p>}</div>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="admin-empty"><span>＋</span><p>{text}</p></div>;
}
