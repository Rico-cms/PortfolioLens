# PortfolioLens

PortfolioLens audite un portfolio développeur comme le ferait un recruteur pressé. Il charge réellement la page, extrait des signaux vérifiables, calcule cinq scores explicables et utilise Workers AI pour transformer les résultats en plan d’action.

## Architecture

- React + TypeScript pour l’interface ;
- Cloudflare Workers pour l’API et les assets statiques ;
- Browser Run pour charger la page et produire une capture ;
- Workers AI pour le verdict et les recommandations éditoriales ;
- D1 pour conserver les rapports pendant 30 jours ;
- R2, facultatif, pour les captures WebP ;
- Turnstile, facultatif en local, pour protéger la création d’audits.
- D1 pour une mesure d’audience propriétaire, consentie et pseudonymisée ;
- un espace administrateur privé pour les tendances, les problèmes fréquents et l’export CSV anonymisé.

Si Browser Run ou Workers AI sont indisponibles, l’application bascule respectivement vers une analyse HTML par `fetch` et des recommandations déterministes. Les rapports restent donc utilisables sans IA.

## Méthodologie d’accessibilité

Le score « Indicateurs d’accessibilité » observe automatiquement quelques fondamentaux liés aux WCAG 2.2 : langue principale de la page (3.1.1), structure sémantique (1.3.1) et alternatives textuelles des images (1.1.1). Il ne constitue ni un audit exhaustif ni une certification de conformité WCAG.

Le contraste, la navigation au clavier, la visibilité du focus, les formulaires et les technologies d’assistance nécessitent une revue humaine complémentaire. Le rapport affiche cette limite et renvoie vers la [présentation officielle des WCAG par le W3C](https://www.w3.org/WAI/standards-guidelines/wcag/).

## Développement local

Prérequis : Node.js 20 ou plus récent et un compte Cloudflare.

```bash
npm install
npm run dev:local
```

Le site est alors disponible sur `http://127.0.0.1:4173`. Cette commande compile le client puis démarre une API locale compatible. Sans connexion Cloudflare, le chargement du portfolio utilise le mode `fetch` et les recommandations déterministes. Le Worker, D1, R2, Browser Run et Workers AI sont utilisés lors du déploiement Cloudflare. Copie `.dev.vars.example` vers `.dev.vars` seulement si tu veux tester Turnstile avec Wrangler. Les clés présentes dans l’exemple sont les clés de test officielles.

En démonstration locale, `/admin` utilise le mot de passe `local`. Tu peux le remplacer avec la variable d’environnement `PORTFOLIOLENS_LOCAL_ADMIN_PASSWORD`.

## Premier déploiement Cloudflare

Authentifie Wrangler puis crée les ressources gratuites :

```bash
npx wrangler login
npx wrangler d1 create portfoliolens-db
```

Copie le `database_id` retourné dans `wrangler.jsonc`, à la place de `REPLACE_WITH_YOUR_D1_DATABASE_ID`, puis exécute :

```bash
npm run db:migrate:remote
npm run deploy
```

Pour activer Turnstile en production, crée un widget dans le tableau de bord Cloudflare. Ajoute sa clé publique dans `vars.TURNSTILE_SITE_KEY` dans `wrangler.jsonc`, puis stocke la clé secrète sans la committer :

```bash
npx wrangler secret put TURNSTILE_SECRET
```

Mets enfin `APP_ORIGIN` à l’adresse de production.

## Espace administrateur et statistiques

Le tableau de bord est disponible sur `/admin`. Il affiche les visites consenties, les visiteurs pseudonymisés, les sessions, les audits, la conversion, les scores moyens, les problèmes les plus fréquents, les appareils, les pays agrégés et les derniers rapports.

Active son mot de passe avec un secret Cloudflare, sans l’ajouter au dépôt :

```bash
npx wrangler secret put ADMIN_PASSWORD
```

Applique ensuite la migration et redéploie :

```bash
npm run db:migrate:remote
npm run deploy
```

L’export CSV ne contient ni URL, ni nom de domaine, ni identifiant visiteur. Il contient uniquement les scores et signaux techniques anonymisés, afin de produire des cas d’usage et des statistiques éditoriales fiables.

Pour renforcer encore l’accès propriétaire, il est recommandé de placer `/admin` et `/api/admin/*` derrière Cloudflare Access en complément du mot de passe applicatif.

## Cookies et confidentialité

PortfolioLens ne déclenche aucune mesure d’audience avant accord. Le refus est présenté au même niveau que l’acceptation et reste modifiable depuis le pied de page. La page `/privacy` détaille les finalités et durées :

- choix et identifiant de mesure : 6 mois ;
- événements d’audience : 90 jours ;
- rapports détaillés : 30 jours ;
- observations anonymisées : 12 mois.

Les adresses IP ne sont pas enregistrées. Les identifiants aléatoires sont hachés avant leur écriture dans D1 et les statistiques sont réservées à PortfolioLens.

## Déploiement depuis GitHub

Le workflow `.github/workflows/deploy-cloudflare.yml` vérifie les tests puis déploie le Worker manuellement. Dans les paramètres GitHub du dépôt, ajoute ces secrets Actions :

- `CLOUDFLARE_API_TOKEN` : jeton Cloudflare autorisé à modifier Workers, D1 et R2 ;
- `CLOUDFLARE_ACCOUNT_ID` : identifiant du compte Cloudflare.

Crée d’abord la base D1 et le bucket R2, remplace l’identifiant D1 dans `wrangler.jsonc`, puis ouvre l’onglet **Actions → Deploy PortfolioLens to Cloudflare → Run workflow**. Le workflow est volontairement manuel afin qu’un premier push ne tente pas un déploiement avant la création des ressources.

## Commandes utiles

```bash
npm test          # tests du moteur de notation
npm run build     # vérification TypeScript + build Worker et client
npm run deploy    # build et déploiement
```

## Sécurité et maîtrise des coûts

- les URL locales et les adresses IP privées sont refusées pour limiter les risques SSRF ;
- Turnstile bloque les créations automatisées lorsque ses deux clés sont configurées ;
- les captures ne sont accessibles qu’avec un identifiant imprévisible ;
- les rapports et captures de plus de 30 jours sont supprimés progressivement ;
- les événements analytics sont supprimés après 90 jours et les observations anonymisées après 12 mois ;
- aucune mesure d’audience n’est envoyée avant consentement ;
- l’application utilise les quotas Free de Workers, Browser Run, Workers AI, D1 et R2.

Pour une mise en production publique, ajoute aussi une limite par adresse IP et une politique de suppression visible dans l’interface.
