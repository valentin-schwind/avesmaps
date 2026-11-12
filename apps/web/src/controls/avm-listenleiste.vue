<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, useTemplateRef, watch } from "vue";
import { t } from "../i18n/i18n";
import { suchStufe, type SuchStufe } from "./avm-listenleiste";
import AvmEingabe from "./avm-eingabe.vue";

/**
 * Die Leiste jeder Liste (Betreiber 2026-10-11: „Trichter und Sortierzeichen statt Filterzeilen -> sollten immer rechtsbündig sein.
 * idealerweise ist auch immer eine suchmaske nach freitext links von den beiden“; Design Guide §13.45). EINE Zeile:
 *
 *     [ Suche nach Freitext, nimmt den Rest der Zeile ]  [Trichter] [Sortierzeichen] [weitere Zeichen-Umschalter]
 *
 * Damit stimmt die Anordnung überall, ohne dass jemand sie lesen muss; der Hausregel-Test (R8) verlangt, dass Trichter und Sortierzeichen
 * nur in dieser Leiste stehen.
 *
 * - **Die Suche** ist `AvmEingabe` mit der Art `suche` (Lupe, ✕ zum Leeren). Esc leert sie, solange etwas drinsteht, und gehört dann
 *   ihr: Das Fenster schließt erst beim nächsten Esc. Sie geht von einer Feldbreite aus und wächst in den Rest der Zeile.
 * - **Rechts** stehen die Zeichen in der Reihenfolge Trichter, Sortierung, Umschalter (Slot); sie schrumpfen nie.
 * - Die Liste hält ihren Suchtext selbst (`v-model`) und entscheidet, worin gesucht wird.
 * - 🔴 **Eine Höhe** (Koordination 2026-10-12): Die Leiste setzt die Bedienhöhe für alles darin, am Finger 44 px (Apple HIG, dasselbe
 *   Maß wie Trichter und Sortierung), sonst 32 px. Feld, Zeichen und Segmente lesen sie aus `--avm-control-h`.
 * - 🔴 **Ein Platzhalter wird nie abgeschnitten** (Koordination 2026-10-11): Passt er nicht in das Feld, steht dort nur „Suchen …“. Der
 *   volle Text bleibt als Hinweis beim Überfahren (`title`), der Name des Felds für Vorleser ist `beschriftung`. Gemessen mit der Schrift
 *   des Felds, neu bei jeder Größenänderung der Zeile und der Zeichen.
 * - 🔴 **Passt nicht einmal „Suchen …“, wird die Suche ein Lupen-Knopf** in der Größe der Zeichen (Koordination 2026-10-12). Ein Tipp
 *   öffnet das Feld über die ganze Zeile, die Zeichen weichen solange. ✕ und Esc leeren und schließen; die Eingabetaste und ein Tipp
 *   daneben schließen und behalten den Text. Ist ein Suchtext gesetzt, ist die Lupe markiert wie der Trichter mit gesetzten Filtern
 *   (goldene Kante), und ihr Name nennt den Text. Keine zweite Zeile.
 */
const props = defineProps<{
    /** Der Platzhalter („Titel oder Reihe suchen“). */
    platzhalter: string;
    /** Der Name des Felds für Vorleser („Literatur durchsuchen“). */
    beschriftung: string;
    testid?: string | undefined;
}>();
const suche = defineModel<string>({ default: "" });

const huelle = useTemplateRef<HTMLDivElement>("huelle");
const zeichen = useTemplateRef<HTMLSpanElement>("zeichen");
const eingabe = useTemplateRef<InstanceType<typeof AvmEingabe>>("eingabe");
const lupe = useTemplateRef<HTMLButtonElement>("lupe");
const feldId = useId();
const kennung = (zusatz: string): string | undefined =>
    props.testid === undefined ? undefined : `${props.testid}${zusatz}`;

/** Die Stufe neben den Zeichen und die Stufe der aufgeklappten Suche, die die ganze Zeile hat (bis zur ersten Messung „Suchen …“). */
const stufe = ref<SuchStufe>("voll");
const stufeOffen = ref<SuchStufe>("kurz");
const offen = ref(false);
const knopf = computed(() => stufe.value === "knopf");
const aufgeklappt = computed(() => knopf.value && offen.value);
const platzhalter = computed(() =>
    (aufgeklappt.value ? stufeOffen.value : stufe.value) === "voll" ? props.platzhalter : t("controls.suche.kurz"),
);
const lupenName = computed(() =>
    suche.value === ""
        ? props.beschriftung
        : t("controls.suche.gesetzt", { name: props.beschriftung, text: suche.value }),
);

let messer: CanvasRenderingContext2D | null | undefined;
let beobachter: ResizeObserver | undefined;
/** Was die Suche außer dem Text braucht: Rahmen, Lupe und Polster, ohne das ✕ (das kommt mit Text, und dann steht kein Platzhalter da). */
let rand: number | undefined;

function pruefe(): void {
    const leiste = huelle.value;
    const feld = leiste?.querySelector<HTMLInputElement>("input");
    const rahmen = feld?.parentElement;
    if (leiste === null || leiste === undefined || feld === null || feld === undefined || !rahmen) return;
    messer ??= document.createElement("canvas").getContext("2d");
    if (messer === null) return;
    const stil = getComputedStyle(feld);
    // Nur ein sichtbares Feld lässt sich vermessen; als Lupen-Knopf gilt der zuletzt gemessene Rand.
    if (rahmen.offsetWidth > 0) {
        rand =
            feld.getBoundingClientRect().left -
            rahmen.getBoundingClientRect().left +
            parseFloat(stil.paddingLeft) +
            parseFloat(stil.paddingRight) +
            (rahmen.offsetWidth - rahmen.clientWidth - rahmen.clientLeft);
    }
    if (rand === undefined) return;
    messer.font = stil.font;
    const voll = messer.measureText(props.platzhalter).width;
    const kurz = messer.measureText(t("controls.suche.kurz")).width;
    const zeile = leiste.clientWidth;
    // Die Zeichen behalten ihre Breite, auch während sie der offenen Suche weichen (sie sind dann nur unsichtbar).
    const breiteZeichen = zeichen.value?.offsetWidth ?? 0;
    const neben = breiteZeichen === 0 ? zeile : zeile - breiteZeichen - parseFloat(getComputedStyle(leiste).columnGap);
    stufe.value = suchStufe(neben - rand, voll, kurz);
    // Aufgeklappt steht das ✕ immer da und nimmt Platz: gemessen wird das Feld selbst.
    if (aufgeklappt.value && rahmen.offsetWidth > 0) {
        stufeOffen.value = suchStufe(
            feld.clientWidth - parseFloat(stil.paddingLeft) - parseFloat(stil.paddingRight),
            voll,
            kurz,
        );
    }
}

async function oeffne(): Promise<void> {
    offen.value = true;
    await nextTick();
    pruefe();
    eingabe.value?.focus();
}

/** Schließt die aufgeklappte Suche; nach Esc, ✕ oder Eingabe steht der Fokus wieder auf der Lupe. */
async function schliesse(fokus: boolean): Promise<void> {
    offen.value = false;
    if (!fokus) return;
    await nextTick();
    lupe.value?.focus();
}

onMounted(() => {
    pruefe();
    if (typeof ResizeObserver !== "undefined") {
        beobachter = new ResizeObserver(() => pruefe());
        if (huelle.value !== null) beobachter.observe(huelle.value);
        if (zeichen.value !== null) beobachter.observe(zeichen.value);
    }
    // Die Breiten stimmen erst mit der geladenen Schrift.
    void document.fonts?.ready.then(pruefe);
});
watch(() => props.platzhalter, pruefe);
watch(knopf, (istKnopf) => {
    if (!istKnopf) offen.value = false;
});
onBeforeUnmount(() => beobachter?.disconnect());

function onTaste(event: KeyboardEvent): void {
    if (event.key === "Enter" && aufgeklappt.value) {
        event.preventDefault();
        void schliesse(true);
        return;
    }
    if (event.key !== "Escape" || (suche.value === "" && !aufgeklappt.value)) return;
    event.preventDefault();
    event.stopPropagation();
    suche.value = "";
    if (aufgeklappt.value) void schliesse(true);
}

function onGeleert(): void {
    if (aufgeklappt.value) void schliesse(true);
}

/** Ein Tipp daneben schließt die aufgeklappte Suche und behält den Text. */
function onFokusWeg(event: FocusEvent): void {
    if (!aufgeklappt.value) return;
    const ziel = event.relatedTarget;
    if (ziel instanceof Node && huelle.value?.contains(ziel) === true) return;
    void schliesse(false);
}
</script>

<template>
    <div
        ref="huelle"
        class="listenleiste"
        :class="{ 'is-offen': aufgeklappt }"
        :data-testid="props.testid"
        @focusout="onFokusWeg"
    >
        <button
            v-if="knopf"
            ref="lupe"
            type="button"
            class="listenleiste__lupe"
            :class="{ 'is-aktiv': suche !== '' }"
            :aria-label="lupenName"
            :title="lupenName"
            :aria-expanded="offen"
            :aria-controls="feldId"
            :data-testid="kennung('-lupe')"
            @click="oeffne"
        >
            <svg class="listenleiste__lupenzeichen" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <circle cx="6.5" cy="6.5" r="4.75" fill="none" stroke="currentColor" stroke-width="1.5" />
                <path
                    d="M10 10l4.25 4.25"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                />
            </svg>
        </button>
        <AvmEingabe
            v-show="!knopf || offen"
            :id="feldId"
            ref="eingabe"
            v-model="suche"
            art="suche"
            class="listenleiste__suche"
            :placeholder="platzhalter"
            :title="props.platzhalter"
            :aria-label="props.beschriftung"
            :schliessbar="aufgeklappt"
            :testid="kennung('-suche')"
            @keydown="onTaste"
            @geleert="onGeleert"
        />
        <span ref="zeichen" class="listenleiste__zeichen" :inert="aufgeklappt"><slot /></span>
    </div>
</template>

<style scoped>
.listenleiste {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
}

/* Am Finger ein Fingerziel für alles in der Leiste (44 px, wie Trichter und Sortierung schon); sonst die Bedienhöhe des Hauses. */
@media (pointer: coarse) {
    .listenleiste {
        --avm-control-h: 44px;
    }
}

/* Von einer Feldbreite aus in den Rest der Zeile; eine Flex-Zeile bricht nach der Ausgangsbreite um, bevor etwas schrumpft. */
.listenleiste__suche {
    flex: 1 1 12em;
    min-width: 0;
}

/* Aufgeklappt liegt die Suche über der ganzen Zeile; die Zeichen behalten ihren Platz, damit nichts springt. */
.listenleiste.is-offen .listenleiste__suche {
    position: absolute;
    inset: 0;
    animation: listenleiste-auf 120ms ease;
}

.listenleiste.is-offen .listenleiste__zeichen,
.listenleiste.is-offen .listenleiste__lupe {
    visibility: hidden;
}

.listenleiste__zeichen {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: var(--space-4);
    margin-left: auto;
}

.listenleiste__zeichen:empty {
    display: none;
}

/* Der Lupen-Knopf in Fassung und Zuständen des Trichters (`AvmFilterknopf`, §30.5): quadratisch in Bedienhöhe. */
.listenleiste__lupe {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: var(--avm-control-h);
    height: var(--avm-control-h);
    margin: 0;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-panel);
    color: var(--color-text-muted);
    cursor: pointer;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        color 120ms ease,
        box-shadow 120ms ease;
}

.listenleiste__lupe.is-aktiv {
    border-color: var(--color-accent-strong);
    color: var(--color-text-strong);
}

/* §30.1: Die Lasur liegt ÜBER der Fassung (geschichtet), sie ersetzt sie nicht. */
.listenleiste__lupe:hover {
    border-color: var(--color-border-strong);
    background-image: linear-gradient(var(--color-hover-wash), var(--color-hover-wash));
    color: var(--color-text-strong);
}

.listenleiste__lupe:active {
    border-color: var(--color-border-strong);
    background-image: linear-gradient(var(--color-active-wash), var(--color-active-wash));
    color: var(--color-text-strong);
}

.listenleiste__lupe:focus-visible {
    outline: none;
    border-color: var(--color-accent-strong);
    box-shadow: var(--focus-ring);
}

.listenleiste__lupenzeichen {
    display: block;
    width: var(--icon-sm);
    height: var(--icon-sm);
}

@keyframes listenleiste-auf {
    from {
        opacity: 0;
    }
}

@media (prefers-reduced-motion: reduce) {
    .listenleiste__lupe {
        transition: none;
    }

    .listenleiste.is-offen .listenleiste__suche {
        animation: none;
    }
}
</style>
