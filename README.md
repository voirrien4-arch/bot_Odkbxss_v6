# 🚀 Darkboy — Bot WhatsApp V2

Assistant WhatsApp spécialisé en **hacking éthique**, multi-connexion, par **Odkbxss**.
Basé sur [Baileys](https://github.com/WhiskeySockets/Baileys). Connexion par **code d'appairage**.

📡 **Chaîne WhatsApp:** https://whatsapp.com/channel/0029Vb76gFJHVvTfVrpeEZ0Q

---

## Nouveautés V2

### Nouvelles commandes
- `!alive` — Statut du bot avec style (image + lien chaîne)
- `!ping` — Latence avec indicateur 🟢🟡🔴
- `!uptime` — Temps d'activité du bot
- `!canal` — Lien vers la chaîne WhatsApp
- `!groupinfo` — Infos du groupe (membres, admins, description, photo)
- `!kick` — Expulser un membre (admin)
- `!promote` — Promouvoir un membre admin (admin)
- `!demote` — Rétrograder un admin (admin)
- `!mute` / `!unmute` — Silence le groupe (admin)
- `!tagall` — Taguer tous les membres (admin)
- `!hidetag` — Tag silencieux tous les membres (admin)
- `!welcome on/off` — Message de bienvenue automatique (admin)
- `!goodbye on/off` — Message d'au revoir automatique (admin)
- `!antilink on/off` — Bloquer les liens dans le groupe (admin)
- `!antispam on/off` — Contrôle anti-spam (admin)
- `!vv` — Voir les messages view once

### Améliorations
- Menu redesigné par catégories avec uptime/RAM/date
- Toutes les réponses incluent le lien chaîne WhatsApp
- Welcome/Goodbye avec photo du groupe
- Anti-liens intégré directement dans commands.js
- Paramètres de groupe persistants (JSON)
- Réponses IA avec lien chaîne en footer

---

## Lancer en local

```bash
npm install
cp .env.example .env   # ajuste les variables
npm start
```

Ouvre http://localhost:3000, entre ton numéro au format international (ex: `22662408620`).

---

## Déploiement sur Render

1. Push sur GitHub
2. Render → **New → Blueprint**, sélectionne le repo
3. Le `render.yaml` utilise le plan **starter** (disque persistant nécessaire)
4. Crée un cron sur [cron-job.org](https://cron-job.org) qui ping `/health` toutes les 10 min

---

## Endpoints

| Méthode | URL | Rôle |
|--------|-----|------|
| GET | `/` | Page web multi-connexion |
| GET | `/health` | Health check |
| GET | `/status` | État JSON des sessions |
| POST | `/add-session` | Ajouter un numéro |
| POST | `/remove-session` | Supprimer une session |

---

## ⚠️ Avertissement

Baileys est un client **non officiel**. Utilise un **numéro secondaire**.
À utiliser uniquement pour du contenu légal et éthique.

---

*🚀 Darkboy V2 — Créé par Mcamara*
