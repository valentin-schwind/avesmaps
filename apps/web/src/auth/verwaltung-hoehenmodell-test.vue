<script setup lang="ts">
/**
 * Die Werte von „19 (Test)“ im Eintrag „Höhenmodell“ (WI-0240; Entwurf abgenommen 2026-10-19 mit V1 „Typ wählen“). Was die Oberfläche
 * rechnet, steht in `hoehenmodell-test.ts`; hier steht nur, wie es aussieht.
 *
 * - **Oben die Leiste** (Hausregel „Seiten mit vielen Einstellungen“): links der Zustand, rechts EIN Auslöser mit Grund, Verwerfen und
 *   Speichern. Nach der Abnahme steht dort „Werte stehen fest“ mit dem Stand als Datei.
 * - **Bereiche mit Kacheln** wie die Gebirgs-Presets (Betreiber 2026-10-20: „Weitere Werte von Fassung 19 (Test) sollten auch editierbar
 *   sein (selbes tab-layout wie bei den gebirgspresets - wenn schon dann richtig)“): Gelände, Feinraster, Gebirgsform, Landschaften; je
 *   Zeile Feld im Goldenen Schnitt, Satz mit Folge, ↺ auf die Datei. Was nur lesend bleibt, steht unter „Technik“.
 * - **Gebirgs-Presets V1:** die Kacheln der elf Typen mit der Zahl geänderter oder abweichender Werte, darunter die Werte des gewählten
 *   Typs in drei Bereichen mit zwölf Reglern, jeder mit Vorschau (WI-0249 P8, Betreiber 2026-10-24: „wir sind mit der anzahl überfordert“):
 *   Gebirgsform, Rinnen in der Vorschau, Im fertigen Gelände (`hoehenmodell-regler.ts`). Alle einzelnen Werte (Grundmuster, die zehn der
 *   V12, die Typwerte des Rückennetzes) stehen unverändert zugeklappt unter „Alle Werte (für Feinarbeit)“.
 * - **Höhenstufen**, die Technik nur lesbar und der **Verlauf** mit „↺ Zurücknehmen“.
 */
import { computed, ref, watch } from "vue";
import { HOEHENMODELL_BEREICHE, type Gebirgstyp, type HoehenmodellBereich } from "@avesmaps3d/shared";
import AvmDisclosure from "../controls/avm-disclosure.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import FensterKarte from "../fenster/fenster-karte.vue";
import { locale, t, type MessageKey } from "../i18n/i18n";
import { relativeTime } from "../i18n/relative-time";
import { ketteSatz, zahl, type Hoehenmodell } from "./hoehenmodell";
import {
    bereichKarte,
    kacheln,
    leiste,
    neu,
    stufenPanel,
    testName,
    typWerte,
    verlauf,
    zeile,
    zurueckText,
    type TestZeile,
} from "./hoehenmodell-test";
import {
    REGLER,
    REGLER_BEREICHE,
    REGLER_FOLGE,
    reglerHinweise,
    reglerTippt,
    reglerZeile,
    reglerZurueck,
    type ReglerDef,
    type ReglerHinweis,
    type ReglerId,
} from "./hoehenmodell-regler";
import { vorschauFuer, vorschauFuerRegler, vorschauFuerWert, type VorschauModell } from "./hoehenmodell-vorschau";
import HoehenmodellWertzeile from "./hoehenmodell-wertzeile.vue";
import VerwaltungMeldung from "./verwaltung-meldung.vue";

const props = defineProps<{
    hoehenmodell: Hoehenmodell;
    darf: boolean;
    telefon: boolean;
    jetzt: Date;
}>();

const h = props.hoehenmodell;
const zeit = (iso: string): string => relativeTime(new Date(iso), props.jetzt, locale.value, "zeitpunkt");

const stand = computed(() => h.stand.value!);
const test = computed(() => stand.value.test!);
const felder = computed(() => h.test.value.felder);
const name = computed(() => testName(test.value));

const oben = computed(() =>
    leiste(stand.value, test.value, felder.value, h.test.value.grund, ketteSatz(stand.value), zeit),
);
/** Gesperrt ohne eigenen Satz (er steht einmal oben): kein Recht, abgenommen oder ein Schreibweg läuft. */
const gesperrt = computed(() => (!props.darf || test.value.gesperrt || h.busy.value ? "" : undefined));
const bereiche = computed(() =>
    HOEHENMODELL_BEREICHE.map((bereich) =>
        bereichKarte(test.value, felder.value, bereich, h.test.value.kacheln[bereich]),
    ).filter((karte) => karte.kacheln.length > 0),
);
const stufen = stufenPanel();
const stufenKeys = stufen.eintraege.flatMap((eintrag) => ("key" in eintrag ? [eintrag.key] : []));
const typen = computed(() => kacheln(test.value, felder.value));
const typ = computed(() => h.test.value.typ as Gebirgstyp);
const preset = computed(() => typWerte(test.value, felder.value, typ.value));
const eintraege = computed(() => verlauf(test.value, zeit));
const technik = computed(() => Object.entries(test.value.technik));
/**
 * Die einzelnen Werte unter „Alle Werte“: die der V12 und die Typwerte des Rückennetzes des gewählten Typs. Das Grundmuster steht nur oben, als Regler:
 * Es ist kein zusammengefasster Wert, und derselbe Schalter zweimal wäre eine zweite Wahrheit.
 */
const alleForm = computed(() => preset.value.form.filter((key) => !key.startsWith("m:")));
const alleWerte = computed(() => alleForm.value.length + preset.value.fein.length + preset.value.rueckennetz.length);

const z = (key: string) => zeile(test.value, felder.value, key);

/**
 * Die Vorschau neben einigen Werten (WI-0249, Entwurf): nur die Zeilen, für die es eine gibt, bauen ihr Modell; die Tafel mit den
 * getippten Werten entsteht einmal je Änderung. Die Vorschauen der globalen Werte rechnen am gewählten Gebirgstyp.
 */
const tafel = computed(() => neu(test.value, felder.value));
const vorschau = (key: string): VorschauModell | null =>
    vorschauFuer(test.value, felder.value, key, typ.value, z(key).lang, tafel.value);
/** Die Vorschauen der einzelnen Werte der Liste „Alle Werte“: ein Schema mit Schieber, wo es eines gibt. Sie entstehen einmal je Änderung. */
const wertVorschauen = computed(
    () =>
        new Map(
            [...alleForm.value, ...preset.value.fein, ...preset.value.rueckennetz].map(
                (key) => [key, vorschauFuerWert(test.value, key, typ.value, tafel.value, z(key).lang)] as const,
            ),
        ),
);
const wertVorschau = (key: string): VorschauModell | null => wertVorschauen.value.get(key) ?? null;

/**
 * Die Regler der Gebirgs-Presets (WI-0249 P8): je Bereich die Regler mit ihrer Zeile, Vorschau und den Hinweisen darunter. Was ein Regler
 * schreibt, steht in `hoehenmodell-regler.ts`. Das Grundmuster ist die Wahl des Typs (`m:<typ>`) und hat keinen Schieber.
 */
interface ReglerEintrag {
    id: ReglerId;
    def: ReglerDef;
    zeile: TestZeile;
    vorschau: VorschauModell | null;
    hinweise: ReglerHinweis[];
}
/** Was jemand in das Feld eines Reglers tippt, bis die Zeile es übernommen hat (die Felder der Tafel kennen nur die echten Werte). */
const roh = ref<Record<string, string>>({});
// „Verwerfen“ leert alle Felder; ein getippter, ungültiger Text eines Reglers soll dann nicht stehen bleiben.
watch(
    () => Object.keys(felder.value).length === 0,
    (leer) => {
        if (leer) roh.value = {};
    },
);
const reglerBereiche = computed(() =>
    REGLER_BEREICHE.map((bereich) => ({
        id: bereich,
        titel: t(`admin.terrain.test.regler.bereich.${bereich}.titel` as MessageKey),
        satz: t(`admin.terrain.test.regler.bereich.${bereich}.satz` as MessageKey),
        regler: REGLER_FOLGE[bereich].map((id): ReglerEintrag => {
            const def = REGLER[id];
            const zeileVon =
                def.art === "muster"
                    ? z(`m:${typ.value}`)
                    : reglerZeile(test.value, felder.value, def, typ.value, roh.value[id]);
            return {
                id,
                def,
                zeile: zeileVon,
                vorschau: vorschauFuerRegler(test.value, def, typ.value, tafel.value, zeileVon.lang),
                hinweise: reglerHinweise(def, tafel.value, typ.value),
            };
        }),
    })),
);

function ohne(rest: Record<string, string>, id: string): Record<string, string> {
    return Object.fromEntries(Object.entries(rest).filter(([schluessel]) => schluessel !== id));
}

/** Ein Regler getippt oder gezogen: alle Felder, die er stellt, gehen in den Entwurf. `roh` hält das getippte Feld, bis der Wert gilt. */
function tippeRegler(def: ReglerDef, text: string): void {
    if (def.art === "muster") {
        h.testTippe(`m:${typ.value}`, text);
        return;
    }
    roh.value = { ...roh.value, [def.id]: text };
    const werte = reglerTippt(def, tafel.value, typ.value, text);
    if (Object.keys(werte).length > 0) h.testTippeMehrere(werte);
}

function zurueckRegler(def: ReglerDef): void {
    roh.value = ohne(roh.value, def.id);
    h.testTippeMehrere(reglerZurueck(test.value, def, typ.value));
}

const meldung = computed(() => {
    const letzte = h.ergebnis.value;
    return letzte !== null && letzte.ort === "test" ? letzte.result : undefined;
});

function waehleTyp(neu: Gebirgstyp): void {
    roh.value = {};
    h.test.value = { ...h.test.value, typ: neu };
}

function waehleKachel(bereich: HoehenmodellBereich, id: string): void {
    h.test.value = { ...h.test.value, kacheln: { ...h.test.value.kacheln, [bereich]: id } };
}

function zuruecknehmen(werte: Readonly<Record<string, string>>, revision: number): void {
    h.testTrageEin(werte, t("admin.terrain.test.history.undoReason", { r: revision }));
}

async function herunterladen(): Promise<void> {
    const datei = await h.testStand();
    if (datei === null) return;
    const url = URL.createObjectURL(new Blob([datei.inhalt], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = datei.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
</script>

<template>
    <div class="test" :class="{ 'test--telefon': props.telefon }" data-testid="hoehenmodell-test">
        <h3 class="test__titel">{{ t("admin.terrain.test.values", { name }) }}</h3>

        <!-- Die Leiste: links der Zustand, rechts der EINE Auslöser. -->
        <div class="test__leiste" data-testid="hoehenmodell-test-leiste">
            <div class="test__stand" role="status">
                <span
                    v-for="(satz, i) in oben.saetze"
                    :key="i"
                    :class="{ test__offen: i === 0 && oben.offen }"
                    :data-testid="i === 0 ? 'hoehenmodell-test-zustand' : undefined"
                    >{{ satz }}</span
                >
                <button
                    v-if="oben.gesperrt && props.darf"
                    type="button"
                    class="test__verweis"
                    data-testid="hoehenmodell-test-stand"
                    @click="void herunterladen()"
                >
                    {{ t("admin.terrain.test.bar.download", { datei: `${test.version}.json` }) }}
                </button>
            </div>
            <div v-if="!oben.gesperrt && props.darf" class="test__ausloeser">
                <label v-if="oben.formular" class="test__grund">
                    <span class="test__beschriftung">{{ t("admin.system.ask.reason") }}</span>
                    <AvmEingabe
                        v-model="h.test.value.grund"
                        :placeholder="t('admin.system.ask.reasonHint')"
                        autocomplete="off"
                        testid="hoehenmodell-test-grund"
                    />
                </label>
                <AvmKnopf
                    v-if="oben.formular"
                    art="weich"
                    :gesperrt="h.busy.value ? '' : undefined"
                    testid="hoehenmodell-test-verwerfen"
                    @click="h.testVerwerfen()"
                    >{{ t("admin.terrain.discard") }}</AvmKnopf
                >
                <AvmKnopf
                    art="gefuellt"
                    :gesperrt="h.busy.value ? '' : oben.sperre"
                    testid="hoehenmodell-test-speichern"
                    @click="void h.testSpeichern()"
                    >{{ t("admin.terrain.test.save") }}</AvmKnopf
                >
            </div>
        </div>
        <VerwaltungMeldung :ergebnis="meldung" testid="hoehenmodell-test-meldung" />

        <FensterKarte
            v-for="karte in bereiche"
            :key="karte.id"
            :titel="karte.titel"
            :data-testid="`hoehenmodell-test-panel-${karte.id}`"
        >
            <p class="test__wirkung">{{ karte.wirkung }}</p>
            <div
                class="test__kacheln"
                role="radiogroup"
                :aria-label="karte.titel"
                :data-testid="`hoehenmodell-test-kacheln-${karte.id}`"
            >
                <button
                    v-for="kachel in karte.kacheln"
                    :key="kachel.id"
                    type="button"
                    role="radio"
                    class="test__kachel"
                    :class="{ 'is-an': kachel.id === karte.gewaehlt }"
                    :aria-checked="kachel.id === karte.gewaehlt"
                    :title="kachel.titel"
                    :data-testid="`hoehenmodell-test-kachel-${karte.id}-${kachel.id}`"
                    @click="waehleKachel(karte.id, kachel.id)"
                >
                    <span>{{ kachel.name }}</span>
                    <small v-if="kachel.marke !== null" class="test__marke" :class="{ test__offen: kachel.offen }">{{
                        kachel.marke
                    }}</small>
                </button>
            </div>
            <p class="test__wirkung">{{ karte.satz }}</p>
            <div class="test__werte">
                <HoehenmodellWertzeile
                    v-for="key in karte.keys"
                    :key="key"
                    :zeile="z(key)"
                    :gesperrt="gesperrt"
                    :abgenommen="test.gesperrt"
                    :telefon="props.telefon"
                    :vorschau="vorschau(key)"
                    @tippe="h.testTippe(key, $event)"
                    @zurueck="h.testTippe(key, zurueckText(test, key))"
                />
            </div>
        </FensterKarte>

        <FensterKarte
            v-if="test.presets !== null"
            :titel="t('admin.terrain.test.panel.presets')"
            data-testid="hoehenmodell-test-panel-presets"
        >
            <p class="test__wirkung">{{ t("admin.terrain.test.panel.presetsWhen") }}</p>
            <div
                class="test__kacheln"
                role="radiogroup"
                :aria-label="t('landschaftseditor.gebirge.typ.titel')"
                data-testid="hoehenmodell-test-kacheln"
            >
                <button
                    v-for="kachel in typen"
                    :key="kachel.typ"
                    type="button"
                    role="radio"
                    class="test__kachel"
                    :class="{ 'is-an': kachel.typ === typ }"
                    :aria-checked="kachel.typ === typ"
                    :title="kachel.titel"
                    :data-testid="`hoehenmodell-test-typ-${kachel.typ}`"
                    @click="waehleTyp(kachel.typ)"
                >
                    <span>{{ kachel.name }}</span>
                    <small v-if="kachel.marke !== null" class="test__marke" :class="{ test__offen: kachel.offen }">{{
                        kachel.marke
                    }}</small>
                </button>
            </div>
            <p class="test__wirkung">{{ preset.hinweis }}</p>
            <div class="test__werte" data-testid="hoehenmodell-test-regler">
                <template v-for="bereich in reglerBereiche" :key="bereich.id">
                    <h4
                        class="test__abschnitt avm-versalmitte"
                        :data-testid="`hoehenmodell-test-regler-bereich-${bereich.id}`"
                    >
                        {{ bereich.titel }}
                    </h4>
                    <p class="test__wirkung test__bereich-satz">{{ bereich.satz }}</p>
                    <p
                        v-if="bereich.id === 'form'"
                        class="test__wirkung test__bereich-satz"
                        data-testid="hoehenmodell-test-regler-kammhoehe"
                    >
                        {{ t("admin.terrain.test.regler.kammhoehe") }}
                    </p>
                    <HoehenmodellWertzeile
                        v-for="eintrag in bereich.regler"
                        :key="eintrag.id"
                        class="test__regler"
                        :zeile="eintrag.zeile"
                        :gesperrt="gesperrt"
                        :abgenommen="test.gesperrt"
                        :telefon="props.telefon"
                        :vorschau="eintrag.vorschau"
                        :hinweise="eintrag.hinweise"
                        @tippe="tippeRegler(eintrag.def, $event)"
                        @zurueck="zurueckRegler(eintrag.def)"
                    />
                </template>
            </div>
            <AvmDisclosure
                :label="t('admin.terrain.test.regler.alle.titel')"
                :secondary="t('admin.terrain.test.regler.alle.kurz', { n: alleWerte })"
                toggle-testid="hoehenmodell-test-alle-werte"
            >
                <p class="test__wirkung">{{ t("admin.terrain.test.regler.alle.satz") }}</p>
                <div class="test__werte" data-testid="hoehenmodell-test-alle">
                    <h4 class="test__abschnitt avm-versalmitte">{{ preset.titel }}</h4>
                    <HoehenmodellWertzeile
                        v-for="key in alleForm"
                        :key="key"
                        :class="{ test__regler: wertVorschau(key) !== null }"
                        :zeile="z(key)"
                        :gesperrt="gesperrt"
                        :abgenommen="test.gesperrt"
                        :telefon="props.telefon"
                        :vorschau="wertVorschau(key)"
                        kompakt
                        @tippe="h.testTippe(key, $event)"
                        @zurueck="h.testTippe(key, zurueckText(test, key))"
                    />
                    <h4 class="test__abschnitt avm-versalmitte">{{ t("landschaftseditor.gebirge.fein") }}</h4>
                    <HoehenmodellWertzeile
                        v-for="key in preset.fein"
                        :key="key"
                        :class="{ test__regler: wertVorschau(key) !== null }"
                        :zeile="z(key)"
                        :gesperrt="gesperrt"
                        :abgenommen="test.gesperrt"
                        :telefon="props.telefon"
                        :vorschau="wertVorschau(key)"
                        kompakt
                        @tippe="h.testTippe(key, $event)"
                        @zurueck="h.testTippe(key, zurueckText(test, key))"
                    />
                    <h4 class="test__abschnitt avm-versalmitte">{{ t("admin.terrain.test.rueckennetz.titel") }}</h4>
                    <p class="test__wirkung">{{ t("admin.terrain.test.rueckennetz.wirkung") }}</p>
                    <HoehenmodellWertzeile
                        v-for="key in preset.rueckennetz"
                        :key="key"
                        :class="{ test__regler: wertVorschau(key) !== null }"
                        :zeile="z(key)"
                        :gesperrt="gesperrt"
                        :abgenommen="test.gesperrt"
                        :telefon="props.telefon"
                        :vorschau="wertVorschau(key)"
                        kompakt
                        @tippe="h.testTippe(key, $event)"
                        @zurueck="h.testTippe(key, zurueckText(test, key))"
                    />
                </div>
            </AvmDisclosure>
        </FensterKarte>

        <FensterKarte v-if="test.presets !== null" :titel="stufen.titel" data-testid="hoehenmodell-test-panel-stufen">
            <p class="test__wirkung">{{ stufen.wirkung }}</p>
            <div class="test__werte">
                <HoehenmodellWertzeile
                    v-for="key in stufenKeys"
                    :key="key"
                    :zeile="z(key)"
                    :gesperrt="gesperrt"
                    :abgenommen="test.gesperrt"
                    :telefon="props.telefon"
                    @tippe="h.testTippe(key, $event)"
                    @zurueck="h.testTippe(key, zurueckText(test, key))"
                />
            </div>
        </FensterKarte>

        <FensterKarte :titel="t('admin.terrain.test.technik.titel')" data-testid="hoehenmodell-test-technik">
            <p class="test__wirkung">{{ t("admin.terrain.test.technik.satz") }}</p>
            <dl class="test__technik">
                <template v-for="[pfad, wert] in technik" :key="pfad">
                    <dt>{{ t(`admin.terrain.test.technik.${pfad}` as MessageKey) }}</dt>
                    <dd>{{ typeof wert === "number" ? zahl(wert) : wert }}</dd>
                </template>
            </dl>
        </FensterKarte>

        <FensterKarte :titel="t('admin.terrain.test.history.title')" data-testid="hoehenmodell-test-verlauf">
            <template #etikett>
                <span class="test__etikett">{{ t("admin.terrain.test.history.newest") }}</span>
            </template>
            <p v-if="eintraege.length === 0" class="test__wirkung">
                {{ t("admin.terrain.test.history.empty", { datei: `${test.version}.json` }) }}
            </p>
            <ol v-else class="test__verlauf">
                <li
                    v-for="e in eintraege"
                    :key="e.revision"
                    class="test__eintrag"
                    :data-testid="`hoehenmodell-test-verlauf-${e.revision}`"
                >
                    <span class="test__was">{{ e.kopf }}</span>
                    <span class="test__leise">{{ e.unter }}</span>
                    <dl class="test__felder">
                        <template v-for="a in e.aenderungen" :key="a.key">
                            <dt>{{ a.name }}</dt>
                            <dd>
                                <s class="test__leise">{{ a.alt }}</s> → <span>{{ a.neu }}</span>
                            </dd>
                        </template>
                    </dl>
                    <template v-if="!test.gesperrt && props.darf">
                        <p v-if="e.konflikt.length > 0" class="test__leise">
                            {{ t("admin.terrain.test.history.conflict", { felder: e.konflikt.join(", ") }) }}
                        </p>
                        <div v-else-if="e.aenderungen.length > 0">
                            <AvmKnopf
                                groesse="zeile"
                                :gesperrt="h.busy.value ? '' : undefined"
                                :testid="`hoehenmodell-test-zuruecknehmen-${e.revision}`"
                                @click="zuruecknehmen(e.zurueck, e.revision)"
                                >{{ t("verlauf.zurueck") }}</AvmKnopf
                            >
                        </div>
                    </template>
                </li>
            </ol>
            <p class="test__wirkung">{{ t("admin.terrain.test.history.file", { datei: `${test.version}.json` }) }}</p>
        </FensterKarte>
    </div>
</template>

<style scoped>
.test {
    display: flex;
    flex-direction: column;
    gap: var(--divider-gap);
    min-width: 0;
}

.test__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-small);
    font-weight: 400;
    letter-spacing: 0.02em;
}

/* Die Leiste wie in der Wegfindung: Zustand links, der Auslöser rechts. */
.test__leiste {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-6) var(--space-10);
    padding: var(--space-8) var(--space-12);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-muted);
}

.test__stand {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    min-width: 0;
    flex: 1 1 18rem;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.test__stand > :first-child {
    color: var(--color-text);
}

.test__stand > .test__offen:first-child,
.test__offen {
    color: var(--color-accent-strong);
}

.test__verweis {
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    text-decoration: underline;
}

.test__verweis:hover {
    color: var(--color-link-hover);
}

.test__ausloeser {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--space-6);
}

.test__grund {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 14rem;
}

.test__beschriftung {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.test__wirkung,
.test__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.test__wirkung {
    margin-bottom: var(--space-6);
}

.test__werte {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-8) var(--space-24);
    align-items: start;
}

/* Die Zwischenüberschriften stehen über beide Säulen, nicht in einer. */
.test__abschnitt {
    grid-column: 1 / -1;
    margin: var(--space-6) 0 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-small);
}

.test__abschnitt:first-child {
    margin-top: 0;
}

/* Die Sätze unter einer Bereichsüberschrift stehen über beide Säulen. */
.test__bereich-satz {
    grid-column: 1 / -1;
    margin-bottom: 0;
}

/* Ein Regler mit Vorschau braucht Platz: Er steht über beide Säulen, nicht breiter als lesbar. */
.test__regler {
    grid-column: 1 / -1;
    max-width: 60rem;
}

/* Die Klappbox „Alle Werte“ trennt sich vom Block darüber. */
.test :deep(.disclosure) {
    margin-top: var(--space-8);
}

/* Die Kacheln des Gebirge-Reiters. */
.test__kacheln {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(7.5rem, 1fr));
    gap: var(--space-4);
    margin-bottom: var(--space-6);
}

.test__kachel {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    min-height: var(--avm-control-h);
    padding: var(--space-4) var(--space-6);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    color: var(--color-text);
    cursor: pointer;
    font: inherit;
    text-align: left;
}

.test__kachel:hover {
    border-color: var(--color-border-strong);
}

.test__kachel.is-an {
    border-color: var(--color-accent-brown);
    box-shadow: inset 0 0 0 1px var(--color-accent-brown);
}

.test__kachel:focus-visible {
    outline: var(--focus-ring, 2px solid var(--color-accent));
    outline-offset: 2px;
}

.test__marke {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.test__etikett {
    margin-left: auto;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.test__verlauf {
    display: grid;
    gap: var(--space-8);
    margin: 0 0 var(--space-6);
    padding: 0;
    list-style: none;
}

.test__eintrag {
    display: grid;
    gap: var(--space-4);
    padding-bottom: var(--space-8);
    border-bottom: 1px solid var(--color-border);
}

.test__was {
    color: var(--color-text-strong);
}

.test__felder,
.test__technik {
    display: grid;
    grid-template-columns: minmax(6rem, auto) minmax(0, 1fr);
    gap: var(--space-4) var(--space-8);
    margin: 0;
    font-size: var(--font-size-small);
}

.test__felder dt,
.test__technik dt {
    color: var(--color-text-muted);
}

.test__felder dd,
.test__technik dd {
    margin: 0;
    overflow-wrap: anywhere;
    font-variant-numeric: tabular-nums;
}

@media (max-width: 900px) {
    .test__werte {
        grid-template-columns: minmax(0, 1fr);
    }
}

.test--telefon .test__werte {
    grid-template-columns: minmax(0, 1fr);
}

.test--telefon .test__ausloeser,
.test--telefon .test__grund {
    flex: 1 1 100%;
    min-width: 0;
}
</style>
