import type {
    MapPointDetail,
    MapPointRef,
    RouteResponse,
    SubjectDetail,
    SubjectDetailKind,
    SubjectFact,
} from "@avesmaps3d/shared";
import { gradAusKartenpunkt, gradPunktText } from "@avesmaps3d/shared";
import { formatNumber, isMessageKey, t } from "../i18n/i18n";
import { climateZoneName } from "../map/climate-zones";
import { catalogsOf } from "./catalog-model";
import { headerGraphicOf, headerGraphicOfPoint } from "./header-graphic";
import { LEGACY_STAIRCASE } from "./legacy-rows";
import { actionsOf, hasLockedAction, mapPointActions } from "./panel-action-model";
import { headerOf, wikiOf } from "./panel-header";
import { allowedFacts, mapPointRows, nearbyModelOf, rowsOf } from "./panel-rows";
import { liesInOf } from "./panel-staircase";
import { stageModel } from "./panel-stage";
import { spracheModel } from "./sprache-model";
import { wetterSymbolModel } from "./wetter-symbol-model";
import type { HeaderModel, PanelEnv, PanelModel } from "./panel-types";
import type { ShownSubject } from "./subject-selection";

/**
 * Das Modell des Infopanels aus dem, was die Auswahl hält (WI-0063 P6): Es ersetzt `viewOf` aus P5. EINE Stelle baut aus der Antwort
 * des Servers, der Regel „wie Legacy“ und dem Stand der Reise, was die Bausteine zeichnen (`panel-types.ts`). Reine Funktionen: Sie
 * lassen sich prüfen, ohne den Browser zu öffnen, und der Server liefert nie HTML.
 *
 * Die Reihenfolge ist die der Gareth-Infobox in Legacy (WI-0063 27.7): Kopf - Aktionen - „Liegt in“ - Datentabelle - Quellenkasten (Wikizeile,
 * Quellen, Publikationen in EINEM Kasten).
 */

const isDetailKind = (kind: string): kind is SubjectDetailKind =>
    kind === "place" ||
    kind === "path" ||
    kind === "area" ||
    kind === "territory" ||
    kind === "peak" ||
    kind === "powerline";

/** Vorläufig: Solange die Antwort fehlt, steht der Name, den die Karte schon kannte, über dem Platzhaltergrund des Bildes. */
function pending(shown: ShownSubject): PanelModel {
    return { header: { title: shown.title ?? "", subtitle: [], images: [] }, actions: [], rows: [], catalogs: [] };
}

/**
 * Ein Klimaband (WI-0063 27.12, Legacy `showEcosystemAreaInfopanel`): nur der Kopf - Name und „Klimazonen“ über dem Bild der Art -, keine
 * Felder, keine Aktion, keine Quellen. Mehr kennt die Karte von einem Band nicht, und das Panel erfindet nichts dazu.
 */
function climateModel(shown: ShownSubject, detail: SubjectDetail): PanelModel {
    const layer = detail.subtitle?.find((part) => part.part === "layer");
    const layerKey = layer?.part === "layer" ? `layer.${layer.key}` : "";
    // Der Name aus der Sprachtafel (WI-0171): Der Server schickt mit `title` seinen deutschen Stamm, der Ref den Schlüssel.
    const band = detail.subject.kind === "climate" ? detail.subject.band : "";
    return {
        header: {
            title: climateZoneName(band, detail.title ?? shown.title ?? t("infoPanel.untitled")),
            subtitle: isMessageKey(layerKey) ? [{ parts: [{ text: t(layerKey) }] }] : [],
            graphic: headerGraphicOf("climate", undefined),
            images: [],
        },
        actions: [],
        rows: [],
        catalogs: [],
    };
}

function detailModel(shown: ShownSubject, detail: SubjectDetail, env: PanelEnv): PanelModel {
    const kind = detail.subject.kind;
    if (kind === "climate") return climateModel(shown, detail);
    if (kind === "sprache") return spracheModel(shown, detail, env);
    // Ein Wetter-Icon mit Wiki-Verweis (WI-0288): Kopf mit Typbild, Region, Beschreibung, Wikizeile.
    if (kind === "wetterSymbol") return wetterSymbolModel(shown, detail, env);
    if (!isDetailKind(kind)) return pending(shown);
    const baseHeader = headerOf(kind, detail, shown.title, env.rules);
    // Legacys Markierungszeile unter der Wegart: „Ganze Straße: Perz – Helmdahl“ (P7; der Server nennt die zwei äußeren Orte).
    const header: HeaderModel =
        kind === "path" && detail.stretch !== undefined
            ? {
                  ...baseHeader,
                  note: {
                      label: t("infoPanel.stretch"),
                      text: t("infoPanel.stretchRange", { from: detail.stretch.from, to: detail.stretch.to }),
                  },
              }
            : baseHeader;
    const type = detail.subtitle?.find((part) => part.part === "type");
    const typeKey = type?.part === "type" ? type.key : undefined;
    const facts = allowedFacts(kind, detail.facts, env.rules);
    // Legacy `locationDescriptionMarkup`: Ein Ort ohne Wiki-Nest, der als Ruine gilt, sagt es in der Beschreibungszeile.
    const hasNest = (detail.facts ?? []).some(
        (fact: SubjectFact) => !("layer" in fact && fact.layer === "direct") && fact.provenance.kind === "wiki",
    );
    const ruinNote = kind === "place" && !hasNest && (detail.subtitle ?? []).some((part) => part.part === "ruin");
    const rows = rowsOf(kind, facts, detail.context, env.rules, {
        ruinNote,
        claimants: detail.claimants,
        // Weg (WI-0302): „Gemeinsam mit“ den Straßen, mit denen er Abschnitte teilt.
        gemeinsam: detail.gemeinsam,
        lineShape: detail.lineShape,
        // Die Vorkommen (D5, WI-0091): nur die Zähler der Detailantwort; die Namen holt jede Zeile beim Aufklappen selbst.
        lore: { ref: detail.subject, counts: detail.counts?.lore },
        // Die Stätten (D7, WI-0109): dieselbe Rezeptur, nur eine Zahl; die Namen holt die Zeile beim Aufklappen selbst.
        staetten: { ref: detail.subject, count: detail.counts?.staetten },
        // Die Zeile „Sprachen“ (WI-0261 S5b) zwischen „Regionen“ und „Topographie“.
        sprachen: detail.sprachen,
    });
    if (ruinNote && !rows.some((row) => row.key.startsWith("description"))) {
        rows.unshift({
            key: "description:ruin",
            label: t("infoPanel.field.description"),
            value: { kind: "text", text: t("infoPanel.ruinNote") },
        });
    }
    const actions = actionsOf(kind, detail, header.title, typeKey, env);
    const liesIn =
        env.rules.approved[kind].context || LEGACY_STAIRCASE.has(kind)
            ? liesInOf(detail.context?.territories)
            : undefined;
    const wiki = wikiOf(detail);
    const sources = detail.counts?.sources;
    return {
        header,
        actions,
        ...(hasLockedAction(actions) ? { actionsNote: t("infoPanel.action.suggestLocked") } : {}),
        ...(liesIn === undefined ? {} : { liesIn }),
        rows,
        ...(wiki === undefined ? {} : { wiki }),
        ...(sources === undefined ? {} : { sources: { ref: detail.subject, count: sources } }),
        // Die Katalogabschnitte stehen NACH dem Quellenkasten (WI-0063 27.7); gebaut wird nur, was die Antwort zählt.
        catalogs: catalogsOf(detail.subject, header.title, detail.counts),
    };
}

/**
 * Die freie Kartenstelle „Was ist hier?“ (WI-0063 4.9, Legacy `avesmapsWhatIsHereMarkup`): Tropfen, Kontext, Reiseziel, Link, Entfernen -
 * und, was rundherum liegt („In der Nähe“, P7), dazu die Vorkommen der Flächen, die diese Stelle enthalten (WI-0110).
 */
function mapPointModel(ref: MapPointRef, detail: MapPointDetail | undefined, env: PanelEnv): PanelModel {
    const context = detail?.context;
    const liesIn = liesInOf(context?.territories);
    const actions = mapPointActions(ref, env);
    const nearby = nearbyModelOf(detail?.nearby);
    // Die Grade des Gradnetzes, 0° in Gareth (WI-0273, Betreiber 2026-10-31: „in der infobox bei "Was ist hier?" … die gradnetz
    // koordinaten ausgeben“); bis dahin galt „keine erfundene Länge/Breite“ (WI-0063 4.9). Die Koordinate der Karte bleibt hinter
    // einem verborgenen Klick (`wechsel`).
    const grad = gradAusKartenpunkt(ref);
    const richtung = {
        nord: t("gradnetz.nord"),
        sued: t("gradnetz.sued"),
        ost: t("gradnetz.ost"),
        west: t("gradnetz.west"),
    };
    return {
        header: {
            title: t("infoPanel.mapPoint.title"),
            subtitle: [
                {
                    parts: [
                        {
                            text: t("infoPanel.mapPoint.subtitle.grad", {
                                breite: gradPunktText(grad.lat, "lat", richtung),
                                laenge: gradPunktText(grad.lon, "lon", richtung),
                            }),
                            wechsel: t("infoPanel.mapPoint.subtitle", {
                                x: formatNumber(ref.x, 2),
                                y: formatNumber(ref.y, 2),
                            }),
                        },
                    ],
                },
            ],
            // Das Bild folgt der Gegend (Legacy: erste Vegetation, dann Topographie); vor der Antwort steht der Platzhaltergrund.
            ...(detail === undefined ? {} : { graphic: headerGraphicOfPoint(context?.landscapes?.items) }),
            images: [],
        },
        actions,
        ...(liesIn === undefined ? {} : { liesIn }),
        // Die Vorkommen der Flächen, die diese Stelle enthalten (WI-0110): Sie stehen schon in der Antwort, weil ein
        // Kartenpunkt keine Sektionsadresse hat - die Zeile fragt nichts nach.
        rows: mapPointRows(context, detail?.lore, detail?.sprachen),
        ...(nearby === undefined ? {} : { nearby }),
        // Eine freie Kartenstelle ist kein Träger: Sie hat keine Werke, keine Karten und keine Bewertungen.
        catalogs: [],
    };
}

/** Das Modell für das, was gerade gezeigt wird; `undefined`, wenn nichts gewählt ist. */
export function panelModelOf(
    shown: ShownSubject | undefined,
    route: RouteResponse | null,
    env: PanelEnv,
): PanelModel | undefined {
    if (shown === undefined) return undefined;
    const { ref, answer } = shown;
    // Der Eintrag eines Vorkommens zeichnet sich selbst (`info-eintrag.vue`): kein Modell aus einer Detailantwort.
    if (ref.kind === "loreEntry") return undefined;
    if (ref.kind === "routeStage") return stageModel(ref.index, route, env);
    if (ref.kind === "mapPoint") return mapPointModel(ref, answer as MapPointDetail | undefined, env);
    if (answer !== undefined) return detailModel(shown, answer as SubjectDetail, env);
    return pending(shown);
}
