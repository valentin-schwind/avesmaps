<script setup lang="ts">
import { nextTick, onBeforeUnmount, shallowRef, watch } from "vue";
import EditorZeichen from "./editor-zeichen.vue";
import type { EditorEintrag } from "../editor-menu/kartenmenue";

/**
 * Die Einträge der Karte für Editoren im Kartenmenü (`map-context-menu.vue`), rekursiv: Ein Eintrag mit `unter` öffnet ein Untermenü,
 * und dessen Einträge können wieder eines öffnen (WI-0178 A4: die Fläche in „Hier liegen N Flächen“ → „Form ändern ›“ → die Werkzeuge,
 * wie Legacys Flächenmenü). Je Ebene ist höchstens ein Untermenü offen.
 *
 * - Legacy `.map-context-submenu` (`css/components/map-context-menu.css:450-505`): rechts neben dem Eintrag, eine Rahmenbreite höher,
 *   beim Zeigen und mit dem Fokus; ein Klick oder Tippen öffnet es auch (Tippen gibt einem Knopf nicht überall den Fokus).
 * - → hinein auf den ersten Eintrag, der geht; ← zurück auf den Eintrag, der es öffnete.
 * - Ist rechts kein Platz, geht es links auf; ragt es unten aus dem Fenster, rückt es so weit hoch, wie es oben geht. Ein flaches
 *   Untermenü (ohne eigene Untermenüs, etwa die 75 Abschnitte der Reichsstraße 2, T49) rollt, statt aus dem Fenster zu ragen.
 * - Am Telefon (bis 640 px) steht es im Menü unter seinem Eintrag (Stil im Kartenmenü).
 * - Verlässt der Zeiger Eintrag und Untermenü, geht es erst nach `ZU_NACH_MS` zu: Der Weg vom Eintrag schräg hinunter zu einem
 *   Eintrag des Untermenüs streift den Rand des Menüs, und ein sofortiges Schließen ließ den Klick ins Leere gehen (Befund der
 *   Wege-Sitzung, 2026-10-17). Zeigt er in der Zeit wieder auf die Gruppe, bleibt es offen; ein anderer Eintrag mit Untermenü öffnet
 *   seines sofort.
 * - 🔴 **Nur Maus und Stift** öffnen und schließen über Zeigen (`pointerenter`/`pointerleave`): Am Finger meldet der Browser nach jedem
 *   Tippen ein Verlassen (der Finger geht von der Scheibe), und das Untermenü ging `ZU_NACH_MS` nach dem ersten Tippen auf eine Vorschau
 *   zu, bevor das zweite wählen konnte (WI-0252, gemessen am Telefon: `mouseleave` 7 und 58 ms nach dem Tippen, zu nach 359 ms). Am
 *   Finger öffnet das Tippen, und es schließt das Tippen woandershin (Fokus) oder das Menü.
 *
 * - **Vorschau** (EDIT-0003 T49): Ein Eintrag mit `vorschau` meldet Zeigen und Fokus (`zeige`), ein offenes Untermenü meldet sich
 *   (`unter`); der Besitzer lässt damit etwa den Abschnitt eines Wegs leuchten und nummeriert die Abschnitte. Am Finger gibt es kein
 *   Zeigen: Das erste Tippen auf einen solchen Eintrag lässt ihn leuchten, das zweite wählt.
 *
 * Die Stile stehen in `menue-eintrag.css`, die auch Kartenmenü und Flächenliste einbinden: Einträge der Besucher und der Editoren
 * haben eine Fassung.
 */
defineOptions({ name: "KontextEintraege" });

const props = defineProps<{ eintraege: readonly EditorEintrag[] }>();
const emit = defineEmits<{
    waehle: [eintrag: EditorEintrag];
    /** Ein Eintrag mit `vorschau` wird gezeigt (Zeiger, Fokus, erstes Tippen) oder nicht mehr (`undefined`). */
    zeige: [eintrag: EditorEintrag | undefined];
    /** Ein Untermenü geht auf (seine Kennung) oder zu (`undefined`). */
    unter: [id: string | undefined];
}>();

const offen = shallowRef<string | undefined>();
watch(offen, (id) => emit("unter", id));
/** Am Finger: der Eintrag, den das erste Tippen leuchten ließ; das zweite Tippen auf ihn wählt. */
const getippt = shallowRef<string | undefined>();

/** Ein Eintrag mit Vorschau gewählt: am Finger erst leuchten, dann wählen; mit der Maus gleich. */
function tippe(eintrag: EditorEintrag, event: MouseEvent): void {
    const finger = (event as PointerEvent).pointerType === "touch";
    if (eintrag.vorschau === true && finger && getippt.value !== eintrag.id) {
        getippt.value = eintrag.id;
        emit("zeige", eintrag);
        return;
    }
    emit("waehle", eintrag);
}
/** So lange bleibt ein Untermenü offen, nachdem der Zeiger es verlassen hat (ms). */
const ZU_NACH_MS = 300;
let zuGleich: ReturnType<typeof setTimeout> | undefined;
const links = shallowRef(false);
/** So weit rückt das offene Untermenü hoch, damit es unten ins Fenster passt. */
const hoch = shallowRef(0);

const unterVon = (id: string): HTMLElement | null =>
    document.querySelector<HTMLElement>(`[data-testid="context-editor-${id}-unter"]`);

async function oeffne(id: string, fokus = false): Promise<void> {
    if (offen.value !== id) {
        links.value = false;
        hoch.value = 0;
        offen.value = id;
        await nextTick();
        const kasten = unterVon(id)?.getBoundingClientRect();
        if (kasten !== undefined && kasten.width > 0) {
            if (kasten.right > globalThis.innerWidth - 4) links.value = true;
            const ueber = kasten.bottom - (globalThis.innerHeight - 8);
            if (ueber > 0) hoch.value = Math.max(0, Math.min(ueber, kasten.top - 8));
        }
    }
    if (fokus) unterVon(id)?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
}

/** Der Zeiger kommt auf die Gruppe: Ein laufendes Schließen hört auf, das Untermenü geht auf. Der Finger zeigt nicht. */
function betrete(event: PointerEvent, id: string): void {
    if (event.pointerType === "touch") return;
    clearTimeout(zuGleich);
    void oeffne(id);
}

/** Der Zeiger verlässt die Gruppe: nach der Frist zu, wenn bis dahin nichts anderes offen ist. Der Finger verlässt nichts. */
function verlasse(event: PointerEvent, id: string): void {
    if (event.pointerType === "touch") return;
    clearTimeout(zuGleich);
    zuGleich = setTimeout(() => {
        if (offen.value === id) offen.value = undefined;
    }, ZU_NACH_MS);
}

onBeforeUnmount(() => clearTimeout(zuGleich));

function zurueck(id: string): void {
    offen.value = undefined;
    document.querySelector<HTMLButtonElement>(`[data-testid="context-editor-${id}"]`)?.focus();
}

/**
 * Der Fokus verlässt die Gruppe (Tab, Klick daneben): ihr Untermenü zu. 🪤 `offen` gilt für alle Gruppen dieser Ebene, und beim Öffnen
 * hat der erste Eintrag den Fokus: Der Mausdruck in das Untermenü des zweiten nahm ihn dem ersten, dessen `focusout` schloss das
 * Untermenü des zweiten unter dem Zeiger, und der Klick fiel auf die Karte (WI-0178 T41, „Zurückholen“ an der zweiten Fläche).
 */
function fokusRaus(event: FocusEvent, id: string): void {
    const gruppe = event.currentTarget as HTMLElement;
    if (offen.value === id && !gruppe.contains(event.relatedTarget as Node | null)) offen.value = undefined;
}

/**
 * Andere Einträge (ein anderes Menü): alles zu. 🪤 Dasselbe Menü, frisch gebaut, lässt offen, was offen ist: Das Kartenmenü fragt nach
 * dem Öffnen die Sperren neu und baut seine Abschnitte dann noch einmal (`app.vue`, `openContextMenu`). Schloss das ein Untermenü unter
 * dem Zeiger, traf ein echter Mausklick die Karte, und deren `pointerdown` schloss das Menü (Befund der Wege-Sitzung, 2026-10-17).
 */
watch(
    () => props.eintraege.map((eintrag) => eintrag.id).join("\n"),
    () => {
        offen.value = undefined;
    },
);
</script>

<template>
    <template v-for="eintrag in eintraege" :key="eintrag.id">
        <div v-if="eintrag.abschnitt" class="context-menu__zwischen" role="presentation">
            {{ eintrag.abschnitt }}
        </div>
        <div
            v-if="eintrag.unter"
            class="context-menu__gruppe"
            :class="{ 'is-links': links && offen === eintrag.id, 'is-offen': offen === eintrag.id }"
            @pointerenter="(event: PointerEvent) => betrete(event, eintrag.id)"
            @pointerleave="(event: PointerEvent) => verlasse(event, eintrag.id)"
            @focusout="(event: FocusEvent) => fokusRaus(event, eintrag.id)"
        >
            <button
                type="button"
                class="context-menu__item context-menu__item--unter"
                :class="{ 'context-menu__item--hinweis': eintrag.hinweis }"
                role="menuitem"
                aria-haspopup="menu"
                :aria-expanded="offen === eintrag.id"
                :data-testid="`context-editor-${eintrag.id}`"
                @click="oeffne(eintrag.id)"
                @keydown.right.prevent.stop="oeffne(eintrag.id, true)"
            >
                <span class="context-menu__icon context-menu__zeichen" aria-hidden="true"
                    ><EditorZeichen v-if="eintrag.zeichen" :name="eintrag.zeichen"
                /></span>
                <span>{{ eintrag.text }}</span>
                <span v-if="eintrag.hinweis" class="context-menu__hinweis">{{ eintrag.hinweis }}</span>
            </button>
            <div
                v-show="offen === eintrag.id"
                class="context-menu__unter"
                :class="{ 'is-flach': eintrag.unter.every((unter) => unter.unter === undefined) }"
                role="menu"
                :aria-label="eintrag.text"
                :data-testid="`context-editor-${eintrag.id}-unter`"
                :style="hoch > 0 && offen === eintrag.id ? { transform: `translateY(-${String(hoch)}px)` } : undefined"
                @keydown.left.prevent.stop="zurueck(eintrag.id)"
            >
                <KontextEintraege
                    :eintraege="eintrag.unter"
                    @waehle="(gewaehlt) => emit('waehle', gewaehlt)"
                    @zeige="(gezeigt) => emit('zeige', gezeigt)"
                    @unter="(id) => emit('unter', id)"
                />
            </div>
        </div>
        <button
            v-else
            type="button"
            class="context-menu__item"
            :class="{ 'is-gefahr': eintrag.gefahr, 'context-menu__item--hinweis': eintrag.hinweis }"
            role="menuitem"
            :disabled="eintrag.grund !== undefined"
            :title="eintrag.grund"
            :aria-describedby="
                eintrag.grund !== undefined && eintrag.grundSichtbar ? `context-editor-${eintrag.id}-grund` : undefined
            "
            :data-testid="`context-editor-${eintrag.id}`"
            :data-vorschau="eintrag.vorschau ? 'true' : undefined"
            @click="tippe(eintrag, $event)"
            @mouseenter="eintrag.vorschau ? emit('zeige', eintrag) : undefined"
            @focus="eintrag.vorschau ? emit('zeige', eintrag) : undefined"
            @mouseleave="eintrag.vorschau ? emit('zeige', undefined) : undefined"
        >
            <span class="context-menu__icon context-menu__zeichen" aria-hidden="true"
                ><EditorZeichen v-if="eintrag.zeichen" :name="eintrag.zeichen"
            /></span>
            <span>{{ eintrag.text }}</span>
            <span v-if="eintrag.hinweis" class="context-menu__hinweis">{{ eintrag.hinweis }}</span>
        </button>
        <p
            v-if="!eintrag.unter && eintrag.grund !== undefined && eintrag.grundSichtbar"
            :id="`context-editor-${eintrag.id}-grund`"
            class="context-menu__grund"
            role="note"
            :data-testid="`context-editor-${eintrag.id}-grund`"
        >
            {{ eintrag.grund }}
        </p>
    </template>
</template>

<style scoped src="./menue-eintrag.css"></style>
