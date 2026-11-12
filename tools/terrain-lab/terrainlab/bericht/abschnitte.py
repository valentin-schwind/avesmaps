"""Die Abschnitte des Berichts (WI-0250 Phase A5). Jede Funktion gibt HTML zurück und meldet fehlende Daten im Text, statt abzubrechen.

Reihenfolge der Seite (Aufgabe A5): Zusammenfassung, Qualität je Typ (die drei Dimensionen getrennt), Formerhalt, Referenzmetriken, Performance, Regressionen zwischen zwei
Commits, Bildvergleich, Profile, Parameteranalyse, Anhang.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any, Sequence

import numpy as np

from terrainlab.bewertung import Einstellungen, ReferenzSatz, bewerte_form, lade_geometrie
from terrainlab.bewertung.formerhalt import KAMMLAGE_TOLERANZ_E, Feld, Geometrie
from terrainlab.bewertung.plausibilitaet import beschneide_rand, stufe_fuer_zellgroesse
from terrainlab.deskriptoren import Metrikvektor, berechne
from terrainlab.optimierung.raum import Raum
from terrainlab.raster import Hoehenraster, lies

from . import grafik
from .befunde import P4, abgleich
from .daten import OptimierungsDaten, TypDaten, fixture_pfad, messung_der, raster_zu
from .seite import bild, h, hinweis, prozent, reihe, sekunden, tabelle, z

M_JE_PX = 200.0


def _m(f: dict[str, Any], schluessel: str) -> Any:
    """Der Mittelwert einer Kennzahl aus einer Zusammenfassung über Saaten (``{"mittel": …}``) oder der Wert selbst."""
    x = f[schluessel]
    return x["mittel"] if isinstance(x, dict) else x


def _kurz(kandidat: dict[str, Any], raum: Raum | None = None, vorgabe: dict[str, Any] | None = None) -> str:
    if not kandidat:
        return "Vorgabe des Typs (keine Abweichung)"
    teile = []
    for n in sorted(kandidat):
        w = kandidat[n]
        v = None if raum is None else raum[n].basis if n in raum._index else None
        teile.append(f"{n}: {z(v) if isinstance(v, (int, float)) else v} → {z(w) if isinstance(w, (int, float)) else w}" if v is not None else f"{n} = {z(w) if isinstance(w, (int, float)) else w}")
    return "; ".join(teile)


class Bericht:
    """Hält die gelesenen Daten und die berechneten Zwischenergebnisse (Raster, Metrikvektoren) und baut daraus die Abschnitte."""

    def __init__(self, d: OptimierungsDaten, labor: Path | None = None) -> None:
        self.d = d
        self.labor = labor
        self.einst: Einstellungen = d.profil.plausibilitaet
        self.satz = ReferenzSatz(self.einst)
        self._raster: dict[tuple[Any, ...], Hoehenraster | None] = {}
        self._vektor: dict[tuple[Any, ...], Metrikvektor] = {}
        self.raeume: dict[str, Raum] = {}
        if d.grenzen:
            for t in d.profil.typen:
                try:
                    self.raeume[t.typ] = Raum.aus_grenzen(d.grenzen, t.typ, d.profil.ausschluss)
                except (KeyError, ValueError):
                    pass

    # --- Zugriff ---------------------------------------------------------------------------------------------------------
    def gezeigt(self, typ: str) -> tuple[dict[str, Any] | None, str]:
        """Der Kandidat, den der Bericht neben die Vorgabe stellt: der bestätigte Vorschlag, sonst der Beste der Suche (ausdrücklich nicht bestätigt)."""
        t = self.d.typen[typ]
        vor = t.daten("vorschlag")
        if vor and vor.get("status") == "bestaetigt":
            return vor["kandidat"], "Vorschlag"
        ver = t.daten("verfeinerung")
        rang = [e for e in ((ver or {}).get("rangliste") or []) if e["kandidat"]]
        if rang:
            gut = [e for e in rang if e["tor_ok"]]
            return (gut or rang)[0]["kandidat"], "Bester der Suche (nicht bestätigt)" + ("" if gut else ", verfehlt das Formtor")
        return None, ""

    def raster(self, typ: str, kandidat: dict[str, Any], aufloesung: int, saat: str = "fixture", rolle: str = "optimierung") -> Hoehenraster | None:
        schluessel = (typ, Raum.schluessel(kandidat), aufloesung, saat, rolle)
        if schluessel in self._raster:
            return self._raster[schluessel]
        r: Hoehenraster | None = None
        m = messung_der(self.d.ordner, typ, kandidat, aufloesung, saat, rolle)
        if m is None and rolle == "validierung":
            m = messung_der(self.d.ordner, typ, kandidat, aufloesung, saat, "optimierung")
        ordner = raster_zu(self.d, m) if m else None
        if ordner is not None:
            meta = json.loads((ordner / "meta.json").read_text(encoding="utf-8"))
            r = lies(ordner / meta["raster"]["dateien"][0]["datei"], pruefen=False)
        self._raster[schluessel] = r
        return r

    def geometrie(self, typ: str) -> Geometrie | None:
        pfad = fixture_pfad(self.d.ordner, self.d.commit, self.d.typen[typ].gebirge, self.labor)
        return None if pfad is None else lade_geometrie(pfad)

    def relief_ziel(self, typ: str) -> float | None:
        g = self.geometrie(typ)
        return None if g is None else g.kammhoehe

    def vektor(self, typ: str, kandidat: dict[str, Any], aufloesung: int) -> Metrikvektor | None:
        r = self.raster(typ, kandidat, aufloesung)
        if r is None:
            return None
        schluessel = (typ, Raum.schluessel(kandidat), aufloesung)
        if schluessel not in self._vektor:
            self._vektor[schluessel] = berechne(beschneide_rand(r, self.einst.rand_m), self.einst.deskriptor_parameter(), self.einst.gruppen, not self.einst.ohne_teuer)
        return self._vektor[schluessel]

    def referenz(self, typ: str, rolle: str, stufe: str) -> tuple[Any, Hoehenraster | None, Metrikvektor | None]:
        """(Manifest-Eintrag, unverändertes Referenzraster, Metrikvektor wie in der Wertung) des Referenzausschnitts; Fehlendes ist ``None``."""
        try:
            eintrag = self.satz.ausschnitte(typ, rolle)[0]
            from terrainlab.referenz import korpus

            roh = korpus.lade_raster(eintrag["id"], stufe)
            fall = self.satz.fall(eintrag, stufe, self.relief_ziel(typ))
            return eintrag, roh, fall.vektor
        except (KeyError, FileNotFoundError, IndexError, ValueError):
            return None, None, None

    # --- 1 Zusammenfassung -----------------------------------------------------------------------------------------------
    def zusammenfassung(self) -> str:
        d = self.d
        stand = d.stand or {}
        kopf = tabelle(
            ["Angabe", "Wert"],
            [
                ["Lauf", d.ordner.name],
                ["Profil", f"{d.profil.name}: {d.profil.beschreibung}"],
                ["Generator-Stand", f"{d.commit} (Fassung {d.profil.fassung}); alles an diesem Commit gerechnet"],
                ["Status", d.status],
                ["Beginn", d.begonnen or "-"],
                ["Messungen", f"{d.messungen} gelungen, {d.fehlgeschlagen} fehlgeschlagen"],
                ["Verbrauch des letzten Aufrufs", json.dumps(stand.get("verbraucht"), ensure_ascii=False) if stand.get("verbraucht") else "-"],
                ["Saaten", ", ".join("Fixture" if s is None else str(s) for s in d.profil.saaten)],
                ["Vorschau", f"Kante {d.profil.vorschau['kante']}, Talboden: {d.profil.vorschau['talboden']}"],
            ],
        )
        zeilen = []
        punkte = []
        for typ, t in d.typen.items():
            vor = t.daten("vorschlag")
            basis = t.daten("basis")
            ver = t.daten("verfeinerung")
            kand, label = self.gezeigt(typ)
            f_vor = (basis or {}).get("vorgabe")
            f_neu = None
            if ver and kand is not None:
                f_neu = next((e["fasse"] for e in ver["rangliste"] if e["kandidat"] == kand), None)
            val = t.daten("validierung") or {}
            st = t.daten("strategie") or {}
            status = (vor or {}).get("status", "-")
            zeilen.append([
                typ, t.gebirge, {"bestaetigt": "Vorschlag bestätigt", "vorgabe_bleibt": "Vorgabe bleibt"}.get(status, status),
                f"{z(f_vor['d1']['mittel']) if f_vor else '-'} → {z(f_neu['d1']['mittel']) if f_neu else '-'}",
                f"{z(1 - f_vor['form']['mittel']) if f_vor else '-'} → {z(1 - f_neu['form']['mittel']) if f_neu else '-'}",
                (st.get("urteil") or "-"),
            ])
            if vor:
                punkte.append(f"<li><b>{h(typ)}:</b> {h(vor.get('begruendung', ''))}</li>")
        tab = tabelle(["Typ", "Gebirge", "Ergebnis", "Abstand zur Referenz 1× (Vorgabe → gezeigter Kandidat)", "Formverlust 1×", "Strategie"], zeilen, rechts=(3, 4),
                      titel="Ergebnis je Typ (Abstand und Formverlust: 0 = gleich; beide getrennt, nie zu einem Wert gemischt)")
        warn = hinweis("<b>Gilt nur für diesen Generator-Stand.</b> WI-0249 (Formerhaltung) ändert Einbettung, Erosion und Formerhalt; Kalibrierungen, die davon abhängen, sind danach neu zu messen "
                       "(Abschnitt „Parameteranalyse“, Punkt „Nach WI-0249“). Der Vorschlag ist keine Fassung und schreibt nichts in <code>config/terrain</code>.", warn=True)
        return kopf + tab + (f"<h3>Begründungen</h3><ul>{''.join(punkte)}</ul>" if punkte else "") + warn

    # --- 2 Qualität je Typ -----------------------------------------------------------------------------------------------
    def qualitaet(self) -> str:
        aus = [hinweis("<b>Drei Dimensionen, nie ein Gesamtwert.</b> (1) Geomorphologische Plausibilität: Abstand der Deskriptoren zu realen Referenzausschnitten desselben Typs im selben Maßstab, "
                       "getrennt nach absolut / relativ / verteilungsbasiert / räumlich. (2) Redaktioneller Formerhalt: gezeichnete Gipfel, Nebengipfel, Kämme und Täler gegen das Ergebnis. "
                       "(3) Technische Effizienz. Je Abstand: 0 = gleich, 1 = maximal verschieden (Definition in <code>docs/optimierung.md</code>).")]
        for typ, t in self.d.typen.items():
            aus.append(f"<h3>{h(typ)} (Gebirge {h(t.gebirge)})</h3>")
            aus.append(self._dimension1(typ, t))
            aus.append(self._dimension2(typ, t))
            aus.append(self._dimension3(typ, t))
        return "".join(aus)

    def _fassen(self, typ: str) -> dict[str, Any]:
        """Kennzahlen (Zusammenfassungen über Saaten) der Vorgabe und des gezeigten Kandidaten an allen gemessenen Auflösungen und Rollen."""
        t = self.d.typen[typ]
        kand, label = self.gezeigt(typ)
        ver = t.daten("verfeinerung")
        val = t.daten("validierung") or {}
        basis = (t.daten("basis") or {}).get("vorgabe")
        aus: dict[str, Any] = {"label": label, "kandidat": kand, "zeilen": []}
        if basis:
            aus["zeilen"].append(("1×", "Optimierung", basis, next((e["fasse"] for e in (ver or {}).get("rangliste", []) if e["kandidat"] == kand), None) if kand is not None else None))
        eintrag = next((k for k in val.get("kandidaten", []) if kand is not None and k["kandidat"] == kand), None)
        for a in sorted(val.get("vorgabe", {})):
            vg = val["vorgabe"][a]
            e = None if eintrag is None else eintrag["aufloesungen"].get(a)
            aus["zeilen"].append((f"{a}×", "Optimierung", vg["optimierung"], None if e is None else e["optimierung"]["fasse"]))
            aus["zeilen"].append((f"{a}×", "Validierung", vg["validierung"], None if e is None else e["validierung"]["fasse"]))
        return aus

    def _dimension1(self, typ: str, t: TypDaten) -> str:
        f = self._fassen(typ)
        zeilen = []
        for a, rolle, v, n in f["zeilen"]:
            def arten(x: dict[str, Any] | None) -> list[str]:
                return [z(((x or {}).get("d1_arten") or {}).get(k, {}).get("mittel") if isinstance((x or {}).get("d1_arten", {}).get(k), dict) else (x or {}).get("d1_arten", {}).get(k)) for k in ("absolut", "relativ", "verteilung", "raeumlich")]
            zeilen.append([a, rolle, z(v["d1"]["mittel"]), z(n["d1"]["mittel"]) if n else "-", *arten(v), *arten(n)])
        basis = t.daten("basis") or {}
        rr = basis.get("referenzstreuung")
        tab = tabelle(["Maßstab", "Referenz (Rolle)", "Leitwert Vorgabe", f"Leitwert {f['label'] or 'Kandidat'}", "abs. Vorgabe", "rel. Vorgabe", "Vert. Vorgabe", "räuml. Vorgabe",
                       "abs. Kandidat", "rel. Kandidat", "Vert. Kandidat", "räuml. Kandidat"], zeilen, rechts=tuple(range(2, 12)),
                      titel="1 Plausibilität: Abstand zur Referenz (Mittel über die Saaten)")
        text = ""
        if rr and rr.get("leitwert") is not None:
            text = (f"<p class='klein'>Zum Maßstab: Zwei <i>echte</i> Gebirge dieses Typs (Optimierungs- gegen Validierungsausschnitt) haben bei 1× einen Abstand von {z(rr['leitwert'])} "
                    f"(absolut {z(rr['arten']['absolut'])}, relativ {z(rr['arten']['relativ'])}, verteilungsbasiert {z(rr['arten']['verteilung'])}, räumlich {z(rr['arten']['raeumlich'])}). "
                    "Ein erzeugtes Gebirge kann dem Ausschnitt, gegen den es optimiert wurde, nicht näher kommen müssen als echte Gebirge einander; der Leitwert („Median der Arten relativ, "
                    "verteilungsbasiert, räumlich“) ordnet, die Arten stehen getrennt daneben.</p>")
        return tab + text

    def _dimension2(self, typ: str, t: TypDaten) -> str:
        basis = (t.daten("basis") or {}).get("vorgabe")
        f = self._fassen(typ)
        gezeigt = next((n for a, r, v, n in f["zeilen"] if a == "1×"), None)
        if not basis:
            return ""
        namen = {"gipfel_exakt": "Gipfel stehen exakt", "gipfel_kopf": "Gipfel tragen einen Kopf", "neben_exakt": "Nebengipfel stehen auf ihrer Höhe", "neben_kopf": "Nebengipfel tragen einen Kopf",
                 "grat": "Kammrelief quer (Anteil des Mindestgrats)", "kammlage": "Lage der Kammachse (Abweichung über eine Zelle)", "fluss_faellt": "Flüsse fließen talwärts",
                 "tal_tief": "Flüsse liegen tiefer als ihre Umgebung", "mulde_tief": "gesetzte Mulden liegen tiefer"}
        zeilen = []
        vg_k, nk = basis["komponenten"], (gezeigt or {}).get("komponenten", {})
        for k, text in namen.items():
            if vg_k.get(k) is None and nk.get(k) is None:
                continue
            gut = None if nk.get(k) is None or vg_k.get(k) is None else nk[k] >= 0.8 * vg_k[k] - 1e-9
            zeilen.append([text, z(vg_k.get(k), 2), z(nk.get(k), 2) if gezeigt else "-", "ja" if gut else ("NEIN" if gut is False else "-")])
        eintrag = f"Formverlust (1 − Leitwert): Vorgabe {z(1 - basis['form']['mittel'])}" + (f", {f['label']} {z(1 - gezeigt['form']['mittel'])}" if gezeigt else "")
        tor_text = ""
        val = t.daten("validierung") or {}
        e = next((k for k in val.get("kandidaten", []) if f["kandidat"] is not None and k["kandidat"] == f["kandidat"]), None)
        if e:
            tor_text = "<p class='klein'>Formtor bei größerer Auflösung: " + "; ".join(
                f"{a}× {'gehalten' if x['tor_ok'] else 'VERFEHLT (' + '; '.join(x['verstoesse']) + ')'}" for a, x in sorted(e["aufloesungen"].items())) + ".</p>"
        return (tabelle(["Komponente (Anteil, 1 = erfüllt)", "Vorgabe", f["label"] or "Kandidat", "Formtor (≥ 80 % der Vorgabe)"], zeilen, rechts=(1, 2),
                        titel="2 Formerhalt gegen die gezeichnete Form (1×, Mittel über die Saaten)") + f"<p class='klein'>{h(eintrag)}. Hart ist das Formtor: Gipfel exakt, und keine Komponente unter {prozent(self.d.profil.tor_faktor, 0)} der Vorgabe.</p>" + tor_text)

    def _dimension3(self, typ: str, t: TypDaten) -> str:
        f = self._fassen(typ)
        zeilen = []
        for a, rolle, v, n in f["zeilen"]:
            if rolle != "Optimierung":
                continue
            zeilen.append([a, z(v["zellen"]), sekunden(_m(v, "wall_ms")), sekunden(_m(n, "wall_ms")) if n else "-", z(_m(v, "rss_mib"), 0), z(_m(n, "rss_mib"), 0) if n else "-"])
        if not zeilen:
            return ""
        return tabelle(["Maßstab", "Zellen", "kalte Zeit Vorgabe", f"kalte Zeit {f['label'] or 'Kandidat'}", "RSS-Spitze Vorgabe (MiB)", "RSS-Spitze Kandidat (MiB)"], zeilen, rechts=(1, 2, 3, 4, 5),
                       titel="3 Effizienz (kalter Lauf, Fremdlast anderer Sitzungen nicht herausgerechnet)")

    # --- 3 Formerhalt im Einzelnen ---------------------------------------------------------------------------------------
    def formerhalt(self) -> str:
        aus = []
        for typ, t in self.d.typen.items():
            kand, label = self.gezeigt(typ)
            g = self.geometrie(typ)
            r0 = self.raster(typ, {}, 1)
            if g is None or r0 is None:
                aus.append(f"<h3>{h(typ)}</h3><p class='klein'>Raster oder Gebirgsdatei nicht mehr vorhanden (Zwischenspeicher aufgeräumt).</p>")
                continue
            grat_min = ((self.d.grenzen or {}).get("basis", {}).get(typ, {}).get("rueckennetz", {}) or {}).get("gratMin")
            e0 = bewerte_form(r0, g, grat_min)
            r1 = self.raster(typ, kand, 1) if kand is not None else None
            e1 = bewerte_form(r1, g, grat_min) if r1 is not None else None
            aus.append(f"<h3>{h(typ)} (Gebirge {h(t.gebirge)}, Fixture-Saat, 1×)</h3>")
            aus.append(f"<p class='klein'>{g.zaehlung()['gipfel']} Gipfel, {g.zaehlung()['nebengipfel']} Nebengipfel, {g.zaehlung()['kaemme']} Kämme, {g.zaehlung()['fluesse']} Flüsse in der Gebirgsdatei; "
                       f"in der Fläche gemessen: {len(e0['gipfel'])} Gipfel, {len(e0['nebengipfel'])} Nebengipfel. Kammhöhe {z(g.kammhoehe, 0)} m.</p>")
            zeilen = []
            for i, n in enumerate(e0["nebengipfel"]):
                m = e1["nebengipfel"][i] if e1 and i < len(e1["nebengipfel"]) else None
                zeilen.append([i + 1, f"{n['x']:.1f} / {n['y']:.1f}", z(n["ziel_m"], 0) if n["ziel_m"] else "Vorgabe", z(n["hoehe_m"], 0), "ja" if n["kopf"] else "nein", z(n["kopf_prominenz_m"], 0),
                               z(m["hoehe_m"], 0) if m else "-", ("ja" if m["kopf"] else "nein") if m else "-", z(m["kopf_prominenz_m"], 0) if m else "-"])
            if zeilen:
                aus.append(tabelle(["Nr", "Lage (E)", "Soll (m)", "Vorgabe: Höhe", "Kopf", "Prominenz (m)", f"{label or 'Kandidat'}: Höhe", "Kopf", "Prominenz (m)"], zeilen, rechts=(0, 2, 3, 5, 6, 8),
                                   titel="Nebengipfel: Höhe an der gesetzten Lage, Kopf (strikte Gipfelzelle im Umkreis von 0,5 E) und Prominenz"))
            k0, k1 = e0["kamm"], (e1["kamm"] if e1 else None)
            aus.append(tabelle(["Maß", "Vorgabe", label or "Kandidat"], [
                ["Kammrelief quer, Median (m)", z(k0["grat_median_m"], 0), z(k1["grat_median_m"], 0) if k1 else "-"],
                ["… als Anteil der Höchsthöhe", z(k0["grat_anteil"], 3), z(k1["grat_anteil"], 3) if k1 else "-"],
                ["Mindestgrat des Typs (Soll)", z(grat_min, 2), z(grat_min, 2)],
                ["Lage der Kammachse, Median (E)", z(k0["kammlage_median_e"], 3), z(k1["kammlage_median_e"], 3) if k1 else "-"],
                ["gültige Proben (ohne Rand und Enden)", z(k0["proben"]), z(k1["proben"]) if k1 else "-"],
                ["Köpfe der Nebengipfel (Anteil)", z(e0["komponenten"]["neben_kopf"], 2), z(e1["komponenten"]["neben_kopf"], 2) if e1 else "-"],
                ["Flüsse fließen talwärts (Anteil)", z(e0["komponenten"]["fluss_faellt"], 2), z(e1["komponenten"]["fluss_faellt"], 2) if e1 else "-"],
            ], rechts=(1, 2), titel="Kamm, Täler"))
        return "".join(aus) if aus else "<p>Keine Typen.</p>"

    # --- 4 Referenzmetriken ----------------------------------------------------------------------------------------------
    def referenzmetriken(self) -> str:
        aus = []
        for typ, t in self.d.typen.items():
            kand, label = self.gezeigt(typ)
            aus.append(f"<h3>{h(typ)}</h3>")
            ver = t.daten("verfeinerung") or {}
            basis = (t.daten("basis") or {}).get("vorgabe") or {}
            # Welche Referenzen und wie stark gestreckt?
            vg_r = self.vektor(typ, {}, 1)
            if vg_r is None:
                aus.append("<p class='klein'>Raster nicht mehr im Zwischenspeicher.</p>")
                continue
            _, _, rv = self.referenz(typ, "optimierung", "750m")
            if rv is None:
                aus.append("<p class='klein'>Referenzraster nicht verfügbar (Referenzkorpus lokal prüfen: <code>python -m terrainlab referenz pruefen</code>).</p>")
                continue
            vk = self.vektor(typ, kand, 1) if kand is not None else None
            vektoren: list[tuple[str, str, Metrikvektor]] = [("Referenz (Optimierung)", "referenz", rv), ("Vorgabe", "vorgabe", vg_r)]
            if vk is not None:
                vektoren.append((label or "Kandidat", "vorschlag", vk))
            _, _, rvv = self.referenz(typ, "validierung", "750m")
            aus.append(self._kennzahlen_tabelle(typ, [("Referenz (Optimierung)", rv), ("Referenz (Validierung)", rvv), ("Vorgabe", vg_r), (label or "Kandidat", vk)]))
            kopf_namen = ["hang_neigung", "hoehe_rel", "gipfel_prominenz", "hang_kruemmung_profil", "hydro_einzugsflaeche_log10", "hang_tri", "gipfel_abstand_nn", "tal_hand", "hang_reliefenergie_r1000m"]
            try:
                aus.append(bild(grafik.verteilungen_diagramm(vektoren, kopf_namen), f"Verteilungen {typ}", "Quantilfunktionen ausgewählter Deskriptor-Verteilungen (1×, Randband abgezogen, Referenz auf das Relief des Gebirges gestreckt)."))
            except ValueError as fehler:
                aus.append(f"<p class='klein'>Verteilungen nicht darstellbar: {h(fehler)}</p>")
            # Die schlechtesten Einzelkennzahlen des gezeigten Kandidaten.
            schlecht = []
            if kand is not None:
                e = next((x for x in (ver.get("rangliste") or []) if x["kandidat"] == kand), None)
            m = messung_der(self.d.ordner, typ, kand or {}, 1, "fixture") if kand is not None else None
            if m and m["werte"].get("d1", {}).get("faelle"):
                for f in m["werte"]["d1"]["faelle"]:
                    for p in f.get("schlechteste", []):
                        schlecht.append([f["referenz"], p["name"], p["art"], z(p["referenz"], 4), z(p["erzeugt"], 4), z(p["abstand"], 2)])
            if schlecht:
                aus.append(tabelle(["Referenz", "Kennzahl", "Art", "Referenzwert", "erzeugt", "Abstand"], schlecht, rechts=(3, 4, 5),
                                   titel=f"Ausreißer: die am weitesten entfernten Kennzahlen des Kandidaten „{label}“ (Fixture-Saat, 1×)"))
            # Referenzfälle
            fz = []
            for f in (m["werte"]["d1"]["faelle"] if m and m["werte"].get("d1", {}).get("faelle") else []):
                fz.append([f["referenz"], f["rolle"], z(f["relief_faktor"], 3), z(f["leitwert"]), *[z(f["arten"][a]["median"]) for a in ("absolut", "relativ", "verteilung", "raeumlich")],
                           ", ".join(f"{g} {z(w, 2)}" for g, w in f["gruppen_w1"].items())])
            if fz:
                aus.append(tabelle(["Referenzfall", "Rolle", "Streckung der Referenz", "Leitwert", "absolut", "relativ", "verteilungsbasiert", "räumlich", "Wasserstein je Gruppe (normiert)"], fz, rechts=(2, 3, 4, 5, 6, 7),
                                   titel="Je Referenzfall, Median über die Zahl der Kennzahlen je Art (Wert des Kandidaten)"))
        return "".join(aus)

    def _kennzahlen_tabelle(self, typ: str, vektoren: Sequence[tuple[str, Metrikvektor | None]]) -> str:
        """Ausgewählte Kennzahlen nebeneinander: die zwei Referenzen des Typs, die Vorgabe und der Kandidat (1×, Randband abgezogen, Referenz gestreckt)."""
        vektoren = [(t, v) for t, v in vektoren if v is not None]
        if len(vektoren) < 2:
            return ""
        familien = [
            ("hoehe_hypsometrisches_integral", "Hypsometrisches Integral"), ("hoehe_anteil_hoch", "Anteil im obersten Viertel der Höhenspanne"), ("hang_neigung_mittel", "mittlere Hangneigung (°)"),
            ("hang_neigung_p90", "90. Perzentil der Hangneigung (°)"), ("hang_anteil_gt30", "Anteil steiler als 30°"), ("hang_skalenexponent", "Skalenexponent der Neigung"),
            ("hang_kruemmung_profil_anteil_konvex", "Anteil konvexer Profilkrümmung"), ("hang_reliefenergie_mittel_r{N}m", "mittlere Reliefenergie (m, Fenster ±250 m)"),
            ("gipfel_dichte_p{N}m", "Gipfeldichte (1/km², Prominenz ≥ 50 m)"), ("gipfel_prominenz_median", "Median der Prominenz bedeutsamer Gipfel (m)"), ("gipfel_nni", "Nächster-Nachbar-Index der Gipfel"),
            ("kamm_dichte_a{A}km2", "Kammnetzdichte (km/km²)"), ("gerinne_dichte_a{A}km2", "Gerinnedichte (km/km²)"), ("gerinne_strahler_max_a{A}km2", "höchste Strahler-Ordnung der Gerinne"),
            ("hydro_senken_anteil", "Anteil der Zellen in geschlossenen Senken"), ("tal_breite_h{N}m", "Talbreite (m)"),
        ]
        zeilen = []
        for fam, text in familien:
            werte = []
            for _, v in vektoren:
                m = next((x for x in v.metriken if x.familie == fam or x.name == fam), None)
                werte.append(None if m is None else m.wert)
            if all(w is None for w in werte):
                continue
            zeilen.append([text, *[z(w, 3) for w in werte]])
        return tabelle(["Kennzahl", *[t for t, _ in vektoren]], zeilen, rechts=tuple(range(1, len(vektoren) + 1)), titel=f"{typ}: ausgewählte Kennzahlen (Referenz auf das Relief des Gebirges gestreckt)")

    # --- 5 Performance ---------------------------------------------------------------------------------------------------
    def performance(self, perf: Sequence[dict[str, Any]] = ()) -> str:
        aus = []
        zeilen = []
        diagramm = []
        for typ, t in self.d.typen.items():
            f = self._fassen(typ)
            for a, rolle, v, n in f["zeilen"]:
                if rolle != "Optimierung":
                    continue
                zeilen.append([typ, t.gebirge, a, z(v["zellen"]), sekunden(_m(v, "wall_ms")), sekunden(_m(n, "wall_ms")) if n else "-", z(_m(v, "rss_mib"), 0), z(_m(n, "rss_mib"), 0) if n else "-",
                               z(v["d1"]["mittel"]), z(n["d1"]["mittel"]) if n else "-"])
                diagramm.append({"gebirge": t.gebirge, "aufloesung": int(a.rstrip("×")), "vorgabe_ms": _m(v, "wall_ms"), "vorschlag_ms": _m(n, "wall_ms") if n else None})
        if zeilen:
            aus.append(tabelle(["Typ", "Gebirge", "Auflösung", "Zellen", "Zeit Vorgabe", "Zeit Kandidat", "RSS Vorgabe (MiB)", "RSS Kandidat (MiB)", "Abstand Vorgabe", "Abstand Kandidat"], zeilen, rechts=tuple(range(3, 10)),
                               titel="Vorschau 1×, 2×, 4×: Rechenzeit und Speicher der Läufe der Optimierung (kalt, Mittel über die Saaten)"))
            aus.append(bild(grafik.performance_diagramm(diagramm), "Rechenzeit", "Kalte Rechenzeit je Auflösung (logarithmisch)."))
            # Qualitätsgewinn je Rechenzeit: was bringt die feinere Auflösung, was bringt der Vorschlag.
            gewinn = []
            for typ in self.d.typen:
                f = self._fassen(typ)
                opt = [(a, v, n) for a, r, v, n in f["zeilen"] if r == "Optimierung"]
                for (a0, v0, n0), (a1, v1, n1) in zip(opt[:-1], opt[1:]):
                    dt = (_m(v1, "wall_ms") - _m(v0, "wall_ms")) / 1000.0
                    dd = v0["d1"]["mittel"] - v1["d1"]["mittel"]
                    gewinn.append([typ, f"{a0} → {a1}", z(dd, 4), z(dt, 1), z(dd / dt, 5) if dt > 0 else "-"])
                if opt and opt[0][2] is not None:
                    gewinn.append([typ, "Vorgabe → Kandidat bei 1×", z(opt[0][1]["d1"]["mittel"] - opt[0][2]["d1"]["mittel"], 4), z((_m(opt[0][2], "wall_ms") - _m(opt[0][1], "wall_ms")) / 1000.0, 2), "-"])
            aus.append(tabelle(["Typ", "Schritt", "Gewinn an Abstand (Vorgabe, Vorher − Nachher)", "Mehr Rechenzeit (s)", "Gewinn je Sekunde"], gewinn, rechts=(2, 3, 4),
                               titel="Qualitätsgewinn je Rechenzeit (Abstand zur Optimierungsreferenz; positiv = näher an der Referenz)"))
        else:
            aus.append("<p class='klein'>Keine Messungen der Optimierung.</p>")
        # Aufwand der Optimierung selbst
        aufwand = []
        for typ, t in self.d.typen.items():
            n = sum(1 for k in t.kandidaten)
            aufwand.append([typ, z(n), z(sum(k["n_saaten"] for k in t.kandidaten)), ])
        aus.append(tabelle(["Typ", "Kandidaten bei 1×", "Messungen bei 1× (Kandidat × Saat)"], aufwand, rechts=(1, 2), titel="Aufwand der Suche"))
        for p in perf:
            aus.append(self._perf_tabelle(p))
        return "".join(aus)

    def _perf_tabelle(self, p: dict[str, Any]) -> str:
        return perf_html(p)

    # --- 6 Regressionen --------------------------------------------------------------------------------------------------
    def regressionen(self, vergleiche: Sequence[dict[str, Any]]) -> str:
        if not vergleiche:
            return "<p class='klein'>Kein Commit-Vergleich angegeben (<code>python -m terrainlab lauf vergleiche &lt;A&gt; &lt;B&gt; qualitaet</code>, dann <code>bericht … --vergleich &lt;ordner&gt;</code>).</p>"
        return "".join(vergleich_html(v) for v in vergleiche)

    # --- 7 Bildvergleich -------------------------------------------------------------------------------------------------
    def bilder(self) -> str:
        aus = [hinweis(f"Alle Bilder sind <b>Schummerung aus den echten Höhen</b> (Hillshade, Licht Nordwest 45°, Überhöhung 2×) im <b>selben Maßstab</b> ({M_JE_PX:g} m je Bildpunkt, roter Balken = 10 km), "
                       "ohne Streckung der Höhen. Nichts ist gemalt oder erzeugt.")]
        for typ, t in self.d.typen.items():
            kand, label = self.gezeigt(typ)
            aus.append(f"<h3>{h(typ)}</h3>")
            for a, stufe in ((1, "750m"), (2, "375m"), (4, "187_5m")):
                figs = []
                eintrag, rraster, _ = self.referenz(typ, "optimierung", stufe)
                if rraster is not None and eintrag:
                    figs.append(self._fig(rraster, f"Referenz: {eintrag['id']} ({stufe.replace('_', ',')})"))
                _, vraster, _ = self.referenz(typ, "validierung", stufe)
                r0 = self.raster(typ, {}, a)
                if r0 is not None:
                    figs.append(self._fig(r0, f"Vorgabe, Vorschau {a}×"))
                r1 = self.raster(typ, kand, a) if kand is not None else None
                if r1 is not None and kand:
                    figs.append(self._fig(r1, f"{label}, Vorschau {a}×"))
                if vraster is not None and a == 1:
                    figs.append(self._fig(vraster, f"Validierungsreferenz: {self.satz.ausschnitte(typ, 'validierung')[0]['id']}"))
                if len(figs) > 1:
                    aus.append(f"<h4>Vorschau {a}× ({stufe.replace('_', ',')} m je Zelle)</h4>{reihe(*figs)}")
            aus.append(self._endgelaende_hinweis(typ))
        return "".join(aus)

    def _fig(self, r: Hoehenraster, text: str) -> str:
        png, (w, hh) = grafik.schummerung(r, M_JE_PX)
        return f"<figure><img src='{grafik.data_uri(png)}' width='{w}' height='{hh}' alt='{h(text)}'><figcaption>{h(text)}<br>{r.hoehen.shape[1]}×{r.hoehen.shape[0]} Zellen à {r.zellgroesse_m:g} m, {z(float(np.nanmin(r.hoehen)), 0)} bis {z(float(np.nanmax(r.hoehen)), 0)} m</figcaption></figure>"

    def _endgelaende_hinweis(self, typ: str) -> str:
        e = self.d.typen[typ].daten("endgelaende") or {}
        if not e.get("aktiv"):
            return "<p class='klein'>Endgelände: nicht gerechnet (<code>endgelaende.aktiv</code> im Profil und ein Schnappschuss der Eingaben nötig; rechnet die ganze grobe Stufe, mehrere GB).</p>"
        zeilen = [[k["name"], k["rolle"], z(k["d1"]), z(k["form"]), sekunden(_m(k, "wall_ms"))] for k in e.get("kandidaten", [])]
        return tabelle(["Kandidat", "Referenz", "Abstand", "Formerhalt", "Zeit"], zeilen, rechts=(2, 3, 4), titel="Endgelände (lokal, Schnappschuss)")

    # --- 8 Profile -------------------------------------------------------------------------------------------------------
    def profile(self) -> str:
        aus = []
        for typ, t in self.d.typen.items():
            kand, label = self.gezeigt(typ)
            g = self.geometrie(typ)
            r0 = self.raster(typ, {}, 1)
            r1 = self.raster(typ, kand, 1) if kand is not None else None
            aus.append(f"<h3>{h(typ)}</h3>")
            if g is None or r0 is None or not g.kaemme:
                aus.append("<p class='klein'>Keine Rasterdaten oder keine gezeichneten Kämme für Profile.</p>")
                continue
            figs = []
            lang = max(range(len(g.kaemme)), key=lambda i: _laenge(g.kaemme[i]) if (i < len(g.raenge) and g.raenge[i] == "haupt") or not g.raenge else 0)
            kante = g.kaemme[lang]
            fels = [(r0, "Vorgabe", "vorgabe")] + ([(r1, label, "vorschlag")] if r1 is not None else [])
            profile = []
            gesamt = _laenge(kante)
            s = np.arange(0.0, gesamt, 0.1)
            x, y = _entlang(kante, s)
            for r, text, farbe in fels:
                f = Feld(r)
                profile.append((text, farbe, s, f.lies(x, y)))
            marken = []
            for p in g.nebengipfel:
                dist = _abstand_zu_linie(p.x, p.y, kante)
                if dist <= 0.25 and p.h:
                    marken.append((float(s[int(np.argmin(np.hypot(x - p.x, y - p.y)))]), p.h, f"{p.h:g}"))
            figs.append(bild(grafik.linienprofile(profile, f"Kammprofil entlang der längsten Hauptkante ({gesamt:.1f} E)", "Weg entlang der Kante (E)", marken), f"Kammprofil {typ}",
                             "Höhe des Ergebnisses unter der gezeichneten Kante; rote Marken: gesetzte Höhen der Nebengipfel an der Kante."))
            # Querschnitt in der Mitte der Kante
            mitte = gesamt / 2
            mx, my = _entlang(kante, np.array([mitte]))
            nx, ny = _normale(kante, mitte)
            q = np.linspace(-3.0, 3.0, 121)
            qprof = []
            for r, text, farbe in fels:
                qprof.append((text, farbe, q, Feld(r).bilinear(mx[0] + q * nx, my[0] + q * ny)))
            figs.append(bild(grafik.linienprofile(qprof, "Querschnitt quer zur Kante, in der Mitte", "Abstand von der Kante (E)"), f"Querschnitt {typ}", "Ein Schnitt ist keine Statistik: Die mittleren Querprofile aller Kämme und Täler stehen darunter."))
            aus.append(reihe(*figs))
            # Mittlere Querprofile aus den Deskriptoren
            vek = [("Referenz (Optimierung)", "referenz", self.referenz(typ, "optimierung", "750m")[2]), ("Vorgabe", "vorgabe", self.vektor(typ, {}, 1))]
            if r1 is not None:
                vek.append((label, "vorschlag", self.vektor(typ, kand, 1)))
            vek2 = [(a, b, c) for a, b, c in vek if c is not None]
            try:
                if len(vek2) > 1 and vek2[0][1] == "referenz":
                    aus.append(bild(grafik.reihen_diagramm(vek2, ["kamm_querprofil", "tal_querprofil"]), f"Querprofile {typ}", "Mittlerer Höhenabfall von der Kammachse und mittlerer Anstieg vom Gerinne über dem Abstand (Reihen der Deskriptoren)."))
            except ValueError as fehler:
                aus.append(f"<p class='klein'>Querprofile nicht darstellbar: {h(fehler)}</p>")
            # Prominenzen
            try:
                if len(vek2) > 1 and vek2[0][1] == "referenz":
                    aus.append(bild(grafik.verteilungen_diagramm(vek2, ["gipfel_prominenz", "gipfel_isolation", "gipfel_abstand_nn"], 3), f"Gipfel {typ}", "Verteilung von Prominenz, Isolation und Abstand zum nächsten bedeutsamen Gipfel (Gruppe C)."))
            except ValueError as fehler:
                aus.append(f"<p class='klein'>Prominenzen nicht darstellbar: {h(fehler)}</p>")
        return "".join(aus)

    # --- 9 Parameteranalyse ----------------------------------------------------------------------------------------------
    def parameteranalyse(self) -> str:
        aus = []
        for typ, t in self.d.typen.items():
            raum = self.raeume.get(typ)
            sens = t.daten("sensitivitaet")
            aus.append(f"<h3>{h(typ)}</h3>")
            if sens:
                aus.append(f"<h4>Sensitivität (Morris, {sens['trajektorien']} Trajektorien, {sens['ebenen']} Ebenen, Saaten {', '.join(sens['saaten'])})</h4>")
                aus.append(bild(grafik.sensitivitaet_diagramm(sens["parameter"]), f"Sensitivität {typ}", "μ* je Parameter für den Abstand zur Referenz und den Formverlust; orange: im Suchraum, grau: ausgeschieden."))
                zeilen = []
                for n, p in sorted(sens["parameter"].items(), key=lambda kv: -kv[1]["wirkung"]):
                    pa = raum[n] if raum is not None and n in raum._index else None
                    erwartung, urteil = abgleich(n, p["klasse"])
                    zeilen.append([n, "" if pa is None else (pa.basis if pa.art == "wahl" else z(pa.basis, 3)), "" if pa is None or pa.art == "wahl" else f"{z(pa.min, 3)} … {z(pa.max, 3)}",
                                   z(p["d1"]["mu_stern"], 4), z(p["form"]["mu_stern"], 4), z(p["d1"]["sigma"], 4), p["klasse"] + (" (nur bedingt)" if p.get("bedingt") else ""), "ja" if p["im_suchraum"] else "nein", erwartung, urteil, P4.get(n, ("", ""))[1]])
                aus.append(tabelle(["Parameter", "Vorgabe", "Bereich", "μ* Abstand", "μ* Form", "σ Abstand", "Klasse", "im Suchraum", "P4 erwartet", "Abgleich", "P4-Befund (WI-0249)"], zeilen, rechts=(1, 3, 4, 5),
                                   titel="Wirkung je Parameter, mit dem Befund der Reglerstudie WI-0249 P4 daneben"))
                null = [n for n, p in sens["parameter"].items() if p["klasse"] == "wirkungslos"]
                bedingt = [n for n, p in sens["parameter"].items() if p.get("bedingt")]
                aus.append(f"<p>Wirkungslos (alle elementaren Effekte exakt 0 und an der Vorgabe auch an beiden Enden des Bereichs): {h(', '.join(null)) or 'keiner'}. "
                           f"Nur bedingt wirksam (Morris exakt 0, an der Vorgabe nicht): {h(', '.join(bedingt)) or 'keiner'}. Suchraum: {len(sens['aktiv'])} von {len(sens['parameter'])} Parametern.</p>")
            # Beste
            ver = t.daten("verfeinerung")
            if ver:
                zeilen = []
                for i, e in enumerate(ver["rangliste"][:8]):
                    zeilen.append([i + 1, z(e["d1"]), z(e["form_verlust"]), z(e["zeit_s"], 2), "ja" if e["tor_ok"] else "NEIN", e["fasse"]["saaten"], e["herkunft"], _kurz(e["kandidat"], raum) if raum else json.dumps(e["kandidat"])])
                aus.append(tabelle(["Rang", "Abstand", "Formverlust", "Zeit (s)", "Formtor", "Saaten", "Herkunft", "Abweichungen von der Vorgabe"], zeilen, rechts=(0, 1, 2, 3, 5),
                                   titel="Die besten Kandidaten der Suche (Pareto-Rang, dann Abstand; mit Formtor zuerst)"))
                aus.append(self._wertebereiche(typ, t, raum))
            # Pareto
            if t.kandidaten:
                vorgabe = next((k for k in t.kandidaten if k["ist_vorgabe"]), None)
                kand, label = self.gezeigt(typ)
                gez = None
                if kand is not None:
                    gez = next((k for k in t.kandidaten if k["kandidat"] == kand), None)
                aus.append(bild(grafik.pareto_diagramm(t.kandidaten, vorgabe, gez, f"{typ}: alle {len(t.kandidaten)} Kandidaten bei 1×", label or "Vorschlag"), f"Pareto {typ}",
                                "Jeder Punkt ein Kandidat (Mittel über seine gerechneten Saaten). Links unten ist besser. Wer das Formtor verfehlt (grau), steht nie vorn."))
            aus.append(self._validierung(typ, t))
            aus.append(self._strategie(typ, t))
            vor = t.daten("vorschlag") or {}
            if vor.get("beste_unbestaetigt"):
                b = vor["beste_unbestaetigt"]
                zeilen_b = [[a, z(x["gewinn_validierung"], 3), "ja" if x["formtor"] else "NEIN", "; ".join(x["verstoesse"])] for a, x in sorted(b["scheitert_an"].items())]
                aus.append("<h4>Bester Kandidat der Suche, nicht bestätigt</h4><p>" + h(b["hinweis"]) + f" Abweichungen: {h(_kurz(b['kandidat'], raum))}</p>"
                           + tabelle(["Auflösung", "Gewinn an der Validierungsreferenz", "Formtor", "Verstöße"], zeilen_b, rechts=(1,), titel="Woran er scheitert"))
            if vor.get("am_rand"):
                aus.append(hinweis("<b>Werte am Rand ihres Bereichs.</b> Wer am Rand sucht, nutzt oft eine Schwäche der Kennzahlen aus; bitte mit den Bildern gegenprüfen:<ul>"
                                   + "".join(f"<li>{h(x)}</li>" for x in vor["am_rand"]) + "</ul>", warn=True))
            if vor.get("modellgrenzen"):
                aus.append("<h4>Erkannte Modellgrenzen</h4><ul>" + "".join(f"<li>{h(x)}</li>" for x in vor["modellgrenzen"]) + "</ul>")
        if self.d.vorschlag:
            aus.append("<h3>Nach WI-0249</h3><p>Diese Kalibrierungen sind erst nach dem laufenden Umbau des Generators (WI-0249) sinnvoll:</p><ul>" + "".join(f"<li>{h(x)}</li>" for x in self.d.vorschlag.get("nach_wi_0249", [])) + "</ul>")
        return "".join(aus)

    def _wertebereiche(self, typ: str, t: TypDaten, raum: Raum | None) -> str:
        if raum is None:
            return ""
        top = [k for k in t.kandidaten if k["tor_ok"] and k["n_saaten"] >= self.d.profil.suche["saaten"] and not k["ist_vorgabe"]]
        top.sort(key=lambda k: k["d1"] if k["d1"] is not None else 9)
        top = top[:8]
        if not top:
            return "<p class='klein'>Kein Kandidat hielt das Formtor mit allen Saaten: keine Wertebereiche der Besten.</p>"
        zeilen = []
        aktiv = (t.daten("sensitivitaet") or {}).get("aktiv", [])
        for n in aktiv:
            p = raum[n]
            werte = [k["kandidat"].get(n, p.basis) for k in top]
            if p.art == "wahl":
                zeilen.append([n, p.basis, ", ".join(sorted(set(str(w) for w in werte))), "", f"{sum(1 for w in werte if w != p.basis)} von {len(werte)} weichen ab"])
            else:
                zeilen.append([n, z(p.basis, 3), f"{z(min(werte), 3)} … {z(max(werte), 3)}", f"{z(p.min, 3)} … {z(p.max, 3)}", f"{sum(1 for w in werte if not p.gleich(w, p.basis))} von {len(werte)} weichen ab"])
        return tabelle(["Parameter", "Vorgabe", f"Bereich der besten {len(top)} (mit Formtor)", "Zulässiger Bereich", "Abweichler"], zeilen, rechts=(1,), titel="Wertebereiche der Besten: eng heißt gut bestimmt, weit heißt, der Wert ist für das Ergebnis gleichgültig")

    def _validierung(self, typ: str, t: TypDaten) -> str:
        val = t.daten("validierung")
        if not val or not val.get("kandidaten"):
            return f"<h4>Validierung</h4><p class='klein'>{h((val or {}).get('hinweis', 'Nicht durchgeführt oder kein Kandidat über der Vorgabe.'))}</p>"
        zeilen = []
        for e in val["kandidaten"]:
            for a, x in sorted(e["aufloesungen"].items()):
                vg = val["vorgabe"][a]
                zeilen.append([e["platz"], f"{a}×", z(vg["validierung"]["d1"]["mittel"]), z(x["validierung"]["d1"]), z(x["gewinn_validierung"], 3), z(vg["optimierung"]["d1"]["mittel"]), z(x["optimierung"]["d1"]),
                               "ja" if x["tor_ok"] else "NEIN", "bestätigt" if x["bestaetigt"] else "nicht bestätigt"])
        v = val.get("vorschlag")
        text = (f"<p>Vorschlag: Platz {v['platz']} der Suche (erster bestätigter).</p>" if v else "<p><b>Kein Kandidat bestätigt: Die Vorgabe des Typs bleibt.</b> Ein Gewinn an der Optimierungsreferenz, der an einem anderen echten Gebirge desselben Typs nicht ankommt, ist Überanpassung.</p>")
        return ("<h4>Validierung: die Besten bei 2× und 4× gegen andere Gebirge desselben Typs</h4>"
                + tabelle(["Platz", "Maßstab", "Validierung: Vorgabe", "Validierung: Kandidat", "Gewinn (rel.)", "Optimierung: Vorgabe", "Optimierung: Kandidat", "Formtor", "Urteil"], zeilen, rechts=(0, 2, 3, 4, 5, 6),
                          titel=f"Abstand zur Referenz; bestätigt: Gewinn ≥ {prozent(val['gewinn_min'], 0)} an der Validierungsreferenz und Formtor an jeder Auflösung") + text)

    def _strategie(self, typ: str, t: TypDaten) -> str:
        st = t.daten("strategie")
        if not st or "strategien" not in st:
            return ""
        zeilen = []
        for name, e in st["strategien"].items():
            b, o = e.get("beste_zulaessig"), e.get("beste_ohne_tor")
            zeilen.append([e["beschreibung"], f"{e['kandidaten']} ({e.get('davon_eigene_suche', e['kandidaten'])} der kleinen Suche)", e["zulaessig"], z(b["d1"]) if b else "-", z(o["d1"]) if o else "-", z(e["form_verlust_beste_ohne_tor"]) if o else "-",
                           "ja" if e["tor_erreichbar"] else "NEIN"])
        return ("<h4>Strategievergleich</h4>" + tabelle(["Strategie", "Kandidaten", "mit Formtor", "bester Abstand (zulässig)", "bester Abstand (ohne Tor)", "Formverlust dieses besten", "Formtor erreichbar"], zeilen, rechts=(1, 2, 3, 4, 5),
                                                     titel=f"Je Strategie eine kleine Suche bei 1× (Saat {', '.join(st['saaten'])}); Formtor gegen die gezeichnete Form")
                + f"<p><b>{h(st['urteil'])}</b>. Referenzstreuung (zwei echte Gebirge): {z(st.get('referenzstreuung'))}.</p>"
                + (hinweis(h(((t.daten('vorschlag') or {}).get('strategie') or {}).get('vorbehalt')), warn=True) if ((t.daten('vorschlag') or {}).get('strategie') or {}).get('vorbehalt') else ""))

    # --- Anhang ----------------------------------------------------------------------------------------------------------
    def anhang(self) -> str:
        d = self.d
        ereignisse = "\n".join(f"{e['zeit']}  {e['text']}" for e in d.ereignisse[-60:])
        return (f"<details open><summary>Profil</summary><pre>{h(json.dumps(d.profil.roh, ensure_ascii=False, indent=2))}</pre></details>"
                f"<details><summary>Plausibilität: Einstellungen</summary><pre>{h(json.dumps(self.einst.als_dict(), ensure_ascii=False, indent=2))}</pre></details>"
                f"<details><summary>Ereignisse des Laufs (letzte 60)</summary><pre>{h(ereignisse)}</pre></details>")


def perf_html(p: dict[str, Any]) -> str:
    """Eine Performance-Messung des Labors (``lauf perf``): Tabelle je Fall und die Phasenanteile."""
    zeilen = []
    phasen = []
    for f in p["faelle"]:
        zeilen.append([f["name"], z(f["raster"]["zellen"]), sekunden(f["kalt"]["wall_ms"]["median"]), z(f["kalt"]["wall_ms"]["streuung_prozent"], 1) + " %", sekunden(f["warm"]["wall_ms"]["median"]) if f.get("warm") else "-",
                       sekunden(f["kalt"]["cpu_ms"]["median"]), z(f["kalt"]["rss_spitze_mib"]["median"], 0), z(f["fremdlast_kerne"]["median"], 1), "ja" if f["unruhig"] else "nein"])
        if f.get("phasen"):
            a = f["phasen"]["anteile_prozent"]
            phasen.append(bild(grafik.balken_phasen({n: v for n, v in a.items() if v is not None}, f["name"]), f"Phasen {f['name']}"))
    s = p.get("stand", {})
    kopf = f"<h3>Messung „{h(p['konfig']['name'])}“ am Commit {h(str(s.get('commit', ''))[:12])}</h3><p class='klein'>{h(p['konfig'].get('beschreibung', ''))} Dauer {z(p.get('dauer_s'), 0)} s.</p>"
    tab = tabelle(["Fall", "Zellen", "kalt (Median)", "Streuung", "warm", "CPU", "RSS-Spitze (MiB)", "Fremdlast (Kerne)", "unruhig"], zeilen, rechts=tuple(range(1, 8)), titel="Performance-Messung des Labors (docs/lauf.md)")
    return kopf + tab + (f"<h4>Phasen (Anteil an der Rechenzeit)</h4>{reihe(*phasen)}" if phasen else "")


def nachmessung_html(erg: dict[str, Any]) -> str:
    """Eine Nachmessung (``optimierung nachmessen``): Vorschläge eines früheren Generator-Standes, am neuen Stand gemessen, damals gegen jetzt."""
    teile = [f"<h3>Nachmessung: Vorschlag vom Stand {h(str(erg['vorschlag_commit'])[:12])} am Stand {h(erg['commit'][:12])}</h3>"
             f"<p class='klein'>Keine neue Suche. Die Werte der Vorschlagsdatei liegen als Überlagerung über der Vorgabe des neuen Standes; gemessen wird mit den Saaten ({h(', '.join(erg['saaten']))}), "
             f"der Bewertung und dem Formtor ({z(erg['tor_faktor'], 2)} der Vorgabe) des ursprünglichen Laufs, bestätigt bei 2× und 4× gegen die Validierungsausschnitte.</p>"]

    def verlust(f: dict[str, Any] | None) -> float | None:
        return None if not f or f.get("form") is None else 1.0 - f["form"]

    kopf1 = ["1× (Optimierungsausschnitt)", "Abstand damals", "Abstand jetzt", "Formverlust damals", "Formverlust jetzt", "Formtor jetzt"]
    for typ, e in erg["typen"].items():
        vn, va = e["vorgabe_neu"], e["vorgabe_alt"]
        teile.append(f"<h4>{h(typ)} ({h(e['gebirge'])}): Datei sagte {h(e['status_alt'])}</h4>")
        zeilen = [["Vorgabe des Typs", z((va or {}).get("d1")), z(vn["d1"]), z(verlust(va)), z(vn["form_verlust"]), "-"]]
        k, ka = e["kandidat_neu_1x"], e["kandidat_alt_1x"]
        if k is None:
            teile.append(tabelle(kopf1, zeilen, rechts=(1, 2, 3, 4), titel="Die Vorgabe am neuen Stand"))
            teile.append(hinweis("Die Datei nennt keinen Kandidaten (die Vorgabe blieb): gemessen wurde nur die Vorgabe des neuen Standes."))
            continue
        art = {"vorschlag": "Vorschlag", "unbestaetigt": "bester unbestätigter Kandidat"}.get(e["art"], "Kandidat")
        zeilen.append([art, z((ka or {}).get("d1")), z(k["d1"]), z(verlust(ka)), z(k["form_verlust"]), "gehalten" if k["tor_ok"] else "VERFEHLT"])
        teile.append(tabelle(kopf1, zeilen, rechts=(1, 2, 3, 4), titel="Abstand zur Referenz und Formerhalt bei 1×"))
        if not k["tor_ok"]:
            teile.append(hinweis("Formtor verfehlt: " + h("; ".join(k["verstoesse"])), warn=True))
        v = e["validierung"]
        zeilen = []
        for a, x in sorted(v["kandidat"].items()):
            alt = e["validierung_alt"].get(f"{a}x") or {}
            zeilen.append([f"{a}×", z(alt.get("vorgabe_d1")), z(v["vorgabe"][a]["validierung"]["d1"]), z(alt.get("kandidat_d1")), z(x["d1_validierung"]), prozent(alt.get("gewinn")), prozent(x["gewinn"]),
                           "gehalten" if x["formtor"] else "VERFEHLT", "bestätigt" if x["bestaetigt"] else "nicht bestätigt"])
        teile.append(tabelle(["Auflösung", "Vorgabe damals", "Vorgabe jetzt", "Kandidat damals", "Kandidat jetzt", "Gewinn damals", "Gewinn jetzt", "Formtor", "Urteil"], zeilen, rechts=(1, 2, 3, 4, 5, 6),
                             titel="Validierung gegen andere reale Gebirge (Abstand zur Referenz)"))
        if e.get("gewinn_1x") is not None and e["gewinn_1x"] <= 0:
            teile.append(hinweis(f"Bei 1× liegt der Kandidat nicht mehr unter der Vorgabe des neuen Standes (Abstand {z(k['d1'])} gegen {z(vn['d1'])}); sein Vorteil beruht auf der Validierung.", warn=True))
        teile.append(hinweis("Der Vorschlag besteht die Validierung am neuen Stand weiter." if e["bestaetigt_neu"]
                             else "Der Vorschlag besteht die Validierung am neuen Stand <b>nicht</b> mehr (oder nur noch ohne Formtor): neu suchen, bevor er gebraucht wird.", warn=not e["bestaetigt_neu"]))
        alt_komp = (va or {}).get("komponenten") or {}
        komp = [[n, z(alt_komp.get(n), 2), z(vn["komponenten"].get(n), 2), z((k["komponenten"] or {}).get(n), 2)] for n in vn["komponenten"]
                if not (vn["komponenten"].get(n) is None and alt_komp.get(n) is None)]
        if komp:
            teile.append(tabelle(["Formkomponente (1 = erhalten)", "Vorgabe damals", "Vorgabe jetzt", "Kandidat jetzt"], komp, rechts=(1, 2, 3),
                                 titel="Formerhalt im Einzelnen (Köpfe, Lage des Kamms, Täler; hier wirkt WI-0249 P2)"))
        w = e["weggefallen"]
        for grund, text in (("unbekannt", "kennt der neue Stand nicht"), ("ausserhalb", "liegt außerhalb der Grenzen des neuen Standes"), ("gilt_schon", "gilt dort bereits als Vorgabe")):
            if w[grund]:
                teile.append(f"<p class='klein'>Weggefallen ({h(text)}): <code>{h(', '.join(w[grund]))}</code></p>")
    return "".join(teile)


def _laenge(p: Sequence[tuple[float, float]]) -> float:
    return float(sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(p[:-1], p[1:])))


def _entlang(kante: Sequence[tuple[float, float]], s: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    x, y = np.zeros(len(s)), np.zeros(len(s))
    seg = [(a, b, math.hypot(b[0] - a[0], b[1] - a[1])) for a, b in zip(kante[:-1], kante[1:])]
    for i, si in enumerate(s):
        rest = float(si)
        for a, b, l in seg:
            if rest <= l or (a, b, l) == seg[-1]:
                t = 0.0 if l == 0 else min(1.0, rest / l)
                x[i], y[i] = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
                break
            rest -= l
    return x, y


def _normale(kante: Sequence[tuple[float, float]], s: float) -> tuple[float, float]:
    rest = s
    for a, b in zip(kante[:-1], kante[1:]):
        l = math.hypot(b[0] - a[0], b[1] - a[1])
        if rest <= l and l > 0:
            return -(b[1] - a[1]) / l, (b[0] - a[0]) / l
        rest -= l
    return 0.0, 1.0


def _abstand_zu_linie(x: float, y: float, kante: Sequence[tuple[float, float]]) -> float:
    best = math.inf
    for (ax, ay), (bx, by) in zip(kante[:-1], kante[1:]):
        l2 = (bx - ax) ** 2 + (by - ay) ** 2
        t = 0.0 if l2 == 0 else max(0.0, min(1.0, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / l2))
        best = min(best, math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay)))
    return best


def vergleich_html(v: dict[str, Any]) -> str:
    """Ein Commit-Vergleich (``lauf vergleiche``): Zusammenfassung je Fall und die auffälligsten Regressionen und Verbesserungen."""
    kopf = f"<h3>Vergleich {h(v['commit_a'][:12])} → {h(v['commit_b'][:12])}</h3>"
    sumzeile = " ".join(f"{u}: {n}" for u, n in v["urteile"].items())
    zeilen = []
    for f in v["faelle"]:
        if "fehler" in f:
            zeilen.append([f["name"], "-", "-", "-", f["fehler"]])
            continue
        zeilen.append([f["name"], "gleich" if f["raster_gleich"] else "verschieden", f.get("geaendert", "-"), " ".join(f"{u} {n}" for u, n in f["urteile"].items()), "mit Referenz" if f["referenz"] else "ohne Referenz (unbewertet)"])
    tab = tabelle(["Fall", "Raster", "Kennzahlen geändert (> Toleranz)", "Urteile", "Maßstab"], zeilen, rechts=(2,), titel=f"Fall für Fall, B gegen A ({sumzeile})")
    alle = [(f["name"], s) for f in v["faelle"] if "skalare" in f for s in f["skalare"] if s["relativ"] is not None and s["a"] is not None and s["b"] is not None]

    def top(urteil: str | None, titel: str) -> str:
        auswahl = [(n, s) for n, s in alle if urteil is None or s["urteil"] == urteil]
        auswahl.sort(key=lambda t: -abs(t[1]["relativ"]))
        if not auswahl:
            return ""
        return tabelle(["Fall", "Kennzahl", "A", "B", "Änderung", "Urteil", "Maßstab"], [[n, s["name"], z(s["a"], 4), z(s["b"], 4), prozent(s["relativ"]), s["urteil"], s["grund"]] for n, s in auswahl[:12]], rechts=(2, 3, 4), titel=titel)

    teil = top("schlechter", "Auffällige Regressionen (Einzelwerte, größte relative Änderung zuerst)") + top("besser", "Verbesserungen")
    if not v["urteile"]["schlechter"] and not v["urteile"]["besser"]:
        teil += hinweis("Ohne Ziele (<code>ziele</code> der Konfiguration) und ohne Referenzraster urteilt der Vergleich nicht (alles <code>unbewertet</code>); die größten Änderungen stehen unten, ohne Deutung.")
        teil += top(None, "Größte Änderungen (unbewertet)")
    return kopf + tab + teil
