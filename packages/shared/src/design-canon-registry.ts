import { Value } from "@sinclair/typebox/value";
import { DesignCanon, LABEL_FAMILIES, type LabelFamily, type LabelFamilyName } from "./design-canon.ts";
import canon from "../../../config/design-canon/avesmaps.json" with { type: "json" };

function parseCanon(candidate: unknown, fileName: string): DesignCanon {
    if (!Value.Check(DesignCanon, candidate)) {
        const [firstError] = [...Value.Errors(DesignCanon, candidate)];
        const detail = firstError ? `${firstError.path}: ${firstError.message}` : "unknown validation error";
        throw new Error(`invalid design canon in ${fileName} (${detail})`);
    }
    return candidate;
}

export const DESIGN_CANON: DesignCanon = parseCanon(canon, "avesmaps.json");

/**
 * Eine Beschriftungsfamilie.
 *
 * 🪤 Kein Auffangwert. Eine Familie, die der Kanon nicht kennt, ist ein Tippfehler im Code und kein
 * Zustand der Karte — ein stiller Rückfall auf „place" ergäbe weiße Namen an einer Stelle, an der
 * jemand etwas anderes gemeint hat, und niemand sähe es.
 */
export function labelFamily(name: LabelFamilyName): LabelFamily {
    const family = DESIGN_CANON.mapLabel.families[name];
    if (!family) {
        throw new Error(`design canon has no label family "${name}" (known: ${LABEL_FAMILIES.join(", ")})`);
    }
    return family;
}

/**
 * Eine Farbe des Kanons.
 *
 * 🪤 Kein Auffangwert und kein `?? "#..."`. Ein Rückfall wäre genau das Literal, das dieser Kanon
 * abschaffen soll — und er würde still greifen: die Karte bekäme eine Farbe, die in keiner Tafel
 * steht, und niemand sähe, woher sie kommt. Ein fehlender Name ist ein Tippfehler im Code.
 */
export function canonColour(name: string): string {
    const value = DESIGN_CANON.colour[name];
    if (value === undefined) {
        throw new Error(`design canon has no colour "${name}"`);
    }
    return value;
}

/**
 * Eine Symbolgröße des Kanons in Pixeln (`icon.sm` … `icon.banner`).
 *
 * 🪤 Dasselbe wie bei `canonColour`, aus demselben Grund: `icon` ist eine Tafel mit freien Namen, und
 * ein `?? 24` wäre genau das Literal, das der Kanon abschaffen soll. Ein fehlender Name ist ein
 * Tippfehler im Code, kein Zustand der Oberfläche.
 */
export function canonIcon(name: string): number {
    const value = DESIGN_CANON.icon[name];
    if (value === undefined) {
        throw new Error(`design canon has no icon size "${name}"`);
    }
    return value;
}

/**
 * Enthält dieser Ausdruck irgendwo `["zoom"]`?
 *
 * 💣 Davon hängt ab, ob er multipliziert werden darf. MapLibre erlaubt `["zoom"]` **nur** als Eingang
 * des ÄUSSERSTEN Ausdrucks; `["*", <interpolate über zoom>, faktor]` wird abgelehnt — still, ohne
 * Ausnahme, die Eigenschaft bleibt einfach auf ihrem Vorgabewert stehen.
 */
function containsZoom(expression: unknown): boolean {
    if (!Array.isArray(expression)) {
        return false;
    }
    return expression[0] === "zoom" || expression.some((part) => containsZoom(part));
}

/**
 * Den Saum einer Familie als MapLibre-Ausdruck, abgeleitet aus der Schriftgröße.
 *
 * 🔴 Der Saum MUSS mit der Schrift wachsen. Legacy rechnet ihn aus der Schriftgröße, und ein Name
 * wird zwischen z0 und z8 mehr als doppelt so groß — ein fester Pixelwert wäre unten ein Kasten und
 * oben ein Haarstrich.
 *
 * 💣 Wer hier einen Größenausdruck mit `["zoom"]` hereinreicht, bekommt eine Ausnahme statt einer
 * stummen Wirkungslosigkeit. Für solche Größen gibt es `bandInterpolateExpression({ scale })`, das
 * den Faktor IN die Stops faltet, statt ihn außen herum zu multiplizieren.
 */
export function haloExpression(family: LabelFamilyName, sizeExpression: unknown, kind: "width" | "blur"): unknown {
    const ratio = kind === "width" ? labelFamily(family).haloWidthRatio : labelFamily(family).haloBlurRatio;
    if (typeof sizeExpression === "number") {
        return sizeExpression * ratio;
    }
    if (containsZoom(sizeExpression)) {
        throw new Error(
            `halo for "${family}" cannot wrap a zoom expression: MapLibre allows ["zoom"] only as the ` +
                `input of the outermost expression. Fold the factor into the stops instead ` +
                `(bandInterpolateExpression with { scale }).`,
        );
    }
    return ["*", sizeExpression, ratio];
}
