import { Type, type Static } from "@sinclair/typebox";

/**
 * Die Nutzung der eigenen Schnittstellen (WI-0138 V12, BESUCH-0001 §13 F): der dritte Unterreiter des Reiters „Status“.
 *
 *     GET /api/besuch/schnittstellen    Die Zahlen des Unterreiters „API“    use_editor_menu
 *
 * Gezählt wird je Anfrage der **Routenname**, die Statusklasse und, wenn es schiefging, der Grund. Nie die Adresse, nie die
 * Nutzlast, nie ein Schlüssel. Damit beantwortet der Unterreiter drei Fragen, die sonst niemand stellt: Hält jemand unsere
 * öffentliche API am Leben? Welcher Weg kostet am meisten, wenn die Karte langsam wirkt? Welcher Fehler trifft Besucher,
 * ohne dass eine Meldung geschrieben wird?
 */

export const BESUCH_SCHNITTSTELLEN_URL = "/api/besuch/schnittstellen";

/**
 * Die vier Zonen, und vier ist die Obergrenze: Der Ring im Panel zeichnet sie als vier Segmente (Legacys Begründung,
 * `api-metrics.php:93-98`). Der **Takt** steht daneben und wird aus den Zonen herausgerechnet, nicht dazugezählt — sonst
 * bestünde die Last zu einem Viertel aus Lebenszeichen.
 */
export const API_ZONEN = ["offen", "karte", "editor", "uebrige"] as const;
export type ApiZone = (typeof API_ZONEN)[number];

/** Wege, die nur ein Lebenszeichen sind; sie zählen eigens und nicht in ihrer Zone. */
const TAKT = ["/api/besuch/ping", "/api/realtime", "/ws", "/api/events"];

/** Die öffentliche Schnittstelle: Wege, die auch jemand anders als unsere eigene Seite ruft. */
const OFFEN = ["/api/route", "/api/share", "/api/besuch", "/api/v1", "/api/karten-paket"];

/** Alles, was nur mit Recht geht. */
const EDITOR = [
    "/api/editor",
    "/api/admin",
    "/api/jobs",
    "/api/kanal",
    "/api/auth",
    "/api/account",
    "/api/abgleiche",
    "/api/karten-export",
];

/**
 * Die Zone eines Routennamens. Verglichen wird der Weg von vorn, auf Segmentgrenzen: `/api/routenplaner` ist nicht
 * `/api/route` (Befund der Sicherheitsprüfung am Einstieg: `includes` taugt für solche Vergleiche nicht).
 */
export function apiZone(weg: string): ApiZone | "takt" {
    const beginnt = (praefixe: readonly string[]): boolean =>
        praefixe.some((praefix) => weg === praefix || weg.startsWith(`${praefix}/`));
    if (beginnt(TAKT)) return "takt";
    if (beginnt(EDITOR)) return "editor";
    if (beginnt(OFFEN)) return "offen";
    if (weg.startsWith("/api/")) return "karte";
    return "uebrige";
}

/** Die Klasse einer Antwort; `gestorben` heißt: die Anfrage kam nie bei einer Antwort an. */
export const API_KLASSEN = ["2xx", "3xx", "4xx", "5xx", "gestorben"] as const;
export type ApiKlasse = (typeof API_KLASSEN)[number];

export function apiKlasse(status: number | undefined): ApiKlasse {
    if (status === undefined || status < 100) return "gestorben";
    if (status < 300) return "2xx";
    if (status < 400) return "3xx";
    if (status < 500) return "4xx";
    return "5xx";
}

/** So viele Tage bleiben die Zeilen genau stehen; danach verdichtet der Takt sie auf Monatssummen (Legacys 400 Tage). */
export const API_AUFBEWAHRUNG_TAGE = 400;

/**
 * **Wer fragt** (WI-0307, Handover Claudios 2026-11-10 `api-nutzung-status`; Vali: „Wird die API noch von Dritten benutzt?“).
 *
 * Je Anfrage zählt, woher sie kommt (`herkunft`), und bei einer Anfrage von außen, wie sich das rufende Programm selbst nennt
 * (`absender`). 🔴 Gezählt wird nie die Adresse, nie der ganze User-Agent, nie eine Seitenadresse mit Pfad: von einer fremden Seite
 * nur ihr Hostname, vom Programm nur sein erstes Produktwort ohne Version.
 */
export const API_HERKUENFTE = ["eigene_seite", "fremde_seite", "ohne_seite"] as const;
export type ApiHerkunft = (typeof API_HERKUENFTE)[number];

/**
 * Höchstens so viele verschiedene Absender (und fremde Seiten) je Tag; was darüber kommt, zählt als `andere`. Sonst füllte
 * ein Scanner mit wechselnden Namen die Tafel.
 */
export const API_VIELFALT_JE_TAG = 50;

/** Die festen Namen neben den echten Absendern. `Browser` steht für jeden User-Agent, der mit `Mozilla/` beginnt. */
export const API_ABSENDER = {
    browser: "Browser",
    /** Das erste Produktwort ist länger als 40 Zeichen oder trägt andere Zeichen als `[A-Za-z0-9._-]`. */
    anders: "anders",
    /** Mehr als `API_VIELFALT_JE_TAG` verschiedene an einem Tag. */
    andere: "andere",
    /** Kein User-Agent. */
    ohne: "ohne_angabe",
} as const;

const PRODUKTWORT = /^[A-Za-z0-9._-]{1,40}$/;

/**
 * Wie sich ein Programm nennt: das erste Produktwort des User-Agent, ohne Version (`dsaworld-route-check/1.0 (+https://…)`
 * → `dsaworld-route-check`, `Python-urllib/3.13` → `Python-urllib`, `Mozilla/5.0 (…)` → `Browser`).
 *
 * 🔴 **Dieselbe Regel gilt für Teil B** (Claudios Zählung der Nginx-429, `metric = 'drossel'`): Wer sie dort nachbaut, hält sich an
 * genau diese Schritte. (1) Leerraum außen weg; leer → `ohne_angabe`. (2) Beginnt mit `Mozilla/` (Groß- und Kleinschreibung egal)
 * → `Browser`. (3) Sonst alles bis zum ersten Leerraum oder `/`. (4) Passt das auf `[A-Za-z0-9._-]{1,40}`, bleibt es, wie es
 * ist (Groß- und Kleinschreibung bleibt), sonst `anders`. Die Grenze von 50 je Tag kommt danach.
 *
 * 🪤 Der User-Agent ist frei gewählt. Die Oberfläche sagt deshalb dazu, dass ein Absender sich selbst so nennt.
 */
export function absenderAusKennung(kennung: string | undefined): string {
    const text = (kennung ?? "").trim();
    if (text === "") return API_ABSENDER.ohne;
    if (/^mozilla\//i.test(text)) return API_ABSENDER.browser;
    const produkt = text.split(/[\s/]/, 1)[0] ?? "";
    return PRODUKTWORT.test(produkt) ? produkt : API_ABSENDER.anders;
}

/**
 * **Teil B, der Vertrag** (Claudios Bau, von Vali am 2026-11-11 freigegeben, Verb `api-drossel` im Korridor): Ein Host-Auftrag schreibt die 429 von Nginx, die den Server nie
 * erreichen, als Zeilen mit dieser Metrik. Dimensionen: `<zone>` (die Zahl der 429 je Zone) und `<zone>|<absender>`
 * (`absenderAusKennung`, je Zone höchstens 50 verschiedene, darüber `andere`). Die Anzeige liest sie, sobald es welche gibt.
 */
export const API_DROSSEL_METRIK = "drossel";

/**
 * Der Name einer Drosselzone: die Nginx-Zone ohne `avesmaps3d_` und danach ohne `stage_` oder `prod_` vorn (`avesmaps3d_stage_reise` und
 * `avesmaps3d_prod_reise` → `reise`). 🪤 Die Zonen von Production heißen `avesmaps3d_prod_*` (Claudios Antwort 2026-11-11); ohne `prod_`
 * stünde dort `prod_reise` und auf der Stage `reise`.
 */
export function drosselZone(nginxZone: string): string {
    const name = nginxZone
        .trim()
        .toLowerCase()
        .replace(/^avesmaps3d_/, "")
        .replace(/^(?:stage|prod)_/, "");
    return /^[a-z0-9_]{1,40}$/.test(name) ? name : API_ABSENDER.anders;
}

const Eintrag = Type.Object({ name: Type.String(), wert: Type.Integer() }, { additionalProperties: false });
const Liste = Type.Array(Eintrag);

/** Ein Absender von außen mit dem ersten und letzten Tag, an dem er im Zeitraum fragte. */
const Absender = Type.Object(
    { name: Type.String(), wert: Type.Integer(), erster: Type.String(), letzter: Type.String() },
    { additionalProperties: false },
);

/**
 * Wer fragt (WI-0307). Die Verläufe stehen je Tag in der Reihenfolge von `tage`; die Achse beginnt am ersten Tag mit Zählung,
 * nicht vor Beginn der Zählung (sonst läse sich die leere Zeit davor wie „niemand fragte“).
 */
const WerFragt = Type.Object(
    {
        /** `eigene_seite`, `fremde_seite`, `ohne_seite`; ohne Takt und ohne die Anmeldetür der Stage. */
        herkunft: Liste,
        /** Hostnamen fremder Seiten. */
        fremdeSeiten: Liste,
        /** Absender der Anfragen, die nicht von der eigenen Seite kamen. */
        absender: Type.Array(Absender),
        /** Wege, die von außen gerufen wurden (fremde Seite oder ohne Seite). */
        wegeVonAussen: Liste,
        tage: Type.Array(Type.String()),
        /** `/api/route` und `/api/route/…` von außen, je Tag. */
        routeVonDritten: Type.Array(Type.Integer()),
        /** Die alten Legacy-Pfade, je Tag, und welche es waren. */
        legacy: Type.Array(Type.Integer()),
        legacyPfade: Liste,
        /** Teil B: die 429 von Nginx je Tag, je Zone und je `<zone>|<absender>`. Leer, solange niemand sie schreibt. */
        drossel: Type.Array(Type.Integer()),
        drosselZonen: Liste,
        drosselAbsender: Liste,
    },
    { additionalProperties: false },
);
export type ApiWerFragt = Static<typeof WerFragt>;

/** Eine Diagnose zu einem Fehler im Browser, über die Tage des Zeitraums zusammengezählt (WI-0202, `client-fehler.ts`). */
const BrowserDiagnose = Type.Object(
    {
        art: Type.String(),
        name: Type.String(),
        meldung: Type.String(),
        stellen: Type.Array(Type.String()),
        release: Type.String(),
        browser: Type.String(),
        grafik: Type.String(),
        anzahl: Type.Integer(),
        /** Der letzte Tag, an dem sie auftrat. */
        zuletzt: Type.String(),
    },
    { additionalProperties: false },
);

export const ApiZahlen = Type.Object(
    {
        tage: Type.Integer(),
        von: Type.String(),
        bis: Type.String(),
        kennzahlen: Type.Object(
            {
                anfragen: Type.Integer(),
                /** Anteil der Antworten, die nicht 2xx oder 3xx waren. */
                fehlerquote: Type.Number(),
                spitzenstunde: Type.Union([Type.Integer(), Type.Null()]),
                takt: Type.Integer(),
            },
            { additionalProperties: false },
        ),
        klassen: Liste,
        zonen: Liste,
        wege: Liste,
        fehler: Liste,
        stunden: Type.Array(Type.Integer()),
        speicher: Type.Object({ zeilen: Type.Integer(), bytes: Type.Integer() }, { additionalProperties: false }),
        /**
         * Fehler im Browser (WI-0202): die Zählung je Art aus `visitor_metric` (ohne Automaten) und die häufigsten Diagnosen,
         * höchstens so weit zurück, wie die Frist reicht. Optional, damit eine ältere Oberfläche und ein älterer Server
         * einander nicht stören.
         */
        browserFehler: Type.Optional(
            Type.Object({ arten: Liste, diagnosen: Type.Array(BrowserDiagnose) }, { additionalProperties: false }),
        ),
        /** Wer fragt (WI-0307). Optional aus demselben Grund wie `browserFehler`. */
        werFragt: Type.Optional(WerFragt),
    },
    { additionalProperties: false },
);
export type ApiZahlen = Static<typeof ApiZahlen>;
