import { BEWERTUNG_ZUERST_GEZEIGT, type ReviewEntry, type SubjectReviewsSection } from "@avesmaps3d/shared";
import { formatNumber, t, tPlural } from "../i18n/i18n";
import { starsOf, type StarFill } from "./catalog-model";

/**
 * Was der Reiter „Bewertungen“ im Infopanel eines Orts rechnet (WI-0269 C10; Bedienkonzept §6.3, Probierseite `review/wi-0263/quelle.html`, Variante „Reiter“), ohne Browser:
 * die Zeile im Kopf („3,8 ★★★★½ (10 Bewertungen)“), Wert, Verteilung und Liste, die Adresse eines Links auf eine Bewertung. Wie es aussieht, steht in `info-bewertungen.vue`
 * und `info-bewertungszeile.vue`.
 *
 * - **Sterne wie im Produkt** (Design Guide §16.6, `starsOf`): voll ab der Stufe, halb ab einer halben Stufe darunter, am selben Zeichen.
 * - **Zuerst zwölf** (Legacys Client), mit „Alle N zeigen“ die übrigen bis zur Grenze des Servers (`SUBJECT_REVIEW_LIMIT`).
 * - **Die Verteilung** zählt der Server über ALLE öffentlichen Bewertungen (`distribution`, 5 bis 1 Stern); die Balken sind relativ zur größten Zahl.
 * - 🔴 Ein Ort ohne Bewertung zeigt „Noch keine Bewertung“; den Reiter haben alle Orte, damit der Aufbau stabil bleibt (Bedienkonzept §6.3).
 */

/** Eine Bewertung in der Liste des Reiters. */
export interface BewertungsZeile {
    /** Schlüssel der Zeile: die öffentliche Kennung, wo der Server sie nennt, sonst die Stelle. */
    key: string;
    /** Die Kennung, die „Teilen“, „Gefällt mir“ und „Melden“ brauchen; fehlt bei Antworten eines älteren Servers (dann ohne diese drei). */
    id: string | undefined;
    /** „⟨Autor⟩ schreibt (⟨Datum⟩):“, ein leerer Autor heißt „Anonym“. */
    head: string;
    stars: StarFill[];
    starsLabel: string;
    /** Der Text in Anführungszeichen; leer, wo keiner steht. */
    text: string;
    /** Wie viele „Gefällt mir“; 0 zeigt keine Zahl. */
    likes: number;
}

export interface VerteilungsZeile {
    stufe: 5 | 4 | 3 | 2 | 1;
    anzahl: number;
    /** Breite des Balkens, 0 bis 1, relativ zur größten Zahl. */
    anteil: number;
}

export interface BewertungenAnsicht {
    anzahl: number;
    /** Der Durchschnitt mit einer Nachkommastelle („3,8“); leer ohne Bewertung. */
    wert: string;
    sterne: StarFill[];
    /** Der Wert für Bildschirmleser („3,8 von 5 Sternen“). */
    wertLabel: string;
    /** „10 Bewertungen“, „1 Bewertung“. */
    zaehlung: string;
    /** Der Tooltip am Durchschnitt nennt die Datenbasis: „Durchschnitt der 23 sichtbaren Bewertungen“. */
    datenbasis: string;
    verteilung: VerteilungsZeile[];
    /** Die Zeilen, die jetzt stehen: zuerst zwölf, mit `alle` alle gelieferten. */
    zeilen: BewertungsZeile[];
    /** Wie viele Zeilen „Alle N zeigen“ noch dazuholt; 0: der Knopf entfällt. */
    weitere: number;
    /** Die Zahl für „Alle N zeigen“: alle gelieferten Bewertungen. */
    gesamtGeliefert: number;
}

export function zeileOf(eintrag: ReviewEntry, index: number): BewertungsZeile {
    const autor = (eintrag.author ?? "").trim() === "" ? t("infoPanel.reviews.anonymous") : (eintrag.author as string);
    const datum = eintrag.date;
    return {
        key: eintrag.id ?? String(index),
        id: eintrag.id,
        head:
            datum === undefined
                ? t("infoPanel.reviews.writes", { author: autor })
                : t("infoPanel.reviews.writesDate", { author: autor, date: datum }),
        stars: starsOf(eintrag.stars),
        starsLabel: t("infoPanel.reviews.starsLabel", { n: formatNumber(eintrag.stars, 0) }),
        text: eintrag.text === undefined ? "" : t("infoPanel.reviews.quote", { text: eintrag.text }),
        likes: eintrag.likes ?? 0,
    };
}

const STUFEN = [5, 4, 3, 2, 1] as const;

export function verteilungOf(verteilung: readonly number[] | undefined): VerteilungsZeile[] {
    const zahlen = STUFEN.map((_stufe, index) => Math.max(0, verteilung?.[index] ?? 0));
    const groesste = Math.max(1, ...zahlen);
    return STUFEN.map((stufe, index) => ({
        stufe,
        anzahl: zahlen[index] ?? 0,
        anteil: (zahlen[index] ?? 0) / groesste,
    }));
}

/** Die Ansicht des Reiters aus der Antwort der Sektion; ohne Antwort steht sie leer da. */
export function bewertungenAnsichtOf(section: SubjectReviewsSection | undefined, alle: boolean): BewertungenAnsicht {
    const anzahl = section?.count ?? 0;
    const durchschnitt = section?.average;
    const eintraege = section?.reviews ?? [];
    const sichtbar = alle ? eintraege : eintraege.slice(0, BEWERTUNG_ZUERST_GEZEIGT);
    return {
        anzahl,
        wert: durchschnitt === undefined ? "" : formatNumber(durchschnitt, 1),
        sterne: starsOf(durchschnitt ?? 0),
        wertLabel:
            durchschnitt === undefined ? "" : t("infoPanel.reviews.starsLabel", { n: formatNumber(durchschnitt, 1) }),
        zaehlung: tPlural("infoPanel.reviews.count", anzahl, { n: formatNumber(anzahl, 0) }),
        datenbasis: tPlural("bewertungen.durchschnitt", anzahl, { n: formatNumber(anzahl, 0) }),
        verteilung: verteilungOf(section?.distribution),
        zeilen: sichtbar.map(zeileOf),
        weitere: alle ? 0 : Math.max(0, eintraege.length - BEWERTUNG_ZUERST_GEZEIGT),
        gesamtGeliefert: eintraege.length,
    };
}

/** Die Zeile im Kopf unter OFFIZIELL. `keine`: „Noch keine Bewertung“; sonst Wert, Sterne und Zählung. */
export type Kopfzeile =
    | { art: "keine" }
    | { art: "wert"; wert: string; sterne: StarFill[]; label: string; zaehlung: string; datenbasis: string };

export function kopfzeileOf(section: SubjectReviewsSection): Kopfzeile {
    if (section.count === 0 || section.average === undefined) return { art: "keine" };
    const ansicht = bewertungenAnsichtOf(section, false);
    return {
        art: "wert",
        wert: ansicht.wert,
        sterne: ansicht.sterne,
        label: ansicht.wertLabel,
        zaehlung: ansicht.zaehlung,
        datenbasis: ansicht.datenbasis,
    };
}

/**
 * Die Adresse, die dasselbe Infopanel mit dieser Bewertung öffnet: der Ort über seine Kennung (`?place=`, immer auflösbar) und `bewertung=` (WI-0269). Der Ort steht
 * nicht über den Wiki-Namen darin, weil `bewertung=` an einen Ort gebunden ist, dessen Kennung die Seite kennt.
 */
export function bewertungsAdresse(basis: string, ortId: string, bewertungId: string): string {
    return `${basis}?place=${encodeURIComponent(ortId)}&bewertung=${encodeURIComponent(bewertungId)}`;
}

const KENNUNG = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** Liest `place=` und `bewertung=` aus der Suche der Adresse; beides muss eine Kennung sein, sonst nichts. */
export function leseBewertungsLink(suche: string): { ort: string; bewertung: string } | undefined {
    const parameter = new URLSearchParams(suche);
    const ort = parameter.get("place")?.toLowerCase() ?? "";
    const bewertung = parameter.get("bewertung")?.toLowerCase() ?? "";
    return KENNUNG.test(ort) && KENNUNG.test(bewertung) ? { ort, bewertung } : undefined;
}
