import { describe, expect, it } from "vitest";
import { createPropertyExpression, featureFilter } from "@maplibre/maplibre-gl-style-spec";
import {
    AVENTURIA_PATH_CARTOGRAPHY,
    composeView,
    pathStyleFor,
    pathTypesInDrawOrder,
    renderZoomForBand,
} from "@avesmaps3d/shared";
import { buildFlowArrowLayer, buildPathLabelLayer, buildPathLayers } from "../src/map/path-layers.ts";
import { displayDefaults, effectiveDisplay } from "../src/map/map-display.ts";
import { buildPlaceLayers } from "../src/map/place-layers.ts";
import { asLayer, findLayer, ortsnamenImStapel, propertySpec } from "./style-spec.ts";

/**
 * Die Wegdarstellung (WI-0010 Stufe 1, P2).
 *
 * 🔴 Der wichtigste Test hier ist der letzte: die Kartografietafel darf KEINE Reisekosten tragen.
 * Kartografische Wegdarstellung und Routingkosten sind zwei Verantwortungen — eine Änderung der
 * Darstellung darf nicht nebenbei das Routing ändern (Betreiberentscheidung 2026-09-21).
 */

const DIE_ACHT = ["Reichsstrasse", "Strasse", "Weg", "Pfad", "Gebirgspass", "Wuestenpfad", "Flussweg", "Seeweg"];

describe("Wegarten-Tafel", () => {
    it("🔴 kennt genau die acht Wegarten des Bestands", () => {
        expect(Object.keys(AVENTURIA_PATH_CARTOGRAPHY.types).sort()).toEqual([...DIE_ACHT].sort());
    });

    it("💣 traegt KEINE Reisekosten, Geschwindigkeit oder Verkehrsmittel", () => {
        // Faellt dieser Test, ist die Trennung aufgeweicht worden. Legacy belegt sie selbst: seine
        // Geschwindigkeiten stehen als Matrix Verkehrsmittel x Wegart an ganz anderer Stelle, und
        // `allowed_transports` haengt sogar am einzelnen Weg.
        const verboten = /speed|cost|weight|faktor|factor|tempo|transport|travel|dauer|stunden/i;
        const roh = JSON.stringify(AVENTURIA_PATH_CARTOGRAPHY.types);
        const gefunden = [...roh.matchAll(/"(\w+)":/g)]
            .map((treffer) => treffer[1] as string)
            .filter((schluessel) => verboten.test(schluessel));
        expect(gefunden, `Reisekosten-Felder in der Kartografietafel: ${gefunden.join(", ")}`).toEqual([]);
    });

    it("🪤 zeichnet Wasser UNTEN und Reichsstrassen OBEN", () => {
        // Eine Strasse, die einen Fluss quert, gehoert ueber ihn - sonst sieht es aus, als ende sie
        // im Wasser. Legacys Reihenfolge, uebernommen.
        const reihenfolge = pathTypesInDrawOrder().map((eintrag) => eintrag.subtype);
        expect(reihenfolge[0]).toBe("Seeweg");
        expect(reihenfolge[1]).toBe("Flussweg");
        expect(reihenfolge.at(-1)).toBe("Reichsstrasse");
    });

    it("🔴 gibt jeder Art eine Kontur, die breiter ist als ihr Kern", () => {
        // Ohne Saum ist eine Linie auf einer bunten Karte nicht lesbar; ein Saum, der schmaler ist
        // als der Kern, ist gar keiner.
        for (const subtype of DIE_ACHT) {
            const style = pathStyleFor(subtype);
            expect(style.outlineWidth, `${subtype}`).toBeGreaterThan(style.centerWidth);
        }
    });

    it("💣 wirft bei einer unbekannten Wegart, statt sie still zu verschlucken", () => {
        // Anders als bei den Landschaften, wo ein Auffangwert richtig ist: acht Arten stehen in
        // einem CHECK in der Datenbank, eine neunte kann nur durch eine Migration entstehen - und
        // dann soll der Build es sagen, nicht die Karte es verschweigen.
        expect(() => pathStyleFor("Zauberpfad")).toThrow(/Zauberpfad/);
    });
});

describe("Weglayer", () => {
    it("🪤 zeichnet ALLE Konturen vor allen Kernen", () => {
        // Sonst ueberdeckte die Kontur der darueberliegenden Art den Kern der darunterliegenden,
        // und jede Kreuzung bekaeme einen hellen Fleck.
        const ids = buildPathLayers({}).map((layer) => layer.id);
        const letzteKontur = ids.findLastIndex((id) => id.startsWith("path-outline-"));
        const ersterKern = ids.findIndex((id) => id.startsWith("path-center-"));
        expect(letzteKontur).toBeLessThan(ersterKern);
    });

    it("🔴 zeichnet einen Tunnel gestrichelt, in Farbe und Breite seiner Art; Kontur und Kern im selben Takt (WI-0177)", () => {
        const layers = buildPathLayers({});
        const ids = layers.map((layer) => layer.id);
        const [strich, luecke] = AVENTURIA_PATH_CARTOGRAPHY.tunnel.dash as [number, number];
        for (const { subtype, style } of pathTypesInDrawOrder().filter(({ style }) => style.hidden !== true)) {
            const art = subtype.toLowerCase();
            const kern = findLayer(layers, `path-center-${art}`, "line");
            const kernTunnel = findLayer(layers, `path-center-${art}-tunnel`, "line");
            const konturTunnel = findLayer(layers, `path-outline-${art}-tunnel`, "line");
            expect(kernTunnel?.paint?.["line-color"], art).toBe(style.center);
            expect(kernTunnel?.paint?.["line-width"], art).toEqual(kern?.paint?.["line-width"]);
            expect(kernTunnel?.paint?.["line-dasharray"], art).toEqual([strich, luecke]);
            // MapLibre misst den Takt in Linienbreiten: Auf der breiteren Kontur ist er kürzer, damit Strich und Lücke fluchten.
            const takt = konturTunnel?.paint?.["line-dasharray"] as number[];
            expect(takt[0]! * style.outlineWidth, art).toBeCloseTo(strich * style.centerWidth, 10);
            expect(takt[1]! * style.outlineWidth, art).toBeCloseTo(luecke * style.centerWidth, 10);
            expect(kernTunnel?.layout?.["line-cap"], "stumpf, sonst ragen die Kappen in die Lücke").toBe("butt");
            expect(konturTunnel?.layout?.["line-cap"]).toBe("butt");
            // Der Filter trennt: Ein Tunnel steht nur in der gestrichelten Ebene, ein Weg ohne die Eigenschaft (alte Kachel) nur in der
            // durchgezogenen.
            const tunnel = createFilter(kernTunnel?.filter);
            const durchgezogen = createFilter(kern?.filter);
            const merkmal = subtype === "Flussweg" ? { is_bach: false } : {};
            expect(tunnel({ subtype, ...merkmal, is_tunnel: true }), art).toBe(true);
            expect(durchgezogen({ subtype, ...merkmal, is_tunnel: true }), art).toBe(false);
            expect(tunnel({ subtype, ...merkmal, is_tunnel: false }), art).toBe(false);
            expect(durchgezogen({ subtype, ...merkmal, is_tunnel: false }), art).toBe(true);
            expect(durchgezogen({ subtype, ...merkmal }), art).toBe(true);
            // Unten in der Gruppe: Ein Weg über der Erde kreuzt über dem Tunnel.
            expect(ids.indexOf(`path-center-${art}-tunnel`)).toBeLessThan(
                ids.findIndex((id) => id.startsWith("path-center-") && !id.endsWith("-tunnel")),
            );
        }
        // Die Trefferebene bleibt eine je Art (sonst fehlte sie der statischen Liste der Abfrage).
        expect(ids.filter((id) => id.startsWith("path-hit-") && id.endsWith("-tunnel"))).toEqual([]);
    });

    it("🔴 zeichnet die Karawanenroute als Punktreihe über dem Kern ihres Wegtyps, nur an Landwegen (WI-0177 §30)", () => {
        const layers = buildPathLayers({});
        const ids = layers.map((layer) => layer.id);
        const k = AVENTURIA_PATH_CARTOGRAPHY.karawanenroute;
        const land = pathTypesInDrawOrder().filter(
            ({ subtype, style }) => style.hidden !== true && subtype !== "Flussweg",
        );
        for (const { subtype } of land) {
            const art = subtype.toLowerCase();
            const punkte = findLayer(layers, `path-karawanenroute-${art}`, "line");
            expect(punkte?.paint?.["line-color"], art).toBe(k.dot);
            expect(punkte?.paint?.["line-dasharray"], art).toEqual([0, k.spacing / k.dotWidth]);
            expect(punkte?.layout?.["line-cap"], "runde Kappe macht aus Strich 0 einen Punkt").toBe("round");
            const filter = createFilter(punkte?.filter);
            expect(filter({ subtype, mark: "karawanenroute" }), art).toBe(true);
            expect(filter({ subtype }), art).toBe(false);
            expect(filter({ subtype, mark: null }), art).toBe(false);
            // Über allen Kernen, unter den Trefferebenen; Kontur und Kern des Wegtyps bleiben darunter.
            expect(ids.indexOf(`path-karawanenroute-${art}`)).toBeGreaterThan(ids.lastIndexOf(`path-center-${art}`));
            expect(ids.indexOf(`path-karawanenroute-${art}`)).toBeLessThan(
                ids.findIndex((id) => id.startsWith("path-hit-")),
            );
        }
        expect(ids.filter((id) => id.startsWith("path-karawanenroute-flussweg"))).toEqual([]);
        // Der Name der Karawanenroute steht in ihrer eigenen Farbe.
        const name = asLayer(buildPathLabelLayer("Faculty Glyphic Regular", {}), "symbol");
        const farbe = name.paint?.["text-color"] as unknown[];
        expect(farbe[0]).toBe("case");
        expect(farbe[1]).toEqual(["==", ["get", "mark"], "karawanenroute"]);
        expect(farbe[2]).toBe(k.labelColor);
    });

    it("🔴 nimmt Farbe und Breite NUR aus der Tafel", () => {
        // Kein Farbliteral im Layercode - das war der Punkt von WI-0008.
        // Seewege zeigt die Karte nicht (`hidden`), sie haben keine Ebene.
        for (const { subtype, style } of pathTypesInDrawOrder().filter(({ style }) => style.hidden !== true)) {
            const kontur = findLayer(buildPathLayers({}), `path-outline-${subtype.toLowerCase()}`, "line");
            const kern = findLayer(buildPathLayers({}), `path-center-${subtype.toLowerCase()}`, "line");
            expect(kontur?.paint?.["line-color"]).toBe(style.outline);
            expect(kern?.paint?.["line-color"]).toBe(style.center);
        }
    });

    it("🪤 gibt einem Bach die halbe Breite, ohne ihn zur eigenen ART zu machen", () => {
        // 💣 Hier stand die Forderung „es gibt KEINEN Bach-Layer". Sie war richtig gemeint und
        // falsch formuliert: gemeint ist, dass ein Bach keine neunte WEGART ist — keine eigene
        // Farbe, keine eigene Zeile in `types`, keine eigene Stelle in der Zeichenreihenfolge.
        // Eine eigene EBENE braucht er trotzdem, seit die Breite vom Zoom abhängt: MapLibre
        // erlaubt `["zoom"]` nur im äußersten Ausdruck, ein `["case", is_bach, <interpolate>]`
        // wird still abgelehnt. Ein Test, der die Formulierung statt der Absicht festschreibt,
        // verbietet später die richtige Lösung.
        const layers = buildPathLayers({});
        const bach = findLayer(layers, "path-center-flussweg-bach", "line");
        const fluss = findLayer(layers, "path-center-flussweg", "line");

        expect(bach, "der Bach braucht eine eigene Ebene für seine eigene Zoomkurve").toBeDefined();
        expect(JSON.stringify(bach?.filter)).toContain("is_bach");

        // 🔴 EINE Wasserfarbe für Fluss und Bach (Legacy, Owner 09.09.2026).
        expect(bach?.paint?.["line-color"]).toBe(pathStyleFor("Flussweg").center);
        expect(fluss?.paint?.["line-color"]).toBe(pathStyleFor("Flussweg").center);

        // Und er bleibt aus der Artentafel heraus.
        expect(Object.keys(AVENTURIA_PATH_CARTOGRAPHY.types)).not.toContain("bach");
    });

    it("🔴 verschmälert die Wege beim Rauszoomen, aus Legacys Tafel", () => {
        // Betreiberbefund: „zoomt man raus ist zuviel sichtbar, zoomt man rein sind sie zu dünn."
        // Legacys Antwort ist PATH_WIDTH_SCALE[art][zoom] — hier Ziffer für Ziffer.
        const kern = findLayer(buildPathLayers({}), "path-center-strasse", "line");
        const breite = kern?.paint?.["line-width"] as unknown[];
        const basis = pathStyleFor("Strasse").centerWidth;
        const faktoren = AVENTURIA_PATH_CARTOGRAPHY.widthScale["Strasse"] as number[];

        expect(breite[0], "eine Kurve über den Zoom, kein fester Wert").toBe("interpolate");
        // [op, art, eingang, stop, wert, …] — die Stops stehen in UNSERER Zählung, die Werte sind
        // Legacys Faktoren mal der Grundbreite.
        for (const [legacyZoom, faktor] of faktoren.entries()) {
            const index = 3 + legacyZoom * 2;
            expect(breite[index], `Stufe zu Legacy z${String(legacyZoom)}`).toBe(renderZoomForBand(legacyZoom));
            expect(breite[index + 1], `Breite bei Legacy z${String(legacyZoom)}`).toBeCloseTo(basis * faktor, 10);
        }
    });

    it("💣 nimmt eine Art, deren Faktor 0 ist, von der Karte statt sie mit Breite 0 zu zeichnen", () => {
        // In Legacy holt `pathShouldBeOnMap` sie heraus; bei uns ist es `minzoom`. Der Unterschied
        // ist nicht kosmetisch: eine Linie der Breite 0 bleibt in jeder Kachel und wird gerechnet.
        const layers = buildPathLayers({});
        const ersteSichtbare = (key: string): number => {
            const faktoren = AVENTURIA_PATH_CARTOGRAPHY.widthScale[key] as number[];
            return renderZoomForBand(faktoren.findIndex((faktor) => faktor > 0));
        };

        for (const key of ["Reichsstrasse", "Strasse", "Weg", "Pfad", "Gebirgspass", "Wuestenpfad"]) {
            const layer = layers.find((l) => l.id === `path-center-${key.toLowerCase()}`);
            expect(layer?.minzoom, key).toBe(ersteSichtbare(key));
        }
        expect(layers.find((l) => l.id === "path-center-flussweg-bach")?.minzoom).toBe(ersteSichtbare("bach"));
    });

    it("🔴 zeichnet einen Bach erst ab Band 4, eine Stufe später als Legacy (OPS-000036)", () => {
        // Kanal OPS-000036: auf Band 3 überladen die Bäche die Karte, und vor den Dorfnamen (Band 4) sollen sie nicht
        // erscheinen. Betreiber 2026-10-17: „du kannst den vorschlag umsetzen". Die Zahl steht in der Wegetafel; dieser
        // Fall hält die Entscheidung fest, damit niemand die Zeile „zurück auf Legacy" setzt, ohne es zu merken.
        const layers = buildPathLayers({});
        for (const art of ["outline", "center", "hit"]) {
            const bach = layers.find((l) => l.id === `path-${art}-flussweg-bach`);
            expect(bach?.minzoom, `path-${art}-flussweg-bach`).toBe(renderZoomForBand(4));
        }
        // Der Fluss selbst bleibt auf jeder Stufe.
        expect(layers.find((l) => l.id === "path-center-flussweg")?.minzoom).toBeUndefined();
    });

    it("🪤 lässt Gewässer NIE verschwinden", () => {
        // Legacys `getPathWidthScale` gibt für einen unbekannten Schlüssel 1 zurück — Flussweg und
        // Seeweg stehen mit Absicht nicht in der Tafel. Wer sie „der Vollständigkeit halber"
        // nachträgt, lässt die Flüsse beim Rauszoomen verschwinden.
        expect(Object.keys(AVENTURIA_PATH_CARTOGRAPHY.widthScale)).not.toContain("Flussweg");
        expect(Object.keys(AVENTURIA_PATH_CARTOGRAPHY.widthScale)).not.toContain("Seeweg");

        for (const id of ["path-center-flussweg"]) {
            const layer = buildPathLayers({}).find((l) => l.id === id);
            expect(layer?.minzoom, `${id} darf keine unterste Stufe haben`).toBeUndefined();
            for (let band = 0; band <= 6; band += 1) {
                expect(breiteAuf(id, renderZoomForBand(band)), `${id} auf Band ${String(band)}`).toBeGreaterThan(0);
            }
        }
    });

    /**
     * Betreiberentscheidung 2026-09-23: „Im Überblick dünne Linien ohne weiße Kontur, die Kontur
     * erst bei hohen Zoomstufen." Legacy stuft genauso (unter z3 Kontur-Deckkraft 0) und zeigt
     * Besuchern die Flusslinien gar nicht, nur die ins Kartenbild gemalten Flüsse.
     */
    it("⭐ zeichnet Wasser im Überblick dünn und ohne Kontur, im nahen Bild mit Kontur", () => {
        const { outlineFromBand, thinCenterWidth } = AVENTURIA_PATH_CARTOGRAPHY.water;
        for (const art of ["flussweg"]) {
            const fern = renderZoomForBand(outlineFromBand - 1);
            const nah = renderZoomForBand(outlineFromBand);
            expect(breiteAuf(`path-outline-${art}`, fern), `${art}: keine Kontur im Überblick`).toBe(0);
            expect(breiteAuf(`path-center-${art}`, fern)).toBeLessThanOrEqual(thinCenterWidth);
            expect(breiteAuf(`path-outline-${art}`, nah), `${art}: Kontur im nahen Bild`).toBeGreaterThan(
                breiteAuf(`path-center-${art}`, nah),
            );
            // 🪤 Eingeblendet, nicht zugeschaltet: auf halbem Weg steht die Kontur halb.
            const halb = breiteAuf(`path-outline-${art}`, (fern + nah) / 2);
            expect(halb).toBeGreaterThan(0);
            expect(halb).toBeLessThan(breiteAuf(`path-outline-${art}`, nah));
        }
    });

    it("🔴 beschriftet aus dem abgeleiteten SCHRIFTLAUF, nicht aus der Weggeometrie", () => {
        // ⭐ Dieselbe Bauform wie die Landschaftsnamen (WI-0004): der Lauf ist je Zoom
        // zugeschnitten und liegt auf der ruhigsten Strecke. Ohne ihn stand von 149 Wegnamen im
        // Bild einer auf der Karte.
        const layer = asLayer(buildPathLabelLayer("Test", {}), "symbol");
        expect(layer.source).toBe("path-labels");
        expect(layer["source-layer"]).toBe("path_label_run");

        // 🪤 `line-center`, nicht `line`: der Lauf IST schon die Stelle. `line` suchte noch einmal
        // und verwuerfe die Arbeit der Ableitung.
        expect(layer.layout?.["symbol-placement"]).toBe("line-center");

        // Die Auswahl "nur eingeschaltete Wege" steht in der ABLEITUNG (`WHERE label_visible`),
        // nicht als Filter am Layer - eine zweite Bedingung ueber derselben Frage laeuft
        // irgendwann auseinander. Am Layer steht nur, was die Karte gar nicht zeigt: die Seewege.
        expect(layer.filter).toEqual(["!", ["in", ["get", "subtype"], ["literal", ["Seeweg"]]]]);
    });

    it("💣 legt die Wegnamen UNTER die Ortsnamen", () => {
        // MapLibre platziert von oben nach unten - wer unten liegt, kommt zuletzt dran und weicht
        // allen. Ein Wegname kann nur entlang seiner Linie ausweichen, ein Ortsname hat zwoelf
        // Plaetze; umgekehrt kostete es Legacy 503 Ortsnamen ganz.
        const layers = buildPlaceLayers({ labels: true, composition: composeView("standard", "alle") });
        const ids = layers.map((layer) => layer.id);
        expect(ids.indexOf("path-label")).toBeGreaterThanOrEqual(0);
        expect(ids.indexOf("path-label"), "Wegnamen vor den Ortsnamen im Array = unten im Stapel").toBeLessThan(
            ortsnamenImStapel(ids).erste,
        );
    });

    it("🪤 zeigt Wege in der Standardansicht und NICHT in der Landschaftsansicht", () => {
        const standard = buildPlaceLayers({ labels: true, composition: composeView("standard", "alle") });
        const landschaft = buildPlaceLayers({ labels: true, composition: composeView("landscapes", "alle") });
        expect(standard.some((layer) => layer.id.startsWith("path-"))).toBe(true);
        expect(landschaft.some((layer) => layer.id.startsWith("path-"))).toBe(false);
    });
});

describe("Strömungspfeile auf den Flüssen (V11)", () => {
    const standard = { labels: true, composition: composeView("standard", "alle") } as const;
    /** Der Schalter „Strömungsrichtungen“ an (Betreiber 2026-09-28), Flüsse an. */
    const mitStroemung = {
        ...standard,
        display: effectiveDisplay("standard", standard.composition, {
            ...displayDefaults("standard"),
            rivers: true,
            flow: true,
        }),
    };

    it("🔴 sieht ein BESUCHER nicht", () => {
        // 💣 Die wichtigste Zusicherung dieses Abschnitts. In Legacy steigt
        // `map-features-river-flow-arrows.js` in `start()` aus, sobald `!IS_EDIT_MODE` — die
        // Dreiecke sind ein Werkzeug, kein Kartenbild. An derselben Regel hängt dort die weiße
        // Flusskontur im Landschaftsmodus: „Wer die Pfeile je für Besucher freigibt, nimmt die
        // Kontur mit." Betreiberentscheidung 2026-09-22: nur für Editoren.
        const ohneEditor = buildPlaceLayers({ ...standard }).map((layer) => layer.id);
        expect(ohneEditor).not.toContain("path-flow-arrow");

        const alsBesucher = buildPlaceLayers({ ...mitStroemung, flowDirectionsVisible: false }).map(
            (layer) => layer.id,
        );
        expect(alsBesucher).not.toContain("path-flow-arrow");
        expect(alsBesucher, "keine weiße Flusskontur").not.toContain("path-outline-flussweg");
    });

    it("🔴 sieht, wer `view_flow_directions` hat, wenn „Strömungsrichtungen“ an ist: Pfeile UND weiße Flusskontur", () => {
        const ids = buildPlaceLayers({ ...mitStroemung, flowDirectionsVisible: true }).map((layer) => layer.id);
        expect(ids).toContain("path-flow-arrow");
        expect(ids).toContain("path-outline-flussweg");
        expect(ids).toContain("path-outline-flussweg-bach");
    });

    it("🔴 ohne den Schalter weder Pfeile noch Kontur, der Fluss bleibt sein blauer Kern", () => {
        // Betreiber 2026-09-28: „wenn die option strömungsrichtungen aus ist soll keine kontur und keine pfeile
        // mehr zu sehen sein“.
        const aus = {
            ...standard,
            flowDirectionsVisible: true,
            display: effectiveDisplay("standard", standard.composition, {
                ...displayDefaults("standard"),
                rivers: true,
            }),
        };
        const ids = buildPlaceLayers(aus).map((layer) => layer.id);
        expect(ids).not.toContain("path-flow-arrow");
        expect(ids.filter((id) => id.startsWith("path-outline-flussweg"))).toEqual([]);
        expect(ids).toContain("path-center-flussweg");
        // Die übrigen Wege behalten ihre Kontur.
        expect(ids).toContain("path-outline-reichsstrasse");
    });

    it("🪤 zeichnet KEINEN Pfeil, wo die Richtung unbekannt ist", () => {
        // Absicht, kein Versehen: so sieht ein Editor sofort, wo die Richtung fehlt. 1245 von 6983
        // Wegen tragen überhaupt eine. Ein Vorgabewert wäre eine erfundene Aussage über einen
        // echten Fluss.
        const filter = JSON.stringify(asLayer(buildFlowArrowLayer(), "symbol").filter);
        expect(filter).toContain("flow_direction");
        expect(filter).toContain("forward");
        expect(filter).toContain("reverse");
    });

    it("🔴 OPS-000098: kein Pfeil auf einem Landweg, der aus einem Fluss wurde und seine Richtung behielt", () => {
        const filter = JSON.stringify(asLayer(buildFlowArrowLayer(), "symbol").filter);
        expect(filter).toContain('["==",["get","subtype"],"Flussweg"]');
    });

    it("💣 dreht den Pfeil um, statt die Geometrie anzufassen", () => {
        // `reverse` heißt „entgegen der Punktreihenfolge". Die gespeicherte Linie bleibt, wie sie
        // ist — gedreht wird das Symbol.
        const layout = buildFlowArrowLayer().layout as Record<string, unknown>;
        expect(JSON.stringify(layout["icon-rotate"])).toContain("180");
        expect(layout["icon-rotation-alignment"], "die Richtung gilt im Gelände, nicht am Monitor").toBe("map");
        expect(layout["symbol-spacing"], "Legacys ARROW_SPACING_PX").toBe(
            AVENTURIA_PATH_CARTOGRAPHY.flowArrow.spacingPx,
        );
    });

    it("💣 liegt UNTER jeder Beschriftung und ÜBER den Linien", () => {
        // In Legacy stand die Ebene bis zum 02.09.2026 zu hoch, und ein Dreieck fiel mitten in den
        // Flussnamen — auf denselben Fluss, auf dem es sitzt.
        const ids = buildPlaceLayers({ ...mitStroemung, flowDirectionsVisible: true }).map((layer) => layer.id);
        const pfeil = ids.indexOf("path-flow-arrow");
        expect(pfeil).toBeGreaterThan(ids.indexOf("path-center-flussweg"));
        expect(pfeil).toBeLessThan(ids.indexOf("path-label"));
        expect(pfeil).toBeLessThan(ortsnamenImStapel(ids).erste);
    });

    it("🪤 nimmt die Füllung aus der Wassertafel, nicht aus einer zweiten Farbe", () => {
        // Die Farbe des Dreiecks steht NICHT in `flowArrow` — sie ist die Flussfarbe. Wer das
        // Wasser umfärbt, färbt die Pfeile mit.
        expect(Object.keys(AVENTURIA_PATH_CARTOGRAPHY.flowArrow)).not.toContain("fillColor");
        expect(AVENTURIA_PATH_CARTOGRAPHY.types["Flussweg"]?.center).toBeDefined();
    });
});

/** Die gezeichnete Linienbreite einer Wegebene auf einer Zoomstufe, mit MapLibres eigenem Auswerter. */
function breiteAuf(id: string, zoom: number): number {
    const layer = buildPathLayers({}).find((l) => l.id === id);
    if (!layer || layer.type !== "line") {
        throw new Error(`${id} fehlt`);
    }
    const compiled = createPropertyExpression(
        layer.paint?.["line-width"],
        "line-width",
        propertySpec("paint_line", "line-width"),
    );
    if (compiled.result !== "success") {
        throw new Error(`${id}: line-width ungültig`);
    }
    return compiled.value.evaluate({ zoom }, { type: "LineString", properties: {} } as never) as number;
}

describe("Seewege zeigt die Karte nicht (Betreiber 2026-09-27)", () => {
    /**
     * „wir tun so, als ob es seewege nicht mehr gibt. sie sollen nicht mehr auf der karte sein“ - auch
     * nicht für Editoren. Die Regel steht als Merkmal an der Wegart (`hidden`), nicht als
     * `subtype === "Seeweg"` im Code.
     */
    const seewegIds = ["path-outline-seeweg", "path-center-seeweg"];

    it("🔴 keine Seeweglinie im Stil", () => {
        const ids = buildPathLayers({}).map((layer) => layer.id);
        for (const id of seewegIds) {
            expect(ids, id).not.toContain(id);
        }
        // Die übrigen Wasserlinien bleiben.
        expect(ids).toContain("path-center-flussweg");
    });

    it("🪤 wer die Linie nicht sieht, sieht auch den Namen nicht", () => {
        const filter = createFilter(asLayer(buildPathLabelLayer("Test", {}), "symbol").filter);
        expect(filter({ subtype: "Seeweg" })).toBe(false);
        expect(filter({ subtype: "Flussweg" })).toBe(true);
        expect(filter({ subtype: "Reichsstrasse" })).toBe(true);
    });

    it("die Regel hängt am Merkmal der Tafel, nicht am Namen der Art", () => {
        const verborgen = Object.entries(AVENTURIA_PATH_CARTOGRAPHY.types)
            .filter(([, style]) => style.hidden === true)
            .map(([art]) => art);
        expect(verborgen).toEqual(["Seeweg"]);
    });
});

/** Ein Layerfilter als Funktion über Feature-Eigenschaften, mit MapLibres eigenem Auswerter. */
function createFilter(filter: unknown): (properties: Record<string, unknown>) => boolean {
    const compiled = featureFilter(filter as never, "filter");
    return (properties) => compiled.filter({ zoom: 6 }, { type: 2, properties } as never, undefined as never);
}

describe("Größe der Strömungspfeile", () => {
    /**
     * Legacy: das Dreieck ist so breit wie seine Linie (`massstab` = Breitenfaktor) — Fluss 1,
     * Bach 0,5. Betreiberbefund 2026-09-23: auf den Flüssen waren sie „superklein", weil hier für
     * alle die Bachgröße stand.
     */
    const groesse = (() => {
        const layer = buildFlowArrowLayer();
        const compiled = createPropertyExpression(
            layer.layout?.["icon-size" as never],
            "icon-size",
            propertySpec("layout_symbol", "icon-size"),
        );
        if (compiled.result !== "success") {
            throw new Error("icon-size ungültig");
        }
        return (zoom: number, isBach: boolean): number =>
            compiled.value.evaluate({ zoom }, {
                type: "LineString",
                properties: { is_bach: isBach },
            } as never) as number;
    })();

    it("🔴 ein Fluss trägt das volle Dreieck, ein Bach das halbe", () => {
        for (const band of [3, 4, 5, 6]) {
            const zoom = renderZoomForBand(band);
            expect(groesse(zoom, false), `Fluss auf Band ${String(band)}`).toBe(1);
            expect(groesse(zoom, true), `Bach auf Band ${String(band)}`).toBe(
                AVENTURIA_PATH_CARTOGRAPHY.widthScale["bach"]?.[band],
            );
        }
    });

    it("🪤 der Bach nimmt seine Größe aus DERSELBEN Tafel wie seine Linie", () => {
        expect(groesse(renderZoomForBand(5), true)).toBeLessThan(groesse(renderZoomForBand(5), false));
    });
});
