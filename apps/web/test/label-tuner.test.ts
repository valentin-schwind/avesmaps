import { describe, expect, it } from "vitest";
import { createPropertyExpression } from "@maplibre/maplibre-gl-style-spec";
import { AVENTURIA_ZOOM_BANDS, composeView, labelSizeExpression } from "@avesmaps3d/shared";
import { scaleSizeExpression } from "../src/map/label-tuner.ts";
import { buildPlaceLayers, placeLabelLayerId } from "../src/map/place-layers.ts";
import { findLayer, propertySpec } from "./style-spec.ts";

/**
 * Der Schriftgrößen-Regler skaliert eine Zoomkurve (Betreiberauftrag 2026-09-22).
 *
 * 💣 `["*", <ausdruck>, faktor]` wäre das Naheliegende und ist FALSCH: MapLibre erlaubt `["zoom"]`
 * nur im ÄUSSERSTEN Ausdruck. Deshalb wandert der Faktor in die Stops — und dabei ist die
 * gefährliche Verwechslung, die Zoomstufen mitzuskalieren statt nur die Größen.
 */

describe("Größenausdruck skalieren", () => {
    it("🔴 skaliert die AUSGÄNGE einer Interpolation, nicht die Zoomstufen", () => {
        const skaliert = scaleSizeExpression(["interpolate", ["linear"], ["zoom"], 3, 10, 6, 20], 2);
        // Die Stops 3 und 6 bleiben; 10 und 20 verdoppeln sich.
        expect(skaliert).toEqual(["interpolate", ["linear"], ["zoom"], 3, 20, 6, 40]);
    });

    it("🔴 skaliert die WERTE einer Klassentafel — nicht die Klassennamen", () => {
        // 💣 Genau hier lag der Fehler: `match` ist [op, eingang, label, wert, …], die Werte stehen
        // bei 3, 5, 7. Abgeschrieben aus der `interpolate`-Zeile (Stops: Eingang, AUSGANG) traf die
        // Formel die Labels statt der Werte — der Regler ließ die Ortsgrößen unberührt und bewegte
        // sichtbar nichts.
        expect(scaleSizeExpression(["match", ["get", "subtype"], "stadt", 10, "dorf", 6, 4], 2)).toEqual([
            "match",
            ["get", "subtype"],
            "stadt",
            20,
            "dorf",
            12,
            8,
        ]);
    });

    it("🔴 skaliert die Werte einer step-Tafel, nicht ihre Stufen", () => {
        expect(scaleSizeExpression(["step", ["zoom"], 10, 4, 20, 7, 30], 3)).toEqual([
            "step",
            ["zoom"],
            30,
            4,
            60,
            7,
            90,
        ]);
    });

    it("💣 ändert bei einer echten Bandkurve wirklich etwas", () => {
        // 🪤 Die Umkehrprobe zum Test darunter. Der prüft nur, was GLEICH bleiben soll — und war
        // deshalb auch dann grün, als der Regler gar nichts tat. Ein Test, der nur Unverändertes
        // prüft, bestätigt jeden kaputten Filter.
        const original = labelSizeExpression(AVENTURIA_ZOOM_BANDS.label, "subtype", "label_size_override");
        expect(JSON.stringify(scaleSizeExpression(original, 2))).not.toBe(JSON.stringify(original));
    });

    it("💣 verschiebt bei einer echten Bandkurve keine einzige Zoomstufe", () => {
        // Die Umkehrprobe am echten Ausdruck: wer hier blind jede Zahl multipliziert, lässt die
        // Namen zu früh erscheinen - und das fiele erst auf der Karte auf.
        const original = labelSizeExpression(AVENTURIA_ZOOM_BANDS.label, "subtype", "label_size_override");
        const skaliert = scaleSizeExpression(original, 1.5) as unknown[];

        // Die Eingangsstops stehen bei einer Interpolation an den geraden Positionen ab 3.
        for (let index = 3; index < (original as unknown[]).length; index += 2) {
            expect(skaliert[index], `Zoomstufe an Position ${String(index)}`).toEqual((original as unknown[])[index]);
        }
    });

    it("🔴 bleibt ein gültiger MapLibre-Ausdruck", () => {
        // Die eigentliche Zusicherung: MapLibre nimmt das Ergebnis an. Ein Ausdruck, der die
        // Zoomregel verletzt, wird still abgelehnt und die Groesse bleibt stehen.
        const label = findLayer(
            buildPlaceLayers({ labels: true, composition: composeView("standard", "alle") }),
            placeLabelLayerId("dorf", "right"),
            "symbol",
        );

        const skaliert = scaleSizeExpression(label?.layout?.["text-size"], 1.4);
        const compiled = createPropertyExpression(skaliert, "text-size", propertySpec("layout_symbol", "text-size"));
        expect(compiled.result, JSON.stringify(compiled.value).slice(0, 200)).toBe("success");
    });

    it("🪤 lässt nur einen Ausdruck MIT Zoom in Ruhe, dessen Aufbau er nicht kennt", () => {
        // 💣 Hier stand die Umkehrung: JEDER unbekannte Aufbau blieb stehen, „lieber nichts tun als
        // verbiegen". Dieser Test hat die Regel festgeschrieben, die den Regler an den
        // Landschaftsnamen wirkungslos machte — er war grün, und der Betreiber sah nichts.
        // Multiplizieren ist nur dort verboten, wo Zoom im Ausdruck steckt.
        const mitZoom = ["unbekannt", ["zoom"], 12];
        expect(scaleSizeExpression(mitZoom, 2)).toEqual(mitZoom);
    });

    it("🔴 skaliert eine einfache Zahl", () => {
        expect(scaleSizeExpression(12, 1.5)).toBe(18);
    });
});

describe("Größen, die aus den Daten kommen", () => {
    it("💣 skaliert einen datengetriebenen Ausdruck WIRKLICH", () => {
        // Der Befund des Betreibers: „landschaften werden vom slider nicht affektiert". Ihre Größe
        // steht nicht in einer Zoomkurve, sondern in der Kachel — `["to-number", ["get",
        // "label_size"]]`. Die alte Fassung gab jeden Ausdruck, den sie nicht kannte, unverändert
        // zurück („lieber nichts tun als verbiegen") und tat deshalb genau nichts.
        const original = ["to-number", ["get", "label_size"]];
        const skaliert = scaleSizeExpression(original, 1.5);
        expect(JSON.stringify(skaliert)).not.toBe(JSON.stringify(original));

        // Und zwar als Multiplikation — ohne Zoom im Ausdruck ist sie erlaubt und trägt jede Form.
        // Sie landet innen, weil `to-number` ein bekannter Aufbau ist; das Ergebnis ist dasselbe.
        expect(skaliert).toEqual(["to-number", ["*", ["get", "label_size"], 1.5]]);

        // 🔴 Die eigentliche Zusicherung: MapLibre nimmt ihn an. Ein Ausdruck, der die Zoomregel
        // verletzt, wird still abgelehnt — und genau das sieht man auf der Karte nicht.
        const compiled = createPropertyExpression(skaliert, "text-size", propertySpec("layout_symbol", "text-size"));
        expect(compiled.result, JSON.stringify(compiled.value).slice(0, 200)).toBe("success");
    });
});
