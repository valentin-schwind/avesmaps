import type { MediaRole } from "@avesmaps3d/shared";
import { PHOTOBOX_KACHEL_VARIANT, PUBLISHED_VARIANT } from "../roles.ts";

/**
 * Die Profile der Rasterpipeline (WI-0063 26.11, `media.yaml` → `profile`): wenige, zentral registrierte Rezepte. Kein
 * Feature kopiert Kodierer- oder Maßcode; eine Rolle wählt ihr Profil (`profileForRole`), und der Variantenname des
 * veröffentlichten Derivats kommt aus `roles.ts`.
 *
 * Ein Profil ist DATEN. Eine Änderung der Maße oder der Qualität erhöht `revision`, denn die Revision steht in
 * `media_file.recipe_version`: ohne sie wäre ein Derivat nicht reproduzierbar, und ein zweiter Importlauf könnte alte und
 * neue Bytes nicht unterscheiden.
 *
 * Galerieeinträge erben die Rolle `header` (WI-0063 26.7) und damit das Profil `header_16_9`; ein eigenes `gallery`-Profil
 * gibt es nicht.
 */

export type Geometry =
    /**
     * Ins Rechteck `longEdge × longEdge` einpassen, nie vergrößern, kein Zuschnitt (Seitenverhältnis bleibt). Mit `padSquare` danach
     * mit durchsichtigem Rand zum Quadrat aufgefüllt (Wappen aus dem Editor, Betreiber 2026-10-10: „nur mit durchsichtigem rand
     * auffüllen“): nie zugeschnitten, nie gestreckt.
     */
    | { kind: "fit_inside"; longEdge: number; padSquare?: true }
    /** Die Pixel erhalten, nichts skalieren, nichts zuschneiden (`citymap_full`: Detailauflösung). */
    | { kind: "native" }
    /** Zentrierter Zuschnitt auf `ratio`, höchstens `maxWidth` breit, nie vergrößert. */
    | { kind: "crop"; ratio: readonly [number, number]; maxWidth: number };

export type Encoding =
    /** WebP verlustfrei (Betreiber D3: Wappen). */
    | { mode: "lossless" }
    /** WebP verlustbehaftet, Qualität 1 bis 100 (Betreiber D3: Ortsbilder q80). Die Alphaebene bleibt immer bei 100. */
    | { mode: "lossy"; quality: number };

/**
 * Was der Render braucht: Name, Revision, Geometrie und Kodierung, ohne Rolle der MAM (KANAL-0001 §6.3 M2). `renderRaster` und
 * `recipeVersion` nehmen dieses Profil; ein Profil der MAM (`RasterProfile`) ist eines mit Rolle.
 */
export interface RenderProfile {
    /**
     * Der Name des Rezepts. Bei der MAM `media_file.variant` der veröffentlichten Datei, aus `roles.ts`, zugleich
     * `media_file.derivative_recipe`: Profil, Variante und Rezept heißen gleich.
     */
    variant: string;
    /** Versionszähler der Rezeptur (Maße, Qualität, Operationsfolge); wächst bei jeder Änderung daran. */
    revision: number;
    /** Kennzeichen einer Abwandlung desselben Profils in `recipe_version` (`square`): sonst wären aufgefüllte und nicht aufgefüllte Bytes nicht zu unterscheiden. */
    tag?: string;
    geometry: Geometry;
    /** Ein SVG wird auf diese lange Kante gerastert (Vektor: Vergrößern verliert nichts). */
    svgLongEdge: number;
    encoding: Encoding;
}

/** Ein Profil der Medienverwaltung: ein Render-Profil für eine Rolle. */
export interface RasterProfile extends RenderProfile {
    role: MediaRole;
}

const profile = (role: MediaRole, geometry: Geometry, svgLongEdge: number, encoding: Encoding): RasterProfile => ({
    role,
    variant: PUBLISHED_VARIANT[role],
    revision: 1,
    geometry,
    svgLongEdge,
    encoding,
});

/**
 * - `coat` (Rolle `coat`): Wappen. Lange Kante 512, kein Zuschnitt, Transparenz bleibt, verlustfrei (D3).
 * - `header_16_9` (Rolle `header`): Kopfbild und Galerie. 16:9, höchstens 800 × 450 (wie Legacys Ortsbilder und die
 *   Kopfgrafiken des Infopanels), q80 (D3).
 * - `citymap_full` (Rolle `map_full`): Kartensammlung, Vollbild. Pixel erhalten, kein Zuschnitt, verlustfrei. Es gibt
 *   keinen Messwert am Bestand (Legacy hat keine Vollkarten im Satz): die Wahl ist vorsichtig, und ein Rezeptwechsel
 *   (Revision 2) folgt, sobald gemessen ist.
 * - `citymap_preview` (Rolle `map_preview`): kleine Vorschau, lange Kante 400, q80.
 * - `literature_cover` (Rolle `literature_cover`): Hochformat-Cover, lange Kante 600, kein Zuschnitt, q80.
 * - `photobox_2048` (Rolle `photobox`): Reisebild eines Besuchers (WI-0272), lange Kante 2048, kein Zuschnitt, nie vergrößert, q80.
 *   Der Render schreibt weder EXIF noch GPS (`render.ts` ohne `withMetadata`).
 * - `social_post_2048` (Rolle `social_post`, WI-0278): Bild eines Social-Media-Beitrags. Wie das Reisebild: lange Kante 2048, kein Zuschnitt, nie vergrößert, q80. Die 800 × 450 des
 *   Kopfbilds wären für einen Beitrag zu klein, und ein Zuschnitt auf 16:9 nähme ihm still den Rand.
 */
export const RASTER_PROFILES: readonly RasterProfile[] = [
    profile("coat", { kind: "fit_inside", longEdge: 512 }, 512, { mode: "lossless" }),
    profile("header", { kind: "crop", ratio: [16, 9], maxWidth: 800 }, 800, { mode: "lossy", quality: 80 }),
    // 3840: ein gerastertes SVG muss unter der Pixelgrenze (16 MP) bleiben, 4096 × 4096 wären 16,8 MP.
    profile("map_full", { kind: "native" }, 3840, { mode: "lossless" }),
    profile("map_preview", { kind: "fit_inside", longEdge: 400 }, 400, { mode: "lossy", quality: 80 }),
    profile("literature_cover", { kind: "fit_inside", longEdge: 600 }, 600, { mode: "lossy", quality: 80 }),
    profile("photobox", { kind: "fit_inside", longEdge: 2048 }, 2048, { mode: "lossy", quality: 80 }),
    profile("social_post", { kind: "fit_inside", longEdge: 2048 }, 2048, { mode: "lossy", quality: 80 }),
];

/**
 * Die Kachel eines Reisebildes (WI-0272 S4, Aufgabe 22): die zweite öffentliche Fassung für Leiste und Kartensymbole, lange Kante 480, nie vergrößert, kein
 * Zuschnitt, WebP q72. Eine Beifassung der Rolle `photobox` (`beifassungen`), kein Eintrag von `RASTER_PROFILES`: Ein Profil je Rolle bleibt das Profil der
 * Hauptfassung (`profileForRole`). Der Render schreibt weder EXIF noch GPS.
 */
export const PHOTOBOX_KACHEL_PROFILE: RasterProfile = {
    role: "photobox",
    variant: PHOTOBOX_KACHEL_VARIANT,
    revision: 1,
    geometry: { kind: "fit_inside", longEdge: 480 },
    svgLongEdge: 480,
    encoding: { mode: "lossy", quality: 72 },
};

/** Die Profile, die neben der Hauptfassung einer Rolle entstehen (heute nur die Kachel des Reisebildes); die Hauptfassung steht in `profileForRole`. */
export function beifassungen(role: MediaRole): readonly RasterProfile[] {
    return role === "photobox" ? [PHOTOBOX_KACHEL_PROFILE] : [];
}

/**
 * Das Wappen aus dem Editor (WI-0068 P4b, Betreiber 2026-10-10): wie `coat`, aber mit durchsichtigem Rand zum Quadrat aufgefüllt.
 * Der Bestand aus Legacy behält `coat` (seine Wappen stehen kalibriert an den Gebietsnamen, WI-0121); was dort nicht quadratisch ist,
 * zeigt der Korb „Wappen mit Mängeln“, statt still anders gerechnet zu werden.
 */
export const COAT_SQUARE_PROFILE: RasterProfile = {
    ...profile("coat", { kind: "fit_inside", longEdge: 512, padSquare: true }, 512, { mode: "lossless" }),
    tag: "square",
};

/**
 * Die Profile des Betreiber-Kanals (KANAL-0001 §6.1 Nr. 2, §6.3 M2), ohne Rolle der MAM: die Ansicht (lange Kante höchstens 2560) und die
 * Vorschau (480), beide WebP verlustbehaftet q80, nie vergrößert, kein Zuschnitt. Der Render schreibt weder EXIF noch GPS, ICC oder XMP
 * (`render.ts` ohne `withMetadata`). Eine Änderung erhöht die Revision, wie bei jedem Profil.
 */
export const CHANNEL_PROFILES = {
    ansicht: {
        variant: "kanal_ansicht",
        revision: 1,
        geometry: { kind: "fit_inside", longEdge: 2560 },
        svgLongEdge: 2560,
        encoding: { mode: "lossy", quality: 80 },
    },
    vorschau: {
        variant: "kanal_vorschau",
        revision: 1,
        geometry: { kind: "fit_inside", longEdge: 480 },
        svgLongEdge: 480,
        encoding: { mode: "lossy", quality: 80 },
    },
} as const satisfies Record<"ansicht" | "vorschau", RenderProfile>;

/** Das Profil für ein Asset: ein Wappen aus dem Editor wird aufgefüllt, sonst das Profil der Rolle. */
export function profileForAsset(role: MediaRole, options: { editorCoat: boolean }): RasterProfile {
    return role === "coat" && options.editorCoat ? COAT_SQUARE_PROFILE : profileForRole(role);
}

/** Das Profil einer Rolle. Jede Rolle hat genau eines. */
export function profileForRole(role: MediaRole): RasterProfile {
    const found = RASTER_PROFILES.find((candidate) => candidate.role === role);
    if (found === undefined) throw new Error(`Für die Rolle ${role} gibt es kein Rasterprofil`);
    return found;
}
