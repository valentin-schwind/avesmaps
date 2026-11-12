import type { MediaImageRelation, MediaImageRelationState, MediaPublicView } from "@avesmaps3d/shared";

/**
 * Der Bildbezug eines Kopfbildes: Ortsansicht (`place_view`) oder Typbild (`type_image`). Betreiber 2026-10-11, wörtlich „1A … 2 B …
 * 3 A ja das gilt für alle“; Arbeitsanweisung `project-control/work-items/bildbezug-ortsansicht-typbild-2026-10-11.md`, Migration 0111.
 *
 * **1A, die Regel je Verwendung, gerechnet auf dem Server.** Ein Kopfbild an einem Ort ist Ortsansicht, wenn DIESELBE DATEI (die
 * Quelldatei `media_file` Variante `source`, sha256) als Kopfbild an genau EINEM aktiven Ort hängt, gezählt über Galerieeinträge und
 * Bindungen `place_media` mit Rolle `header` zusammen; sonst Typbild. 🔴 Gezählt über die Datei, nie über die Asset-Kennung: Legacy hat
 * dieselbe Datei in verschiedene Assets gelegt (lokal 11 von 52 Dateien), eine Zählung der Bindungen hielte sie für eigene Bilder. Ein
 * Asset ohne Quelldatei hat keine bekannte Identität und bleibt Typbild: „Fehlende oder unsichere fachliche Zuordnung nicht als
 * bestätigte Ortsansicht ausgeben“ (Arbeitsanweisung). Die redaktionelle Übersteuerung je Verwendung (`image_relation_override` an
 * `media_gallery_item` und `place_media`) gewinnt in beide Richtungen.
 *
 * **2B, eine gemischte Folge** (`withholdTypeImages`): Liefert ein Ort mindestens eine Ortsansicht aus, liefert er seine Typbilder nicht mit. Ein Reisebild
 * zählt dafür nicht (Vali 2026-11-09: „man will nicht dass reisebilder typbilder plötzlich ersetzen, sondern einfach nur die galerie extended“): Es reiht sich
 * hinter die Typbilder ein, so wie hinter eine Ortsansicht. Athyros (eine eigene, eine geteilte Datei) zeigt dann nur sein eigenes Bild. Gerechnet NACH der Entscheidung der Policy:
 * Eine Ortsansicht, die nicht öffentlich ist, nimmt dem Ort seine Typbilder nicht.
 *
 * **3, für alle Objekte:** Jedes sichtbare Kopfbild trägt eine Beschriftung; die Grafik der Art ist immer „Typbild“. Das entscheidet
 * die Oberfläche (`apps/web/src/info-panel/bildbezug.ts`); sie leitet nichts aus der Anzahl der Bilder ab, und ein fehlendes Feld ist
 * nie eine Ortsansicht.
 */

/**
 * Die Kopfbild-Verwendungen aller Orte: Galerieeinträge einer aktiven Kopf-Galerie und direkte Bindungen, je aktiv. Eine Zeile je
 * Verwendung (Ort, Asset).
 */
const HEADER_USAGES = `
    SELECT g.place_id, i.media_asset_id
      FROM place_media_gallery g
      JOIN media_gallery_item i ON i.gallery_id = g.media_gallery_id
     WHERE g.role = 'header' AND g.retired_at IS NULL AND i.retired_at IS NULL
    UNION ALL
    SELECT m.place_id, m.media_asset_id
      FROM place_media m
     WHERE m.role = 'header' AND m.retired_at IS NULL
`;

/**
 * An wie vielen aktiven Orten hängt die Quelldatei des Assets `assetColumn` als Kopfbild? 0 ohne Quelldatei. Ein SQL-Ausdruck für eine
 * Abfrage, die das Asset als Spalte kennt (`a.id`); er nutzt die Indizes auf `media_file (sha256)`, `media_gallery_item (media_asset_id)`
 * und `place_media (media_asset_id)`.
 */
export function placesOfSourceFileSql(assetColumn: string): string {
    return `(
        SELECT count(DISTINCT hu.place_id)::int
          FROM media_file src
          JOIN media_file same ON same.sha256 = src.sha256 AND same.variant = 'source'
          JOIN (${HEADER_USAGES}) hu ON hu.media_asset_id = same.media_asset_id
          JOIN place p ON p.id = hu.place_id AND p.is_active
         WHERE src.media_asset_id = ${assetColumn} AND src.variant = 'source'
    )`;
}

/** Was die Regel allein sagt (ohne Übersteuerung), als SQL-Ausdruck: `'place_view'` oder `'type_image'`. */
export function ruleRelationSql(assetColumn: string): string {
    return `CASE WHEN ${placesOfSourceFileSql(assetColumn)} = 1 THEN 'place_view' ELSE 'type_image' END`;
}

/**
 * Der Bildbezug einer Verwendung als SQL-Ausdruck: die Übersteuerung, sonst die Regel. `NULL` für jede andere Rolle als `header`
 * (ein Wappen hat keinen Bildbezug, Arbeitsanweisung §7).
 */
export function relationSql(roleColumn: string, overrideColumn: string, assetColumn: string): string {
    return `CASE WHEN ${roleColumn} <> 'header' THEN NULL
                 WHEN ${overrideColumn} IS NOT NULL THEN ${overrideColumn}
                 ELSE ${ruleRelationSql(assetColumn)} END`;
}

/** Ein unbekannter oder fehlender Wert ist nie eine Ortsansicht. */
export function relationOf(value: unknown): MediaImageRelation {
    return value === "place_view" ? "place_view" : "type_image";
}

/** Der Zustand für die Editoren: Regel, Übersteuerung, was gilt, und an wie vielen aktiven Orten die Datei hängt. */
export function relationState(override: string | null, places: number): MediaImageRelationState {
    const rule: MediaImageRelation = places === 1 ? "place_view" : "type_image";
    const own = override === null ? null : relationOf(override);
    return { value: own ?? rule, rule, override: own, places };
}

/**
 * 2B: Trägt die ausgelieferte Folge eines Ortes mindestens eine Ortsansicht, fallen seine Typbilder weg; Reisebilder nehmen ihm keine. `withheld` nennt sie (der
 * Prüfer `verify:media` rechnet sie aus seiner Bilanz „erlaubt, aber nicht geliefert“ heraus).
 */
export function withholdTypeImages(views: readonly MediaPublicView[]): {
    delivered: MediaPublicView[];
    withheld: MediaPublicView[];
} {
    // Ein Reisebild im Kopf (WI-0272 S5, Rolle `photobox`) ersetzt KEIN Typbild mehr, es steht dahinter (Vali 2026-11-09, ersetzt seine Kopfregel vom 2026-11-02).
    const hasPlaceView = views.some((view) => view.role === "header" && view.relation === "place_view");
    if (!hasPlaceView) return { delivered: [...views], withheld: [] };
    const delivered: MediaPublicView[] = [];
    const withheld: MediaPublicView[] = [];
    for (const view of views) {
        if (view.role === "header" && view.relation !== "place_view") withheld.push(view);
        else delivered.push(view);
    }
    return { delivered, withheld };
}
