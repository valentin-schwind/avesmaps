import {
    editorLandscapesBatchUrl,
    type EditorLandscapeLayer,
    type EditorLandscapeList,
    type LandscapeBatchBody,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { sende } from "../fenster/entwurf-senden";
import type { SammelAenderungen, SammelArt } from "../fenster/sammel";
import { gipfelGegenstand, gipfelVon } from "./landschaften-liste";

/**
 * Die Mehrfachauswahl der Derographie (EDIT-0003 T57; Betreiber 2026-10-19 zu Fassung 5 der Gebiete: „perfekt genau das wollen wir“):
 * was gemeinsam geht und wie es geschrieben wird (`fenster/sammel.ts`).
 *
 * - **Gemeinsam:** Ebene, Art und „Verbergen“ (T57: „Derographie Art, Ebene und Verbergen“), dazu „Entfernen …“ für alle. Ein ↺ auf
 *   Wiki-Werte gibt es hier nicht: Die Landschaft hat keine Felder aus dem Wiki.
 * - **Nur einzeln:** der Name und alle Reiter außer „Eigenschaften“ (Form, Beschriftungen, Gebirge, Verlauf).
 * - **Die Art hängt an der Ebene:** Gewählt wird sie aus der Ebene, die nach „Fertig“ für alle gilt (die neue oder die gemeinsame). Ist die
 *   Ebene gemischt und keine neue gesetzt, geht die Art nicht. Eine neue Ebene braucht eine Art aus ihr (wie an einer Landschaft).
 * - **Schreiben:** EINE Operation `landscape.batch` für alle (`POST …/landscapes/batch`), ↺ im Verlauf nimmt sie zusammen zurück.
 * - **Gipfel und Vulkane** (Stage-Fund 2026-10-19: drei angehakte Vulkane ließen das Fenster leer) stehen als Zeilen in derselben Liste
 *   (`gipfel:<Kennung>`) und gehen mit: Gemeinsam ist mit ihnen nur „Besucher“ (beim Gipfel das Merkmal „verborgen“). Ebene und Art
 *   tragen Gipfel nicht, entfernen lassen sie sich nicht; beides steht dann gesperrt mit seinem Satz.
 */

export interface LandschaftSammelFelder {
    ebene: EditorLandscapeLayer;
    art: string;
    verborgen: boolean;
}

/** Eine Zeile der Mehrfachauswahl: eine Landschaft oder ein Gipfel (`id` wie in der Liste, beim Gipfel `gipfel:<Kennung>`). */
export interface LandschaftSammelZeile {
    readonly id: string;
    readonly name: string;
    readonly layer: EditorLandscapeLayer;
    readonly type?: string | undefined;
    readonly hidden?: boolean | undefined;
    readonly areas?: number | undefined;
    readonly labels?: number | undefined;
    readonly gipfel?: true;
}

/** Die angehakten Zeilen der Liste, Landschaften und Gipfel, in der Reihenfolge der Liste. */
export function sammelZeilen(
    liste: EditorLandscapeList | undefined,
    angehakt: readonly string[],
): LandschaftSammelZeile[] {
    const flaechen = (liste?.rows ?? []).filter((zeile) => angehakt.includes(zeile.id));
    const gipfel = (liste?.peaks ?? [])
        .filter((zeile) => angehakt.includes(gipfelGegenstand(zeile.id)))
        .map((zeile): LandschaftSammelZeile => ({
            id: gipfelGegenstand(zeile.id),
            name: zeile.name,
            layer: "topographie",
            type: zeile.subtype,
            hidden: zeile.hidden === true,
            gipfel: true,
        }));
    return [...flaechen, ...gipfel];
}

/** Die Reiter, die in der Mehrfachauswahl nicht gehen. */
export const LANDSCHAFT_NUR_EINZELN = ["name", "form", "beschriftungen", "gebirge", "verlauf"] as const;

/** Was „Fertig“ schickt: nur die gesetzten Felder; eine leere Art (noch nicht gewählt) fehlt. */
export function sammelAenderung(felder: Partial<LandschaftSammelFelder>): LandscapeBatchBody["changes"] {
    return {
        ...(felder.ebene !== undefined ? { layer: felder.ebene } : {}),
        ...(felder.art !== undefined && felder.art !== "" ? { type: felder.art } : {}),
        ...(felder.verborgen !== undefined ? { hidden: felder.verborgen } : {}),
    };
}

export function createLandschaftSammelArt(
    fetcher: typeof fetch = (eingabe, init) => fetch(eingabe, init),
): SammelArt<LandschaftSammelZeile, LandschaftSammelFelder> {
    return {
        gemeinsam: {
            ebene: (zeile) => zeile.layer,
            art: (zeile) => zeile.type ?? "",
            verborgen: (zeile) => zeile.hidden === true,
        },
        einzeln: LANDSCHAFT_NUR_EINZELN,
        schreibe: (ids, aenderungen: SammelAenderungen<LandschaftSammelFelder>, operationId) => {
            const gipfel = ids.flatMap((id) => gipfelVon(id) ?? []);
            return sende<OperationReceipt>(
                editorLandscapesBatchUrl,
                {
                    operationId,
                    ids: ids.filter((id) => gipfelVon(id) === undefined),
                    ...(gipfel.length > 0 ? { peaks: gipfel } : {}),
                    changes: sammelAenderung(aenderungen.felder),
                } satisfies LandscapeBatchBody,
                "POST",
                fetcher,
            );
        },
    };
}

/** Die Ebene, aus der die Art gewählt wird: die neue für alle, sonst die gemeinsame; gemischt ohne neue: keine. */
export function artEbene(
    zeilen: readonly Pick<LandschaftSammelZeile, "layer">[],
    felder: Partial<LandschaftSammelFelder>,
): EditorLandscapeLayer | undefined {
    if (felder.ebene !== undefined) return felder.ebene;
    const erste = zeilen[0]?.layer;
    return erste !== undefined && zeilen.every((zeile) => zeile.layer === erste) ? erste : undefined;
}

/** Wechselt eine der Landschaften die Ebene, ohne dass eine Art gewählt ist? Dann ginge „Fertig“ nicht (400 am Server). */
export function fehltArt(
    zeilen: readonly Pick<LandschaftSammelZeile, "layer">[],
    felder: Partial<LandschaftSammelFelder>,
): boolean {
    if (felder.ebene === undefined || (felder.art !== undefined && felder.art !== "")) return false;
    return zeilen.some((zeile) => zeile.layer !== felder.ebene);
}
