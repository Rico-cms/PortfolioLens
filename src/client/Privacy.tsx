import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { openCookieSettings, readConsent, saveConsent, trackEvent, trackPageView, type ConsentChoice } from "./analytics";

export function AnalyticsTracker({ pathname }: { pathname: string }) {
  useEffect(() => {
    if (pathname === "/admin") return undefined;
    const send = () => trackPageView(pathname);
    send();
    window.addEventListener("portfoliolens:consent", send);
    return () => window.removeEventListener("portfoliolens:consent", send);
  }, [pathname]);
  return null;
}

export function CookieConsent() {
  const [choice, setChoice] = useState<ConsentChoice | null>(() => readConsent());
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const open = () => setEditing(true);
    window.addEventListener("portfoliolens:cookie-settings", open);
    return () => window.removeEventListener("portfoliolens:cookie-settings", open);
  }, []);

  if (choice && !editing) return null;

  const choose = (next: ConsentChoice) => {
    saveConsent(next);
    setChoice(next);
    setEditing(false);
    if (next === "accepted") trackEvent("consent_granted");
  };

  return (
    <section className="cookie-banner" role="dialog" aria-modal="false" aria-labelledby="cookie-title">
      <div>
        <span className="cookie-kicker">Ta vie privée, clairement</span>
        <h2 id="cookie-title">PortfolioLens utilise deux cookies propriétaires.</h2>
        <p>Avec ton accord, ils nous aident à compter les visites et à comprendre quelles pages sont utiles. Aucune publicité, aucune adresse IP conservée et aucun partage avec un tiers. <a href="/privacy">Voir le détail</a>.</p>
      </div>
      <div className="cookie-actions">
        <button type="button" onClick={() => choose("declined")}>Tout refuser</button>
        <button type="button" onClick={() => choose("accepted")}>Tout accepter</button>
        {editing && choice && <button className="cookie-cancel" type="button" onClick={() => setEditing(false)}>Annuler</button>}
      </div>
    </section>
  );
}

export function CookieSettingsButton() {
  return <button className="footer-cookie-button" type="button" onClick={openCookieSettings}>Gérer mes cookies</button>;
}

export function PrivacyPage({ header, footer }: { header: ReactNode; footer: ReactNode }) {
  return (
    <>
      {header}
      <main className="privacy-page">
        <div className="privacy-hero">
          <span className="section-kicker">Données & confidentialité</span>
          <h1>Des statistiques utiles.<br /><em>Pas de surveillance.</em></h1>
          <p>PortfolioLens collecte le minimum nécessaire pour améliorer le service et produire des enseignements agrégés sur les portfolios développeurs.</p>
        </div>
        <div className="privacy-grid">
          <section>
            <span>01</span><h2>Ce que nous mesurons</h2>
            <p>Après accord : pages consultées, session pseudonyme, type d’appareil, langue du navigateur et pays approximatif fourni par Cloudflare. Les audits conservent aussi les scores et signaux techniques du portfolio soumis.</p>
          </section>
          <section>
            <span>02</span><h2>Ce que nous excluons</h2>
            <p>Nous ne stockons ni adresse IP, ni nom, ni e-mail, ni historique de navigation externe. Les identifiants analytics sont hachés avant leur enregistrement dans D1.</p>
          </section>
          <section>
            <span>03</span><h2>Durées de conservation</h2>
            <p>Le choix et l’identifiant de mesure durent 6 mois. Les événements analytics sont supprimés après 90 jours, les rapports détaillés après 30 jours et les observations anonymisées après 12 mois.</p>
          </section>
          <section>
            <span>04</span><h2>Les cookies utilisés</h2>
            <dl><div><dt>pl_consent</dt><dd>Mémorise accepter ou refuser · 6 mois</dd></div><div><dt>pl_visitor</dt><dd>Mesure d’audience propriétaire · 6 mois · seulement après accord</dd></div><div><dt>pl_admin</dt><dd>Session sécurisée de l’administrateur · 12 heures</dd></div></dl>
          </section>
        </div>
        <section className="privacy-control">
          <div><span className="section-kicker">Ton choix reste réversible</span><h2>Tu peux retirer ton accord à tout moment.</h2><p>Le refus n’empêche jamais d’utiliser l’audit. Il désactive uniquement la mesure d’audience.</p></div>
          <button type="button" onClick={openCookieSettings}>Gérer mes cookies</button>
        </section>
      </main>
      {footer}
    </>
  );
}
