<script setup lang="ts">
import { computed, ref, shallowRef, useId, watch } from "vue";
import { KANAL_IDS, SOCIAL_HERKUENFTE, type SocialListe, type SocialZeile } from "@avesmaps3d/shared";
import type { FilterAbschnitt, FilterWahl } from "../controls/avm-filterknopf";
import AvmFilterknopf from "../controls/avm-filterknopf.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmKreis from "../controls/avm-kreis.vue";
import AvmKreisLegende from "../controls/avm-kreis-legende.vue";
import AvmListenleiste from "../controls/avm-listenleiste.vue";
import AvmSegmente from "../controls/avm-segmente.vue";
import { openAuthWindow } from "../auth/auth-windows";
import { authState } from "../auth/session-state";
import type { MessageKey } from "../i18n/de";
import { formatNumber, t } from "../i18n/i18n";
import { entprellt } from "../system/entprellt";
import { ladeStand } from "./api";
import { genauerGrund } from "../system/ablehnung";
import { REDAKTION_FEHLER_SATZ, redaktionFehler } from "./redaktion-api";
import { redaktion } from "./redaktion";
import { fuehreAus, ladeBeitraege } from "./social-api";
import { aktualisiereKanaele } from "./social-kanaele";
import { kanalVerwalten } from "./social-kontext";
import {
    LISTEN_SEGMENTE,
    ZUSTAND_NAME,
    anfrageVon,
    chips,
    filterGesetzt,
    kanalName,
    kreisVon,
    legendeNamen,
    legendeZahlen,
    notiz,
    segmentZahl,
    socialAblehnung,
    unterreiterZahl,
    urheber,
    zeilenKnoepfe,
    zeitVon,
    zusammenfassung,
    type ListenSegment,
    type SocialFilter,
} from "./social-modell";

/**
 * Die Liste „Community › Social Hub“ (WI-0270 C11; Bedienkonzept WI-0263 §6.4): oben die Segmente **Offen · Veröffentlicht · Papierkorb** mit Zahl, darunter die Leiste des Hauses (Suche links, Trichter
 * rechtsbündig, dazu ✚ „Neuer Beitrag“), dann die Zeilen, unten EINE Zeile Legende mit Zählung („Entwurf ○ 2 · zur Freigabe ◐ 1 · veröffentlicht ● 14“). Im Stil der Bewertungen.
 *
 * - **Eine Zeile = ein Beitrag:** Kreis (○ Entwurf, ◐ zur Freigabe, ● veröffentlicht), Urheber („Vali“, „Routine“, „Vali · aus COM-000110“), Zeit, Zusammenfassung (Titelzeile oder erster Satz), die Notiz in Amber,
 *   wo jemand handeln muss („Vorschlag der Routine: wartet auf Freigabe“), und je Kanal ein Statuschip.
 * - **Knöpfe rechts an der Zeile wie bei den Mails:** unter Offen ✓ „Freigeben und veröffentlichen“ und ✕ „In den Papierkorb“, im Papierkorb ↺ „Aus dem Papierkorb holen“. Gesperrt heißt: ein Satz im Tooltip (ohne
 *   das Recht, vor der Vorlage, wenn der Beitrag nicht passt: derselbe Satz wie im Fenster; `social-modell.ts`).
 * - **Gesucht wird auf dem Server** (Titel, Text, Hashtags); der Trichter wählt Kanal und Herkunft.
 * - **Ohne eingerichtetes Modul** steht ein ruhiger Hinweis statt der Liste.
 */
const props = defineProps<{
    rechte: readonly string[];
    /** Das Panel ist zu sehen: Ein Wechsel auf „sichtbar“ lädt neu, damit die Liste nicht von gestern ist. */
    sichtbar?: boolean | undefined;
}>();
const emit = defineEmits<{ zaehler: [wartet: number | undefined] }>();

// --- Zustand der Leiste ----------------------------------------------------------------------------------------------------

const segment = ref<ListenSegment>("offen");
const suche = ref("");
const gesucht = entprellt(suche);
const filter = ref<SocialFilter>({});
const ich = computed(() => authState.value.person?.id);

// --- Laden -----------------------------------------------------------------------------------------------------------------

type Stand =
    | { readonly art: "laedt" }
    | { readonly art: "nicht-eingerichtet" }
    | { readonly art: "fehler"; readonly key: MessageKey }
    | { readonly art: "da"; readonly liste: SocialListe };

const stand = shallowRef<Stand>({ art: "laedt" });
const problem = shallowRef<MessageKey | undefined>(undefined);
/** Der genaue Grund, wenn der Server die Angaben ablehnt (`genauerGrund`, Fachcode in den Sätzen des Hubs); sonst der allgemeine Satz. */
const problemGrund = shallowRef<string | undefined>(undefined);
let lauf = 0;

async function lade(): Promise<void> {
    const mein = ++lauf;
    // Der Stand der fremden Kanäle bestimmt, ob ✓ bei einem Beitrag für Mastodon geht (eingerichtet, freigeschaltet, ohne Notschalter).
    void aktualisiereKanaele();
    try {
        if (stand.value.art === "laedt" || stand.value.art === "nicht-eingerichtet") {
            const bereit = await ladeStand();
            if (mein !== lauf) return;
            if (!bereit) {
                stand.value = { art: "nicht-eingerichtet" };
                emit("zaehler", undefined);
                return;
            }
        }
        const liste = await ladeBeitraege(anfrageVon(segment.value, gesucht.value, filter.value));
        if (mein !== lauf) return;
        stand.value = { art: "da", liste };
        emit("zaehler", unterreiterZahl(liste, props.rechte));
    } catch (fehler) {
        if (mein !== lauf) return;
        stand.value = { art: "fehler", key: REDAKTION_FEHLER_SATZ[redaktionFehler(fehler)] };
    }
}

watch([segment, gesucht, filter], () => void lade(), { immediate: true, deep: true });
watch(
    () => redaktion.listeVersion.value,
    () => void lade(),
);
watch(
    () => props.sichtbar,
    (an) => {
        if (an === true) void lade();
    },
);

const liste = computed(() => (stand.value.art === "da" ? stand.value.liste : undefined));
const zeilen = computed((): SocialZeile[] => liste.value?.zeilen ?? []);

// --- Segmente und Trichter -------------------------------------------------------------------------------------------------

/** Die Zahl steht an „Offen“ und „Papierkorb“ (was zu tun ist und was bald geht); „Veröffentlicht“ ist zu lang für die Zahl im schmalen Panel, seine Zahl steht in der Legende. */
const segmente = computed(() =>
    LISTEN_SEGMENTE.map((wert) => ({
        value: wert,
        label:
            liste.value === undefined || wert === "veroeffentlicht"
                ? t(`community.social.segment.${wert}`)
                : `${t(`community.social.segment.${wert}`)} (${formatNumber(segmentZahl(liste.value.zaehler, wert), 0)})`,
    })),
);

const gesetzteWahl = computed((): FilterWahl => filter.value);
const abschnitte = computed((): FilterAbschnitt[] => [
    {
        id: "kanal",
        titel: t("community.social.filter.kanal"),
        art: "eins",
        werte: KANAL_IDS.map((wert) => ({ wert, text: kanalName(wert) })),
    },
    {
        id: "herkunft",
        titel: t("community.social.filter.herkunft"),
        art: "eins",
        werte: SOCIAL_HERKUENFTE.map((wert) => ({ wert, text: t(`community.social.herkunft.${wert}`) })),
    },
]);

function setzeFilter(abschnitt: string, werte: string[]): void {
    filter.value = { ...filter.value, [abschnitt]: werte };
}

// --- Zeilen ----------------------------------------------------------------------------------------------------------------

/** Der Beitrag im vordersten sichtbaren Fenster: seine Zeile steht gewählt da. */
const geoeffnet = computed(
    () =>
        [...redaktion.beitragFenster.value]
            .filter((fenster) => fenster.lage !== "versenkt")
            .sort((a, b) => b.vorn - a.vorn)[0]?.gegenstand,
);

const oeffne = (zeile: SocialZeile): void => {
    redaktion.oeffneBeitrag(String(zeile.id), `${zeile.nr} · ${zusammenfassung(zeile)}`);
};
const neuerBeitrag = (): void => {
    redaktion.oeffneBeitrag("neu", t("community.social.fenster.neu"));
};

const schreibt = ref<number | undefined>(undefined);
async function schritt(zeile: SocialZeile, was: "freigeben" | "papierkorb" | "zurueckholen"): Promise<void> {
    if (schreibt.value !== undefined) return;
    schreibt.value = zeile.id;
    problem.value = undefined;
    problemGrund.value = undefined;
    try {
        await fuehreAus(zeile.id, was, zeile.revision);
    } catch (fehler) {
        problem.value = REDAKTION_FEHLER_SATZ[redaktionFehler(fehler)];
        problemGrund.value = genauerGrund(fehler, socialAblehnung(zeile.bildUrteil?.social === true));
    } finally {
        schreibt.value = undefined;
        redaktion.geaendert();
    }
}

const sperrId = useId();
const leer = computed(() =>
    suche.value.trim() !== "" || filterGesetzt(filter.value)
        ? t("community.redaktion.leer.treffer")
        : t(`community.social.leer.${segment.value}`),
);
const knoepfe = (zeile: SocialZeile) => zeilenKnoepfe(zeile, props.rechte, ich.value);
const mitGesperrtem = computed(() =>
    zeilen.value.some((zeile) => {
        const k = knoepfe(zeile);
        return [k.freigeben, k.korb, k.holen].some((griff) => griff.zeigen && griff.grund !== undefined);
    }),
);
</script>

<template>
    <div class="social" data-testid="community-social">
        <AvmHinweis
            v-if="stand.art === 'nicht-eingerichtet'"
            ton="neutral"
            rolle="status"
            testid="community-social-nicht-eingerichtet"
        >
            {{ t("community.redaktion.nichtEingerichtet") }}
        </AvmHinweis>

        <template v-else>
            <AvmSegmente
                v-model="segment"
                :options="segmente"
                :label="t('community.social.segmente')"
                testid="community-social-segmente"
            />
            <AvmListenleiste
                v-model="suche"
                :platzhalter="t('community.social.suche.platzhalter')"
                :beschriftung="t('community.social.suche')"
                testid="community-social-leiste"
            >
                <AvmFilterknopf
                    :abschnitte="abschnitte"
                    :wahl="gesetzteWahl"
                    testid="community-social-filter"
                    @setze="setzeFilter"
                    @loesen="filter = {}"
                />
                <AvmKnopf
                    :title="t('community.social.neu')"
                    :aria-label="t('community.social.neu')"
                    testid="community-social-neu"
                    @click="neuerBeitrag"
                    >✚</AvmKnopf
                >
            </AvmListenleiste>

            <!-- Der Titel des Segments zwischen Leiste und Liste („Entwürfe“, „Abgesendete Posts“, „Verworfene Entwürfe“), gestaltet wie die Abschnittstitel der Panele. -->
            <h3 class="social__titel avm-versalmitte" data-testid="community-social-listentitel">
                {{ t(`community.social.listentitel.${segment}`) }}
            </h3>

            <p v-if="stand.art === 'laedt'" class="social__leise" role="status" data-testid="community-social-laedt">
                {{ t("community.redaktion.laedt") }}
            </p>
            <template v-if="stand.art === 'fehler'">
                <AvmHinweis ton="gefahr" rolle="alert" testid="community-social-fehler">{{ t(stand.key) }}</AvmHinweis>
                <AvmKnopf testid="community-social-erneut" @click="lade()">{{
                    t("community.redaktion.neuLaden")
                }}</AvmKnopf>
            </template>
            <AvmHinweis v-if="problem !== undefined" ton="gefahr" rolle="alert" testid="community-social-problem">{{
                problemGrund ?? t(problem)
            }}</AvmHinweis>

            <template v-if="liste !== undefined">
                <p v-if="zeilen.length === 0" class="social__leise" data-testid="community-social-leer">{{ leer }}</p>
                <ol v-else class="liste" :aria-label="t('community.social.liste')" data-testid="community-social-liste">
                    <li v-for="zeile in zeilen" :key="zeile.id" class="eintrag">
                        <button
                            type="button"
                            class="zeile"
                            :class="{ 'is-gewaehlt': String(zeile.id) === geoeffnet }"
                            :aria-current="String(zeile.id) === geoeffnet ? 'true' : undefined"
                            :data-testid="`community-social-zeile-${String(zeile.id)}`"
                            @click="oeffne(zeile)"
                        >
                            <AvmKreis :fuellung="kreisVon(zeile.zustand)" :name="t(ZUSTAND_NAME[zeile.zustand])" />
                            <span class="zeile__text">
                                <span class="zeile__kopf">
                                    <span class="zeile__urheber einzeilig">{{ urheber(zeile) }}</span>
                                </span>
                                <span class="zeile__titel einzeilig">{{ zusammenfassung(zeile) }}</span>
                                <span
                                    v-if="notiz(zeile) !== undefined"
                                    class="zeile__notiz"
                                    :data-testid="`community-social-notiz-${String(zeile.id)}`"
                                    >{{ notiz(zeile) }}</span
                                >
                                <span class="zeile__chips">
                                    <span
                                        v-for="chip in chips(zeile)"
                                        :key="chip.kanal"
                                        class="chip"
                                        :class="`chip--${chip.zustand}`"
                                        >{{ chip.text }}</span
                                    >
                                </span>
                            </span>
                            <span class="zeile__rechts">{{ zeitVon(zeile) }}</span>
                        </button>
                        <span class="aktionen">
                            <AvmKnopf
                                v-if="knoepfe(zeile).freigeben.zeigen"
                                groesse="zeile"
                                :gesperrt="schreibt === zeile.id ? '' : knoepfe(zeile).freigeben.grund"
                                :grund-bei="sperrId"
                                :title="t('community.social.griff.freigeben')"
                                :aria-label="t('community.social.griff.freigeben')"
                                :testid="`community-social-freigeben-${String(zeile.id)}`"
                                @click="schritt(zeile, 'freigeben')"
                                >✓</AvmKnopf
                            >
                            <AvmKnopf
                                v-if="knoepfe(zeile).korb.zeigen"
                                art="gefahr"
                                groesse="zeile"
                                :gesperrt="schreibt === zeile.id ? '' : knoepfe(zeile).korb.grund"
                                :grund-bei="sperrId"
                                :title="t('community.social.griff.korb')"
                                :aria-label="t('community.social.griff.korb')"
                                :testid="`community-social-korb-${String(zeile.id)}`"
                                @click="schritt(zeile, 'papierkorb')"
                                >✕</AvmKnopf
                            >
                            <AvmKnopf
                                v-if="knoepfe(zeile).holen.zeigen"
                                groesse="zeile"
                                :gesperrt="schreibt === zeile.id ? '' : knoepfe(zeile).holen.grund"
                                :grund-bei="sperrId"
                                :title="t('community.social.griff.holen')"
                                :aria-label="t('community.social.griff.holen')"
                                :testid="`community-social-holen-${String(zeile.id)}`"
                                @click="schritt(zeile, 'zurueckholen')"
                                >↺</AvmKnopf
                            >
                        </span>
                    </li>
                </ol>
                <p v-show="mitGesperrtem" :id="sperrId" class="social__leise social__klein">
                    {{ t("community.social.sperrHinweis") }}
                </p>
                <AvmKreisLegende
                    :namen="legendeNamen()"
                    :zahlen="legendeZahlen(liste.zaehler)"
                    :beschriftung="t('community.social.legende')"
                    testid="community-social-legende"
                />
                <!-- Stand und Notschalter der fremden Kanäle stehen in der Systemsteuerung (WI-0270 C12a); hier nur der Weg dorthin, für wen er gilt. -->
                <AvmKnopf
                    v-if="kanalVerwalten"
                    groesse="zeile"
                    class="social__verweis"
                    testid="community-social-kanaele-verweis"
                    @click="openAuthWindow({ name: 'systemsteuerung', eintrag: 'social' })"
                    >{{ t("community.social.kanaele.verweis") }}</AvmKnopf
                >
            </template>
        </template>
    </div>
</template>

<style scoped>
.social {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
}

.social__titel {
    margin: 0;
    padding: 0 var(--space-2);
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.social__leise {
    margin: 0;
    padding: var(--space-8) var(--space-2);
    color: var(--color-text-muted);
}

.social__klein {
    padding: 0 var(--space-2);
    font-size: var(--font-size-caption);
}

.social__verweis {
    align-self: flex-start;
}

.liste {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
}

/* Eine Zeile: der Kasten der Zeile mit der Aktionsspalte rechts (wie die Bewertungen und Mails); Zustände nach Guide §30.5. */
.eintrag {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    border-bottom: 1px solid var(--color-divider);
}

.zeile {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: var(--space-2) var(--space-8);
    align-items: start;
    box-sizing: border-box;
    width: 100%;
    padding: var(--space-8) var(--space-6);
    border: 0;
    background: none;
    color: inherit;
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition: background-color 120ms ease;
}

.zeile:hover {
    background: var(--color-hover-wash);
}

.zeile:active {
    background: var(--color-active-wash);
}

.zeile:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.zeile.is-gewaehlt {
    background: var(--color-panel-active);
}

.zeile :deep(.avm-kreis) {
    margin-top: var(--space-2);
}

.zeile__text {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.zeile__kopf {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    min-width: 0;
}

.zeile__urheber {
    min-width: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.zeile__titel {
    min-width: 0;
    color: var(--color-text-strong);
}

.zeile__notiz {
    color: var(--color-warning-soft-text);
    font-size: var(--font-size-small);
}

.zeile__chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
}

.chip {
    padding: 0 var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.chip--ok {
    border-color: var(--color-success-soft-border);
    color: var(--color-link);
}

.chip--fehler {
    border-color: var(--color-danger-soft-border);
    background: var(--color-danger-soft);
    color: var(--color-danger-soft-text);
}

.zeile__rechts {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    white-space: nowrap;
}

.aktionen {
    display: flex;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-4) 0 0;
}

@media (prefers-reduced-motion: reduce) {
    .zeile {
        transition: none;
    }
}
</style>
