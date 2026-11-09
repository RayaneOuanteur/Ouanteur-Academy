# Ouanteur Academy

Site d'inscription de Ouanteur Academy. La page publique est `site/index.html` et le déploiement Netlify est configuré pour publier le dossier `site/`.

## Déploiement Netlify

1. Dans Netlify, choisissez **Add new site > Import an existing project** et connectez ce dépôt GitHub.
2. Gardez la branche `main`. Le fichier `netlify.toml` configure le dossier publié `site`.
3. Lancez le déploiement et vérifiez l'URL `netlify.app`.

Le formulaire envoie directement les inscriptions vers Google Sheets avec le Web App Apps Script configuré dans la page. Pour le guide d'installation complet et la gestion du Sheet, consultez [LISEZMOI.md](./LISEZMOI.md).