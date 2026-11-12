import type { SubjectRef } from "@avesmaps3d/shared";

/**
 * „Link teilen“: die Adresse, die dasselbe Subject wieder öffnet (WI-0063 P6; Legacy `buildShareLinkPath`/`buildPlaceShareLink`
 * in `js/map-features/map-features-share-pin.js`, `sharePlaceActionButtonMarkup` in `js/ui/popups.js`, Mirror `b9657635a`).
 *
 * 🔴 Die Adresse ist Legacys: Hat das Objekt einen Wiki-Artikel, trägt sie den dokumentierten Objektlink-Parameter mit dem
 * Seitenteil der Wiki-Adresse (`?siedlung=Gareth`, `?staat=…`, `?region=…`, `?strasse=…`, `?fluss=…`) - dieselbe Adresse, auf
 * die die Wiki Aventurica verlinkt (AGENTS.md „Links von Legacy bleiben gültig“); sonst, wo Legacy es tat, `?place=<Kennung>`. Ein
 * Gebiet, eine Landschaft und ein Weg ohne Wiki-Adresse haben keinen Link (Legacy zeigt dort keinen Knopf). Eine freie Kartenstelle
 * teilt `?pin=<y>,<x>` mit drei Stellen (Legacys Leaflet-Reihenfolge, `formatSharePinQueryValue`).
 *
 * Reine Funktion: Sie liest nichts aus dem Fenster; die Seite ohne Query und Hash kommt als `base`.
 */

/** Der Seitenteil einer Wiki-Adresse (`/wiki/<Seite>`), unverändert wie Legacy: die Prozentkodierung bleibt, wie sie ist. */
export function wikiPageOf(wikiUrl: string | undefined): string | undefined {
    const match = /\/wiki\/([^?#]+)/i.exec(wikiUrl ?? "");
    return match?.[1] === undefined || match[1] === "" ? undefined : match[1];
}

export interface ShareSource {
    /** Die Wiki-Adresse des Objekts, wo es eine gibt. */
    wikiUrl?: string | undefined;
    /** Die Wegart (`Flussweg`, `Seeweg` …): Fluss und Seeweg teilen als `fluss`, jeder andere Weg als `strasse`. */
    pathSubtype?: string | undefined;
    /** Der Gruppenschlüssel einer Sprache (`garethi`, WI-0261 T-2): ihre lesbare Adresse `?sprache=garethi`. */
    spracheSchluessel?: string | undefined;
}

/** Die Adresse zum Teilen oder `undefined`, wo es keinen Link gibt. */
export function shareAddress(base: string, ref: SubjectRef, source: ShareSource = {}): string | undefined {
    const page = wikiPageOf(source.wikiUrl);
    const withWiki = (param: string): string | undefined =>
        page === undefined ? undefined : `${base}?${param}=${page}`;
    const byId = (id: string): string => `${base}?place=${encodeURIComponent(id)}`;
    switch (ref.kind) {
        case "place":
            return withWiki("siedlung") ?? byId(ref.id);
        case "peak":
            return withWiki("region") ?? byId(ref.id);
        case "area":
            return withWiki("region");
        case "territory":
            return withWiki("staat");
        case "path":
            return withWiki(source.pathSubtype === "Flussweg" || source.pathSubtype === "Seeweg" ? "fluss" : "strasse");
        case "mapPoint":
            return `${base}?pin=${ref.y.toFixed(3)},${ref.x.toFixed(3)}`;
        // Eine Sprache (WI-0261 S5b) teilt ihren Gruppenschlüssel: lesbar und stabil, anders als ihre Kennung nach einem neuen Einspielen
        // (`object-link.ts` löst ihn über `GET /api/sprachen/{schluessel}` auf). Ohne Schlüssel kein Link.
        case "sprache":
            return source.spracheSchluessel === undefined
                ? undefined
                : `${base}?sprache=${encodeURIComponent(source.spracheSchluessel)}`;
        // Ein Wetter-Icon (WI-0288) teilt seine Kennung: Icons haben keinen lesbaren Schlüssel (`object-link.ts` öffnet `?wetter=`).
        case "wetterSymbol":
            return `${base}?wetter=${encodeURIComponent(ref.id)}`;
        // Eine Kraftlinie hat in Legacy keinen Link-Parameter („ein Knopf, der nichts Auflösbares erzeugt, wäre schlimmer als
        // keiner“), eine Etappe lebt in der Reise (`?route=`), eine Klimazone ist Kontext.
        case "powerline":
        case "routeStage":
        case "climate":
        case "loreEntry":
            return undefined;
    }
}
