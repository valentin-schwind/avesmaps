import {
    KARTENVORSCHLAG_SEGMENT_ZUSTAENDE,
    UUID_PATTERN,
    type KartenvorschlagDateityp,
    type KartenvorschlagDetail,
    type KartenvorschlagListe,
    type KartenvorschlagSegment,
    type KartenvorschlagZeile,
    type KartenvorschlagZustand,
    type SearchHit,
} from "@avesmaps3d/shared";
import type { Kreis } from "../editor-liste/liste-modell";
import type { MessageKey } from "../i18n/de";
import { isMessageKey, t } from "../i18n/i18n";
import { linkHost } from "../kartenvorschlag/modell";
import type { BewertungsKreis } from "./bewertungen-modell";
import { zeitAbstand } from "./meldungen-modell";

/**
 * Was die Liste der Kartenvorschläge (Medienverwaltung, und als Zeilen der Meldungen seit WI-0305) und das Fenster eines Kartenvorschlags rechnen (WI-0275, Entwurf Fassung 2), ohne Browser: der Kreis je Zustand, die Zeile der Liste, die Legende, die Sätze des Fensters, die Angaben,
 * was eine Annahme übernimmt, der Verlauf. Wie es aussieht, steht in `kartenvorschlaege-liste.vue` und `kartenvorschlag-redaktion-fenster.vue`.
 *
 * - **Kreise** (Guide §13.17): ○ wartet, ◐ wird geprüft, ◑ Datei defekt, ● angenommen, ◌ abgelehnt oder zurückgezogen.
 * - 🔴 **Unbekannt ist nicht „nein“:** Eine dreiwertige Angabe, die fehlt, steht unter „Unbekannt“, nie als „nein“ (Regel der Kartensammlung, Migration 0069).
 * - **Was eine Annahme übernimmt**, sagt `annehmen.ts` auf dem Server; `folgenVon` nennt dasselbe in Worten, bevor es geschieht: Es gibt keine Rücknahme.
 */

const KREIS_VON_ZUSTAND: Readonly<Record<KartenvorschlagZustand, BewertungsKreis>> = {
    pending: "leer",
    incoming: "halb",
    technical_failed: "halb-rechts",
    approved: "voll",
    rejected: "gestrichelt",
    withdrawn: "gestrichelt",
};
export const kreisVon = (zustand: KartenvorschlagZustand): BewertungsKreis => KREIS_VON_ZUSTAND[zustand];

export const ZUSTAND_NAME: Readonly<Record<KartenvorschlagZustand, MessageKey>> = {
    pending: "kartenvorschlag.redaktion.zustand.pending",
    incoming: "kartenvorschlag.redaktion.zustand.incoming",
    technical_failed: "kartenvorschlag.redaktion.zustand.technical_failed",
    approved: "kartenvorschlag.redaktion.zustand.approved",
    rejected: "kartenvorschlag.redaktion.zustand.rejected",
    withdrawn: "kartenvorschlag.redaktion.zustand.withdrawn",
};

/** Die Rechte, mit denen die Redaktion Kartenvorschläge liest und entscheidet (dieselben wie auf dem Server und bei den Meldungen); eines genügt. */
export const KARTENVORSCHLAG_RECHTE = ["moderate_submissions", "moderate_map_suggestions"] as const;

/** Darf die Sitzung Kartenvorschläge prüfen? Davon hängen der Eintrag „Kartenvorschläge“ in der Medienverwaltung und „Vorschlag prüfen …“ im Inspector ab. */
export const darfKartenvorschlaege = (rechte: readonly string[]): boolean =>
    KARTENVORSCHLAG_RECHTE.some((recht) => rechte.includes(recht));

/** Ist er noch nicht entschieden? Dann lässt er sich ablehnen. */
export const istOffen = (zustand: KartenvorschlagZustand): boolean =>
    KARTENVORSCHLAG_SEGMENT_ZUSTAENDE.offen.includes(zustand);

const DATEI_NAME: Readonly<Record<KartenvorschlagDateityp, MessageKey>> = {
    "image/jpeg": "kartenvorschlag.status.datei.jpeg",
    "image/png": "kartenvorschlag.status.datei.png",
    "image/webp": "kartenvorschlag.status.datei.webp",
    "application/pdf": "kartenvorschlag.status.datei.pdf",
};

/** Das Format in Worten („JPEG-Bild“); das Bild-Zeichen davor setzt die Oberfläche (Vali 2026-11-04). */
export const dateiName = (typ: KartenvorschlagDateityp | null): string => (typ === null ? "" : t(DATEI_NAME[typ]));

/** Wo die Karte liegt: der Host eines Links oder das Format einer Datei. */
export const quelleVon = (zeile: KartenvorschlagZeile): string =>
    zeile.weg === "link"
        ? zeile.link === null
            ? ""
            : (linkHost(zeile.link) ?? zeile.link)
        : dateiName(zeile.dateiTyp);

/** Warum eine Datei nicht geht, in Worten; ein unbekannter Befund heißt „nicht lesbar“. */
export function technikName(technik: string | null): string {
    const schluessel = `kartenvorschlag.redaktion.technik.${technik ?? ""}`;
    return t(isMessageKey(schluessel) ? schluessel : "kartenvorschlag.redaktion.technik.sonst");
}

/** Noch keine Datei da, oder sie wird noch geprüft? Beides steht auf `incoming`, nur das Werk unterscheidet es. */
const ohneDatei = (zeile: KartenvorschlagZeile): boolean => zeile.technik === null;

/** Die Zeile unter dem Titel, wo etwas zu sagen ist. */
export function hinweisVon(zeile: KartenvorschlagZeile): string | undefined {
    switch (zeile.zustand) {
        case "incoming":
            return t(
                ohneDatei(zeile)
                    ? "kartenvorschlag.redaktion.hinweis.keineDatei"
                    : "kartenvorschlag.redaktion.hinweis.pruefung",
            );
        case "technical_failed":
            return t("kartenvorschlag.redaktion.hinweis.defekt", { grund: technikName(zeile.technik) });
        case "withdrawn":
            return t("kartenvorschlag.redaktion.stand.withdrawn");
        default:
            return undefined;
    }
}

/** Die Legende des Segments. Abgelehnt und zurückgezogen teilen sich den gepunkteten Ring und darum eine Zahl. */
export function legendeNamen(segment: KartenvorschlagSegment): Partial<Record<BewertungsKreis, string>> {
    if (segment === "angenommen") return { voll: t(ZUSTAND_NAME.approved) };
    if (segment === "abgelehnt") return { gestrichelt: t("kartenvorschlag.redaktion.zustand.beendet") };
    return {
        leer: t(ZUSTAND_NAME.pending),
        halb: t(ZUSTAND_NAME.incoming),
        "halb-rechts": t(ZUSTAND_NAME.technical_failed),
    };
}

export function legendeZahlen(zaehler: KartenvorschlagListe["zaehler"]): Record<Kreis, number> & {
    gestrichelt: number;
} {
    return {
        leer: zaehler.pending,
        halb: zaehler.incoming,
        "halb-rechts": zaehler.technical_failed,
        voll: zaehler.approved,
        gestrichelt: zaehler.rejected + zaehler.withdrawn,
    };
}

/** Der Satz zum Zustand im Fenster. */
export function zustandSatz(detail: KartenvorschlagDetail): string {
    switch (detail.zustand) {
        case "pending":
            return t("kartenvorschlag.redaktion.stand.pending");
        case "incoming":
            return t(
                ohneDatei(detail)
                    ? "kartenvorschlag.redaktion.hinweis.keineDatei"
                    : "kartenvorschlag.redaktion.stand.incoming",
            );
        case "technical_failed":
            return t("kartenvorschlag.redaktion.hinweis.defekt", { grund: technikName(detail.technik) });
        case "approved":
            return t("kartenvorschlag.redaktion.stand.approved");
        case "rejected":
            return t("kartenvorschlag.redaktion.stand.rejected");
        case "withdrawn":
            return t("kartenvorschlag.redaktion.stand.withdrawn");
    }
}

/** „Eigene Datei, eingegangen vor 5 Tagen“. */
export const eingangSatz = (detail: KartenvorschlagDetail, jetzt: Date = new Date()): string =>
    t(detail.weg === "link" ? "kartenvorschlag.redaktion.eingang.link" : "kartenvorschlag.redaktion.eingang.datei", {
        zeit: zeitAbstand(detail.eingegangenAm, jetzt),
    });

/** Der Satz im Fuß und, wo Annehmen nicht geht, warum. */
export function fussVon(detail: KartenvorschlagDetail): { satz: string; sperre?: string } {
    const datei = detail.weg === "datei";
    switch (detail.zustand) {
        case "pending":
            return { satz: t(datei ? "kartenvorschlag.redaktion.fuss.datei" : "kartenvorschlag.redaktion.fuss.link") };
        case "incoming":
            return ohneDatei(detail)
                ? {
                      satz: t("kartenvorschlag.redaktion.fuss.keineDatei"),
                      sperre: t("kartenvorschlag.redaktion.sperre.keineDatei"),
                  }
                : {
                      satz: t("kartenvorschlag.redaktion.fuss.pruefung"),
                      sperre: t("kartenvorschlag.redaktion.sperre.pruefung"),
                  };
        case "technical_failed":
            return {
                satz: t("kartenvorschlag.redaktion.fuss.defekt"),
                sperre: t("kartenvorschlag.redaktion.sperre.defekt"),
            };
        case "approved":
            return { satz: t("kartenvorschlag.redaktion.fuss.approved") };
        case "rejected":
            return {
                satz: t(
                    datei
                        ? "kartenvorschlag.redaktion.fuss.rejectedDatei"
                        : "kartenvorschlag.redaktion.fuss.rejectedLink",
                ),
            };
        case "withdrawn":
            return { satz: t("kartenvorschlag.redaktion.fuss.withdrawn") };
    }
}

export interface Fakt {
    readonly name: string;
    readonly wert: string;
    /** Spoiler oder kostenpflichtig: Das soll auffallen. */
    readonly achtung?: boolean;
}

/** Die Angaben zur Karte: was bekannt ist, als Zeilen, und was niemand angab, als Namen. */
export function faktenVon(detail: KartenvorschlagDetail): { zeilen: Fakt[]; fehlt: string[] } {
    const zeilen: Fakt[] = [];
    const fehlt: string[] = [];
    const fakt = (name: string, wert: string | null | undefined, achtung = false): void => {
        if (wert === null || wert === undefined || wert === "") fehlt.push(name);
        else zeilen.push({ name, wert, ...(achtung ? { achtung } : {}) });
    };
    const janein = (wert: boolean | null): string | null =>
        wert === null ? null : t(wert ? "kartenvorschlag.ja" : "kartenvorschlag.nein");
    fakt(
        t("kartenvorschlag.typ.label"),
        detail.typen.map((typ) => t(`catalog.citymaps.type.${typ}` as MessageKey)).join(", "),
    );
    fakt(
        t("kartenvorschlag.art.label"),
        detail.art === null ? null : t(`catalog.citymaps.art.${detail.art}` as MessageKey),
    );
    fakt(
        t("kartenvorschlag.farbe.label"),
        detail.farbe === null ? null : t(`kartenvorschlag.farbe.${detail.farbe}` as MessageKey),
    );
    fakt(t("kartenvorschlag.redaktion.fakt.zeitraum"), zeitraum(detail));
    fakt(t("kartenvorschlag.urheber.label"), detail.urheber);
    fakt(t("kartenvorschlag.quelle.label"), detail.quelle);
    fakt(t("kartenvorschlag.redaktion.fakt.spoiler"), janein(detail.spoiler), detail.spoiler === true);
    fakt(t("kartenvorschlag.redaktion.fakt.beschriftet"), janein(detail.beschriftet));
    fakt(t("kartenvorschlag.redaktion.fakt.mehrstoeckig"), janein(detail.mehrstoeckig));
    fakt(t("kartenvorschlag.redaktion.fakt.offiziell"), janein(detail.offiziell));
    fakt(
        t("kartenvorschlag.redaktion.fakt.kostenpflichtig"),
        janein(detail.kostenpflichtig),
        detail.kostenpflichtig === true,
    );
    return { zeilen, fehlt };
}

function zeitraum(detail: KartenvorschlagDetail): string | null {
    const { gueltigAb: ab, gueltigBis: bis } = detail;
    if (ab !== null && bis !== null) {
        return t("kartenvorschlag.redaktion.fakt.zeitraumBeide", { ab: String(ab), bis: String(bis) });
    }
    if (ab !== null) return t("catalog.citymaps.since", { year: String(ab) });
    return bis === null ? null : t("catalog.citymaps.until", { year: String(bis) });
}

export interface Folgen {
    readonly uebernommen: string;
    readonly nicht?: string;
    readonly oeffentlich: string;
    readonly original?: string;
}

/** Was eine Annahme tut, in den Worten des Blatts (`annehmen.ts`): übernommen, nicht übernommen, was öffentlich wird, was aus dem Original wird. */
export function folgenVon(detail: KartenvorschlagDetail): Folgen {
    const felder = [
        t("kartenvorschlag.redaktion.folge.titel"),
        ...(detail.typen.length > 0 ? [t("kartenvorschlag.typ.label")] : []),
        ...(detail.art !== null ? [t("kartenvorschlag.art.label")] : []),
        ...(detail.farbe !== null ? [t("kartenvorschlag.farbe.label")] : []),
        ...(detail.gueltigAb !== null || detail.gueltigBis !== null
            ? [t("kartenvorschlag.redaktion.fakt.zeitraum")]
            : []),
        ...(detail.urheber !== null ? [t("kartenvorschlag.urheber.label")] : []),
        ...([detail.spoiler, detail.beschriftet, detail.mehrstoeckig, detail.offiziell].some((wert) => wert !== null)
            ? [t("kartenvorschlag.redaktion.folge.merkmale")]
            : []),
    ];
    const als = [felder.join(", ")];
    if (detail.beschreibung !== null) als.push(t("kartenvorschlag.redaktion.folge.beschreibung"));
    if (detail.weg === "link") {
        als.push(
            t(
                detail.quelle === null
                    ? "kartenvorschlag.redaktion.folge.link"
                    : "kartenvorschlag.redaktion.folge.linkQuelle",
            ),
        );
    } else {
        if (detail.quelle !== null) als.push(t("kartenvorschlag.redaktion.folge.quelleNotiz"));
        als.push(t("kartenvorschlag.redaktion.folge.vollkarte"));
    }
    const nicht = [
        ...(detail.notiz !== null ? [t("kartenvorschlag.notiz.label")] : []),
        ...(detail.name !== null ? [t("kartenvorschlag.redaktion.folge.name")] : []),
        ...(detail.vorschauLink !== null ? [t("kartenvorschlag.redaktion.folge.fremdbild")] : []),
    ];
    const pdf = detail.dateiTyp === "application/pdf";
    return {
        uebernommen: als.join("; "),
        ...(nicht.length > 0 ? { nicht: nicht.join(", ") } : {}),
        oeffentlich: t(
            detail.weg === "link"
                ? "kartenvorschlag.redaktion.folge.oeffentlichLink"
                : "kartenvorschlag.redaktion.folge.oeffentlichDatei",
        ),
        ...(detail.weg === "datei"
            ? {
                  original: t(
                      pdf ? "kartenvorschlag.redaktion.folge.originalPdf" : "kartenvorschlag.redaktion.folge.original",
                  ),
              }
            : {}),
    };
}

export interface VerlaufsZeile {
    readonly key: string;
    readonly zeit?: string;
    readonly text: string;
}

/** Der Verlauf: Eingang und Entscheidung. Wann ein Einreicher zurückzog, steht nirgends, also keine Zeit. */
export function verlaufVon(detail: KartenvorschlagDetail, jetzt: Date = new Date()): VerlaufsZeile[] {
    const zeit = (wann: string | null): { zeit?: string } => (wann === null ? {} : { zeit: zeitAbstand(wann, jetzt) });
    const zeilen: VerlaufsZeile[] = [
        {
            key: "eingang",
            zeit: zeitAbstand(detail.eingegangenAm, jetzt),
            text: t(
                detail.weg === "link"
                    ? "kartenvorschlag.redaktion.verlauf.link"
                    : "kartenvorschlag.redaktion.verlauf.datei",
            ),
        },
    ];
    if (detail.zustand === "approved") {
        zeilen.push({
            key: "angenommen",
            ...zeit(detail.entschiedenAm),
            text: t("kartenvorschlag.redaktion.verlauf.angenommen"),
        });
    }
    if (detail.zustand === "rejected") {
        zeilen.push({
            key: "abgelehnt",
            ...zeit(detail.entschiedenAm),
            text:
                detail.grund === null
                    ? t("kartenvorschlag.redaktion.verlauf.abgelehntOhne")
                    : t("kartenvorschlag.redaktion.verlauf.abgelehnt", { grund: detail.grund }),
        });
    }
    if (detail.zustand === "withdrawn") {
        zeilen.push({ key: "zurueckgezogen", text: t("kartenvorschlag.redaktion.stand.withdrawn") });
    }
    return zeilen;
}

/** Der Ort, den das Blatt trägt. */
export interface OrtWahl {
    readonly id: string;
    readonly name: string;
    /** Die Art in Worten (nur aus der Suche). */
    readonly typ?: string;
    /** WI-0287 Stufe 3: ein Ort (Vorgabe) oder eine Region; nur „Neuer Eintrag“ der Kartensammlung wählt Regionen. */
    readonly kind?: "place" | "region";
}

const KENNUNG = new RegExp(UUID_PATTERN, "u");

/** Aus den Treffern der Kartensuche die Orte mit öffentlicher Kennung: Nur sie kann der Server binden. */
export const orteAusTreffern = (treffer: readonly SearchHit[], typVon: (hit: SearchHit) => string): OrtWahl[] =>
    treffer
        .filter((hit) => hit.kind === "ort" && KENNUNG.test(hit.id))
        .slice(0, 5)
        .map((hit) => ({ id: hit.id, name: hit.name, typ: typVon(hit) }));
