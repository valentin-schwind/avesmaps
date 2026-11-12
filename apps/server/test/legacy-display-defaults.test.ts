import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
    DEFAULTS_FILE,
    DEFAULT_MIRROR,
    buildDocument,
    extractDefaults,
    readFromMirror,
    sameDocument,
} from "../../../scripts/dev/extract-legacy-display-defaults.ts";

/**
 * Die Vorgaben der Darstellungstafel, wie sie aus Legacys Code kommen (WI-0064).
 *
 * 🔴 Die Vorgaben stehen in Legacys `ecosystem-display.js`, nicht im Endpunkt. Damit die eingecheckte Datei nicht zu einer
 * Abschrift wird, die still auseinanderlaeuft, wird Legacys Datei AUSGEFUEHRT (nicht gelesen) und die Datei im Repo dagegen
 * gehalten. Der Mirror-Test laeuft nur, wo der Discovery-Mirror liegt (sichtbarer Skip sonst) und misst gegen den FESTGEHALTENEN
 * Commit, nicht gegen `master`: dass Legacy die Datei aendert, ist kein Fehler dieses Repositorys - `npm run legacy:display-defaults`
 * zeigt es, und die Abweichungsliste in WI-0064 wird dann neu gelesen.
 */

const KLEINE_QUELLE = `
const AVESMAPS_ECOSYSTEM_DISPLAY_DECKKRAFT = { vegetation: 0.72, klima: 0.30 };
const AVESMAPS_ECOSYSTEM_DISPLAY_DECKKRAFT_JE_ART = { "topographie:see": 1 };
const AVESMAPS_ECOSYSTEM_DISPLAY_WASSERFLAECHEN = new Set(["topographie:see"]);
const AVESMAPS_ECOSYSTEM_DISPLAY_GROESSE_LIMITS = { min: 4, max: 30 };
const AVESMAPS_ECOSYSTEM_DISPLAY_VORGABE = { ab: 0, bis: 7, curveMax: 1, prio: 3 };
const AVESMAPS_ECOSYSTEM_DISPLAY_VORGABE_JE_ART = { wald: { ab: 4 }, kontinent: { bis: 3 } };
const AVESMAPS_ECOSYSTEM_DISPLAY_BAND_MAX = 7;
const AVESMAPS_ECOSYSTEM_DISPLAY_ABSTAND_VORGABE = { repel: 2, versatz: 8, drift: 72 };
const AVESMAPS_ECOSYSTEM_DISPLAY_ABSTAND_LIMITS = { repel: { min: 0, max: 20 } };
const AVESMAPS_ECOSYSTEM_DISPLAY_KOLLISION_VORGABE = { teil: true, fest: false };
const AVESMAPS_ECOSYSTEM_DISPLAY_KOLLISION_VORGABE_JE_ART = { berggipfel: { fest: true } };
function avesmapsEcosystemDisplayVorgabeGroesse(zoom) { return 10 + zoom; }
`;

describe("Legacys Datei ausfuehren und die Vorgaben lesen", () => {
    it("liest jede Konstante und rechnet die Vorgabegroesse mit Legacys eigener Funktion, neun Baender", () => {
        const auszug = extractDefaults(KLEINE_QUELLE);
        expect(auszug.base).toEqual({ ab: 0, bis: 7, curveMax: 1, prio: 3 });
        expect(auszug.perArt).toEqual({ wald: { ab: 4 }, kontinent: { bis: 3 } });
        expect(auszug.sizeByBand).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18]);
        expect(auszug.sizeLimits).toEqual({ min: 4, max: 30 });
        expect(auszug.opacity.waterAreas).toEqual(["topographie:see"]);
        expect(auszug.collision.perArt).toEqual({ berggipfel: { fest: true } });
        // Ein Set aus dem anderen Realm ist danach eine Liste, ein Objekt danach ein gewoehnliches Objekt.
        expect(Array.isArray(auszug.opacity.waterAreas)).toBe(true);
        expect(Object.getPrototypeOf(auszug.base)).toBe(Object.prototype);
    });

    it("🔴 eine Konstante, die es nicht mehr gibt, bricht laut ab, statt eine Luecke zu lassen", () => {
        const ohne = KLEINE_QUELLE.replace("const AVESMAPS_ECOSYSTEM_DISPLAY_VORGABE_JE_ART", "const ANDERER_NAME");
        expect(() => extractDefaults(ohne)).toThrow(/AVESMAPS_ECOSYSTEM_DISPLAY_VORGABE_JE_ART nicht mehr/);
    });

    it("💣 die Datei laeuft in einem leeren Kontext: weder require noch process noch fetch sind erreichbar", () => {
        const probe = `${KLEINE_QUELLE}
            if (typeof require !== "undefined" || typeof process !== "undefined" || typeof fetch !== "undefined") {
                throw new Error("die Datei erreicht etwas ausserhalb ihres Kontexts");
            }`;
        expect(() => extractDefaults(probe)).not.toThrow();
    });

    it("die Datei haelt auf die Herkunft fest: gleiche Eingabe, gleiches Dokument", () => {
        const quelle = { repository: "r", file: "f", commit: "a".repeat(40), blob: "b".repeat(40) };
        const eins = buildDocument(extractDefaults(KLEINE_QUELLE), quelle);
        const zwei = buildDocument(extractDefaults(KLEINE_QUELLE), quelle);
        expect(JSON.stringify(eins)).toBe(JSON.stringify(zwei));
        expect(sameDocument(JSON.stringify(eins, null, 2), eins)).toBe(true);
        expect(sameDocument("kein json", eins)).toBe(false);
    });
});

const mirrorVorhanden = existsSync(DEFAULT_MIRROR);
const describeMitMirror = mirrorVorhanden ? describe : describe.skip;

describeMitMirror("die Vorgaben im Repo gegen Legacys Code am festgehaltenen Commit (Discovery-Mirror)", () => {
    it("🔴 sind der Auszug aus genau dieser Datei, Feld fuer Feld", () => {
        const eingecheckt = JSON.parse(readFileSync(DEFAULTS_FILE, "utf8")) as {
            source: { commit: string; blob: string };
        };
        const { text, source } = readFromMirror(DEFAULT_MIRROR, eingecheckt.source.commit);
        // Derselbe Blob: es ist dieselbe Datei, die damals ausgewertet wurde.
        expect(source.blob).toBe(eingecheckt.source.blob);
        expect(sameDocument(readFileSync(DEFAULTS_FILE, "utf8"), buildDocument(extractDefaults(text), source))).toBe(
            true,
        );
    });
});
