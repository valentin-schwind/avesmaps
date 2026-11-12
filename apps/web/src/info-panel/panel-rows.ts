import {
    SUBJECT_DIRECTIONS,
    displayDescription,
    pathReaderName,
    subjectKey,
    visibleFacts,
    type ContextClimateBand,
    type LoreCounts,
    type LoreRowView,
    type ContextLandscape,
    type ContextRiver,
    type NearbyItem,
    type SubjectClaimant,
    type SubjectContext,
    type SubjectDetail,
    type SubjectDetailKind,
    type SubjectFact,
    type SubjectFactField,
    type SubjectLineShape,
    type SubjectLink,
    type SubjectListFact,
    type SubjectRef,
    type SubjectSprache,
    type SubjectTextFact,
} from "@avesmaps3d/shared";
import { formatNumber, isMessageKey, t, tPlural, type MessageKey } from "../i18n/i18n";
import { unnamedLandscapeLabel, unnamedPathLabel } from "../i18n/unnamed";
import { climateZoneName } from "../map/climate-zones";
import { landscapeTypeLabel } from "../route-planner/route-landscapes";
import { LEGACY_ROWS, MAP_POINT_ROWS, legacyFields, type RowSlot } from "./legacy-rows";
import { loreLabel, loreRowsOf, loreRowsOfSection } from "./lore-model";
import { staettenLabel, staettenRowOf } from "./staetten-model";
import type { PanelRules } from "./panel-extras";
import { partsOfLinked, partsOfListValue, percentOf, stationsOf, typeLabel } from "./panel-text";
import { sprachenZeile } from "./sprache-model";
import type { LoreRowValue, NearbyModel, RowModel, RowValue, TextPart } from "./panel-types";

/**
 * Die Datentabelle des Panels (WI-0063 P6, Guide §16: „Feldzeilen mit Beschriftung 96 px, Wert füllt“): aus den Fakten und dem Kontext
 * einer Antwort die Zeilen, die dastehen sollen - in Legacys Reihenfolge (`legacy-rows.ts`), mit dem Wortlaut seiner Beschriftungen.
 *
 * 🔴 KEINE LEERE ZEILE (WI-0063 5.3): Eine Zeile entsteht nur mit Inhalt - die Beschreibung, von der nach dem ersten Satz nichts bleibt
 * (nur Vorlagenreste), ebenso wenig wie ein Kontext ohne Namen.
 * 🔴 Was Legacys Infobox nicht zeigt, zeigt das Panel nur freigegeben (`visibleFacts`, `PANEL_APPROVED_EXTRAS`, WI-0063 27.10); dann
 * stehen die Zusatzfelder hinter der Legacy-Tabelle, die eigenen Angaben eines Orts als „(eigene Angabe)“.
 */

const factLabel = (field: SubjectFactField): string => t(`infoPanel.field.${field}` as MessageKey);

/** Ein Text, in dem Quellen (`values`) oder ein Wert (`value`) steht. */
const factText = (fact: SubjectFact): string => ("values" in fact ? fact.values.join(", ") : fact.value);

const isDirect = (fact: SubjectFact): boolean => "layer" in fact && fact.layer === "direct";

/** Die Fakten, die das Panel zeigt: Legacys Tabelle und die freigegebenen Felder; ein wiederholter eigener Wert fällt weg. */
export function allowedFacts(
    kind: SubjectDetailKind,
    facts: readonly SubjectFact[] | undefined,
    rules: PanelRules,
): SubjectFact[] {
    const known = new Set<SubjectFactField>([...legacyFields(kind), ...rules.approved[kind].fields]);
    const visible = visibleFacts(kind, facts, rules.approved).filter((fact) => known.has(fact.field));
    // Mehr zeigen heißt nicht, denselben Wert zweimal zu zeigen: Ein Ort trägt den Nestwert und den eigenen Wert; stehen beide gleich
    // da, bringt der zweite nichts.
    return visible.filter(
        (fact) =>
            !(
                isDirect(fact) &&
                visible.some(
                    (other) =>
                        other !== fact &&
                        !isDirect(other) &&
                        other.field === fact.field &&
                        factText(other) === factText(fact),
                )
            ),
    );
}

/**
 * Der Wert einer Faktenzeile: Text, Text mit Links (Verkehrswege mit Linkzielen, Hauptstadt, jedes Teilstück, dessen Linkziel über den Wiki-Key
 * genau ein Objekt der Karte trägt: WI-0063 27.12) oder der Deckel des Verlaufs.
 */
function valueOf(fact: SubjectTextFact, text: string): RowValue {
    const links = fact.links !== undefined && fact.links.length > 0 ? fact.links : undefined;
    if (fact.field === "verlauf") {
        const stations = stationsOf(text);
        // Legacy: erst ab fünf Stationen lohnt der Deckel - darunter spart das Eindampfen nichts (`PATH_VERLAUF_LID_MIN_STATIONS`).
        if (stations.length >= 5) {
            return {
                kind: "lid",
                preview: `${stations[0] ?? ""} → … → ${stations[stations.length - 1] ?? ""}`,
                full: stations.join(" → "),
                // Der volle Text mit seinen Links; die Stellen der Verweise zählen im Originaltext.
                ...(links === undefined ? {} : { fullParts: partsOfLinked(text, links) }),
                count: stations.length,
                unit: tPlural("infoPanel.lid.station", stations.length),
            };
        }
    }
    if (links !== undefined) return { kind: "parts", parts: partsOfLinked(text, links) };
    if (fact.ref !== undefined) return { kind: "parts", parts: [{ text, ref: fact.ref }] };
    return { kind: "text", text };
}

/** Was eine Zeile außer den Fakten und dem Kontext braucht. */
export interface RowExtras {
    /** Ein Ort ohne Wiki-Artikel, der als Ruine gilt: Legacy sagt es in der Beschreibungszeile („Ruine oder zerstört.“). */
    ruinNote: boolean;
    /** Gebiet: die Anspruchsteller umstrittener Teile („Umstritten mit“). */
    claimants?: readonly SubjectClaimant[] | undefined;
    /** Weg (WI-0302): die anderen Straßen, mit denen er Abschnitte teilt („Gemeinsam mit“). */
    gemeinsam?: SubjectDetail["gemeinsam"] | undefined;
    /** Kraftlinie: ihre Gestalt aus den Segmenten („Verbindet“, „Verläuft über“, „Abschnitte“). */
    lineShape?: SubjectLineShape | undefined;
    /**
     * Die vier Vorkommenszeilen (D5, WI-0091): wen sie fragen und wie viele Einträge je Art die Detailantwort zählt. Ohne Zähler
     * entsteht keine Zeile - die Namen holt jede Zeile beim Aufklappen selbst.
     */
    lore?: { ref: SubjectRef; counts: LoreCounts | undefined } | undefined;
    /**
     * Die Zeile „Stätten“ eines Ortes (D7, WI-0109): wen sie fragt und wie viele Stätten die Detailantwort zählt. Ohne Zahl
     * entsteht keine Zeile - die Namen holt die Zeile beim Aufklappen selbst.
     */
    staetten?: { ref: SubjectRef; count: number | undefined } | undefined;
    /**
     * Die Sprachen, deren Flächen das Objekt treffen (WI-0261 S5b, `SubjectDetail.sprachen`): die Zeile „Sprachen“ zwischen „Regionen“ und „Topographie“. Stehen sie
     * da, entfällt die Textzeile „Sprache“ des Wikis (O3 „nur Sprachen“: eine Zeile, nicht zwei); ohne sie bleibt sie, wie vor dem Einspielen der Flächen.
     */
    sprachen?: readonly SubjectSprache[] | undefined;
}

/**
 * Die Nachbarn als EINE Zeile (Betreiber 2026-10-04: „bei "Nachbarn" könnte man auch eine einfache liste machen und die zusammenfassen
 * … Nachbarn: Herz des Kontinents (N, NO, NW), Raschtulswall (O), Ragatien (SO, SW), Sumiswald (S), Ambossgebirge (W)“): jeder Name
 * einmal, in der Reihenfolge seines ersten Auftretens auf der Windrose N, NO, O, SO, S, SW, W, NW, seine Richtungen in derselben
 * Reihenfolge dahinter. Ein Nachbar ohne Richtung steht ohne Klammer.
 *
 * Ein Name ist ein Link, wenn der Server ihn in `links` der Zeile nennt (WI-0063 27.12): nur, wo der Quelltext ein Linkziel liefert, dessen Wiki-Key
 * genau ein Objekt der Karte trägt - nie über den Namen. Heute liefert die Quelle keine Linkziele für die Nachbarn; die Zeile ist dann reiner Text.
 * Die Form der Zeile bleibt (Name, Richtungen in Klammern, Komma); ein Zusatz im Namen („Svalltermoor (Region)“) bleibt Text neben dem Link.
 */
function neighborsRow(facts: readonly SubjectFact[]): RowModel | undefined {
    const rank = (direction: string | undefined): number =>
        direction === undefined
            ? SUBJECT_DIRECTIONS.length
            : (SUBJECT_DIRECTIONS as readonly string[]).indexOf(direction);
    const ordered = facts
        .filter((fact): fact is SubjectListFact => "values" in fact && fact.field === "neighbors")
        .toSorted((left, right) => rank(left.direction) - rank(right.direction));
    const entries = new Map<string, { directions: string[]; name: TextPart[] }>();
    for (const fact of ordered) {
        fact.values.forEach((name, position) => {
            const known = entries.get(name) ?? { directions: [], name: partsOfListValue(name, position, fact.links) };
            if (fact.direction !== undefined) {
                const label = t(`infoPanel.direction.${fact.direction}` as MessageKey);
                if (!known.directions.includes(label)) known.directions.push(label);
            }
            entries.set(name, known);
        });
    }
    if (entries.size === 0) return undefined;
    const parts = [...entries.values()].flatMap((entry, at): TextPart[] => [
        ...(at > 0 ? [{ text: ", " }] : []),
        ...entry.name,
        ...(entry.directions.length === 0 ? [] : [{ text: ` (${entry.directions.join(", ")})` }]),
    ]);
    const value: RowValue = parts.some((part) => part.ref !== undefined)
        ? { kind: "parts", parts }
        : { kind: "text", text: parts.map((part) => part.text).join("") };
    return { key: "neighbors", label: t("infoPanel.neighbors"), value };
}

function factRow(
    kind: SubjectDetailKind,
    fact: SubjectFact,
    index: number,
    all: readonly SubjectFact[],
    rules: PanelRules,
    extras: RowExtras,
): RowModel | undefined {
    const label = factLabel(fact.field);
    if ("values" in fact) {
        const direction = fact.direction === undefined ? "" : ` (${fact.direction})`;
        return {
            key: `${fact.field}:${fact.direction ?? String(index)}`,
            label: `${label}${direction}`,
            value: { kind: "text", text: fact.values.join(", ") },
        };
    }
    const shown = fact.field === "description" ? displayDescription(kind, fact, rules.approved) : { text: fact.value };
    let text = shown.text;
    let full = shown.full;
    if (fact.field === "description" && extras.ruinNote) {
        const note = t("infoPanel.ruinNote");
        text = `${note}${text === "" ? "" : " "}${text}`;
        if (full !== undefined) full = `${note} ${full}`;
    }
    if (text === "") return undefined;
    // Die eigene Angabe steht neben der des Wikis: ohne den Zusatz wären es zwei gleiche Beschriftungen.
    const sibling =
        isDirect(fact) && all.some((other) => other !== fact && !isDirect(other) && other.field === fact.field);
    return {
        key: `${fact.field}${isDirect(fact) ? ":direct" : ""}:${String(index)}`,
        label: sibling ? t("infoPanel.fieldDirect", { label }) : label,
        // Die Beschreibung über den ersten Satz hinaus steht hinter der „…“-Pille, nie offen (Betreiber 2026-10-04).
        value: full === undefined ? valueOf(fact, text) : { kind: "more", text, full },
    };
}

// ---------------------------------------------------------------------------------------------------------------
// Kontext als Zeilen
// ---------------------------------------------------------------------------------------------------------------

/**
 * Der Name einer Landschaft im Panel: ihr Name, sonst der Satz ihrer Art („Unbezeichneter Wald“ statt
 * „Wald-925“).
 *
 * 🔴 Bis WI-0105 stand hier die blanke Art („Wald“); Betreiber 2026-10-07: „‚Wald-925‘ sollte zu
 * ‚Unbezeichneter Wald‘“. Eine unbekannte Art heißt „Unbezeichnete Fläche“ - leer bleibt nichts mehr, und das
 * ist richtig: Der Eintrag steht ja da.
 */
function landscapeName(item: ContextLandscape): string {
    return item.name ?? unnamedLandscapeLabel(item.type ?? "");
}

/**
 * Ein Eintrag einer Kontextzeile: der Name, dahinter ein Zusatz („ (Gebirge)“, „ (83 %)“) und, wo die Antwort eine Kennung nennt (die Daten kommen
 * aus der Geometrie, nicht aus einem Namen), dessen Ref. Der Zusatz bleibt Text neben dem Link (WI-0063 27.12).
 */
interface ContextEntry {
    name: string;
    suffix: string;
    ref?: SubjectRef | undefined;
}

/**
 * Die Einträge einer Zeile als Wert, durch „ · “ getrennt. Dieselbe Anzeige steht einmal da. 🔴 Nie raten: Ein Name ist nur ein Link, wenn
 * ALLE Einträge mit dieser Anzeige dasselbe Objekt meinen; zwei verschiedene Objekte unter einer Anzeige („Albenhus“ als Gebirge und als
 * Tal, wo die Art fehlt) oder ein Eintrag ohne Objekt (eine Fläche ohne Namen, die nur ihre Art heißt) bleiben Text. Ohne einen einzigen Link
 * bleibt die Zeile ein Text.
 */
function entriesValue(entries: readonly ContextEntry[], separator = " · "): RowValue | undefined {
    const shown = new Map<string, { entry: ContextEntry; refs: Set<string>; plain: boolean }>();
    for (const entry of entries) {
        const display = `${entry.name}${entry.suffix}`;
        if (display === "") continue;
        const known = shown.get(display) ?? { entry, refs: new Set<string>(), plain: false };
        if (entry.ref === undefined) known.plain = true;
        else known.refs.add(subjectKey(entry.ref));
        shown.set(display, known);
    }
    if (shown.size === 0) return undefined;
    const parts: TextPart[] = [];
    let linked = false;
    [...shown.values()].forEach(({ entry, refs, plain }, at) => {
        if (at > 0) parts.push({ text: separator });
        if (!plain && refs.size === 1 && entry.ref !== undefined) {
            parts.push({ text: entry.name, ref: entry.ref });
            if (entry.suffix !== "") parts.push({ text: entry.suffix });
            linked = true;
        } else {
            parts.push({ text: `${entry.name}${entry.suffix}` });
        }
    });
    return linked ? { kind: "parts", parts } : { kind: "text", text: parts.map((part) => part.text).join("") };
}

const LANDSCAPE_LAYERS = ["derographisch", "topographie", "vegetation"] as const;

/**
 * Die Landschaften eines Kontexts: an einer Linie (Weg, Kraftlinie) EINE Zeile „Führt durch“ (Legacy `avesmapsPathLandscapesRowMarkup`:
 * die Namen, durch „ · “ getrennt), sonst je Ebene eine Zeile - Derographie, Topographie, Vegetation - wie Legacys „Was ist hier?“,
 * jeder Name mit seiner Art in Klammern, wo sie ihn ergänzt. Jeder Name mit eigenem Namen ist ein Link auf seine Landschaft (WI-0063 27.12);
 * eine Fläche, die nur ihre Art heißt („Wald“), ist keiner.
 */
function landscapeRows(
    kind: SubjectDetailKind | "mapPoint",
    context: SubjectContext | undefined,
    sprachen?: readonly SubjectSprache[],
): RowModel[] {
    const items = context?.landscapes?.items ?? [];
    // Die Zeile „Sprachen“ (WI-0261 S5b) steht hinter „Regionen“ und vor „Topographie“ (Betreiber 2026-10-30), am Weg hinter „Führt durch“; auch ohne Landschaft.
    // An einem Ort und an einem Kartenpunkt (Punkt in Fläche) ohne Anteil.
    const sprachZeile = sprachenZeile(sprachen, kind === "place" || kind === "mapPoint");
    if (items.length === 0) return sprachZeile === undefined ? [] : [sprachZeile];
    const entryOf = (item: ContextLandscape, withArt: boolean): ContextEntry => {
        const name = landscapeName(item);
        const art = landscapeTypeLabel(item.type ?? "");
        return {
            name,
            // 🪤 Die Art in Klammern nur HINTER EINEM ECHTEN NAMEN: „Unbezeichneter Wald (Wald)“ sagte dasselbe
            // zweimal. Dieselbe Regel, die Legacy für den Untertitel eines unbenannten Wegs trifft.
            suffix: withArt && item.name !== undefined && art !== "" && art !== name ? ` (${art})` : "",
            // Nur ein echter Name ist ein Ziel: „Wald“ ohne Namen meint irgendeinen der Wälder.
            ref: item.name === undefined ? undefined : item.ref,
        };
    };
    if (kind === "path" || kind === "powerline") {
        const value = entriesValue(items.map((item) => entryOf(item, false)));
        return [
            ...(value === undefined ? [] : [{ key: "ctx:landscapes", label: t("infoPanel.runsThrough"), value }]),
            ...(sprachZeile === undefined ? [] : [sprachZeile]),
        ];
    }
    const rows: RowModel[] = [];
    for (const layer of LANDSCAPE_LAYERS) {
        const value = entriesValue(items.filter((item) => item.layer === layer).map((item) => entryOf(item, true)));
        const key = `layer.${layer}`;
        if (value !== undefined && isMessageKey(key)) rows.push({ key: `ctx:${layer}`, label: t(key), value });
        if (layer === "derographisch" && sprachZeile !== undefined) rows.push(sprachZeile);
    }
    return rows;
}

/** Ein Klimaband ist ein Gegenstand mit Kopf (WI-0063 27.12): Der Name ist ein Link, der Anteil bleibt Text daneben. */
function climateRows(context: SubjectContext | undefined): RowModel[] {
    const items = context?.climate?.items ?? [];
    if (items.length === 0) return [];
    // Der Anteil sagt nur etwas, wo mehrere Bänder zusammenkommen.
    const value = entriesValue(
        items.map((band: ContextClimateBand) => ({
            // Der Name aus der Sprachtafel (WI-0171); `label` ist der deutsche Stamm des Servers und bleibt der Rückfall.
            name: climateZoneName(band.band, band.label),
            suffix: items.length > 1 ? percentOf(band.share) : "",
            ref: { kind: "climate" as const, band: band.band },
        })),
    );
    return value === undefined ? [] : [{ key: "ctx:climate", label: t("infoPanel.climate"), value }];
}

/**
 * Ein benannter Fluss ist ein Link auf seinen Weg („Großer Fluss (Fluss)“), die Art bleibt Text daneben.
 *
 * 🔴 Ein Fluss ohne Namen heißt „Unbezeichneter Fluss“ beziehungsweise „Unbezeichneter Bach“ (WI-0105; hier
 * stand der rohe Griff „Flussweg-4487“). 🪤 Dann FÄLLT DIE KLAMMER WEG - „Unbezeichneter Bach (Bach)“ sagte
 * dasselbe zweimal. Der Link bleibt: Anders als eine namenlose Fläche, die für irgendeine ihrer Art steht,
 * meint dieser Eintrag genau diesen einen Fluss (sein Kettenschlüssel trägt den rohen Namen).
 */
function riverRows(context: SubjectContext | undefined): RowModel[] {
    const rivers = context?.rivers ?? [];
    if (rivers.length === 0) return [];
    const value = entriesValue(
        rivers.map((river: ContextRiver) => {
            const reader = pathReaderName(river.name, "Flussweg");
            return {
                name: reader ?? unnamedPathLabel("Flussweg", river.isBach),
                suffix: reader === null ? "" : ` (${t(river.isBach ? "areaChoice.brook" : "areaChoice.river")})`,
                ref: river.ref,
            };
        }),
    );
    return value === undefined ? [] : [{ key: "ctx:rivers", label: t("infoPanel.rivers"), value }];
}

function contextRows(
    kind: SubjectDetailKind | "mapPoint",
    context: SubjectContext | undefined,
    slot: "ctx:landscapes" | "ctx:climate" | "ctx:rivers",
    sprachen?: readonly SubjectSprache[],
): RowModel[] {
    switch (slot) {
        case "ctx:landscapes":
            return landscapeRows(kind, context, sprachen);
        case "ctx:climate":
            return climateRows(context);
        case "ctx:rivers":
            return riverRows(context);
    }
}

const isContextSlot = (slot: RowSlot): slot is "ctx:landscapes" | "ctx:climate" | "ctx:rivers" =>
    slot.startsWith("ctx:");

const isShapeSlot = (slot: RowSlot): slot is "shape:ends" | "shape:via" | "shape:segments" => slot.startsWith("shape:");

// ---------------------------------------------------------------------------------------------------------------
// Anspruchsteller und Gestalt als Zeilen (WI-0063 P7)
// ---------------------------------------------------------------------------------------------------------------

/** „Umstritten mit“ (Legacy `createRegionContestedRow`): jeder Anspruchsteller ein Link mit dem Farbkästchen seines Gebiets. */
function claimantRows(claimants: readonly SubjectClaimant[] | undefined): RowModel[] {
    if (claimants === undefined || claimants.length === 0) return [];
    const parts = claimants.flatMap((claimant, at): TextPart[] => [
        ...(at > 0 ? [{ text: ", " }] : []),
        { text: claimant.name, ref: claimant.ref, swatch: claimant.color },
    ]);
    return [{ key: "claimants", label: t("infoPanel.field.contested"), value: { kind: "parts", parts } }];
}

/**
 * „Gemeinsam mit“ (WI-0302; Entwurf „Weitere Straßennamen“, Ansicht Infopanel am Goldfelser Stieg): je Straße ein Link, dahinter in Klammern
 * „Von → Bis“ bei genau einem geteilten Abschnitt, sonst wie viele es sind.
 */
function gemeinsamRows(gemeinsam: RowExtras["gemeinsam"]): RowModel[] {
    if (gemeinsam === undefined || gemeinsam.length === 0) return [];
    const parts = gemeinsam.flatMap((eine, at): TextPart[] => {
        const wo =
            eine.abschnitte === 1 && eine.von !== undefined && eine.bis !== undefined
                ? t("infoPanel.gemeinsam.strecke", { von: eine.von, bis: eine.bis })
                : tPlural("infoPanel.gemeinsam.abschnitte", eine.abschnitte, { n: formatNumber(eine.abschnitte, 0) });
        return [...(at > 0 ? [{ text: ", " }] : []), { text: eine.name, ref: eine.ref }, { text: ` (${wo})` }];
    });
    return [{ key: "gemeinsam", label: t("infoPanel.field.gemeinsam"), value: { kind: "parts", parts } }];
}

/** Namen als Links, durch ein Zeichen getrennt (Legacy trennt mit „ · “, zwei Enden mit „ ↔ “). */
function linkedParts(links: readonly SubjectLink[], separator: string): TextPart[] {
    return links.flatMap((link, at): TextPart[] => [
        ...(at > 0 ? [{ text: separator }] : []),
        { text: link.name, ref: link.ref },
    ]);
}

/**
 * Die Zeilen der Gestalt einer Kraftlinie (Legacy `powerlineInfoboxMarkup`): „Verbindet“ („A ↔ B“ bei zwei Enden, sonst alle Enden), „Verläuft
 * über“ (mit „…“, wenn es mehr gibt als gezeigt werden) und „Abschnitte“ (die Zahl, bei einem Ring mit „· geschlossener Ring“).
 */
function shapeRows(
    slot: "shape:ends" | "shape:via" | "shape:segments",
    shape: SubjectLineShape | undefined,
): RowModel[] {
    if (shape === undefined) return [];
    switch (slot) {
        case "shape:ends":
            return shape.ends === undefined
                ? []
                : [
                      {
                          key: "shape:ends",
                          label: t("infoPanel.field.powerlineEnds"),
                          value: {
                              kind: "parts",
                              parts: linkedParts(shape.ends, shape.ends.length === 2 ? " ↔ " : " · "),
                          },
                      },
                  ];
        case "shape:via":
            return shape.via === undefined
                ? []
                : [
                      {
                          key: "shape:via",
                          label: t("infoPanel.field.powerlineVia"),
                          value: {
                              kind: "parts",
                              parts: [
                                  ...linkedParts(shape.via, " · "),
                                  ...(shape.viaMore === true ? [{ text: " …" }] : []),
                              ],
                          },
                      },
                  ];
        case "shape:segments": {
            if (shape.segments === undefined) return [];
            const ring = shape.ring === true ? ` · ${t("infoPanel.powerlineRing")}` : "";
            // Teilzuordnung (WI-0205): Die Linie ist EINE Gruppe; die Abschnitte ohne ihren Artikel stehen hier, nicht als zweite Linie.
            const ohne =
                shape.segmentsWithoutWiki === undefined
                    ? ""
                    : ` · ${t("infoPanel.powerlineOhneArtikel", { n: formatNumber(shape.segmentsWithoutWiki, 0) })}`;
            return [
                {
                    key: "shape:segments",
                    label: t("infoPanel.field.powerlineSegments"),
                    value: { kind: "text", text: `${formatNumber(shape.segments, 0)}${ring}${ohne}` },
                },
            ];
        }
    }
}

/**
 * Die vier Vorkommenszeilen an ihrem Platz in der Tabelle (WI-0091 §4.2): je Art eine, in Legacys Reihenfolge (Waren, Fauna,
 * Flora, Spezies), mit dem Zählsatz als Deckelaufschrift. 🔴 Eine Art ohne Zähler hat keine Zeile; eine Art MIT Zähler steht
 * da, auch wenn er 0 ist - dann trägt die Zeile allein den Link „Überall in Aventurien“ (WI-0104, `loreRowsOf`).
 */
function loreRows(lore: RowExtras["lore"]): RowModel[] {
    return lore === undefined ? [] : loreRowModels(loreRowsOf(lore.ref, lore.counts));
}

/**
 * Die EINE Hülle, die aus Vorkommenswerten Zeilen der Feldliste macht: Schlüssel und Beschriftung, sonst nichts.
 *
 * 🪤 Sie steht hier, weil drei Stellen sie brauchen und sie sich sonst dreimal wiederholte: der Gegenstand mit Zählern
 * (oben), die Routenetappe (`route-planner/stage-lore.ts`, WI-0106) und der Kartenpunkt (WI-0110).
 */
export const loreRowModels = (values: readonly LoreRowValue[]): RowModel[] =>
    values.map((value) => ({ key: `lore:${value.loreKind}`, label: loreLabel(value.loreKind), value }));

/**
 * Die Zeile „Stätten“ an ihrem Platz in der Tabelle (WI-0109): ÜBER den Vorkommen (Owner 2026-08-15: „tu die stätten über
 * Waren“). 🔴 Ohne Zahl und bei 0 entsteht sie nicht - anders als eine Vorkommenszeile, die bei 0 den Link „Überall in
 * Aventurien“ trägt (WI-0104); hier gibt es keinen, die Zeile wäre wirklich leer (Legacy lässt sie aus demselben Grund weg).
 */
function staettenRows(staetten: RowExtras["staetten"]): RowModel[] {
    if (staetten === undefined) return [];
    return staettenRowOf(staetten.ref, staetten.count).map((value) => ({
        key: "staetten",
        label: staettenLabel(),
        value,
    }));
}

/**
 * Die Zeilen eines Subjects mit Detail-Endpunkt: erst Legacys Tabelle in seiner Reihenfolge, dann - nur freigegeben - die Zusatzfelder
 * und der übrige Kontext.
 */
export function rowsOf(
    kind: SubjectDetailKind,
    alleFakten: readonly SubjectFact[],
    context: SubjectContext | undefined,
    rules: PanelRules,
    extras: RowExtras,
): RowModel[] {
    // O3 „nur Sprachen“ (WI-0261): Wo die Flächen Sprachen nennen, steht keine zweite Zeile „Sprache“ aus dem Wiki daneben.
    const facts =
        extras.sprachen !== undefined && extras.sprachen.length > 0
            ? alleFakten.filter((fact) => fact.field !== "sprache")
            : alleFakten;
    const rows: RowModel[] = [];
    const used = new Set<SubjectFact>();
    const usedContext = new Set<string>();
    const add = (fact: SubjectFact, index: number): void => {
        used.add(fact);
        // Alle Nachbarn stehen in EINER Zeile, dort, wo der erste stünde.
        if (fact.field === "neighbors") {
            for (const other of facts) if (other.field === "neighbors") used.add(other);
            const row = neighborsRow(facts);
            if (row !== undefined) rows.push(row);
            return;
        }
        const row = factRow(kind, fact, index, facts, rules, extras);
        if (row !== undefined) rows.push(row);
    };
    for (const slot of LEGACY_ROWS[kind]) {
        if (isContextSlot(slot)) {
            usedContext.add(slot);
            rows.push(...contextRows(kind, context, slot, extras.sprachen));
            continue;
        }
        if (slot === "claimants") {
            rows.push(...claimantRows(extras.claimants));
            continue;
        }
        if (slot === "gemeinsam") {
            rows.push(...gemeinsamRows(extras.gemeinsam));
            continue;
        }
        if (isShapeSlot(slot)) {
            rows.push(...shapeRows(slot, extras.lineShape));
            continue;
        }
        if (slot === "lore") {
            // 🔴 Die Landschaften samt „Sprachen“ stehen ÜBER den Vorkommen (WI-0261; Betreiber 2026-10-31: „sprachen soll immer zwischen "Regionen" und
            // "Derographie" bzw. über "Waren, Fauna, ..." in der tabelle gelistet werden“): Wo Legacys Tabelle sie nicht nennt (Ort, Gebiet), rücken sie
            // als Ganzes vor die Vorkommen, statt hinter der Tabelle zu stehen; „Sprachen“ bleibt so zwischen „Regionen“ und „Topographie“.
            if (rules.approved[kind].context && !usedContext.has("ctx:landscapes")) {
                usedContext.add("ctx:landscapes");
                rows.push(...contextRows(kind, context, "ctx:landscapes", extras.sprachen));
            }
            rows.push(...loreRows(extras.lore));
            continue;
        }
        if (slot === "staetten") {
            rows.push(...staettenRows(extras.staetten));
            continue;
        }
        facts.forEach((fact, index) => {
            if (fact.field === slot && !used.has(fact)) add(fact, index);
        });
    }
    // Freigegebene Zusatzfelder hinter der Tabelle.
    facts.forEach((fact, index) => {
        if (!used.has(fact)) add(fact, index);
    });
    if (rules.approved[kind].context) {
        for (const slot of ["ctx:landscapes", "ctx:climate", "ctx:rivers"] as const) {
            if (!usedContext.has(slot)) rows.push(...contextRows(kind, context, slot, extras.sprachen));
        }
    }
    return rows;
}

/**
 * Die Zeilen einer freien Kartenstelle: Derographie, Topographie, Vegetation, die vier Vorkommenszeilen, Klimazone und die
 * Flüsse in der Nähe - in der Reihenfolge, die `MAP_POINT_ROWS` nennt (WI-0110; vorher stand sie hier ein zweites Mal).
 *
 * 🔴 **Die Vorkommen bringen ihre Antwort MIT** (`detail.lore`): Ein Kartenpunkt hat keine Sektionsadresse, unter der eine
 * Zeile sie nachholen könnte - dieselbe Lage wie bei der Routenetappe (WI-0106). Fehlt das Feld, fehlen die vier Zeilen; es
 * entsteht nie eine Zeile, die auf eine Antwort wartet, die nicht kommt.
 */
export function mapPointRows(
    context: SubjectContext | undefined,
    lore?: readonly LoreRowView[] | undefined,
    sprachen?: readonly SubjectSprache[] | undefined,
): RowModel[] {
    const rows: RowModel[] = [];
    for (const slot of MAP_POINT_ROWS) {
        // Die Sprachen der Stelle (WI-0261) hinter „Regionen“, wie in den übrigen Infoboxen.
        if (isContextSlot(slot)) rows.push(...contextRows("mapPoint", context, slot, sprachen));
        else if (slot === "lore" && lore !== undefined) rows.push(...loreRowModels(loreRowsOfSection({ rows: lore })));
    }
    return rows;
}

const DIRECTIONS = ["n", "no", "o", "so", "s", "sw", "w", "nw"] as const;

/** Die Peilung als Zeichen und Wort: „Südwest (259,1°)“; die Nadel dreht sich um die ECHTE Peilung, das Wort wirft 25° weg. */
function bearingOf(degrees: number): NonNullable<TextPart["bearing"]> {
    const direction = DIRECTIONS[Math.round(degrees / 45) % 8] ?? "n";
    return {
        degrees,
        label: t("infoPanel.bearing", { word: t(`infoPanel.dir.${direction}`), degrees: formatNumber(degrees, 1) }),
    };
}

/**
 * „In der Nähe (n)“ (Legacy `avesmapsWhatIsHereNearbyMarkup`): je Nachbar eine Zeile in der Form der Feldliste - die Art links
 * (Ortsklasse oder Wegart), rechts der Name als Link (wo er einen hat), „ · “ und der Abstand in Meilen mit der Nadel. Die Reihenfolge ist
 * die des Servers (nach Entfernung). Keine Nachbarn, kein Abschnitt.
 */
export function nearbyModelOf(items: readonly NearbyItem[] | undefined): NearbyModel | undefined {
    if (items === undefined || items.length === 0) return undefined;
    const rows = items.map((item, at): RowModel => {
        const miles: TextPart = {
            text: t("infoPanel.miles", { n: formatNumber(item.miles, 1) }),
            bearing: bearingOf(item.bearing),
        };
        return {
            key: `nearby:${String(at)}`,
            label: typeLabel(item.ref.kind, item.type),
            value: {
                kind: "parts",
                parts: item.name === undefined ? [miles] : [{ text: item.name, ref: item.ref }, { text: " · " }, miles],
            },
        };
    });
    return { heading: t("infoPanel.nearby"), count: rows.length, rows };
}
