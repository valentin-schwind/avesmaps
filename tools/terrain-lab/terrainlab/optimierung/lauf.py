"""Der Lauf der Optimierung (WI-0250 Phase A4): Stufen je Typ, Fortsetzen, Grenzen, Ergebnis.

Je Typ, in dieser Reihenfolge (jede Stufe merkt sich ihr Ergebnis in der Datenbank, ``phase``):

1. ``basis``          die Vorgabe des Typs bei 1× über alle Saaten, die Referenzstreuung (zwei echte Gebirge desselben Typs gegeneinander),
2. ``sensitivitaet``  Morris: wirkungslose und schwache Parameter fallen aus dem Suchraum,
3. ``suche``          Sobol-Stichprobe und Successive Halving bei 1×,
4. ``verfeinerung``   lokale (1 + λ)-Suche um den Besten,
5. ``validierung``    die Besten bei 2× und 4× gegen die Validierungsausschnitte (nur bestätigen, nie umordnen),
6. ``strategie``      Kammnetz oder nicht, Grundmuster rauschen oder zellen,
7. ``endgelaende``    nur mit ``endgelaende.aktiv`` im Profil und einem Schnappschuss: wenige Kandidaten im lokalen Endgelände,
8. ``vorschlag``      der Vorschlag mit Begründung.

**Fortsetzen.** Eine fertige Stufe wird übersprungen; eine unterbrochene plant dieselben Messungen noch einmal (alles ist deterministisch, Seeds stehen im Profil)
und überspringt die gespeicherten. Die ``STOP``-Datei im Laufordner hält den Lauf sauber an, ebenso eine Grenze des Profils (Zeit, Versuche, CPU, Speicher).
"""

from __future__ import annotations

import json
import shutil
import sys
import time
import zlib
from pathlib import Path
from typing import Any, Callable

from terrainlab import daten_wurzel
from terrainlab.bewertung import Bewerter, Einstellungen, Kontext, ReferenzSatz, lade_geometrie
from terrainlab.lauf.adapter import Adapter, AdapterFehler
from terrainlab.lauf.cache import Zwischenspeicher
from terrainlab.lauf.umgebung import loese_commit

from . import raum as raummodul
from .auswerter import Auswerter, Budget, Gestoppt
from .profil import Profil, parse_profil
from .ranking import Bewertet, bewerte, ordne, vorgabe_zusammenfassung
from .sensitivitaet import morris, waehle_aktiv
from .speicher import Speicher
from .strategie import erzeuge_ohne_kamm, vergleiche_strategien
from .suche import halbiere, sobol_kandidaten, verfeinere
from .validierung import validiere
from .vorschlag import TYP_HINWEISE, sammle_werte, schreibe_vorschlag
from .raum import Raum

STUFEN = ("basis", "sensitivitaet", "suche", "verfeinerung", "validierung", "strategie", "endgelaende", "vorschlag")
EXIT_GESTOPPT = 10
FIXTURE_UNTER_STAND = Path("apps") / "server" / "test" / "fixtures" / "rueckennetz"


def optimierung_wurzel(labor: Path | None = None) -> Path:
    return (labor or daten_wurzel()) / "optimierung"


class Lauf:
    """Ein Lauf der Optimierung in einem Ordner (``<Labor>/optimierung/<zeit>-<profil>-<commit>/``)."""

    def __init__(self, ordner: Path | str, profil: Profil, adapter: Adapter | Any, cache: Zwischenspeicher | None = None, melde: Callable[[str], None] | None = None,
                 einstellungen_satz: ReferenzSatz | None = None) -> None:
        self.ordner = Path(ordner)
        self.ordner.mkdir(parents=True, exist_ok=True)
        self.profil = profil
        self.adapter = adapter
        self.cache = cache or Zwischenspeicher()
        self._melde = melde or (lambda t: print(t, file=sys.stderr, flush=True))
        self.db = Speicher(self.ordner / "lauf.sqlite")
        self._satz = einstellungen_satz
        self.auswerter: Auswerter | None = None
        self.budget: Budget | None = None

    # --- Anlegen und Öffnen -------------------------------------------------------------------------------------------------
    @classmethod
    def neu(cls, profil: Profil, adapter: Adapter | Any, ordner: Path | str | None = None, labor: Path | None = None, **kw: Any) -> "Lauf":
        commit = loese_commit(profil.commit)
        ziel = Path(ordner) if ordner else optimierung_wurzel(labor) / f"{time.strftime('%Y%m%d-%H%M%S')}-{profil.name}-{commit[:12]}"
        if (ziel / "lauf.sqlite").exists():
            raise FileExistsError(f"{ziel} enthält schon einen Lauf; mit `optimierung fortsetzen` weitermachen")
        lauf = cls(ziel, profil, adapter, **kw)
        lauf.db.setze_meta("profil", profil.roh)
        lauf.db.setze_meta("commit", commit)
        lauf.db.setze_meta("begonnen", time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime()))
        lauf.db.setze_meta("status", "neu")
        (ziel / "profil.json").write_text(json.dumps(profil.roh, ensure_ascii=False, indent=2), encoding="utf-8")
        return lauf

    @classmethod
    def oeffne(cls, ordner: Path | str, adapter: Adapter | Any, **kw: Any) -> "Lauf":
        ordner = Path(ordner)
        if not (ordner / "lauf.sqlite").exists():
            raise FileNotFoundError(f"{ordner} enthält keinen Lauf (lauf.sqlite fehlt)")
        db = Speicher(ordner / "lauf.sqlite")
        roh = db.meta("profil")
        db.schliesse()
        # Das gespeicherte Profil gilt, nicht die Datei von heute: Eine fortgesetzte Optimierung ändert ihre Regeln nicht.
        lauf = cls(ordner, parse_profil(roh), adapter, **kw)
        return lauf

    @property
    def commit(self) -> str:
        return str(self.db.meta("commit"))

    def melde(self, text: str) -> None:
        self._melde(text)
        self.db.ereignis("meldung", text)

    # --- Vorbereitung -------------------------------------------------------------------------------------------------------
    def _bereite_vor(self) -> None:
        p = self.profil
        grenzen = self.db.meta("grenzen")
        if grenzen is None:
            grenzen = self.adapter.grenzen(self.commit, p.fassung)
            self.db.setze_meta("grenzen", grenzen)
        if not grenzen.get("fassung_hat_presets"):
            raise ValueError(f"Fassung {p.fassung} führt am Stand {self.commit[:12]} keine Gebirgs-Presets; die Optimierung braucht sie (Fassung 19)")
        self.grenzen = grenzen
        stand = Path(self.adapter.stand_vorbereiten(self.commit))
        self.stand = stand
        einst: Einstellungen = p.plausibilitaet
        satz = self._satz or ReferenzSatz(einst)
        bewerter = Bewerter(einst, satz)
        raeume: dict[str, Raum] = {}
        kontexte: dict[str, Kontext] = {}
        dateien: dict[tuple[str, str], str] = {}
        for t in p.typen:
            raeume[t.typ] = Raum.aus_grenzen(grenzen, t.typ, p.ausschluss)
            fixture = stand / FIXTURE_UNTER_STAND / f"{t.gebirge}.json"
            if not fixture.exists():
                raise FileNotFoundError(f"Die Fixture {t.gebirge} gibt es am Stand {self.commit[:12]} nicht ({fixture})")
            geo = lade_geometrie(fixture)
            kopie = self.ordner / "gebirge" / f"{t.gebirge}.json"  # die gezeichnete Form bleibt beim Lauf (Bericht und Nachprüfung brauchen den Stand nicht)
            kopie.parent.mkdir(parents=True, exist_ok=True)
            if not kopie.exists():
                shutil.copyfile(fixture, kopie)
            kontexte[t.typ] = Kontext(t.typ, t.gebirge, geo, grenzen["basis"][t.typ]["rueckennetz"].get("gratMin"), geo.kammhoehe)
            dateien[(t.typ, "ohne-kamm")] = str(erzeuge_ohne_kamm(fixture, self.ordner / "gebirge" / f"{t.gebirge}-ohne-kamm.json"))
        self.budget = Budget(self.ordner, p.grenzen, self.melde)
        self.auswerter = Auswerter(p, self.commit, self.adapter, self.cache, self.db, bewerter, raeume, kontexte, dateien, self.budget, self.ordner, self.melde)
        self.satz = satz
        self.raeume, self.kontexte = raeume, kontexte

    # --- Stufen -------------------------------------------------------------------------------------------------------------
    def _stufe(self, typ: str, name: str, funktion: Callable[[], Any]) -> Any:
        alt = self.db.phase(typ, name)
        if alt is not None and alt["status"] == "fertig":
            return alt["daten"]
        self.db.setze_phase(typ, name, "laeuft")
        self.melde(f"[{typ}] Stufe {name}")
        try:
            daten = funktion()
        except Gestoppt:
            self.db.setze_phase(typ, name, "gestoppt")
            raise
        self.db.setze_phase(typ, name, "fertig", daten)
        return daten

    def _saaten(self, anzahl: int | None = None) -> list[int | None]:
        return list(self.profil.saaten if anzahl is None else self.profil.saaten[:anzahl])

    def _seed(self, typ: str, zusatz: int = 0) -> int:
        return int(self.profil.suche["seed"]) + zlib.crc32(typ.encode("utf-8")) % 65536 + zusatz

    def stufe_basis(self, typ: str) -> dict[str, Any]:
        aus = self.auswerter
        assert aus is not None
        saaten = self._saaten()
        vor = vorgabe_zusammenfassung(aus, typ, saaten)
        kontext = self.kontexte[typ]
        streuung = None
        try:
            streuung = self.satz.streuung(typ, "750m", kontext.relief_ziel_m)
        except (KeyError, FileNotFoundError, ValueError) as fehler:
            self.melde(f"[{typ}] keine Referenzstreuung: {fehler}")
        return {"vorgabe": vor, "referenzstreuung": streuung, "gebirge": kontext.gebirge, "geometrie": kontext.geometrie.zaehlung(), "kammhoehe_m": kontext.geometrie.kammhoehe,
                "grat_min": kontext.grat_min, "saaten": [self.profil.saat_name(s) for s in saaten]}

    def stufe_sensitivitaet(self, typ: str) -> dict[str, Any]:
        aus = self.auswerter
        assert aus is not None
        raum = self.raeume[typ]
        s = self.profil.sensitivitaet
        erg = morris(aus, typ, raum, raum.namen, s, self._saaten(), lambda t: self.melde(f"[{typ}] {t}"))
        return waehle_aktiv(erg, float(s["schwelle"]), int(s["max_aktiv"]))

    def _basis_fn(self, typ: str, **kw: Any) -> Callable[[Any], dict[str, Any]]:
        aus = self.auswerter
        assert aus is not None
        return lambda saaten: vorgabe_zusammenfassung(aus, typ, saaten, **kw)

    def stufe_suche(self, typ: str) -> dict[str, Any]:
        aus = self.auswerter
        assert aus is not None
        raum = self.raeume[typ]
        aktiv = list(self.db.phase(typ, "sensitivitaet")["daten"]["aktiv"])  # type: ignore[index]
        s = self.profil.suche
        saaten = self._saaten(int(s["saaten"]))
        kandidaten = [{}] + sobol_kandidaten(raum, aktiv, int(s["kandidaten"]), self._seed(typ))
        erg = halbiere(aus, typ, kandidaten, saaten, self._basis_fn(typ), int(s["eta"]), self.profil.tor_faktor, melde=lambda t: self.melde(f"[{typ}] {t}"))
        return {"aktiv": aktiv, "kandidaten": len(kandidaten), "saaten": [self.profil.saat_name(x) for x in saaten], "rangliste": [b.als_dict() for b in erg[:12]]}

    def _bewertet(self, typ: str, kandidat: dict[str, Any], saaten: list[int | None], herkunft: str = "") -> Bewertet:
        aus = self.auswerter
        assert aus is not None
        return bewerte(aus, typ, kandidat, saaten, vorgabe_zusammenfassung(aus, typ, saaten), self.profil.tor_faktor, herkunft=herkunft)

    def stufe_verfeinerung(self, typ: str) -> dict[str, Any]:
        aus = self.auswerter
        assert aus is not None
        raum = self.raeume[typ]
        suche = self.db.phase(typ, "suche")["daten"]  # type: ignore[index]
        s = self.profil.suche
        saaten = self._saaten(int(s["saaten"]))
        basis = vorgabe_zusammenfassung(aus, typ, saaten)
        bisher = ordne([self._bewertet(typ, e["kandidat"], saaten, e.get("herkunft", "")) for e in suche["rangliste"]])
        v = s["verfeinerung"]
        bester, nachkommen = bisher[0], []
        if int(v["runden"]) > 0 and int(v["nachkommen"]) > 0 and bisher[0].tor_ok:
            bester, nachkommen = verfeinere(aus, typ, raum, suche["aktiv"], bisher[0], saaten, basis, self.profil.tor_faktor, int(v["runden"]), int(v["nachkommen"]),
                                            float(v["schritt"]), self._seed(typ, 7), melde=lambda t: self.melde(f"[{typ}] {t}"))
        gesamt = ordne(list({b.schluessel: b for b in (*bisher, *nachkommen)}.values()))
        return {"start": bisher[0].als_dict(), "bester": bester.als_dict(), "nachkommen": len(nachkommen), "rangliste": [b.als_dict() for b in gesamt[:12]]}

    def stufe_validierung(self, typ: str) -> dict[str, Any]:
        aus = self.auswerter
        assert aus is not None
        v = self.profil.validierung
        rang = self.db.phase(typ, "verfeinerung")["daten"]["rangliste"]  # type: ignore[index]
        saaten = self._saaten(int(self.profil.suche["saaten"]))
        beste = [self._bewertet(typ, e["kandidat"], saaten) for e in rang if e["kandidat"] and e["tor_ok"]][: int(v["beste"])]
        if not beste or not v["aufloesungen"]:
            return {"aufloesungen": v["aufloesungen"], "kandidaten": [], "vorschlag": None, "vorgabe": {}, "hinweis": "kein Kandidat über der Vorgabe oder Validierung abgeschaltet"}
        return validiere(aus, typ, beste, self._saaten(), v, self.profil.tor_faktor, lambda t: self.melde(f"[{typ}] {t}"))

    def stufe_strategie(self, typ: str) -> dict[str, Any]:
        aus = self.auswerter
        assert aus is not None
        st = self.profil.strategien
        if not st["aktiv"]:
            return {"aktiv": False}
        basis_daten = self.db.phase(typ, "basis")["daten"]  # type: ignore[index]
        streuung = (basis_daten.get("referenzstreuung") or {}).get("leitwert")
        aktiv = list(self.db.phase(typ, "sensitivitaet")["daten"]["aktiv"])  # type: ignore[index]
        saaten = self._saaten(1)
        # Alle Kandidaten der Hauptsuche, die bei der ersten Saat gerechnet sind (ohne die der Strategien selbst und der Validierung).
        saat0 = self.profil.saat_name(saaten[0])
        ids = {m["kandidat_id"] for m in self.db.messungen(rolle="optimierung", aufloesung=1) if m["saat"] == saat0 and m["status"] == "ok"}
        haupt = [k["werte"] for k in self.db.kandidaten(typ, "gezeichnet") if k["id"] in ids and k["werte"] and not k["herkunft"].startswith(("strategie", "validierung"))]
        erg = vergleiche_strategien(aus, typ, self.raeume[typ], aktiv, saaten, vorgabe_zusammenfassung(aus, typ, saaten), self.profil.tor_faktor, st, self._seed(typ, 13), streuung, haupt,
                                    lambda t: self.melde(f"[{typ}] {t}"))
        erg["haupt_kandidaten"] = len(haupt)
        return erg

    def stufe_endgelaende(self, typ: str) -> dict[str, Any]:
        aus = self.auswerter
        assert aus is not None
        e = self.profil.endgelaende
        if not e["aktiv"] or int(e["beste"]) <= 0:
            return {"aktiv": False}
        val = self.db.phase(typ, "validierung")["daten"]  # type: ignore[index]
        kandidaten = [k["kandidat"] for k in val["kandidaten"] if k["bestaetigt"]][: int(e["beste"])]
        saat = self._saaten(1)[0]
        ergebnis: dict[str, Any] = {"aktiv": True, "schnappschuss": e.get("schnappschuss"), "kandidaten": []}
        for name, kand in [("vorgabe", {})] + [(f"platz-{i + 1}", k) for i, k in enumerate(kandidaten)]:
            for rolle in ("optimierung", "validierung"):
                w = aus.messe(typ, kand, 0, saat, rolle=rolle, herkunft="endgelaende")
                ergebnis["kandidaten"].append({"name": name, "kandidat": kand, "rolle": rolle, "d1": (w or {}).get("d1", {}).get("leitwert") if w else None,
                                               "form": (w or {}).get("d2", {}).get("leitwert") if w else None, "wall_ms": (w or {}).get("d3", {}).get("wall_ms") if w else None})
        return ergebnis

    def stufe_vorschlag(self, typ: str) -> dict[str, Any]:
        raum = self.raeume[typ]
        d = {n: self.db.phase(typ, n) for n in STUFEN[:-1]}
        daten = {n: (p or {}).get("daten") for n, p in d.items()}
        val = daten["validierung"] or {}
        basis = daten["basis"]["vorgabe"]
        suche = daten["verfeinerung"]
        v = val.get("vorschlag")
        eintrag: dict[str, Any] = {"typ": typ, "gebirge": self.kontexte[typ].gebirge, "kammhoehe_m": self.kontexte[typ].geometrie.kammhoehe}
        strategie = daten["strategie"] or {}
        eintrag["strategie"] = {k: strategie.get(k) for k in ("empfehlung", "urteil", "erreichbar", "referenzstreuung", "erreichbar_faktor")} if strategie.get("aktiv", True) else None
        sens = daten["sensitivitaet"]
        eintrag["sensitivitaet"] = {"aktiv": sens["aktiv"], "wirkungslos": [n for n, p in sens["parameter"].items() if p["klasse"] == "wirkungslos"], "bedingt": [n for n, p in sens["parameter"].items() if p.get("bedingt")],
                                    "schwach": [n for n, p in sens["parameter"].items() if p["klasse"] == "schwach"]}
        if v is None:
            eintrag.update(status="vorgabe_bleibt", werte={}, ueberlagerung=None, begruendung=self._begruendung_keine(typ, val, suche))
            eintrag["modellgrenzen"] = self._modellgrenzen(typ, basis_d1=basis["d1"]["mittel"], suche=suche)
            eintrag["beste_unbestaetigt"] = self._beste_unbestaetigt(typ, val)
            self._strategie_vorbehalt(eintrag, strategie, None)
            return eintrag
        kandidat = v["kandidat"]
        werte = sammle_werte(raum, kandidat)
        eintrag.update(status="bestaetigt", kandidat=kandidat, ueberlagerung=raum.ueberlagerung(kandidat), **werte)
        eintrag["kennzahlen"] = self._kennzahlen(typ, kandidat, val, basis, suche)
        eintrag["begruendung"] = self._begruendung(typ, kandidat, werte, eintrag["kennzahlen"], v)
        eintrag["modellgrenzen"] = self._modellgrenzen(typ, basis_d1=basis["d1"]["mittel"], suche=suche, kandidat=kandidat)
        eintrag["am_rand"] = self._am_rand(typ, kandidat)
        self._strategie_vorbehalt(eintrag, strategie, kandidat)
        return eintrag

    def _beste_unbestaetigt(self, typ: str, val: dict[str, Any]) -> dict[str, Any] | None:
        """Der beste Kandidat der Suche, der die Validierung nicht bestand: zum Ansehen durch einen Menschen, mit dem, woran er scheiterte (kein Vorschlag)."""
        if not val.get("kandidaten"):
            return None
        e = val["kandidaten"][0]
        werte = sammle_werte(self.raeume[typ], e["kandidat"])
        scheitern = {a: {"gewinn_validierung": x["gewinn_validierung"], "formtor": x["tor_ok"], "verstoesse": x["verstoesse"]} for a, x in e["aufloesungen"].items() if not x["bestaetigt"]}
        return {"platz": e["platz"], "kandidat": e["kandidat"], **werte, "ueberlagerung": self.raeume[typ].ueberlagerung(e["kandidat"]), "scheitert_an": scheitern,
                "hinweis": "Kein Vorschlag: Dieser Kandidat besteht die Validierung nicht (siehe scheitert_an). Er liegt zum Ansehen bei, nicht zum Übernehmen."}

    def _strategie_vorbehalt(self, eintrag: dict[str, Any], strategie: dict[str, Any], kandidat: dict[str, Any] | None) -> None:
        """Die Strategieempfehlung gilt bei 1× mit einer Saat; wo der Vorschlag ihr widerspricht oder fehlt, sagt der Eintrag es."""
        emp = (strategie or {}).get("empfehlung")
        if not emp or not eintrag.get("strategie"):
            return
        if kandidat is None:
            eintrag["strategie"]["vorbehalt"] = ("Die Empfehlung gilt nur bei 1× mit einer Saat. Kein Kandidat der Suche bestand die Validierung bei 2× und 4×: Sie ist damit nicht belegt, die Vorgabe bleibt.")
            return
        typ = eintrag["typ"]
        eigen = f"kaemme-{kandidat.get('muster', self.raeume[typ]['muster'].basis)}"
        if eigen == emp["name"]:
            return
        mein = strategie["strategien"].get(eigen, {}).get("beste_zulaessig")
        diff = None if not mein else mein["d1"] - emp["abstand"]
        eintrag["strategie"]["vorbehalt"] = (f"Der bestätigte Vorschlag nutzt {eigen}, die Empfehlung nennt {emp['name']}"
                                             + ("" if diff is None else f" (Unterschied im Abstand bei 1×: {_z(diff)}{', innerhalb des Rauschens' if abs(diff) < 0.01 else ''})") + ".")

    def _am_rand(self, typ: str, kandidat: dict[str, Any], anteil: float = 0.05) -> list[str]:
        """Werte eines Kandidaten im äußersten Zwanzigstel ihres Bereichs: Wer am Rand sucht, nutzt meist eine Schwäche der Kennzahlen aus; ein Mensch soll genau hinsehen."""
        raum = self.raeume[typ]
        aus = []
        for n, w in sorted(kandidat.items()):
            p = raum[n]
            if p.art == "wahl" or p.max <= p.min:
                continue
            u = p.einheit(w)
            if u <= anteil or u >= 1 - anteil:
                aus.append(f"{n} = {_g(w)} (Bereich {_g(p.min)} bis {_g(p.max)}: {'unteres' if u <= anteil else 'oberes'} Zwanzigstel)")
        return aus

    # --- Auswertung für den Vorschlag ---------------------------------------------------------------------------------------
    def _kennzahlen(self, typ: str, kandidat: dict[str, Any], val: dict[str, Any], basis: dict[str, Any], suche: dict[str, Any]) -> dict[str, Any]:
        gewaehlt = next(e for e in suche["rangliste"] if e["kandidat"] == kandidat) if any(e["kandidat"] == kandidat for e in suche["rangliste"]) else None
        aus: dict[str, Any] = {"1x": {"vorgabe": _kurz_f(basis), "vorschlag": None if gewaehlt is None else _kurz_f(gewaehlt["fasse"])}}
        eintrag = next((k for k in val["kandidaten"] if k["kandidat"] == kandidat), None)
        if eintrag:
            for a, e in eintrag["aufloesungen"].items():
                vg = val["vorgabe"][a]
                aus[f"{a}x"] = {"vorgabe_optimierung": _kurz_f(vg["optimierung"]), "vorgabe_validierung": _kurz_f(vg["validierung"]), "vorschlag_optimierung": _kurz_f(e["optimierung"]["fasse"]),
                                "vorschlag_validierung": _kurz_f(e["validierung"]["fasse"]), "gewinn_validierung": e["gewinn_validierung"], "tor_ok": e["tor_ok"], "bestaetigt": e["bestaetigt"]}
        return aus

    def _begruendung(self, typ: str, kandidat: dict[str, Any], werte: dict[str, Any], kz: dict[str, Any], v: dict[str, Any]) -> str:
        eins = kz["1x"]
        teile = [f"{len(kandidat)} Werte geändert ({', '.join(sorted(kandidat))})."]
        if eins["vorschlag"]:
            teile.append(f"Abstand zur Optimierungsreferenz bei 1×: {_z(eins['vorgabe']['d1'])} → {_z(eins['vorschlag']['d1'])} (Leitwert, 0 = gleich), "
                         f"Formerhalt {_z(eins['vorgabe']['form'], 2)} → {_z(eins['vorschlag']['form'], 2)}.")
        for a in ("2x", "4x"):
            if a in kz:
                z = kz[a]
                teile.append(f"Validierungsreferenz bei {a.replace('x', '×')}: {_z(z['vorgabe_validierung']['d1'])} → {_z(z['vorschlag_validierung']['d1'])} "
                             f"(Gewinn {_z(100 * (z['gewinn_validierung'] or 0), 1)} %), Formtor {'gehalten' if z['tor_ok'] else 'verfehlt'}.")
        teile.append(f"Bestätigt als Platz {v['platz']} der Suche: besser als die Vorgabe an jeder validierten Auflösung, Formtor an jeder gehalten.")
        return " ".join(teile)

    def _begruendung_keine(self, typ: str, val: dict[str, Any], suche: dict[str, Any]) -> str:
        if not val.get("kandidaten"):
            return "Kein Kandidat der Suche war besser als die Vorgabe und hielt das Formtor; die Vorgabe des Typs bleibt."
        return (f"{len(val['kandidaten'])} Kandidaten der Suche wurden validiert, keiner wurde bestätigt (kein Gewinn von {100 * val['gewinn_min']:.0f} % gegenüber der Vorgabe an der "
                "Validierungsreferenz oder das Formtor verfehlt): Überanpassung an die Optimierungsreferenz. Die Vorgabe des Typs bleibt.")

    def _modellgrenzen(self, typ: str, *, basis_d1: float | None, suche: dict[str, Any], kandidat: dict[str, Any] | None = None) -> list[str]:
        """Was auch die besten Kandidaten nicht erreichen: Kennzahlen, die in (fast) jedem Kandidaten unter den am weitesten entfernten bleiben, und bekannte Grenzen des Typs."""
        grenzen = [f"{n}" for n in self._dauerhaft_entfernt(typ)]
        if TYP_HINWEISE.get(typ):
            grenzen.append(TYP_HINWEISE[typ])
        eintrag = next((e for e in suche["rangliste"] if e["kandidat"] == (kandidat or {})), None) or (suche["rangliste"][0] if suche["rangliste"] else None)
        if eintrag:
            arten = eintrag["fasse"].get("d1_arten", {})
            hoch = [f"{a} {arten[a]['mittel']:.2f}".replace(".", ",") for a in ("absolut", "relativ", "verteilung", "raeumlich") if arten.get(a, {}).get("mittel") is not None and arten[a]["mittel"] >= 0.3]
            if hoch:
                grenzen.append("Abstand zur Referenz bleibt hoch (Art: Mittel der Abstände ab 0,3): " + ", ".join(hoch))
        return grenzen

    def _dauerhaft_entfernt(self, typ: str, anteil: float = 0.8, schwelle: float = 0.9) -> list[str]:
        """Einzelkennzahlen, die in mindestens ``anteil`` aller gemessenen Kandidaten (1×, Referenzfälle der Optimierung) unter den sechs am weitesten entfernten stehen
        und dort einen Abstand von mindestens ``schwelle`` haben: Das Modell erreicht sie mit keinem seiner Parameter."""
        kand = {k["id"] for k in self.db.kandidaten(typ, "gezeichnet")}
        zaehler: dict[str, int] = {}
        beispiel: dict[str, dict[str, Any]] = {}
        faelle = 0
        for m in self.db.messungen(rolle="optimierung", aufloesung=1):
            if m["kandidat_id"] not in kand or m["status"] != "ok" or not m["werte"]:
                continue
            for f in (m["werte"].get("d1") or {}).get("faelle", []):
                faelle += 1
                for p in f.get("schlechteste", []):
                    if p["abstand"] >= schwelle:
                        zaehler[p["name"]] = zaehler.get(p["name"], 0) + 1
                        beispiel[p["name"]] = p
        aus = []
        for name, n in sorted(zaehler.items(), key=lambda kv: -kv[1]):
            if faelle and n / faelle >= anteil and len(aus) < 8:
                p = beispiel[name]
                aus.append(f"{name} ({p['art']}): Referenz {_g(p['referenz'])}, erzeugt zuletzt {_g(p['erzeugt'])}; in {100 * n / faelle:.0f} % der {faelle} Messungen unter den sechs am weitesten entfernten Kennzahlen")
        return aus

    # --- Lauf ---------------------------------------------------------------------------------------------------------------
    def laufe(self, nur_stufen: tuple[str, ...] | None = None) -> int:
        """Alle Stufen für alle Typen; gibt 0 (fertig), ``EXIT_GESTOPPT`` (fortsetzbar) oder 1 (Fehler) zurück."""
        stop = self.ordner / "STOP"
        if stop.exists():
            stop.unlink()
            self.melde("STOP-Datei gefunden und entfernt: Der Lauf wird fortgesetzt.")
        self.db.setze_meta("status", "laeuft")
        try:
            self._bereite_vor()
            for t in self.profil.typen:
                for stufe in STUFEN:
                    if nur_stufen and stufe not in nur_stufen:
                        continue
                    self._stufe(t.typ, stufe, lambda stufe=stufe, typ=t.typ: getattr(self, f"stufe_{stufe}")(typ))
            vorschlaege = {t.typ: self.db.phase(t.typ, "vorschlag")["daten"] for t in self.profil.typen if self.db.phase(t.typ, "vorschlag")}  # type: ignore[index]
            if vorschlaege:
                schreibe_vorschlag(self.ordner / f"vorschlag-{self.profil.name}-{self.commit[:12]}.json",
                                   {"lauf": self.ordner.name, "profil": self.profil.name, "commit": self.commit, "fassung_basis": self.profil.fassung, "saaten": [self.profil.saat_name(s) for s in self.profil.saaten],
                                    "vorschau": self.profil.vorschau, "bewertung": {"plausibilitaet": self.profil.plausibilitaet.als_dict(), "tor_faktor": self.profil.tor_faktor}},
                                   vorschlaege)
            self.db.setze_meta("status", "fertig")
            self._schreibe_zusammenfassung("fertig")
            self.melde(f"Fertig: {self.db.zaehle_messungen('ok')} Messungen, {self.auswerter.rechnungen if self.auswerter else 0} neue Rechnungen, "  # type: ignore[union-attr]
                       f"{self.auswerter.treffer if self.auswerter else 0} aus dem Zwischenspeicher.")
            return 0
        except Gestoppt as g:
            self.db.setze_meta("status", f"gestoppt: {g.grund}")
            self.melde(f"Gestoppt ({g.art}): {g.grund}. Fortsetzen mit: python -m terrainlab optimierung fortsetzen {self.ordner}")
            self._schreibe_zusammenfassung(f"gestoppt: {g.grund}")
            return EXIT_GESTOPPT
        except (AdapterFehler, ValueError, FileNotFoundError, RuntimeError, KeyError) as fehler:
            self.db.setze_meta("status", f"fehler: {fehler}")
            self.melde(f"Fehler: {fehler}")
            self._schreibe_zusammenfassung(f"fehler: {fehler}")
            raise

    def _schreibe_zusammenfassung(self, status: str) -> None:
        daten = {"lauf": self.ordner.name, "profil": self.profil.name, "commit": self.commit, "status": status,
                 "verbraucht": self.budget.verbraucht() if self.budget else None, "messungen": self.db.zaehle_messungen("ok"), "fehlgeschlagen": self.db.zaehle_messungen("fehler"),
                 "phasen": [{"typ": p["typ"], "name": p["name"], "status": p["status"], "aktualisiert": p["aktualisiert"]} for p in self.db.phasen()]}
        (self.ordner / "stand.json").write_text(json.dumps(daten, ensure_ascii=False, indent=1), encoding="utf-8")

    def schliesse(self) -> None:
        self.db.schliesse()


def _z(x: float | None, stellen: int = 3) -> str:
    return "-" if x is None else f"{x:.{stellen}f}".replace(".", ",")


def _g(x: Any) -> str:
    return "-" if x is None else f"{x:.3g}".replace(".", ",")


def _kurz_f(f: dict[str, Any]) -> dict[str, Any]:
    """Die wichtigsten Kennzahlen einer Zusammenfassung (``fasse_saaten``): Abstand, Formerhalt, Zeit."""
    return {"d1": f["d1"]["mittel"], "d1_streuung": f["d1"]["streuung"], "d1_arten": {a: v["mittel"] for a, v in f["d1_arten"].items()}, "form": f["form"]["mittel"],
            "komponenten": f["komponenten"], "wall_ms": f["wall_ms"]["mittel"], "rss_mib": f["rss_mib"]["mittel"], "zellen": f["zellen"], "saaten": f["saaten"]}
