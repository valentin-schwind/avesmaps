import type { Map as MapLibreMap } from "maplibre-gl";
import { computed, watch, type ComputedRef } from "vue";
import { SEARCH_FIT_MAX_ZOOM } from "@avesmaps3d/shared";
import type { Werkzeugfenster } from "../editor-panel/werkzeugfenster";
import { GRUND_SPRACHE } from "../editor-menu/sonderrolle-grund";
import type { EditorSperre } from "../editor-sperre/sperre";
import type { ListenSchalter } from "../fenster/listen-schalter";
import { locale, t, type MessageKey } from "../i18n/i18n";
import type { Camera } from "../map/camera/camera";
import type { FlaechenQuelle, FlaechenSofort } from "../map/geometrie/flaechen-quelle";
import type { FormMeldung } from "../map/geometrie/formentwurf";
import { formHinweis } from "../map/geometrie/formentwurf-texte";
import { zeigeFrei } from "../map/geometrie/kamera";
import { installGeometrieModus } from "../map/geometrie/modus";
import type { NeueFlaecheAuftrag, NeueFlaecheStart } from "../map/geometrie/neue-flaeche";
import { ansichtFuerHinflug, type HinflugAnsicht } from "../map/hinflug-ansicht";
import type { MapInteractionCoordinator } from "../map/interaction/types";
import { installSprachVorschau, type SprachVorschau, type SprachVorschauKarte } from "../map/sprachen-vorschau";
import { startansicht } from "../map/start-view";
import { farbeGueltig, farbeNormal } from "./sprache-felder";
import { createSprachSperre, type SprachSperre } from "./sprach-sperre";
import { createSprachenDaten, type SprachenDaten } from "./sprachen-daten";
import { createSprachflaecheForm, ausKennung, laufKennung, type Sprachflaeche } from "./sprachflaeche-form";
import { sprachflaecheZeichnen } from "./sprachflaeche-neu";
import { zielSprachen, type SprachKopieAnbindung } from "./sprachflaeche-kopieren";
import { sprachflaecheSofort } from "./sprachflaeche-sofort";
import { createSprachflaechenWerkzeuge, type SprachflaecheBearbeitung } from "./sprachflaeche-werkzeuge";
import {
    createSpracheditorSteuerung,
    SPRACHEDITOR_WERKZEUG,
    type SprachErgebnis,
    type SpracheditorSteuerung,
} from "./spracheditor-steuerung";

/**
 * Der Spracheditor für die Seite (WI-0261 S5d2): Steuerung, geteilte Sperre, „Teilfläche bearbeiten“, „Neue Teilfläche“, die Vorschau der
 * Farbe und die Wege zu Karte und Kamera an EINER Stelle, damit `app.vue` nur einhängt (Hausregel „app.vue schmal“). Die Fenster und Leisten
 * zeichnet `spracheditor-seite.vue`, die Handgriffe im Kartenmenü `sprache-kartenmenue.ts`.
 *
 * - **Ein Klick in der Liste** wählt die Sprache, stellt die Karte ohne Flug auf Derographie › Sprachen (F17, T32, `ansichtFuerHinflug`) und
 *   lässt ihre Flächen leuchten (der Weg der Suche, S5c). Doppelklick und Enter fliegen dazu auf ihre Teilflächen.
 * - **„Teilfläche bearbeiten“** (Kartenmenü, WI-0261 Stufe 1) startet den gemeinsamen Formentwurf an einer Teilfläche (`sprachflaeche-form.ts`); er
 *   gehört zu den Entwürfen der Seite (`formentwuerfe` in `app.vue`): Esc, Strg+Z und Strg+Y gelten ihm, und nie laufen zwei Modi zugleich.
 * - **„Neue Teilfläche“** (Kartenmenü) geht über den einen Ablauf „Neue Fläche“ der Seite (`starteNeueFlaeche`); danach steht die neue Teilfläche
 *   gewählt im Reiter „Flächen“.
 * - **„Form ändern ›“** (Kartenmenü, WI-0261 Stufe 2): Verschieben, Malen, Radieren und Vereinfachen sind die Modi der Derographie; hier entsteht nur
 *   ihre Quelle (`werkzeugAn`, `sprachflaeche-werkzeuge.ts`). Sie und „Teilfläche bearbeiten“ hängen am EINEN Entwurf der Teilfläche; geschrieben
 *   liest das Fenster die Sprache nach, die Teilfläche bleibt gewählt. Ein Konflikt oder eine abgelaufene Sperre holt die Sprache ins Fenster: Dort
 *   stehen Konfliktkasten und Fuß an diesem Entwurf (`formBearbeitungVon`, EDIT-0003 §3b R1).
 * - **„Zerschneiden“, „Unterflächen ›“, „Mit anderer Fläche ›“** (Kartenmenü, WI-0261 Stufe 3): die sofort schreibenden Modi der Derographie mit der
 *   Teilfläche als Quelle (`sofortAn`, `sprachflaeche-sofort.ts`); geschrieben lesen die berührten Sprachen nach, die Teilfläche bleibt gewählt (G3).
 *   „Kopieren …“ ist das Blatt im Fenster (`zeigeFlaeche(…, "kopieren")`, `kopiere` der Steuerung).
 * - **Die Farbe im Entwurf** steht sofort auf der Karte (`map/sprachen-vorschau.ts`), solange das vorderste Sprachfenster sie anders hat als
 *   gespeichert und sie gültig ist.
 */

export interface SpracheditorSeite {
    readonly werkzeugfenster: Werkzeugfenster;
    readonly listenSchalter: ListenSchalter;
    /** Die EINE Sperre der Seite (EDIT-0003 §4). */
    readonly sperre: EditorSperre;
    /** Karte, Koordinator und Kamera, sobald die Karte bereit ist. */
    karte():
        { map: MapLibreMap; interaction: MapInteractionCoordinator; camera: Pick<Camera, "showBounds"> } | undefined;
    /** Geschrieben: die Kacheln der Sprachen mit dieser Revision neu. */
    geaendert(revision: number | undefined): void;
    readonly speicher?: Storage | undefined;
    /** Darf diese Sitzung Sprachen schreiben (Recht und `MAP_EDITING`)? */
    darfSchreiben(): boolean;
    /** Der eine Ablauf „Neue Fläche“ der Seite. */
    starteNeueFlaeche(auftrag: NeueFlaecheAuftrag): Promise<NeueFlaecheStart>;
    /** Die Ansicht der Karte, ohne Flug (`hinflugAnsicht` in `app.vue`). */
    ansicht(ziel: HinflugAnsicht): void;
    /** Die Flächen dieser Sprache leuchten (S5c). */
    leuchte(schluessel: string): void;
    /** Zum Kasten fliegen, in die Fläche neben dem Fenster des Spracheditors. */
    fliege(bounds: readonly [number, number, number, number]): void;
    /** Ein Hinweis unten (Toast). */
    melde(text: string, ton?: "warning" | "success"): void;
    /** Die Lasche „Editor“ nach vorn (ein Konflikt am Entwurf einer Teilfläche braucht das Fenster, R1). */
    zeigeEditor?(): void;
}

export interface SpracheditorFuerSeite extends SpracheditorSteuerung {
    readonly seite: SpracheditorSeite;
    readonly sperreDerSprachen: SprachSperre;
    /** „◇ Fläche bearbeiten“: der Formentwurf der Seite (in `formentwuerfe`). */
    readonly form: Sprachflaeche;
    /**
     * Läuft an einer Teilfläche ein Modus der Form („Teilfläche bearbeiten“ oder ein Werkzeug aus „Form ändern ›“)? Dann ruht die Leiste der Felder,
     * und das Fenster beginnt nichts an den Flächen.
     */
    readonly modusLaeuft: ComputedRef<boolean>;
    /**
     * Die Bearbeitung der Form einer Teilfläche dieser Sprache, solange ein Modus an ihr hängt oder ihr Ende noch aussteht: Konfliktkasten und Fuß
     * im Fenster der Sprache stehen an ihr (EDIT-0003 §3b R1).
     */
    formBearbeitungVon(spracheId: string | undefined): SprachflaecheBearbeitung | undefined;
    /** Ein Klick in der Liste: wählen, Ansicht, Leuchten. */
    waehleInListe(id: string | undefined, fensterId: string): void;
    /** Doppelklick und Enter in der Liste: zu allen Teilflächen der Sprache. */
    fliegeZu(id: string): void;
    /** Ein Klick auf eine Teilfläche: dorthin. */
    fliegeZuTeil(bbox: readonly [number, number, number, number]): void;
    /**
     * „Teilfläche bearbeiten“ (Kartenmenü): der Formentwurf an dieser Teilfläche. `name` ist der Name von der Karte, solange die Sprache noch nicht gelesen
     * ist; ist ein Sprachfenster offen, steht die Sprache dort mit der Teilfläche gewählt.
     */
    bearbeiteFlaeche(spracheId: string, flaecheId: string, name?: string): void;
    /**
     * „Form ändern ›“ (Kartenmenü, WI-0261 Stufe 2): die Kennung des Laufs und die Quelle für Verschieben, Malen, Radieren und Vereinfachen an dieser
     * Teilfläche. Name und Wahl im Fenster wie bei „Teilfläche bearbeiten“.
     */
    werkzeugAn(
        spracheId: string,
        flaecheId: string,
        name?: string,
    ): { readonly id: string; readonly quelle: FlaechenQuelle };
    /**
     * „Zerschneiden“, „Unterflächen ›“ und „Mit anderer Fläche ›“ (Kartenmenü, WI-0261 Stufe 3): die Quelle der sofort schreibenden Modi an dieser Teilfläche
     * (die Sprache ist ihr Objekt) und ihr Name in der Leiste. Name und Wahl im Fenster wie bei `werkzeugAn`.
     */
    sofortAn(
        spracheId: string,
        flaecheId: string,
        name?: string,
    ): { readonly name: string; readonly quelle: FlaechenSofort };
    /**
     * Das Ziel „Sprache“ im Blatt „Fläche kopieren“ der Derographie (WI-0261, „Ja, bauen“); `app.vue` gibt es mit `provide(SPRACH_KOPIE, …)` an das Blatt.
     * Geschrieben kommt die Lasche „Editor“ nach vorn, und der Hinweis nennt die Zielsprache.
     */
    readonly kopieAusLandschaft: SprachKopieAnbindung;
    /** „Neue Teilfläche“ (Kartenmenü): das Zeichnen über „Neue Fläche“ der Seite, `anfang` ist die erste Ecke (die Stelle des Menüs). */
    zeichneFlaeche(spracheId: string, anfang?: { x: number; y: number }): void;
    /** Ein Ergebnis als Hinweis: geschrieben mit `ok`, sonst der Satz. */
    meldeErgebnis(ergebnis: SprachErgebnis, ok: string): void;
}

/** Der Kasten um alle Teilflächen einer Sprache; ohne Teilfläche `undefined`. */
export function kastenUm(
    teile: readonly { readonly bbox: readonly [number, number, number, number] }[],
): [number, number, number, number] | undefined {
    if (teile.length === 0) return undefined;
    return [
        Math.min(...teile.map((teil) => teil.bbox[0])),
        Math.min(...teile.map((teil) => teil.bbox[1])),
        Math.max(...teile.map((teil) => teil.bbox[2])),
        Math.max(...teile.map((teil) => teil.bbox[3])),
    ];
}

export function createSpracheditorFuerSeite(
    seite: SpracheditorSeite,
    daten: SprachenDaten = createSprachenDaten(),
): SpracheditorFuerSeite {
    const sperreDerSprachen = createSprachSperre(seite.sperre);
    const steuerung = createSpracheditorSteuerung(seite.werkzeugfenster, daten, seite.listenSchalter, {
        sperre: sperreDerSprachen,
        lauf: seite.sperre.lauf,
        geaendert: (revision) => seite.geaendert(revision),
        speicher: seite.speicher,
        darfSchreiben: () => seite.darfSchreiben(),
    });
    const ansicht = (): void => seite.ansicht(ansichtFuerHinflug({ art: "sprache" }));

    const formText = (meldung: FormMeldung) => formHinweis(meldung, { ladefehler: "spracheditor.form.ladefehler" });
    // Der EINE Entwurf je Teilfläche (Stufe 2) für die Werkzeuge und „Teilfläche bearbeiten“: „Fertig“ schreibt `reshape`; geschrieben liest das
    // Fenster nach; ein Konflikt holt die Sprache ins Fenster, wo sein Kasten steht (R1).
    const werkzeuge = createSprachflaechenWerkzeuge({
        daten,
        sperre: sperreDerSprachen.halter(),
        werkzeug: SPRACHEDITOR_WERKZEUG,
        darf: () => seite.darfSchreiben(),
        geaendert: (revision) => seite.geaendert(revision),
        gespeichert(sprache) {
            void steuerung.nachlesen(sprache);
            steuerung.ladeListe();
        },
        konflikt(sprache, flaeche) {
            seite.zeigeEditor?.();
            steuerung.zeigeFlaeche(sprache, flaeche);
        },
        melde: (text, ton) => seite.melde(text, ton),
    });
    const form = createSprachflaecheForm({
        werkzeuge,
        fangradius: () => startansicht().fangradius,
        sperre: sperreDerSprachen.halter(),
        karte: {
            ein(eingabe) {
                const da = seite.karte();
                return da === undefined
                    ? undefined
                    : installGeometrieModus(da.map, da.interaction, { ...eingabe, werkzeug: SPRACHEDITOR_WERKZEUG });
            },
            zeige(teile) {
                const da = seite.karte();
                if (da !== undefined) zeigeFrei(da.map, da.camera, teile, SEARCH_FIT_MAX_ZOOM.landschaft);
            },
            // Geschrieben wird über die Bearbeitung; deren Karte lädt die Kacheln neu.
            geaendert: () => undefined,
        },
        gespeichert(name) {
            const { text, ton } = formText({ art: "gespeichert", name, mitgezogen: [] });
            seite.melde(text, ton);
        },
    });
    /** Das Fenster, dessen Liste der Modus eingezogen hat (wie bei den übrigen Formen: `listenSchalter.modus`). */
    let eingezogen: string | undefined;
    const stopLauf = watch(
        () => form.laufend.value?.id,
        (id) => {
            if (eingezogen !== undefined) seite.listenSchalter.modus(eingezogen, false);
            eingezogen = undefined;
            if (id === undefined) return;
            const sprache = ausKennung(id)?.sprache;
            eingezogen = steuerung.fenster.value.find((eintrag) => eintrag.gegenstand === sprache)?.id;
            if (eingezogen !== undefined) seite.listenSchalter.modus(eingezogen, true);
        },
    );
    // Was der Formentwurf meldet, steht als Hinweis da (Laden, fremde Sperre, verworfen); geschrieben meldet die Bearbeitung.
    const stopMeldung = watch(form.meldung, (meldung) => {
        if (meldung === undefined) return;
        const { text, ton } = formText(meldung);
        seite.melde(text, ton);
    });

    // --- Die Farbe im Entwurf auf der Karte ---
    let vorschauKarte: { map: MapLibreMap; vorschau: SprachVorschauKarte } | undefined;
    const vorschau = computed((): SprachVorschau | undefined => {
        const id = steuerung.vorderstes.value?.gegenstand;
        const bearbeitung = steuerung.bearbeitungVon(id);
        const d = bearbeitung?.detail.value;
        const farbe = bearbeitung?.stand.value?.felder.farbe;
        if (d === undefined || farbe === undefined || !farbeGueltig(farbe)) return undefined;
        const normal = farbeNormal(farbe);
        return normal === d.farbe ? undefined : { schluessel: d.schluessel, farbe: normal };
    });
    const stopVorschau = watch(vorschau, (jetzt) => {
        const map = seite.karte()?.map;
        if (map === undefined) return;
        if (vorschauKarte?.map !== map) {
            vorschauKarte?.vorschau.destroy();
            vorschauKarte = { map, vorschau: installSprachVorschau(map) };
        }
        vorschauKarte.vorschau.zeige(jetzt);
    });

    /** Zu allen Teilflächen; ist die Sprache noch nicht gelesen (Doppelklick gleich nach der Wahl), fliegt es, sobald sie da ist. */
    function fliegeZu(id: string): void {
        ansicht();
        const fliege = (teile: readonly { readonly bbox: readonly [number, number, number, number] }[]): void => {
            const kasten = kastenUm(teile);
            if (kasten !== undefined) seite.fliege(kasten);
        };
        const gelesen = steuerung.detailVon(id);
        if (gelesen !== undefined) {
            fliege(gelesen.teilflaechen);
            return;
        }
        const bearbeitung = steuerung.bearbeitungVon(id);
        if (bearbeitung === undefined) return;
        const stop = watch(
            () => bearbeitung.zustand.value.art,
            (art) => {
                if (art === "laedt") return;
                stop();
                const d = bearbeitung.detail.value;
                if (d !== undefined) fliege(d.teilflaechen);
            },
        );
    }

    /**
     * Vor einem Modus an einer Teilfläche: ihr Name in der Leiste („Garethi · Teilfläche 3“; `kartenName`, solange die Sprache noch nicht gelesen
     * ist), die Wahl im Fenster und die Ansicht. Liste und Karte synchron (D14): Ist ein Sprachfenster offen, steht dort diese Sprache mit der Teilfläche
     * gewählt, wie nach einem Klick auf sie (`geoeffnet`); geöffnet wird keins. Vorher folgte nur ein Fenster, das die Sprache schon trug: Ein Fenster
     * an einer anderen oder ohne Sprache blieb stehen („Keine Sprache gewählt“, Sichtprobe der Orchestrierung 2026-10-31).
     */
    function vorModus(spracheId: string, flaecheId: string, kartenName: string | undefined): string {
        const d = steuerung.detailVon(spracheId);
        const nummer = (d?.teilflaechen.findIndex((teil) => teil.id === flaecheId) ?? -1) + 1;
        const name = d?.name ?? kartenName ?? "";
        if (steuerung.vorderstes.value !== undefined) steuerung.zeigeFlaeche(spracheId, flaecheId);
        ansicht();
        return nummer > 0 ? t("spracheditor.form.objekt", { name, n: String(nummer) }) : name;
    }

    // Die sofort schreibenden Modi (Stufe 3): geschrieben die Kacheln, jede berührte Sprache nachlesen, die Liste; die Teilfläche bleibt gewählt, wo ein
    // Sprachfenster steht (wie vor dem Modus, `vorModus`).
    const sofortOptionen = {
        daten,
        sperre: sperreDerSprachen,
        werkzeug: SPRACHEDITOR_WERKZEUG,
        geschrieben(
            quittung: { mapRevision?: number | undefined; affected: readonly { kind: string; id: string }[] },
            sprache: string,
            flaeche: string,
        ) {
            seite.geaendert(quittung.mapRevision);
            for (const id of new Set(quittung.affected.filter((x) => x.kind === "sprache").map((x) => x.id)))
                void steuerung.nachlesen(id);
            steuerung.ladeListe();
            if (steuerung.vorderstes.value !== undefined) steuerung.zeigeFlaeche(sprache, flaeche);
        },
        melde: (text: string, ton: "warning" | "success") => seite.melde(text, ton),
        // „Unterfläche löschen …“ fragt im Fenster der Sprache nach (Betreiber 2026-10-31: „Ja, nachfragen“); die Lasche „Editor“ kommt dafür nach vorn.
        frageLoeschen(sprache: string, flaeche: string, teil: number): Promise<boolean> {
            seite.zeigeEditor?.();
            return steuerung.frageUnterflaeche({ sprache, flaeche, teil });
        },
    };

    const kopieAusLandschaft: SprachKopieAnbindung = {
        darf: () => seite.darfSchreiben(),
        sprachen: () => zielSprachen(steuerung.liste.value?.zeilen ?? [], "", locale.value),
        lade() {
            if (steuerung.liste.value === undefined) steuerung.ladeListe();
        },
        async kopiere(quelle, ziel) {
            const name =
                "neueSprache" in ziel
                    ? ziel.neueSprache.name
                    : (steuerung.liste.value?.zeilen.find((zeile) => zeile.id === ziel.targetId)?.name ?? "");
            const ergebnis = await steuerung.kopiereAusLandschaft(quelle, ziel);
            if (!ergebnis.ok) return ergebnis;
            // Das Fenster steht an der Zielsprache, also zeigt die Karte deren Ebene (sonst bliebe die Kopie unter „Alle“ unsichtbar; Sichtprüfung
            // 2026-10-31). Ohne Flug: Die Kopie liegt dort, wo die Derographie-Fläche lag.
            seite.zeigeEditor?.();
            ansicht();
            seite.melde(t("spracheditor.kopieren.kopiert", { name }), "success");
            return { ok: true };
        },
    };

    function meldeErgebnis(ergebnis: SprachErgebnis, ok: string): void {
        if (ergebnis.ok) seite.melde(ok, "success");
        else seite.melde(ergebnis.satz, "warning");
    }

    return {
        ...steuerung,
        seite,
        sperreDerSprachen,
        form,
        modusLaeuft: computed(() => form.laufend.value !== undefined || werkzeuge.laeuft.value !== undefined),
        formBearbeitungVon: (spracheId) => werkzeuge.bearbeitungVon(spracheId),
        waehleInListe(id, fensterId) {
            steuerung.waehle(id, fensterId);
            if (id === undefined) return;
            ansicht();
            const schluessel = steuerung.liste.value?.zeilen.find((z) => z.art === "sprache" && z.id === id);
            if (schluessel?.art === "sprache" && schluessel.aktiv) seite.leuchte(schluessel.schluessel);
        },
        fliegeZu,
        fliegeZuTeil(bbox) {
            ansicht();
            seite.fliege(bbox);
        },
        bearbeiteFlaeche(spracheId, flaecheId, kartenName) {
            void form.starteAn(spracheId, flaecheId, vorModus(spracheId, flaecheId, kartenName));
        },
        werkzeugAn: (spracheId, flaecheId, kartenName) => ({
            id: laufKennung(spracheId, flaecheId),
            quelle: werkzeuge.quelle(vorModus(spracheId, flaecheId, kartenName)),
        }),
        sofortAn(spracheId, flaecheId, kartenName) {
            const name = vorModus(spracheId, flaecheId, kartenName);
            const spracheName = steuerung.detailVon(spracheId)?.name ?? kartenName ?? "";
            return {
                name,
                quelle: sprachflaecheSofort(sofortOptionen, { id: spracheId, flaecheId, name, spracheName }),
            };
        },
        zeichneFlaeche(spracheId, anfang) {
            const d = steuerung.detailVon(spracheId);
            if (d === undefined) return;
            const andockung = sprachflaecheZeichnen({
                sprache: { id: d.id, name: d.name, revision: d.revision },
                daten,
                sperre: sperreDerSprachen,
                darf: (): MessageKey | undefined => (seite.darfSchreiben() ? undefined : GRUND_SPRACHE),
                // Die neue Teilfläche steht danach gewählt im Reiter „Flächen“ (WI-0261 Stufe 1).
                geoeffnet(sprache, flaeche) {
                    if (flaeche === "") steuerung.oeffneFuer(sprache);
                    else steuerung.zeigeFlaeche(sprache, flaeche);
                    void steuerung.nachlesen(sprache);
                    steuerung.ladeListe();
                },
            });
            void seite.starteNeueFlaeche({ andockung, anfang }).then((start) => {
                if (start !== "laeuft") seite.melde(t(start), "warning");
            });
        },
        meldeErgebnis,
        kopieAusLandschaft,
        destroy() {
            stopLauf();
            stopMeldung();
            stopVorschau();
            vorschauKarte?.vorschau.destroy();
            werkzeuge.destroy();
            form.destroy();
            steuerung.destroy();
            sperreDerSprachen.destroy();
        },
    };
}
