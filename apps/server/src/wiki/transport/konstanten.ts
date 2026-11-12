/**
 * Die festen Größen des Wiki-Transports (WI-0253 B-1, B1-Vertrag). Zahlen und Namen stammen aus Legacy (`api/_internal/wiki/sync.php`,
 * `drossel.php`, Stand 24./25.08.2026) und aus der Wiki-robots.txt; ändern darf sie nur, wer das Wiki gefragt hat.
 */

/** Die API des Wiki Aventurica. Tests zeigen ihren Client auf einen lokalen Testserver; im Code gibt es keine zweite Adresse. */
export const WIKI_API_URL = "https://de.wiki-aventurica.de/de/api.php";

/**
 * 🔴 DER USER-AGENT IST EINE SCHNITTSTELLE, KEIN ETIKETT. Das Wiki hat uns am 24.08.2026 einen eigenen Abschnitt in seiner robots.txt gegeben
 * (`User-agent: AvesmapsWikiSync`, `Crawl-delay: 20`); nur unter diesem Namen ist `/de/api.php` erlaubt, für den Standard-Agenten ist sie
 * gesperrt. Wörtlich wie in Legacy, nicht konfigurierbar, nie in einen Node- oder Browser-Agenten umbenennen.
 */
export const WIKI_USER_AGENT = "AvesmapsWikiSync/2.0 (+https://avesmaps.de; info@avesmaps.de)";

/** Der Abstand zwischen zwei Anfragen an das Wiki (Crawl-delay des Wikis), Jitter darauf: höchstens eine Viertelsekunde. */
export const TAKT_ABSTAND_MS = 20_000;
export const TAKT_JITTER_MAX_MS = 250;
/**
 * Wie viele Abstände ein vermerkter Platz höchstens in der Zukunft liegen darf, bevor er als KAPUTT gilt (verstellte Uhr, von Hand
 * angefasste Datei) statt als Warteschlange. Großzügig, weil bei echter Gleichzeitigkeit ein Platz weit hinten berechtigt ist.
 */
export const TAKT_MAX_WARTESCHLANGE = 20;

/** Titel je Abfrage: 50 für jeden, 500 nur mit `apihighlimits`, und das gilt erst nach nachgewiesener Anmeldung. */
export const STAPEL_ANONYM = 50;
export const STAPEL_BOT = 500;
/**
 * Wie lang der kodierte `titles=`-Wert höchstens werden darf, und wie lang Pfad plus Abfrage insgesamt. Apache nimmt 8190 Zeichen für die
 * ganze Anfragezeile (HTTP 414 darüber): 500 Titel gehören nie ungeprüft in einen GET.
 */
export const TITEL_ABFRAGE_MAX_KODIERT = 7000;
export const ANFRAGE_MAX_ZEICHEN = 8000;

/** Zeitgrenzen eines Abrufs: ein Stapelschritt darf warten, ein Abruf, auf den ein Mensch wartet, nicht. */
export const TIMEOUT_MS = 30_000;
export const TIMEOUT_INTERAKTIV_MS = 8_000;
/** Zwei Wiederholungen sind drei Versuche; die Basis ist das Doppelte des Takts, weil ein Server, der 429 sagte, mehr Ruhe will. */
export const WIEDERHOLUNGEN = 2;
export const BACKOFF_BASIS_MS = 40_000;
/** Ein `Retry-After` darüber wartet kein Lauf ab: Er hält an, und die Pause gilt für alle. */
export const WARTE_MAX_MS = 300_000;

/** Pausen, die für alle Prozesse des Hosts gelten (`schutz.ts`). */
export const PAUSE_403_MS = 3_600_000;
export const PAUSE_429_MIN_MS = 300_000;
export const UNTERBRECHER_SCHWELLE = 3;
export const UNTERBRECHER_PAUSE_MS = 600_000;

/** Die abgelegte Bot-Sitzung ist so lange brauchbar (Legacy: 900 s); nach einer abgelehnten Anmeldung wird 15 Minuten nicht neu versucht. */
export const SITZUNG_MAX_ALTER_MS = 900_000;
export const ANMELDUNG_SPERRE_MS = 900_000;
