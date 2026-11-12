<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { LANDSCAPE_SELECTIONS, type LandscapeSelection } from "@avesmaps3d/shared";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmSegmente from "../controls/avm-segmente.vue";
import EditorZeichen, { type EditorZeichenName } from "../controls/editor-zeichen.vue";
import { t, tPlural } from "../i18n/i18n";
import { stapelText } from "./landschaften-liste";
import UntergrundRegler from "./untergrund-regler.vue";

/**
 * Die Ebenenleiste oben auf der Karte, nur für Editoren am Rechner (WI-0178 T41 (2), (5); EDIT-0003 T41: Der Betreiber wählte „Leiste
 * oben (Empfohlen)“; Blatt „Landschaften verbergen und Ebenen“, I und V; Legacy `#ecosystem-controls`, `index.html:873-917`, Mirror
 * a7f2dac86).
 *
 * - **Die Ebenen** „Alle · Regionen · Vegetation · Topographie · Klimazonen“ gleich breit, die aktive gefüllt (`AvmSegmente`). Sie wählt
 *   dieselbe Ebene wie der Kartenfächer, also keine zweite Wahrheit; Besucher wählen nur dort (Betreiber 2026-09-09 zu Legacy: „Das
 *   Toggle-Button-Menue oben soll fuer regulaere Nutzer verschwinden und ins Faechermenue uebergehen“).
 * - **☰** öffnet die Liste der Landschaften nach ihrer Reihenfolge, wie Legacys Knopf „Reihenfolge und Sperren“. Die Zahl der für Klicks
 *   gesperrten Landschaften der Ebene steht als Pille „⊘ n“ darin und nur, wenn es welche gibt: Sie ist die Auskunft, der Knopf die
 *   Handlung (Legacy `map-features-ecosystem-stapel.js:236-255`, Owner 20.08.2026).
 * - **Das Auge mit Zahl** (neu, T41 (5)): die für Besucher verborgenen Landschaften der Ebene; ein Klick filtert die Liste auf
 *   „verborgen“. Ohne verborgene fehlt es.
 * - **◐ mit Wert** (T47): der Regler „Untergrund“ (`untergrund-regler.vue`), ganz rechts; ein Klick klappt die Reglerzeile auf. ☰ ist
 *   gedrückt, solange die Liste nach Reihenfolge steht (`stapelAn`), wie ☰ in der Leiste der Liste.
 * - **Höhenlinien** stehen nicht mehr hier, sondern im Anzeigemenü (Betreiber 2026-10-20, `hoehenlinien-schalter.ts`).
 * - **Zeichen und Wort** (WI-0225, Betreiber 2026-10-21, wörtlich: „auch die "Derographische" leiste (mit Alle, Regionen, Topographie,
 *   Vegetation und Klima) könnte durch icons ergänzt und vollständig ersetzt werden, wenn das menü in der breite zu klein wird.“): Jeder
 *   Reiter trägt sein Zeichen (`controls/editor-zeichen.vue`, `ebene-*`) vor dem Namen. Passt die Leiste mit Namen nicht in die freie
 *   Breite der Bühne, stehen nur die Zeichen, der Name im Hinweis. Gemessen wird wie bei `fenster/leistenplatz.ts`: die Leiste mit Namen in
 *   EINER Zeile (eine unsichtbare Fassung der Reiter, `mass`, dazu die übrigen Teile) gegen die Bühne, kein fester Wert. Reicht es auch für
 *   die Zeichen nicht, bricht die Leiste um, statt unter Fenster oder Lasche zu laufen.
 * - **Lage** wie die Leiste eines Modus (`fenster/fenster-modusleiste.vue`): oben mittig über der freien Karte zwischen den Panels
 *   (`rand`), als Rand der Karte (`data-map-overlay`), die Höhe meldet sie (`hoehe`). Läuft ein Modus, bleibt sie stehen, und dessen
 *   Leiste steht darunter (WI-0225, `app.vue`); am Telefon gibt es sie nicht.
 */
const props = defineProps<{
    auswahl: LandscapeSelection;
    /** Für Klicks gesperrte Landschaften der gewählten Ebene. */
    gesperrt: number;
    /** Für Besucher verborgene Landschaften der gewählten Ebene. */
    verborgen: number;
    /** Steht die Liste nach Reihenfolge („Reihenfolge und Sperren“)? Dann ist ☰ gedrückt. */
    stapelAn?: boolean | undefined;
    rand?: { links: number; rechts: number } | undefined;
}>();
const emit = defineEmits<{
    waehle: [auswahl: LandscapeSelection];
    stapel: [];
    verborgene: [];
    hoehe: [px: number];
}>();

/**
 * Die Ebenen der Leiste: alle außer „Sprachen“ (Betreiber 2026-10-31: „Kannst du "Sprachen" aus dem Derographie-Menü oben bei "Alle", "Regionen",
 * "Vegetation",... raustun“). Die Sprachen wählt der Kartenfächer (Derographie › Sprachen) und der Spracheditor; steht die Karte dort, ist hier keine
 * Ebene gewählt, und ein Klick führt zurück in die Derographie.
 */
const ebenen = computed(() =>
    LANDSCAPE_SELECTIONS.filter((ebene) => ebene !== "sprachen").map((ebene) => ({
        value: ebene,
        label: t(`layer.${ebene}`),
        hinweis: t(`layer.${ebene}`),
    })),
);
const EBENEN_ZEICHEN: Record<LandscapeSelection, EditorZeichenName> = {
    alle: "ebene-alle",
    derographisch: "ebene-regionen",
    vegetation: "ebene-vegetation",
    topographie: "ebene-topographie",
    klima: "ebene-klima",
    sprachen: "ebene-sprachen",
};
const zeichenVon = (wert: string): EditorZeichenName => EBENEN_ZEICHEN[wert as LandscapeSelection];
const gewaehlt = computed({
    get: (): string => props.auswahl,
    set: (wert: string) => emit("waehle", wert as LandscapeSelection),
});
const stapelSatz = computed(() => stapelText(props.gesperrt));
const verborgenText = computed(() =>
    tPlural("landschaftseditor.ebenenleiste.verborgen", props.verborgen, { n: props.verborgen }),
);

const buehne = ref<HTMLElement>();
const leiste = ref<HTMLElement>();
/** Die Reiter mit Namen, unsichtbar und so breit, wie sie in einer Zeile wären. */
const mass = ref<HTMLElement>();
const nurZeichen = ref(false);
const massWahl = ref<string>("alle");
/** Passt die Leiste mit Namen in die Bühne? Die Teile der Leiste nebeneinander samt Abständen, Polster und Rand (wie `messeBreite`). */
function pruefeBreite(): void {
    const b = buehne.value;
    const l = leiste.value;
    const m = mass.value?.firstElementChild;
    if (!b || !l || !m) return;
    const sb = getComputedStyle(b);
    const platz = b.clientWidth - Number.parseFloat(sb.paddingLeft) - Number.parseFloat(sb.paddingRight);
    const sl = getComputedStyle(l);
    const teile = [...l.children].filter((k) => !k.classList.contains("ebenenleiste__ebenen"));
    const summe = teile.reduce((s, k) => s + k.getBoundingClientRect().width, m.getBoundingClientRect().width);
    const abstand = (Number.parseFloat(sl.columnGap) || 0) * teile.length;
    const rahmen =
        Number.parseFloat(sl.paddingLeft) +
        Number.parseFloat(sl.paddingRight) +
        Number.parseFloat(sl.borderLeftWidth) +
        Number.parseFloat(sl.borderRightWidth);
    nurZeichen.value = summe + abstand + rahmen > platz + 0.5;
}
const messung = new ResizeObserver(([eintrag]) => {
    emit("hoehe", eintrag?.borderBoxSize[0]?.blockSize ?? 0);
    pruefeBreite();
});
onMounted(() => {
    if (buehne.value) messung.observe(buehne.value);
    void document.fonts.ready.then(pruefeBreite);
});
// Der Rand der Bühne (Panels) und die Knöpfe daneben (⊘ n, Auge) ändern die Breite, ohne dass die Bühne selbst wächst.
watch(
    () => [props.rand?.links, props.rand?.rechts, props.gesperrt, props.verborgen],
    () => void nextTick(pruefeBreite),
);
onBeforeUnmount(() => {
    messung.disconnect();
    emit("hoehe", 0);
});
</script>

<template>
    <div
        ref="buehne"
        class="ebenenbuehne"
        :style="rand ? { left: `${String(rand.links)}px`, right: `${String(rand.rechts)}px` } : undefined"
        data-map-overlay="top"
    >
        <div
            ref="leiste"
            class="ebenenleiste"
            :class="{ 'ebenenleiste--zeichen': nurZeichen }"
            role="toolbar"
            :aria-label="t('fan.level.layers')"
            data-testid="ebenenleiste"
        >
            <AvmSegmente
                v-model="gewaehlt"
                class="ebenenleiste__ebenen"
                :options="ebenen"
                :label="t('fan.level.layers')"
                testid="ebenenleiste-ebene"
            >
                <template #zeichen="{ option }">
                    <span class="ebenenleiste__ebene">
                        <EditorZeichen :name="zeichenVon(option.value)" />
                        <span v-if="!nurZeichen" class="einzeilig">{{ option.label }}</span>
                    </span>
                </template>
            </AvmSegmente>
            <AvmKnopf
                class="ebenenleiste__knopf"
                :class="{ 'is-aktiv': gesperrt > 0 }"
                :title="stapelSatz"
                :aria-label="stapelSatz"
                :aria-pressed="stapelAn === true"
                testid="ebenenleiste-stapel"
                @click="emit('stapel')"
            >
                <template #zeichen>☰</template>
                <span v-if="gesperrt > 0" class="ebenenleiste__pille" data-testid="ebenenleiste-gesperrt"
                    >⊘ {{ gesperrt }}</span
                >
            </AvmKnopf>
            <AvmKnopf
                v-if="verborgen > 0"
                class="ebenenleiste__knopf"
                :title="verborgenText"
                :aria-label="verborgenText"
                testid="ebenenleiste-verborgen"
                @click="emit('verborgene')"
            >
                <template #zeichen><EditorZeichen name="verbergen" /></template>
                {{ verborgen }}
            </AvmKnopf>
            <UntergrundRegler testid="ebenenleiste-untergrund" />
        </div>
        <!-- Nur zum Messen: die Reiter mit Namen in einer Zeile, unsichtbar und ohne Bedienung. -->
        <div ref="mass" class="ebenenleiste__mass" aria-hidden="true" inert>
            <AvmSegmente v-model="massWahl" :options="ebenen" :label="t('fan.level.layers')" testid="ebenenleiste-mass">
                <template #zeichen="{ option }">
                    <span class="ebenenleiste__ebene">
                        <EditorZeichen :name="zeichenVon(option.value)" />
                        <span class="einzeilig">{{ option.label }}</span>
                    </span>
                </template>
            </AvmSegmente>
        </div>
    </div>
</template>

<style scoped>
/* Dieselbe Bühne wie die Leiste eines Modus: die freie Karte oben, die Leiste darin mittig, die Laschen daneben frei.
   Eine Stufe über der Leiste des Modus, die darunter steht: Die aufgeklappte Reglerzeile „Untergrund“ läge sonst unter ihr (OPS-000054). */
.ebenenbuehne {
    position: absolute;
    top: var(--space-10);
    right: 0;
    left: 0;
    z-index: calc(var(--z-map-ui) + 1);
    display: flex;
    justify-content: center;
    padding: 0 calc(var(--avesmaps-tab-w) + var(--space-10));
    pointer-events: none;
}

/* Ein Blatt über der Karte wie das Kartenmenü (§18): die Mulde der Ebenen, daneben die zwei Knöpfe. */
.ebenenleiste {
    display: flex;
    align-items: stretch;
    gap: var(--space-6);
    max-width: 100%;
    padding: var(--space-4);
    pointer-events: auto;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-lg);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
}

.ebenenleiste__ebenen {
    flex: 1 1 auto;
    min-width: 0;
}

/* Zeichen vor dem Namen; nur Zeichen, wenn die Leiste mit Namen nicht passt (`nurZeichen`). */
.ebenenleiste__ebene {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
    padding: 0 var(--space-2);
}

.ebenenleiste--zeichen .ebenenleiste__ebenen {
    flex: none;
}

/*
 * Passen auch die Zeichen nicht in eine Zeile (1280 px mit Planer und Fenster), bricht die Leiste um, statt unter Fenster oder Lasche
 * zu laufen: erst ☰ und ◐ in die nächste Reihe, dann die Reiter selbst.
 */
.ebenenleiste--zeichen {
    flex-wrap: wrap;
    justify-content: center;
}

.ebenenleiste--zeichen :deep(.segmente) {
    display: flex;
    flex-wrap: wrap;
}

.ebenenleiste__mass {
    position: absolute;
    top: 0;
    left: 0;
    width: max-content;
    visibility: hidden;
    pointer-events: none;
}

.ebenenleiste__knopf {
    flex: none;
    gap: var(--space-4);
}

/* Ist etwas gesperrt, fällt der Knopf auf, aber nur so weit, wie eine Auskunft darf (Legacy `ecosystem-stapel-open--aktiv`). */
.ebenenleiste__knopf.is-aktiv {
    border-color: var(--color-pill-border);
    color: var(--color-pill-text);
}

.ebenenleiste__pille {
    padding: 0 var(--space-4);
    border: 1px solid var(--color-pill-border);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-caption);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}
</style>
