import { shallowRef } from "vue";
import type {
    OperationReceipt,
    PlaceDeleteBody,
    PlaceRemoval,
    PlaceRemovalWay,
    PlaceRestoreBody,
    PlaceTakeOffMapBody,
    StaettenWay,
} from "@avesmaps3d/shared";
import { formatList, t } from "../i18n/i18n";
import type { ApiFehler } from "./ort-bearbeitung";

/**
 * „Ort entfernen“ (WI-0128 E22; Betreiber 2026-10-12: „ort-entfernen-konzept ist prima, genau das wollte ich“, Blatt
 * `review/wi-0128/ort-entfernen-blatt.png`): EIN Knopf an Infopanel, Kontextmenü, Menü am Objekt und Ortseditor, EIN Blatt mittig über der
 * Karte (`ort-entfernen-fenster.vue`). Hier steht, was das Blatt anbietet, was gesperrt ist und warum, welche Folgen es nennt und was der
 * Gefahrknopf tut; das Blatt zeichnet es nur.
 *
 * - **Der Ort** (eine Wahl, Pflicht): Von der Karte nehmen · Stätte eines anderen Orts werden · Ganz löschen (weich, ↺ unter „Änderungen“).
 * - **Innerorts** (nur mit Stätten, vorbelegt „Bleiben bei …“): zu einem anderen Ort · eigenständig machen.
 * - **Folgen** (nur angezeigt): Kraftlinien (sperren alles), Wegenden (bleiben liegen, G1), Hauptstadt oder Sitz eines Gebiets, was am Ort
 *   bleibt bzw. mit ihm stillgelegt wird.
 * - 🔴 Bis E18 (`settlement_place.place_id`) sind gesperrt, mit Grund: Stätte werden, Stätten umhängen oder eigenständig machen, einen Ort
 *   samt Stätten löschen, einen innerorts-Punkt entfernen. Der Server lehnt dieselben Fälle ab.
 * - Die Menüs bitten über `bitteEntfernen`: Das Blatt (im Editorpanel) geht auf und meldet die Lage (`entfernenFlug`), die Steuerung
 *   fliegt den Ort neben das Blatt. Nach
 *   dem Entfernen und nach ↺ meldet `entfernenMeldung`, damit Steuerung (Liste, Infopanel, Fenster eines gelöschten Orts) und
 *   Ortseditor-Fenster (lesen den Ort neu) nachziehen. Beide tragen eine laufende Nummer: Mehrere hören zu, keiner räumt für die anderen.
 */

let zaehler = 0;

/** Die Bitte aus einem Menü: Für diesen Ort geht das Blatt auf. */
export const entfernenBitte = shallowRef<{ readonly publicId: string; readonly nr: number } | undefined>(undefined);
export function bitteEntfernen(publicId: string): void {
    zaehler += 1;
    entfernenBitte.value = { publicId, nr: zaehler };
}

/** Der Ort neben das Blatt: Das Blatt meldet seine Lage, sobald die Vorschau da ist; die Steuerung fliegt (`ortseditor-steuerung.ts`). */
export const entfernenFlug = shallowRef<
    { readonly x: number; readonly y: number; readonly subtype: string; readonly nr: number } | undefined
>(undefined);
export function fliegeNebenDasBlatt(ort: PlaceRemoval): void {
    if (ort.position === undefined) return;
    zaehler += 1;
    entfernenFlug.value = { ...ort.position, subtype: ort.subtype, nr: zaehler };
}

/** Was mit einem Ort geschah: von der Karte genommen, gelöscht oder mit ↺ wiederhergestellt. */
export interface EntfernenMeldung {
    readonly publicId: string;
    readonly art: "abgenommen" | "geloescht" | "wiederhergestellt";
    readonly mapRevision: number | undefined;
    readonly nr: number;
}
export const entfernenMeldung = shallowRef<EntfernenMeldung | undefined>(undefined);
export function melde(publicId: string, art: EntfernenMeldung["art"], mapRevision: number | undefined): void {
    zaehler += 1;
    entfernenMeldung.value = { publicId, art, mapRevision, nr: zaehler };
}

type Schreibantwort = { ok: true; quittung: OperationReceipt } | { ok: false; status: number; fehler: ApiFehler };

export interface EntfernenApi {
    entfernenVorschau(publicId: string, signal: AbortSignal): Promise<PlaceRemoval | null>;
    nimmAb(publicId: string, body: PlaceTakeOffMapBody): Promise<Schreibantwort>;
    loesche(publicId: string, body: PlaceDeleteBody): Promise<Schreibantwort>;
    stelleWiederHer(publicId: string, body: PlaceRestoreBody): Promise<Schreibantwort>;
}

export interface EntfernenWahl {
    readonly ort: PlaceRemovalWay | undefined;
    readonly staetten: StaettenWay;
}

export interface WahlZeile {
    readonly titel: string;
    readonly satz: string;
    /** Warum die Wahl nicht geht; gesetzt heißt gesperrt. */
    readonly grund?: string | undefined;
    /**
     * Der Grund, wenn er nur diese Zeile betrifft (Recht, E18, ohne Lage): Er steht leise an der Stelle des Satzes. Die Sperre durch eine
     * Kraftlinie gilt für alle und steht EINMAL oben (Blatt, Fall c); die Zeilen behalten dann ihren Satz.
     */
    readonly hinweis?: string | undefined;
}

export interface FolgeZeile {
    readonly titel: string;
    readonly text: string;
    readonly leise?: string | undefined;
    readonly gefahr?: true;
}

export interface EntfernenStand {
    /** Eine Kraftlinie sperrt alles: der Satz oben im Blatt. */
    readonly sperre: string | undefined;
    readonly orte: Readonly<Record<PlaceRemovalWay, WahlZeile>>;
    readonly staetten:
        | {
              readonly namen: readonly string[];
              readonly optionen: Readonly<Record<StaettenWay, WahlZeile>>;
          }
        | undefined;
    readonly folgen: readonly FolgeZeile[];
    /** Der Text des Gefahrknopfs: die Handlung der Wahl. */
    readonly handlung: string;
    /** Warum der Gefahrknopf gesperrt ist. */
    readonly grund: string | undefined;
    /** Die Nebenbemerkung im Fuß: wie es zurückgeht. */
    readonly zurueck: string | undefined;
}

const E18 = (): string => t("ortseditor.entfernen.grund.e18");

/** „70 Quellen“, „1 Quelle“: was am Ort hängt, in Worten. */
function bleibtListe(r: PlaceRemoval, mitWiki: boolean): string[] {
    const b = r.bleibt;
    const zahl = (n: number, eins: Parameters<typeof t>[0], viele: Parameters<typeof t>[0]): string[] =>
        n === 0 ? [] : [n === 1 ? t(eins) : t(viele, { n })];
    return [
        ...(mitWiki && b.wiki ? [t("ortseditor.entfernen.bleibt.wiki")] : []),
        ...zahl(b.bilder, "ortseditor.entfernen.bleibt.bild", "ortseditor.entfernen.bleibt.bilder"),
        ...zahl(b.quellen, "ortseditor.entfernen.bleibt.quelle", "ortseditor.entfernen.bleibt.quellen"),
        ...zahl(b.stadtplaene, "ortseditor.entfernen.bleibt.stadtplan", "ortseditor.entfernen.bleibt.stadtplaene"),
        ...zahl(b.abenteuer, "ortseditor.entfernen.bleibt.abenteuer1", "ortseditor.entfernen.bleibt.abenteuer"),
        ...zahl(b.bewertungen, "ortseditor.entfernen.bleibt.bewertung", "ortseditor.entfernen.bleibt.bewertungen"),
    ];
}

/** Was das Blatt für diesen Ort, diese Wahl und diese Rechte zeigt. */
export function entfernenStand(r: PlaceRemoval, wahl: EntfernenWahl, rechte: readonly string[]): EntfernenStand {
    const sperre =
        r.kraftlinien.length > 0
            ? t("ortseditor.entfernen.sperre", {
                  linie: formatList(r.kraftlinien.map((linie) => linie.name)),
                  name: r.name,
              })
            : undefined;
    const kraftlinie = sperre === undefined ? undefined : t("ortseditor.entfernen.grund.kraftlinie");
    const recht = (name: string): string | undefined =>
        rechte.includes(name) ? undefined : t("ortseditor.entfernen.grund.recht");
    const innerorts =
        r.innerortsVon === undefined ? undefined : t("ortseditor.entfernen.grund.innerorts", { stadt: r.innerortsVon });
    const mitStaetten = r.staetten.length > 0;

    /** Der Hinweis an der Zeile: jeder Grund außer der Kraftlinie, die oben steht. */
    const zeile = (z: Omit<WahlZeile, "hinweis">): WahlZeile => ({
        ...z,
        hinweis: z.grund === kraftlinie ? undefined : z.grund,
    });
    const orte: Record<PlaceRemovalWay, WahlZeile> = {
        abnehmen: zeile({
            titel: t("ortseditor.entfernen.abnehmen"),
            satz: t("ortseditor.entfernen.abnehmen.satz"),
            grund:
                kraftlinie ??
                (r.onMap ? undefined : t("ortseditor.entfernen.grund.ohneLage")) ??
                recht("edit_map_geometry") ??
                innerorts,
        }),
        staette: zeile({
            titel: t("ortseditor.entfernen.staette"),
            satz: t("ortseditor.entfernen.staette.satz"),
            grund: kraftlinie ?? recht("edit_map_objects") ?? E18(),
        }),
        loeschen: zeile({
            titel: t("ortseditor.entfernen.loeschen"),
            satz: t("ortseditor.entfernen.loeschen.satz"),
            // Seit E22 G2 sperren Stätten das Löschen nicht mehr: Sie gehen mit, umkehrbar (`place.restore` holt sie zurück).
            grund: kraftlinie ?? recht("edit_map_objects") ?? innerorts,
        }),
    };

    const loeschen = wahl.ort === "loeschen";
    const staetten = mitStaetten
        ? {
              namen: r.staetten.map((staette) => staette.name),
              optionen: {
                  bleiben: zeile({
                      titel: loeschen
                          ? t("ortseditor.entfernen.staetten.mitloeschen")
                          : t("ortseditor.entfernen.staetten.bleiben", { name: r.name }),
                      satz: loeschen
                          ? t("ortseditor.entfernen.staetten.mitloeschen.satz", { name: r.name })
                          : t("ortseditor.entfernen.staetten.bleiben.satz", { name: r.name }),
                      grund: kraftlinie,
                  }),
                  anderer: zeile({
                      titel: t("ortseditor.entfernen.staetten.anderer"),
                      satz: t("ortseditor.entfernen.staetten.anderer.satz"),
                      grund: kraftlinie ?? E18(),
                  }),
                  eigenstaendig: zeile({
                      titel: t("ortseditor.entfernen.staetten.eigenstaendig"),
                      satz: t("ortseditor.entfernen.staetten.eigenstaendig.satz"),
                      grund: kraftlinie ?? E18(),
                  }),
              },
          }
        : undefined;

    const folgen: FolgeZeile[] = [];
    for (const linie of r.kraftlinien)
        folgen.push({
            titel: t("ortseditor.entfernen.folge.kraftlinie"),
            text:
                linie.gegenueber === undefined
                    ? `${linie.name}.`
                    : t("ortseditor.entfernen.folge.kraftlinie.nach", { linie: linie.name, ort: linie.gegenueber }),
            leise: t("ortseditor.entfernen.folge.kraftlinie.sperrt"),
            gefahr: true,
        });
    if (r.wegenden.length > 0)
        folgen.push({
            titel: t("ortseditor.entfernen.folge.wegenden"),
            text: t("ortseditor.entfernen.folge.wegenden.text", {
                n: r.wegenden.length,
                namen: formatList([...new Set(r.wegenden)]),
            }),
            leise: t("ortseditor.entfernen.folge.wegenden.leise"),
        });
    for (const gebiet of r.gebiete) {
        const hauptstadt = gebiet.rolle === "hauptstadt";
        folgen.push({
            titel: t(hauptstadt ? "ortseditor.entfernen.folge.hauptstadt" : "ortseditor.entfernen.folge.sitz"),
            text: t("ortseditor.entfernen.folge.gebiet", { gebiet: gebiet.name }),
            leise:
                wahl.ort === "loeschen"
                    ? t(
                          hauptstadt
                              ? "ortseditor.entfernen.folge.ohneHauptstadt"
                              : "ortseditor.entfernen.folge.ohneSitz",
                      )
                    : wahl.ort === "abnehmen"
                      ? t("ortseditor.entfernen.folge.ohnePunkt")
                      : undefined,
        });
    }
    if (loeschen) {
        if (r.bleibt.wiki)
            folgen.push({
                titel: t("ortseditor.entfernen.folge.wiki"),
                text: t("ortseditor.entfernen.folge.wiki.text", { name: r.name }),
            });
        const mit = bleibtListe(r, false);
        if (mit.length > 0)
            folgen.push({
                titel: t("ortseditor.entfernen.folge.mitgeloescht"),
                text: `${formatList(mit)}.`,
                leise: t("ortseditor.entfernen.folge.mitgeloescht.leise"),
            });
    } else if (wahl.ort !== undefined) {
        const bleibt = bleibtListe(r, true);
        if (bleibt.length > 0)
            folgen.push({ titel: t("ortseditor.entfernen.folge.bleibt"), text: `${formatList(bleibt)}.` });
    }

    const gewaehlt = wahl.ort === undefined ? undefined : orte[wahl.ort];
    const staettenGrund =
        staetten !== undefined && wahl.ort !== undefined ? staetten.optionen[wahl.staetten].grund : undefined;
    return {
        sperre,
        orte,
        staetten,
        folgen,
        handlung:
            wahl.ort === undefined ? t("ortseditor.entfernen") : t(`ortseditor.entfernen.knopf.${wahl.ort}` as const),
        grund:
            kraftlinie ??
            (gewaehlt === undefined ? t("ortseditor.entfernen.grund.wahl") : (gewaehlt.grund ?? staettenGrund)),
        zurueck: loeschen
            ? t("ortseditor.entfernen.zurueck.loeschen")
            : wahl.ort === "abnehmen"
              ? t("ortseditor.entfernen.zurueck.abnehmen")
              : undefined,
    };
}

export type EntfernenErgebnis =
    { ok: true; weg: "abnehmen" | "loeschen"; quittung: OperationReceipt } | { ok: false; satz: string };

/** Die Operation der Wahl auf die gelesene Revision; ein Fehlschlag kommt als Satz des Servers zurück. */
export async function entferne(
    api: EntfernenApi,
    r: PlaceRemoval,
    wahl: EntfernenWahl,
    neueKennung: () => string = () => crypto.randomUUID(),
): Promise<EntfernenErgebnis> {
    if (wahl.ort !== "abnehmen" && wahl.ort !== "loeschen") return { ok: false, satz: E18() };
    const antwort =
        wahl.ort === "abnehmen"
            ? await api.nimmAb(r.publicId, {
                  operationId: neueKennung(),
                  baseRevision: r.revision,
                  ...(r.staetten.length > 0 ? { staetten: "bleiben" as const } : {}),
              })
            : await api.loesche(r.publicId, { operationId: neueKennung(), baseRevision: r.revision });
    return antwort.ok
        ? { ok: true, weg: wahl.ort, quittung: antwort.quittung }
        : { ok: false, satz: antwort.fehler.message };
}

/** ↺ eines „Ganz löschen“ unter „Änderungen“: `place.restore` auf die Operation des Löschens. */
export async function stelleWiederHer(
    api: Pick<EntfernenApi, "stelleWiederHer">,
    publicId: string,
    reverts: string,
    neueKennung: () => string = () => crypto.randomUUID(),
): Promise<{ ok: true; quittung: OperationReceipt } | { ok: false; satz: string }> {
    const antwort = await api.stelleWiederHer(publicId, { operationId: neueKennung(), reverts });
    return antwort.ok ? { ok: true, quittung: antwort.quittung } : { ok: false, satz: antwort.fehler.message };
}
