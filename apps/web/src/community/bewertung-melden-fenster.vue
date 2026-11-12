<script setup lang="ts">
import { computed, onMounted, reactive, ref, useId } from "vue";
import { BEWERTUNG_GRENZEN, BEWERTUNG_GRUENDE } from "@avesmaps3d/shared";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmKopierfeld from "../controls/avm-kopierfeld.vue";
import AvmPille from "../controls/avm-pille.vue";
import AvmTextbereich from "../controls/avm-textbereich.vue";
import AvmFenster from "../fenster/avm-fenster.vue";
import type { FensterBox, FensterHuellenLage } from "../fenster/fenster-lage";
import type { MessageKey } from "../i18n/de";
import { t } from "../i18n/i18n";
import { ladeStand, neuesFormular, statusAdresse, type FehlerArt } from "./api";
import { sendeBewertungsMeldung } from "./bewertung-api";
import { BEWERTUNG_MELDEN_ABLEHNUNG, besucherSatz } from "./besucher-ablehnung";
import { leererMeldeEntwurf, meldeBody, meldeSperrGrund } from "./bewertung-modell";
import type { BewertungsMeldungsZiel } from "./community-besucher";

/**
 * „Bewertung melden“ (WI-0269 C10; Bedienkonzept §6.3, Fachkonzept §14.5): das Fenster zu ⚑ an einer Bewertung. Oben die Bewertung als Zitat (Sterne, Autorzeile, Text), dann „Was stimmt nicht?“ mit den fünf Gründen
 * (Beleidigend · Werbung oder Spam · Falscher Ort · Persönliche Daten · Sonstiges), die Beschreibung (freiwillig, höchstens 2000 Zeichen) und der Hinweis, dass die Meldung nicht öffentlich ist. Keine Quelle:
 * Das Feld entfällt hier.
 *
 * Daraus wird ein normaler Vorgang (COM-…) im Reiter Meldungen der Redaktion; die Bestätigung nennt die Nummer und den Link zur Statusseite wie beim Meldeformular. Netz weg, Grenze (429) und Honigtopf
 * verhalten sich wie dort (ADR-0019, Fachkonzept §10.5). Ein Werkzeugfenster der Hülle: angedockt, ⧉ lösen, ▥ andocken, ohne Ablage, nur so hoch wie der Inhalt.
 */
const offen = defineModel<boolean>("offen", { required: true });
const props = defineProps<{
    ziel: BewertungsMeldungsZiel;
    lage: FensterHuellenLage;
    box?: FensterBox | undefined;
}>();
const emit = defineEmits<{
    "update:lage": [lage: Exclude<FensterHuellenLage, "modal">, box?: FensterBox];
    "update:box": [box: FensterBox];
    vorn: [];
    /** „Statusseite öffnen“ nach der Bestätigung. */
    status: [schluessel: string];
}>();

const kennung = neuesFormular();
const geoeffnet = performance.now();
const entwurf = reactive(leererMeldeEntwurf());
const moeglich = ref<boolean | undefined>(undefined);
const sendet = ref(false);
/** Der Satz zum Fehler, schon in der Sprache (WI-0291: der genaue Grund des Servers, sonst der allgemeine Satz). */
const problem = ref<string | undefined>(undefined);
const nummer = ref<string | undefined>(undefined);
const kennungId = useId();

onMounted(() => {
    void ladeStand().then((geht) => {
        moeglich.value = geht;
    });
});

const FEHLER_SATZ: Readonly<Record<FehlerArt, MessageKey>> = {
    netz: "community.fehler.netz",
    zu_viele: "community.fehler.zuViele",
    nicht_moeglich: "bewertungen.nichtMoeglich",
    // Eigener Rückfall: „Text, Name und Datum prüfen“ nennt Felder, die es beim Melden nicht gibt (WI-0291).
    ungueltig: "bewertungen.ablehnung.meldenUngueltig",
    nicht_gefunden: "bewertungen.fehler.fehlt",
    sonst: "community.fehler.sonst",
};

const gruende = BEWERTUNG_GRUENDE.map((wert) => ({ wert, text: t(`bewertungen.grund.${wert}` as MessageKey) }));
const sterneSatz = computed(() => t("infoPanel.reviews.starsLabel", { n: props.ziel.bewertung.stars }));
const sterneGlyphen = computed(() =>
    Array.from({ length: 5 }, (_unused, index) => (index < props.ziel.bewertung.stars ? "full" : "empty")),
);

function escImFormular(event: KeyboardEvent): void {
    if (entwurf.text.trim() !== "") event.stopPropagation();
}

const grund = computed(() => {
    const key = meldeSperrGrund(entwurf);
    return key === undefined ? undefined : t(key, { max: BEWERTUNG_GRENZEN.beschreibungMax });
});
const gesperrt = computed(() => (sendet.value ? t("community.sendet") : grund.value));
const formularOffen = computed(() => nummer.value === undefined && moeglich.value !== false);
const linkAdresse = computed(() => statusAdresse(globalThis.location.origin, kennung.schluessel));

async function absenden(): Promise<void> {
    if (grund.value !== undefined || sendet.value) return;
    sendet.value = true;
    problem.value = undefined;
    try {
        const antwort = await sendeBewertungsMeldung(
            props.ziel.bewertung.id,
            meldeBody(kennung, entwurf, performance.now() - geoeffnet),
        );
        nummer.value = antwort.nummer;
    } catch (fehler) {
        problem.value = besucherSatz(fehler, BEWERTUNG_MELDEN_ABLEHNUNG, {
            zuViele: "community.fehler.zuViele",
            rueckfall: (art) => t(FEHLER_SATZ[art]),
        });
    } finally {
        sendet.value = false;
    }
}
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="werkzeug"
        breite="entscheiden"
        :lage="props.lage"
        :box="props.box"
        vorgabe-ecke="mitte"
        hoehe="inhalt"
        ohne-ablage
        :titel="t('bewertungen.melden.titel', { name: ziel.ortName })"
        testid="community-bewertung-melden-fenster"
        @update:lage="(neu, box) => emit('update:lage', neu, box)"
        @update:box="(neu) => emit('update:box', neu)"
        @vorn="emit('vorn')"
    >
        <div v-if="nummer !== undefined" class="bew-melden__fertig" data-testid="community-bewertung-melden-fertig">
            <p class="bew-melden__nummer" role="status">{{ t("community.fertig.titel", { nummer }) }}</p>
            <p class="bew-melden__leise">{{ t("bewertungen.melden.fertigPrivat") }}</p>
            <AvmKopierfeld
                :wert="linkAdresse"
                :beschriftung="t('community.fertig.linkName')"
                testid="community-bewertung-melden-link"
            />
            <p class="bew-melden__leise">{{ t("community.fertig.linkHinweis") }}</p>
            <div class="bew-melden__knoepfe">
                <AvmKnopf testid="community-bewertung-melden-schliessen" @click="offen = false">{{
                    t("community.fertig.schliessen")
                }}</AvmKnopf>
                <AvmKnopf
                    art="gefuellt"
                    testid="community-bewertung-melden-status"
                    @click="emit('status', kennung.schluessel)"
                    >{{ t("community.fertig.statusseite") }}</AvmKnopf
                >
            </div>
        </div>

        <AvmHinweis
            v-else-if="moeglich === false"
            ton="warnung"
            rolle="status"
            testid="community-bewertung-melden-nicht-moeglich"
        >
            {{ t("bewertungen.nichtMoeglich") }} {{ t("community.nichtMoeglich.spaeter") }}
        </AvmHinweis>

        <form
            v-else
            class="bew-melden"
            data-testid="community-bewertung-melden-formular"
            novalidate
            @keydown.esc="escImFormular"
            @submit.prevent
        >
            <!-- Die Bewertung als Zitat: Wer meldet, sieht, was er meldet. -->
            <blockquote class="bew-melden__zitat" data-testid="community-bewertung-melden-zitat">
                <span class="bew-melden__sterne" role="img" :aria-label="sterneSatz">
                    <span
                        v-for="(fuellung, stelle) in sterneGlyphen"
                        :key="stelle"
                        class="bew-melden__stern"
                        :class="{ 'is-an': fuellung === 'full' }"
                        aria-hidden="true"
                        >★</span
                    >
                </span>
                <span class="bew-melden__autor">{{ ziel.bewertung.head }}</span>
                <span v-if="ziel.bewertung.text !== undefined" class="bew-melden__text">{{
                    t("infoPanel.reviews.quote", { text: ziel.bewertung.text })
                }}</span>
            </blockquote>

            <fieldset class="bew-melden__gruppe">
                <legend class="bew-melden__label">
                    {{ t("community.melden.kategorie") }}
                    <AvmPille ton="warnung">{{ t("community.quelle.noetig") }}</AvmPille>
                </legend>
                <div class="gruende" role="radiogroup" :aria-label="t('community.melden.kategorie')">
                    <label
                        v-for="art in gruende"
                        :key="art.wert"
                        class="grund"
                        :class="{ 'grund--aktiv': entwurf.grund === art.wert }"
                        :data-testid="`community-bewertung-grund-${art.wert}`"
                    >
                        <input
                            v-model="entwurf.grund"
                            class="grund__wahl"
                            type="radio"
                            name="community-bewertung-grund"
                            :value="art.wert"
                        />
                        <span class="grund__name">{{ art.text }}</span>
                    </label>
                </div>
            </fieldset>

            <label class="bew-melden__feld">
                <span class="bew-melden__label"
                    >{{ t("community.text.label") }}
                    <span class="bew-melden__leise">{{ t("community.freiwillig") }}</span></span
                >
                <AvmTextbereich
                    v-model="entwurf.text"
                    :zeilen="3"
                    :maxlength="BEWERTUNG_GRENZEN.beschreibungMax"
                    testid="community-bewertung-melden-text"
                />
            </label>

            <p class="bew-melden__leise" data-testid="community-bewertung-melden-hinweis">
                {{ t("bewertungen.melden.hinweis") }}
            </p>

            <div class="bew-melden__honig" aria-hidden="true" inert data-testid="community-bewertung-melden-honig">
                <input v-model="entwurf.honig" type="text" name="weitere-angaben" tabindex="-1" autocomplete="off" />
            </div>

            <AvmHinweis
                v-if="problem !== undefined"
                ton="gefahr"
                rolle="alert"
                testid="community-bewertung-melden-problem"
            >
                {{ problem }}
            </AvmHinweis>
        </form>

        <template v-if="formularOffen" #fuss-hinweis>
            <span
                v-if="gesperrt !== undefined"
                :id="`${kennungId}-grund`"
                data-testid="community-bewertung-melden-sperrgrund"
                >{{ gesperrt }}</span
            >
        </template>
        <template v-if="formularOffen" #fuss-haupt>
            <button
                type="button"
                :disabled="gesperrt !== undefined"
                :title="gesperrt"
                :aria-describedby="gesperrt === undefined ? undefined : `${kennungId}-grund`"
                data-testid="community-bewertung-melden-absenden"
                @click="absenden"
            >
                {{ t("bewertungen.melden.absenden") }}
            </button>
        </template>
    </AvmFenster>
</template>

<style scoped>
.bew-melden {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    min-width: 0;
}

.bew-melden__feld {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.bew-melden__gruppe {
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
}

.bew-melden__gruppe legend {
    margin-bottom: var(--space-4);
    padding: 0;
}

.bew-melden__label {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-6);
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
}

.bew-melden__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

/* Das Zitat der gemeldeten Bewertung: eine Linie links, kein Rahmen (AGENTS.md §12). */
.bew-melden__zitat {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-6) var(--space-8);
    border-left: 2px solid var(--color-divider);
    background: var(--color-panel-soft);
}

.bew-melden__sterne {
    display: inline-flex;
    font-size: var(--font-size-small);
    line-height: 1;
}

.bew-melden__stern {
    color: var(--color-star-muted);
}

.bew-melden__stern.is-an {
    color: var(--color-star);
}

.bew-melden__autor {
    color: var(--color-text-strong);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-bold);
    overflow-wrap: anywhere;
}

.bew-melden__text {
    color: var(--color-text);
    font-size: var(--font-size-small);
    overflow-wrap: anywhere;
}

.gruende {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-6);
}

.grund {
    display: flex;
    align-items: center;
    min-height: var(--avm-control-h);
    padding: var(--space-4) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    cursor: pointer;
    transition:
        background-color 120ms ease,
        border-color 120ms ease;
}

.grund:hover {
    border-color: var(--color-border-strong);
    background: var(--color-hover-wash);
}

.grund:focus-within {
    box-shadow: var(--focus-ring);
}

.grund--aktiv {
    border-color: var(--color-accent);
    background: var(--color-button-soft-active);
}

.grund__wahl {
    position: absolute;
    opacity: 0;
    pointer-events: none;
}

.grund__name {
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
}

.bew-melden__honig {
    position: absolute;
    inset-inline-start: -100vw;
    opacity: 0;
    pointer-events: none;
}

.bew-melden__fertig {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    min-width: 0;
}

.bew-melden__nummer {
    margin: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-reading);
}

.bew-melden__knoepfe {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-6);
}

@media (prefers-reduced-motion: reduce) {
    .grund {
        transition: none;
    }
}
</style>
