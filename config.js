/* ============ Konfiguration ============
   Solange beide Werte leer sind, läuft die App im lokalen Modus
   (alle Daten bleiben auf diesem Gerät gespeichert).

   Für die Synchronisierung zwischen iPhone, iPad & Wand-Tablet:
   1. Supabase-Projekt anlegen (siehe ANLEITUNG.md)
   2. Project URL und anon/publishable Key hier eintragen
*/
const SUPABASE_URL = 'https://lcdlotidyarunuafonvp.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_NUv6jBYfyiBuODE671WRqw_d6E0VnNn';

// Öffentlicher VAPID-Schlüssel für Push (der private liegt nur als Secret bei Supabase)
const VAPID_PUBLIC_KEY = 'BNiX1loaAxYon7hmE86_B7b5Zt7axlFCf7JsBaPWl03paKfXVpxbFiM7ApQ-nmRIZ75Yw9uLG10bM_6Tx-MG3cA';
