import type { Map as MapLibreMap, MapMouseEvent, MapTouchEvent } from "maplibre-gl";
import { AVENTURIA, fromRenderLngLat, toRenderLngLat } from "@avesmaps3d/shared";
import { INTERACTION_PRIORITY } from "../interaction/priorities";
import type { Claim, HitContext, InteractionOwner, MapInteractionCoordinator } from "../interaction/types";
import {
    anlegenStand,
    anlegenStart,
    anlegenTut,
    anlegenZiele,
    anlegenZielarten,
    DOPPELKLICK_MS,
    DOPPELKLICK_PX,
    istDoppelklick,
    naechsteLage,
    setze,
    wieder,
    zurueck,
    type AnlegenEingabe,
    type AnlegenEntwurf,
    type AnlegenModus,
    type AnlegenZeiger,
} from "./anlegen";
import { anlegenBild } from "./anlegen-bild";
import { ANDOCK_UMKREIS } from "./bild";
import type { Pixel, Punkt, Treffer, Ziel } from "./geometrie";
import { belegeGeometrie, meldeGeometrieAn } from "./besitzer";
import { hebeKlicktoleranz } from "./klicktoleranz";
import { andockziele, einrasten } from "./rechnung";
import { installGeometrieSchicht } from "./schicht";

/**
 * Der Modus „Anlegen“ auf der Karte (Schnittstelle und Gesten im Kopf von `anlegen.ts`): der EINE Besitzer `geometry-edit` im
 * Koordinator, solange gezeichnet wird. Ihm gehören Zeigen, Klick und Rechtsklick auf der ganzen Karte; ein Druck bleibt bei der Karte,
 * Ziehen schiebt sie wie sonst (erst ab der höheren Klicktoleranz, `klicktoleranz.ts`). Die Doppelklick-Zoomung ruht, solange der
 * Modus läuft; den Doppelklick zählt der Modus selbst (der Koordinator verteilt Klicks).
 *
 * Läuft schon ein Modus des Moduls, beginnt das Anlegen nicht (`undefined`, Hinweis aus `besitzer.ts`). Solange einer läuft, heißt Strg „rastet
 * nicht ein“ und dreht die Karte nicht (`besitzer.ts`).
 *
 * 🪤 Nach dem Ende hält der Besitzer den Klick noch einen Doppelklick lang an derselben Stelle: Beendet der erste Klick eines
 * Doppelklicks am Ziel (Ort), träfe der zweite sonst den Ort und öffnete seine Eigenschaften (P5 „ruhe“).
 */

/** Ein Klick so nah am letzten Punkt setzt nichts (P5: „px(3)“). */
const NAH_PX = 3;

const space = AVENTURIA.coordinateSpace;
const lngLat = (p: Punkt): [number, number] => {
    const render = toRenderLngLat(space, p);
    return [render.lng, render.lat];
};

const strgGedrueckt = (event: MapMouseEvent | MapTouchEvent): boolean =>
    "ctrlKey" in event.originalEvent && (event.originalEvent.ctrlKey || event.originalEvent.metaKey);

export function installAnlegenModus(
    map: MapLibreMap,
    interaction: MapInteractionCoordinator,
    eingabe: AnlegenEingabe,
): AnlegenModus | undefined {
    const belegung = belegeGeometrie();
    if (belegung === undefined) return undefined;
    const { art } = eingabe;
    const schicht = installGeometrieSchicht(map);
    const schirm = (p: Punkt): Pixel => map.project(lngLat(p));
    let entwurf: AnlegenEntwurf = anlegenStart(eingabe.anfang);
    let zeiger: { roh: Punkt; at: Punkt; treffer: Treffer | undefined; andock: Ziel[]; schirm: Pixel } | undefined;
    let gesperrt = false;
    let aktiv = true;
    let letzterKlick: { zeit: number; at: Pixel } | undefined;
    const zoomVorher = map.doubleClickZoom.isEnabled();
    map.doubleClickZoom.disable();
    const toleranzZurueck = hebeKlicktoleranz(map);

    // Mit gehaltener Leertaste (`einzeln`) ist jeder Druck ein Punkt, auch wenn die Hand beim schnellen Klicken weiterzieht (Kopf von `anlegen.ts`). Das Schieben
    // ist dann gesperrt, aber MapLibre prüft die Toleranz trotzdem und verwarf den Klick; für diesen Druck gilt sie nicht.
    let druckOhneToleranz: (() => void) | undefined;
    const druck = (): void => {
        druckOhneToleranz?.();
        druckOhneToleranz = eingabe.einzeln?.() === true ? hebeKlicktoleranz(map, Infinity) : undefined;
    };
    map.on("mousedown", druck);

    // 🔴 Das Zeigen läuft in jedem Bild, und die Ziele eines Ausschnitts gehen in die Zehntausende (Stage: 43.000 bei Zoom 5, Vegetation). Vorher wurde bei jeder
    // Mausbewegung neu gefiltert und neu umgerechnet: 0,45 s je Bewegung bei 20 Ecken, 0,8 s bei 40 (WI-0283 §7). Beides gilt, bis sich Entwurf, Ziele oder Karte ändern.
    let gefiltert: { entwurf: AnlegenEntwurf; quelle: readonly Ziel[]; ziele: readonly Ziel[] } | undefined;
    const zieleJetzt = (): readonly Ziel[] => {
        const quelle = eingabe.ziele();
        if (gefiltert?.entwurf !== entwurf || gefiltert.quelle !== quelle)
            gefiltert = { entwurf, quelle, ziele: anlegenZiele(art, entwurf, quelle) };
        return gefiltert.ziele;
    };
    const lagen = new Map<Punkt, Pixel>();
    const zielSchirm = (p: Punkt): Pixel => {
        let lage = lagen.get(p);
        if (lage === undefined) {
            lage = schirm(p);
            lagen.set(p, lage);
        }
        return lage;
    };
    const lagenVergessen = (): void => lagen.clear();
    // Mit Gelände hängt die Lage auch an den Höhenkacheln.
    const nachQuelle = (event: { sourceId?: string }): void => {
        if (event.sourceId !== undefined && event.sourceId === map.getTerrain()?.source) lagenVergessen();
    };
    map.on("move", lagenVergessen);
    map.on("terrain", lagenVergessen);
    map.on("sourcedata", nachQuelle);

    const loest = (event: MapMouseEvent | MapTouchEvent): boolean => art.loesen !== false && strgGedrueckt(event);

    /** Wo ein Klick an dieser Stelle den Punkt setzte, und woran er einrastete. */
    function suche(
        punkt: Pixel,
        roh: Punkt,
        strg: boolean,
    ): { at: Punkt; treffer: Treffer | undefined; andock: Ziel[] } {
        const ziele = zieleJetzt();
        const erlaubt = strg ? [] : anlegenZielarten(art, entwurf);
        const treffer = einrasten(punkt, ziele, erlaubt, eingabe.fangradius(), zielSchirm);
        const andock = andockziele(punkt, ziele, erlaubt, eingabe.fangradius() * ANDOCK_UMKREIS, zielSchirm);
        return { at: treffer?.at ?? roh, treffer, andock };
    }

    const zeichne = (): void => {
        if (!aktiv) return;
        schicht.zeige(
            anlegenBild(
                art,
                {
                    entwurf,
                    zeiger: gesperrt ? undefined : zeiger?.at,
                    treffer: gesperrt ? undefined : zeiger?.treffer,
                    rastet: !gesperrt && zeiger !== undefined && anlegenZielarten(art, entwurf).length > 0,
                    andock: gesperrt ? [] : (zeiger?.andock ?? []),
                },
                eingabe.fangradius(),
            ),
        );
    };

    let gemeldet: AnlegenZeiger | undefined;
    const meldeZeiger = (): void => {
        const neu: AnlegenZeiger | undefined =
            zeiger?.treffer !== undefined && !gesperrt
                ? {
                      treffer: zeiger.treffer,
                      lage: naechsteLage(entwurf),
                      tut: anlegenTut(art, entwurf, zeiger.treffer.ziel),
                      schirm: schirm(zeiger.treffer.at),
                  }
                : undefined;
        const gleich =
            neu?.treffer.ziel.objekt === gemeldet?.treffer.ziel.objekt &&
            neu?.treffer.at.x === gemeldet?.treffer.at.x &&
            neu?.treffer.at.y === gemeldet?.treffer.at.y &&
            neu?.lage === gemeldet?.lage &&
            neu?.tut === gemeldet?.tut;
        if (
            gleich &&
            (neu === undefined || (neu.schirm.x === gemeldet?.schirm.x && neu.schirm.y === gemeldet.schirm.y))
        )
            return;
        gemeldet = neu;
        eingabe.zeiger?.(neu);
    };

    const geaendert = (): void => {
        // Nach einem neuen Punkt gilt der Zeiger neu: anderes Ziel, andere Lage, andere Ausschlüsse.
        if (zeiger !== undefined) {
            const punkt = zeiger.schirm;
            zeiger = { ...zeiger, ...suche(punkt, zeiger.roh, false) };
        }
        zeichne();
        meldeZeiger();
        eingabe.stand(anlegenStand(art, entwurf));
    };

    function fertig(): void {
        if (!aktiv || gesperrt) return;
        const grund = art.pruefe(entwurf.punkte.map((p) => p.at));
        if (grund !== undefined) {
            eingabe.abgewiesen(grund);
            return;
        }
        eingabe.fertig(entwurf.punkte);
    }

    function klick(context: HitContext): void {
        const jetzt = performance.now();
        const vorher = letzterKlick;
        letzterKlick = { zeit: jetzt, at: context.point };
        if (!aktiv || gesperrt) return;
        // Mit `einzeln` (gehaltene Leertaste bei „Neue Fläche“) ist jeder Klick eine Ecke, nie das Ende eines Doppelklicks.
        const doppelt = istDoppelklick(vorher, jetzt, context.point, eingabe.einzeln?.() === true);
        if (doppelt) {
            letzterKlick = undefined;
            if (entwurf.punkte.length >= art.mindestens) fertig();
            return;
        }
        const letzter = entwurf.punkte.at(-1);
        if (letzter !== undefined) {
            const da = schirm(letzter.at);
            if (Math.hypot(da.x - context.point.x, da.y - context.point.y) < NAH_PX) return;
        }
        const roh = fromRenderLngLat(space, context.lngLat);
        const gefunden = suche(context.point, roh, loest(context.event));
        const ergebnis = setze(art, entwurf, gefunden.at, gefunden.treffer);
        if (ergebnis === undefined) return;
        entwurf = ergebnis.entwurf;
        geaendert();
        if (ergebnis.beenden) fertig();
    }

    function zeige(context: HitContext): void {
        const roh = fromRenderLngLat(space, context.lngLat);
        zeiger = { roh, schirm: context.point, ...suche(context.point, roh, loest(context.event)) };
        zeichne();
        meldeZeiger();
    }

    const owner: InteractionOwner<Claim> = {
        id: "geometry-edit",
        priority: INTERACTION_PRIORITY["geometry-edit"],
        kinds: ["hover", "click", "contextmenu"],
        layers: () => [],
        // Nach dem Ende nur noch der zweite Klick eines Doppelklicks an derselben Stelle (Kopf oben).
        hit(context) {
            if (aktiv) return { cursor: "crosshair" };
            const vorher = letzterKlick;
            const nah =
                context.kind === "click" &&
                vorher !== undefined &&
                performance.now() - vorher.zeit <= DOPPELKLICK_MS &&
                Math.hypot(context.point.x - vorher.at.x, context.point.y - vorher.at.y) <= DOPPELKLICK_PX;
            return nah ? {} : undefined;
        },
        apply(kind, _claim, context) {
            if (!aktiv) {
                letzterKlick = undefined;
                return;
            }
            if (kind === "hover") zeige(context);
            else if (kind === "click") klick(context);
            // Rechtsklick und langer Druck: der letzte Punkt zurück, ohne Menü (T24 (4)).
            else if (kind === "contextmenu" && !gesperrt) {
                context.event.preventDefault();
                modus.zurueck();
            }
        },
        lost(reason) {
            if (reason !== "hover-ended" || zeiger === undefined) return;
            zeiger = undefined;
            zeichne();
            meldeZeiger();
        },
    };

    const anmeldung = meldeGeometrieAn(interaction, owner);
    const modus: AnlegenModus = {
        zurueck() {
            if (!aktiv || gesperrt) return;
            const neu = zurueck(entwurf);
            if (neu === entwurf) return;
            entwurf = neu;
            geaendert();
        },
        wieder() {
            if (!aktiv || gesperrt) return;
            const neu = wieder(entwurf);
            if (neu === entwurf) return;
            entwurf = neu;
            geaendert();
        },
        verwerfen() {
            if (!aktiv || gesperrt) return;
            entwurf = anlegenStart(eingabe.anfang);
            geaendert();
        },
        fertig,
        sperre(an) {
            gesperrt = an;
            zeichne();
            meldeZeiger();
        },
        aktualisiere() {
            geaendert();
        },
        entwurf: () => entwurf,
        aus() {
            if (!aktiv) return;
            aktiv = false;
            gemeldet = undefined;
            eingabe.zeiger?.(undefined);
            schicht.entferne();
            belegung.frei();
            map.off("mousedown", druck);
            map.off("move", lagenVergessen);
            map.off("terrain", lagenVergessen);
            map.off("sourcedata", nachQuelle);
            druckOhneToleranz?.();
            toleranzZurueck();
            if (zoomVorher) map.doubleClickZoom.enable();
            // Den zweiten Klick eines Doppelklicks noch halten (Kopf oben), dann abmelden.
            anmeldung.nachlaufen(DOPPELKLICK_MS);
        },
    };
    geaendert();
    return modus;
}
