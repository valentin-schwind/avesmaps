// Auflösungs-Hook des Terrain-Labs (WI-0250 Phase B): `@avesmaps3d/shared` und `@avesmaps3d/shared/gebirge` kommen aus den QUELLEN des
// gemessenen Stands, nie aus einem gebauten `dist` und nie aus dem `node_modules` eines anderen Checkouts. In einer Arbeitskopie zeigt
// der Paketname sonst in den Hauptcheckout (siehe `vitest.config.ts`); ein Messlauf gegen dessen Stand wäre eine Messung des falschen
// Codes. Drittpakete (TypeBox) löst Node wie üblich auf.
import { pathToFileURL } from "node:url";
import { join } from "node:path";

let wurzel = "";

export function initialize(daten) {
    wurzel = daten.wurzel;
}

const ZIELE = {
    "@avesmaps3d/shared": ["packages", "shared", "src", "index.ts"],
    "@avesmaps3d/shared/gebirge": ["packages", "shared", "src", "gebirge", "browser.ts"],
};

export async function resolve(spezifizierer, kontext, weiter) {
    const ziel = ZIELE[spezifizierer];
    if (ziel !== undefined) return { url: pathToFileURL(join(wurzel, ...ziel)).href, shortCircuit: true };
    return weiter(spezifizierer, kontext);
}
