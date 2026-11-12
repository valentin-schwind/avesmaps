import type { Map as MapLibreMap } from "maplibre-gl";
import { wetterBogenAusGrad, type WetterSymbolArt, type WetterSymbolDaten } from "@avesmaps3d/shared";
import type { WetterKamera } from "./wetter-kamera";
import { meldeWetterIconSuche } from "./wetter-treffer";
import "./wetter-symbole.css";

/**
 * Die Wind-, Wirbel- und Strömungssymbole auf der Karte (WI-0288): Sie treiben die Strömung an und liegen als SVG über der Karte,
 * Zeichen, Pfeil und gestrichelter Ring der Reichweite, darunter auf Wunsch ihr Name.
 *
 * - Sie wirken immer, auch unsichtbar (Betreiber 2026-11-07: „Wirkt ein ausgeblendetes Icon? ja, es ist nur unsichtbar“). Zu sehen
 *   sind Wind und Wirbel nur mit dem Schalter „Wind“, die Strömungen nur mit „Meeresströmungen“, und nur, wenn das Icon nicht
 *   ausgeblendet ist (`sichtbar`).
 * - **Der Name** steht unter dem Icon, wenn es `nameZeigen` trägt und zu sehen ist (offener Punkt aus Stufe 2, gebaut mit Stufe 3).
 * - **Im Wetter-Editor** (Stufe 3, `editor`) stehen ALLE Icons da, auch ohne Schalter: als Griffe, ausgeblendete grau mit gestrichelter
 *   Scheibe (Betreiber 2026-11-07: „für Editoren grau als Anfasser“). Das gewählte trägt die Farbe der Auswahl und zwei Griffe: an der
 *   Pfeilspitze Richtung und Stärke, am Ring die Reichweite (Probierseite und Prototyp-Panel). Gezogen wird in `wetter-griffe.ts`; hier steht
 *   nur, wo was liegt (`treffer`).
 * - Projiziert wird mit der eigenen Kamera (`wetter-kamera.ts`), dieselbe Rechnung wie in der Engine: So stehen die Icons auch, wenn die
 *   Engine nicht läuft.
 * - Die Farben sind die des Prototyps und stehen noch nicht im Kanon (Stufe 7); die Auswahl trägt `--color-map-selection` (EDIT-0003 G9).
 * - **Griffe und Farben wie im Geometrie-Modul** (Betreiber 2026-11-08: „der wettereditor ist noch nicht so wie die andern editoren“): Pfeilspitze
 *   und Ringgriff sehen aus wie dessen Steuergriff (Knallrot mit weißem Saum, `map/geometrie/schicht.ts`), der gezogene etwas größer; während eines
 *   Zugs trägt das Icon Knallrot (G9 „wird bearbeitet“, auch beim Verschieben eines Orts), gewählt bleibt es gelb.
 * - **Für das Kartenmenü** meldet die Ebene ihre Suche an (`wetter-treffer.ts`): Ein Rechtsklick auf ein gezeichnetes Icon zeigt seine Handgriffe.
 * - **Für Besucher** (Betreiber 2026-11-08: „ja infopanel bauen“): Ein Icon MIT Wiki-Verweis (`wiki`) ist ein Gegenstand der Karte. `infoTreffer` sagt, welches unter
 *   dem Zeiger liegt (nur sichtbar gezeichnete, nie im Editor); der Besitzer `wetter-info` (`wetter-info.ts`) öffnet sein Infopanel. Steht es offen (`offen`), trägt
 *   es den Ton der Auswahl wie ein gewähltes Objekt. Ein Icon ohne Verweis nimmt keinen Klick an; er fällt auf die Karte darunter, wie bisher.
 */

export type SymbolArt = WetterSymbolArt;

/** Ein Icon in der Form der Engine (`setzeQuellen`): Richtung im Bogenmaß, 0 ist Osten. */
export interface WetterSymbol {
    id: string;
    kind: SymbolArt;
    /** Lage in Karteneinheiten (0 bis 1024). */
    x: number;
    z: number;
    /** Richtung im Bogenmaß; Wirbel haben keine. */
    dir: number;
    /** Stärke; bei Wirbeln mal der Sturmstärke der Jahreszeit. */
    s: number;
    /** Reichweite in Karteneinheiten. */
    r: number;
    /** Drehsinn der Wirbel. */
    spin: 1 | -1;
    name: string;
    /** Den Namen auf der Karte zeigen. */
    nameZeigen: boolean;
    /** Auf der Karte zu sehen; ausgeblendet wirkt das Icon weiter. */
    sichtbar: boolean;
    /** Der Titel des Wiki-Artikels, auf den es verweist; leer ohne Verweis. Mit Verweis öffnet ein Klick sein Infopanel. */
    wiki: string;
}

/** Die Icons des Lesewegs in der Form der Engine. Wind und Strömung tragen Grad nach der Windrose, Wirbel einen Drehsinn. */
export function symboleFuerEngine(daten: readonly WetterSymbolDaten[]): WetterSymbol[] {
    return daten.map((symbol) => ({
        id: symbol.id,
        kind: symbol.art,
        x: symbol.x,
        z: symbol.z,
        dir: symbol.richtung === null ? 0 : wetterBogenAusGrad(symbol.richtung),
        s: symbol.staerke,
        r: symbol.reichweite,
        spin: symbol.drehsinn ?? -1,
        name: symbol.name ?? "",
        nameZeigen: symbol.nameZeigen,
        sichtbar: symbol.sichtbar,
        wiki: symbol.wikiTitel ?? "",
    }));
}

const GLYPH: Record<SymbolArt, string> = {
    wind: "M-9 -4 H3 a3 3 0 1 0 -3 -3 M-9 1 H7 a3 3 0 1 1 -3 3 M-9 6 H-1 a2.5 2.5 0 1 1 -2.5 2.5",
    wirbel: "M0 0 a2 2 0 0 1 2 2 a4 4 0 0 1 -4 4 a6 6 0 0 1 -6 -6 a8 8 0 0 1 8 -8 a9 9 0 0 1 9 9",
    stroemung: "M-9 -5 q2.5 -3 5 0 t5 0 t5 0 M-9 0 q2.5 -3 5 0 t5 0 t5 0 M-9 5 q2.5 -3 5 0 t5 0 t5 0",
    // Engere Spirale als der Wirbel, mit mehr Windungen (WI-0288, Betreiber 2026-11-08: eigene Icon-Art „Mahlstrom“).
    mahlstrom:
        "M0 0 a1 1 0 0 1 1 1 a2 2 0 0 1 -2 2 a3 3 0 0 1 -3 -3 a4 4 0 0 1 4 -4 a5 5 0 0 1 5 5 a6 6 0 0 1 -6 6 a7 7 0 0 1 -7 -7 a8 8 0 0 1 8 -8",
};

/** Ein Icon des Meeres (Strömung, Mahlstrom): Es erscheint mit dem Schalter „Meeresströmungen“ und im Ton des Meeres. */
const imMeer = (kind: SymbolArt): boolean => kind === "stroemung" || kind === "mahlstrom";
/** Ein Icon mit Drehsinn statt Richtung (Wirbel, Mahlstrom): kein Pfeil, gespiegelt bei Drehsinn −1. Den Sturmfaktor trägt nur der Wirbel. */
const ohneRichtung = (kind: SymbolArt): boolean => kind === "wirbel" || kind === "mahlstrom";

/** Die Höhe der Symbolebene über dem Meer, in Karteneinheiten. */
export const EBENE_Y = 1;
const RING_SCHRITTE = 40;
/** Die Länge des Pfeils je Stärke, in Karteneinheiten (Prototyp). */
export const PFEIL_JE_STAERKE = 7;
/**
 * Halbmesser der Scheibe und der Griffe, in Bildpunkten: die Scheibe wie in der Probierseite (15), die Griffe wie der Steuergriff des
 * Geometrie-Moduls (5,5, gezogen 7). Gefangen wird weiter in 11 px um die Mitte eines Griffs (Probierseite: Griff 7 plus 4).
 */
const SCHEIBE_PX = 15;
const GRIFF_PX = 5.5;
const GRIFF_AKTIV_PX = 7;
const GRIFF_FANG_PX = 11;
/** Der Name steht so weit unter der Mitte (Probierseite). */
const NAME_ABSTAND_PX = 34;

const SVGNS = "http://www.w3.org/2000/svg";
function svg<K extends keyof SVGElementTagNameMap>(
    tag: K,
    eltern: Element,
    attribute: Record<string, string> = {},
): SVGElementTagNameMap[K] {
    const e = document.createElementNS(SVGNS, tag);
    for (const [name, wert] of Object.entries(attribute)) e.setAttribute(name, wert);
    eltern.appendChild(e);
    return e;
}

interface Punkt {
    x: number;
    y: number;
}

interface Gezeichnet {
    daten: WetterSymbol;
    gruppe: SVGGElement;
    ring: SVGPathElement;
    pfeil: SVGLineElement;
    scheibe: SVGCircleElement;
    zeichen: SVGPathElement;
    name: SVGTextElement;
    griffPfeil: SVGCircleElement;
    griffRing: SVGCircleElement;
    /** Wo es im letzten Bild stand; `undefined`, wenn es nicht zu sehen war. */
    lage?: { mitte: Punkt; spitze: Punkt | undefined; ring: Punkt | undefined } | undefined;
}

/** Was unter dem Zeiger liegt: die Scheibe eines Icons (`ort`), die Pfeilspitze oder der Ring des gewählten. */
export type GriffArt = "ort" | "pfeil" | "ring";
export interface Treffer {
    readonly id: string;
    readonly griff: GriffArt;
}

/** Wie die Engine die Icons bekommt; ohne Engine (nur Griffe des Editors) bleibt sie still. */
export interface Antrieb {
    setzeQuellen(symbole: readonly WetterSymbol[]): void;
    /** Die Sturmstärke der Jahreszeit (`stuerme`). */
    sturm(): number;
}

export interface Symbolebene {
    /** Gibt die Symbole an die Engine; die Wirbel mit der Sturmstärke der Jahreszeit. */
    uebertrage(): void;
    /** Neue Symbole (neu gelesen oder vom Editor): behält, was gleich geblieben ist, und gibt sie an die Engine. */
    setze(symbole: readonly WetterSymbol[]): void;
    /** Welche Symbole zu sehen sind. */
    zeige(sicht: { wind: boolean; stroemung: boolean }): void;
    /** Der Wetter-Editor: alle Icons als Griffe, das gewählte mit Griffen für Richtung, Stärke und Reichweite; `undefined` aus. */
    editor(modus: { gewaehlt: string | undefined; griffe: boolean } | undefined): void;
    /** Ein Icon ändern, während es gezogen wird (ohne Umweg über den Editor). */
    aendere(id: string, aenderung: Partial<WetterSymbol>): void;
    /** Das Icon, das gerade gezogen wird, und an welchem Griff (Knallrot, der Griff größer); `undefined` nach dem Zug. */
    zieht(id: string | undefined, griff?: GriffArt): void;
    /** Was unter einem Bildpunkt der Karte liegt (nur im Editor). */
    treffer(px: number, py: number): Treffer | undefined;
    /** Das oberste gezeichnete Icon MIT Wiki-Verweis unter einem Bildpunkt (nur außerhalb des Editors); sonst `undefined`. */
    infoTreffer(px: number, py: number): WetterSymbol | undefined;
    /** Das Icon, dessen Infopanel offen ist (`undefined`: keines): Es trägt den Ton der Auswahl. */
    offen(id: string | undefined): void;
    daten(id: string): WetterSymbol | undefined;
    /** In jedem Bild: projiziert die sichtbaren Symbole auf den Schirm. */
    zeichne(): void;
    ein(): void;
    aus(): void;
}

export function erzeugeSymbolebene(
    map: MapLibreMap,
    kamera: WetterKamera,
    antrieb: Antrieb,
    anfang: readonly WetterSymbol[],
): Symbolebene {
    const ebene = svg("svg", map.getContainer(), { class: "wetter-symbole", "aria-hidden": "true" });
    ebene.style.display = "none";
    const baue = (daten: WetterSymbol): Gezeichnet => {
        const gruppe = svg("g", ebene, { class: "ws-g", "data-art": daten.kind, "data-wetter-icon": daten.id });
        return {
            daten,
            gruppe,
            ring: svg("path", gruppe, { class: "ws-ring" }),
            pfeil: svg("line", gruppe, { class: "ws-pfeil" }),
            scheibe: svg("circle", gruppe, { class: "ws-scheibe", r: String(SCHEIBE_PX) }),
            zeichen: svg("path", gruppe, { class: "ws-zeichen", d: GLYPH[daten.kind] }),
            name: svg("text", gruppe, { class: "ws-name" }),
            griffPfeil: svg("circle", gruppe, { class: "ws-griff", r: String(GRIFF_PX) }),
            griffRing: svg("circle", gruppe, { class: "ws-griff", r: String(GRIFF_PX) }),
        };
    };
    let gezeichnet: Gezeichnet[] = anfang.map(baue);
    let sicht = { wind: false, stroemung: false };
    let modus: { gewaehlt: string | undefined; griffe: boolean } | undefined;
    let offenId: string | undefined;
    let zug: { id: string; griff: GriffArt | undefined } | undefined;

    const zuSehen = (symbol: WetterSymbol): boolean =>
        modus !== undefined || (symbol.sichtbar && (imMeer(symbol.kind) ? sicht.stroemung : sicht.wind));

    const zeichneEines = (g: Gezeichnet): void => {
        const { x, z, r, dir, s, kind, spin, name, nameZeigen, sichtbar, id } = g.daten;
        const c = kamera.projekt(x, EBENE_Y, z);
        // Außerhalb des Editors weicht das Icon dem Dunst wie Wolken, Teilchen und die Namen im Gelände (`wetter-dunst.ts`); ganz darin ist es
        // weder zu sehen noch zu treffen. Im Editor bleibt es ein Griff.
        const imDunst = c && modus === undefined ? kamera.sichtbar(x, EBENE_Y, z) : 1;
        g.gruppe.style.display = c && imDunst > 0.001 ? "" : "none";
        g.gruppe.style.opacity = imDunst >= 0.999 ? "" : imDunst.toFixed(3);
        g.lage = undefined;
        if (!c || imDunst <= 0.001) return;
        // Im Editor die Wahl des Editors, sonst das Icon, dessen Infopanel offen ist.
        const gewaehlt = modus === undefined ? offenId === id : modus.gewaehlt === id;
        g.gruppe.classList.toggle("ws-meer", imMeer(kind));
        g.gruppe.classList.toggle("ws-grau", !sichtbar);
        g.gruppe.classList.toggle("ws-sel", gewaehlt);
        g.gruppe.classList.toggle("ws-editor", modus !== undefined);
        g.gruppe.classList.toggle("ws-zieht", zug?.id === id);
        g.scheibe.setAttribute("cx", c.x.toFixed(1));
        g.scheibe.setAttribute("cy", c.y.toFixed(1));
        let d = "";
        let stift = false;
        for (let i = 0; i <= RING_SCHRITTE; i++) {
            const a = (i / RING_SCHRITTE) * 2 * Math.PI;
            const p = kamera.projekt(x + Math.cos(a) * r, EBENE_Y, z + Math.sin(a) * r);
            if (!p) {
                stift = false;
                continue;
            }
            d += `${stift ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
            stift = true;
        }
        g.ring.setAttribute("d", d);
        let winkel = 0;
        let spitze: Punkt | undefined;
        if (ohneRichtung(kind)) g.pfeil.style.display = "none";
        else {
            const laenge = s * PFEIL_JE_STAERKE;
            const t = kamera.projekt(x + Math.cos(dir) * laenge, EBENE_Y, z + Math.sin(dir) * laenge);
            g.pfeil.style.display = t ? "" : "none";
            if (t) {
                spitze = t;
                winkel = (Math.atan2(t.y - c.y, t.x - c.x) * 180) / Math.PI;
                g.pfeil.setAttribute("x1", c.x.toFixed(1));
                g.pfeil.setAttribute("y1", c.y.toFixed(1));
                g.pfeil.setAttribute("x2", t.x.toFixed(1));
                g.pfeil.setAttribute("y2", t.y.toFixed(1));
            }
        }
        const spiegel = ohneRichtung(kind) && spin < 0 ? " scale(-1 1)" : "";
        g.zeichen.setAttribute(
            "transform",
            `translate(${c.x.toFixed(1)} ${c.y.toFixed(1)}) rotate(${winkel.toFixed(1)})${spiegel}`,
        );
        const mitName = nameZeigen && name !== "";
        g.name.style.display = mitName ? "" : "none";
        if (mitName) {
            if (g.name.textContent !== name) g.name.textContent = name;
            g.name.setAttribute("x", c.x.toFixed(1));
            g.name.setAttribute("y", (c.y + NAME_ABSTAND_PX).toFixed(1));
        }
        const ringPunkt = gewaehlt ? (kamera.projekt(x + r, EBENE_Y, z) ?? undefined) : undefined;
        const griffe = gewaehlt && modus?.griffe === true;
        const halbmesser = (griff: GriffArt): string =>
            String(zug?.id === id && zug.griff === griff ? GRIFF_AKTIV_PX : GRIFF_PX);
        g.griffPfeil.style.display = griffe && spitze ? "" : "none";
        if (griffe && spitze) {
            g.griffPfeil.setAttribute("cx", spitze.x.toFixed(1));
            g.griffPfeil.setAttribute("cy", spitze.y.toFixed(1));
            g.griffPfeil.setAttribute("r", halbmesser("pfeil"));
        }
        g.griffRing.style.display = griffe && ringPunkt ? "" : "none";
        if (griffe && ringPunkt) {
            g.griffRing.setAttribute("cx", ringPunkt.x.toFixed(1));
            g.griffRing.setAttribute("cy", ringPunkt.y.toFixed(1));
            g.griffRing.setAttribute("r", halbmesser("ring"));
        }
        g.lage = { mitte: c, spitze: griffe ? spitze : undefined, ring: griffe ? ringPunkt : undefined };
    };

    let symbole: readonly WetterSymbol[] = anfang;
    const uebertrage = (): void => {
        const sturm = antrieb.sturm();
        antrieb.setzeQuellen(symbole.map((g) => (g.kind === "wirbel" ? { ...g, s: g.s * sturm } : g)));
    };

    const nah = (a: Punkt | undefined, x: number, y: number, weite: number): boolean =>
        a !== undefined && Math.hypot(a.x - x, a.y - y) <= weite;

    const treffer = (px: number, py: number): Treffer | undefined => {
        if (modus === undefined) return undefined;
        const gewaehlt = gezeichnet.find((g) => g.daten.id === modus?.gewaehlt && g.lage !== undefined);
        if (gewaehlt?.lage) {
            if (nah(gewaehlt.lage.spitze, px, py, GRIFF_FANG_PX)) return { id: gewaehlt.daten.id, griff: "pfeil" };
            if (nah(gewaehlt.lage.ring, px, py, GRIFF_FANG_PX)) return { id: gewaehlt.daten.id, griff: "ring" };
        }
        // Das oberste zuerst: Spätere liegen oben.
        for (let i = gezeichnet.length - 1; i >= 0; i--) {
            const g = gezeichnet[i]!;
            if (nah(g.lage?.mitte, px, py, SCHEIBE_PX + 1)) return { id: g.daten.id, griff: "ort" };
        }
        return undefined;
    };

    // Für das Kartenmenü: im Editor wie die Griffe, sonst jedes gezeichnete Icon an seiner Scheibe (`lage` steht nur an gezeichneten).
    meldeWetterIconSuche((px, py) => {
        const id =
            treffer(px, py)?.id ??
            [...gezeichnet].reverse().find((g) => nah(g.lage?.mitte, px, py, SCHEIBE_PX + 1))?.daten.id;
        const daten = id === undefined ? undefined : symbole.find((symbol) => symbol.id === id);
        return daten === undefined ? undefined : { id: daten.id, name: daten.name, art: daten.kind };
    });

    return {
        uebertrage,
        setze(neu): void {
            // Gleiche Kennung und Art: das gezeichnete Icon bleibt und bekommt nur die neuen Werte (ein Zug im Editor setzt in jedem Bild).
            const alt = new Map(gezeichnet.map((g) => [g.daten.id, g]));
            gezeichnet = neu.map((daten) => {
                const da = alt.get(daten.id);
                if (da !== undefined && da.daten.kind === daten.kind) {
                    alt.delete(daten.id);
                    da.daten = daten;
                    return da;
                }
                return baue(daten);
            });
            for (const weg of alt.values()) weg.gruppe.remove();
            // Die Folge im Bild ist die der Liste: Spätere liegen oben.
            for (const g of gezeichnet) ebene.appendChild(g.gruppe);
            symbole = neu;
            uebertrage();
            map.triggerRepaint();
        },
        zeige(neu): void {
            sicht = { ...neu };
        },
        editor(neu): void {
            modus = neu === undefined ? undefined : { ...neu };
            ebene.classList.toggle("wetter-symbole--editor", modus !== undefined);
            map.triggerRepaint();
        },
        aendere(id, aenderung): void {
            symbole = symbole.map((symbol) => (symbol.id === id ? { ...symbol, ...aenderung } : symbol));
            for (const g of gezeichnet) if (g.daten.id === id) g.daten = { ...g.daten, ...aenderung };
            uebertrage();
            map.triggerRepaint();
        },
        treffer,
        zieht(id, griff): void {
            const neu = id === undefined ? undefined : { id, griff };
            if (neu?.id === zug?.id && neu?.griff === zug?.griff) return;
            zug = neu;
            map.triggerRepaint();
        },
        infoTreffer(px, py): WetterSymbol | undefined {
            if (modus !== undefined) return undefined;
            for (let i = gezeichnet.length - 1; i >= 0; i--) {
                const g = gezeichnet[i]!;
                if (g.daten.wiki !== "" && nah(g.lage?.mitte, px, py, SCHEIBE_PX + 1)) return g.daten;
            }
            return undefined;
        },
        offen(id): void {
            if (offenId === id) return;
            offenId = id;
            map.triggerRepaint();
        },
        daten: (id) => symbole.find((symbol) => symbol.id === id),
        zeichne(): void {
            for (const g of gezeichnet) {
                if (zuSehen(g.daten)) zeichneEines(g);
                else {
                    g.gruppe.style.display = "none";
                    g.lage = undefined;
                }
            }
        },
        ein(): void {
            ebene.style.display = "";
            kamera.ein();
        },
        aus(): void {
            ebene.style.display = "none";
            kamera.aus();
            for (const g of gezeichnet) g.lage = undefined;
        },
    };
}
