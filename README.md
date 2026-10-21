# WikiTrade

> Outil compagnon pour le jeu [WikiMasters](https://www.wiki-masters.com) : il synchronise une collection de cartes et celles de ses amis, met en cache les prix du marché, et repère automatiquement les **bons plans** sur les enchères.

Ce README n'est pas une documentation du code, mais une explication du besoin que le projet résout et de ses liens avec le reverse engineering.

Ce projet n'est pas une démonstration de compétence en programmation et n'est pas destiné à être utilisé par quelqu'un d'autre. C'est un projet pensé pour servir à son développeur, qui en connaît les failles d'affichage, de performance, etc. L'API et les gardes-fous de WikiMasters changent assez vite : certaines fonctionnalités peuvent ne plus marcher.

- **Hors scope** : qualité de code, UI/UX.
- **Scope** : reverse engineering, optimisation des appels API, répondre au besoin le plus vite possible plutôt que proprement.

---

## Contexte

J'ai découvert WikiMasters fin août, avant la hype. C'est typiquement le genre de jeu où l'on passe quelques jours à fond puis dont on se lasse très vite. L'application a été développée par un non-technique, uniquement à l'aide d'agents IA. Elle présente donc énormément de failles, détectables très rapidement par des développeurs plus expérimentés.

C'est dans ce contexte de recherche de failles et d'échange de carte que s'inscrit ce projet.

---

## Endpoint login -> cookie

Initialement, on pouvait se connecter très simplement avec un seul appel à l'endpoint `/login` muni de ses identifiants ; ensuite l'application acceptait n'importe quelle requête. Après l'arrivée de nombreux bots, une première sécurité a été mise en place : un captcha à la connexion.

La solution pour continuer à utiliser l'application a donc été de récupérer le cookie (ou l'`Authorization`) directement dans les requêtes réseau du navigateur et de le donner à WikiTrade pour s'identifier.

Côté serveur, ce cookie est juste rejoué tel quel.

```js
const { cookie, session } = parseCookie(COOKIE);
const claims    = decodeJwt(session.access_token); // payload JWT = Base64URL, lisible sans clé
const expiresAt = claims.exp * 1000;
if (Date.now() > expiresAt) {
  throw new Error(`Cookie expiré depuis ${new Date(expiresAt).toLocaleTimeString()}.`);
}
const userId     = claims.sub;
const myUsername = claims.user_metadata?.username ?? claims.email;
```

---

## Persistance en fichiers JSON

WikiMasters utilise un SaaS (Supabase) pour gérer tout son backend et sa base de données. Comme l'objet JSON renvoyé correspondait stricto sensu à l'objet métier, la première approche a été de se créer un projet Supabase gratuit et d'y répliquer l'ensemble des bases de données supposées de l'application.

La version gratuite présentant de nombreuses limitations de performance, la migration des données a finalement été faite vers de simples fichiers JSON plutôt qu'une vraie BDD, afin de faciliter le partage — même si la solution n'est pas propre.

Il reste cependant des notions d'optimisation d'accès, comme les tables de jointure, car la conception avait initialement été pensée pour une vraie base de données. La fonction `allCards()` reconstruit en mémoire l'équivalent d'un `JOIN` SQL en indexant d'abord utilisateurs et cartes dans des `Map` (accès en O(1)) avant de boucler :

```js
const userMap   = new Map(db.users.map(u => [u.id, u]));
const cardUsers = new Map();
for (const uc of db.user_cards) {
  if (!cardUsers.has(uc.card_id)) cardUsers.set(uc.card_id, []);
  cardUsers.get(uc.card_id).push({ user_id: uc.user_id, tags: uc.tags ?? ['no-tag'] });
}
// puis, pour chaque carte, on croise prix x détenteurs sans re-parcourir les tableaux
```

---

## Feature principale

L'objectif initial de l'application, comme son nom l'indique, est de faciliter l'échange de cartes entre amis. Dans WikiMasters, on ne peut filtrer l'inventaire de ses amis qu'un par un : c'est un manque à gagner. WikiTrade a d'abord vu le jour pour centraliser les cartes de l'ensemble de ses amis et les filtrer toutes ensemble.

Au fil du temps, des fonctionnalités ont été ajoutées pour répondre à de nouveaux besoins (filtre par tag, tri des cartes, etc.), mais le projet reste le même. Tout ce filtrage se fait côté serveur, sur les données déjà synchronisées :

```js
let rows = allCards();
if (r.length > 0) rows = rows.filter(row => r.includes(row.rarity));
if (q) {
  const ql = q.toLowerCase();
  rows = rows.filter(row =>
    row.wikipedia_title?.toLowerCase().includes(ql) ||
    row.category?.toLowerCase().includes(ql) ||
    row.username?.toLowerCase().includes(ql)
  );
}
sortRows(rows, order);
```

---

## Évaluation du prix de ses cartes

WikiMasters intègre une fonctionnalité permettant de consulter le prix moyen de vente de chacune de ses cartes. Tout comme pour les amis, on ne peut consulter qu'une seule carte à la fois, ce qui limite la fonctionnalité aux cartes dont on soupçonne déjà la valeur.

On a donc ajouté une feature permettant d'estimer l'ensemble de sa collection, pour ensuite détecter les bonnes ventes.

---

## Évaluation du marché

Estimer sa collection, c'est bien ; estimer le marché, c'est mieux. Via l'UI, un utilisateur lambda ne peut accéder qu'au prix de vente moyen de **ses propres** cartes. Mais en regardant directement les appels API, on se rend compte qu'il n'y a **aucune vérification d'appartenance** d'une carte avant de renvoyer cette valeur.

On peut donc consulter le prix moyen de n'importe quelle carte du marché et calculer le delta entre les offres en cours et la valeur théorique :

```js
const avg   = byRarity?.[rarity] ?? null;          // prix moyen récupéré via l'API
const delta = avg != null ? avg - a.effective_bid : null;
// on ne garde que les enchères dont l'offre est strictement sous la moyenne
if (avg == null || a.effective_bid >= avg) continue;
```

---

## Cache

Afin de limiter le nombre de requêtes envoyées au serveur, un cache a été mis en place : on ne redemande pas une information qu'on possède déjà et qu'on estime fiable. Il n'est pas pertinent de consulter le prix d'une carte tous les jours, tout comme la liste d'amis n'évolue pas toutes les heures. On ne demande que le strict minimum.

Concrètement, avant chaque appel on vérifie si la donnée est déjà en cache ; si oui, on l'évite (compteur `saved`) :

```js
if (db.market_prices[id]?.by_rarity) {
  saved++;
  continue; // déjà connu → aucun appel réseau
}
```

### Cache TTL — un cache qui périme

Pour les amis (`friends.js`), on ne veut pas garder les données indéfiniment : elles ont une durée de vie (TTL). En dessous du seuil on sert le cache, au-dessus on rafraîchit.

```js
const TTL_MS = 24 * 60 * 60 * 1000; // 24 h
if (cached.fetched_at && Date.now() - new Date(cached.fetched_at) < TTL_MS) {
  // on renvoie le cache sans rappeler l'API
}
```

### Contrôle de concurrence — paralléliser, mais pas trop

Pour les cartes inconnues, interroger les prix un par un serait lent ; mais lancer 500 requêtes d'un coup surchargerait l'API (et risquerait un ban). D'où `withConcurrency` dans `src/utils.js` : au maximum **5 requêtes en parallèle**. On lance 5 « workers » qui se partagent la même file et piochent le prochain élément tant qu'il en reste.

```js
export async function withConcurrency(items, limit, fn) {
  if (items.length === 0) return;
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    })
  );
}

// appel : 5 estimations de prix de front
await withConcurrency(unknown, 5, async ([cardId, auctions]) => { /* ... */ });
```

---

## Comment lancer le projet

> ⚠️ **ATTENTION** : l'utilisation de cette application peut entraîner un ban du jeu. Ne l'utilisez pas. Si vous voulez tester, un jeu de données peut être fourni.

### Prérequis

- Node.js (le projet utilise les modules ES — `"type": "module"` dans `package.json`).
- Un compte WikiMasters et une session active.

### 1. Récupérer le cookie de session

Dans ton navigateur connecté à wiki-masters.com, copie le cookie de session Supabase (`sb-<project>-auth-token`) et place-le dans un fichier `.env` à la racine :

```env
COOKIE=sb-cyrxjeppjqsxxjayfrur-auth-token=base64-...
```

> Le serveur refuse de démarrer si `COOKIE` est absent ou si la session est expirée — il affiche alors le temps restant au lancement.

### 2. Démarrer le serveur

```bash
node serveur.js
```

Tu devrais voir :

```
Connecté: <ton_pseudo> (<ton_id>) — session valide encore ~N min
http://localhost:3001
```

### 3. Utiliser l'app

- **`http://localhost:3001/`** — collection : synchroniser tes cartes et celles d'un ami, filtrer par rareté, trier, voir les prix moyens.
- **`http://localhost:3001/deals`** — bons plans : scanner les enchères et repérer celles sous le prix moyen (avec préchauffage du cache de prix).
