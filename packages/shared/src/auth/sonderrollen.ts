import { capabilitiesFor, type Capability, type Role } from "./capabilities.ts";

/**
 * Die Sonderrollen (WI-0279; Betreiber 2026-11-03): fachliche Beauftragungen, die zur Grundrolle hinzukommen. Eine Sonderrolle ist
 * ein benanntes Bündel von Capabilities aus dem EINEN Katalog (`capabilities.ts`), keine zweite Rechteverwaltung und keine Stufe:
 * Sie hebt die Grenze der Grundrolle nach oben auf und nimmt nie etwas weg. Vergeben und entzogen wird über
 * `/api/admin/sonderrollen`, nur vom Betreiber; ob jemand ein Recht hat, sagt allein `rechteVon`.
 *
 * - `regional`: Die Zuteilung nennt eine Region, eine Fläche der Ebene `derographisch`. Eine Person kann mehrere betreuen.
 * - `einePersonJeRegion`: Höchstens eine Person je Region (der Index in Migration 0303 nennt die Rolle ebenfalls).
 *
 * Was ein Bündel nie tragen darf, prüft `sonderrollen.test.ts`.
 */
export interface SonderrolleSpec {
    readonly rechte: readonly Capability[];
    readonly regional?: true;
    readonly einePersonJeRegion?: true;
}

export const SONDERROLLEN = {
    derograph: { rechte: ["use_editor_menu", "edit_landscapes", "edit_landscape_form"] },
    politologe: { rechte: ["use_editor_menu", "edit_territories", "edit_territory_form"] },
    ortskundiger: { rechte: [], regional: true },
    regionalkanzler: { rechte: [], regional: true, einePersonJeRegion: true },
    social_media_manager: {
        rechte: [
            "use_editor_menu",
            "view_media_private",
            "social_communication",
            "publish_social",
            "upload_social_image",
        ],
    },
    diplomat: { rechte: ["use_editor_menu", "read_mailbox", "answer_community", "send_new_mail", "trash_mail"] },
    kurator: {
        rechte: [
            "use_editor_menu",
            "view_media_private",
            "upload_media",
            "review_media_rights",
            "publish_media",
            "suspend_media_publication",
            "delete_media",
            "merge_media_all",
            "moderate_photobox",
            "moderate_map_suggestions",
            "view_own_jobs",
        ],
    },
    odologe: { rechte: ["manage_routing", "view_own_jobs"] },
    topograph: {
        rechte: [
            "use_editor_menu",
            "edit_landscapes",
            "edit_landscape_form",
            "edit_mountains",
            "manage_terrain_recipe",
            "view_own_jobs",
        ],
    },
    kartograph: {
        rechte: [
            "use_editor_menu",
            "view_media_private",
            // Betreiber 2026-11-06 (WI-0282): Der Kartograph sammelt freie Karten, lädt sie hoch und gibt sie selbst frei.
            "upload_media",
            "review_media_rights",
            "edit_map_collection",
            "moderate_map_suggestions",
            "manage_map_series",
            "release_map_series",
            "export_maps",
            "view_own_jobs",
        ],
    },
    // WI-0288 (Betreiber 2026-11-07: „es braucht die neue Rolle Meteorologe, der Zugriff darauf erhält“): das Wettermodell der
    // Systemsteuerung, dazu Presets und Icons des Wetter-Editors, die ein Editor ohnehin hat (Claudias Setzung: wer das Modell verstellt,
    // soll seine Wirkung an den Presets nachstellen können, auch als Tester).
    meteorologe: { rechte: ["use_editor_menu", "edit_weather", "manage_weather_model"] },
    // Betreiber 2026-11-08: „Wir brauchen eine neue Sonderrolle: "Linguist" -> mit schreibzugriff auf das sprachmodul“. Der Spracheditor
    // schreibt mit `edit_languages` (ab Admin, darunter nur der Linguist, E17a); das Editormenü öffnet ihn. Keine Quellen, keine Derographie.
    linguist: { rechte: ["use_editor_menu", "edit_languages"] },
} as const satisfies Record<string, SonderrolleSpec>;

export type SonderrolleName = keyof typeof SONDERROLLEN;

/** Die Sonderrollen in der Reihenfolge des Katalogs. */
export const SONDERROLLEN_NAMEN = Object.keys(SONDERROLLEN) as SonderrolleName[];

export function isSonderrolle(value: string): value is SonderrolleName {
    return Object.hasOwn(SONDERROLLEN, value);
}

export function sonderrolleSpec(name: SonderrolleName): SonderrolleSpec {
    return SONDERROLLEN[name];
}

/** Die Sonderrollen, die dieses Recht mitbringen; für Listen nach Recht (Glocke, „Zuständig“). */
export function sonderrollenMit(recht: Capability): SonderrolleName[] {
    return SONDERROLLEN_NAMEN.filter((name) => sonderrolleSpec(name).rechte.includes(recht));
}

/**
 * Alle Rechte einer Person in einer Umgebung: Rollenvorlage, zugeteilte Einzelrechte und die Bündel ihrer Sonderrollen. Anders als ein
 * Einzelrecht hängt eine Sonderrolle nicht an der Grundrolle; sie gilt auch für Tester. Eine unbekannte Rolle (eine ältere Zeile oder
 * ein älterer Katalog) zählt nicht.
 */
export function rechteVon(person: {
    readonly role: Role;
    readonly grants?: Iterable<string>;
    readonly sonderrollen?: Iterable<string>;
}): ReadonlySet<Capability> {
    const rechte = new Set(capabilitiesFor(person.role, person.grants));
    for (const name of person.sonderrollen ?? []) {
        if (isSonderrolle(name)) for (const recht of sonderrolleSpec(name).rechte) rechte.add(recht);
    }
    return rechte;
}
