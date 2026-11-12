<script setup lang="ts">
import KontextEintraege from "./kontext-eintraege.vue";
import SperrKasten from "./sperr-kasten.vue";
import { computed, inject, nextTick, onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch } from "vue";
import { t, type MessageKey } from "../i18n/i18n";
import type { EditorAbschnitt, EditorEintrag, SperrKastenInhalt } from "../editor-menu/kartenmenue";
import { ESCAPE_CASCADE_KEY } from "../keyboard/escape-cascade";
import { merkliste } from "../photobox/meine-reisebilder";
import WaypointMark from "../route-planner/waypoint-mark.vue";
import { dropBox, MARK_SIZE } from "../route-planner/waypoint-mark-shape";
import {
    MENU_OFFSET,
    menuPlacement,
    zweiKartenLage,
    type MenuPlacement,
    type ZweiKartenLage,
} from "./map-context-placement";

/**
 * Das Kontextmenü der Karte (Legacy `#map-context-menu`, Betreiber 2026-09-24: „beginne mit dem
 * Kontextmenü, Rechtsklick ‚Hierhin reisen‘“). Rechtsklick am Rechner, langer Druck am Finger.
 *
 * - **Legacys Einträge, Legacys Bilder, Legacys Reihenfolge.** Was es in Avesmaps3D noch nicht gibt,
 *   steht gesperrt da - wie im Kartenfächer (Betreiber 2026-09-23: „grau aus, was es noch nicht bei
 *   uns gibt“). Gesperrt heißt blass und ohne Wirkung, mit dem Grund als Hinweis.
 * - **Eine Hand voll Regeln:** Esc schließt (über die Kaskade, `keyboard/escape-cascade.ts`, Stufe „menus“: das Menü
 *   schließt, ohne die Auswahl aufzuheben), ein Klick daneben schließt, jede Kartenbewegung schließt. Die Pfeiltasten wandern
 *   durch die Einträge, Enter wählt.
 * - **„Was ist hier?“ geht** (WI-0063 P5): Es öffnet den Kartenpunkt im Infopanel (`mapPoint`, 4.9).
 * - **„Entfernung messen“ geht** (WI-0095, Finding MCS-030): Der Eintrag setzt den ersten Punkt der Messung;
 *   darunter steht „Entfernungsmessung löschen“, aber nur, solange es eine gibt - wie in Legacy.
 * - **Die zweite Zeile hängt daran, WORAUF geklickt wurde** (WI-0100, Betreiber 2026-10-07): „‚Hierher reisen‘ ist
 *   ein klick auf der freien fläche (‚Kartenpunkt bei …‘) · ‚Ziel hinzufügen‘ fügt einen ort hinzu (wie ‚Reiseziel
 *   hinzufügen‘) · das eine ersetzt das andere wenn ich auf einen ort geklickt hat.“ 🔴 Es sind **zwei** Einträge an
 *   **einer** Stelle, und immer steht genau einer: auf der freien Fläche „Hierher reisen“ mit Legacys Stiefel, auf
 *   einem Ort „Ziel hinzufügen“ mit dem **gezeichneten Tropfen**. Das ist das ECHTE Zeichen, kein neues Bild
 *   daneben (dieselbe Vorgabe wie an den Marken selbst, Betreiber 2026-10-05: „übernimm doch nicht die bilder
 *   sondern direkt die symbole von oben“); ein Eintrag trägt deshalb entweder `icon` oder `mark`, nie beides.
 *   🪤 Auf einem Ort steht damit EIN gezeichnetes Zeichen unter fünf gemalten; der Design Guide führte die
 *   illustrierten Symbole des Kontextmenüs als `CANON` (§1 „Wo Fantasy erlaubt ist“) - die Ausnahme ist die
 *   Entscheidung des Betreibers, nicht unsere.
 * - **Die Abschnitte für Editoren obenauf** (WI-0128 E15, Gesamtmockup Version 7; EDIT-0002 §6 Nr. 3): am Objekt „Bearbeiten · nur
 *   Editoren“ mit seinen Handgriffen aus dem Register (`editor-menu/kartenmenue.ts`, mehr als fünf hinter EINEM Eintrag „… ›“ mit
 *   Zwischenüberschriften), darunter in jedem Menü „Anlegen“ mit „Hier hinzufügen ›“ und darin dem Untermenü (Betreiber 2026-10-11, „wie
 *   in legacy“). Das Menü kennt keine Objektart, es zeigt fertige Zeilen: Legacy `.map-context-submenu` (`css/components/map-context-menu.css:450-505`) geht rechts neben dem Eintrag auf,
 *   eine Rahmenbreite höher, beim Zeigen und mit dem Fokus; am Telefon (bis 640 px) steht es darunter im Menü. Hier dazu: ein Klick
 *   oder Tippen öffnet es (Tippen gibt einem Knopf nicht überall den Fokus), → hinein, ← zurück, und ist rechts kein Platz, geht es
 *   links auf. Sie tragen abstrakte Zeichen statt gemalter Bilder (Editor-Stil) und stehen nur,
 *   wenn `app.vue` sie reicht (Editor-Modus mit Recht).
 * - **Zwei Karten** (EDIT-0003 R7, T27 (4); WI-0178 A4): Die Abschnitte für Editoren stehen als eigene Karte ÜBER dem Punkt, Legacys
 *   Einträge als Karte der Besucher darunter, 12 px dazwischen (`zweiKartenLage`). Ohne Abschnitte für Editoren bleibt es EINE Karte
 *   12 / 10 px neben dem Punkt wie bisher. Beide Karten sind ein Menü: Die Pfeile wandern durch beide, ein Klick in eine von ihnen
 *   schließt nichts, Esc und ein Klick daneben schließen beide.
 * - **Ein Zeiger am Druckpunkt, das Menü daneben** (WI-0108 Nachtrag, Betreiber 2026-10-11: „ja in legacy gibt es auch beim
 *   rechtsklick auf die karte einen kleinen marker, der andeutet wo man auf die karte geklickt/getappt hat - du kannst auch einen
 *   kleinen zeiger |\ bauen und das menü mit einem kleinen offset daneben aufgehen lassen“; nach dem ersten Blatt: „ok pfeil
 *   sieht komisch aus, kannst du anstatt des pfeils ein gefülltes crosshair mit rotem punkt in der mitte probieren?“). Ein
 *   Fadenkreuz mit der Mitte genau auf dem Punkt, das Menü knapp daneben (12 / 10 px, `map-context-placement.ts`), mit Maus und
 *   Finger gleich; am Rand klappt das Menü um, das Fadenkreuz bleibt am Punkt. Es geht mit dem Menü. Der rote Punkt ist Legacys
 *   Marker (`.map-context-anchor-marker__dot`, `css/components/map-context-menu.css:480-495`): Füllung `danger`, heller Rand,
 *   dunkler Saum, weicher Schatten.
 */

export type MapContextAction =
    | "what-is-here"
    | "travel-here"
    | "add-destination"
    | "report"
    | "photobox"
    | "meine-reisebilder"
    | "nearest"
    | "search"
    | "measure"
    | "measure-clear"
    | "screenshot";

interface Entry {
    action: MapContextAction;
    label: MessageKey;
    /** Legacys gemaltes Symbol unter `/icons/context/`. Genau eines von `icon` und `mark`. */
    icon?: string;
    /** Das gezeichnete Zeichen der Wegpunktmarke statt eines Bildes - die Rolle, die es tragen soll. */
    mark?: "wegpunkt" | "ziel";
    /** Warum es (noch) nicht geht; ohne Grund ist der Eintrag bedienbar. */
    blocked?: MessageKey;
    /**
     * Der Eintrag steht nur, solange eine Messung läuft (Legacy `syncDistanceMeasurementContextMenuAction`:
     * `clearButton.hidden = !hasDistanceMeasurement()`). Ohne Angabe steht er immer.
     */
    whileMeasuring?: true;
    /**
     * Worauf geklickt wurde: `place` nur über einem Ort, `point` nur über der freien Fläche. Ohne Angabe steht der
     * Eintrag über beidem. Die zwei Reiseeinträge teilen sich so EINE Zeile, ohne eine zweite anzulegen.
     */
    on?: "place" | "point";
    /** Der Eintrag steht nur in der Standardansicht (Reisebilder, WI-0272: Vali „die photobox erscheint nur im standard-karten-modus“). */
    nurStandard?: true;
    /** Der Eintrag steht nur, solange dieses Gerät mindestens einen Link gemerkt hat („Meine Reisebilder“, WI-0272 Entwurf 9). */
    nurGemerkt?: true;
}

const ICONS = "/icons/context/";
const MENU_ICONS = "/icons/menu/";
const ENTRIES: readonly Entry[] = [
    { action: "what-is-here", label: "ctxmenu.whatIsHere", icon: `${ICONS}wegweiser.webp` },
    // 🔴 Dieselbe Zeile, zwei Einträge (WI-0100): freie Fläche gegen Ort. Legacys Stiefel bleibt dort, wo Legacy ihn hat.
    { action: "travel-here", label: "ctxmenu.travelHere", icon: `${ICONS}schuh.webp`, on: "point" },
    { action: "add-destination", label: "ctxmenu.addDestination", mark: "ziel", on: "place" },
    // „Hier etwas melden“ öffnet das Meldeformular der Besucher mit der Stelle als Bezug (WI-0268 C2; vorher gesperrt, WI-0063).
    { action: "report", label: "ctxmenu.report", icon: `${ICONS}brief.webp` },
    // „Eigenes Bild hinzufügen“ (WI-0272 S2b, Vali 2026-10-31): das Formular der Reisebilder mit der Stelle. Nur in der Standardansicht; das gemalte Bild fehlt noch (Auftrag an die Bildgestaltung).
    { action: "photobox", label: "ctxmenu.photobox", icon: `${ICONS}bildmachen.webp`, nurStandard: true },
    // „Meine Reisebilder“ (WI-0272 Entwurf 9, Vali 2026-11-01): die Einreichungen, deren Link dieses Gerät gemerkt hat. Wie „Eigenes Bild hinzufügen“ nur in der Standardansicht, dazu nur mit Gemerktem.
    {
        action: "meine-reisebilder",
        label: "ctxmenu.meineReisebilder",
        icon: `${MENU_ICONS}kartensammlung.webp`,
        nurStandard: true,
        nurGemerkt: true,
    },
    { action: "nearest", label: "ctxmenu.nearest", icon: `${ICONS}fernrohr.webp` },
    { action: "search", label: "ctxmenu.search", icon: `${ICONS}lupe.webp` },
    // Das Messwerkzeug (WI-0095): zwei Einträge mit demselben Bild, wie Legacy - der zweite nur, wenn es etwas zu löschen gibt.
    { action: "measure", label: "ctxmenu.measure", icon: `${ICONS}lineal.webp` },
    {
        action: "measure-clear",
        label: "ctxmenu.measureClear",
        icon: `${ICONS}lineal.webp`,
        whileMeasuring: true,
    },
    // „Screenshot machen“ (WI-0274, Entwurf Fassung 5): öffnet die Auswahl mittig (`screenshot/karten-screenshot.vue`). Das Bild ist
    // aus dem Entwurf gezeichnet, ein gemaltes fehlt.
    { action: "screenshot", label: "ctxmenu.screenshot", icon: `${ICONS}screenshot.svg` },
];

/**
 * Legacys Bildkante im Kartenmenü: **18 px** (`css/components/map-context-menu-icons.css`, `background-size: contain`,
 * `justify-self: center`) - dieselbe Zahl steht unten an `.context-menu__icon`.
 */
const ICON_SIZE = 18;

/**
 * 🔴 **Die Nadel ist höher als breit** - `dropBox(MARK_SIZE)` sind 14 × 24 px gegen 18 × 18 px der gemalten Nachbarn.
 * Ungebremst stünde ihre Zeile 6 px höher als die anderen sechs. Sie wird deshalb auf die **Bildhöhe** ihrer Nachbarn
 * gestellt: 18 von 24.
 *
 * 🪤 **Das ist ausdrücklich KEIN `size`-Parameter am Bauteil.** WI-0097 hat ihn entfernt, damit aus EINEM Zeichen nicht
 * wieder zwei Größen werden (Betreiber 2026-10-07: „die icons der wegpunktmarkierung und der tropfen sollten im
 * routenplaner und bei den etappen gleich groß sein“). `MARK_SIZE` bleibt die eine Größe; hier steht nur, wie DIESE
 * Stelle sie darstellt - und wächst `MARK_SIZE`, wächst der Teiler mit, der Deckel bleibt Legacys Bildkante.
 */
const markScale = String(ICON_SIZE / dropBox(MARK_SIZE).height);

const props = defineProps<{
    /** Wo das Menü aufgeht, in Fensterkoordinaten - oder zu. */
    at: { x: number; y: number } | null;
    /** Läuft gerade eine Entfernungsmessung? Dann steht „Entfernungsmessung löschen“ dabei. */
    measuring?: boolean;
    /**
     * Liegt unter dem Rechtsklick ein ORT? Dann steht „Ziel hinzufügen“ statt „Hierher reisen“ (WI-0100).
     * Das Menü braucht den Ort selbst nicht: Es trägt keinen Kopf, und wer gemeint ist, weiß `app.vue`.
     */
    atPlace?: boolean;
    /** Die Abschnitte für Editoren obenauf (E15, O1); ohne sie steht das Menü wie bisher. */
    editor?: readonly EditorAbschnitt[] | undefined;
    /**
     * Die Form „nur Editor-Karte“ (Festlegung der Editor-Orchestrierung 2026-10-17, EDIT-0003 R7): am Griff eines laufenden Modus
     * stehen nur die Handgriffe des Griffs, ohne die Karte der Besucher; die Karte der Editoren steht dann wie eine einzelne neben dem
     * Punkt. Erster Nutzer: Stützpunkte der Wegkurve (WI-0177).
     */
    nurEditor?: boolean;
    /** Ist die Standardansicht der Karte gewählt? Nur dort steht „Eigenes Bild hinzufügen“ (Reisebilder, WI-0272). */
    standardAnsicht?: boolean;
}>();

/** Hat dieses Gerät mindestens ein Reisebild gemerkt? Ohne Browserspeicher nie. */
const gemerkt = computed(() => merkliste.eintraege.value.length > 0);
const entries = computed(() =>
    ENTRIES.filter(
        (entry) =>
            (entry.whileMeasuring !== true || props.measuring === true) &&
            (entry.on === undefined || entry.on === (props.atPlace === true ? "place" : "point")) &&
            (entry.nurStandard !== true || props.standardAnsicht === true) &&
            (entry.nurGemerkt !== true || gemerkt.value),
    ),
);
const emit = defineEmits<{
    choose: [action: MapContextAction];
    /** Ein Eintrag aus den Abschnitten für Editoren. */
    edit: [id: string];
    /** „Sperre aufheben …“ im Kasten zur Sperre, bestätigt (nur Admins, EDIT-0003 §4). */
    aufheben: [ziel: SperrKastenInhalt["ziel"]];
    /** „Freigabe erbitten“ im Kasten zur Sperre (WI-0262); das Menü bleibt offen, der Kasten zeigt den Stand. */
    bitten: [ziel: SperrKastenInhalt["ziel"]];
    /** Ein Eintrag mit Vorschau wird gezeigt oder nicht mehr; ein Untermenü geht auf oder zu (`kontext-eintraege.vue`). */
    vorschau: [eintrag: string | undefined, unter: string | undefined];
    close: [];
}>();
/** Was die Karte der Editoren gerade zeigt: das offene Untermenü und den gezeigten Eintrag darin. */
const vorschau: { unter: string | undefined; eintrag: string | undefined } = { unter: undefined, eintrag: undefined };
function zeigeEintrag(eintrag: string | undefined): void {
    vorschau.eintrag = eintrag;
    emit("vorschau", vorschau.eintrag, vorschau.unter);
}
function zeigeUnter(unter: string | undefined): void {
    vorschau.unter = unter;
    if (unter === undefined) vorschau.eintrag = undefined;
    emit("vorschau", vorschau.eintrag, vorschau.unter);
}

const menu = useTemplateRef<HTMLDivElement>("menu");
/** Die Karte der Editoren über dem Punkt (A4); ohne Abschnitte für Editoren gibt es sie nicht. */
const karte = useTemplateRef<HTMLDivElement>("karte");
const mitEditor = computed(() => props.editor !== undefined && props.editor.length > 0);

/**
 * Wo das Menü steht: gemessen und ins Fenster gelegt (`placeInside`), bis dahin mit dem Versatz rechts unter dem Punkt.
 * 🪤 Reaktiv, nicht über `element.style`: Jedes neue Rendern setzt die gebundene Lage wieder, und der gespiegelte Zeiger
 * rendert das Bauteil neu - eine von Hand gesetzte Lage ginge dabei verloren.
 */
const platz = shallowRef<MenuPlacement | null>(null);
/** Die Lage beider Karten, solange es die der Editoren gibt. */
const zweiLage = shallowRef<ZweiKartenLage | null>(null);
/** In der Form „nur Editor-Karte“: die Lage der einen Karte neben dem Punkt. */
const einzelLage = shallowRef<MenuPlacement | null>(null);
const px = (lage: { left: number; top: number }) => ({ left: `${String(lage.left)}px`, top: `${String(lage.top)}px` });
const position = computed(() => {
    if (!props.at) return {};
    if (zweiLage.value) return px(zweiLage.value.besucher);
    const left = platz.value?.left ?? props.at.x + MENU_OFFSET.x;
    const top = platz.value?.top ?? props.at.y + MENU_OFFSET.y;
    return px({ left, top });
});
/** Bis gemessen ist, steht die Karte der Editoren unsichtbar rechts über dem Punkt. */
const editorPosition = computed(() => {
    if (!props.at) return {};
    if (einzelLage.value) return px(einzelLage.value);
    const hoehe = zweiLage.value?.editorHoehe;
    if (zweiLage.value)
        return { ...px(zweiLage.value.editor), ...(hoehe === undefined ? {} : { maxHeight: `${String(hoehe)}px` }) };
    return { ...px({ left: props.at.x + MENU_OFFSET.x, top: props.at.y }), visibility: "hidden" as const };
});

/**
 * Das Fadenkreuz, Mitte (0, 0) genau auf dem Punkt: ein Ring (Radius 7,5), vier Striche nach außen bis 12 und in der Mitte ein
 * gefüllter roter Punkt (Radius 3,5) wie Legacys Marker. 24 px im Durchmesser; Legacys Marker misst 20, das Menü beginnt 12 / 10 px
 * neben dem Punkt und damit neben Ring und Strichen. Symmetrisch: Es muss nicht mitklappen.
 */
const KREUZ_RAND = 13;
const KREUZ_RING = 7.5;
const KREUZ_STRICH = 12;
const KREUZ_PUNKT = 3.5;
const KREUZ_STRICHE = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
].map(
    ([x = 0, y = 0]) =>
        `M${String(x * KREUZ_RING)} ${String(y * KREUZ_RING)} L${String(x * KREUZ_STRICH)} ${String(y * KREUZ_STRICH)}`,
);
const KREUZ_BOX = `${String(-KREUZ_RAND)} ${String(-KREUZ_RAND)} ${String(KREUZ_RAND * 2)} ${String(KREUZ_RAND * 2)}`;
const zeigerLage = computed(() => {
    if (!props.at) return {};
    return { left: `${String(props.at.x - KREUZ_RAND)}px`, top: `${String(props.at.y - KREUZ_RAND)}px` };
});

async function placeInside(): Promise<void> {
    await nextTick();
    const element = menu.value;
    const fenster = { width: globalThis.innerWidth, height: globalThis.innerHeight };
    const oben = karte.value;
    // „Nur Editor-Karte“: Sie steht wie eine einzelne Karte neben dem Punkt.
    if (props.at && oben && !element) {
        einzelLage.value = menuPlacement(props.at, oben.getBoundingClientRect(), fenster);
        await nextTick();
        oben.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
        return;
    }
    if (!element || !props.at) return;
    const box = element.getBoundingClientRect();
    if (oben) {
        // Die natürliche Höhe, auch wenn die Karte gerade rollt: Sonst passte sie beim nächsten Messen scheinbar.
        const kasten = oben.getBoundingClientRect();
        const rand = oben.offsetHeight - oben.clientHeight;
        const natuerlich = { width: kasten.width, height: Math.max(kasten.height, oben.scrollHeight + rand) };
        zweiLage.value = zweiKartenLage(props.at, natuerlich, box, fenster);
        // Erst sichtbar, dann der Fokus: Eine verborgene Karte nimmt ihn nicht an.
        await nextTick();
        oben.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
        return;
    }
    platz.value = menuPlacement(props.at, box, fenster);
    element.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
}

/** Liegt das Ziel in einer der zwei Karten? */
const imMenue = (ziel: Node | null): boolean =>
    ziel !== null && (menu.value?.contains(ziel) === true || karte.value?.contains(ziel) === true);

function onOutside(event: PointerEvent): void {
    if (!imMenue(event.target as Node)) emit("close");
}

function onKey(event: KeyboardEvent): void {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    // Die Pfeile gehören dem Menü, nicht der Karte.
    event.stopPropagation();
    // Im offenen Untermenü wandern sie darin (nicht in einem darin geschachtelten), sonst durch die Einträge beider Karten, die der
    // Editoren zuerst.
    const unter = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(".context-menu__unter") ?? null;
    const kasten = unter ? [unter] : [karte.value, menu.value].filter((x): x is HTMLDivElement => x !== null);
    const items = kasten
        .flatMap((element) => [...element.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")])
        .filter((item) => item.closest(".context-menu__unter") === unter);
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next]?.focus();
}

function listen(on: boolean): void {
    if (on) {
        document.addEventListener("pointerdown", onOutside, true);
    } else {
        document.removeEventListener("pointerdown", onOutside, true);
    }
}

watch(
    () => props.at,
    (at) => {
        listen(at !== null);
        platz.value = null;
        zweiLage.value = null;
        einzelLage.value = null;
        if (at) void placeInside();
    },
);

const cascade = inject(ESCAPE_CASCADE_KEY, undefined);
let unregister: (() => void) | undefined;
onMounted(() => {
    unregister = cascade?.register("menus", () => {
        if (props.at === null) return false;
        emit("close");
        return true;
    });
});

onBeforeUnmount(() => {
    listen(false);
    unregister?.();
});

function chooseEditor(eintrag: EditorEintrag): void {
    if (eintrag.grund !== undefined) return;
    emit("edit", eintrag.id);
    emit("close");
}

function choose(entry: Entry): void {
    if (entry.blocked) return;
    emit("choose", entry.action);
    emit("close");
}
</script>

<template>
    <svg
        v-if="at"
        class="context-zeiger"
        :style="zeigerLage"
        :width="KREUZ_RAND * 2"
        :height="KREUZ_RAND * 2"
        :viewBox="KREUZ_BOX"
        aria-hidden="true"
        data-testid="map-context-pointer"
    >
        <g class="context-zeiger__saum">
            <circle :r="KREUZ_RING" />
            <path v-for="strich in KREUZ_STRICHE" :key="strich" :d="strich" />
        </g>
        <g class="context-zeiger__linie">
            <circle :r="KREUZ_RING" />
            <path v-for="strich in KREUZ_STRICHE" :key="strich" :d="strich" />
        </g>
        <circle class="context-zeiger__punkt" :r="KREUZ_PUNKT" />
    </svg>
    <div
        v-if="at && mitEditor"
        ref="karte"
        class="context-menu context-menu--editor"
        :class="{ 'context-menu--rollt': zweiLage?.editorHoehe !== undefined }"
        role="menu"
        :aria-label="t('ctxmenu.editor')"
        :style="editorPosition"
        data-testid="context-editor"
        @keydown="onKey"
        @contextmenu.prevent
    >
        <template v-for="(abschnitt, nr) in editor" :key="abschnitt.id">
            <div class="context-menu__kopf" :data-testid="`context-editor-kopf-${abschnitt.id}`">
                <span>{{ abschnitt.titel }}</span>
                <!-- Die Pille einmal, am ersten Kopf: Alles darunter ist nur für Editoren. -->
                <span v-if="nr === 0" class="context-menu__pille">{{ abschnitt.pille }}</span>
            </div>
            <SperrKasten
                v-if="abschnitt.sperre"
                :kopf="abschnitt.sperre.kopf"
                :detail="abschnitt.sperre.detail"
                :frage="abschnitt.sperre.frage"
                :freigabe="abschnitt.sperre.freigabe"
                :testid="`context-editor-sperre-${abschnitt.id}`"
                @aufheben="emit('aufheben', abschnitt.sperre.ziel)"
                @bitten="emit('bitten', abschnitt.sperre.ziel)"
            />
            <KontextEintraege
                :eintraege="abschnitt.eintraege"
                @waehle="chooseEditor"
                @zeige="(eintrag) => zeigeEintrag(eintrag?.id)"
                @unter="zeigeUnter"
            />
        </template>
    </div>
    <div
        v-if="at && !nurEditor"
        ref="menu"
        class="context-menu"
        role="menu"
        :aria-label="t('ctxmenu.label')"
        :style="position"
        data-testid="map-context-menu"
        @keydown="onKey"
        @contextmenu.prevent
    >
        <button
            v-for="entry in entries"
            :key="entry.action"
            type="button"
            class="context-menu__item"
            role="menuitem"
            :disabled="entry.blocked !== undefined"
            :title="entry.blocked ? t(entry.blocked) : undefined"
            :data-testid="`context-${entry.action}`"
            @click="choose(entry)"
        >
            <span v-if="entry.mark" class="context-menu__icon context-menu__icon--mark">
                <WaypointMark :rolle="entry.mark" />
            </span>
            <img v-else-if="entry.icon" class="context-menu__icon" :src="entry.icon" alt="" />
            <span v-else class="context-menu__icon" aria-hidden="true"></span>
            <span>{{ t(entry.label) }}</span>
        </button>
    </div>
</template>

<style scoped src="./menue-eintrag.css"></style>

<style scoped>
/*
 * Letzter Rückfall der zwei Karten (`zweiKartenLage`, T41): Die Karte der Editoren rollt. Ihre Untermenüs stehen dann im Menü unter
 * ihrem Eintrag wie am Telefon (`menue-eintrag.css`); seitlich ausgeklappt schnitte das Rollen sie ab. Die Verschiebung nach oben, die
 * `kontext-eintraege.vue` einem ausgeklappten Untermenü gibt, gilt hier nicht.
 */
.context-menu--rollt {
    box-sizing: border-box;
    overflow-y: auto;
}
.context-menu--rollt :deep(.context-menu__unter) {
    position: static;
    min-width: 0;
    max-height: none;
    overflow: visible;
    margin-top: var(--space-4);
    box-shadow: none;
    transform: none !important;
}

/*
 * Das Fadenkreuz am Druckpunkt (WI-0108 Nachtrag): unter dem Menü, ohne Klick. Linien im dunklen Rand der Kartenmarken
 * (`markerWaypointCore`, wie Wegpunkt und Grenzübertritt) auf Legacys hellem Rand als Saum, damit es auf Wald wie Wüste steht;
 * der Punkt in `danger` mit hellem Rand (folgt dem Thema wie in Legacy). Darunter Legacys dunkler Umriss als Saum und sein Schatten.
 */
.context-zeiger {
    position: fixed;
    z-index: var(--z-dialog-high);
    overflow: visible;
    pointer-events: none;
    filter: drop-shadow(0 0 1px var(--color-map-context-anchor-outline)) drop-shadow(var(--shadow-map-context-anchor));
}

.context-zeiger__saum,
.context-zeiger__linie {
    fill: none;
    stroke-linecap: round;
}

.context-zeiger__saum {
    stroke: var(--color-map-context-anchor-contour);
    stroke-width: 4.5;
}

.context-zeiger__linie {
    stroke: var(--color-marker-waypoint-core);
    stroke-width: 2;
}

.context-zeiger__punkt {
    fill: var(--color-danger);
    stroke: var(--color-map-context-anchor-contour);
    stroke-width: 1.5;
}

/* Legacys Kartenmenü (`map-context-menu.css`): ein kleines Blatt über der Karte. */
.context-menu {
    position: fixed;
    z-index: var(--z-dialog-high);
    display: flex;
    flex-direction: column;
    min-width: 180px;
    padding: var(--space-6);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    color: var(--color-text);
}

/*
 * Die Karte der Editoren liegt über der der Besucher (Fund auf der Stage 2026-10-19, Thomas 4.1 und 4.2): Ihre Untermenüs klappen über die
 * Besucherkarte. Auf gleicher Stufe lag diese als späteres Geschwister darüber, verdeckte „Fläche malen“ oder „Topographie“ unter
 * „Neue Fläche ›“, und der Klick darauf traf „Was ist hier?“ und schloss das Menü.
 */
.context-menu--editor {
    z-index: calc(var(--z-dialog-high) + 1);
}

/*
 * Das gezeichnete Zeichen nimmt DIESELBE Fläche wie ein gemaltes: der Kasten ist `.context-menu__icon` (18 × 18 px),
 * die Nadel sitzt darin mittig und auf dessen Höhe gestellt (`markScale`, siehe oben). Der Kasten hat seine Höhe
 * selbst - deshalb wächst die Zeile nicht, auch wenn die Nadel in der Anordnung 24 px hoch bleibt.
 */
.context-menu__icon--mark {
    display: grid;
    place-items: center;
}

.context-menu__icon--mark :deep(.mark) {
    transform: scale(v-bind(markScale));
}

/* Die Karte der Editoren (E15, A4): Kopf wie eine Augenbraue, abstrakte Zeichen in der Breite der Bilder. */

.context-menu__kopf {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    padding: var(--space-4) var(--space-10) var(--space-2);
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.context-menu__pille {
    padding: 0 var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-text-muted);
    letter-spacing: normal;
    text-transform: none;
}
</style>
