import { AVENTURIA_PATH_CARTOGRAPHY } from "@avesmaps3d/shared";
import type { Map as MapLibreMap } from "maplibre-gl";
import { LANDSCAPE_NAME_LAYER_IDS } from "./landscape-layers";
import { PLACE_LABEL_LAYER_IDS } from "./place-layers";

/**
 * Ein Regler für die Schriftgrößen, direkt auf der laufenden Karte (Betreiberauftrag 2026-09-22).
 *
 * ⭐ Statt drei Screenshots zum Auswählen: der Betreiber dreht selbst, sieht sofort, und am Ende
 * steht der Wert zum Übernehmen da. Legacy kennt dasselbe Muster (`?pathwidthtune=1`,
 * `?roadtune=1`) — es ist im Projekt etabliert, also kommt hier kein neues dazu.
 *
 * 🪤 Es gibt bewusst KEINEN Regler je Zoomstufe. Legacy braucht ihn, weil es seine Größen je Stufe
 * als Tabelle führt; bei uns gehen die Bänder flüssig ineinander über, und ein Faktor auf die
 * ganze Tafel ändert alle Stufen gleichmäßig (Betreiberhinweis: „das brauchen wir hier nicht so
 * sehr, weil alles flüssig ineinander übergeht").
 *
 * 💣 DIES IST EIN WERKZEUG, KEIN PRODUKTMERKMAL. Es hängt an `?labeltune=1` und ist sonst
 * vollständig aus dem Weg — kein Knopf, kein Rand, keine Zeile im Stil. Was der Betreiber einstellt,
 * wandert danach in die Konfiguration; der Regler ist der Weg dorthin, nicht der Aufbewahrungsort.
 */

/** Die Layer, deren Schrift der Regler anfasst, gruppiert nach dem, was der Betreiber sieht. */
const GRUPPEN = {
    orte: PLACE_LABEL_LAYER_IDS,
    wege: ["path-label"],
    landschaften: LANDSCAPE_NAME_LAYER_IDS,
} as const;

type Gruppe = keyof typeof GRUPPEN;

/** Wie weit die Regler gehen. Ein Faktor, keine Pixelzahl — die Bänder bleiben untereinander stimmig. */
const BEREICH = { min: 0.6, max: 2.5, schritt: 0.05 };

/**
 * Ab welchem Faktor eine Gruppe mehr verlangt, als die abgeleiteten Daten hergeben.
 *
 * 💣 Wegnamen stehen auf zugeschnittenen SCHRIFTLÄUFEN. Wird der Name breiter als sein Lauf,
 * biegt MapLibre ihn nicht — es lässt ihn weg, ersatzlos und ohne Meldung. Der Betreiber hat das
 * gesehen: ab 1.05 waren die Wegnamen fort, und der Regler zeigte weiter eine Zahl, als wäre
 * nichts. Ein Werkzeug, das über seine eigene Grenze schweigt, lügt.
 *
 * 🪤 Die Grenze ist KEIN Anschlag am Regler. Darüber zu schieben ist erlaubt — nur muss danach
 * `derive:path-runs` laufen, und genau das sagt der Hinweis. Sonst hieße „geht nicht", was in
 * Wahrheit „geht, aber nicht ohne Ableitung" ist.
 */
const OHNE_NEUABLEITUNG: Partial<Record<Gruppe, number>> = {
    wege: AVENTURIA_PATH_CARTOGRAPHY.label.runHeadroom,
};

interface TunerState {
    orte: number;
    wege: number;
    landschaften: number;
}

/** Steht `["zoom"]` irgendwo in diesem Ausdruck? Davon hängt ab, wie skaliert werden darf. */
function enthaeltZoom(expression: unknown): boolean {
    if (!Array.isArray(expression)) {
        return false;
    }
    return expression[0] === "zoom" || expression.some((teil) => enthaeltZoom(teil));
}

/**
 * Skaliert einen Größenausdruck, ohne seine Zoomkurve zu zerstören.
 *
 * 💣 Die Regel, um die sich alles dreht, ist ENGER als sie hier zuerst stand. MapLibre verbietet
 * nicht die Multiplikation — es verbietet `["zoom"]` irgendwo anders als im Eingang des
 * ÄUSSERSTEN Ausdrucks. `["*", <interpolate über zoom>, faktor]` wird abgelehnt, still.
 * `["*", ["to-number", ["get", "label_size"]], faktor]` ist völlig in Ordnung.
 *
 * 🪤 Aus dem zu strengen Verbot folgte der zweite Fehler dieses Reglers: alles, dessen Aufbau die
 * Funktion nicht kannte, gab sie unverändert zurück — „lieber nichts tun als verbiegen". Genau das
 * traf die Landschaftsnamen, deren Größe aus den Daten kommt (`["to-number", ["get",
 * "label_size"]]`). Der Regler bewegte sich, die Karte nicht. Ein Werkzeug, das stumm nichts tut,
 * ist schlimmer als eines, das fehlt.
 *
 * ⭐ Deshalb jetzt zwei Wege: OHNE Zoom im Ausdruck wird einfach multipliziert — das trägt jede
 * Form, auch die, die hier niemand vorhergesehen hat. MIT Zoom wandert der Faktor IN die Stops,
 * und zwar nur in die AUSGÄNGE: wer dort blind jede Zahl multipliziert, verschiebt die Zoomstufen
 * mit und die Namen erscheinen zu früh.
 */
export function scaleSizeExpression(expression: unknown, faktor: number): unknown {
    if (typeof expression === "number") {
        return expression * faktor;
    }
    if (!Array.isArray(expression) || expression.length === 0) {
        return expression;
    }
    const operator = expression[0] as string;

    if (operator === "interpolate" || operator === "interpolate-hcl" || operator === "interpolate-lab") {
        // [op, art, eingang, stop, wert, stop, wert, …] — ab Index 3 abwechselnd.
        return expression.map((teil, index) =>
            index >= 3 && (index - 3) % 2 === 1 ? scaleSizeExpression(teil, faktor) : teil,
        );
    }
    if (operator === "step") {
        // [op, eingang, vorgabe, stop, wert, stop, wert, …] — die Vorgabe und die WERTE (4, 6, 8 …).
        return expression.map((teil, index) =>
            index === 2 || (index >= 4 && (index - 4) % 2 === 0) ? scaleSizeExpression(teil, faktor) : teil,
        );
    }
    if (operator === "match") {
        // [op, eingang, label, wert, label, wert, …, vorgabe] — die WERTE stehen bei 3, 5, 7 …
        //
        // 🪤 Hier stand zuerst `(index - 3) % 2 === 1`, aus der `interpolate`-Zeile darüber
        // abgeschrieben. Dort stimmt sie (Stops: Eingang, Ausgang), hier nicht (Label, Wert) — der
        // Regler ließ damit genau die Tafel unberührt, in der die Ortsgrößen stehen, und bewegte
        // sichtbar nichts. Zwei Listen, die gleich aussehen und verschieden gebaut sind.
        const letzter = expression.length - 1;
        return expression.map((teil, index) =>
            (index >= 3 && index !== letzter && (index - 3) % 2 === 0) || index === letzter
                ? scaleSizeExpression(teil, faktor)
                : teil,
        );
    }
    if (operator === "case") {
        // [op, bedingung, wert, …, vorgabe] — jeder zweite ab 2, plus der letzte.
        const letzter = expression.length - 1;
        return expression.map((teil, index) =>
            (index >= 2 && (index - 2) % 2 === 0 && index !== letzter) || index === letzter
                ? scaleSizeExpression(teil, faktor)
                : teil,
        );
    }
    if (operator === "coalesce" || operator === "to-number") {
        return expression.map((teil, index) => (index === 0 ? teil : scaleSizeExpression(teil, faktor)));
    }
    // ⭐ Ein Aufbau, den diese Funktion nicht kennt — zum Beispiel `["get", "label_size"]`, die
    // Größe der Landschaftsnamen, die aus der Kachel kommt. Ohne Zoom darin ist die Multiplikation
    // erlaubt und trägt JEDE Form, auch die, die hier niemand vorhergesehen hat.
    if (!enthaeltZoom(expression)) {
        return ["*", expression, faktor];
    }
    // 🔴 Nur MIT Zoom bleibt er stehen: multiplizieren darf man ihn nicht, und wohin der Faktor
    // gehörte, ist nicht zu raten. Das ist der einzige Fall, in dem Nichtstun richtig ist.
    return expression;
}

function skaliere(map: MapLibreMap, layerId: string, original: unknown, faktor: number): void {
    if (!map.getLayer(layerId)) {
        return;
    }
    map.setLayoutProperty(layerId, "text-size", scaleSizeExpression(original, faktor) as never);
}

export function installLabelTuner(map: MapLibreMap): void {
    if (!new URLSearchParams(window.location.search).has("labeltune")) {
        return;
    }
    // Ein zweiter Aufruf hängte eine zweite Tafel an, und die Regler zeigten verschiedene Werte
    // für dieselbe Karte.
    if (document.querySelector(".label-tuner")) {
        return;
    }

    // Die Ausgangsausdrücke einmal merken — jede Skalierung geht von ihnen aus, nicht vom letzten
    // Stand. Sonst multiplizierte sich der Faktor bei jedem Ziehen auf.
    const original = new Map<string, unknown>();
    for (const layers of Object.values(GRUPPEN)) {
        for (const id of layers) {
            if (map.getLayer(id)) {
                original.set(id, map.getLayoutProperty(id, "text-size"));
            }
        }
    }

    const state: TunerState = { orte: 1, wege: 1, landschaften: 1 };

    const anwenden = (gruppe: Gruppe): void => {
        for (const id of GRUPPEN[gruppe]) {
            const basis = original.get(id);
            if (basis !== undefined) {
                skaliere(map, id, basis, state[gruppe]);
            }
        }
    };

    const panel = document.createElement("div");
    panel.className = "label-tuner";

    // 🪤 `textContent`, nicht `innerHTML` — auch bei festem Text. Der Inhalt ist heute statisch,
    // aber die Zeile ist die Vorlage für die nächste, und die trägt vielleicht einen Namen aus
    // den Daten.
    const kopf = document.createElement("div");
    kopf.className = "label-tuner__kopf";
    kopf.textContent = "Schriftgrößen";
    const hinweis = document.createElement("div");
    hinweis.className = "label-tuner__hinweis";
    hinweis.textContent = "Faktor auf die vorhandene Zoomkurve. Zum Übernehmen den Wert nennen.";
    panel.append(kopf, hinweis);

    for (const gruppe of Object.keys(GRUPPEN) as Gruppe[]) {
        const zeile = document.createElement("label");
        zeile.className = "label-tuner__zeile";

        const name = document.createElement("span");
        name.textContent = gruppe === "orte" ? "Orte" : gruppe === "wege" ? "Wege" : "Derographie";

        const regler = document.createElement("input");
        regler.type = "range";
        regler.min = String(BEREICH.min);
        regler.max = String(BEREICH.max);
        regler.step = String(BEREICH.schritt);
        regler.value = "1";
        regler.setAttribute("data-testid", `labeltune-${gruppe}`);

        const wert = document.createElement("output");
        wert.textContent = "1.00";
        wert.setAttribute("data-testid", `labeltune-${gruppe}-wert`);

        const grenze = OHNE_NEUABLEITUNG[gruppe];
        const warnung = document.createElement("div");
        warnung.className = "label-tuner__warnung";
        warnung.setAttribute("data-testid", `labeltune-${gruppe}-warnung`);
        warnung.hidden = true;
        warnung.textContent =
            grenze === undefined
                ? ""
                : `Über ${grenze.toFixed(2)} reichen die Schriftläufe nicht — zum Übernehmen muss derive:path-runs neu laufen.`;

        regler.addEventListener("input", () => {
            state[gruppe] = Number(regler.value);
            wert.textContent = state[gruppe].toFixed(2);
            if (grenze !== undefined) {
                warnung.hidden = state[gruppe] <= grenze;
            }
            anwenden(gruppe);
        });

        zeile.append(name, regler, wert);
        panel.append(zeile);
        if (grenze !== undefined) {
            panel.append(warnung);
        }
    }

    const zuruecksetzen = document.createElement("button");
    zuruecksetzen.type = "button";
    zuruecksetzen.textContent = "Zurücksetzen";
    zuruecksetzen.className = "label-tuner__reset";
    zuruecksetzen.addEventListener("click", () => {
        for (const regler of panel.querySelectorAll("input")) {
            regler.value = "1";
            regler.dispatchEvent(new Event("input"));
        }
    });
    panel.append(zuruecksetzen);

    document.body.append(panel);
}
