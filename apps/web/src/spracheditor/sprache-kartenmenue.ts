import type { Map as MapLibreMap } from "maplibre-gl";
import { AVENTURIA, fromRenderLngLat, type EditorStatus } from "@avesmaps3d/shared";
import type { EditorAction, EditorMenuSubject } from "../editor-menu/action";
import {
    neueTeilflaecheEintrag,
    spracheHandgriffe,
    spracheSubjekt,
    type SpracheLage,
} from "../editor-menu/handgriffe-sprache";
import type { AnlegenEintrag, KartenListe } from "../editor-menu/kartenmenue";
import type { FlaecheMalen } from "../landschaftseditor/flaeche-malen";
import type { FlaecheVereinfachen } from "../landschaftseditor/flaeche-vereinfachen";
import type { FlaecheVerschieben } from "../landschaftseditor/flaeche-verschieben";
import type { MitAnderer } from "../landschaftseditor/mit-anderer-flaeche";
import type { Unterflaechen } from "../landschaftseditor/unterflaechen";
import type { Zerschneiden } from "../landschaftseditor/zerschneiden";
import type { Punkt } from "../map/geometrie/geometrie";
import { sprachenAmPunkt, type SpracheAnStelle } from "../map/sprachen-auswahl";
import type { SpracheditorFuerSeite } from "./spracheditor-anbindung";

/**
 * Die Sprachflächen im Kartenmenü der Editoren (WI-0261 Stufe 1, `editor-menu/handgriffe-sprache.ts`) an EINER Stelle, damit `app.vue` nur einhängt
 * (Hausregel „app.vue schmal“): die Sprachen unter dem Rechtsklick samt ihrer Teilfläche dort, die Handgriffe für das Register, gebunden an den
 * Spracheditor, und „Hier hinzufügen › Neue Teilfläche“.
 *
 * Gemerkt wird je Rechtsklick, welche Teilfläche jeder Sprache unter dem Zeiger lag (die kleinste, wie beim Klick, `sprachenAnStelle`): Die Handgriffe
 * meinen sie, wie die Werkzeuge der Fläche ihre Teilfläche unter dem Klick (`teilflaecheAn` in `app.vue`). Dazu die Stelle selbst: Dort fasst
 * „Verschieben“ die Teilfläche (WI-0261 Stufe 2).
 *
 * „Form ändern ›“ (Stufe 2) startet die Modi der Derographie (`formen`) mit der Teilfläche als Quelle (`werkzeugAn` des Spracheditors). „Zerschneiden“,
 * „Mit anderer Fläche ›“ und „Unterflächen ›“ (Stufe 3) ebenso, mit der Quelle der sofort schreibenden Modi (`sofortAn`); „Kopieren …“ öffnet das Blatt im
 * Fenster der Sprache.
 */

export interface SprachKartenmenueSeite {
    readonly editor: SpracheditorFuerSeite;
    /** Der Stand des Bearbeitens und ob ein Modus der Seite läuft (auch ein Formentwurf und „Neue Fläche“). */
    lage(): { readonly bearbeiten: EditorStatus | undefined; readonly laeuft: boolean };
    /** Darf diese Sitzung Sprachen schreiben? */
    darf(): boolean;
    /** Zeigt die Karte gerade Derographie › Sprachen? */
    gezeigt(): boolean;
    /** Die Lasche „Editor“ nach vorn (wie bei jedem Handgriff, der ein Fenster öffnet). */
    zeigeEditor(): void;
    /** Die Modi der Form der Derographie (Stufe 2 und 3); erst beim Handgriff gefragt, denn `app.vue` legt sie später an. */
    formen(): {
        readonly verschieben: Pick<FlaecheVerschieben, "starte">;
        readonly malen: Pick<FlaecheMalen, "starte">;
        readonly vereinfachen: Pick<FlaecheVereinfachen, "starte">;
        readonly zerschneiden: Pick<Zerschneiden, "starte">;
        readonly mitAnderer: Pick<MitAnderer, "starte">;
        readonly unterflaechen: Pick<Unterflaechen, "starte" | "vereinige">;
    };
}

export interface SprachKartenmenue {
    /**
     * Beim Rechtsklick: die Sprachen unter dieser Stelle merken, nur wo die Ebene Sprachen gezeichnet ist; ohne Karte (es liegt schon ein anderer
     * Gegenstand dort) keine. Zurück kommen sie als Gegenstände der Handgriffe, die kleinste Teilfläche zuerst.
     */
    am(
        map: Pick<MapLibreMap, "getLayer" | "queryRenderedFeatures" | "project"> | undefined,
        lngLat: { lng: number; lat: number },
    ): EditorMenuSubject[];
    /** Mehrere Sprachen unter dem Rechtsklick: „Hier liegen N Sprachen“, je Sprache ihr Untermenü. */
    liste(gegenstaende: readonly EditorMenuSubject[]): KartenListe;
    /** Die Handgriffe an der Sprachfläche für das Register. */
    readonly handgriffe: readonly EditorAction[];
    /** „Hier hinzufügen › Neue Teilfläche“. */
    readonly anlegen: AnlegenEintrag;
}

const space = AVENTURIA.coordinateSpace;

export function createSprachKartenmenue(seite: SprachKartenmenueSeite): SprachKartenmenue {
    const { editor } = seite;
    let gemerkt: readonly SpracheAnStelle[] = [];
    /** Die Stelle des Rechtsklicks in Kartenkoordinaten. */
    let griff: Punkt | undefined;

    const lage = (): SpracheLage => ({
        ...seite.lage(),
        darf: seite.darf(),
        teilflaeche: (id) => gemerkt.find((sprache) => sprache.id === id)?.teilflaeche,
    });
    /** Die Sprache des vordersten Sprachfensters, wenn sie gelesen und aktiv ist (sonst gibt es keine Revision, gegen die gezeichnet wird). */
    const gewaehlt = (): string | undefined => {
        const id = editor.auswahl.value;
        return id !== undefined && editor.detailVon(id)?.aktiv === true ? id : undefined;
    };

    return {
        am(map, lngLat) {
            gemerkt = map === undefined || !seite.gezeigt() ? [] : sprachenAmPunkt(map, map.project(lngLat));
            griff = gemerkt.length === 0 ? undefined : fromRenderLngLat(space, lngLat);
            return gemerkt.map(spracheSubjekt);
        },
        liste: (gegenstaende) => ({ id: "sprachen", titel: "spracheditor.griff.hierLiegen", gegenstaende }),
        handgriffe: spracheHandgriffe(lage, {
            oeffnen(sprache, flaeche) {
                seite.zeigeEditor();
                if (flaeche === undefined) editor.oeffneFuer(sprache);
                else editor.zeigeFlaeche(sprache, flaeche);
            },
            bearbeiten: (sprache, flaeche, name) => editor.bearbeiteFlaeche(sprache, flaeche, name),
            entfernen(sprache, flaeche) {
                seite.zeigeEditor();
                editor.zeigeFlaeche(sprache, flaeche, true);
            },
            verschieben(sprache, flaeche, name) {
                const stelle = griff;
                if (stelle === undefined) return;
                const { id, quelle } = editor.werkzeugAn(sprache, flaeche, name);
                void seite.formen().verschieben.starte(id, flaeche, stelle, quelle);
            },
            malen(sprache, flaeche, name, art) {
                const { id, quelle } = editor.werkzeugAn(sprache, flaeche, name);
                void seite.formen().malen.starte(id, flaeche, art, quelle);
            },
            vereinfachen(sprache, flaeche, name) {
                const { id, quelle } = editor.werkzeugAn(sprache, flaeche, name);
                void seite.formen().vereinfachen.starte(id, quelle);
            },
            zerschneiden(sprache, flaeche, name) {
                const { quelle } = editor.sofortAn(sprache, flaeche, name);
                void seite.formen().zerschneiden.starte({ regionId: sprache, areaId: flaeche }, quelle);
            },
            mitAnderer(sprache, flaeche, name, operation) {
                const an = editor.sofortAn(sprache, flaeche, name);
                seite
                    .formen()
                    .mitAnderer.starte({ regionId: sprache, areaId: flaeche, name: an.name, operation }, an.quelle);
            },
            unterflaechen(sprache, flaeche, name, operation) {
                const { quelle } = editor.sofortAn(sprache, flaeche, name);
                const start = { regionId: sprache, areaId: flaeche };
                if (operation === "vereinigen") void seite.formen().unterflaechen.vereinige(start, quelle);
                else void seite.formen().unterflaechen.starte({ ...start, operation, punkt: griff }, quelle);
            },
            kopieren(sprache, flaeche) {
                seite.zeigeEditor();
                editor.zeigeFlaeche(sprache, flaeche, "kopieren");
            },
        }),
        anlegen: neueTeilflaecheEintrag(lage, gewaehlt, seite.gezeigt, (sprache, punkt) =>
            editor.zeichneFlaeche(sprache, punkt),
        ),
    };
}
