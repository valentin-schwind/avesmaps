<script setup lang="ts">
/**
 * Der Reiter „Sonderrollen“ der Kontenverwaltung (WI-0279, Entwurf Fassung 2): links die zehn Rollen mit ○ ◐ ●, rechts Inhaber, Rechte und
 * Verlauf der gewählten Rolle. 🔴 Das Recht folgt aus der Zuteilung; was eine Rolle darf, steht im Katalog (`packages/shared`). Lesen ab
 * Admin, vergeben und entziehen nur mit `grant_special_capabilities`, mit frischem Passkey und Grund; der Server prüft jede Handlung.
 *
 * Eine Zeile je Zuteilung: Wer zwei Regionen betreut, steht zweimal da, und jede Region lässt sich einzeln entziehen.
 */
import { computed, onMounted, reactive, ref, watch } from "vue";
import {
    CAPABILITIES,
    SONDERROLLEN_NAMEN,
    sonderrolleSpec,
    type Assurance,
    type Capability,
    type SonderrolleName,
    type SonderrolleZuteilung,
} from "@avesmaps3d/shared";
import AvmAvatar from "../controls/avm-avatar.vue";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmKreisLegende from "../controls/avm-kreis-legende.vue";
import AvmKreis from "../controls/avm-kreis.vue";
import AvmPille from "../controls/avm-pille.vue";
import FensterTafel from "../fenster/fenster-tafel.vue";
import { isMessageKey, locale, t, tPlural } from "../i18n/i18n";
import { relativeTime } from "../i18n/relative-time";
import { authState } from "./session-state";
import SonderrollenRegionen from "./sonderrollen-regionen.vue";
import type { ActionResult, Administration } from "./verwaltung";
import VerwaltungLadeproblem from "./verwaltung-ladeproblem.vue";
import VerwaltungMeldung from "./verwaltung-meldung.vue";
import { label } from "./verwaltung-text";

const props = defineProps<{ verwaltung: Administration }>();

const hatVergaberecht = authState.value.capabilities.includes("grant_special_capabilities");
/** Der Abgleich von Production (WI-0279 E9): Ist er eingerichtet, liest dieser Reiter nur. */
const abgleich = computed(() => props.verwaltung.sonderrollen.value?.abgleich);
const darfVergeben = computed(() => hatVergaberecht && abgleich.value === undefined);
const abgleichSatz = computed((): string => {
    const stand = abgleich.value;
    if (stand === undefined) return "";
    if (stand.gestoertSeit !== null) {
        return t(stand.ruht ? "admin.sonderrollen.abgleich.ruhend" : "admin.sonderrollen.abgleich.gestoert", {
            zeit: vor(stand.gestoertSeit),
        });
    }
    return stand.zuletzt === null
        ? t("admin.sonderrollen.abgleich.ausstehend")
        : t("admin.sonderrollen.abgleich.ok", { zeit: vor(stand.zuletzt) });
});
const jetzt = new Date();
const vor = (iso: string): string => relativeTime(new Date(iso), jetzt, locale.value);

const gewaehlt = ref<SonderrolleName>(SONDERROLLEN_NAMEN[0]!);
/** Die Sätze der gewählten Rolle aus der Tafel, `.1` bis zur ersten Lücke. Sie beschreiben, was gilt; ohne Paket 6 ist Form und Gebirge noch ab Editor offen. */
const wirkung = computed(() => {
    const saetze: string[] = [];
    for (let nummer = 1; ; nummer += 1) {
        const key = `admin.sonderrollen.wirkung.${gewaehlt.value}.${String(nummer)}`;
        if (!isMessageKey(key)) return saetze;
        saetze.push(t(key));
    }
});
const zuteilungen = computed(() => props.verwaltung.sonderrollen.value?.zuteilungen ?? []);
const regionen = computed(() => props.verwaltung.sonderrollen.value?.regionen ?? []);
const aktive = computed(() => zuteilungen.value.filter((zeile) => zeile.entzogenAm === null));
const aktiveVon = (rolle: SonderrolleName): SonderrolleZuteilung[] =>
    aktive.value.filter((zeile) => zeile.sonderrolle === rolle);
const inhaberZahl = (rolle: SonderrolleName): number => new Set(aktiveVon(rolle).map((zeile) => zeile.person.id)).size;

const RANG: Record<Assurance, number> = { r: 0, v: 1, s: 2 };
function hoechsteStufe(rolle: SonderrolleName): Assurance {
    return sonderrolleSpec(rolle).rechte.reduce<Assurance>(
        (hoechste, recht) =>
            RANG[CAPABILITIES[recht].assurance] > RANG[hoechste] ? CAPABILITIES[recht].assurance : hoechste,
        "r",
    );
}
const brauchtPasskey = (rolle: SonderrolleName): boolean => hoechsteStufe(rolle) !== "r";
const ohnePasskey = (zeile: SonderrolleZuteilung): boolean =>
    brauchtPasskey(zeile.sonderrolle as SonderrolleName) && !zeile.hatPasskey;

type Kreis = "leer" | "halb" | "voll";
function kreisVon(rolle: SonderrolleName): Kreis {
    const zeilen = aktiveVon(rolle);
    if (zeilen.length === 0) return "leer";
    return zeilen.some(ohnePasskey) ? "halb" : "voll";
}
const KREIS_NAMEN = computed(() => ({
    leer: t("admin.sonderrollen.kreis.leer"),
    halb: t("admin.sonderrollen.kreis.halb"),
    voll: t("admin.sonderrollen.kreis.voll"),
}));
const kreisZahlen = computed(() => {
    const zahlen = { leer: 0, halb: 0, "halb-rechts": 0, voll: 0 };
    for (const rolle of SONDERROLLEN_NAMEN) zahlen[kreisVon(rolle)] += 1;
    return zahlen;
});
const unterzeile = (rolle: SonderrolleName): string => {
    const anzahl = sonderrolleSpec(rolle).rechte.length;
    return anzahl === 0
        ? t("admin.sonderrollen.keineRechte")
        : tPlural("admin.sonderrollen.rechteStufe", anzahl, { n: anzahl, stufe: hoechsteStufe(rolle).toUpperCase() });
};

const rolleName = (rolle: string): string => label("auth.sonderrolle", rolle);
const rechte = computed<readonly Capability[]>(() => sonderrolleSpec(gewaehlt.value).rechte);
const inhaber = computed(() => aktiveVon(gewaehlt.value));
const ohnePasskeyNamen = computed(() => [
    ...new Set(inhaber.value.filter(ohnePasskey).map((zeile) => zeile.person.displayName)),
]);

/** Der Verlauf der gewählten Rolle, neueste zuerst: Vergabe und Entzug je Zeile. */
const verlauf = computed(() =>
    zuteilungen.value
        .filter((zeile) => zeile.sonderrolle === gewaehlt.value)
        .flatMap((zeile) => {
            const wer =
                zeile.region === null ? zeile.person.displayName : `${zeile.person.displayName} (${zeile.region.name})`;
            const eintraege = [
                {
                    id: `${zeile.id}-vergeben`,
                    am: zeile.vergebenAm,
                    text: t("admin.sonderrollen.verlauf.vergeben", {
                        wer,
                        von: zeile.vergebenVon?.displayName ?? "?",
                    }),
                    grund: zeile.grund,
                },
            ];
            if (zeile.entzogenAm !== null) {
                eintraege.push({
                    id: `${zeile.id}-entzogen`,
                    am: zeile.entzogenAm,
                    text: t("admin.sonderrollen.verlauf.entzogen", {
                        wer,
                        von: zeile.entzogenVon?.displayName ?? "?",
                    }),
                    grund: zeile.entzugGrund,
                });
            }
            return eintraege;
        })
        .sort((a, b) => b.am.localeCompare(a.am))
        .slice(0, 6),
);

// Vergeben.
const vergabe = reactive({ offen: false, suche: "", personId: "", regionen: [] as string[], grund: "" });
const ergebnis = ref<ActionResult | undefined>(undefined);
const laeuft = ref(false);
function vergabeOeffnen(): void {
    Object.assign(vergabe, { offen: true, suche: "", personId: "", regionen: [], grund: "" });
    ergebnis.value = undefined;
}
watch(gewaehlt, () => {
    vergabe.offen = false;
    entziehen.id = null;
    ergebnis.value = undefined;
});

const spec = computed(() => sonderrolleSpec(gewaehlt.value));
const person = computed(() => props.verwaltung.people.value.find((zeile) => zeile.id === vergabe.personId));
const hatSchon = (personId: string): boolean =>
    spec.value.regional !== true && inhaber.value.some((zeile) => zeile.person.id === personId);
const personen = computed(() => {
    const q = vergabe.suche.trim().toLocaleLowerCase();
    return props.verwaltung.people.value
        .filter((zeile) => zeile.status === "active" && zeile.access === "active")
        .filter((zeile) => q === "" || zeile.displayName.toLocaleLowerCase().includes(q))
        .slice(0, 6);
});
/** Wer eine Region schon hat (bei „höchstens eine Person“) oder wie viele dort sind. */
const regionZusatz = computed(() => {
    const zusatz = new Map<string, string>();
    for (const zeile of inhaber.value) {
        if (zeile.region === null) continue;
        zusatz.set(
            zeile.region.id,
            spec.value.einePersonJeRegion === true
                ? t("admin.sonderrollen.regionVergeben", { name: zeile.person.displayName })
                : t("admin.sonderrollen.regionInhaber"),
        );
    }
    return zusatz;
});
const konflikt = computed(() => {
    if (spec.value.einePersonJeRegion !== true) return undefined;
    return inhaber.value.find(
        (zeile) =>
            zeile.region !== null && vergabe.regionen.includes(zeile.region.id) && zeile.person.id !== vergabe.personId,
    );
});
const vergabeFehlt = computed(() => {
    if (vergabe.personId === "") return t("admin.sonderrollen.fehlt.person");
    if (spec.value.regional === true && vergabe.regionen.length === 0) return t("admin.sonderrollen.fehlt.region");
    if (konflikt.value !== undefined) return t("admin.sonderrollen.fehlt.konflikt");
    if (vergabe.grund.trim() === "") return t("admin.sonderrollen.fehlt.grund");
    return undefined;
});
async function vergeben(): Promise<void> {
    if (laeuft.value || vergabeFehlt.value !== undefined) return;
    laeuft.value = true;
    try {
        const antwort = await props.verwaltung.vergebeSonderrolle({
            personId: vergabe.personId,
            sonderrolle: gewaehlt.value,
            regionen: spec.value.regional === true ? vergabe.regionen : [],
            grund: vergabe.grund.trim(),
        });
        ergebnis.value = antwort;
        if (antwort.ok) vergabe.offen = false;
    } finally {
        laeuft.value = false;
    }
}

// Entziehen.
const entziehen = reactive<{ id: string | null; grund: string }>({ id: null, grund: "" });
async function entzugBestaetigen(zeile: SonderrolleZuteilung): Promise<void> {
    if (laeuft.value || entziehen.grund.trim() === "") return;
    laeuft.value = true;
    try {
        const antwort = await props.verwaltung.entzieheSonderrolle(zeile.id, entziehen.grund.trim());
        ergebnis.value = antwort;
        if (antwort.ok) entziehen.id = null;
    } finally {
        laeuft.value = false;
    }
}

onMounted(() => {
    void props.verwaltung.loadSonderrollen();
    if (hatVergaberecht && props.verwaltung.people.value.length === 0) void props.verwaltung.loadPeople();
});
</script>

<template>
    <p class="sr__lead">{{ t("admin.sonderrollen.lead") }}</p>
    <VerwaltungLadeproblem
        v-if="verwaltung.loadProblems.has('sonderrollen')"
        :problems="verwaltung.loadProblems.get('sonderrollen')"
        :fehlt="verwaltung.unconfirmed.get('sonderrollen')"
        testid="sonderrollen-ladeproblem"
        @bestaetigen="verwaltung.confirmAgain()"
    />
    <div v-else class="sr" data-testid="sonderrollen">
        <div class="sr__spalte">
            <p class="sr__ueberschrift sr__ueberschrift--reihe">
                <span>{{ t("admin.tab.sonderrollen") }}</span>
                <span class="sr__leise">{{
                    tPlural("admin.sonderrollen.summe", aktive.length, {
                        rollen: SONDERROLLEN_NAMEN.length,
                        n: aktive.length,
                    })
                }}</span>
            </p>
            <div class="sr__liste">
                <button
                    v-for="rolle in SONDERROLLEN_NAMEN"
                    :key="rolle"
                    type="button"
                    class="sr__rolle"
                    :class="{ 'is-gewaehlt': rolle === gewaehlt }"
                    :aria-current="rolle === gewaehlt"
                    :data-testid="`sonderrolle-${rolle}`"
                    @click="gewaehlt = rolle"
                >
                    <span class="sr__rollenname">
                        {{ rolleName(rolle) }}
                        <AvmKreis :fuellung="kreisVon(rolle)" :name="KREIS_NAMEN[kreisVon(rolle)]" />
                    </span>
                    <span class="sr__rollenzahl">{{ inhaberZahl(rolle) }}</span>
                    <span class="sr__rollenunter einzeilig">{{ unterzeile(rolle) }}</span>
                </button>
            </div>
            <AvmKreisLegende
                :namen="KREIS_NAMEN"
                :zahlen="kreisZahlen"
                :beschriftung="t('admin.sonderrollen.kreis.legende')"
            />
        </div>

        <div class="sr__spalte" data-testid="sonderrolle-detail">
            <div>
                <h3 class="sr__titel">{{ rolleName(gewaehlt) }}</h3>
                <p class="sr__kurz">{{ label("admin.sonderrollen.kurz", gewaehlt) }}</p>
            </div>
            <VerwaltungMeldung :ergebnis="ergebnis" testid="sonderrolle-meldung" />
            <AvmHinweis
                v-if="abgleich !== undefined"
                :ton="abgleich.gestoertSeit === null ? undefined : 'gefahr'"
                data-testid="sonderrollen-abgleich"
            >
                {{ abgleichSatz }}
            </AvmHinweis>
            <AvmHinweis
                v-if="abgleich !== undefined && abgleich.ohneKontoZahl > 0"
                data-testid="sonderrollen-ohne-konto"
            >
                {{ t("admin.sonderrollen.abgleich.ohneKonto", { n: abgleich.ohneKontoZahl }) }}
                <span
                    v-for="zeile in abgleich.ohneKonto"
                    :key="zeile.discordId + zeile.sonderrolle + zeile.region"
                    class="sr__zeile"
                >
                    {{ zeile.discordId }} · {{ rolleName(zeile.sonderrolle) }}
                </span>
            </AvmHinweis>
            <AvmHinweis v-else-if="abgleich === undefined && !hatVergaberecht">
                <strong>{{ t("admin.sonderrollen.nurLesendErst") }}</strong>
                {{ t("admin.sonderrollen.nurLesend") }}
            </AvmHinweis>

            <div class="sr__ueberschrift sr__ueberschrift--reihe">
                <span>{{ t("admin.sonderrollen.inhaber", { n: inhaberZahl(gewaehlt) }) }}</span>
                <AvmKnopf
                    v-if="darfVergeben"
                    groesse="zeile"
                    :gesperrt="vergabe.offen ? '' : undefined"
                    testid="sonderrolle-vergeben-oeffnen"
                    @click="vergabeOeffnen()"
                    >✚ {{ t("admin.sonderrollen.vergeben") }}</AvmKnopf
                >
            </div>

            <form v-if="vergabe.offen" class="sr__neu" data-testid="sonderrolle-vergabe" @submit.prevent="vergeben()">
                <p class="sr__neutitel">{{ t("admin.sonderrollen.vergebenTitel", { rolle: rolleName(gewaehlt) }) }}</p>
                <div class="sr__feld">
                    <span class="sr__beschriftung">{{ t("admin.sonderrollen.person") }}</span>
                    <div v-if="person !== undefined" class="sr__gewaehlte-person">
                        <AvmAvatar :kennung="person.id" :name="person.displayName" />
                        <span>{{ person.displayName }}</span>
                        <AvmPille>{{ label("auth.role", person.role) }}</AvmPille>
                        <button type="button" class="sr__verweis" @click="vergabe.personId = ''">
                            {{ t("admin.sonderrollen.anderePerson") }}
                        </button>
                    </div>
                    <template v-else>
                        <AvmEingabe
                            v-model="vergabe.suche"
                            art="suche"
                            :placeholder="t('admin.sonderrollen.personSuchen')"
                            :aria-label="t('admin.sonderrollen.personSuchen')"
                            autocomplete="off"
                            testid="sonderrolle-person-suche"
                        />
                        <div class="sr__treffer" role="listbox" :aria-label="t('admin.sonderrollen.person')">
                            <button
                                v-for="zeile in personen"
                                :key="zeile.id"
                                type="button"
                                class="sr__treffer-zeile"
                                :disabled="hatSchon(zeile.id)"
                                :data-testid="`sonderrolle-person-${zeile.id}`"
                                @click="vergabe.personId = zeile.id"
                            >
                                <AvmAvatar :kennung="zeile.id" :name="zeile.displayName" />
                                <span class="sr__treffer-name einzeilig">{{ zeile.displayName }}</span>
                                <span class="sr__leise">{{
                                    hatSchon(zeile.id)
                                        ? t("admin.sonderrollen.hatSchon")
                                        : label("auth.role", zeile.role)
                                }}</span>
                            </button>
                            <p v-if="personen.length === 0" class="sr__leise sr__treffer-leer">
                                {{ t("admin.sonderrollen.personKeine") }}
                            </p>
                        </div>
                    </template>
                </div>
                <div v-if="spec.regional" class="sr__feld">
                    <span class="sr__beschriftung">{{
                        spec.einePersonJeRegion
                            ? t("admin.sonderrollen.regionenEine")
                            : t("admin.sonderrollen.regionen")
                    }}</span>
                    <SonderrollenRegionen
                        v-model="vergabe.regionen"
                        :regionen="regionen"
                        :zusatz="regionZusatz"
                        testid="sonderrolle-regionen"
                    />
                    <AvmHinweis v-if="konflikt !== undefined" ton="gefahr" rolle="alert">
                        {{
                            t("admin.sonderrollen.konflikt", {
                                region: konflikt.region?.name ?? "",
                                name: konflikt.person.displayName,
                            })
                        }}
                    </AvmHinweis>
                </div>
                <label class="sr__feld">
                    <span class="sr__beschriftung">{{ t("admin.sonderrollen.grundPflicht") }}</span>
                    <AvmEingabe
                        v-model="vergabe.grund"
                        maxlength="300"
                        autocomplete="off"
                        :placeholder="t('admin.sonderrollen.grundPlatzhalter')"
                        testid="sonderrolle-grund"
                    />
                </label>
                <AvmHinweis>
                    <strong>{{ t("admin.sonderrollen.passkeyErst") }}</strong>
                    {{ t("admin.sonderrollen.passkey") }}
                </AvmHinweis>
                <AvmHinweis
                    v-if="person !== undefined && brauchtPasskey(gewaehlt) && person.passkeyCount === 0"
                    ton="warnung"
                >
                    {{ t("admin.sonderrollen.personOhnePasskey", { name: person.displayName }) }}
                </AvmHinweis>
                <div class="sr__knoepfe">
                    <AvmKnopf @click="vergabe.offen = false">{{ t("ui.confirm.cancel") }}</AvmKnopf>
                    <AvmKnopf
                        typ="submit"
                        art="gefuellt"
                        :gesperrt="laeuft ? '' : vergabeFehlt"
                        testid="sonderrolle-vergeben"
                        >✚ {{ t("admin.sonderrollen.vergeben") }}</AvmKnopf
                    >
                </div>
            </form>

            <ul v-if="inhaber.length > 0" class="sr__zeilen">
                <li
                    v-for="zeile in inhaber"
                    :key="zeile.id"
                    class="sr__eintrag"
                    :data-testid="`sonderrolle-zuteilung-${zeile.id}`"
                >
                    <div class="sr__zeile">
                        <span class="sr__wer">
                            <AvmAvatar :kennung="zeile.person.id" :name="zeile.person.displayName" />
                            <span class="sr__name">
                                <span class="sr__personname">{{ zeile.person.displayName }}</span>
                                <span class="sr__leise">
                                    {{
                                        t("admin.sonderrollen.vergebenVor", {
                                            rolle:
                                                zeile.personRolle === null
                                                    ? "–"
                                                    : label("auth.role", zeile.personRolle),
                                            zeit: vor(zeile.vergebenAm),
                                            von: zeile.vergebenVon?.displayName ?? "?",
                                        })
                                    }}
                                </span>
                            </span>
                        </span>
                        <span class="sr__pillen">
                            <AvmPille v-if="zeile.region !== null">{{ zeile.region.name }}</AvmPille>
                            <AvmPille v-if="ohnePasskey(zeile)" ton="warnung">{{
                                t("admin.sonderrollen.keinPasskey")
                            }}</AvmPille>
                        </span>
                        <AvmKnopf
                            v-if="darfVergeben"
                            groesse="zeile"
                            art="gefahr"
                            :testid="`sonderrolle-entziehen-${zeile.id}`"
                            @click="Object.assign(entziehen, { id: zeile.id, grund: '' })"
                            >✕ {{ t("admin.sonderrollen.entziehen") }}</AvmKnopf
                        >
                    </div>
                    <AvmBestaetigung
                        v-if="entziehen.id === zeile.id"
                        :frage="
                            t('admin.sonderrollen.entziehenFrage', {
                                name: zeile.person.displayName,
                                rolle: rolleName(gewaehlt),
                            })
                        "
                        :folge="t('admin.sonderrollen.entziehenFolge')"
                        :bestaetigen="t('admin.sonderrollen.entziehen')"
                        :gesperrt="
                            laeuft
                                ? ''
                                : entziehen.grund.trim() === ''
                                  ? t('admin.sonderrollen.fehlt.grund')
                                  : undefined
                        "
                        :fokus="false"
                        testid="sonderrolle-entziehen-frage"
                        @bestaetigen="entzugBestaetigen(zeile)"
                        @abbrechen="entziehen.id = null"
                    >
                        <AvmEingabe
                            v-model="entziehen.grund"
                            maxlength="300"
                            autocomplete="off"
                            :placeholder="t('admin.sonderrollen.grundPlatzhalter')"
                            :aria-label="t('admin.sonderrollen.grundEntzug')"
                            testid="sonderrolle-entzug-grund"
                        />
                    </AvmBestaetigung>
                </li>
            </ul>
            <p v-else-if="!verwaltung.loading.has('sonderrollen')" class="sr__leise">
                {{ t("admin.sonderrollen.niemand") }}
            </p>

            <AvmHinweis v-if="ohnePasskeyNamen.length > 0" ton="warnung">
                <strong>{{ t("admin.sonderrollen.ohnePasskeyErst") }}</strong>
                {{ t("admin.sonderrollen.ohnePasskey", { namen: ohnePasskeyNamen.join(", ") }) }}
            </AvmHinweis>

            <p class="sr__ueberschrift">{{ t("admin.sonderrollen.wirkung") }}</p>
            <ul class="sr__wirkung" data-testid="sonderrolle-wirkung">
                <li v-for="satz in wirkung" :key="satz">{{ satz }}</li>
            </ul>

            <p class="sr__ueberschrift">{{ t("admin.sonderrollen.rechte", { n: rechte.length }) }}</p>
            <FensterTafel
                v-if="rechte.length > 0"
                :beschriftung="t('admin.sonderrollen.rechte', { n: rechte.length })"
                art="text"
                grund="fenster"
            >
                <table data-testid="sonderrolle-rechte">
                    <thead>
                        <tr>
                            <th scope="col">{{ t("admin.roles.col.capability") }}</th>
                            <th scope="col">{{ t("admin.roles.col.level") }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="recht in rechte" :key="recht">
                            <th scope="row">
                                {{ label("auth.capability", recht) }}
                                <span class="fenster-tafel__zusatz">{{ label("admin.capability", recht) }}</span>
                            </th>
                            <td :title="label('admin.roles.level', CAPABILITIES[recht].assurance)">
                                {{ CAPABILITIES[recht].assurance.toUpperCase() }}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </FensterTafel>
            <p v-else class="sr__leise">{{ t("admin.sonderrollen.keineRechteSatz") }}</p>
            <p v-if="rechte.length > 0" class="sr__leise" data-testid="sonderrolle-stufen">
                {{ t("admin.roles.levels") }}
            </p>

            <p class="sr__ueberschrift">{{ t("admin.sonderrollen.protokoll") }}</p>
            <ul v-if="verlauf.length > 0" class="sr__verlauf" data-testid="sonderrolle-verlauf">
                <li v-for="eintrag in verlauf" :key="eintrag.id">
                    <span>
                        {{ eintrag.text }}
                        <template v-if="eintrag.grund">
                            · {{ t("admin.sonderrollen.grundIst", { grund: eintrag.grund }) }}</template
                        >
                    </span>
                    <span class="sr__leise">{{ vor(eintrag.am) }}</span>
                </li>
            </ul>
            <p v-else class="sr__leise">{{ t("admin.sonderrollen.keinEintrag") }}</p>
        </div>
    </div>
</template>

<style scoped>
.sr {
    display: grid;
    grid-template-columns: minmax(200px, 250px) minmax(0, 1fr);
    gap: var(--space-12);
    align-items: start;
}

@media (width <= 640px) {
    .sr {
        grid-template-columns: minmax(0, 1fr);
    }
}

.sr__spalte {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    min-width: 0;
}

.sr__lead,
.sr__titel,
.sr__kurz,
.sr__neutitel,
.sr__ueberschrift {
    margin: 0;
}

.sr__lead {
    color: var(--color-text);
    font-size: var(--font-size-body);
}

.sr__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.sr__ueberschrift {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-bold);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.sr__ueberschrift--reihe {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-6);
}

.sr__ueberschrift--reihe .sr__leise {
    font-weight: var(--font-weight-regular);
    letter-spacing: normal;
    text-transform: none;
}

.sr__liste {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--color-divider);
}

.sr__rolle {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    column-gap: var(--space-6);
    align-content: center;
    width: 100%;
    min-height: 46px;
    padding: 0 var(--space-8);
    border: 0;
    border-bottom: 1px solid var(--color-divider);
    background: none;
    color: var(--color-text-strong);
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition: background var(--transition-fast);
}

.sr__rolle:hover {
    background: var(--color-hover-wash);
}

.sr__rolle.is-gewaehlt,
.sr__rolle.is-gewaehlt:hover {
    background: var(--color-panel-active);
}

.sr__rolle:focus-visible {
    outline: none;
    box-shadow: inset var(--focus-ring);
}

.sr__rollenname {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
    font-size: var(--font-size-body);
}

.sr__rollenzahl {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
    text-align: right;
}

.sr__rollenunter {
    grid-column: 1 / -1;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.sr__zeile {
    display: block;
}

.sr__wirkung {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding-left: var(--space-12);
    color: var(--color-text);
    font-size: var(--font-size-small);
    list-style: disc;
}

.sr__wirkung li::marker {
    color: var(--color-text-muted);
}

.sr__titel {
    color: var(--color-text-strong);
    font-size: var(--font-size-title);
    font-weight: var(--font-weight-regular);
    line-height: var(--leading-tight);
}

.sr__kurz {
    margin-top: var(--space-2);
    color: var(--color-text-muted);
    font-size: var(--font-size-body);
}

/* Die Neuanlage ist eingefärbt, der Bestand nicht (Guide §13.21). */
.sr__neu {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding: var(--space-10);
    border-radius: var(--radius-md);
    background: var(--color-panel-muted);
}

.sr__neutitel {
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
}

.sr__feld {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.sr__beschriftung {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.sr__gewaehlte-person {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-6);
    color: var(--color-text-strong);
}

.sr__verweis {
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-accent-strong);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
}

.sr__verweis:hover {
    text-decoration: underline;
}

.sr__verweis:focus-visible {
    border-radius: var(--radius-sm);
    outline: none;
    box-shadow: var(--focus-ring);
}

.sr__treffer {
    display: flex;
    flex-direction: column;
    max-height: 168px;
    overflow: auto;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    scrollbar-width: thin;
}

.sr__treffer-zeile {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    width: 100%;
    padding: var(--space-2) var(--space-6);
    border: 0;
    background: none;
    color: var(--color-text-strong);
    cursor: pointer;
    font: inherit;
    text-align: left;
}

.sr__treffer-zeile:hover:not(:disabled) {
    background: var(--color-hover-wash);
}

.sr__treffer-zeile:disabled {
    color: var(--color-text-muted);
    cursor: not-allowed;
}

.sr__treffer-zeile:focus-visible {
    outline: none;
    box-shadow: inset var(--focus-ring);
}

.sr__treffer-name {
    flex: 1 1 auto;
    min-width: 0;
}

.sr__treffer-leer {
    padding: var(--space-4) var(--space-6);
}

.sr__knoepfe {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-4);
}

.sr__zeilen,
.sr__verlauf {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
}

.sr__zeilen {
    border-top: 1px solid var(--color-divider);
}

.sr__eintrag {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) 0;
    border-bottom: 1px solid var(--color-divider);
}

.sr__zeile {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-8);
}

.sr__wer {
    display: flex;
    flex: 1 1 14em;
    align-items: center;
    gap: var(--space-6);
    min-width: 0;
}

.sr__name {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
}

.sr__personname {
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
}

.sr__pillen {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
}

.sr__verlauf {
    gap: var(--space-2);
}

.sr__verlauf li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-1) var(--space-8);
    color: var(--color-text);
    font-size: var(--font-size-small);
}
</style>
