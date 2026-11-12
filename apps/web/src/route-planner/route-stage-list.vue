<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";
import type { SubjectRef } from "@avesmaps3d/shared";
import { animateHeight, elementHeight, stopHeightAnimation } from "../controls/animate-height";
import AvmWert from "../controls/avm-wert.vue";
import RouteStageGroup from "./route-stage-group.vue";
import RouteStageRow from "./route-stage-row.vue";
import RouteStageStation from "./route-stage-station.vue";
import { isStation, type StageListModel } from "./stage-list-model";

/**
 * Die Etappenliste des Reiseplans (WI-0079 §1, §2; M0-Blatt vom 2026-10-05): Stationen, Mediengruppen und
 * Etappenzeilen an EINER durchgehenden Kette.
 *
 * 🔴 **Die Kette ist EIN Element über der ganzen Liste**, nicht ein Stück je Zeile - nur so läuft sie über
 * Gruppenkästen und Stationen hinweg (§1.2). Perlen und Wegpunktscheiben stanzen sie mit ihrem deckenden Grund
 * aus. Anfang und Ende werden GEMESSEN, von der Mitte der ersten bis zur Mitte der letzten sichtbaren Marke:
 * Geraten (etwa „halbe erste Zeilenhöhe“) läge sie bei jeder Textlänge anders.
 *
 * **Der Klappzustand gehört dieser Liste** (§7 P4): Er steht in keinem Link und in keinem Kurzlink.
 *
 * 🔴 **Eine neue Route öffnet alle Gruppen ZU** (WI-0087 P4, Betreiber 2026-10-05: „kannst du doch lieber alle
 * etappenzusammenfassungen standardmäßg einklappen“). Wird eine Etappe von außen gewählt - über die Karte, den
 * Playmode oder die Pfeile des Infopanels -, öffnet sich ihre Gruppe von selbst (Betreiber 2026-10-05, F8: „ja“;
 * „dass sie automatisch beim playbutton aufgehen hast du sehr gut gelöst“). 🪤 Die neue Vorgabe hebt das NICHT aus:
 * Der Wächter dafür ist der Fall A10 in `stage-list-model.test.ts` und der Playmode-Browserfall.
 *
 * **Stationen stehen nur an EINER Stelle** (WI-0087 P5): auf der obersten Ebene. Welche Gruppen eine Station teilt,
 * hat das Listenmodell schon entschieden; diese Vorlage zeichnet sie nicht mehr zusätzlich im Rumpf einer Gruppe.
 */
const props = defineProps<{
    model: StageListModel;
    selectedStage: number | null;
    stale: boolean;
    /** Die Etappen (ab 0), in denen der gewählte Eintrag von „Unterwegs“ vorkommt (WI-0257 S4); leer, wo keiner gewählt ist. */
    treffer?: ReadonlySet<number>;
}>();
const emit = defineEmits<{ selectStage: [index: number]; showSubject: [ref: SubjectRef] }>();

/** Ein Punkt der Kette sitzt alle 7 px (dasselbe Maß wie ihr Muster, siehe `.stages__chain`). */
const DOT_STEP = 7;
/**
 * Die Luft zwischen Ziffer und Kette, oben wie unten (Betreiber 2026-10-06: „3px oben 3px unten oder so"); ein
 * Mindestmaß, denn die Punkte sitzen danach noch mittig in ihrem Stück.
 */
const DIGIT_AIR = 3;
/** Über wie viele Pixel der Verlauf der gewählten Zeile ausläuft - drei Punkte (Form C). */
const GLOW_FADE = 3 * DOT_STEP;

/** Ein Stück der Kette zwischen zwei Lücken: wo es sitzt, wie hoch es ist und wie seine Punkte darin liegen. */
interface ChainPiece {
    top: number;
    height: number;
    /** Der Versatz des Punktmusters, damit die Punkte mittig im Stück sitzen und keiner angeschnitten wird. */
    offset: number;
    /** Wie viele ganze Punktzellen das Stück trägt. */
    cells: number;
}

/** Ein Punkt der Kette in der Aktivfarbe (Form C): seine Mitte und seine Deckkraft. */
interface GlowDot {
    top: number;
    opacity: number;
}

const list = useTemplateRef<HTMLOListElement>("list");
const closed = ref(new Set<string>());
/**
 * Die Kette als STÜCKE (WI-0087 P7, Betreiber 2026-10-06: „wir machen Raster an der Ziffer für die naht / drei
 * zeilen in zusammenhang: Form C"): Sie setzt an jeder Etappennummer aus und beginnt darunter wieder.
 */
const chain = ref<ChainPiece[]>([]);
/** Die Punkte der gewählten Zeile in der Aktivfarbe, mit ihrem Verlauf (Form C). */
const glow = ref<GlowDot[]>([]);

const groupOfStage = computed(() => {
    const byStage = new Map<number, string>();
    for (const item of props.model.items) {
        if (item.kind !== "group") continue;
        for (const index of item.group.stageIndexes) byStage.set(index, item.group.key);
    }
    return byStage;
});

/**
 * Anfang und Ende der Kette, gemessen an den sichtbaren Marken, und ihre Stücke zwischen den Etappennummern.
 *
 * 🔴 **Die Zusicherung aus WI-0079 §1.2 bleibt dieselbe**: Die Kette beginnt in der Mitte der ersten und endet in
 * der Mitte der letzten sichtbaren Marke. Sie wird seit WI-0087 P7 nur über MEHRERE Stücke gemessen - das erste
 * beginnt oben, das letzte endet unten.
 *
 * 🪤 Weniger als zwei Marken ergeben keine Kette: Ein Strich von einem Punkt zu sich selbst sagt nichts.
 */
function measureChain(): void {
    const element = list.value;
    if (!element) return;
    const marks = [...element.querySelectorAll<HTMLElement>(".stages__mark")].filter(
        (mark) => mark.getClientRects().length > 0,
    );
    if (marks.length < 2) {
        chain.value = [];
        glow.value = [];
        return;
    }
    const base = element.getBoundingClientRect();
    /**
     * Wo die Kette eine Marke trifft: in ihrer Mitte - außer die Marke sagt etwas anderes (`data-chain-anchor`).
     * Die Zielnadel nennt ihren Kopf, denn sie zeigt mit der Spitze auf den Boden (`MARK_CHAIN_ANCHOR`).
     */
    const anchor = (mark: HTMLElement): number => {
        const rect = mark.getBoundingClientRect();
        const share = Number(mark.dataset["chainAnchor"] ?? "0.5");
        return rect.top + rect.height * (Number.isFinite(share) ? share : 0.5) - base.top;
    };
    const top = anchor(marks[0] as HTMLElement);
    const bottom = anchor(marks[marks.length - 1] as HTMLElement);
    if (!(bottom > top)) {
        chain.value = [];
        glow.value = [];
        return;
    }
    /**
     * Die Lücken: um jede sichtbare Etappennummer, die Ziffer plus `DIGIT_AIR` oben und unten.
     *
     * 🪤 Die Marken der WEGPUNKTE stehen NICHT hier: Ring und Nadel sind rund und stanzen die Kette weiter mit
     * ihrem deckenden Grund aus. Nur die Etappennummer hat keinen Grund mehr - deshalb bekommt nur sie eine Lücke.
     */
    const gaps = [...element.querySelectorAll<HTMLElement>(".stage__number")]
        .filter((digit) => digit.getClientRects().length > 0)
        .map((digit) => {
            const rect = digit.getBoundingClientRect();
            return { from: rect.top - base.top - DIGIT_AIR, to: rect.bottom - base.top + DIGIT_AIR };
        })
        .sort((left, right) => left.from - right.from);
    const pieces: ChainPiece[] = [];
    const add = (from: number, to: number): void => {
        const height = to - from;
        // Wie viele ganze Punktzellen in das Stück passen; weniger als eine ergibt kein Stück.
        const cells = Math.floor(height / DOT_STEP);
        if (cells < 1) return;
        /**
         * 🔴 **Das Raster setzt an jeder Lücke NEU an** (Betreiber 2026-10-06), statt über die ganze Liste
         * durchzulaufen: So ist die Luft an jeder Ziffer gleich. 🪤 Die Punkte sitzen MITTIG im Stück
         * (`offset`), damit am unteren Ende keiner angeschnitten wird - ein halber Punkt am Rand einer Lücke
         * wäre ein sichtbarer Mangel.
         */
        const offset = (height - cells * DOT_STEP) / 2;
        pieces.push({ top: from, height, offset, cells });
    };
    let cursor = top;
    for (const gap of gaps) {
        if (gap.from > cursor) add(cursor, Math.min(gap.from, bottom));
        cursor = Math.max(cursor, gap.to);
    }
    if (cursor < bottom) add(cursor, bottom);
    chain.value = pieces;
    glow.value = glowDots(element, base, pieces);
}

/**
 * Form C: Die Punkte der Kette auf Höhe der GEWÄHLTEN Zeile tragen die Aktivfarbe und verlaufen darüber und
 * darunter über `GLOW_FADE` in die Grundfarbe zurück - so leuchtet die STRECKE, nicht die Stelle (Betreiber
 * 2026-10-06, „eine etappe ist aber ein längeres stück").
 *
 * 🔴 **Nur die Punkte, nie eine Fläche.** Ein Schein hinter der Ziffer wäre wieder der Kreis, der weg sollte.
 *
 * 🪤 Punkt für Punkt statt als Verlauf über einem Muster: Ein Punkt trägt seine eigene Deckkraft, und das ist in
 * jedem Browser dasselbe Bild. Betroffen ist nur die gewählte Zeile, also eine Handvoll Punkte.
 */
function glowDots(element: HTMLElement, base: DOMRect, pieces: readonly ChainPiece[]): GlowDot[] {
    const row = element.querySelector<HTMLElement>(".stage.is-active");
    if (!row || row.getClientRects().length === 0) return [];
    const rect = row.getBoundingClientRect();
    const from = rect.top - base.top;
    const to = rect.bottom - base.top;
    const dots: GlowDot[] = [];
    for (const piece of pieces) {
        for (let cell = 0; cell < piece.cells; cell += 1) {
            const at = piece.top + piece.offset + cell * DOT_STEP + DOT_STEP / 2;
            // Innerhalb der Zeile voll, darüber und darunter auslaufend.
            const away = at < from ? from - at : at > to ? at - to : 0;
            if (away > GLOW_FADE) continue;
            dots.push({ top: at, opacity: Math.round((1 - away / GLOW_FADE) * 100) / 100 });
        }
    }
    return dots;
}

async function remeasure(): Promise<void> {
    await nextTick();
    measureChain();
}

let observer: ResizeObserver | undefined;
onMounted(() => {
    void remeasure();
    if (typeof ResizeObserver === "undefined" || !list.value) return;
    observer = new ResizeObserver(() => {
        measureChain();
    });
    observer.observe(list.value);
});
onBeforeUnmount(() => {
    observer?.disconnect();
    const element = list.value;
    if (element) for (const group of element.querySelectorAll<HTMLElement>(".group")) stopHeightAnimation(group);
});

/** Die Schlüssel aller Mediengruppen der Liste - die Vorgabe „alle zu“ braucht sie alle (WI-0087 P4). */
const groupKeys = computed(() => props.model.items.flatMap((item) => (item.kind === "group" ? [item.group.key] : [])));

// 🔴 Eine neue Route klappt alle Gruppen ZU (WI-0087 P4) und misst neu.
watch(
    () => props.model,
    () => {
        const keys = new Set(groupKeys.value);
        // 🔴 Die Gruppe einer GEWÄHLTEN Etappe bleibt offen: Rechnet die Reise während des Playmodes neu, darf die
        // laufende Etappe nicht hinter einer zugeklappten Box verschwinden. Das Aufgehen beim Playmode ist
        // ausdrücklich gelobt (Betreiber 2026-10-05) und wird von der neuen Vorgabe nicht ausgehebelt.
        const running = props.selectedStage === null ? undefined : groupOfStage.value.get(props.selectedStage);
        if (running !== undefined) keys.delete(running);
        closed.value = keys;
        void remeasure();
    },
    { immediate: true },
);

/**
 * Wird eine Etappe gewählt, deren Gruppe zu ist, geht sie auf - Liste, Karte, Playmode und Panel teilen die
 * Auswahl (Betreiber 2026-10-05, F8). Danach rückt ihre Zeile ins Bild, sanft und nur so weit wie nötig.
 *
 * 🪤 **Und die Kette wird neu gemessen**: Der Verlauf der Form C hängt an der gewählten Zeile, und ein Wechsel der
 * Auswahl ändert die Höhe der Liste nicht - der `ResizeObserver` meldete sich also nicht.
 */
watch(
    () => props.selectedStage,
    async (index) => {
        if (index === null) {
            glow.value = [];
            return;
        }
        const key = groupOfStage.value.get(index);
        if (key !== undefined && closed.value.has(key)) await toggleGroup(key);
        await nextTick();
        measureChain();
        const row = list.value?.querySelector<HTMLElement>(`[data-stage="${String(index)}"]`);
        row?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    },
);

const changes = new WeakMap<HTMLElement, number>();

async function toggleGroup(key: string): Promise<void> {
    const box = list.value?.querySelector<HTMLElement>(`[data-group="${key}"]`);
    const next = new Set(closed.value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    if (!box) {
        closed.value = next;
        await remeasure();
        return;
    }
    const own = (changes.get(box) ?? 0) + 1;
    changes.set(box, own);
    const from = elementHeight(box);
    stopHeightAnimation(box);
    closed.value = next;
    await nextTick();
    measureChain();
    if (!box.isConnected || changes.get(box) !== own) return;
    await animateHeight(box, from, elementHeight(box));
    if (changes.get(box) === own) measureChain();
}
</script>

<template>
    <ol ref="list" class="stages" :class="{ 'is-stale': stale }" data-testid="route-stages">
        <span
            v-for="(piece, at) in chain"
            :key="`chain-${at}`"
            class="stages__chain"
            aria-hidden="true"
            :style="{
                top: `${piece.top}px`,
                height: `${piece.height}px`,
                backgroundPositionY: `${piece.offset}px`,
            }"
        ></span>
        <span
            v-for="(dot, at) in glow"
            :key="`glow-${at}`"
            class="stages__glow"
            aria-hidden="true"
            :style="{ top: `${dot.top}px`, opacity: dot.opacity }"
        ></span>
        <template v-for="(item, position) in model.items" :key="position">
            <RouteStageStation
                v-if="item.kind === 'station'"
                :station="item.station"
                :stale="stale"
                @open="item.station.ref && emit('showSubject', item.station.ref)"
                @open-territory="item.station.territory && emit('showSubject', item.station.territory.ref)"
            />
            <RouteStageGroup
                v-else-if="item.kind === 'group'"
                :title="item.group.title"
                :icon="item.group.icon"
                :meta="item.group.meta"
                :open="!closed.has(item.group.key)"
                :body-id="`route-stage-group-${item.group.key}`"
                :testid="`stage-group-${item.group.domain}`"
                :treffer="item.group.rows.some((row) => treffer?.has(row.index) === true)"
                :data-group="item.group.key"
                @toggle="toggleGroup(item.group.key)"
            >
                <!-- 🔴 Nur Etappenzeilen: Eine Station steht seit WI-0087 P5 immer auf der obersten Ebene. -->
                <RouteStageRow
                    v-for="row in item.group.rows"
                    :key="row.index"
                    :row="row"
                    :active="row.index === selectedStage"
                    :stale="stale"
                    :treffer="treffer?.has(row.index) === true"
                    @select="emit('selectStage', row.index)"
                    @open-from="row.fromRef && emit('showSubject', row.fromRef)"
                    @open-to="row.toRef && emit('showSubject', row.toRef)"
                    @open-path="row.pathRef && emit('showSubject', row.pathRef)"
                />
            </RouteStageGroup>
            <li v-else class="flight" data-testid="route-flight">
                <div class="flight__head">
                    <span aria-hidden="true"></span>
                    <img v-if="item.flight.icon" class="flight__icon" :src="item.flight.icon" alt="" />
                    <span v-else class="flight__icon" aria-hidden="true"></span>
                    <span class="flight__titles">
                        <span class="flight__title">{{ item.flight.title }}</span>
                        <span class="flight__meta">
                            <template v-for="(value, index) in item.flight.meta" :key="index"
                                ><span v-if="index > 0" class="flight__sep"> · </span><AvmWert :werte="[value]"
                            /></template>
                        </span>
                    </span>
                </div>
                <ul class="flight__body">
                    <template v-for="(row, at) in item.flight.rows" :key="at">
                        <!-- Die Flugliste klappt nicht; ihre Stationen stehen deshalb weiter in ihr (§1.4). -->
                        <RouteStageStation
                            v-if="isStation(row)"
                            :station="row"
                            :stale="stale"
                            @open="row.ref && emit('showSubject', row.ref)"
                            @open-territory="row.territory && emit('showSubject', row.territory.ref)"
                        />
                        <RouteStageRow
                            v-else
                            :row="row"
                            :active="row.index === selectedStage"
                            :stale="stale"
                            :treffer="treffer?.has(row.index) === true"
                            @select="emit('selectStage', row.index)"
                            @open-from="row.fromRef && emit('showSubject', row.fromRef)"
                            @open-to="row.toRef && emit('showSubject', row.toRef)"
                            @open-path="row.pathRef && emit('showSubject', row.pathRef)"
                        />
                    </template>
                </ul>
            </li>
        </template>
    </ol>
</template>

<style scoped>
.stages {
    /*
     * 🔴 **Der Grund, in dem eine Marke die Kette ausstanzt** (WI-0087 P6, Betreiber 2026-10-05: „sowohl
     * wegpunktmarkierungen als auch der tropfen haben keine / eine kaputte transparenz"). Auf der obersten Ebene der
     * Liste liegen die Stationen auf der weichen Panelfläche, nicht auf `--color-panel`; die Klappboxen setzen den
     * Wert für ihr Inneres selbst um (`.group`, `.flight`).
     *
     * 🪤 **Gemessen, nicht geraten** (2026-10-05): Die Stanze stand fest auf `--color-panel` (#fffdf9 hell,
     * #312e26 dunkel), der Grund darunter ist `--color-panel-soft` (#faf6ee / #37342b). Daraus wurde eine sichtbare
     * hellere beziehungsweise dunklere Scheibe um den Ring und ein Kasten hinter der Nadel - es sah aus, als hätte
     * das Zeichen gar keine Transparenz. Seit P5 steht JEDES Zwischenziel auf dieser Ebene, also fiel es auf.
     * Der Wächter dagegen misst die Stanze gegen den wirklichen Grund (`route-stages.spec.ts`).
     */
    --mark-bg: var(--color-panel-soft);
    /* 20 px, damit zwei Ziffern in die Perle passen (gemessen, Begründung in `route-stage-row.vue`). */
    --mark-size: 20px;
    /* Die Mitte der Markenspalte, an der die Kette hängt: wächst die Marke um 2, wächst sie um 1. */
    --mark-center: 16px;
    --leg-gap: 3px;
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--leg-gap);
    margin: 0;
    padding: 0;
    list-style: none;
}

/*
 * Die Kette (§1.2), seit WI-0087 P7 in STÜCKEN. Punkte alle 7 px wie bisher - eine gestrichelte Kante zeichnete nur
 * Striche. Sie liegt unter den Marken (`z-index` 2 gegen deren 3), die sie mit ihrem deckenden Grund ausstanzen.
 *
 * 🔴 Die Zusicherung bleibt: Die Kette beginnt in der Mitte der ersten und endet in der Mitte der letzten sichtbaren
 * Marke - gemessen über alle Stücke. An jeder Etappennummer setzt sie aus, denn die hat keinen Grund mehr.
 */
.stages__chain {
    position: absolute;
    left: calc(var(--mark-center) - 1.5px);
    z-index: 2;
    width: 3px;
    background-image: radial-gradient(circle, var(--color-text-muted) 1.35px, transparent 1.55px);
    background-repeat: repeat-y;
    background-size: 3px 7px;
    pointer-events: none;
}

/*
 * Form C (WI-0087 P7): Die Punkte auf Höhe der gewählten Zeile tragen die Aktivfarbe und laufen darüber und darunter
 * aus - die STRECKE leuchtet, nicht die Stelle. 🔴 Nur Punkte, nie eine Fläche: Ein Schein hinter der Ziffer wäre
 * wieder der Kreis, der weg sollte. Die Deckkraft je Punkt rechnet das Modell (`glowDots`).
 */
.stages__glow {
    position: absolute;
    left: calc(var(--mark-center) - 1.35px);
    z-index: 2;
    width: 2.7px;
    height: 2.7px;
    margin-top: -1.35px;
    border-radius: 50%;
    background: var(--color-marker-active);
    pointer-events: none;
}

/*
 * Während neu gerechnet wird, tritt die Liste zurück - gesperrt heißt hier „geht gerade nicht“, und genau dafür
 * steht Deckkraft in diesem Haus (Guide §30.2).
 */
.stages.is-stale {
    opacity: 0.55;
    pointer-events: none;
}

/* Der Kopf einer Flugliste (§1.4): derselbe Kasten wie eine Gruppe, aber ohne Pfeil - er klappt nicht. */
.flight {
    --mark-bg: var(--color-panel);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-md);
    background: var(--color-disclosure-bg);
    box-shadow: var(--shadow-disclosure);
}

.flight__head {
    display: grid;
    grid-template-columns: var(--mark-size) var(--icon-md) minmax(0, 1fr);
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-4) var(--space-4) calc(var(--space-4) - 1px);
}

.flight__icon {
    width: var(--icon-md);
    height: var(--icon-md);
    object-fit: contain;
}

.flight__titles {
    min-width: 0;
}

.flight__title {
    display: block;
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
    line-height: var(--leading-snug);
}

.flight__meta {
    display: block;
    margin-top: 1px;
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
}

.flight__sep {
    color: var(--color-text-muted);
}

/* Wie der Gruppenkörper: eine zusammenhängende Liste, Haarlinie nur ZWISCHEN den Zeilen (Betreiber 2026-10-05). */
.flight__body {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
}

.flight__body > * + * {
    border-top: 1px solid var(--color-divider);
}

.flight__body > :last-child {
    border-bottom-left-radius: calc(var(--radius-md) - 1px);
    border-bottom-right-radius: calc(var(--radius-md) - 1px);
}
</style>
