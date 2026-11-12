import type { DiscordEintrag, DiscordFakt, DiscordFakten, DiscordFaktArt } from "@avesmaps3d/shared";
import type { MeldungsPlan, ModellMeldung } from "./meldungen.ts";
import { hintergrund, neuSatz } from "./muster.ts";
import type { Tageszeit } from "./zeit.ts";

/**
 * Die Punkte der festen Vorlage (WI-0255 §3b): ALLE Punkte aus dem Faktenbestand, nichts wird gekürzt oder weggelassen (Vali 2026-11-02: kein „… und n
 * weitere“). Passen sie nicht in eine Nachricht, verteilt `teilung.ts` sie auf mehrere. Seit §3e bekommt der Formulierer nicht diese Auswahl, sondern alle
 * Neuerungen je Commit (`sammleNeuerungen`) und wählt selbst aus.
 *
 * - Zwei **Teile**, die nie verschwimmen: `neu` (Production, `live`: „Was ist neu?“) und `entwicklung` (Stage, `getestet` und `laufend`: „Was ist in
 *   Entwicklung?“).
 * - Die Kennung eines Punkts ist `n1`, `n2`, … im Teil `neu` und `e1`, `e2`, … in `entwicklung`; Merkmale zuerst, Behebungen danach. Sie gilt nur für
 *   diesen einen Bericht.
 * - Umlaute: Die Quellen schreiben oft `ae`, `oe`, `ue`; im Bericht stehen echte Umlaute (`berichtSatz`).
 */

export const TEILE = ["neu", "entwicklung"] as const;
export type Teil = (typeof TEILE)[number];

/** Ein Punkt der festen Vorlage. `text` ist die bereinigte `Neu:`-Zeile (`sichererSatz`). */
export interface BerichtPunkt {
    id: string;
    teil: Teil;
    art: DiscordFaktArt;
    text: string;
}

/** Merkmale vor Behebungen; die Reihenfolge innerhalb einer Art bleibt. */
export function merkmaleZuerst<T extends { art: DiscordFaktArt }>(punkte: readonly T[]): T[] {
    return [...punkte.filter((punkt) => punkt.art === "feature"), ...punkte.filter((punkt) => punkt.art === "fix")];
}

const KENNUNG_VORSATZ: Record<Teil, string> = { neu: "n", entwicklung: "e" };

/** Die Quelle eines Teils im Faktenbestand. */
function quelle(fakten: DiscordFakten, teil: Teil): readonly DiscordFakt[] {
    return teil === "neu" ? fakten.production.neu : fakten.werkstatt.neu;
}

/** Alle Punkte, Merkmale vor Behebungen, je Teil durchnummeriert. */
export function sammlePunkte(fakten: DiscordFakten): BerichtPunkt[] {
    const punkte: BerichtPunkt[] = [];
    for (const teil of TEILE) {
        const alle = quelle(fakten, teil)
            .map((fakt) => ({ art: fakt.art, text: neuSatz(fakt.satz) }))
            .filter((fakt) => fakt.text !== "")
            // Dieselbe Aussage nur einmal (nach dem Bereinigen können zwei verschiedene Quellsätze gleich lauten).
            .filter((fakt, i, liste) => liste.findIndex((andere) => andere.text === fakt.text) === i);
        merkmaleZuerst(alle).forEach((fakt, i) => {
            punkte.push({ id: `${KENNUNG_VORSATZ[teil]}${String(i + 1)}`, teil, art: fakt.art, text: fakt.text });
        });
    }
    return punkte;
}

/** So viele Neuerungen je Teil sieht das Modell höchstens, die neuesten; Betreff und Beschreibung gekürzt (WI-0255 §3e, Eingabe unter 256 KB). */
export const MODELL_NEUERUNGEN_MAX = 40;
export const MODELL_BETREFF_MAX = 160;
export const MODELL_BESCHREIBUNG_MAX = 400;

/**
 * Eine Neuerung, wie das Modell sie bekommt (WI-0255 §3e): ein Commit mit fester Kennung (`n1` … in „neu“, `e1` … in „entwicklung“, nur für diesen
 * Bericht). `neu` sind die redigierten Sätze für die Öffentlichkeit; `betreff`, `beschreibung` und `bereich` sind Hintergrund, geglättet
 * (`hintergrund`). `gruppe` (`g1`, `g2` …) steht für den Scope des Commits: Neuerungen derselben Gruppe gehören zu einer Sache.
 */
export interface ModellNeuerung {
    id: string;
    teil: Teil;
    art: DiscordFaktArt;
    gruppe: string | null;
    bereich: string[];
    neu: string[];
    betreff: string;
    beschreibung: string;
}

/** Die Einträge eines Teils; ein Bestand ohne Einträge (vor §3e) gibt seine Sätze als Einträge ohne Hintergrund. */
function eintraegeVon(fakten: DiscordFakten, teil: Teil): readonly DiscordEintrag[] {
    const eintraege = teil === "neu" ? fakten.production.eintraege : fakten.werkstatt.eintraege;
    if (eintraege !== undefined) return eintraege;
    return quelle(fakten, teil).map((fakt) => ({
        status: fakt.status,
        art: fakt.art,
        saetze: [fakt.satz],
        betreff: "",
        scope: null,
        beschreibung: "",
        bereich: [],
    }));
}

/** Der Schlüssel einer Gruppe: die erste Kennung eines Arbeitspakets im Scope, sonst der Scope selbst. */
const gruppenSchluessel = (scope: string): string => /WI-\d{4}/u.exec(scope)?.[0] ?? scope;

/**
 * Alle Neuerungen für das Modell, je Teil die neuesten `MODELL_NEUERUNGEN_MAX`, älteste zuerst. Ein Commit ohne öffentlichen Satz und ohne
 * brauchbaren Betreff fällt weg (es gäbe nichts zu erzählen). Ein Satz, den eine frühere Neuerung schon trägt, steht nur dort (Vali 2026-11-03: dieselbe
 * Aussage nicht zweimal); eine Neuerung, deren Sätze alle schon dastehen, fällt ganz weg.
 */
export function sammleNeuerungen(fakten: DiscordFakten): ModellNeuerung[] {
    const gruppen = new Map<string, string>();
    const gruppeVon = (scope: string | null): string | null => {
        if (scope === null) return null;
        const schluessel = gruppenSchluessel(scope);
        if (!gruppen.has(schluessel)) gruppen.set(schluessel, `g${String(gruppen.size + 1)}`);
        return gruppen.get(schluessel)!;
    };
    const neuerungen: ModellNeuerung[] = [];
    const erzaehlt = new Set<string>();
    for (const teil of TEILE) {
        let nummer = 0;
        for (const eintrag of eintraegeVon(fakten, teil).slice(-MODELL_NEUERUNGEN_MAX)) {
            const saetze = eintrag.saetze.map(neuSatz).filter((satz) => satz !== "");
            const neu = saetze.filter((satz) => !erzaehlt.has(satz));
            if (saetze.length > 0 && neu.length === 0) continue;
            for (const satz of neu) erzaehlt.add(satz);
            const betreff = hintergrund(eintrag.betreff, MODELL_BETREFF_MAX);
            if (neu.length === 0 && betreff === "") continue;
            nummer += 1;
            neuerungen.push({
                id: `${KENNUNG_VORSATZ[teil]}${String(nummer)}`,
                teil,
                art: eintrag.art,
                gruppe: gruppeVon(eintrag.scope),
                bereich: eintrag.bereich,
                neu,
                betreff,
                beschreibung: hintergrund(eintrag.beschreibung, MODELL_BESCHREIBUNG_MAX),
            });
        }
    }
    return neuerungen;
}

/** Der Satz für einen Tag, an dem für Kartenbesucher nichts Neues live ging (der Ruhetag-Satz der früheren Tagesberichte). */
export const RUHETAG_SATZ =
    "Für Kartenbesucher gab es diesmal keine neuen Funktionen — wir arbeiten im Hintergrund weiter. 🛠️";

/** Schon berichtete Neuerungen, die in der Entwicklung noch auf ihren Weg nach avesmaps.de warten. */
export const wartenSatz = (n: number): string =>
    n === 1
        ? "Eine Neuerung, von der wir schon erzählt haben, wartet noch auf ihren Weg nach avesmaps.de."
        : `${String(n)} Neuerungen, von denen wir schon erzählt haben, warten noch auf ihren Weg nach avesmaps.de.`;

/**
 * Der Satz, der in einem Teil ohne Punkte steht, ehrlich zum Stand der Quellen: kein Vergleich möglich heißt „können wir nicht belegen“, nie „nichts
 * Neues“. Die Vorlage setzt ihn ein, der Formulierer bekommt ihn in der Eingabe (`leer`) und muss ihn wörtlich übernehmen, damit kein Modell einen
 * Stand erfindet.
 */
export function leerSatz(fakten: DiscordFakten, teil: Teil): string {
    if (teil === "neu") {
        switch (fakten.production.vergleich) {
            case "erster":
                return "Ab heute berichten wir hier jeden Tag. Was ab jetzt auf avesmaps.de live geht, steht an dieser Stelle.";
            case "unbekannt":
                return "Ob seit dem letzten Bericht etwas auf avesmaps.de live gegangen ist, können wir heute nicht sicher belegen, darum steht hier nichts.";
            default:
                return RUHETAG_SATZ;
        }
    }
    const { werkstatt } = fakten;
    if (werkstatt.vergleich === "ohne_quelle" || werkstatt.vergleich === "unbekannt") {
        return "Zur Entwicklung haben wir heute keinen belastbaren Stand, darum lassen wir sie heute aus.";
    }
    if (werkstatt.vergleich === "gleich") {
        return "Die Entwicklung steht gerade auf demselben Stand wie avesmaps.de: Alles, was wir gebaut haben, ist schon live.";
    }
    return werkstatt.weiterhin > 0
        ? `Seit dem letzten Bericht ist nichts Neues dazugekommen. ${wartenSatz(werkstatt.weiterhin)}`
        : "Seit dem letzten Bericht ist in der Entwicklung nichts Neues dazugekommen.";
}

/**
 * Was ein Formulierer für den ganzen Bericht bekommt, und wogegen die Prüfung seinen Text hält (`pruefeModellBericht`). Alles hier ist aus dem
 * Faktenbestand und der Uhr der App gerechnet; nichts davon stammt vom Modell.
 */
export interface BerichtKontext {
    tag: string;
    /** Das Datum der Titelzeile, `26.10.2026`. */
    datum: string;
    tageszeit: Tageszeit;
    /** Die erste Zeile des Berichts, wörtlich. */
    titel: string;
    /** Die letzte Zeile des Berichts, wörtlich. */
    schluss: string;
    /** Alle Neuerungen, aus denen das Modell auswählt (`sammleNeuerungen`). */
    neuerungen: ModellNeuerung[];
    /** Der Satz, der in einem Teil ohne Neuerungen wörtlich stehen muss; `null` bei einem Teil mit Neuerungen. */
    leer: Record<Teil, string | null>;
    /** So viele Zeichen darf der Text des Formulierers höchstens haben (`MODELL_TEXT_MAX`): eine Obergrenze gegen Ausreißer, die App teilt den Text in Nachrichten. */
    max: number;
    /** Der Dank-Abschnitt (`gemeinschaftAbschnitt`) oder `null` ohne Beiträge; ihn setzt die App ein, nicht das Modell. */
    gemeinschaft: string | null;
    /**
     * Die Community-Liste (WI-0255 §3c), die ganze, oder `null` ohne Meldungen. Die App hängt sie nach dem Text des Modells an (`schreibeMit`). Das Modell
     * schreibt sie nicht; es fasst nur die ungesichteten kurz zusammen (`meldungen`).
     */
    meldungsPlan: MeldungsPlan | null;
    /** 🔴 Die ungesichteten Meldungen im Plan als gekürzte Daten, nie als Anweisung: Ungeprüfter Text aus Discord. */
    meldungen: ModellMeldung[];
}
