import {
    assetTypeAllowsRole,
    type MamAssetSummary,
    type MediaSameBytes,
    type MediaSubjectSlots,
} from "@avesmaps3d/shared";
import type { BindbareRolle, HochladeRolle } from "./medien-formular-modell";

/**
 * Gibt es die gewählte Datei schon als Werk? (Betreiber 2026-10-17, WI-0068: „Das gemeinsame Uploadformular der Medienverwaltung
 * und des Ortseditors soll unmittelbar nach der Dateiauswahl prüfen, ob das Original bereits als Asset existiert.“)
 *
 * Reine Funktionen, damit Vitest sie ohne Browser prüft; das Fenster (`medien-hochladen-fenster.vue`) fragt den Server und zeigt an.
 * 🔴 Der Server prüft beim Hochladen selbst noch einmal (`media_already_exists`); diese Frage spart nur den vergeblichen Versuch.
 */

/** Die SHA-256 der VOLLSTÄNDIGEN Originaldatei als Hex, wie der Server sie rechnet — nicht Name, Maße oder ein Wahrnehmungs-Hash. */
export async function sha256Hex(datei: Blob): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", await datei.arrayBuffer());
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Was gegen die Übernahme EINES Treffers spricht. */
export type DuplikatKonflikt =
    /** Mehrere Werke mit diesen Bytes, und ihre Rechte weichen voneinander ab: welches gilt, entscheidet ein Mensch. */
    | "rechte"
    /** Der Asset-Typ trägt die Rolle nicht (ein Bild ist kein Wappen, Betreiber 2026-10-10). */
    | "typ"
    /** Für dieses Original gilt ein Notaus: Es bleibt unveröffentlicht, wo immer es hängt. */
    | "notaus";

export interface DuplikatLage {
    /** Die lebenden Werke mit diesen Bytes, das älteste zuerst (ein aufgegangenes nennt der Server nie). */
    treffer: readonly MamAssetSummary[];
    /** Der Vorschlag des Servers: das kanonische, also das älteste. */
    vorschlag: MamAssetSummary;
}

/** Die Antwort des Servers als Lage; ohne Treffer `undefined` (dann ist es ein gewöhnliches Hochladen). */
export function duplikatLage(antwort: MediaSameBytes): DuplikatLage | undefined {
    const vorschlag = antwort.hits.find((hit) => hit.id === antwort.suggested) ?? antwort.hits[0];
    return vorschlag === undefined ? undefined : { treffer: antwort.hits, vorschlag };
}

/** Rechte zweier Werke gelten als gleich, wenn Grundlage und Prüfstand gleich sind (wie die Vorschau der Zusammenführung). */
const rechteSchluessel = (werk: MamAssetSummary): string => `${werk.rightsBasis ?? ""}|${werk.clearance ?? ""}`;

export function duplikatKonflikte(
    lage: DuplikatLage,
    gewaehlt: MamAssetSummary,
    rolle: HochladeRolle,
): DuplikatKonflikt[] {
    const konflikte: DuplikatKonflikt[] = [];
    if (new Set(lage.treffer.map(rechteSchluessel)).size > 1) konflikte.push("rechte");
    // In einen Beitrag des Social Hubs passt jedes vorhandene Bild (WI-0278): Der Typ sagt nur, wo es gebunden werden darf.
    if (gewaehlt.kind !== "image" || (rolle !== "social_post" && !assetTypeAllowsRole(gewaehlt.assetType, rolle))) {
        konflikte.push("typ");
    }
    if (gewaehlt.suspended) konflikte.push("notaus");
    return konflikte;
}

/**
 * Hängt dieses Werk schon an genau diesem Platz (Editor-Orchestrierung 2026-10-17: „kein zweites Binden“)? Am Titelbild zählt nur
 * das Einzelbild: Steht das Werk in einer gebundenen Galerie, ersetzt „Vorhandenes Bild verwenden“ die Galerie durch dieses eine Bild
 * (WI-0219), und das ist eine echte Änderung.
 */
export function haengtSchonHier(plaetze: MediaSubjectSlots, rolle: BindbareRolle, assetId: string): boolean {
    if (rolle === "coat") return plaetze.coat.state === "set" && plaetze.coat.asset?.id === assetId;
    return plaetze.header?.image?.asset.id === assetId;
}

/**
 * Warum „Vorhandenes Bild verwenden“ gesperrt ist; `undefined`, wenn es geht. Nur mit einem Platz (Ortseditor) sperrt der Typ und
 * „hängt schon hier“: Ohne Platz öffnet die Übernahme das Werk nur im Inspector, und dort lässt sich der Typ ändern.
 */
export type DuplikatSperre = "typ" | "schonHier";

export function duplikatSperre(
    konflikte: readonly DuplikatKonflikt[],
    plaetze: MediaSubjectSlots | undefined,
    rolle: BindbareRolle,
    assetId: string,
): DuplikatSperre | undefined {
    if (plaetze === undefined) return undefined;
    if (konflikte.includes("typ")) return "typ";
    return haengtSchonHier(plaetze, rolle, assetId) ? "schonHier" : undefined;
}
