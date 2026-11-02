/* ============ Wilma OS — Standard-Daten: Personen, Besitz, Größen, Wochenplan, Routinen, Regeln, Sprüche ============ */

// Die zwei Bewohner. Wer gerade angemeldet ist, steht in `me` (app.js).
const PEOPLE = {
  dennis: { name: 'Dennis', short: 'D' },
  laura:  { name: 'Laura',  short: 'L' },
};
const PERSON_KEYS = ['dennis', 'laura'];

// Wem gehört ein Punkt?
//   gemeinsam      = Ampel: wird erst grün, wenn BEIDE bestätigt haben          → Wilma-Punkte
//   haus           = einer erledigt es, das reicht (oder zu zweit, wenn erlaubt) → Wilma-Punkte
//   jeder          = gleiche Aufgabe für beide, jeder hakt für sich ab          → Soul-Punkte
//   dennis / laura = persönlich                                                → Soul-Punkte
const OWNER_META = {
  gemeinsam: { label: 'Gemeinsam', order: 0 },
  haus:      { label: 'Haus',      order: 1 },
  jeder:     { label: 'Jeder für sich', order: 2 },
  laura:     { label: 'Laura',     order: 3 },
  dennis:    { label: 'Dennis',    order: 4 },
};
function pointArtOf(owner) { return (owner === 'haus' || owner === 'gemeinsam') ? 'wilma' : 'soul'; }

// Größe = Punkte
const SIZES = [1, 3, 5, 10];
const SIZE_META = { 1: 'klein', 3: 'mittel', 5: 'groß', 10: 'Projekt' };
const ZONE_SIZE = 3;

// Zeitfenster fürs Buchen
const SLOTS = { morgen: 'morgens', mittag: 'mittags', abend: 'abends' };

// Team-Ziele: Erledigungsquote in Prozent
const DEFAULT_GOALS = {
  soul:  { woche: 70, monat: 70, quartal: 70, jahr: 70 },
  wilma: { woche: 70, monat: 70, quartal: 70, jahr: 70 },
};
const PERIOD_META = { woche: 'Woche', monat: 'Monat', quartal: 'Quartal', jahr: 'Jahr' };

// Ankerwoche für alle 2-wöchentlichen Aufgaben (Montag). In "Anpassen" pro Aufgabe umschaltbar.
const DEFAULT_ANCHOR = '2026-08-03';

const DEFAULT_TASKS = [
  // Montag
  { title: 'Garten', weekday: 1, cadence: 'weekly', groesse: 5, zu_zweit: true },
  { title: 'Betten beziehen', weekday: 1, cadence: 'biweekly', groesse: 3 },
  { title: 'Staub unten', weekday: 1, cadence: 'weekly', groesse: 3 },
  // Dienstag
  { title: 'Holztisch', weekday: 2, cadence: 'weekly' },
  { title: 'Stuhlkissen', weekday: 2, cadence: 'biweekly' },
  { title: 'Spüle intensiv', weekday: 2, cadence: 'weekly', groesse: 3 },
  { title: 'Küchenschränke außen', weekday: 2, cadence: 'biweekly', groesse: 3 },
  // Mittwoch
  { title: 'Vorgarten', weekday: 3, cadence: 'weekly', groesse: 3, zu_zweit: true },
  { title: 'Schminktisch', weekday: 3, cadence: 'weekly' },
  { title: 'Müll OG', weekday: 3, cadence: 'weekly' },
  { title: 'Refill Gäste-WC', weekday: 3, cadence: 'biweekly' },
  { title: 'Refill Bad OG', weekday: 3, cadence: 'weekly' },
  // Donnerstag
  { title: 'Saugen und wischen UG', weekday: 4, cadence: 'weekly', groesse: 5 },
  { title: 'Couchdecken', weekday: 4, cadence: 'weekly' },
  { title: 'Fensterbank Wohnzimmer', weekday: 4, cadence: 'weekly' },
  // Freitag
  { title: 'Refill Küche', weekday: 5, cadence: 'weekly' },
  { title: 'Kühlschrank', weekday: 5, cadence: 'biweekly', groesse: 5 },
  { title: 'Müll UG', weekday: 5, cadence: 'weekly' },
  // Samstag
  { title: 'Waschbecken OG', weekday: 6, cadence: 'weekly' },
  { title: 'WC OG', weekday: 6, cadence: 'weekly', groesse: 3 },
  { title: 'WC unten', weekday: 6, cadence: 'weekly', groesse: 3 },
  { title: 'Wanne ausspülen', weekday: 6, cadence: 'weekly' },
  { title: 'Wanne ausspülen OG', weekday: 6, cadence: 'weekly' },
  { title: 'Dusche Grund', weekday: 6, cadence: 'biweekly', groesse: 5 },
  // Sonntag
  { title: 'Saugen und wischen OG', weekday: 7, cadence: 'weekly', groesse: 5 },
  { title: 'Teppich Bad', weekday: 7, cadence: 'biweekly', groesse: 3 },
  { title: 'Staub oben', weekday: 7, cadence: 'weekly', groesse: 3 },
  { title: 'Bügeln', weekday: 7, cadence: 'weekly', groesse: 5 },
];

const DEFAULT_ROUTINES = [
  // Hausregeln mit Ampel — gemeinsam, grün erst wenn beide bestätigt haben
  { section: 'ampel', owner: 'gemeinsam', groesse: 3, title: 'OG in Ordnung', gate: 'bevor wir morgens Kaffee trinken', gate_slot: 'morgen' },
  { section: 'ampel', owner: 'gemeinsam', groesse: 3, title: 'EG in Ordnung', gate: 'bevor wir schlafen gehen', gate_slot: 'abend' },
  // Morgenroutine — für beide gleich, jeder hakt für sich ab
  { section: 'morgen', owner: 'jeder', groesse: 1, title: 'Aufstehen & Bad' },
  { section: 'morgen', owner: 'jeder', groesse: 1, title: 'Betten kurz machen (OG)' },
  { section: 'morgen', owner: 'jeder', groesse: 1, title: '5-Minuten-Ordnung oben' },
  { section: 'morgen', owner: 'jeder', groesse: 3, title: 'Kaffee & Philosophieren ☕' },
  { section: 'morgen', owner: 'jeder', groesse: 5, title: 'Time to Grow ✨' },
  // Hunde — einer bucht, der andere kann sich dazubuchen
  { section: 'hunde', owner: 'haus', groesse: 3, zu_zweit: true, title: 'Hunderunde morgens 🐾' },
  { section: 'hunde', owner: 'haus', groesse: 3, zu_zweit: true, title: 'Hunderunde abends 🐾' },
];

const SECTION_META = {
  ampel:  { label: 'Hausregel mit Ampel', order: 0 },
  morgen: { label: 'Morgenroutine', order: 1 },
  grow:   { label: 'Time to Grow', order: 2 },
  hunde:  { label: 'Hunde', order: 3 },
  alltag: { label: 'Routinen', order: 4 },
};

const DEFAULT_RULES = [
  'Pflicht vor Projekten.',
  'Eine Baustelle nach der anderen.',
  'Neue Ideen kommen auf die Projektliste – nicht sofort anfangen.',
  'Erst den heutigen Plan erledigen, dann darf Projektzeit beginnen.',
  'Ich muss heute nicht das ganze Haus schaffen. Ich muss nur den heutigen Tag schaffen.',
];

const DEFAULT_PROJEKTZEIT =
  'Projekte wie Garten, Keller, Whirlpool, Dach, Saugroboter usw. sind wichtig, aber sie haben ihren eigenen Platz.\n\n' +
  'Plane dir feste Zeiten dafür ein (z. B. Dienstag & Samstag).\n\n' +
  'Außerhalb dieser Zeiten gilt: Haushalt zuerst.';

// Warme Tages-Sprüche — einer pro Tag, rotierend.
const QUOTES = [
  'Kleine Schritte jeden Tag sind der leiseste Weg zu großen Dingen.',
  'Du musst nicht perfekt sein. Du bist schon genug.',
  'Heute zählt nur heute – und das schaffst du.',
  'Ein ordentliches Zuhause beginnt mit einem liebevollen Blick auf dich selbst.',
  'Jedes Häkchen ist ein kleines Geschenk an dein Morgen-Ich.',
  'Ruhe ist keine Belohnung, die man sich verdienen muss. Sie gehört dir.',
  'Was du heute mit Liebe tust, trägt dich durch die Woche.',
  'Auch langsame Tage bringen dich weiter.',
  'Dein Zuhause muss nicht glänzen, um voller Wärme zu sein.',
  'Fang einfach an – der Anfang ist schon die halbe Magie.',
  'Du darfst stolz auf dich sein, auch für die kleinen Dinge.',
  'Ein Tag, an dem du für dich sorgst, ist nie ein verlorener Tag.',
  'Struktur ist Selbstfürsorge in ihrer schönsten Form.',
  'Atme tief durch. Du hast heute schon mehr geschafft, als du denkst.',
  'Nicht alles auf einmal. Nur das Nächste. Immer nur das Nächste.',
  'Dein Tempo ist das richtige Tempo.',
  'Aus kleinen Routinen wachsen große Veränderungen.',
  'Sei heute so freundlich zu dir wie zu deinem liebsten Menschen.',
  'Jeder Tag ist eine neue Karte, die du ziehen darfst.',
  'Du säst heute, was dich morgen blühen lässt.',
  'Ordnung außen schafft Ruhe innen – Schritt für Schritt.',
  'Es ist okay, wenn heute nur das Nötigste klappt. Auch das zählt.',
  'Dein Weg entsteht beim Gehen – und du gehst ihn wunderschön.',
  'Was dich heute stärkt: eine kleine Aufgabe, ehrlich erledigt.',
  'Vertrau dem Prozess. Du bist mittendrin.',
  'Ein Herz voller Geduld schafft mehr als ein Kopf voller Druck.',
  'Heute ist ein guter Tag, um gut zu dir zu sein.',
  'Die 15 Minuten, die du dir schenkst, sind nie verschwendet.',
  'Du wächst – leise, stetig und genau richtig.',
  'Zwischen To-do und Tee liegt dein ganz eigener Zauber.',
  'Erledigt ist besser als perfekt.',
  'Du kümmerst dich um so vieles. Vergiss dich selbst nicht dabei.',
];

// Feier-Botschaften, wenn der Tag geschafft ist.
const CELEBRATE_MESSAGES = [
  'Tag geschafft – du bist wunderbar!',
  'Alles erledigt. Zeit für dich!',
  'Du hast heute alles gegeben – jetzt genieß den Abend!',
  'Häkchen komplett – Herz voll!',
];
