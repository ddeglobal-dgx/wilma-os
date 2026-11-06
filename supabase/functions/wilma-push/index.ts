// Wilma OS — Push-Versand (Supabase Edge Function)
// Aufruf aus der App: supabase.functions.invoke('wilma-push', { body: { to: 'laura', title, body, url } })
// Prüft, dass der Aufrufer Bewohner ist, hält die Ruhezeit 22–7 Uhr ein und schickt an alle Geräte der Zielperson.
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:…)
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const auth = req.headers.get("Authorization") || "";

    // Wer ruft? Nur angemeldete Bewohner.
    const asUser = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return json({ error: "nicht angemeldet" }, 401);
    const admin = createClient(url, service);
    const { data: me } = await admin.from("members").select("person").eq("email", (user.email || "").toLowerCase()).maybeSingle();
    if (!me) return json({ error: "kein Bewohner" }, 403);

    const { to, title, body, url: link, force } = await req.json();
    if (!["dennis", "laura"].includes(to)) return json({ error: "Empfänger?" }, 400);
    if (to === me.person) return json({ sent: 0, skipped: "selbst" });

    // Ruhezeit 22–7 Uhr (Europe/Berlin)
    const hour = Number(new Intl.DateTimeFormat("de-DE", { hour: "numeric", hour12: false, timeZone: "Europe/Berlin" }).format(new Date()));
    if (!force && (hour >= 22 || hour < 7)) return json({ sent: 0, skipped: "ruhezeit" });

    webpush.setVapidDetails(
      Deno.env.get("VAPID_SUBJECT") || "mailto:info@dde-global.com",
      Deno.env.get("VAPID_PUBLIC_KEY")!,
      Deno.env.get("VAPID_PRIVATE_KEY")!,
    );
    const { data: subs } = await admin.from("push_subscriptions").select("endpoint, keys").eq("person", to);
    const payload = JSON.stringify({ title: title || "Wilma OS", body: body || "", url: link || "./" });
    let sent = 0;
    for (const s of subs || []) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, { TTL: 3600 });
        sent++;
      } catch (e: any) {
        // 404/410 = Abo abgelaufen → aufräumen
        if (e?.statusCode === 404 || e?.statusCode === 410) await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
        else console.error("push fehlgeschlagen", e?.statusCode, e?.body || e?.message);
      }
    }
    return json({ sent, devices: (subs || []).length });
  } catch (e: any) {
    console.error(e);
    return json({ error: String(e?.message || e) }, 500);
  }
});
