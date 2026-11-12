import { Type, type TLiteral, type TObject, type TSchema, type TUnion } from "@sinclair/typebox";
import type { EditorLockKind } from "./editor-lock.ts";

/**
 * Die Herkunft je Feld mit Wiki-Wert (WI-0225; EDIT-0003 G6, F24; Modell c der Editor-Orchestrierung 2026-10-18; Design Guide §13.8).
 * EINE Stelle für alle Editoren: Tafel `field_origin` (Migration 0183), Server `apps/server/src/editor/feld-herkunft.ts`, im Browser
 * die Griffe `aufWiki` und `herkunft` der Bearbeitungsart (`apps/web/src/fenster/bearbeitung.ts`) und das Wiki-Feld
 * (`apps/web/src/fenster/wiki-feld.ts`).
 *
 * - **↺ setzt Wert UND Herkunft wiki**, getippt ist manual, auch beim Wortlaut des Wiki. Die eigene Spalte am Objekt bleibt der wirksame
 *   Wert; die Herkunft trennt nur „folgt dem Wiki“ von „gleicher Wert“ und sagt dem Wiki-Abgleich später, welche Felder er nachzieht.
 * - **In der EINEN Operation** steht ein solches Feld als `{ value }` (Herkunft manual) oder `{ revert: "wiki" }` (↺: der Server holt
 *   den Wert aus dem Schnappschuss der Art und setzt Herkunft wiki), wie `EditorPlaceTextChange` am Ort.
 * - **Im Detail** einer Art steht `herkunft` (`FeldHerkuenfte`): ein fehlender Schlüssel heißt „kein Vermerk“ (Herkunft unbekannt; das
 *   Wiki-Feld zeigt dann bei gleichem Wert „gleich“).
 * - 🔴 **Ort und Herrschaftsgebiet** führen ihre Herkunft schon an eigener Stelle, die der Legacy-Zug schreibt: `place_detail.*_origin`
 *   (Einwohner, Lage, Oberhaupt) und `territory_detail_field_origin` (die 17 Detailfelder, `override` heißt dort manual). Diese Felder
 *   stehen NICHT in `field_origin`; ein Feld hat seine Herkunft an genau einer Stelle.
 */

const strict = { additionalProperties: false } as const;

export const FELD_HERKUENFTE = ["wiki", "manual"] as const;
export type FeldHerkunft = (typeof FELD_HERKUENFTE)[number];

/** Die Herkunft je Feld eines Objekts im Detail einer Art; ein fehlender Schlüssel heißt „kein Vermerk“. */
export const FeldHerkuenfte = Type.Record(Type.String(), Type.Union([Type.Literal("wiki"), Type.Literal("manual")]));
export type FeldHerkuenfte = Readonly<Partial<Record<string, FeldHerkunft>>>;

/**
 * Welche Felder eine Art in `field_origin` führt. 🔴 Eine Art dockt mit ihrer Zeile hier an (keine Migration nötig); der Server nimmt
 * nur diese Felder an. Felder des Orts und die 17 Gebietsdetails gehören nicht hierher (Kopf).
 */
export const FELD_HERKUNFT_FELDER: Readonly<Record<EditorLockKind, readonly string[]>> = {
    // Name und Ortsgröße des Orts (Legacy hatte beide mit Wiki-Wert); Einwohner, Lage und Oberhaupt stehen in `place_detail`.
    place: ["name", "subtype"],
    // Name, Wegtyp und das Kennzeichen über dem Wegtyp (Karawanenroute; WI-0177 §36), je Abschnitt.
    path: ["name", "subtype", "mark"],
    landscape: ["name", "region_type"],
    territory: [],
    powerline: ["name", "description"],
    // Gipfel und Vulkane (WI-0178 P1): die Höhe (WI-0253 §21, Vali 2026-10-27: „… dass die werte (wenn es werte gibt) vom wiki übernommen werden“). Der Editor setzt beim Ändern der Höhe den
    // Vermerk `manual` (`gipfelSchreiben`); eine Höhe ohne Vermerk folgt dem Wiki, wo es einen Wert gibt (bewusste Ausnahme, nur für diese Höhe).
    peak: ["height"],
    // Die Sprache (WI-0261 S5d) führt keine Felder mit Wiki-Wert: Der WikiSync schreibt nur den Stand ihrer Artikel, nie Name, Farbe oder Zuordnung (O6).
    sprache: [],
};

/** Ob die Art `art` für `feld` eine Herkunft in `field_origin` führt. */
export const fuehrtHerkunft = (art: EditorLockKind, feld: string): boolean => FELD_HERKUNFT_FELDER[art].includes(feld);

/** Ein Feld mit Wiki-Wert in der EINEN Operation: ein Wert (Herkunft manual) oder zurück auf den Wiki-Wert (↺, Herkunft wiki). */
export const WikiFeldAenderung = <T extends TSchema>(
    wert: T,
): TUnion<[TObject<{ value: T }>, TObject<{ revert: TLiteral<"wiki"> }>]> =>
    Type.Union([Type.Object({ value: wert }, strict), Type.Object({ revert: Type.Literal("wiki") }, strict)]);
export type WikiFeldAenderung<T> = { readonly value: T } | { readonly revert: "wiki" };

/** Die Herkunft, die eine Änderung hinterlässt: ↺ wiki, ein Wert manual. */
export const herkunftDerAenderung = (aenderung: WikiFeldAenderung<unknown>): FeldHerkunft =>
    "revert" in aenderung ? "wiki" : "manual";
