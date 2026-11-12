import {
    BEWERTUNG_GRUENDE,
    BEWERTUNG_HERKUENFTE,
    BEWERTUNG_SEGMENTE,
    type BewertungDetail,
    type BewertungListe,
    type BewertungSegment,
    type BewertungVerlauf,
    type BewertungZeile,
    type BewertungZustand,
} from "@avesmaps3d/shared";
import type { Kreis } from "../editor-liste/liste-modell";
import { formatNumber, isMessageKey, t } from "../i18n/i18n";
import type { MessageKey } from "../i18n/de";
import { starsOf, type StarFill } from "../info-panel/catalog-model";
import { zeitAbstand } from "./meldungen-modell";

/**
 * Was der Unterreiter „Community › Bewertungen“ und das Fenster einer Bewertung rechnen (WI-0269 C10; Bedienkonzept §6.1 und §6.2, Fachkonzept §14), ohne Browser: Segmente und Zahlen, der Kreis je Zustand,
 * die Zeile der Liste, die Legende, was die Handgriffe dürfen (Zustand und Recht) und warum nicht, der Satz „jetzt ★ 4,3 aus 12 · nach dem Verbergen ★ 4,5 aus 11“, der Verlauf.
 * Wie es aussieht, steht in `bewertungen-liste.vue` und `bewertung-redaktion-fenster.vue`.
 *
 * - **Segmente:** Zu sichten · Sichtbar · Verborgen, je mit Zahl. „Zu sichten“ fasst neue, zurückgehaltene und gemeldete zusammen (der Server wählt aus).
 * - **Kreise** (Guide §13.17, ein Ton, Stufen über die Füllung): ○ neu, ◑ zurückgehalten, ● gesichtet, ◌ verborgen (gepunkteter Ring).
 * - 🔴 **Gesperrt heißt: ein Satz.** „Inhalt löschen …“ braucht `moderate_community`; ohne das Recht steht der Knopf mit dem Grund da, nie stumm weg.
 */

export const LISTEN_SEGMENTE = BEWERTUNG_SEGMENTE;
export type ListenSegment = BewertungSegment;

/** Die Kreise der Liste: ○ neu, ◑ zurückgehalten, ● gesichtet, ◌ verborgen (`gestrichelt` zeichnet den gepunkteten Ring). */
export type BewertungsKreis = Kreis | "gestrichelt";

const KREIS_VON_ZUSTAND: Readonly<Record<BewertungZustand, BewertungsKreis>> = {
    neu: "leer",
    zurueckgehalten: "halb-rechts",
    gesichtet: "voll",
    verborgen: "gestrichelt",
};
export const kreisVon = (zustand: BewertungZustand): BewertungsKreis => KREIS_VON_ZUSTAND[zustand];

export const ZUSTAND_NAME: Readonly<Record<BewertungZustand, MessageKey>> = {
    neu: "bewertungen.redaktion.zustand.neu",
    zurueckgehalten: "bewertungen.redaktion.zustand.zurueckgehalten",
    gesichtet: "bewertungen.redaktion.zustand.gesichtet",
    verborgen: "bewertungen.redaktion.zustand.verborgen",
};

const nachschlagen = (key: string): string | undefined => (isMessageKey(key) ? t(key) : undefined);

/** Der Grund in Worten („Beleidigend“); ein unbekannter bleibt, wie er kommt. */
export const grundName = (grund: string | null): string =>
    grund === null ? "" : (nachschlagen(`bewertungen.grund.${grund}`) ?? grund);

/** Der Verdacht in Worten („Adresse im Text“, „Wortliste“). */
export const verdachtName = (grund: string | null): string =>
    grund === null ? "" : (nachschlagen(`bewertungen.redaktion.verdacht.${grund}`) ?? grund);

export const GRUENDE = BEWERTUNG_GRUENDE;

// --- Zeilen und Zahlen -----------------------------------------------------------------------------------------------------------

export function segmentZahl(zaehler: BewertungListe["zaehler"], segment: ListenSegment): number {
    return zaehler[segment];
}

/** Die Zahl am Unterreiter: was auf eine Sichtung wartet. */
export const unterreiterZahl = (liste: BewertungListe): number => liste.zaehler.sichten;

/** Die Sterne einer Wertung als drei Füllungen (nur ganze Sterne). */
export const sterneVon = (sterne: number): StarFill[] => starsOf(sterne);

/** „★★★★☆“ als Text, für Titel, Tooltip und Vorleser (die Zeichnung macht die Komponente mit der Farbe der Sterne). */
export const sterneText = (sterne: number): string => "★".repeat(sterne) + "☆".repeat(Math.max(0, 5 - sterne));

export const sterneLabel = (sterne: number): string =>
    t("infoPanel.reviews.starsLabel", { n: formatNumber(sterne, 0) });

/** Die Kopfzeile der Zeile: „Wehrheim“ und rechts die Zeit; Name und Datum stehen darunter. */
export function unterzeile(zeile: BewertungZeile): string {
    if (zeile.inhaltGeloescht) return t("bewertungen.redaktion.inhaltGeloescht");
    const name = (zeile.name ?? "").trim() === "" ? t("infoPanel.reviews.anonymous") : (zeile.name as string);
    return zeile.datum === null ? name : `${name} · ${zeile.datum}`;
}

/** Der Text der Zeile, einzeilig gekürzt macht die Komponente; „ohne Text“, wo keiner steht. */
export function textVon(zeile: BewertungZeile): string {
    if (zeile.inhaltGeloescht) return t("bewertungen.redaktion.inhaltGeloescht");
    return zeile.text === null ? "" : t("infoPanel.reviews.quote", { text: zeile.text });
}

/** Die Marken der Zeile (Bedienkonzept §6.1): „gemeldet COM-…“, „Spamverdacht“, „Legacy“, „verborgen: Beleidigend“. */
export function marken(zeile: BewertungZeile): string[] {
    return [
        ...zeile.gemeldet.map((nummer) => t("bewertungen.redaktion.marke.gemeldet", { nummer })),
        ...(zeile.zustand === "zurueckgehalten"
            ? [t("bewertungen.redaktion.marke.verdacht", { grund: verdachtName(zeile.grund) })]
            : []),
        ...(zeile.zustand === "verborgen"
            ? [t("bewertungen.redaktion.marke.verborgen", { grund: grundName(zeile.grund) })]
            : []),
        ...(zeile.herkunft === "legacy" ? [t("bewertungen.redaktion.marke.legacy")] : []),
    ];
}

export const rechtsText = (zeile: BewertungZeile, jetzt: Date = new Date()): string =>
    zeitAbstand(zeile.eingangAt, jetzt);

/** Die Legende in einer Zeile: „neu ○ 3 · zurückgehalten ◑ 1 · gesichtet ● 120 · verborgen ◌ 4“ (Zahlen aller, nicht der gefilterten Liste). */
export function legendeZahlen(zaehler: BewertungListe["zaehler"]): Record<BewertungsKreis, number> {
    return {
        leer: zaehler.neu,
        "halb-rechts": zaehler.zurueckgehalten,
        voll: zaehler.gesichtet,
        gestrichelt: zaehler.verborgen,
        halb: 0,
    };
}

export function legendeNamen(): Partial<Record<BewertungsKreis, string>> {
    return {
        leer: t(ZUSTAND_NAME.neu),
        "halb-rechts": t(ZUSTAND_NAME.zurueckgehalten),
        voll: t(ZUSTAND_NAME.gesichtet),
        gestrichelt: t(ZUSTAND_NAME.verborgen),
    };
}

// --- Trichter und Sortierung ------------------------------------------------------------------------------------------------------

export const STERNE_FILTER = [5, 4, 3, 2, 1] as const;
export const HERKUNFT_FILTER = BEWERTUNG_HERKUENFTE;
export const ORDNUNGEN = ["neueste", "aelteste", "wenigste"] as const;
export type Ordnung = (typeof ORDNUNGEN)[number];

/** Was der Trichter wählt (Bedienkonzept §6.1: Sterne, Herkunft, „nur gemeldete“, „nur zurückgehaltene“). Leer: kein Filter. */
export interface BewertungsFilter {
    sterne?: readonly string[] | undefined;
    herkunft?: readonly string[] | undefined;
    sonst?: readonly string[] | undefined;
}

/** Die Wahl des Trichters als Anfrage an den Server. Mehrere Sterne oder beide Herkünfte sind kein Filter. */
export function anfrageVon(
    segment: ListenSegment,
    suche: string,
    filter: BewertungsFilter,
    ordnung: Ordnung,
): {
    segment: ListenSegment;
    q?: string;
    sterne?: number;
    herkunft?: "website" | "legacy";
    gemeldet?: boolean;
    zurueckgehalten?: boolean;
    sortierung: Ordnung;
} {
    const q = suche.trim();
    const sterne = filter.sterne?.length === 1 ? Number(filter.sterne[0]) : undefined;
    const herkunft = filter.herkunft?.length === 1 ? filter.herkunft[0] : undefined;
    return {
        segment,
        ...(q === "" ? {} : { q: q.slice(0, 100) }),
        ...(sterne !== undefined && sterne >= 1 && sterne <= 5 ? { sterne } : {}),
        ...(herkunft === "website" || herkunft === "legacy" ? { herkunft } : {}),
        ...(filter.sonst?.includes("gemeldet") === true ? { gemeldet: true } : {}),
        ...(filter.sonst?.includes("zurueckgehalten") === true ? { zurueckgehalten: true } : {}),
        sortierung: ordnung,
    };
}

export const filterGesetzt = (filter: BewertungsFilter): boolean =>
    (filter.sterne?.length ?? 0) > 0 || (filter.herkunft?.length ?? 0) > 0 || (filter.sonst?.length ?? 0) > 0;

// --- Handgriffe -------------------------------------------------------------------------------------------------------------------

/** Ein Handgriff: ob er dasteht, und wenn er gesperrt ist, der Grund als Sprachschlüssel. */
export interface Griff {
    readonly zeigen: boolean;
    readonly grund?: MessageKey | undefined;
}

export interface BewertungsGriffe {
    /** ✓ „Gesichtet“ (neu) */
    readonly sichten: Griff;
    /** ✓ „Freigeben“ (zurückgehalten) */
    readonly freigeben: Griff;
    /** ⊘ „Verbergen …“ (neu, gesichtet, zurückgehalten) */
    readonly verbergen: Griff;
    /** ↺ „Einblenden“ (verborgen, mit Inhalt) */
    readonly einblenden: Griff;
    /** „Inhalt löschen …“ (verborgen, Gefahr, `moderate_community`, frischer Passkey) */
    readonly loeschen: Griff;
}

const KEIN = { zeigen: false } as const satisfies Griff;

/**
 * Was die Redaktion an einer Bewertung tun darf (Bedienkonzept §6.2, Fuß je Zustand): neu: Verbergen …, **Gesichtet**; zurückgehalten: Verbergen …, **Freigeben**; gesichtet: Verbergen …;
 * verborgen: Inhalt löschen …, **Einblenden**. Das Lesen und die Handgriffe brauchen `moderate_submissions`, das Löschen des Inhalts `moderate_community`.
 */
export function griffe(zeile: BewertungZeile, rechte: readonly string[]): BewertungsGriffe {
    const redaktion = rechte.includes("moderate_submissions");
    const keinRecht: Griff["grund"] = "bewertungen.redaktion.grund.keinRecht";
    const mitRecht = (zeigen: boolean): Griff =>
        zeigen ? { zeigen, ...(redaktion ? {} : { grund: keinRecht }) } : KEIN;
    const wirdVerborgen = zeile.zustand === "verborgen";
    return {
        sichten: mitRecht(zeile.zustand === "neu"),
        freigeben: mitRecht(zeile.zustand === "zurueckgehalten"),
        verbergen: mitRecht(!wirdVerborgen),
        einblenden: wirdVerborgen
            ? zeile.inhaltGeloescht
                ? { zeigen: true, grund: "bewertungen.redaktion.grund.ohneInhalt" }
                : mitRecht(true)
            : KEIN,
        loeschen: wirdVerborgen
            ? zeile.inhaltGeloescht
                ? { zeigen: true, grund: "bewertungen.redaktion.grund.schonGeloescht" }
                : rechte.includes("moderate_community")
                  ? { zeigen: true }
                  : { zeigen: true, grund: "bewertungen.redaktion.grund.loeschenRecht" }
            : KEIN,
    };
}

/** Der Satz zum Zustand im Fenster („neu, schon öffentlich“, „zurückgehalten: Adresse im Text“, „verborgen: Beleidigend“). */
export function zustandSatz(zeile: BewertungZeile): string {
    switch (zeile.zustand) {
        case "neu":
            return t("bewertungen.redaktion.stand.neu");
        case "gesichtet":
            return t("bewertungen.redaktion.stand.gesichtet");
        case "zurueckgehalten":
            return t("bewertungen.redaktion.stand.zurueckgehalten", { grund: verdachtName(zeile.grund) });
        case "verborgen":
            return t("bewertungen.redaktion.stand.verborgen", { grund: grundName(zeile.grund) });
    }
}

/** Was der Fuß unter den Knöpfen sagt (Bedienkonzept §6.2: Wirkung auf die Sichtbarkeit). */
export function fussSatz(zeile: BewertungZeile): string {
    return t(`bewertungen.redaktion.fuss.${zeile.zustand}` as MessageKey);
}

/** „★ 4,3 aus 12“ oder „ohne Bewertung“. */
export function schnittSatz(schnitt: { n: number; wert: number | null }): string {
    return schnitt.n === 0 || schnitt.wert === null
        ? t("bewertungen.redaktion.ohneBewertung")
        : t("bewertungen.redaktion.schnitt", { wert: formatNumber(schnitt.wert, 1), n: formatNumber(schnitt.n, 0) });
}

/** „jetzt ★ 4,3 aus 12 · nach dem Verbergen ★ 4,5 aus 11“ (Bedienkonzept §6.2, Kasten Ort). */
export function ortSatz(detail: BewertungDetail): string {
    const handlung =
        detail.zeile.zustand === "neu" || detail.zeile.zustand === "gesichtet"
            ? "verbergen"
            : detail.zeile.zustand === "zurueckgehalten"
              ? "freigeben"
              : "einblenden";
    return t("bewertungen.redaktion.ortSatz", {
        jetzt: schnittSatz(detail.ort.jetzt),
        handlung: t(`bewertungen.redaktion.nach.${handlung}` as MessageKey),
        danach: schnittSatz(detail.ort.danach),
    });
}

/** Eine Zeile des Verlaufs: „eingegangen (Website)“, „gesichtet von Lena“, „verborgen: Beleidigend“ … */
export interface VerlaufsZeile {
    readonly key: string;
    readonly zeit: string;
    readonly text: string;
}

export function verlaufZeilen(verlauf: readonly BewertungVerlauf[], jetzt: Date = new Date()): VerlaufsZeile[] {
    return verlauf.map((eintrag, index) => {
        const wer = eintrag.von === null ? "" : eintrag.von.name;
        const zusatz =
            eintrag.art === "verborgen"
                ? grundName(eintrag.text)
                : eintrag.art === "freigegeben"
                  ? verdachtName(eintrag.text)
                  : eintrag.art === "gemeldet"
                    ? (eintrag.text ?? "")
                    : eintrag.art === "eingang"
                      ? t(`bewertungen.redaktion.herkunft.${eintrag.text === "legacy" ? "legacy" : "website"}`)
                      : "";
        return {
            key: `${String(index)}:${eintrag.art}`,
            zeit: zeitAbstand(eintrag.at, jetzt),
            text: t(`bewertungen.redaktion.verlauf.${eintrag.art}` as MessageKey, { wer, zusatz }),
        };
    });
}
