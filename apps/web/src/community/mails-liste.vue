<script setup lang="ts">
import { computed, ref, shallowRef, useId, watch } from "vue";
import type { GesendetZeile, VorgangListe, VorgangZeile } from "@avesmaps3d/shared";
import { authState } from "../auth/session-state";
import type { FilterAbschnitt, FilterWahl } from "../controls/avm-filterknopf";
import AvmFilterknopf from "../controls/avm-filterknopf.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmKreis from "../controls/avm-kreis.vue";
import AvmKreisLegende from "../controls/avm-kreis-legende.vue";
import AvmListenleiste from "../controls/avm-listenleiste.vue";
import AvmPille from "../controls/avm-pille.vue";
import AvmSegmente from "../controls/avm-segmente.vue";
import { formatNumber, t } from "../i18n/i18n";
import { entprellt } from "../system/entprellt";
import { ladeModulStand } from "./api";
import {
    MAIL_ABLAGEN,
    MAIL_FILTER_KATEGORIEN,
    MAIL_OFFENE_ZUSTAENDE,
    MAIL_ZUSTAND_NAME,
    ablageZahl,
    gesendetAn,
    gesendetBetreff,
    gesendetMeta,
    gesendetZeit,
    gesendetZustellung,
    istBeantwortet,
    istBegonnen,
    mailAbsender,
    mailAktionen,
    mailBetreff,
    mailLegendeNamen,
    mailMeta,
    neueMailKnopfGrund,
    segmentVon,
    unterreiterZahl,
    type MailAblage,
} from "./mails-modell";
import {
    ZUSTAENDIG_WERTE,
    filtere,
    kategorieName,
    kreisVon,
    legendeZahlen,
    papierkorbAn,
    prioritaetName,
    prioritaetPille,
    trefferZahl,
    zeitAbstand,
    type FilterAbschnittId,
    type ListenFilter,
} from "./meldungen-modell";
import { insArchiv, ladeGesendet, ladeListe, papierkorb, zurueckInEingang } from "./redaktion-api";
import { redaktionSatz } from "./redaktion-ablehnung";
import { redaktion } from "./redaktion";

/**
 * Die Liste „Community › Mails“ (WI-0268 C4; Bedienkonzept WI-0263 §3.2, §3.4, §4; Design Guide §13.27): oben die Ablagen **Eingang · Gesendet · Archiv** mit Zahl, darunter die Leiste des Hauses (Suche links, der
 * Trichter rechtsbündig, Guide §13.45), dann die Zeilen in der Kartenbauart des Mail-Eingangs, unten EINE Zeile Legende mit Zählung. Ein Klick auf eine Karte öffnet die Anfrage im Vorgangsfenster (`vorgang-fenster.vue`).
 *
 * - **Die Karte:** der Absender kräftig, der Betreff gedämpft, die Meta-Zeile „COM-… · Kontaktformular · zuständig“, das Abzeichen „✓ beantwortet“; **die Aktionen stehen als volle Spalte neben der Karte**, nicht in ihr
 *   (Guide §13.27: Damit trifft man sie ohne Zielen): ↧ Ins Archiv (im Archiv ↺ Zurück in den Eingang) und ✕ In den Papierkorb im Danger-Soft-Ton. Der Papierkorb braucht `moderate_community`; ohne das Recht steht er
 *   gesperrt da, und ein Satz sagt warum (Guide §13.19).
 * - **Gesendet** ist keine Ablage, sondern eine Sicht auf die ausgehenden Nachrichten, neueste zuerst: „An: Statusseite“ oder bei einer Mail die Adresse, Betreff, Zeit, Nummer, von wem. Bei einer Mail steht dazu der
 *   Zustellstand („wird gesendet …“, „✓ zugestellt“, „nicht zugestellt: ‹Grund›“; WI-0268 C6a). Ein Klick öffnet die Anfrage; die Nachricht liegt weiter in ihrem Faden.
 * - **✚ Neue Mail** (WI-0268 C6a, Bedienkonzept §3.5) steht in der Leiste und öffnet das Fenster „Neue Mail“. Ohne das Recht `send_new_mail` steht es gesperrt mit „Neue Mails schreiben nur Betreiber“, ohne Mailweg
 *   gesperrt mit „Der Mailweg ist noch nicht eingerichtet“ (Guide §13.19).
 * - **Gesucht wird auf dem Server** (Nummer, Text, Absender, Adresse); Zustand, Zuständig und Kategorie filtert die Liste hier, die Zahlen im Trichter zählen unter allen anderen Filtern. Der Papierkorb (nur mit
 *   `moderate_community`) ist ein Wert im Trichter und lädt das Segment `papierkorb`.
 * - **Die Zahl am Unterreiter** ist, was auf die Redaktion wartet: neue und in Arbeit; „wartet auf Antwort“ wartet auf den Absender und zählt nicht.
 */
const props = defineProps<{
    rechte: readonly string[];
    /** Das Panel ist zu sehen: Ein Wechsel auf „sichtbar“ lädt neu, damit die Liste nicht von gestern ist. */
    sichtbar?: boolean | undefined;
}>();
const emit = defineEmits<{ zaehler: [offen: number | undefined] }>();

const ich = computed(() => authState.value.person?.id);
/** Der Papierkorb der Anfragen: mit der Moderation oder dem engen Recht `trash_mail` (Diplomat, WI-0279). */
const moderiert = computed(() => props.rechte.includes("moderate_community") || props.rechte.includes("trash_mail"));
/** Ist der Mailweg eingerichtet? `undefined`, bis der Server geantwortet hat. */
const mailweg = ref<boolean | undefined>(undefined);
const neuGrund = computed(() => {
    const key = neueMailKnopfGrund(props.rechte, mailweg.value);
    return key === undefined ? undefined : t(key);
});
const neuId = useId();
const neueMail = (): void => {
    redaktion.oeffneNeueMail();
};

// --- Zustand der Leiste ----------------------------------------------------------------------------------------------------

const ablage = ref<MailAblage>("eingang");
const suche = ref("");
const gesucht = entprellt(suche);
const filter = ref<ListenFilter>({});
const imPapierkorb = computed(() => ablage.value !== "gesendet" && moderiert.value && papierkorbAn(filter.value));
const aktuellesSegment = computed(() => (imPapierkorb.value ? ("papierkorb" as const) : segmentVon(ablage.value)));

/** Eine Ablage zu wählen nimmt den Papierkorb aus dem Trichter; sonst bliebe es auf „Papierkorb“ stehen. */
const ablageWahl = computed({
    get: () => (imPapierkorb.value ? "" : ablage.value),
    set: (wert: string) => {
        ablage.value = (MAIL_ABLAGEN.find((a) => a === wert) ?? "eingang") as MailAblage;
        if (papierkorbAn(filter.value)) filter.value = { ...filter.value, papierkorb: [] };
    },
});

// --- Laden -----------------------------------------------------------------------------------------------------------------

type Stand =
    | { readonly art: "laedt" }
    | { readonly art: "nicht-eingerichtet" }
    | { readonly art: "fehler"; readonly satz: string }
    | { readonly art: "da"; readonly liste: VorgangListe; readonly gesendet: readonly GesendetZeile[] | undefined };

const stand = shallowRef<Stand>({ art: "laedt" });
const problem = shallowRef<string | undefined>(undefined);
let lauf = 0;

async function lade(): Promise<void> {
    const mein = ++lauf;
    try {
        if (stand.value.art === "laedt" || stand.value.art === "nicht-eingerichtet") {
            const modul = await ladeModulStand();
            if (mein !== lauf) return;
            mailweg.value = modul.mailweg;
            if (!modul.meldungen) {
                stand.value = { art: "nicht-eingerichtet" };
                emit("zaehler", undefined);
                return;
            }
        }
        const inGesendet = ablage.value === "gesendet";
        // In „Gesendet“ fragt die Liste der Vorgänge nur nach den Zahlen der Ablagen (ohne Suche), die ausgehenden Nachrichten nach dem Text.
        const [liste, gesendet] = await Promise.all([
            ladeListe({ segment: aktuellesSegment.value, art: "anfrage", q: inGesendet ? undefined : gesucht.value }),
            inGesendet ? ladeGesendet(gesucht.value).then((antwort) => antwort.zeilen) : Promise.resolve(undefined),
        ]);
        if (mein !== lauf) return;
        stand.value = { art: "da", liste, gesendet };
        emit("zaehler", unterreiterZahl(liste));
    } catch (fehler) {
        if (mein !== lauf) return;
        // Ein Stand, der schon da ist, bleibt stehen, solange das Neuladen scheitert; ein Satz sagt es.
        stand.value = { art: "fehler", satz: redaktionSatz(fehler) };
    }
}

// Eingang und Gesendet fragen dasselbe Segment, aber verschieden: Die Ablage gehört dazu.
watch([ablage, aktuellesSegment, gesucht], () => void lade(), { immediate: true });
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
const gesendet = computed(() => (stand.value.art === "da" ? (stand.value.gesendet ?? []) : []));
const zeilen = computed((): VorgangZeile[] =>
    liste.value === undefined ? [] : filtere(liste.value.zeilen, filter.value, ich.value),
);

// --- Ablagen, Trichter -----------------------------------------------------------------------------------------------------

const ablagen = computed(() =>
    MAIL_ABLAGEN.map((wert) => {
        const zahl = liste.value === undefined ? undefined : ablageZahl(liste.value.zaehler, wert);
        const name = t(`community.mails.ablage.${wert}`);
        return { value: wert, label: zahl === undefined ? name : `${name} (${formatNumber(zahl, 0)})` };
    }),
);

const gesetzteWahl = computed((): FilterWahl => filter.value);

/** Die Abschnitte des Trichters; die Zahl rechts zählt unter allen anderen Filtern (wie die Liste der Meldungen). */
const abschnitte = computed((): FilterAbschnitt[] => {
    const alle = liste.value?.zeilen ?? [];
    const zahl = (abschnitt: FilterAbschnittId, wert: string): number =>
        trefferZahl(alle, filter.value, ich.value, abschnitt, wert);
    return [
        ...(ablage.value === "eingang" && !imPapierkorb.value
            ? [
                  {
                      id: "zustand",
                      titel: t("community.redaktion.filter.zustand"),
                      art: "mehrere" as const,
                      werte: MAIL_OFFENE_ZUSTAENDE.map((wert) => ({
                          wert,
                          text: t(MAIL_ZUSTAND_NAME[wert]),
                          zahl: zahl("zustand", wert),
                      })),
                  },
              ]
            : []),
        {
            id: "zustaendig",
            titel: t("community.redaktion.filter.zustaendig"),
            art: "mehrere",
            werte: ZUSTAENDIG_WERTE.map((wert) => ({
                wert,
                text: t(`community.redaktion.filter.zustaendig.${wert}`),
                zahl: zahl("zustaendig", wert),
            })),
        },
        {
            id: "kategorie",
            titel: t("community.redaktion.filter.kategorie"),
            art: "mehrere",
            werte: MAIL_FILTER_KATEGORIEN.map((wert) => ({
                wert,
                text: kategorieName(wert),
                zahl: zahl("kategorie", wert),
            })),
        },
        // Der Papierkorb ist Sache der Moderation (Server: `moderate_community`): Ohne das Recht steht der Wert nicht da.
        ...(moderiert.value
            ? [
                  {
                      id: "papierkorb",
                      titel: t("community.redaktion.papierkorb"),
                      art: "mehrere" as const,
                      werte: [{ wert: "zeigen", text: t("community.redaktion.filter.papierkorbZeigen") }],
                  },
              ]
            : []),
    ];
});

function setzeFilter(abschnitt: string, werte: string[]): void {
    filter.value = { ...filter.value, [abschnitt]: werte };
}
const filterGesetzt = computed(() =>
    Object.entries(filter.value).some(([abschnitt, werte]) => abschnitt !== "papierkorb" && (werte?.length ?? 0) > 0),
);

// --- Zeilen ----------------------------------------------------------------------------------------------------------------

/** Der Vorgang im vordersten sichtbaren Fenster: seine Karte steht gewählt da. */
const geoeffnet = computed(
    () =>
        [...redaktion.vorgangFenster.value]
            .filter((fenster) => fenster.lage !== "versenkt")
            .sort((a, b) => b.vorn - a.vorn)[0]?.gegenstand,
);

const oeffne = (nummer: string, kategorie?: string): void => {
    redaktion.oeffne(nummer, kategorie === undefined ? nummer : `${nummer} · ${kategorieName(kategorie)}`);
};

const aktionen = computed(() => mailAktionen(ablage.value, props.rechte));
const schreibt = ref<string | undefined>(undefined);
/** ↧ Ins Archiv, ↺ Zurück in den Eingang und ✕ In den Papierkorb: ein Klick, dann lädt die Liste neu (auch nach einem Fehler, denn dann ist sie veraltet). */
async function schritt(zeile: VorgangZeile, was: "ins-archiv" | "zurueck" | "korb"): Promise<void> {
    if (schreibt.value !== undefined) return;
    schreibt.value = zeile.nummer;
    problem.value = undefined;
    try {
        if (was === "ins-archiv") await insArchiv(zeile.nummer, zeile.revision);
        else if (was === "zurueck") await zurueckInEingang(zeile.nummer, zeile.revision);
        else await papierkorb(zeile.nummer, zeile.revision);
    } catch (fehler) {
        // WI-0291: der genaue Grund (Archiv, Papierkorb, Stand), bei Konflikt und Übergang mit dem Hinweis, dass die Liste neu lädt.
        problem.value = redaktionSatz(fehler);
    } finally {
        schreibt.value = undefined;
        redaktion.geaendert();
    }
}

const sperrId = useId();
const mitGesperrtem = computed(() => !imPapierkorb.value && aktionen.value.korb.grund !== undefined);
const korbTitel = computed(() =>
    aktionen.value.korb.grund === undefined ? t("community.mails.aktion.korb") : t(aktionen.value.korb.grund),
);

const leer = computed(() =>
    suche.value.trim() !== "" || filterGesetzt.value
        ? t("community.redaktion.leer.treffer")
        : t(`community.mails.leer.${imPapierkorb.value ? "papierkorb" : ablage.value}`),
);
</script>

<template>
    <div class="mails" data-testid="community-mails">
        <AvmHinweis
            v-if="stand.art === 'nicht-eingerichtet'"
            ton="neutral"
            rolle="status"
            testid="community-mails-nicht-eingerichtet"
        >
            {{ t("community.redaktion.nichtEingerichtet") }}
        </AvmHinweis>

        <template v-else>
            <AvmSegmente
                v-model="ablageWahl"
                :options="ablagen"
                :label="t('community.mails.ablagen')"
                testid="community-mails-ablagen"
            />
            <AvmListenleiste
                v-model="suche"
                :platzhalter="t('community.mails.suche.platzhalter')"
                :beschriftung="t('community.mails.suche')"
                testid="community-mails-leiste"
            >
                <AvmFilterknopf
                    v-if="ablage !== 'gesendet'"
                    :abschnitte="abschnitte"
                    :wahl="gesetzteWahl"
                    testid="community-mails-filter"
                    @setze="setzeFilter"
                    @loesen="filter = {}"
                />
                <AvmKnopf
                    :gesperrt="neuGrund"
                    :grund-bei="neuId"
                    :title="neuGrund ?? t('community.mails.neu')"
                    :aria-label="t('community.mails.neu')"
                    testid="community-mails-neu"
                    @click="neueMail"
                    >✚</AvmKnopf
                >
            </AvmListenleiste>
            <!-- Der Grund steht auch sichtbar da (Guide §13.19: ein gesperrter Knopf ohne Satz ist eine Sackgasse); am Telefon gibt es kein Überfahren. -->
            <p
                v-if="neuGrund !== undefined"
                :id="neuId"
                class="mails__leise mails__klein"
                data-testid="community-mails-neu-grund"
            >
                {{ neuGrund }}
            </p>

            <p v-if="stand.art === 'laedt'" class="mails__leise" role="status" data-testid="community-mails-laedt">
                {{ t("community.redaktion.laedt") }}
            </p>
            <template v-if="stand.art === 'fehler'">
                <AvmHinweis ton="gefahr" rolle="alert" testid="community-mails-fehler">{{ stand.satz }}</AvmHinweis>
                <AvmKnopf testid="community-mails-erneut" @click="lade()">{{
                    t("community.redaktion.neuLaden")
                }}</AvmKnopf>
            </template>
            <AvmHinweis v-if="problem !== undefined" ton="gefahr" rolle="alert" testid="community-mails-problem">{{
                problem
            }}</AvmHinweis>

            <template v-if="liste !== undefined">
                <AvmHinweis
                    v-if="imPapierkorb"
                    ton="neutral"
                    rolle="status"
                    testid="community-mails-papierkorb-hinweis"
                >
                    {{ t("community.redaktion.papierkorbHinweis") }}
                </AvmHinweis>

                <!-- Gesendet: die ausgehenden Nachrichten, neueste zuerst; eine Sicht, keine Ablage. -->
                <template v-if="ablage === 'gesendet'">
                    <p v-if="gesendet.length === 0" class="mails__leise" data-testid="community-mails-leer">
                        {{ leer }}
                    </p>
                    <ol
                        v-else
                        class="liste"
                        :aria-label="t('community.mails.gesendet.liste')"
                        data-testid="community-mails-gesendet"
                    >
                        <li
                            v-for="(eintrag, index) in gesendet"
                            :key="`${eintrag.nummer}-${eintrag.at}-${String(index)}`"
                            class="mail mail--allein"
                        >
                            <button
                                type="button"
                                class="mail__karte"
                                :class="{ 'is-gewaehlt': eintrag.nummer === geoeffnet }"
                                :aria-current="eintrag.nummer === geoeffnet ? 'true' : undefined"
                                :data-testid="`community-mails-gesendet-${eintrag.nummer}`"
                                @click="oeffne(eintrag.nummer)"
                            >
                                <span class="mail__kopf">
                                    <span class="mail__absender einzeilig">{{ gesendetAn(eintrag) }}</span>
                                    <span class="mail__zeit">{{ gesendetZeit(eintrag) }}</span>
                                </span>
                                <span class="mail__betreff einzeilig">{{ gesendetBetreff(eintrag) }}</span>
                                <span v-if="eintrag.text" class="mail__text einzeilig">{{ eintrag.text }}</span>
                                <span class="mail__meta">{{ gesendetMeta(eintrag) }}</span>
                                <span
                                    v-if="eintrag.zustellung !== undefined"
                                    class="mail__zustellung"
                                    :class="`mail__zustellung--${eintrag.zustellung.zustand}`"
                                    :data-testid="`community-mails-gesendet-zustellung-${eintrag.nummer}`"
                                    >{{ gesendetZustellung(eintrag) }}</span
                                >
                            </button>
                        </li>
                    </ol>
                </template>

                <!-- Eingang und Archiv: die Karten mit der Aktionsspalte daneben. -->
                <template v-else>
                    <p v-if="zeilen.length === 0" class="mails__leise" data-testid="community-mails-leer">{{ leer }}</p>
                    <ol
                        v-else
                        class="liste"
                        :aria-label="t('community.mails.liste')"
                        data-testid="community-mails-liste"
                    >
                        <li
                            v-for="zeile in zeilen"
                            :key="zeile.nummer"
                            class="mail"
                            :class="{ 'mail--allein': imPapierkorb }"
                        >
                            <button
                                type="button"
                                class="mail__karte"
                                :class="{ 'is-gewaehlt': zeile.nummer === geoeffnet }"
                                :aria-current="zeile.nummer === geoeffnet ? 'true' : undefined"
                                :data-testid="`community-mails-zeile-${zeile.nummer}`"
                                @click="oeffne(zeile.nummer, zeile.kategorie)"
                            >
                                <span class="mail__kopf">
                                    <AvmKreis
                                        :fuellung="kreisVon(zeile.zustand)"
                                        :name="t(MAIL_ZUSTAND_NAME[zeile.zustand])"
                                    />
                                    <span class="mail__absender einzeilig">{{ mailAbsender(zeile) }}</span>
                                    <span class="mail__zeit">{{ zeitAbstand(zeile.eingegangenAt) }}</span>
                                </span>
                                <span class="mail__betreff einzeilig">{{ mailBetreff(zeile) }}</span>
                                <span class="mail__meta">
                                    {{ mailMeta(zeile) }}
                                    <AvmPille
                                        v-if="prioritaetPille(zeile.prioritaet) !== undefined"
                                        :ton="prioritaetPille(zeile.prioritaet)"
                                        >{{ prioritaetName(zeile.prioritaet) }}</AvmPille
                                    >
                                </span>
                                <span
                                    v-if="istBegonnen(zeile)"
                                    class="mail__abzeichen"
                                    :data-testid="`community-mails-begonnen-${zeile.nummer}`"
                                    >↗ {{ t("community.mails.begonnen") }}</span
                                >
                                <span
                                    v-else-if="istBeantwortet(zeile)"
                                    class="mail__abzeichen"
                                    :data-testid="`community-mails-beantwortet-${zeile.nummer}`"
                                    >✓ {{ t("community.mails.beantwortet") }}</span
                                >
                            </button>
                            <div v-if="!imPapierkorb" class="mail__aktionen">
                                <button
                                    type="button"
                                    class="mail__aktion"
                                    :disabled="schreibt === zeile.nummer"
                                    :title="
                                        aktionen.archiv === 'zurueck'
                                            ? t('community.mails.aktion.zurueck')
                                            : t('community.mails.aktion.insArchiv')
                                    "
                                    :aria-label="
                                        aktionen.archiv === 'zurueck'
                                            ? t('community.mails.aktion.zurueck')
                                            : t('community.mails.aktion.insArchiv')
                                    "
                                    :data-testid="`community-mails-${aktionen.archiv}-${zeile.nummer}`"
                                    @click="schritt(zeile, aktionen.archiv)"
                                >
                                    {{ aktionen.archiv === "zurueck" ? "↺" : "↧" }}
                                </button>
                                <button
                                    type="button"
                                    class="mail__aktion mail__aktion--gefahr"
                                    :disabled="schreibt === zeile.nummer || aktionen.korb.grund !== undefined"
                                    :title="korbTitel"
                                    :aria-label="korbTitel"
                                    :aria-describedby="aktionen.korb.grund === undefined ? undefined : sperrId"
                                    :data-testid="`community-mails-korb-${zeile.nummer}`"
                                    @click="schritt(zeile, 'korb')"
                                >
                                    ✕
                                </button>
                            </div>
                        </li>
                    </ol>
                    <p v-show="mitGesperrtem" :id="sperrId" class="mails__leise mails__klein">
                        {{ t("community.mails.sperrHinweis") }}
                    </p>
                    <AvmKreisLegende
                        :namen="mailLegendeNamen(ablage)"
                        :zahlen="legendeZahlen(zeilen)"
                        :beschriftung="t('community.redaktion.legende')"
                        testid="community-mails-legende"
                    />
                </template>
            </template>
        </template>
    </div>
</template>

<style scoped>
.mails {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
}

.mails__leise {
    margin: 0;
    padding: var(--space-8) var(--space-2);
    color: var(--color-text-muted);
}

.mails__klein {
    padding: 0 var(--space-2);
    font-size: var(--font-size-caption);
}

.liste {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
}

/* Mail-Eingang (Guide §13.27): Karte plus Aktionsspalte. Die Spalte ist so hoch wie die ganze Zeile und 34 px schmal, damit man sie ohne Zielen trifft. */
.mail {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 34px;
    gap: var(--space-6);
    padding: var(--space-4) 0;
}

.mail--allein {
    grid-template-columns: minmax(0, 1fr);
}

.mail__karte {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    box-sizing: border-box;
    min-width: 0;
    padding: var(--space-8) var(--space-10);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-panel);
    color: inherit;
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition:
        background-color 120ms ease,
        border-color 120ms ease;
}

.mail__karte:hover {
    border-color: var(--color-border-strong);
    background-image: linear-gradient(var(--color-hover-wash), var(--color-hover-wash));
}

.mail__karte:active {
    background-image: linear-gradient(var(--color-active-wash), var(--color-active-wash));
}

.mail__karte:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.mail__karte.is-gewaehlt {
    border-color: var(--color-accent-strong);
    background: var(--color-panel-active);
}

.mail__kopf {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    min-width: 0;
}

/* Einzeilig kürzt nur die Klasse `.einzeilig` (app.vue, mit Platz für die Unterlängen); hier steht nur, was die Zeile sonst braucht. */
.mail__absender {
    flex: 1 1 auto;
    min-width: 0;
    color: var(--color-text-strong);
}

.mail__zeit,
.mail__meta {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.mail__zeit {
    flex: 0 0 auto;
    white-space: nowrap;
}

.mail__betreff,
.mail__text {
    min-width: 0;
    color: var(--color-text-muted);
}

.mail__meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-6);
}

.mail__abzeichen {
    color: var(--color-success);
    font-size: var(--font-size-caption);
}

/* Der Zustellstand einer Mail in „Gesendet“: gedämpft, nur „nicht zugestellt“ im Warnton. */
.mail__zustellung {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.mail__zustellung--gesendet {
    color: var(--color-success);
}

.mail__zustellung--fehler {
    color: var(--color-danger-soft-text);
}

.mail__aktionen {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.mail__aktion {
    flex: 1 1 0;
    min-height: 0;
    padding: 0;
    border: 1px solid var(--color-button-soft-border);
    border-radius: var(--radius-md);
    background: var(--color-button-soft);
    color: var(--color-button-soft-text);
    cursor: pointer;
    font: inherit;
    transition:
        background-color 120ms ease,
        border-color 120ms ease;
}

.mail__aktion:hover:not(:disabled) {
    border-color: var(--color-border-strong);
    background: var(--color-button-soft-hover);
}

.mail__aktion:active:not(:disabled) {
    background: var(--color-button-soft-active);
}

.mail__aktion--gefahr {
    border-color: var(--color-danger-soft-border);
    background: var(--color-danger-soft);
    color: var(--color-danger-soft-text);
}

.mail__aktion:disabled {
    border-color: var(--color-disabled-border);
    background: var(--color-disabled-bg);
    color: var(--color-disabled-text);
    cursor: default;
}

.mail__aktion:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

@media (prefers-reduced-motion: reduce) {
    .mail__karte,
    .mail__aktion {
        transition: none;
    }
}
</style>
