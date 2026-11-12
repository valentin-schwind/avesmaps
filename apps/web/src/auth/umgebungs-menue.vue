<script setup lang="ts">
/**
 * Die Pille der Umgebung in der Kopfleiste und ihr Menü (WI-0180; Probierseite Fassung 4, Entscheidungen in WI-0180 §5).
 *
 * - **Ohne das Recht** `switch_environment` (nur Betreiber) bleibt sie die Angabe von bisher (`AvmPille`).
 * - **Ein freies Ziel** (Stage ↔ Production): Die Pille ist ein Link mit ⇄ und springt direkt („bei zwei zielen: springt direkt“).
 * - **Sonst** öffnet sie die Tafel: je Umgebung Pille, Host, Stand und Hinweis, die aktuelle mit der Marke ● in eigener Spalte und
 *   als gewählte Zeile (wie jedes Menü mit einer Wahl im Haus, `avm-menueknopf.vue`), eine gesperrte Stage mit ihrem Satz.
 * - Ein Klick wechselt im selben Tab; die Einträge sind echte Links, also öffnen Strg+Klick und Mittelklick daneben.
 * - Den Stand liefert `GET /api/admin/system/umgebungen` (eigener `RELEASE_ID` und der der Gegenseite); fehlt er, fehlt die Zeile.
 * - **Lokal als Ziel** (WI-0180 §11): Dieselbe Route nennt die Adresse von Lokal. Mit „immer“ steht Lokal oben in der Tafel, mit
 *   „wenn erreichbar“ nur, wenn die Probe ins Tailnet antwortet (`lokal-probe.ts`). Stand und Probe laufen beim Laden, nicht erst
 *   beim Klick: Die Pille muss vorher wissen, ob sie springt (ein Ziel) oder die Tafel öffnet (zwei). Chrome fragt dafür beim
 *   ersten Mal nach „Geräten im lokalen Netzwerk“ (§7).
 *
 * 🪤 Die Adresse ist kein reaktiver Wert, und ihr Fragment wandert mit jedem Kartenzug (`map/view-state.ts`, `replaceState`). Ein
 * `computed` ohne Anstoß berechnete sich einmal und trüge den Ausschnitt von damals. Deshalb liest `eintraege` die Adresse neu,
 * sobald sich `frisch` ändert: beim Öffnen der Tafel und beim Zeigen, Fokussieren oder Drücken der Sprungpille.
 */
import {
    computed,
    inject,
    nextTick,
    onBeforeUnmount,
    onMounted,
    ref,
    shallowRef,
    useId,
    useTemplateRef,
    watch,
} from "vue";
import { UMGEBUNGEN_URL, releaseStand, type UmgebungenStand } from "@avesmaps3d/shared";
import AvmPille from "../controls/avm-pille.vue";
import AvmPillenknopf from "../controls/avm-pillenknopf.vue";
import { t, type MessageKey } from "../i18n/i18n";
import { ESCAPE_CASCADE_KEY } from "../keyboard/escape-cascade";
import { getJson } from "./api";
import { lokalErreichbar } from "./lokal-probe";
import { sprungziel, stageGesehen, umgebungsEintraege, type Umgebung, type UmgebungsEintrag } from "./umgebungswechsel";

const props = defineProps<{
    umgebung: string | null;
    /** Das Recht `switch_environment` (nur Betreiber). */
    darf: boolean;
}>();

const PILLE: Record<Umgebung, { text: MessageKey; ton: "warnung" | "erfolg" | "lokal" }> = {
    development: { text: "auth.environment.development", ton: "lokal" },
    staging: { text: "auth.environment.stage", ton: "warnung" },
    production: { text: "auth.environment.production", ton: "erfolg" },
};
const HINWEIS: Record<Umgebung, MessageKey> = {
    development: "auth.environment.hint.development",
    staging: "auth.environment.hint.staging",
    production: "auth.environment.hint.production",
};
/** Lokal als Ziel aus Stage oder Production heißt „über Tailscale“, nicht „nur auf diesem Rechner“. */
const hinweis = (eintrag: UmgebungsEintrag): MessageKey =>
    eintrag.umgebung === "development" && !eintrag.aktuell
        ? "auth.environment.hint.tailnet"
        : HINWEIS[eintrag.umgebung];

const pille = computed(() =>
    props.umgebung !== null && props.umgebung in PILLE ? PILLE[props.umgebung as Umgebung] : null,
);

const offen = ref(false);
const frisch = ref(0);
const eintraege = computed<UmgebungsEintrag[] | undefined>(() => {
    void frisch.value;
    void offen.value;
    const { hostname = "", host = "", pathname = "", search = "", hash = "" } = globalThis.location ?? {};
    return umgebungsEintraege(
        props.darf,
        props.umgebung,
        { hostname, host, pathname, search, hash },
        stageGesehen(globalThis.document?.cookie ?? ""),
        lokalZiel.value,
    );
});
const sprung = computed(() => (eintraege.value === undefined ? undefined : sprungziel(eintraege.value)));
const auffrischen = (): void => {
    frisch.value += 1;
    void ladeStand();
};

// --- Der Stand je Umgebung und Lokal --------------------------------------------------------------------------------------

const stand = shallowRef<UmgebungenStand | null>(null);
/** Antwortet Lokal diesem Browser? `null`: noch nicht gefragt. Einmal je Seite; die Antwort ändert sich nicht im Takt. */
const lokalOk = ref<boolean | null>(null);
const lokalZiel = computed(() => {
    const lokal = stand.value?.lokal;
    if (lokal === null || lokal === undefined) return undefined;
    return lokal.imMenue === "immer" || lokalOk.value === true ? { adresse: lokal.adresse } : undefined;
});
let laedt = false;
async function ladeStand(): Promise<void> {
    if (!props.darf || laedt) return;
    laedt = true;
    try {
        stand.value = await getJson<UmgebungenStand>(UMGEBUNGEN_URL);
    } catch {
        // Ohne zweiten Faktor (Stufe V) oder ohne Gegenseite bleibt der Stand weg; das Menü wechselt trotzdem.
        stand.value = null;
    } finally {
        laedt = false;
    }
    const lokal = stand.value?.lokal;
    if (lokal?.imMenue === "erreichbar" && props.umgebung !== "development" && lokalOk.value === null) {
        lokalOk.value = false;
        lokalOk.value = await lokalErreichbar(lokal.adresse);
    }
}
onMounted(() => void ladeStand());

function releaseVon(umgebung: Umgebung): string | null {
    const s = stand.value;
    if (s === null) return null;
    if (umgebung === props.umgebung) return s.eigene.releaseId;
    return s.gegenseite?.erreichbar === true ? s.gegenseite.releaseId : null;
}

const sprache = (): string | undefined => globalThis.document?.documentElement.lang || undefined;

/** „Stand 16.10., 16:30 · 6e6dee0“; lokal „Arbeitsstand, nicht veröffentlicht“; unbekannt: null. */
function standText(umgebung: Umgebung): string | null {
    if (umgebung === "development") return umgebung === props.umgebung ? t("auth.environment.standLocal") : null;
    const zerlegt = releaseStand(releaseVon(umgebung));
    if (zerlegt === null) return null;
    return t("auth.environment.stand", {
        datum: zerlegt.zeit.toLocaleDateString(sprache(), { day: "2-digit", month: "2-digit" }),
        zeit: zerlegt.zeit.toLocaleTimeString(sprache(), { hour: "2-digit", minute: "2-digit" }),
        commit: zerlegt.commit,
    });
}

/** Ob Stage oder Production neuer ist; nur, wenn beide Stände bekannt sind. */
const vergleich = computed(() => {
    const stage = releaseStand(releaseVon("staging"));
    const production = releaseStand(releaseVon("production"));
    if (stage === null || production === null) return null;
    if (stage.commit === production.commit) return t("auth.environment.compare.same");
    return t(
        stage.zeit > production.zeit
            ? "auth.environment.compare.stageNewer"
            : "auth.environment.compare.productionNewer",
    );
});

const sprungTitel = computed(() => {
    const ziel = sprung.value;
    if (ziel === undefined) return undefined;
    const name = t(PILLE[ziel.umgebung].text);
    const zeile = standText(ziel.umgebung);
    return zeile === null
        ? t("auth.environment.switchTo", { ziel: name })
        : `${t("auth.environment.switchTo", { ziel: name })} · ${zeile}`;
});

// --- Öffnen, Schließen, Tasten ---------------------------------------------------------------------------------------------

const huelle = useTemplateRef<HTMLElement>("huelle");
const klappe = useTemplateRef<HTMLElement>("klappe");
const ausloeser = useTemplateRef<InstanceType<typeof AvmPillenknopf>>("ausloeser");
const sperrId = useId();

function eintragsElemente(): HTMLElement[] {
    return [...(klappe.value?.querySelectorAll<HTMLElement>("[role='menuitemradio']") ?? [])];
}

async function oeffnen(): Promise<void> {
    offen.value = true;
    auffrischen();
    await nextTick();
    // Die Tafel bleibt im Fenster: Steht die Pille weit rechts (Telefon), rückt sie nach links.
    const element = klappe.value;
    if (element !== null) {
        element.style.left = "";
        const ueber = element.getBoundingClientRect().right - (globalThis.innerWidth - 10);
        if (ueber > 0) element.style.left = `${String(-ueber)}px`;
    }
    (
        eintragsElemente().find(
            (e) => e.getAttribute("aria-checked") === "false" && !e.hasAttribute("aria-disabled"),
        ) ?? eintragsElemente()[0]
    )?.focus();
}

function schliessen(fokusZurueck = true): void {
    if (!offen.value) return;
    offen.value = false;
    if (fokusZurueck) (ausloeser.value?.$el as HTMLElement | undefined)?.focus();
}

function umschalten(): void {
    if (offen.value) schliessen();
    else void oeffnen();
}

function taste(event: KeyboardEvent): void {
    const liste = eintragsElemente();
    const jetzt = liste.indexOf(document.activeElement as HTMLElement);
    let ziel: HTMLElement | undefined;
    if (event.key === "ArrowDown") ziel = liste[(jetzt + 1) % liste.length];
    else if (event.key === "ArrowUp") ziel = liste[(jetzt - 1 + liste.length) % liste.length];
    else if (event.key === "Home") ziel = liste[0];
    else if (event.key === "End") ziel = liste.at(-1);
    else if (event.key === "Escape") {
        event.stopPropagation();
        event.preventDefault();
        schliessen();
        return;
    } else if (event.key === "Tab") {
        schliessen(false);
        return;
    } else return;
    event.preventDefault();
    ziel?.focus();
}

function aussen(event: PointerEvent): void {
    if (huelle.value !== null && !huelle.value.contains(event.target as Node)) schliessen(false);
}
watch(offen, (jetzt) => {
    if (jetzt) document.addEventListener("pointerdown", aussen, true);
    else document.removeEventListener("pointerdown", aussen, true);
});
const kaskade = inject(ESCAPE_CASCADE_KEY, undefined);
const abmelden = kaskade?.register("menus", () => {
    if (!offen.value) return false;
    schliessen();
    return true;
});
onBeforeUnmount(() => {
    abmelden?.();
    document.removeEventListener("pointerdown", aussen, true);
});
</script>

<template>
    <span v-if="pille !== null" ref="huelle" class="umgebung">
        <AvmPille v-if="eintraege === undefined" :ton="pille.ton" testid="kopfleiste-umgebung">{{
            t(pille.text)
        }}</AvmPille>
        <AvmPillenknopf
            v-else-if="sprung !== undefined"
            :ton="pille.ton"
            :href="sprung.ziel"
            :title="sprungTitel"
            :aria-label="sprungTitel"
            testid="kopfleiste-umgebung"
            @pointerenter="auffrischen"
            @pointerdown="auffrischen"
            @focus="auffrischen"
        >
            {{ t(pille.text) }}
            <template #zeichen>
                <svg viewBox="0 0 10 10">
                    <path
                        d="M1.5 3.5h6.5M6 1.5l2 2-2 2M8.5 6.5H2M4 4.5l-2 2 2 2"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    />
                </svg>
            </template>
        </AvmPillenknopf>
        <template v-else>
            <AvmPillenknopf
                ref="ausloeser"
                :ton="pille.ton"
                :aria-label="t('auth.environment.menu')"
                aria-haspopup="menu"
                :aria-expanded="offen"
                testid="kopfleiste-umgebung"
                @click="umschalten"
            >
                {{ t(pille.text) }}
                <template #zeichen>
                    <svg class="umgebung__pfeil" :class="{ 'umgebung__pfeil--offen': offen }" viewBox="0 0 10 10">
                        <path
                            d="M2.5 3.8 5 6.3l2.5-2.5"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.5"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        />
                    </svg>
                </template>
            </AvmPillenknopf>
            <div
                v-if="offen"
                ref="klappe"
                class="tafel"
                role="menu"
                :aria-label="t('auth.environment.menu')"
                data-testid="umgebungsmenue"
                @keydown="taste"
            >
                <span class="tafel__titel" aria-hidden="true">{{ t("auth.environment.menuTitle") }}</span>
                <template v-for="eintrag in eintraege" :key="eintrag.umgebung">
                    <a
                        v-if="eintrag.ziel !== undefined && !eintrag.gesperrt"
                        class="tafel__eintrag"
                        role="menuitemradio"
                        aria-checked="false"
                        :href="eintrag.ziel"
                        :data-testid="`umgebung-${eintrag.umgebung}`"
                    >
                        <span class="tafel__marke" aria-hidden="true"></span>
                        <span class="tafel__inhalt">
                            <span class="tafel__kopf">
                                <AvmPille :ton="PILLE[eintrag.umgebung].ton">{{
                                    t(PILLE[eintrag.umgebung].text)
                                }}</AvmPille>
                                <span class="tafel__host">{{ eintrag.host }}</span>
                            </span>
                            <span v-if="standText(eintrag.umgebung) !== null" class="tafel__stand">{{
                                standText(eintrag.umgebung)
                            }}</span>
                            <span class="tafel__hinweis">{{ t(hinweis(eintrag)) }}</span>
                        </span>
                    </a>
                    <span
                        v-else
                        class="tafel__eintrag"
                        :class="{
                            'tafel__eintrag--aktuell': eintrag.aktuell,
                            'tafel__eintrag--gesperrt': eintrag.gesperrt,
                        }"
                        role="menuitemradio"
                        :aria-checked="eintrag.aktuell"
                        :aria-disabled="eintrag.gesperrt ? 'true' : undefined"
                        :aria-describedby="eintrag.gesperrt ? sperrId : undefined"
                        tabindex="-1"
                        :data-testid="`umgebung-${eintrag.umgebung}`"
                        @click="eintrag.aktuell && schliessen()"
                    >
                        <span class="tafel__marke" aria-hidden="true"></span>
                        <span class="tafel__inhalt">
                            <span class="tafel__kopf">
                                <AvmPille :ton="PILLE[eintrag.umgebung].ton">{{
                                    t(PILLE[eintrag.umgebung].text)
                                }}</AvmPille>
                                <span class="tafel__host">{{ eintrag.host }}</span>
                            </span>
                            <span v-if="standText(eintrag.umgebung) !== null" class="tafel__stand">{{
                                standText(eintrag.umgebung)
                            }}</span>
                            <span class="tafel__hinweis">{{ t(hinweis(eintrag)) }}</span>
                            <span v-if="eintrag.gesperrt" :id="sperrId" class="tafel__sperrgrund">{{
                                t("auth.environment.stageLocked")
                            }}</span>
                        </span>
                    </span>
                </template>
                <span class="tafel__fuss">
                    <template v-if="vergleich !== null">{{ vergleich }}<br /></template>
                    {{ t("auth.environment.carriesOver") }}
                </span>
            </div>
        </template>
    </span>
</template>

<style scoped>
.umgebung {
    position: relative;
    display: inline-flex;
    flex: none;
}

.umgebung__pfeil {
    transition: transform 120ms ease;
}

.umgebung__pfeil--offen {
    transform: rotate(180deg);
}

/*
 * Das Blatt wie das Hauptmenü (`konto-menue.vue`, Guide §18). Es hängt an der Pille und schließt unten mit dem Hauptmenü ab:
 * Die Pille ist um die halbe Differenz zur Bedienhöhe tiefer gesetzt als der Knopf ☰.
 */
.tafel {
    position: absolute;
    top: calc(100% + (var(--avm-control-h) - var(--space-20)) / 2 + var(--space-6));
    left: 0;
    z-index: 1;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    width: max-content;
    min-width: calc(var(--avesmaps-infopanel-width) * 0.75);
    max-width: calc(100vw - 2 * var(--space-10));
    padding: var(--space-6);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    color: var(--color-text);
    font-size: var(--font-size-body);
    text-align: left;
}

.tafel__titel {
    padding: var(--space-4) var(--space-6) var(--space-2);
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

/* Eine eigene Spalte für die Marke, wie im Kartenmenü und im Menüknopf. */
.tafel__eintrag {
    display: grid;
    grid-template-columns: 1em minmax(0, 1fr);
    column-gap: var(--space-6);
    align-items: start;
    padding: var(--space-4) var(--space-10) var(--space-4) var(--space-6);
    border-radius: var(--radius-md);
    color: var(--color-text);
    cursor: pointer;
    text-decoration: none;
    transition: background-color 120ms ease;
}

a.tafel__eintrag:hover,
a.tafel__eintrag:focus-visible {
    background: var(--color-hover-wash);
    color: var(--color-text-strong);
}

.tafel__eintrag:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

/* Die aktuelle Umgebung: Marke ● und gewählte Zeile (Guide §11 „Ausgewählte Zeile“). */
.tafel__eintrag--aktuell {
    background: var(--color-panel-active);
    cursor: default;
}

.tafel__eintrag--aktuell .tafel__marke::before {
    content: "●";
}

/* Gesperrt heißt die Farben „gesperrt“ des Kanons und ein sichtbarer Satz (Guide §7), nie Deckkraft. */
.tafel__eintrag--gesperrt {
    color: var(--color-disabled-text);
    cursor: not-allowed;
}

.tafel__eintrag--gesperrt :deep(.pille) {
    border-color: var(--color-disabled-border);
    background: var(--color-disabled-bg);
    color: var(--color-disabled-text);
}

.tafel__eintrag--gesperrt .tafel__host,
.tafel__eintrag--gesperrt .tafel__stand,
.tafel__eintrag--gesperrt .tafel__hinweis {
    color: var(--color-disabled-text);
}

.tafel__marke {
    display: grid;
    place-items: center;
    height: var(--space-20);
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
}

.tafel__inhalt {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.tafel__kopf {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    min-width: 0;
}

.tafel__host {
    color: var(--color-text-strong);
    white-space: nowrap;
}

.tafel__stand {
    color: var(--color-text);
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
}

.tafel__hinweis,
.tafel__sperrgrund {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
}

.tafel__fuss {
    margin: var(--space-4) var(--space-4) 0;
    padding: var(--space-6) var(--space-6) var(--space-2);
    border-top: 1px solid var(--color-divider);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
}

@media (prefers-reduced-motion: reduce) {
    .umgebung__pfeil,
    .tafel__eintrag {
        transition: none;
    }
}
</style>
