<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, useId, useTemplateRef, watch } from "vue";
import type { BewertungDetail, BewertungGrund } from "@avesmaps3d/shared";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmKreis from "../controls/avm-kreis.vue";
import AvmSperrgrund from "../controls/avm-sperrgrund.vue";
import AvmFenster from "../fenster/avm-fenster.vue";
import type { FensterBox, FensterHuellenLage } from "../fenster/fenster-lage";
import type { WerkzeugFenster } from "../editor-panel/fenster-verwaltung";
import type { MessageKey } from "../i18n/de";
import { formatNumber, t } from "../i18n/i18n";
import InfoStars from "../info-panel/info-stars.vue";
import {
    GRUENDE,
    fussSatz,
    grundName,
    griffe,
    kreisVon,
    ortSatz,
    sterneLabel,
    sterneText,
    sterneVon,
    unterzeile,
    textVon,
    verlaufZeilen,
    zustandSatz,
    ZUSTAND_NAME,
} from "./bewertungen-modell";
import {
    blendeBewertungEin,
    gibBewertungFrei,
    ladeBewertung,
    loescheBewertungsInhalt,
    sichteBewertung,
    verbirgBewertung,
} from "./bewertungen-redaktion-api";
import { redaktionFehler } from "./redaktion-api";
import { redaktionSatz } from "./redaktion-ablehnung";
import { redaktion, type VorgangBezug } from "./redaktion";

/**
 * Das Fenster EINER Bewertung der Redaktion (WI-0269 C10; Bedienkonzept §6.2, §1.3). Ein Werkzeugfenster der Hülle und der Fensterverwaltung (`werkzeug` `bewertung`): angedockt links neben dem Panel, ⧉ lösen,
 * ▥ andocken, − ablegen unter „Offene Bearbeitungen“. Eine zweite Bewertung ersetzt die erste im selben Fenster (`redaktion.ts`), dann kommt dieses Bauteil mit neuer `gegenstand` und lädt neu.
 *
 * - **Kopf:** „★★★★☆ Wehrheim“. **Leiste:** der Zustand in Worten („neu, schon öffentlich“, „zurückgehalten: Adresse im Text“, „verborgen: Beleidigend“), Herkunft und Eingang.
 * - **Kästen:** Bewertung (Sterne, Text, Name, aventurisches Datum, Zahl „Gefällt mir“), Ort (Name mit ⊕ „Auf der Karte zeigen“, Durchschnitt jetzt und nach der Handlung), Meldungen (falls es welche gibt:
 *   „COM-000120 · Beleidigend“ öffnet den Vorgang), Verlauf.
 * - **Fuß je Zustand:** neu: Verbergen …, **Gesichtet**; zurückgehalten: Verbergen …, **Freigeben**; gesichtet: Verbergen …; verborgen: Inhalt löschen … (Gefahr), **Einblenden**. „Verbergen …“ öffnet ein kleines Blatt IM
 *   Fenster mit dem Grund als Pflichtauswahl und, gibt es eine offene Meldung, dem Haken „COM-… mit Ergebnis ‚umgesetzt‘ abschließen“ (vorangehakt).
 * - 🔴 **Gleichzeitig arbeiten:** Jeder Schritt trägt die Revision, die diese Seite sah. Ein anderer Stand ist `community_conflict`: Das Fenster sagt „Inzwischen geändert“ und lädt neu; nichts wird still überschrieben.
 * - 🔴 **Gesperrt heißt: ein Satz** (`bewertungen-modell.ts`, `griffe`). „Inhalt löschen …“ braucht `moderate_community` und einen frischen Passkey (Stufe S).
 * - Die Karte steht still, bis die Bewertung geöffnet wird; dann fliegt sie zum Ort (nie ein Sprung, nur über `camera.ts`).
 */
const offen = defineModel<boolean>("offen", { required: true });
const props = defineProps<{
    /** Der Eintrag der Fensterverwaltung: `gegenstand` ist die öffentliche Kennung der Bewertung. */
    fenster: WerkzeugFenster;
    rechte: readonly string[];
    lage: FensterHuellenLage;
    box?: FensterBox | undefined;
    ablageZiel?: (() => DOMRect | undefined) | undefined;
}>();
const emit = defineEmits<{
    "update:lage": [lage: Exclude<FensterHuellenLage, "modal">, box?: FensterBox];
    "update:box": [box: FensterBox];
    vorn: [];
}>();

// --- Laden -----------------------------------------------------------------------------------------------------------------

type Stand =
    | { readonly art: "laedt" }
    | { readonly art: "fehler"; readonly satz: string }
    | { readonly art: "da"; readonly detail: BewertungDetail };

const id = computed(() => props.fenster.gegenstand ?? "");
const stand = shallowRef<Stand>({ art: "laedt" });
const detail = computed(() => (stand.value.art === "da" ? stand.value.detail : undefined));
const zeile = computed(() => detail.value?.zeile);
const sichtbar = computed(() => props.lage !== "versenkt");
const meldung = shallowRef<{ readonly satz: string; readonly ton: "warnung" | "gefahr" } | undefined>(undefined);
let lauf = 0;

/** Der Bezug im Format der Anbindung (`VorgangBezug`): der Ort als Objekt, damit die Karte ihn wählt und anfliegt. */
const ortBezug = computed((): VorgangBezug | undefined => {
    const ort = detail.value?.ort;
    if (ort === undefined) return undefined;
    return {
        art: "objekt",
        objektArt: "place",
        objektId: ort.id,
        name: ort.name,
        typ: ort.art,
        lage: ort.lage,
        vorschlagLage: null,
        naechsterOrt: null,
    };
});

/** Lädt die Bewertung neu. `fliegen`: Beim ersten Laden fliegt die Karte zum Ort (Bedienkonzept §6.1), danach nur auf ⊕. */
async function lade(fliegen = false): Promise<boolean> {
    const mein = ++lauf;
    const zu = id.value;
    if (zu === "") return false;
    try {
        const antwort = await ladeBewertung(zu);
        if (mein !== lauf || zu !== id.value) return false;
        stand.value = { art: "da", detail: antwort };
        const bezug = ortBezug.value;
        if (fliegen && sichtbar.value && bezug !== undefined) redaktion.zeige(bezug);
        // ⊘ „Verbergen …“ in der Liste: das Blatt geht gleich auf, wo die Bewertung es zulässt.
        if (redaktion.nimmBlattWunsch(zu) === "verbergen" && !antwort.zeile.zustand.startsWith("verb")) {
            void oeffneBlatt("verbergen");
        }
        return true;
    } catch (fehler) {
        if (mein !== lauf) return false;
        // Ein veralteter Stand bleibt stehen (nichts verschwindet, nur weil das Netz fehlt); ohne ihn steht der Fehler da.
        const satz = redaktionSatz(fehler);
        if (stand.value.art !== "da") stand.value = { art: "fehler", satz };
        else meldung.value = { satz, ton: "gefahr" };
        return false;
    }
}

const kopfTitel = computed(() => {
    const z = zeile.value;
    return z === undefined ? props.fenster.titel : `${sterneText(z.sterne)} ${z.ort.name}`;
});
watch(
    kopfTitel,
    (titel) => {
        if (titel !== props.fenster.titel) redaktion.fenster.value?.markiere(props.fenster.id, { titel });
    },
    { immediate: true },
);

// --- Blatt -----------------------------------------------------------------------------------------------------------------

type Blatt = "verbergen" | "loeschen";
const blatt = shallowRef<Blatt | undefined>(undefined);
const grund = ref<BewertungGrund | "">("");
const vorgaengeSchliessen = ref(true);
const sendet = ref(false);
/** Der Fehler des letzten Versuchs im Blatt, als fertiger Satz: der genaue Grund des Servers (WI-0291) oder der allgemeine zur Fehlerart. */
const blattFehler = shallowRef<string | undefined>(undefined);
const wurzel = useTemplateRef<HTMLElement>("blattWurzel");
const gruppe = useId();
const sperrId = useId();

function zuruecksetzen(): void {
    lauf += 1;
    stand.value = { art: "laedt" };
    meldung.value = undefined;
    blatt.value = undefined;
    grund.value = "";
    vorgaengeSchliessen.value = true;
    blattFehler.value = undefined;
    sendet.value = false;
}
// Eine andere Bewertung im selben Fenster: Zustand weg, neu laden.
watch(
    id,
    () => {
        zuruecksetzen();
        void lade(true);
    },
    { immediate: true },
);

const offeneMeldungen = computed(() => (zeile.value?.gemeldet ?? []).length);
const griff = computed(() => (zeile.value === undefined ? undefined : griffe(zeile.value, props.rechte)));
const verlauf = computed(() => (detail.value === undefined ? [] : verlaufZeilen(detail.value.verlauf)));
const verbergenSperre = computed((): string | undefined => {
    if (sendet.value) return "";
    return grund.value === "" ? t("bewertungen.redaktion.grund.grundFehlt") : undefined;
});

async function oeffneBlatt(art: Blatt): Promise<void> {
    blattFehler.value = undefined;
    if (art === "verbergen") {
        grund.value = "";
        vorgaengeSchliessen.value = true;
    }
    blatt.value = art;
    await nextTick();
    wurzel.value?.scrollIntoView({ block: "nearest" });
}
const schliesseBlatt = (): void => {
    blatt.value = undefined;
    blattFehler.value = undefined;
};

/**
 * Führt einen Schritt aus und lädt danach neu. Ein veralteter Stand (`community_conflict`) oder ein Übergang, der nicht mehr geht, laden die Bewertung neu und sagen es; `true`, wenn der Schritt gelungen ist.
 */
async function tue(schritt: () => Promise<unknown>): Promise<boolean> {
    if (sendet.value) return false;
    sendet.value = true;
    meldung.value = undefined;
    blattFehler.value = undefined;
    try {
        await schritt();
    } catch (fehler) {
        const art = redaktionFehler(fehler);
        const satz = redaktionSatz(fehler, {}, art);
        if (art === "konflikt" || art === "uebergang") {
            // Der Satz sagt den genauen Grund und dass neu geladen ist.
            meldung.value = { satz, ton: "warnung" };
            schliesseBlatt();
            await lade();
            redaktion.geaendert();
        } else if (blatt.value === undefined) meldung.value = { satz, ton: "gefahr" };
        else blattFehler.value = satz;
        sendet.value = false;
        return false;
    }
    schliesseBlatt();
    await lade();
    redaktion.geaendert();
    sendet.value = false;
    return true;
}

const revision = (): number => zeile.value?.revision ?? 1;
const sichte = (): Promise<boolean> => tue(() => sichteBewertung(id.value, revision()));
const gibFrei = (): Promise<boolean> => tue(() => gibBewertungFrei(id.value, revision()));
const blendeEin = (): Promise<boolean> => tue(() => blendeBewertungEin(id.value, revision()));
const verberge = (): Promise<boolean> =>
    grund.value === ""
        ? Promise.resolve(false)
        : tue(() => verbirgBewertung(id.value, revision(), grund.value as BewertungGrund, vorgaengeSchliessen.value));
const loesche = (): Promise<boolean> => tue(() => loescheBewertungsInhalt(id.value, revision()));

function zeige(): void {
    const bezug = ortBezug.value;
    if (bezug !== undefined) redaktion.zeige(bezug);
}

const oeffneVorgang = (nummer: string, grundCode: string): void => {
    redaktion.oeffne(nummer, `${nummer} · ${t("community.kategorie.bewertung")} (${grundName(grundCode)})`);
};

function escBlatt(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    // Esc bricht das Blatt ab, nicht das ganze Fenster.
    event.preventDefault();
    event.stopPropagation();
    schliesseBlatt();
}

const eingangText = computed(() => {
    const z = zeile.value;
    if (z === undefined) return "";
    return t("bewertungen.redaktion.eingangVon", {
        herkunft: t(`bewertungen.redaktion.herkunft.${z.herkunft}` as MessageKey),
        zeit: verlauf.value[0]?.zeit ?? "",
    });
});
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="werkzeug"
        breite="entscheiden"
        :lage="props.lage"
        :box="props.box"
        vorgabe-ecke="links-unten"
        hoehe="inhalt"
        :titel="kopfTitel"
        :ablage-ziel="props.ablageZiel"
        testid="community-bewertung-redaktion-fenster"
        @update:lage="(neu, neueBox) => emit('update:lage', neu, neueBox)"
        @update:box="(neu) => emit('update:box', neu)"
        @vorn="emit('vorn')"
    >
        <template v-if="zeile !== undefined" #leiste>
            <div class="leiste" data-testid="community-bewertung-leiste">
                <span class="leiste__zustand" data-testid="community-bewertung-zustand">
                    <AvmKreis :fuellung="kreisVon(zeile.zustand)" :name="t(ZUSTAND_NAME[zeile.zustand])" />
                    {{ zustandSatz(zeile) }}
                </span>
                <span class="leise" data-testid="community-bewertung-eingang">{{ eingangText }}</span>
            </div>
        </template>

        <p v-if="stand.art === 'laedt'" class="leise" role="status" data-testid="community-bewertung-laedt">
            {{ t("community.redaktion.laedt") }}
        </p>
        <template v-else-if="stand.art === 'fehler'">
            <AvmHinweis ton="gefahr" rolle="alert" testid="community-bewertung-fehler">{{ stand.satz }}</AvmHinweis>
            <AvmKnopf testid="community-bewertung-erneut" @click="lade(false)">{{
                t("community.redaktion.neuLaden")
            }}</AvmKnopf>
        </template>

        <template v-else-if="detail !== undefined && zeile !== undefined && griff !== undefined">
            <AvmHinweis
                v-if="meldung !== undefined"
                :ton="meldung.ton"
                rolle="alert"
                testid="community-bewertung-meldung"
                >{{ meldung.satz }}</AvmHinweis
            >

            <!-- Das kleine Blatt: IM Fenster, am Anfang des Rumpfs; das Fenster wächst mit (so hoch wie sein Inhalt). -->
            <section
                v-if="blatt === 'verbergen'"
                ref="blattWurzel"
                class="blatt"
                :aria-label="t('bewertungen.redaktion.blatt.verbergen')"
                data-testid="community-bewertung-blatt-verbergen"
                @keydown="escBlatt"
            >
                <h3 class="blatt__titel avm-versalmitte">{{ t("bewertungen.redaktion.blatt.verbergen") }}</h3>
                <fieldset class="blatt__feld">
                    <legend class="blatt__label">{{ t("bewertungen.redaktion.blatt.grund") }}</legend>
                    <AvmKaestchen
                        v-for="wert in GRUENDE"
                        :key="wert"
                        art="radio"
                        :name="gruppe"
                        :checked="grund === wert"
                        :gesperrt="sendet ? '' : undefined"
                        :testid="`community-bewertung-grund-${wert}`"
                        @change="grund = wert"
                        >{{ grundName(wert) }}</AvmKaestchen
                    >
                </fieldset>
                <AvmKaestchen
                    v-if="offeneMeldungen > 0"
                    art="checkbox"
                    :checked="vorgaengeSchliessen"
                    :gesperrt="sendet ? '' : undefined"
                    testid="community-bewertung-vorgaenge-schliessen"
                    @change="(an: boolean) => (vorgaengeSchliessen = an)"
                    >{{
                        t("bewertungen.redaktion.blatt.vorgaengeAbschliessen", { nummern: zeile.gemeldet.join(", ") })
                    }}</AvmKaestchen
                >
                <p class="leise">{{ t("bewertungen.redaktion.blatt.verbergenHinweis") }}</p>
                <AvmHinweis v-if="blattFehler !== undefined" ton="gefahr" rolle="alert">{{ blattFehler }}</AvmHinweis>
                <div class="blatt__knoepfe">
                    <AvmKnopf
                        :gesperrt="sendet ? '' : undefined"
                        testid="community-bewertung-blatt-abbrechen"
                        @click="schliesseBlatt"
                        >{{ t("bewertungen.redaktion.blatt.abbrechen") }}</AvmKnopf
                    >
                    <AvmKnopf
                        art="gefuellt"
                        :gesperrt="verbergenSperre"
                        testid="community-bewertung-verbergen-senden"
                        @click="verberge"
                        >{{ t("bewertungen.redaktion.griff.verbergenSenden") }}</AvmKnopf
                    >
                </div>
            </section>
            <section
                v-else-if="blatt === 'loeschen'"
                ref="blattWurzel"
                class="blatt"
                :aria-label="t('bewertungen.redaktion.blatt.loeschen')"
                data-testid="community-bewertung-blatt-loeschen"
                @keydown="escBlatt"
            >
                <h3 class="blatt__titel avm-versalmitte">{{ t("bewertungen.redaktion.blatt.loeschen") }}</h3>
                <p class="blatt__text">{{ t("bewertungen.redaktion.blatt.loeschenText") }}</p>
                <p class="leise">{{ t("bewertungen.redaktion.blatt.loeschenPasskey") }}</p>
                <AvmHinweis v-if="blattFehler !== undefined" ton="gefahr" rolle="alert">{{ blattFehler }}</AvmHinweis>
                <div class="blatt__knoepfe">
                    <AvmKnopf
                        :gesperrt="sendet ? '' : undefined"
                        testid="community-bewertung-blatt-abbrechen"
                        @click="schliesseBlatt"
                        >{{ t("bewertungen.redaktion.blatt.abbrechen") }}</AvmKnopf
                    >
                    <AvmKnopf
                        art="gefahr"
                        :gesperrt="sendet ? '' : undefined"
                        testid="community-bewertung-loeschen-senden"
                        @click="loesche"
                        >{{ t("bewertungen.redaktion.blatt.loeschenSenden") }}</AvmKnopf
                    >
                </div>
            </section>

            <section class="kasten" data-testid="community-bewertung-inhalt">
                <h3 class="kasten__kopf avm-versalmitte">{{ t("bewertungen.redaktion.kasten.bewertung") }}</h3>
                <p><InfoStars :stars="sterneVon(zeile.sterne)" :label="sterneLabel(zeile.sterne)" /></p>
                <p class="inhalt">{{ textVon(zeile) || t("bewertungen.redaktion.ohneText") }}</p>
                <p class="leise">
                    {{ unterzeile(zeile) }}
                    <template v-if="zeile.gefaellt > 0">
                        · ♡
                        {{ t("bewertungen.redaktion.gefaelltZahl", { n: formatNumber(zeile.gefaellt, 0) }) }}</template
                    >
                </p>
            </section>

            <section class="kasten" data-testid="community-bewertung-ort">
                <h3 class="kasten__kopf avm-versalmitte">{{ t("bewertungen.redaktion.kasten.ort") }}</h3>
                <div class="ort">
                    <AvmKreis fuellung="voll" :name="t('community.redaktion.bezug.objekt')" />
                    <span class="ort__name">{{ detail.ort.name }}</span>
                    <span v-if="detail.ort.art !== null" class="leise">{{ detail.ort.art }}</span>
                    <span class="ort__griffe">
                        <AvmKnopf
                            groesse="zeile"
                            :title="t('community.redaktion.bezug.zeigen')"
                            :aria-label="t('community.redaktion.bezug.zeigen')"
                            testid="community-bewertung-zeigen"
                            @click="zeige"
                            >⊕</AvmKnopf
                        >
                    </span>
                </div>
                <p class="leise" data-testid="community-bewertung-ortsatz">{{ ortSatz(detail) }}</p>
            </section>

            <section v-if="detail.meldungen.length > 0" class="kasten" data-testid="community-bewertung-meldungen">
                <h3 class="kasten__kopf avm-versalmitte">{{ t("bewertungen.redaktion.kasten.meldungen") }}</h3>
                <p v-for="eintrag in detail.meldungen" :key="eintrag.nummer" class="meldung">
                    <AvmKnopf
                        groesse="zeile"
                        :testid="`community-bewertung-vorgang-${eintrag.nummer}`"
                        @click="oeffneVorgang(eintrag.nummer, eintrag.grund)"
                        >{{ eintrag.nummer }} · {{ grundName(eintrag.grund) }}</AvmKnopf
                    >
                    <span class="leise">{{
                        eintrag.zustand === "abgeschlossen"
                            ? t("community.redaktion.standAbgeschlossen", { ergebnis: eintrag.ergebnis ?? "" })
                            : t(`community.redaktion.zustand.${eintrag.zustand}` as MessageKey)
                    }}</span>
                </p>
            </section>

            <section class="kasten" data-testid="community-bewertung-verlauf">
                <h3 class="kasten__kopf avm-versalmitte">{{ t("bewertungen.redaktion.kasten.verlauf") }}</h3>
                <ol class="verlauf">
                    <li v-for="eintrag in verlauf" :key="eintrag.key">
                        <span class="leise">{{ eintrag.zeit }}</span> · {{ eintrag.text }}
                    </li>
                </ol>
            </section>
        </template>

        <!-- Der Fuß je Zustand (Bedienkonzept §6.2): der Satz zur Wirkung, links das Gefährliche, rechts das Gewöhnliche. Solange ein Blatt offen ist, gehört der Platz dem Blatt. -->
        <template v-if="zeile !== undefined && griff !== undefined && blatt === undefined" #fuss-hinweis>
            <div class="fuss" data-testid="community-bewertung-fuss">
                <p class="fuss__satz" data-testid="community-bewertung-fusssatz">{{ fussSatz(zeile) }}</p>
                <div class="fuss__knoepfe">
                    <span class="fuss__links">
                        <AvmKnopf
                            v-if="griff.verbergen.zeigen"
                            :gesperrt="
                                sendet ? '' : griff.verbergen.grund === undefined ? undefined : t(griff.verbergen.grund)
                            "
                            :grund-bei="sperrId"
                            testid="community-bewertung-verbergen"
                            @click="oeffneBlatt('verbergen')"
                            >{{ t("bewertungen.redaktion.griff.verbergen") }}</AvmKnopf
                        >
                        <AvmKnopf
                            v-if="griff.loeschen.zeigen"
                            art="gefahr"
                            :gesperrt="
                                sendet ? '' : griff.loeschen.grund === undefined ? undefined : t(griff.loeschen.grund)
                            "
                            :grund-bei="sperrId"
                            testid="community-bewertung-loeschen"
                            @click="oeffneBlatt('loeschen')"
                            >{{ t("bewertungen.redaktion.griff.loeschen") }}</AvmKnopf
                        >
                    </span>
                    <span class="fuss__rechts">
                        <AvmKnopf
                            v-if="griff.sichten.zeigen"
                            art="gefuellt"
                            :gesperrt="
                                sendet ? '' : griff.sichten.grund === undefined ? undefined : t(griff.sichten.grund)
                            "
                            :grund-bei="sperrId"
                            testid="community-bewertung-sichten"
                            @click="sichte"
                            >{{ t("bewertungen.redaktion.griff.sichten") }}</AvmKnopf
                        >
                        <AvmKnopf
                            v-if="griff.freigeben.zeigen"
                            art="gefuellt"
                            :gesperrt="
                                sendet ? '' : griff.freigeben.grund === undefined ? undefined : t(griff.freigeben.grund)
                            "
                            :grund-bei="sperrId"
                            testid="community-bewertung-freigeben"
                            @click="gibFrei"
                            >{{ t("bewertungen.redaktion.griff.freigeben") }}</AvmKnopf
                        >
                        <AvmKnopf
                            v-if="griff.einblenden.zeigen"
                            art="gefuellt"
                            :gesperrt="
                                sendet
                                    ? ''
                                    : griff.einblenden.grund === undefined
                                      ? undefined
                                      : t(griff.einblenden.grund)
                            "
                            :grund-bei="sperrId"
                            testid="community-bewertung-einblenden"
                            @click="blendeEin"
                            >{{ t("bewertungen.redaktion.griff.einblenden") }}</AvmKnopf
                        >
                    </span>
                </div>
                <AvmSperrgrund
                    v-if="
                        [griff.verbergen, griff.loeschen, griff.sichten, griff.freigeben, griff.einblenden].some(
                            (eintrag) => eintrag.zeigen && eintrag.grund !== undefined,
                        )
                    "
                    :id="sperrId"
                    :text="
                        t(
                            [griff.verbergen, griff.loeschen, griff.sichten, griff.freigeben, griff.einblenden].find(
                                (eintrag) => eintrag.zeigen && eintrag.grund !== undefined,
                            )?.grund ?? 'bewertungen.redaktion.grund.keinRecht',
                        )
                    "
                />
            </div>
        </template>
    </AvmFenster>
</template>

<style scoped>
.leiste {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.leiste__zustand {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
    color: var(--color-text-strong);
}

.leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

/* Ein Kasten des Rumpfs (wie im Vorgangsfenster, Probierseite `.kasten`): Kopf in Versalien, darunter die Zeilen. */
.kasten {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
}

.kasten p {
    margin: 0;
}

.kasten__kopf {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.inhalt {
    color: var(--color-text-strong);
    overflow-wrap: anywhere;
}

.ort {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
}

.ort__name {
    color: var(--color-text-strong);
    overflow-wrap: anywhere;
}

.ort__griffe {
    display: inline-flex;
    gap: var(--space-4);
    margin-left: auto;
}

.meldung {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-6);
}

.verlauf {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--font-size-small);
}

/* Das kleine Blatt: dieselbe Fassung wie im Vorgangsfenster (`vorgang-blatt.vue`). */
.blatt {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding: var(--space-8);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
}

.blatt__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.blatt__feld {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
}

.blatt__label {
    padding: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
}

.blatt__text {
    margin: 0;
    color: var(--color-text);
}

.blatt__knoepfe {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-6);
}

/* Der Fuß: ein Block (die Hülle kennt nur Hinweis und Knöpfe), also bricht er um. */
.fuss {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    box-sizing: border-box;
    padding: var(--space-2);
    color: var(--color-text);
    font-size: var(--font-size-body);
    white-space: normal;
}

.fuss__satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.fuss__knoepfe {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-6);
}

.fuss__links,
.fuss__rechts {
    display: inline-flex;
    flex-wrap: wrap;
    gap: var(--space-6);
}
</style>
