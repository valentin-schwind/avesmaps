import type { Queryable } from "../database.ts";
import { berichtBefund, berichtGekuerzt, kuerze, sichererSatz, sicherMelder } from "./muster.ts";

/**
 * Die Meldungen aus dem Kanal für den Abschnitt „💬 Aus der Community“ des Berichts (WI-0255 §3c; Vali 2026-10-26: wie in Legacy Bugs, Ideen und
 * Kartenmeldungen, Melder genannt, auch Ungesichtete, aber nur kurz).
 *
 * - **Datenweg hinter einer schmalen Schnittstelle:** Der Bericht kennt nur `VorgaengeFuerBericht` (`BerichtsVorgang[]`). Heute liest `sammleVorgaenge` den Kanal
 *   in der Datenbank, in der der Bericht läuft; wo es keinen gibt (Production, solange der Kanal auf der Stage lebt), ist die Liste leer und der Abschnitt
 *   entfällt ohne Fehler. Ob der Bericht künftig von der Stage kommt oder eine Exportdatei den Weg bildet (zurückgestellt, Betreiber 2026-10-26), ändert nur
 *   diese eine Funktion.
 * - **Gesichtet** (ein Betreiber hat den Vorgang gesehen, `status <> 'zu_sichten'`): `#Nummer „Kurztitel“ (Melder): eine Zeile Befund`. Der Titel kommt
 *   bereinigt und gekürzt, und leer, wo er nicht öffentlich taugt (Kennung, Verweis, Erwähnung).
 * - 🔴 **Ungesichtet** (`zu_sichten`): fremder, ungeprüfter Text in einem öffentlichen Post. Er geht dem Modell nur als markierte Daten zu
 *   (`ModellMeldung`), nie als Anweisung; der Bericht zeigt `#N (Bug, noch nicht gesichtet)` und, wenn eine geprüfte Zusammenfassung von höchstens 80
 *   Zeichen vorliegt (`pruefeZusammenfassung`), diese dahinter. Die feste Vorlage zeigt sie immer nur in der kurzen Form, nie mit ihrem Text, und nennt
 *   den Melder nicht.
 * - Älteste zuerst, Dubletten (gleicher bereinigter Titel) zusammengefasst als `#139/#149`. Es steht ALLES da, auch unter Community kein „… und N weitere“
 *   (Vali 2026-11-02): Reicht der Platz einer Nachricht nicht, teilt `teilung.ts` den Bericht an den Zeilen auf. Titel (höchstens 100 Zeichen, so lang wie
 *   das Formular sie zulässt) und Befund stehen nie mitten im Satz abgeschnitten da: ein zu langer Befund entfällt (`berichtBefund`). Umlaute sind echt.
 */

export type MeldungsArt = "bug" | "idee" | "karte";
export const MELDUNGS_ARTEN: readonly MeldungsArt[] = ["bug", "idee", "karte"];
const ART_VON_KATEGORIE: Record<string, MeldungsArt> = {
    bug: "bug",
    stoerung: "bug",
    idee: "idee",
    karteninhalt: "karte",
};
const ART_WORT: Record<MeldungsArt, string> = { bug: "Bug", idee: "Idee", karte: "Kartenmeldung" };
const UNGESICHTET = "zu_sichten";

/** So lang darf die Zusammenfassung einer ungesichteten Meldung höchstens sein (Vali: „nur kurz zusammengefasst“, etwa 80 Zeichen). */
export const ZUSAMMENFASSUNG_MAX = 80;
/** Der Titel eines Vorgangs im Bericht: so lang wie das Formular ihn zulässt (`interaktion.ts`, höchstens 100), also nie gekürzt. */
export const TITEL_MAX = 100;
/** Der Befund im Bericht: ganze Sätze, höchstens so viele Zeichen; passt schon der erste Satz nicht, steht kein Befund da. */
export const BEFUND_MAX = 200;

// --- Quelle: die Vorgänge für den Bericht ---

/** Ein Vorgang des Kanals, wie der Bericht ihn braucht: nur diese Felder, nie eine Kennung einer Person. */
export interface BerichtsVorgang {
    /** Die Nummer des Vorgangs (`OPS-000147` → 147). */
    nummer: number;
    /** Die Kategorie des Kanals: `bug`, `stoerung`, `idee`, `karteninhalt`. */
    kategorie: string;
    /** Der Status im Kanal (`zu_sichten`, `neu`, `in_arbeit`, …). */
    status: string;
    /** Gesichtet: Kurztitel oder Titel, bereinigt, höchstens 100 Zeichen (leer, wenn er nicht öffentlich taugt). Ungesichtet: Titel auf 80 Zeichen gekürzt. */
    titel: string;
    /** Der Anzeigename der meldenden Person, bereinigt; `null`, wenn keiner taugt. */
    melder: string | null;
    angelegtAt: string;
    gesichtet: boolean;
    /** Bei Gesichteten die erste Zeile des letzten Befunds, in ganzen Sätzen (höchstens 200 Zeichen, sonst `null`). */
    befund: string | null;
    /** Nur bei Ungesichteten: die Meldung, auf 240 Zeichen gekürzt. Ungeprüfter Text, nur Daten. */
    text: string | null;
}

/** Die Schnittstelle zum Bericht: die offenen Vorgänge für „Aus der Community“, älteste zuerst. */
export type VorgaengeFuerBericht = () => Promise<readonly BerichtsVorgang[]>;

interface VorgangsZeile {
    id: string;
    kategorie: string;
    status: string;
    titel: string | null;
    kurztitel: string | null;
    nachricht: string | null;
    quelle: string;
    melder_name: string | null;
    person_name: string | null;
    gemeldet_at: Date;
    befund: string | null;
}

/** Eine Zeile der Tafel als Vorgang für den Bericht. Rein: Nichts davon geht unbereinigt weiter. */
export function alsBerichtsVorgang(zeile: VorgangsZeile): BerichtsVorgang {
    const gesichtet = zeile.status !== UNGESICHTET;
    const befund = zeile.befund?.split(/\r?\n/u)[0] ?? "";
    return {
        nummer: Number(zeile.id),
        kategorie: zeile.kategorie,
        status: zeile.status,
        titel: gesichtet
            ? berichtGekuerzt(zeile.kurztitel ?? zeile.titel ?? "", TITEL_MAX)
            : kuerze(sichererSatz(zeile.titel ?? ""), 80),
        melder: sicherMelder(zeile.quelle === "discord" ? zeile.melder_name : zeile.person_name),
        angelegtAt: zeile.gemeldet_at.toISOString(),
        gesichtet,
        befund: gesichtet && befund !== "" ? berichtBefund(befund, BEFUND_MAX) || null : null,
        text: gesichtet ? null : kuerze(sichererSatz(zeile.nachricht ?? ""), 240) || null,
    };
}

/**
 * Die Stände, in denen ein Vorgang für die Community nicht mehr offen ist: abgenommen, abgelehnt, beantwortet und `zur_abnahme` (Vali-Befund 2026-11-03: Was
 * behoben ist und nur noch auf die Abnahme der Betreiber wartet, steht nicht als offener Bug da). `zur_abnahme` ist der Stand, in dem die Agenten einen Fix
 * melden; der Betreiber-Kanal führt ihn im Reiter „Abnahme“ (`routes/kanal.ts`), nicht unter „offen“. Der Zustand entscheidet, nie eine Nummer: Bleibt ein
 * Vorgang offen (die Ursache ist nicht gefunden, es lehnt weiter ab), bleibt er in der Liste.
 */
export const NICHT_OFFEN = ["abgenommen", "abgelehnt", "beantwortet", "zur_abnahme"] as const;

/**
 * Die offenen Vorgänge des Kanals in dieser Datenbank für den Bericht: Bugs und Störungen, Ideen und Karteninhalte (alles andere erzählt der Bericht
 * nicht), ohne die Stände in `NICHT_OFFEN`, älteste zuerst, höchstens 500. Die App-Rolle liest die Tafeln des Kanals und den Anzeigenamen der
 * Person, wie die Liste im Betreiber-Kanal es tut (`routes/kanal.ts`); sonst nichts aus `avesmaps_auth`. Fehlt der Kanal oder lässt die Datenbank das Lesen
 * nicht zu, ist die Liste leer: Der Abschnitt entfällt, der Bericht kommt.
 */
export async function sammleVorgaenge(db: Queryable): Promise<BerichtsVorgang[]> {
    try {
        const zeilen = await db<VorgangsZeile[]>`
            SELECT v.id::text, v.kategorie, v.status, v.titel, v.kurztitel, v.nachricht, v.quelle, v.melder_name,
                   p.display_name AS person_name, v.gemeldet_at,
                   (SELECT e.text FROM avesmaps_kanal.eintrag e
                     WHERE e.vorgang_id = v.id AND e.art = 'befund' ORDER BY e.seq DESC LIMIT 1) AS befund
              FROM avesmaps_kanal.vorgang v
              LEFT JOIN avesmaps_auth.person p ON p.id = v.gemeldet_von
             WHERE v.art = 'meldung'
               AND v.abgelaufen_at IS NULL
               AND v.kategorie IN ('bug', 'stoerung', 'idee', 'karteninhalt')
               AND v.status <> ALL(${[...NICHT_OFFEN]}::text[])
             ORDER BY v.gemeldet_at, v.id
             LIMIT 500
        `;
        return zeilen.map(alsBerichtsVorgang);
    } catch {
        return [];
    }
}

// --- Meldungen für den Bericht ---

/** Eine Meldung im Bericht, Dubletten zusammengefasst. Alles Text ist (noch einmal) bereinigt, auch wenn die Datei es schon war. */
export interface Meldung {
    /** Älteste zuerst; mehrere bei einer Dublette (`#139/#149`). */
    nummern: number[];
    art: MeldungsArt;
    gesichtet: boolean;
    /** Gesichtet: der öffentliche Titel (leer, wenn er nicht taugt). Ungesichtet: der gekürzte Titel, nur Daten für das Modell, nie im Bericht. */
    titel: string;
    /** Nur ungesichtet: der gekürzte Text, nur Daten für das Modell. */
    text: string | null;
    melder: string[];
    befund: string | null;
}

export type Meldungen = Record<MeldungsArt, { eintraege: Meldung[]; vorgaenge: number }>;

const normal = (titel: string): string => titel.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

export function sammleMeldungen(vorgaenge: readonly BerichtsVorgang[]): Meldungen {
    const ergebnis: Meldungen = {
        bug: { eintraege: [], vorgaenge: 0 },
        idee: { eintraege: [], vorgaenge: 0 },
        karte: { eintraege: [], vorgaenge: 0 },
    };
    const gleiche = new Map<string, Meldung>();
    for (const vorgang of vorgaenge) {
        const art = ART_VON_KATEGORIE[vorgang.kategorie];
        if (art === undefined) continue;
        const gesichtet = vorgang.gesichtet && vorgang.status !== UNGESICHTET;
        const titel = gesichtet ? berichtGekuerzt(vorgang.titel, TITEL_MAX) : kuerze(sichererSatz(vorgang.titel), 80);
        const melder = gesichtet ? sicherMelder(vorgang.melder) : null;
        const schluessel = normal(titel) === "" ? null : `${art}|${String(gesichtet)}|${normal(titel)}`;
        ergebnis[art].vorgaenge += 1;
        const bekannt = schluessel === null ? undefined : gleiche.get(schluessel);
        if (bekannt !== undefined) {
            bekannt.nummern.push(vorgang.nummer);
            if (melder !== null && !bekannt.melder.includes(melder)) bekannt.melder.push(melder);
            continue;
        }
        const meldung: Meldung = {
            nummern: [vorgang.nummer],
            art,
            gesichtet,
            titel,
            text: gesichtet ? null : kuerze(sichererSatz(vorgang.text ?? ""), 240) || null,
            melder: melder === null ? [] : [melder],
            befund: gesichtet && vorgang.befund !== null ? berichtBefund(vorgang.befund, BEFUND_MAX) || null : null,
        };
        if (schluessel !== null) gleiche.set(schluessel, meldung);
        ergebnis[art].eintraege.push(meldung);
    }
    return ergebnis;
}

/** Was der Abschnitt zeigt: je Art ALLE Meldungen (`gezeigt`) und die Zahl der Vorgänge dahinter (`gesamt`, Dubletten zählen einzeln). */
export interface MeldungsPlan {
    gruppen: { art: MeldungsArt; gezeigt: Meldung[]; gesamt: number }[];
}

/** Der Plan des Abschnitts; `null`, wenn es keine einzige Meldung gibt. Es wird nichts gekürzt: Der Platz einer Nachricht ist Sache von `teilung.ts`. */
export function planMeldungen(meldungen: Meldungen | null): MeldungsPlan | null {
    if (meldungen === null) return null;
    const gruppen = MELDUNGS_ARTEN.map((art) => ({
        art,
        gezeigt: meldungen[art].eintraege,
        gesamt: meldungen[art].vorgaenge,
    }));
    return gruppen.some((gruppe) => gruppe.gezeigt.length > 0) ? { gruppen } : null;
}

/** Die Kennung einer Meldung für die Zusammenfassung des Modells: `m` und ihre erste Nummer. */
export const meldungsId = (meldung: Meldung): string => `m${String(meldung.nummern[0])}`;

/** Die ungesichteten Meldungen im Plan: nur sie gehen (als Daten) an das Modell. */
export const ungesichteteImPlan = (plan: MeldungsPlan | null): Meldung[] =>
    plan === null ? [] : plan.gruppen.flatMap((gruppe) => gruppe.gezeigt.filter((meldung) => !meldung.gesichtet));

export const MELDUNGEN_KOPF = "💬 **Aus der Community**";
const GRUPPEN_KOPF: Record<MeldungsArt, (gesamt: number) => string> = {
    bug: () => "🐞 **Bugs**",
    idee: (gesamt) => `💡 **Ideen (${String(gesamt)})**`,
    karte: () => "🗺️ **Kartenmeldungen**",
};

function meldungsZeile(meldung: Meldung, zusammenfassungen: Readonly<Record<string, string>>): string {
    const nummern = meldung.nummern.map((nummer) => `#${String(nummer)}`).join("/");
    if (!meldung.gesichtet) {
        // 🔴 Nie der Text der Meldung: höchstens die geprüfte Zusammenfassung des Modells.
        const zusammenfassung = zusammenfassungen[meldungsId(meldung)];
        const kurz = `• ${nummern} (${ART_WORT[meldung.art]}, noch nicht gesichtet)`;
        return zusammenfassung === undefined ? kurz : `${kurz}: ${zusammenfassung}`;
    }
    const titel = meldung.titel === "" ? ` (${ART_WORT[meldung.art]})` : ` „${meldung.titel}“`;
    const melder = meldung.melder.length > 0 ? ` (${meldung.melder.slice(0, 2).join("/")})` : "";
    const befund = meldung.befund !== null ? `: ${meldung.befund}` : "";
    return `• ${nummern}${titel}${melder}${befund}`;
}

/** Der Abschnitt als Text, alle Meldungen. `zusammenfassungen`: die geprüften Zusammenfassungen des Modells je Kennung (`meldungsId`). */
export function meldungsAbschnitt(
    plan: MeldungsPlan | null,
    zusammenfassungen: Readonly<Record<string, string>> = {},
): string | null {
    if (plan === null) return null;
    const zeilen = [MELDUNGEN_KOPF];
    for (const gruppe of plan.gruppen) {
        if (gruppe.gezeigt.length === 0) continue;
        zeilen.push(GRUPPEN_KOPF[gruppe.art](gruppe.gesamt));
        zeilen.push(...gruppe.gezeigt.map((meldung) => meldungsZeile(meldung, zusammenfassungen)));
    }
    return zeilen.join("\n");
}

/** Was ein Formulierer von einer ungesichteten Meldung sieht: gekürzte Daten, ausdrücklich ohne Anweisungskraft. */
export interface ModellMeldung {
    id: string;
    nummern: number[];
    art: MeldungsArt;
    daten: { titel: string; text: string | null };
}

export const modellMeldungen = (plan: MeldungsPlan | null): ModellMeldung[] =>
    ungesichteteImPlan(plan).map((meldung) => ({
        id: meldungsId(meldung),
        nummern: meldung.nummern,
        art: meldung.art,
        daten: { titel: meldung.titel, text: meldung.text },
    }));
