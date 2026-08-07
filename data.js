/* ============ Standard-Daten: Lauras Wochenplan, Routinen, Regeln, Sprüche ============ */

// Ankerwoche für alle 2-wöchentlichen Aufgaben (Montag). In "Anpassen" pro Aufgabe umschaltbar.
const DEFAULT_ANCHOR = '2026-08-03';

const DEFAULT_TASKS = [
  // Montag
  { title: 'Garten', weekday: 1, cadence: 'weekly' },
  { title: 'Betten beziehen', weekday: 1, cadence: 'biweekly' },
  { title: 'Staub unten', weekday: 1, cadence: 'weekly' },
  // Dienstag
  { title: 'Holztisch', weekday: 2, cadence: 'weekly' },
  { title: 'Stuhlkissen', weekday: 2, cadence: 'biweekly' },
  { title: 'Spüle intensiv', weekday: 2, cadence: 'weekly' },
  { title: 'Küchenschränke außen', weekday: 2, cadence: 'biweekly' },
  // Mittwoch
  { title: 'Vorgarten', weekday: 3, cadence: 'weekly' },
  { title: 'Schminktisch', weekday: 3, cadence: 'weekly' },
  { title: 'Müll OG', weekday: 3, cadence: 'weekly' },
  { title: 'Refill Gäste-WC', weekday: 3, cadence: 'biweekly' },
  { title: 'Refill Bad OG', weekday: 3, cadence: 'weekly' },
  // Donnerstag
  { title: 'Saugen und wischen UG', weekday: 4, cadence: 'weekly' },
  { title: 'Couchdecken', weekday: 4, cadence: 'weekly' },
  { title: 'Fensterbank Wohnzimmer', weekday: 4, cadence: 'weekly' },
  // Freitag
  { title: 'Refill Küche', weekday: 5, cadence: 'weekly' },
  { title: 'Kühlschrank', weekday: 5, cadence: 'biweekly' },
  { title: 'Müll UG', weekday: 5, cadence: 'weekly' },
  // Samstag
  { title: 'Waschbecken OG', weekday: 6, cadence: 'weekly' },
  { title: 'WC OG', weekday: 6, cadence: 'weekly' },
  { title: 'WC unten', weekday: 6, cadence: 'weekly' },
  { title: 'Wanne ausspülen', weekday: 6, cadence: 'weekly' },
  { title: 'Wanne ausspülen OG', weekday: 6, cadence: 'weekly' },
  { title: 'Dusche Grund', weekday: 6, cadence: 'biweekly' },
  // Sonntag
  { title: 'Saugen und wischen OG', weekday: 7, cadence: 'weekly' },
  { title: 'Teppich Bad', weekday: 7, cadence: 'biweekly' },
  { title: 'Staub oben', weekday: 7, cadence: 'weekly' },
  { title: 'Bügeln', weekday: 7, cadence: 'weekly' },
];

const DEFAULT_ROUTINES = [
  { section: 'morgen', title: 'Aufstehen & Bad' },
  { section: 'morgen', title: 'Betten kurz machen (OG)' },
  { section: 'morgen', title: '5-Minuten-Ordnung oben' },
  { section: 'morgen', title: 'Kaffee & Philosophieren ☕' },
  { section: 'grow', title: 'Tarotkarte ziehen & deuten' },
  { section: 'grow', title: 'Tagebuch schreiben' },
  { section: 'grow', title: 'Visualisierung (Augen zu)' },
  { section: 'grow', title: 'Lesen (ca. 15 Minuten)' },
  { section: 'hunde', title: 'Hunderunde morgens 🐾' },
  { section: 'hunde', title: 'Hunderunde abends 🐾' },
];

const SECTION_META = {
  morgen: { label: 'Morgenroutine', order: 1 },
  grow:   { label: 'Time to Grow', order: 2 },
  hunde:  { label: 'Hunde', order: 3 },
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
