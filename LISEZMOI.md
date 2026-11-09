# Ouanteur Academy : tunnel de prospects (mise en route ≈ 15 minutes)

## Contenu du dossier

| Fichier | Rôle |
| --- | --- |
| `site/index.html` | Page d'inscription (mobile, formulaire, compteur des 20 places, suivi UTM, pixels) |
| `backend/Code.gs` | Script Google : enregistre les prospects, désigne les 20 premiers, envoie les courriels |
| `publicite/visuels/` | 4 images prêtes pour Meta (4:5, 9:16, 1:1) |

Le plan Google Ads / Meta Ads (mots-clés, textes, audiences, budget) est dans le document « Plan publicitaire – Offre 20 premiers inscrits ». Tout est rédigé pour Ouanteur Academy : cours d'allemand en ligne, préparation aux tests d'allemand et à l'Ausbildung.

## 1. Base de données et courriels (Google Sheets)

1. Créez un Google Sheet vide, nommez-le « Prospects Ouanteur Academy ».
2. Menu **Extensions > Apps Script**. Supprimez le code existant, collez tout `backend/Code.gs`.
3. En haut du script, remplissez `CONFIG` : `SCHOOL_NAME`, `OWNER_EMAIL` (alerte à chaque prospect), `REPLY_TO`, `SENDER_ADDRESS` (adresse postale, exigée dans les courriels commerciaux), et `BOOKING_URL` si vous avez un lien de rendez-vous.
4. Roue dentée **Paramètres du projet** : fuseau horaire `America/Toronto`.
5. Choisissez la fonction `setup` dans la barre du haut, cliquez **Exécuter**, acceptez les autorisations. Le Sheet reçoit les onglets « Prospects », « 20 premiers » et « Tableau de bord », et une relance quotidienne à 9 h est programmée.
6. **Déployer > Nouveau déploiement > Application Web** : *Exécuter en tant que* **Moi**, *Qui a accès* **Tout le monde**. Copiez l'adresse qui se termine par `/exec`.
7. Test : ouvrez `ADRESSE/exec?action=stats` dans le navigateur. Réponse attendue : `{"ok":true,"prises":0,"total":20,"demandes":0}`.

Après toute modification du script : **Déployer > Gérer les déploiements > Modifier > Nouvelle version**. L'adresse ne change pas.

Si les formules du « Tableau de bord » ou de « 20 premiers » affichent `#ERROR!`, remplacez le code Apps Script par la dernière version de `backend/Code.gs`, puis exécutez `setup` de nouveau. Les onglets de résumé sont recréés avec les séparateurs adaptés à la langue du classeur; les demandes de l'onglet « Prospects » sont conservées.

## 2. La page

1. Ouvrez `site/index.html` dans un éditeur de texte. Dans le bloc `CONFIG` du script :
   - `endpoint` : l'adresse `/exec` de l'étape 1.
   - `schoolName` (déjà « Ouanteur Academy »), `programmes`, `privacyUrl`, `legalLine`.
   - `googleTagId`, `googleAdsConversion`, `metaPixelId` (voir le plan publicitaire).
   - `totalSeats` doit rester égal à `TOTAL_SEATS` dans `Code.gs`.
2. Hébergez le fichier (votre site actuel, Netlify, GitHub Pages ou Cloudflare Pages). Pour Netlify, la page d'accueil préparée est `site/index.html`.

### Publication rapide sur Netlify

- Connectez-vous à Netlify et ouvrez [Netlify Drop](https://app.netlify.com/drop).
- Glissez-déposez le dossier `site/` (il contient la page d'accueil `index.html`). Netlify publie alors le site et fournit une adresse temporaire en `netlify.app`.
- Pour déployer ensuite les mises à jour automatiquement, placez le projet dans un dépôt Git, puis créez un site Netlify depuis ce dépôt. La configuration `netlify.toml` utilise `site/` comme dossier publié.
- Testez l'adresse `…netlify.app`, puis faites une inscription test et vérifiez sa présence dans l'onglet « Prospects » du Google Sheet.

Le site publié envoie les demandes directement au Web App Google Apps Script. La fonction Netlify basée sur une autre base de données n'est pas incluse dans ce déploiement.
3. Faites une inscription test depuis votre téléphone. Vérifiez : ligne dans « Prospects », courriel reçu, compteur de la page mis à jour. Supprimez ensuite la ligne de test dans le Sheet.

Tant que `endpoint` est vide, la page tourne en mode démonstration : rien n'est enregistré et un bandeau jaune le signale.

## 3. Utilisation au quotidien

- **Onglet « Prospects »** : une ligne par demande. Colonne *Statut offre* : Admissible (20 premiers) ou Liste d'attente. Colonne *Statut commercial* (liste déroulante) : changez-la dès le premier contact, les relances s'arrêtent.
- **Onglet « 20 premiers »** : liste filtrée automatiquement.
- **Onglet « Tableau de bord »** : demandes, places restantes, inscrits, taux d'inscription, demandes par source, par jour et par campagne.
- **STOP** : si quelqu'un répond STOP, mettez son statut commercial à « Désabonné ».
- **Libérer une place** : supprimez la ligne (ou passez le *Statut offre* à Liste d'attente) ; le compteur de la page se met à jour seul.

## Limites à connaître

- Quotas d'envoi Google : environ 100 courriels par jour avec un compte Gmail gratuit, 1 500 avec Google Workspace.
- L'adresse `/exec` est publique. Le champ piège, la validation et le blocage des doublons filtrent les robots simples, sans CAPTCHA. Surveillez le Sheet les premiers jours.
- Le rang d'arrivée est attribué à l'enregistrement par le script, jamais par la page : deux personnes simultanées sont départagées sans erreur.
