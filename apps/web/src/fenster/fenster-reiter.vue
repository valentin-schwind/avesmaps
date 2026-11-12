<script setup lang="ts" generic="Id extends string">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { gilt, sprungReiterWunsch } from "../aenderungen/sprung";

/**
 * Reiter im Fenster: DIE eine Reiterleiste des Hauses (Guide §9 „Reiter“, verbindlich; WI-0256). Reiter wechseln, *was man
 * sieht*; die Leiste bleibt.
 *
 * - 🔴 Der gewählte Reiter sieht aus wie der gewählte Eintrag der Schiene der Systemsteuerung, um eine Vierteldrehung auf die
 *   Linie gelegt (Betreiber 2026-10-26 zur Probierseite WI-0256: „A Lasche ist exakt das was ich wollte“): weiche Fläche, oben
 *   gerundet, goldene Kante unten auf der Linie, kräftige Schrift. Gold nur in der Kante, nie in der Schrift: Eine goldene
 *   Schrift läse sich als Link. Beim Zeigen dieselbe goldene Lasur wie in der Schiene.
 * - 🔴 Die Kante ist immer da, nur farblos. So springt beim Wechsel nichts.
 * - Die Linie liegt hinter den Reitern, kein Rand der Leiste: Die Leiste rollt in schmalen Fenstern seitwärts, statt umzubrechen (in zwei
 *   Zeilen verlöre die Kante den Bezug zur Linie), und ein Rollbereich schneidet ab, was über seinen Rand ragt. Ihre Farbe
 *   kommt aus `--fenster-reiter-linie`; die Zone unter dem Fensterkopf setzt dort die Trennlinie des Fensters.
 * - Läuft die Leiste über, steht ‹ oder › an dem Rand, hinter dem noch Reiter liegen; ein Klick rollt um einen Reiter weiter.
 *   Mit gedrückter Maus und mit dem Finger rollt sie seitwärts; ein Ziehen wählt keinen Reiter (Betreiber 2026-10-26: „bei
 *   manchen webseiten tauchen dann so < pfeile > auf und man kann mit gedrückter maus / mit dem finger links und rechts
 *   scrollen“). Der gewählte Reiter rollt sich ins Bild, auch wenn die Leiste erst später sichtbar wird.
 * - Tastatur nach WAI-ARIA: ← → wechseln und fokussieren, Pos1 und Ende springen an die Ränder. Nur der aktive Reiter liegt in
 *   der Tab-Reihenfolge; die Pfeile am Rand sind nur für Maus und Finger da.
 *
 * Der Inhalt je Reiter steht beim Aufrufer in einem Element mit `role="tabpanel"` und der id `${kennung}-inhalt-${id}`.
 *
 * Zwei Zusätze für das Editorpanel (WI-0128 E3):
 * - `verteilt`: Hauptreiter im Panel teilen die Breite gleichmäßig (Guide §9: Haupt- und Unterreiter sind dasselbe Bauteil,
 *   die Hierarchie steckt in der Verteilung).
 * - `spaeter` je Reiter: steht gedämpft da und lässt sich nicht wählen; der Satz steht im `title` (D16, „später“). Die
 *   Pfeiltasten überspringen ihn.
 *
 * Und einer für „Vorkommen unterwegs“ (WI-0257 S5, Vali 2026-10-30: „du kannst die schrift der nav-tab-bar … etwas heruntersetzen (ausahme hier: kleiner ok)“):
 * - `klein`: Schrift `--font-size-caption`, seitlich 3 px Polster, die Reiter teilen die Breite nach ihrem Inhalt; in einer Leiste von höchstens 300 px
 *   (Telefon) 2 px Polster und 2 px Abstand, damit vier Reiter mit Zeichen, Wort und Zahl ohne Rollen passen. Eine ausdrückliche Ausnahme, nicht die Regel.
 * - Slot `reiter`: was im Reiter steht (Zeichen, Wort, Zahl); ohne ihn der Name auf Versalhöhe mittig.
 */
const props = defineProps<{
    reiter: readonly { id: Id; name: string; spaeter?: string | undefined }[];
    /** Name der Leiste für Vorleser. */
    beschriftung: string;
    /** Vorsilbe der ids, eindeutig auf der Seite. */
    kennung: string;
    /** Hauptreiter im Panel: gleich breit über die ganze Leiste. */
    verteilt?: boolean | undefined;
    /** Die kleine Leiste (WI-0257 S5): Schrift `--font-size-caption`, schmales Polster, die Reiter füllen die Breite. */
    klein?: boolean | undefined;
}>();
defineSlots<{
    /** Was im Reiter steht; ohne den Slot sein Name. */
    reiter?(props: { eintrag: { id: Id; name: string; spaeter?: string | undefined }; aktiv: boolean }): unknown;
}>();
const aktiv = defineModel<Id>({ required: true });
const rolle = ref<HTMLElement | null>(null);
const mehrLinks = ref(false);
const mehrRechts = ref(false);

/** Ab so viel Bewegung (px) ist ein Druck mit der Maus ein Ziehen und kein Klick mehr. */
const ZIEH_SCHWELLE = 4;

const tabId = (id: Id): string => `${props.kennung}-reiter-${id}`;

function waehle(id: Id, fokus: boolean): void {
    if (props.reiter.find((eintrag) => eintrag.id === id)?.spaeter !== undefined) return;
    aktiv.value = id;
    if (fokus) document.getElementById(tabId(id))?.focus();
}

/** Der nächste wählbare Reiter in einer Richtung, im Kreis; ein späterer wird übersprungen. */
function naechster(start: number, schritt: number): number | null {
    const anzahl = props.reiter.length;
    for (let i = 1; i <= anzahl; i += 1) {
        const index = (((start + schritt * i) % anzahl) + anzahl) % anzahl;
        if (props.reiter[index]?.spaeter === undefined) return index;
    }
    return null;
}

function taste(event: KeyboardEvent, index: number): void {
    const ziel =
        event.key === "ArrowRight"
            ? naechster(index, 1)
            : event.key === "ArrowLeft"
              ? naechster(index, -1)
              : event.key === "Home"
                ? naechster(-1, 1)
                : event.key === "End"
                  ? naechster(props.reiter.length, -1)
                  : null;
    if (ziel === null) return;
    event.preventDefault();
    const eintrag = props.reiter[ziel];
    if (eintrag) waehle(eintrag.id, true);
}

/** Wie breit ein Pfeil am Rand ist: so viel Platz bleibt neben einem Reiter, der ins Bild rollt. */
function pfeilBreite(box: HTMLElement): number {
    return Number.parseFloat(getComputedStyle(box).getPropertyValue("--fenster-reiter-pfeil")) || 0;
}

function sanft(): ScrollBehavior {
    return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

/** Zeigt die Pfeile nur an dem Rand, hinter dem noch Reiter liegen. */
function messe(): void {
    const box = rolle.value;
    if (!box) return;
    mehrLinks.value = box.scrollLeft > 1;
    mehrRechts.value = box.scrollLeft + box.clientWidth < box.scrollWidth - 1;
}

/** Rollt die Leiste so, dass der gewählte Reiter ganz und neben den Pfeilen zu sehen ist; nur in sich, nie das Fenster. */
function zeigeAktiv(verhalten: ScrollBehavior = "auto"): void {
    const box = rolle.value;
    const knopf = box?.querySelector<HTMLElement>(".is-aktiv");
    if (!box || !knopf || box.clientWidth === 0) return;
    const rand = pfeilBreite(box);
    const links = knopf.offsetLeft - rand;
    const rechts = knopf.offsetLeft + knopf.offsetWidth + rand - box.clientWidth;
    if (links < box.scrollLeft) box.scrollTo({ left: links, behavior: verhalten });
    else if (rechts > box.scrollLeft) box.scrollTo({ left: rechts, behavior: verhalten });
}

/** Ein Klick auf ‹ oder › rollt den nächsten verborgenen Reiter dieser Seite ganz ins Bild. */
function blaettere(richtung: -1 | 1): void {
    const box = rolle.value;
    if (!box) return;
    const rand = pfeilBreite(box);
    const knoepfe = [...box.querySelectorAll<HTMLElement>(".fenster-reiter__knopf")];
    if (richtung > 0) {
        const kante = box.scrollLeft + box.clientWidth - rand;
        const ziel = knoepfe.find((k) => k.offsetLeft + k.offsetWidth > kante + 1);
        if (ziel)
            box.scrollTo({ left: ziel.offsetLeft + ziel.offsetWidth + rand - box.clientWidth, behavior: sanft() });
    } else {
        const kante = box.scrollLeft + rand;
        const ziel = knoepfe.findLast((k) => k.offsetLeft < kante - 1);
        if (ziel) box.scrollTo({ left: ziel.offsetLeft - rand, behavior: sanft() });
    }
}

/*
 * Ziehen mit der Maus. Der Finger rollt von selbst (der Rollbereich); die Maus erst, wenn sie sich über die Schwelle bewegt hat.
 * Bis dahin bleibt alles ein Klick. Danach fängt die Leiste den Zeiger, und der Klick am Ende wird geschluckt.
 */
let ziehStart: { x: number; links: number; id: number } | null = null;
const zieht = ref(false);
let klickSchlucken = false;

function druck(event: PointerEvent): void {
    klickSchlucken = false;
    if (event.pointerType !== "mouse" || event.button !== 0 || !rolle.value) return;
    ziehStart = { x: event.clientX, links: rolle.value.scrollLeft, id: event.pointerId };
}

function bewegung(event: PointerEvent): void {
    const box = rolle.value;
    if (!ziehStart || !box || event.pointerId !== ziehStart.id) return;
    const weg = event.clientX - ziehStart.x;
    if (!zieht.value) {
        if (Math.abs(weg) < ZIEH_SCHWELLE || box.scrollWidth <= box.clientWidth) return;
        zieht.value = true;
        box.setPointerCapture(event.pointerId);
    }
    box.scrollLeft = ziehStart.links - weg;
}

function loslassen(event: PointerEvent): void {
    if (!ziehStart || event.pointerId !== ziehStart.id) return;
    if (zieht.value) klickSchlucken = true;
    zieht.value = false;
    ziehStart = null;
}

function klickPruefen(event: MouseEvent): void {
    if (!klickSchlucken) return;
    klickSchlucken = false;
    event.preventDefault();
    event.stopPropagation();
}

/* Sichtbar wird eine Leiste oft erst nach dem Einhängen (Fenster öffnet, Reiter im Rumpf): dann misst sie neu und rollt ein. */
let beobachter: ResizeObserver | null = null;
let breiteVorher = 0;

/**
 * Der Sprung "Im Objektverlauf zeigen" aus den Änderungen (WI-0265 B5a, `aenderungen/sprung.ts`) wünscht in einem Editorfenster den Reiter "Verlauf":
 * Gilt der Wunsch noch und gehört diese Leiste zum Fenster des Werkzeugs (`<werkzeug>-<nummer>`), wählt sie ihn, wenn sie ihn hat.
 */
function wunschPruefen(): void {
    const wunsch = sprungReiterWunsch.value;
    if (wunsch === undefined || !gilt(wunsch.seit)) return;
    if (!props.kennung.startsWith(`${wunsch.werkzeug}-`)) return;
    if (props.reiter.some((eintrag) => eintrag.id === wunsch.reiter && eintrag.spaeter === undefined))
        aktiv.value = wunsch.reiter as Id;
}
watch(sprungReiterWunsch, wunschPruefen);

onMounted(() => {
    wunschPruefen();
    const box = rolle.value;
    if (!box) return;
    messe();
    zeigeAktiv();
    beobachter = new ResizeObserver(() => {
        messe();
        if (breiteVorher === 0 && box.clientWidth > 0) zeigeAktiv();
        breiteVorher = box.clientWidth;
    });
    beobachter.observe(box);
});
onBeforeUnmount(() => beobachter?.disconnect());

watch(aktiv, () => void nextTick(() => zeigeAktiv(sanft())));
watch(
    () => props.reiter.map((eintrag) => eintrag.name).join("\u0000"),
    () => void nextTick(messe),
);

defineExpose({ tabId });
</script>

<template>
    <div class="fenster-reiter" :class="{ 'fenster-reiter--verteilt': verteilt, 'fenster-reiter--klein': klein }">
        <div class="fenster-reiter__bahn">
            <div
                ref="rolle"
                class="fenster-reiter__rolle"
                :class="{ 'is-ziehend': zieht }"
                role="tablist"
                :aria-label="beschriftung"
                @scroll.passive="messe"
                @pointerdown="druck"
                @pointermove="bewegung"
                @pointerup="loslassen"
                @pointercancel="loslassen"
                @click.capture="klickPruefen"
            >
                <button
                    v-for="(eintrag, index) in reiter"
                    :id="tabId(eintrag.id)"
                    :key="eintrag.id"
                    type="button"
                    role="tab"
                    class="fenster-reiter__knopf"
                    :class="{ 'is-aktiv': aktiv === eintrag.id, 'is-spaeter': eintrag.spaeter !== undefined }"
                    :aria-selected="aktiv === eintrag.id"
                    :aria-disabled="eintrag.spaeter !== undefined ? 'true' : undefined"
                    :aria-controls="eintrag.spaeter === undefined ? `${kennung}-inhalt-${eintrag.id}` : undefined"
                    :title="eintrag.spaeter"
                    :tabindex="aktiv === eintrag.id ? 0 : -1"
                    :data-testid="`${kennung}-reiter-${eintrag.id}`"
                    draggable="false"
                    @click="waehle(eintrag.id, false)"
                    @keydown="taste($event, index)"
                >
                    <slot name="reiter" :eintrag="eintrag" :aktiv="aktiv === eintrag.id"
                        ><span class="avm-versalmitte">{{ eintrag.name }}</span></slot
                    >
                </button>
            </div>
            <button
                v-if="mehrLinks"
                type="button"
                class="fenster-reiter__pfeil fenster-reiter__pfeil--links"
                tabindex="-1"
                aria-hidden="true"
                :data-testid="`${kennung}-reiter-zurueck`"
                @click="blaettere(-1)"
            >
                ‹
            </button>
            <button
                v-if="mehrRechts"
                type="button"
                class="fenster-reiter__pfeil fenster-reiter__pfeil--rechts"
                tabindex="-1"
                aria-hidden="true"
                :data-testid="`${kennung}-reiter-weiter`"
                @click="blaettere(1)"
            >
                ›
            </button>
        </div>
    </div>
</template>

<style scoped>
/* Die Leiste: oben Luft, unten die Linie hinter den Reitern. Die Farbe der Pfeile läuft in den Grund aus, auf dem die Leiste steht. */
.fenster-reiter {
    --fenster-reiter-linie: var(--color-border);
    --fenster-reiter-grund: var(--color-panel);
    --fenster-reiter-pfeil: var(--space-24);
    position: relative;
    padding-top: var(--space-4);
}

/* Die Haarlinie (Guide §5) als Rand eines eigenen Elements: Sie liegt in der Reihenfolge VOR der Bahn und damit dahinter, die Kante des
   gewählten Reiters deckt sie ab, und die Leiste trägt keinen Rand, der die Reiter anhöbe. */
.fenster-reiter::before {
    content: "";
    position: absolute;
    inset: auto 0 0;
    border-bottom: 1px solid var(--fenster-reiter-linie);
    pointer-events: none;
}

.fenster-reiter__bahn {
    position: relative;
}

.fenster-reiter__rolle {
    position: relative;
    display: flex;
    column-gap: var(--space-2);
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
}

.fenster-reiter__rolle.is-ziehend {
    cursor: grabbing;
    user-select: none;
}

.fenster-reiter__rolle.is-ziehend .fenster-reiter__knopf {
    cursor: grabbing;
}

/* Wie die Schiene (fenster-schiene.vue): Polster ringsum gleich, darunter die Kante; der Text sitzt auf Versalhöhe mittig (§3.2). */
.fenster-reiter__knopf {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    padding: var(--space-8);
    border: 0;
    border-bottom: var(--avm-fenster-schiene-kante) solid transparent;
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    background: none;
    color: var(--color-text-muted);
    font: inherit;
    font-size: var(--font-size-body);
    white-space: nowrap;
    cursor: pointer;
    transition:
        background-color 120ms ease,
        color 120ms ease,
        border-color 120ms ease;
}

/* Hover ist eine Lasur (§30.1); der gewählte und ein späterer Reiter antworten nicht. */
.fenster-reiter__knopf:not(.is-aktiv, .is-spaeter):hover {
    background: var(--color-hover-wash);
    color: var(--color-text-strong);
}

.fenster-reiter__knopf:not(.is-aktiv, .is-spaeter):active {
    background: var(--color-active-wash);
}

/* §30.3: der Goldring, nach innen gelegt - der Rollbereich der Leiste schnitte ihn außen ab. */
.fenster-reiter__knopf:focus-visible {
    outline: none;
    box-shadow: inset var(--focus-ring);
}

.fenster-reiter__knopf.is-aktiv {
    border-bottom-color: var(--color-accent);
    background: var(--color-panel-active);
    color: var(--color-text-strong);
}

/* Hauptreiter im Panel (Guide §9): gleich breit; die Zelle bringt die Breite mit, seitliches Polster kürzte „Änderungen“ am Telefon. */
.fenster-reiter--verteilt .fenster-reiter__knopf {
    flex: 1 1 0;
    min-width: 0;
    padding-inline: 0;
}

/*
 * Die kleine Leiste (WI-0257 S5, „Vorkommen unterwegs“): 11 px Schrift, 3 px seitliches Polster, 2 px zwischen Zeichen und Wort; die Reiter wachsen mit ihrem
 * Inhalt über die ganze Breite. Gemessen an der Probierseite Fassung 3: Bei 310 und 294 px passen vier Reiter mit Zeichen, Wort und Zahl ohne Rollen, wenn das
 * Polster in einer Leiste bis 300 px auf 2 px geht und die Reiter 2 px auseinanderstehen. Die Maße kommen aus dem Kanon (Guide §12.6): 3 px sind die
 * Hälfte von `space.4`, 2 px die Hälfte von `space.2`; die Schwelle steht als 18,75 rem da (= 300 px bei Standardschrift), denn in einer Containerabfrage
 * gibt es keine Variable.
 */
.fenster-reiter--klein {
    container-type: inline-size;
}

.fenster-reiter--klein .fenster-reiter__knopf {
    flex: 1 1 auto;
    min-width: 0;
    gap: calc(var(--space-2) / 2);
    padding: var(--space-8) calc(var(--space-4) / 2);
    font-size: var(--font-size-caption);
}

@container (max-width: 18.75rem) {
    .fenster-reiter--klein .fenster-reiter__rolle {
        column-gap: calc(var(--space-2) / 2);
    }

    .fenster-reiter--klein .fenster-reiter__knopf {
        padding-inline: calc(var(--space-2) / 2);
    }
}

/* Später (D16): gedämpft, kein Hover, nicht wählbar - die Farbe der Sperre, nie Deckkraft (§30.2). */
.fenster-reiter__knopf.is-spaeter {
    color: var(--color-disabled-text);
    cursor: default;
}

/*
 * ‹ und › am Rand: über den Reitern, nicht daneben, damit nichts springt, wenn sie kommen und gehen. Sie enden über der Kante,
 * die Linie bleibt durchgehend; der Grund läuft zur Mitte hin aus, so verschwinden die Reiter darunter weich.
 */
.fenster-reiter__pfeil {
    position: absolute;
    top: 0;
    bottom: var(--avm-fenster-schiene-kante);
    display: flex;
    align-items: center;
    width: var(--fenster-reiter-pfeil);
    padding: 0;
    border: 0;
    color: var(--color-text-muted);
    font: inherit;
    font-size: var(--font-size-subhead);
    line-height: 1;
    cursor: pointer;
    transition: color 120ms ease;
}

.fenster-reiter__pfeil:hover {
    color: var(--color-text-strong);
}

.fenster-reiter__pfeil--links {
    left: 0;
    justify-content: flex-start;
    background: linear-gradient(to right, var(--fenster-reiter-grund) 55%, transparent);
}

.fenster-reiter__pfeil--rechts {
    right: 0;
    justify-content: flex-end;
    background: linear-gradient(to left, var(--fenster-reiter-grund) 55%, transparent);
}

@media (prefers-reduced-motion: reduce) {
    .fenster-reiter__knopf,
    .fenster-reiter__pfeil {
        transition: none;
    }
}
</style>
