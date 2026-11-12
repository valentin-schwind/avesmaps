<script setup lang="ts">
import EditorZeichen from "../controls/editor-zeichen.vue";
import KontextEintraege from "../controls/kontext-eintraege.vue";
import { computed, nextTick, onBeforeUnmount, onMounted, useTemplateRef, watch } from "vue";
import { t } from "../i18n/i18n";
import { MAP_OVERLAY_ATTRIBUTE } from "../map/camera/visible-area";
import { WAHL_TRENNER } from "./action";
import type { EditorMenu, EditorMenuItem } from "./editor-menu";
import type { EditorEintrag } from "./kartenmenue";
import { placeMenu, type MenuBounds } from "./placement";

/**
 * Das Editor-Menü am angeklickten Objekt (WI-0063 P9, 4.2, 15.2): ein kleines Blatt mit dem Namen und der Art des Gegenstands
 * und den direkten Actions, die für ihn gelten. Es zeichnet nur, was `createEditorMenu` meldet; wann es aufgeht, zugeht und
 * was eine Zeile tut, entscheidet der Controller und die Registry (`actions.ts`) - hier steht keine Art von Subject.
 *
 * - **Gestalt und Zustände erbt es vom Kartenmenü** (`controls/map-context-menu.vue`, Design Guide §18): Fläche, Rahmen, Radius 10,
 *   Schatten, Zeile mit Hover, Fokus, Aktiv und Übergang nach §30.5. Keine neue Bildsprache. Dazu ein Kopf, der sagt, wessen Menü es ist.
 * - **Es nimmt keinen Fokus.** Das Kartenmenü holt ihn auf die erste Zeile; hier hieße das, dass die Leertaste (im Editor die
 *   Auswahl fixieren, WI-0063 4.11) die erste Action auslöste und W A S D nicht mehr schöben. Wer die Zeilen mit Tab erreicht, wandert
 *   mit den Pfeiltasten durch sie; Escape schließt über die Kaskade.
 * - **Klick daneben schließt** (ein Druck außerhalb, bevor der Klick den nächsten Gegenstand wählt); jede Kartenbewegung schließt
 *   `app.vue` (`movestart`). Entschieden: Es hängt an einem Punkt des Fensters und folgt der Karte nicht - eine Karte, die sich unter ihm
 *   bewegt (Ziehen, Zoom, Drehen, Neigen, Gelände), ließe es entweder schwimmen oder bräuchte in jedem Bild eine neue Projektion; das
 *   Kartenmenü und die Flächenliste schließen aus demselben Grund. Das Nachführen der sichtbaren Fläche zählt nicht (`isLayoutMove`).
 * - Eine gefährliche Action trägt das Zeichen der Warnfarbe; sie steht im selben Raster, der Unterschied liegt im Ton (§16.2).
 * - **Ein Handgriff mit Auswahl** (EDIT-0003 T49) steht als „… ›“ mit dem Untermenü des Kartenmenüs (`kontext-eintraege.vue`): rechts
 *   daneben beim Zeigen, Wahlen mit Hinweis rechts; Zeigen auf eine Wahl mit Vorschau meldet das Menü (`menu.zeige`).
 */

const props = defineProps<{ menu: EditorMenu }>();

/** Ein Handgriff mit Auswahl als Eintrag des Kartenmenüs: „… ›“ und je Wahl ein Eintrag `<griff>#<wahl>`. */
function alsEintrag(item: EditorMenuItem): EditorEintrag {
    return {
        id: item.id,
        zeichen: item.zeichen,
        text: t(item.label),
        gefahr: item.danger,
        unter: (item.auswahl ?? []).map((wahl) => ({
            id: `${item.id}${WAHL_TRENNER}${wahl.id}`,
            zeichen: undefined,
            text: wahl.text,
            gefahr: item.danger,
            hinweis: wahl.hinweis,
            vorschau: wahl.vorschau === true,
        })),
    };
}
/** Das offene Untermenü und die gezeigte Wahl, an das Menü gemeldet. */
let offenesUnter: string | undefined;
function zeigeWahl(eintrag: EditorEintrag | undefined): void {
    props.menu.zeige(offenesUnter, eintrag === undefined ? undefined : eintrag.id.split(WAHL_TRENNER)[1]);
}
/**
 * Eine Gruppe meldet ihr Untermenü auf oder zu. 🪤 Jede Gruppe ist eine eigene Instanz von `kontext-eintraege` mit eigener Schließfrist
 * (300 ms): Wer von „Wegkurve bearbeiten ›“ zu „Wegkurve vereinfachen ›“ fährt, öffnet das zweite, und danach läuft die Frist des ersten
 * ab und meldet „zu“. Galt das, hieß das Menü „kein Untermenü offen“, und die Nummern der Abschnitte verschwanden beim nächsten Zeigen
 * (Befund des Betreibers auf der Stage, 2026-10-18). Also schließt nur die Gruppe, die gerade offen ist.
 */
function unterOffen(gruppe: string, id: string | undefined): void {
    if (id === undefined && offenesUnter !== gruppe) return;
    offenesUnter = id;
    props.menu.zeige(id, undefined);
}

const view = computed(() => props.menu.view.value);
const root = useTemplateRef<HTMLDivElement>("root");
const hasIcons = computed(
    () => view.value?.items.some((item) => item.icon !== undefined || item.zeichen !== undefined) === true,
);

/**
 * Der freie Platz: das Fenster ohne die Panels, die die Karte decken (`data-map-overlay`, wie die Kamera sie misst). Das Panel am
 * rechten Rand zählt mit seiner Breite im Ruhezustand: Es geht mit genau dem Klick herein, der das Menü öffnet, und ist bis dahin zu
 * (`inert`, aus dem Bild geschoben). Ein offener Planer links zählt mit seiner Kante.
 */
function freeBounds(): MenuBounds {
    const bounds = { left: 0, top: 0, right: globalThis.innerWidth, bottom: globalThis.innerHeight };
    for (const element of document.querySelectorAll<HTMLElement>(`[${MAP_OVERLAY_ATTRIBUTE}]`)) {
        const edge = element.getAttribute(MAP_OVERLAY_ATTRIBUTE);
        if (edge === "right") {
            bounds.right = Math.min(bounds.right, globalThis.innerWidth - element.offsetWidth);
            continue;
        }
        if (element.inert) continue;
        const box = element.getBoundingClientRect();
        if (edge === "left") bounds.left = Math.max(bounds.left, box.right);
        else if (edge === "top") bounds.top = Math.max(bounds.top, box.bottom);
        else if (edge === "bottom") bounds.bottom = Math.min(bounds.bottom, box.top);
    }
    return bounds;
}

/** Das Menü steht am Klickpunkt auf der freien Karte: gemessen, sobald es gezeichnet ist (die Größe hängt am Text). */
async function place(): Promise<void> {
    await nextTick();
    const element = root.value;
    const anchor = view.value?.anchor;
    if (!element || !anchor) return;
    const box = element.getBoundingClientRect();
    const at = placeMenu(anchor, box, freeBounds());
    element.style.left = `${String(at.x)}px`;
    element.style.top = `${String(at.y)}px`;
}

function onOutside(event: PointerEvent): void {
    if (!root.value?.contains(event.target as Node)) props.menu.close();
}

function onKey(event: KeyboardEvent): void {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    // Die Pfeile gehören dem Menü, solange der Fokus darin liegt, nicht der Karte.
    event.stopPropagation();
    const items = [...(root.value?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next]?.focus();
}

function listen(on: boolean): void {
    if (on) document.addEventListener("pointerdown", onOutside, true);
    else document.removeEventListener("pointerdown", onOutside, true);
}

// Jede Änderung der Ansicht - ein anderer Klickpunkt, der Name und die Art, wenn die Antwort da ist - stellt das Menü neu hin.
watch(view, (next, previous) => {
    if ((next === undefined) !== (previous === undefined)) listen(next !== undefined);
    if (next) void place();
});

onMounted(() => {
    if (view.value) {
        listen(true);
        void place();
    }
});
onBeforeUnmount(() => listen(false));
</script>

<template>
    <div
        v-if="view"
        ref="root"
        class="editor-menu"
        :class="{ 'editor-menu--icons': hasIcons }"
        role="menu"
        :aria-label="t('editorMenu.label')"
        data-testid="editor-menu"
        @keydown="onKey"
        @contextmenu.prevent
    >
        <div class="editor-menu__head">
            <!-- Wem es gehört (Betreiber 2026-10-11: „kannst du auch hier irgendwie klarmachen, dass das menü nur für editoren ist“):
                 dieselbe Pille wie der Editor-Abschnitt des Kontextmenüs und die Gruppe im Infopanel. -->
            <span class="editor-menu__zeile">
                <span class="editor-menu__name" data-testid="editor-menu-title">{{ view.subject.title }}</span>
                <span class="editor-menu__pille" data-testid="editor-menu-pille">{{
                    t("editorMenu.nurEditoren")
                }}</span>
            </span>
            <span v-if="view.subject.art" class="editor-menu__art" data-testid="editor-menu-art">{{
                view.subject.art
            }}</span>
        </div>
        <template v-for="item in view.items" :key="item.id">
            <div v-if="item.auswahl" class="editor-menu__auswahl">
                <KontextEintraege
                    :eintraege="[alsEintrag(item)]"
                    @waehle="(eintrag) => menu.choose(eintrag.id)"
                    @zeige="zeigeWahl"
                    @unter="(id: string | undefined) => unterOffen(item.id, id)"
                />
            </div>
            <button
                v-else
                type="button"
                class="editor-menu__item"
                :class="{ 'editor-menu__item--danger': item.danger }"
                role="menuitem"
                :data-testid="`editor-action-${item.id}`"
                :data-danger="item.danger ? 'true' : undefined"
                @click="menu.choose(item.id)"
            >
                <img v-if="item.icon" class="editor-menu__icon" :src="item.icon" alt="" />
                <span v-else-if="item.zeichen" class="editor-menu__icon" aria-hidden="true"
                    ><EditorZeichen :name="item.zeichen"
                /></span>
                <span v-else-if="hasIcons" class="editor-menu__icon" aria-hidden="true"></span>
                <span>{{ t(item.label) }}</span>
            </button>
        </template>
    </div>
</template>

<style scoped>
/* Das Blatt des Kartenmenüs (`map-context-menu.vue`, Guide §18): Fläche, Rahmen, Radius 10, Schatten, gleiche Stapelebene. */
.editor-menu {
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

/* Wessen Menü es ist: der Name wie ein Titel (Farbe statt Fett, Betonung trägt die Farbe), darunter leise die Art; ein Strich trennt. */
.editor-menu__head {
    display: flex;
    flex-direction: column;
    margin: 0 calc(var(--space-6) * -1) var(--space-4);
    padding: var(--space-2) calc(var(--space-6) + var(--space-10)) var(--space-6);
    border-bottom: 1px solid var(--color-divider);
}

.editor-menu__zeile {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-8);
}

/* Die Pille „nur Editoren“ wie im Kontextmenü (`.context-menu__pille`) und in der Gruppe des Infopanels. */
.editor-menu__pille {
    flex: none;
    padding: 0 var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
}

.editor-menu__name {
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
    line-height: var(--leading-snug);
}

.editor-menu__art {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
}

.editor-menu__item {
    display: grid;
    grid-template-columns: max-content;
    align-items: center;
    column-gap: 0.8em;
    width: 100%;
    padding: var(--space-8) var(--space-10);
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-body);
    line-height: var(--leading-snug);
    text-align: left;
    white-space: nowrap;
    transition:
        background-color 120ms ease,
        box-shadow 120ms ease;
}

/* Mit Bild in der Zeile (eine Action bringt eines mit): Alle Zeilen reservieren dieselbe Spalte, der Text fluchtet. */
.editor-menu--icons .editor-menu__item {
    grid-template-columns: var(--icon-sm) max-content;
}

.editor-menu__icon {
    justify-self: center;
    width: var(--icon-sm);
    height: var(--icon-sm);
    object-fit: contain;
}

/* Hover färbt die Fläche (§30.1); die Fläche des Menüs ist deckend, die Lasur liegt auf ihr. */
.editor-menu__item:hover {
    background: var(--color-hover-wash);
}

/* Fokus ist ein eigener Zustand: Lasur plus der Ring, komponiert und nie der Browserring (§30.3). */
.editor-menu__item:focus-visible {
    outline: none;
    background: var(--color-hover-wash);
    box-shadow: var(--focus-ring);
}

.editor-menu__item:active {
    background: var(--color-active-wash);
}

/* Gefährlich: das Zeichen der Warnfarbe, derselbe Ort - unterschieden am Ton (§16.2). */
.editor-menu__item--danger {
    color: var(--color-danger);
}

/* Ein Handgriff mit Auswahl: die Gruppe des Kartenmenüs mit ihrem Untermenü, in der Breite des Menüs. */
.editor-menu__auswahl {
    display: flex;
    flex-direction: column;
}

@media (prefers-reduced-motion: reduce) {
    .editor-menu__item {
        transition: none;
    }
}
</style>
