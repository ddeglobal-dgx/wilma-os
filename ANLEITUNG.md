# Betriebssystem Laura ♡ — Anleitung für Dennis

Die App läuft in **zwei Modi**:

- **Lokaler Modus** (sofort, ohne Setup): Alle Daten bleiben auf dem Gerät. Perfekt, um sie am Sonntag zu verschenken — auf Lauras iPhone oder dem Tablet installieren, fertig.
- **Cloud-Modus** (Stufe 1b, ~20 Min Setup): Häkchen synchronisieren zwischen iPhone, iPad und Wand-Tablet. Braucht ein eigenes Supabase-Projekt.

---

## Schritt 1 — Online stellen (nötig für die Installation als App)

PWAs brauchen HTTPS. Einfachster Weg: **Netlify Drop** (kostenlos, Drag & Drop, kein Git nötig).

1. https://app.netlify.com/drop öffnen (kostenlosen Account anlegen, falls noch keiner da ist — machst du selbst).
2. Den kompletten Ordner `betriebssystem-laura` ins Browserfenster ziehen.
3. Netlify gibt dir eine Adresse wie `https://irgendwas.netlify.app`.
4. Optional: Unter *Site settings → Change site name* einen schönen Namen wählen, z. B. `betriebssystem-laura.netlify.app`.

> Wichtig: Die Dateien `make_icons.py`, `supabase/` und diese Anleitung stören nicht, kannst du aber vor dem Hochladen entfernen. Nur `index.html`, `styles.css`, `app.js`, `data.js`, `store.js`, `config.js`, `manifest.webmanifest`, `sw.js` und der Ordner `icons/` werden gebraucht.

Alternativen: Cloudflare Pages (Direct Upload) oder Vercel — geht beides genauso gut.

## Schritt 2 — Auf Lauras Geräten installieren

Auf iPhone/iPad in **Safari** die Adresse öffnen, dann:
**Teilen-Symbol → „Zum Home-Bildschirm"** → sie bekommt ein Herz-Icon „Laura ♡" wie eine echte App (Vollbild, ohne Browserleiste).

Fürs **Wand-Tablet**: App genauso installieren, Bildschirmsperre in den Einstellungen auf „Nie" stellen. Optional „Geführter Zugriff" (Einstellungen → Bedienungshilfen), damit das Tablet in der App bleibt.

## Schritt 3 (optional, Stufe 1b) — Cloud-Sync einrichten

1. Auf https://supabase.com ein **neues Projekt** anlegen (Free Tier reicht locker). **Nicht** das DGX-Projekt verwenden!
2. Im **SQL-Editor** den kompletten Inhalt von `supabase/schema.sql` ausführen.
3. Unter **Authentication → Users → Add user** einen Benutzer anlegen, z. B. Lauras E-Mail + ein Passwort eurer Wahl ("Auto Confirm User" anhaken).
4. Unter **Project Settings → API** die `Project URL` und den `anon public` Key kopieren und in `config.js` eintragen:
   ```js
   const SUPABASE_URL = 'https://xxxx.supabase.co';
   const SUPABASE_ANON_KEY = 'eyJ...';
   ```
5. Ordner erneut zu Netlify hochladen (einfach nochmal auf die Drop-Fläche ziehen — gleiche Adresse unter *Deploys*).
6. Beim ersten Öffnen meldet Laura sich einmal pro Gerät an — danach bleibt sie angemeldet.

**Sicherheit:** Der anon-Key darf öffentlich sein — ohne Login (RLS) kommt niemand an die Daten.

## Was die App kann (Stufe 1)

- **Heute**: Begrüßung, Tages-Spruch, Fortschrittsbalken, Morgenroutine, Time to Grow, Hunderunden, Haushalt des Tages (inkl. automatischer 2-Wochen-Logik), 15-Minuten-Zone **mit eingebautem Timer**. Bei 100 %: Herzregen + „Du machst das großartig!"
- **Woche**: Der komplette Wochenplan wie auf dem laminierten Zettel — digital, mit echten Häkchen.
- **Regeln**: Ihre 5 Regeln + Projektzeit.
- **Anpassen**: Laura kann alles selbst ändern — Aufgaben, Rhythmen (wöchentlich/2-wöchentlich inkl. „diese/nächste Woche"), Routinen, Regeln.

## Stufe 2 (nach dem Jubiläum)

- Push-Reminder („Hundeschule in 30 Min 🐾") — Web Push, funktioniert ab iOS 16.4 in installierten PWAs
- Google-Kalender-Anbindung (Termine in der Heute-Ansicht)
- Yazio-Kalorien-Widget (inoffizielle API, mit Vorbehalt)
- Statistiken/Streaks („12 Tage in Folge alles geschafft ♡")
