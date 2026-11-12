import {
    istLandmarkenArt,
    LANDMARKEN_KATALOG,
    landmarkWaypointId,
    mapPointId,
    type MapPointRef,
    type SubjectDetail,
    type SubjectDetailKind,
    type SubjectRef,
} from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";
import { shareAddress } from "./share-address";
import type { CatalogModel } from "./catalog-model";
import type { ActionRun, PanelAction, PanelEnv } from "./panel-types";

/**
 * Das Aktionsband (WI-0063 P6, Design Guide §16.2/§13.6; Legacy `locationActionsMarkup`, `pathWikiInfoboxMarkup`, `buildRegionLabelViewPopupHtml`,
 * `avesmapsWhatIsHereMarkup`, `powerlineInfoboxMarkup`, Mirror `b9657635a`): welche Kacheln ein Subject trägt, in Legacys Reihenfolge.
 *
 * - **Ort:** Reiseziel hinzufügen (gefüllt) beziehungsweise entfernen, Link teilen, Bewertung schreiben (WI-0269), Änderungen vorschlagen.
 * - **Kartenpunkt:** Reiseziel hinzufügen beziehungsweise entfernen, Link teilen (`?pin=`), Entfernen.
 * - **Landmarke** (Subject `peak`, auch Gipfel und Vulkan): Reiseziel hinzufügen beziehungsweise entfernen, wenn ihre Art Reiseziel sein
 *   darf (`LANDMARKEN_KATALOG`, WI-0271 L6: Wegpunkt `l:<uuid>`), Link teilen, Änderungen vorschlagen.
 * - **Landschaft, Gebiet:** Link teilen (nur mit Wiki-Adresse, wie Legacy), Änderungen vorschlagen.
 * - **Weg:** Anzeigen (die ganze Gruppe), Link teilen (nur mit Wiki-Adresse), Änderungen vorschlagen, Weg als Route (P7, B12: nur mit Wiki-Artikel,
 *   mindestens zwei Orten und nie bei Seewegen - der Server nennt die Orte nur dann; Legacy `pathAlsRouteKachelMarkup`).
 * - **Kraftlinie:** Anzeigen, Änderungen vorschlagen. 🔴 Kein „Link teilen“: Legacy führt es dort bewusst nicht („ein Knopf, der nichts
 *   Auflösbares erzeugt, wäre schlimmer als keiner“), und für eine Kraftlinie gibt es keinen Objektlink-Parameter.
 *
 * „Änderungen vorschlagen“ öffnet seit WI-0268 C2 das Meldeformular zum Objekt (`run: { type: "suggest", … }`): Objektart, Kennung und der Schnappschuss von Name, Art
 * und Lage. Die Handlung führt `panel-actions.ts` über die Naht `openSuggest` aus; an der Karte ändert sich nichts, der Vorschlag geht an die Redaktion. Bis WI-0268 war die
 * Kachel gesperrt (WI-0063 4.1). Nennt die Antwort die Kennung des Objekts nicht, bleibt sie gesperrt, und die Zeile unter dem Band sagt es (Guide §13.11).
 */

const soft = (id: PanelAction["id"], label: string, icon: PanelAction["icon"]): PanelAction => ({
    id,
    label,
    tone: "soft",
    icon,
});

/** Die Kennung, unter der der Server das Objekt kennt (`public_id`; bei einem Weg oder einer Kraftlinie der Anker); `undefined`, wo die Kennung fehlt. */
const objektKennung = (ref: SubjectRef): string | undefined => {
    switch (ref.kind) {
        case "place":
        case "area":
        case "territory":
        case "peak":
            return ref.id;
        case "path":
            return "anchor" in ref ? ref.anchor : undefined;
        case "powerline":
            return ref.anchor;
        default:
            return undefined;
    }
};

const suggest = (
    kind: SubjectDetailKind,
    detail: SubjectDetail,
    title: string,
    typeKey: string | undefined,
): PanelAction => {
    const gesperrt = soft("suggest", t("infoPanel.action.suggest"), { image: "vorschlag" });
    const objektId = objektKennung(detail.subject);
    if (objektId === undefined) return gesperrt;
    return {
        ...gesperrt,
        run: {
            type: "suggest",
            objektArt: kind,
            objektId,
            name: title,
            ...(typeKey === undefined || typeKey === "" ? {} : { typ: typeKey }),
            ...(detail.target === undefined ? {} : { lage: { x: detail.target.x, y: detail.target.y } }),
        },
    };
};

const share = (url: string | undefined, what: "place" | "pin"): PanelAction[] =>
    url === undefined
        ? []
        : [
              {
                  ...soft("share", t("infoPanel.action.share"), { image: "linkteilen" }),
                  run: { type: "share", url, what },
              },
          ];

/**
 * „Bewertung schreiben“ (WI-0269 C10, Bedienkonzept §6.3): die Kachel zwischen „Link teilen“ und „Änderungen vorschlagen“, nur an einem Ort. Das Zeichen ist der Stern in der Farbe der Bewertungssterne
 * (Guide §16.6). Sie steht über den Reitern, weil sie für den Ort gilt und nicht für einen Reiter. Das Formular braucht nur Kennung und Name des Orts.
 */
const review = (ref: SubjectRef, title: string): PanelAction[] =>
    ref.kind === "place"
        ? [
              {
                  ...soft("review", t("infoPanel.action.review"), { glyph: "★" }),
                  run: { type: "review", ortId: ref.id, ortName: title },
              },
          ]
        : [];

const show = (detail: SubjectDetail): PanelAction[] =>
    detail.target === undefined
        ? []
        : [
              {
                  id: "show",
                  label: t("infoPanel.action.show"),
                  tone: "accent",
                  icon: { image: "sextant" },
                  run: { type: "show" },
              },
          ];

/**
 * „Weg als Route“ (Legacy `pathAlsRouteKachelMarkup`, Symbol `waypoint-end` - die Ziel-Nadel des Planers): nur, wenn der Server die Orte
 * der Straße nennt. Die Orte sind schon geordnet und ohne Kreuzungen, offene Enden und verborgene Orte; hier werden sie zu Wegpunkten.
 */
const pathAsRoute = (detail: SubjectDetail): PanelAction[] =>
    detail.routePlaces === undefined
        ? []
        : [
              {
                  ...soft("pathAsRoute", t("infoPanel.action.pathAsRoute"), { image: "waypoint-end" }),
                  run: {
                      type: "pathAsRoute",
                      places: detail.routePlaces.map((place) => ({ ...place, hidden: false })),
                  },
              },
          ];

/**
 * „Reiseziel hinzufügen“ an einer Landmarke (WI-0271 L6): wie am Ort über `addPlace`, mit dem Wegpunkt `l:<uuid>`, ihrem Namen und ihrer
 * Lage. Nur wenn ihre Art Reiseziel sein darf (Riff und Strudel nicht) und die Antwort die Lage nennt; ist sie schon Wegpunkt, „entfernen“.
 */
const landmarkDestination = (
    ref: SubjectRef,
    detail: SubjectDetail,
    title: string,
    typeKey: string | undefined,
    env: PanelEnv,
): PanelAction[] => {
    if (ref.kind !== "peak" || typeKey === undefined || !istLandmarkenArt(typeKey)) return [];
    if (!LANDMARKEN_KATALOG[typeKey].reiseziel) return [];
    const id = landmarkWaypointId(ref.id);
    if (env.isDestination(id)) return [destination("remove", { type: "removeDestination", id })];
    const target = detail.target;
    if (target === undefined) return [];
    return [
        destination("add", {
            type: "addPlace",
            hit: { id, name: title, subtype: typeKey, hidden: false, x: target.x, y: target.y, landmark: typeKey },
        }),
    ];
};

function destination(tone: "add" | "remove", run: PanelAction["run"]): PanelAction {
    return tone === "add"
        ? {
              id: "addDestination",
              label: t("infoPanel.action.addDestination"),
              tone: "accent",
              icon: { glyph: "+" },
              ...(run ? { run } : {}),
          }
        : {
              id: "removeDestination",
              label: t("infoPanel.action.removeDestination"),
              tone: "danger",
              icon: { glyph: "✕" },
              ...(run ? { run } : {}),
          };
}

/** Das Band eines Subjects mit Detail-Endpunkt. */
export function actionsOf(
    kind: SubjectDetailKind,
    detail: SubjectDetail,
    title: string,
    typeKey: string | undefined,
    env: PanelEnv,
): PanelAction[] {
    const ref = detail.subject;
    const address = shareAddress(env.pageUrl, ref, { wikiUrl: detail.wiki?.url, pathSubtype: typeKey });
    switch (kind) {
        case "place": {
            if (ref.kind !== "place") return [];
            const target = detail.target;
            const toggle = env.isDestination(ref.id)
                ? [destination("remove", { type: "removeDestination", id: ref.id })]
                : target === undefined
                  ? []
                  : [
                        destination("add", {
                            type: "addPlace",
                            hit: {
                                id: ref.id,
                                name: title,
                                subtype: typeKey ?? "",
                                hidden: false,
                                x: target.x,
                                y: target.y,
                            },
                        }),
                    ];
            return [
                ...toggle,
                ...share(address, "place"),
                ...review(ref, title),
                suggest(kind, detail, title, typeKey),
            ];
        }
        case "peak":
            return [
                ...landmarkDestination(ref, detail, title, typeKey, env),
                ...share(address, "place"),
                suggest(kind, detail, title, typeKey),
            ];
        case "area":
        case "territory":
            return [...share(address, "place"), suggest(kind, detail, title, typeKey)];
        case "path":
            // Legacys Reihenfolge: Anzeigen, Link teilen, Änderungen vorschlagen, Weg als Route.
            return [
                ...show(detail),
                ...share(address, "place"),
                suggest(kind, detail, title, typeKey),
                ...pathAsRoute(detail),
            ];
        case "powerline":
            return [...show(detail), suggest(kind, detail, title, typeKey)];
    }
}

/**
 * Das Band einer Sprache (WI-0261 S5b): Anzeigen (die Kamera fliegt auf ihre Hauptteile) und Link teilen (`?sprache=<schluessel>`). Die Bauvorlage zeigt Besuchern
 * kein Band; „Anzeigen“ und „Link teilen“ sind die Kacheln, die jeder Gegenstand mit Ziel und Adresse trägt. „Änderungen vorschlagen“ fehlt: Es gibt noch keinen
 * Spracheditor (S5d).
 */
export function spracheActions(detail: SubjectDetail, env: PanelEnv): PanelAction[] {
    const address = shareAddress(env.pageUrl, detail.subject, { spracheSchluessel: detail.sprache?.schluessel });
    return [...show(detail), ...share(address, "place")];
}

/**
 * Das Band eines Wetter-Icons mit Wiki-Verweis (WI-0288): Anzeigen (die Kamera fliegt auf das Icon und seine Reichweite) und Link teilen (`?wetter=<Kennung>`). Kein
 * „Änderungen vorschlagen“: Icons setzt ein Editor im Wetter-Editor, und der Vorschlagsweg kennt keine.
 */
export function wetterSymbolActions(detail: SubjectDetail, env: PanelEnv): PanelAction[] {
    return [...show(detail), ...share(shareAddress(env.pageUrl, detail.subject), "place")];
}

/** Das Band der freien Kartenstelle (Legacy „Was ist hier?“): Reiseziel, Link teilen, Entfernen. */
export function mapPointActions(ref: MapPointRef, env: PanelEnv): PanelAction[] {
    const id = mapPointId(ref);
    return [
        env.isDestination(id)
            ? destination("remove", { type: "removeDestination", id })
            : destination("add", { type: "addMapPoint", x: ref.x, y: ref.y }),
        ...share(shareAddress(env.pageUrl, ref), "pin"),
        {
            id: "removePoint",
            label: t("infoPanel.action.removePoint"),
            tone: "danger",
            icon: { image: "papierkorb" },
            run: { type: "closePoint" },
        },
    ];
}

/**
 * Die Kacheln UNTER einem Katalogstreifen (WI-0118; Legacy `buildCityMapsSectionMarkup` L313-315 und L295-299, `buildGameLiteratureSectionMarkup`
 * L963-965): „Kartensammlung anzeigen“ und „Karte vorschlagen“ unter der Kartensammlung, „Literatur anzeigen“ unter der Literatur.
 *
 * 🔴 „Karte vorschlagen“ bleibt GESPERRT (WI-0063 4.1), anders als „Änderungen vorschlagen“ seit WI-0268 C2: In Legacy ist es eine anonyme Einreichung einer Karte an die
 * Redaktion, eine eigene Kategorie des Community-Moduls („Karte vorschlagen“ und „Fundort“, Fachkonzept §3.2: ausdrücklich nicht im ersten Schnitt). Die Kachel steht, hat
 * aber keine `run`-Beschreibung - sie löst keinen Request aus. Warum, steht als Zeile unter dem Band.
 */
export function catalogActions(model: CatalogModel): PanelAction[] {
    const open: ActionRun = { type: "openCatalog", section: "citymaps", ref: model.ref, name: model.name };
    switch (model.section) {
        case "citymaps": {
            const vorschlagen: PanelAction = {
                ...soft("citymapsSuggest", t("infoPanel.citymaps.suggest"), { image: "feder" }),
                run: { type: "suggestMap", ref: model.ref, name: model.name, hatKarten: model.leer !== true },
            };
            // Ein Ort ohne Karte hat nichts anzuzeigen: Die Einladung trägt nur „Karte vorschlagen“.
            if (model.leer === true) return [vorschlagen];
            return [
                {
                    ...soft("citymapsAll", t("infoPanel.citymaps.all"), { image: "kartensammlung" }),
                    run: open,
                },
                vorschlagen,
            ];
        }
        case "literature":
            return [
                {
                    ...soft("literatureAll", t("infoPanel.literature.all"), { image: "literatur" }),
                    run: { ...open, section: "literature" },
                },
            ];
        case "reviews":
            return [];
    }
}

/** Gibt es eine gesperrte Kachel? Dann steht ihre Erklärung unter dem Band. */
export const hasLockedAction = (actions: readonly PanelAction[]): boolean =>
    actions.some((action) => action.run === undefined);
