import { BEWERTUNG_GRENZEN, COMMUNITY_GRENZEN } from "@avesmaps3d/shared";
import { ApiFailure } from "../auth/api";
import { locale, t } from "../i18n/i18n";
import { relativeTime } from "../i18n/relative-time";
import { genauerGrund, type Abbildung, type FeldSatz, type GrundSatz } from "../system/ablehnung";
import { fehlerArt, sperreBis } from "./api";

/**
 * Die Sätze zu den Ablehnungen der Besucherfenster (WI-0291; Vali 2026-11-08: „ich will genau fehlermeldungen und wissen, was ich zu tun habe“): Kontakt, Meldung, Statusseite, Bewertung
 * schreiben und melden, „Gefällt mir“ und „Mit Discord verbinden“. Der Server schickt in `details.reason` einen Fachcode (Sätze der Datenbank über `gruende-besucher.ts`, das Datum der Bewertung
 * aus `routes/bewertungen.ts`); jeder Satz hier nennt den Grund UND was zu tun ist. Ein Fenster ruft `besucherSatz` und zeigt das Ergebnis statt seines allgemeinen Satzes.
 *
 * - **Längen stehen hier als Zahl aus den Grenzen** (`COMMUNITY_GRENZEN`, `BEWERTUNG_GRENZEN`), nicht im Satz der Sprachtafel fest verdrahtet.
 * - **Drossel (429):** die Uhrzeit rechnet das Fenster aus `retryAfterSeconds` (`sperreBis`); der Platzhalter `{uhr}` bleibt nie wörtlich stehen.
 */

const text = (key: Parameters<typeof t>[0]) => (): string => t(key);

// --- Die Gründe je Fachcode (`details.reason`) ----------------------------------------------------------------------------------------

/** Was alle Fenster gleich sagen. Die Abbildungen unten setzen darauf auf und fügen ihre eigenen Sätze hinzu. */
const GEMEINSAM: Readonly<Record<string, GrundSatz>> = {
    name_zu_lang: () => t("community.ablehnung.nameLang", { max: COMMUNITY_GRENZEN.nameMax }),
    schluessel_fehlt: text("community.ablehnung.schluesselFehlt"),
    kategorie_unbekannt: text("community.ablehnung.kategorieUnbekannt"),
};

// --- Felder eines Schemafehlers (`details.issues`) ------------------------------------------------------------------------------------

/** Eine Regel nennt `maxLength`, `minLength` … ; ein Feld sagt je Regel seinen Satz, und `undefined`, wenn die Regel nichts Eigenes hat (dann gilt der Rückfall). */
const nach =
    (regeln: Readonly<Record<string, () => string>>): FeldSatz =>
    (regel) =>
        regeln[regel]?.();

const NAME_FELD = nach({ maxLength: () => t("community.ablehnung.nameLang", { max: COMMUNITY_GRENZEN.nameMax }) });

/** Kontaktformular: Nachricht (`text`), Name, Mailadresse, Thema. */
export const KONTAKT_ABLEHNUNG: Abbildung = {
    gruende: {
        ...GEMEINSAM,
        nachricht_laenge: () =>
            t("community.ablehnung.nachrichtLaenge", {
                min: COMMUNITY_GRENZEN.textMin,
                max: COMMUNITY_GRENZEN.textMax,
            }),
        adresse_falsch: text("community.ablehnung.adresseFalsch"),
    },
    felder: {
        text: nach({
            minLength: () =>
                t("community.ablehnung.nachrichtLaenge", {
                    min: COMMUNITY_GRENZEN.textMin,
                    max: COMMUNITY_GRENZEN.textMax,
                }),
            maxLength: () =>
                t("community.ablehnung.nachrichtLaenge", {
                    min: COMMUNITY_GRENZEN.textMin,
                    max: COMMUNITY_GRENZEN.textMax,
                }),
        }),
        name: NAME_FELD,
        mail: nach({
            maxLength: () => t("community.ablehnung.adresseFalsch"),
            pattern: () => t("community.ablehnung.adresseFalsch"),
        }),
        kategorie: nach({ enum: () => t("community.ablehnung.kategorieUnbekannt") }),
    },
};

/** Meldeformular: Beschreibung (`text`), Quelle, Name, Art der Meldung. */
export const MELDUNG_ABLEHNUNG: Abbildung = {
    gruende: {
        ...GEMEINSAM,
        beschreibung_laenge: () =>
            t("community.ablehnung.beschreibungLaenge", {
                min: COMMUNITY_GRENZEN.textMin,
                max: COMMUNITY_GRENZEN.textMax,
            }),
        schluessel_bezug_fehlt: text("community.ablehnung.bezugFehlt"),
    },
    felder: {
        text: nach({
            minLength: () =>
                t("community.ablehnung.beschreibungLaenge", {
                    min: COMMUNITY_GRENZEN.textMin,
                    max: COMMUNITY_GRENZEN.textMax,
                }),
            maxLength: () =>
                t("community.ablehnung.beschreibungLaenge", {
                    min: COMMUNITY_GRENZEN.textMin,
                    max: COMMUNITY_GRENZEN.textMax,
                }),
        }),
        quelle: nach({ maxLength: () => t("community.ablehnung.quelleLang", { max: COMMUNITY_GRENZEN.quelleMax }) }),
        name: NAME_FELD,
        kategorie: nach({ enum: () => t("community.ablehnung.kategorieUnbekannt") }),
        fehltArt: nach({ enum: () => t("community.ablehnung.fehltArtUnbekannt") }),
    },
};

/** Statusseite: Antwort (`text`), Zurückziehen. `anfrage`: Die Seite gehört zu einer Nachricht aus dem Kontaktformular, nicht zu einer Meldung. */
export function statusAblehnung(anfrage: boolean): Abbildung {
    return {
        gruende: {
            meldung_zurueckgezogen: text(
                anfrage ? "community.ablehnung.zurueckgezogenAnfrage" : "community.ablehnung.zurueckgezogen",
            ),
            vorgang_abgeschlossen: text(
                anfrage ? "community.ablehnung.abgeschlossenAnfrage" : "community.ablehnung.abgeschlossen",
            ),
            vorgang_unbekannt: text("community.status.fehlt"),
        },
        felder: {
            text: nach({
                minLength: text("community.ablehnung.antwortLeer"),
                maxLength: () => t("community.ablehnung.antwortLang", { max: COMMUNITY_GRENZEN.nachrichtMax }),
            }),
        },
    };
}

/** Bewertung schreiben: Sterne, Text, Name, Datum, Ort. */
export const BEWERTUNG_ABLEHNUNG: Abbildung = {
    gruende: {
        ...GEMEINSAM,
        sterne: text("bewertungen.ablehnung.sterne"),
        text_zu_lang: () => t("bewertungen.ablehnung.textLang", { max: BEWERTUNG_GRENZEN.textMax }),
        datum_zu_lang: () => t("bewertungen.ablehnung.datumLang", { max: BEWERTUNG_GRENZEN.datumMax }),
        // Aus `routes/bewertungen.ts` (TypeScript, nicht die Datenbank): das Datum ließ sich nicht als aventurisches lesen.
        datum_ungueltig: text("bewertungen.ablehnung.datumUngueltig"),
        ort_unbekannt: text("bewertungen.ablehnung.ortFehlt"),
    },
    felder: {
        sterne: nach({
            minimum: text("bewertungen.ablehnung.sterne"),
            maximum: text("bewertungen.ablehnung.sterne"),
            type: text("bewertungen.ablehnung.sterne"),
        }),
        text: nach({ maxLength: () => t("bewertungen.ablehnung.textLang", { max: BEWERTUNG_GRENZEN.textMax }) }),
        name: NAME_FELD,
        datum: nach({ maxLength: () => t("bewertungen.ablehnung.datumLang", { max: BEWERTUNG_GRENZEN.datumMax }) }),
    },
};

/** Bewertung melden: Grund, Beschreibung. Der Rückfallsatz (`bewertungen.ablehnung.meldenUngueltig`) nennt nur diese zwei Felder. */
export const BEWERTUNG_MELDEN_ABLEHNUNG: Abbildung = {
    gruende: {
        grund_fehlt: text("bewertungen.ablehnung.grundFehlt"),
        beschreibung_zu_lang: () =>
            t("bewertungen.ablehnung.beschreibungLang", { max: BEWERTUNG_GRENZEN.beschreibungMax }),
        bewertung_unbekannt: text("bewertungen.ablehnung.meldenBewertungFehlt"),
        schluessel_fehlt: text("community.ablehnung.schluesselFehlt"),
    },
    felder: {
        grund: nach({ enum: text("bewertungen.ablehnung.grundFehlt") }),
        text: nach({
            maxLength: () => t("bewertungen.ablehnung.beschreibungLang", { max: BEWERTUNG_GRENZEN.beschreibungMax }),
        }),
    },
};

/** „Gefällt mir“: die Bewertung gibt es nicht mehr (404) oder der Schritt stimmt nicht (422). */
export const GEFAELLT_ABLEHNUNG: Abbildung = {
    gruende: {
        bewertung_unbekannt: text("bewertungen.ablehnung.gefaelltFehlt"),
        gefaellt_schritt: text("bewertungen.ablehnung.gefaelltSchritt"),
    },
};

// --- Der Satz zu einem Fehler ---------------------------------------------------------------------------------------------------------

/** Die Uhrzeit, ab der es nach einer Drossel wieder geht, als Text für `{uhr}`; nie leer. */
export function sperreUhr(fehler: unknown, jetzt: Date = new Date()): string {
    const bis = sperreBis(fehler, jetzt);
    return bis === undefined ? "" : relativeTime(bis, jetzt, locale.value, "zeitpunkt");
}

/** 413: Der Rumpf der Anfrage war größer als erlaubt (sehr lange Texte in Sprachen mit mehrteiligen Zeichen). */
const istZuGross = (fehler: unknown): boolean => fehler instanceof ApiFailure && fehler.status === 413;

export interface BesucherSaetze {
    /** Der Satz zu einer Drossel (429); `{uhr}` gibt das Fenster nicht selbst mit. */
    readonly zuViele: Parameters<typeof t>[0];
    /** Der Satz für alles, was weder einen Fachcode noch einen Satz des Servers hat (die allgemeinen Sätze des Fensters). */
    readonly rueckfall: (art: ReturnType<typeof fehlerArt>) => string;
}

/**
 * Der Satz, den ein Fenster zu einem fehlgeschlagenen Aufruf zeigt: der genaue Grund (Fachcode, Feld oder Satz des Servers), sonst bei einer Drossel der Satz mit der Uhrzeit, bei zu großem Rumpf der
 * Hinweis zum Kürzen, sonst der allgemeine Satz des Fensters.
 */
export function besucherSatz(fehler: unknown, abbildung: Abbildung, saetze: BesucherSaetze): string {
    const grund = genauerGrund(fehler, abbildung);
    if (grund !== undefined) return grund;
    if (istZuGross(fehler)) return t("community.ablehnung.zuGross");
    const art = fehlerArt(fehler);
    if (art === "zu_viele") return t(saetze.zuViele, { uhr: sperreUhr(fehler) });
    return saetze.rueckfall(art);
}
