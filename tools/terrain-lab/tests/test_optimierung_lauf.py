"""Der Lauf der Optimierung ohne Generator: Stufen, Fortsetzen, STOP, Grenzen, Formtor, Strategien, Vorschlagsdatei und Befehle."""

import json
from pathlib import Path

import pytest

from terrainlab.__main__ import main
from terrainlab.lauf.cache import Zwischenspeicher
from terrainlab.optimierung import EXIT_GESTOPPT, STUFEN, Lauf, parse_profil
from terrainlab.optimierung.auswerter import Budget, Gestoppt
from terrainlab.optimierung.profil import Profil
from terrainlab.optimierung.ranking import ordne, Bewertet
from terrainlab.optimierung.strategie import erzeuge_ohne_kamm

from test_optimierung_attrappe import FIXTURE, OptAttrappe, referenzen

pytestmark = pytest.mark.filterwarnings("error")

@pytest.fixture(autouse=True)
def reichlich_speicher(monkeypatch):
    """Die Tests fragen nicht den Rechner, wie viel Arbeitsspeicher gerade frei ist (4× und Endgelände verlangen 1200 und 6000 MiB); die Speichertests setzen ihren eigenen Wert."""
    monkeypatch.setattr("terrainlab.optimierung.auswerter.arbeitsspeicher_mib", lambda: (100000.0, 100000.0))


PROFIL = {
    "name": "probe",
    "commit": "HEAD",
    "typen": [{"typ": "kettengebirge", "gebirge": "probe"}],
    "saaten": [None, 11, 22],
    "bewertung": {"plausibilitaet": {"gruppen": ["hoehe", "hang"], "ohne_teuer": True, "rand_m": 0, "min_zellen": 50, "relief_angleichen": False}},
    "sensitivitaet": {"trajektorien": 2, "max_aktiv": 6},
    "suche": {"kandidaten": 8, "saaten": 3, "verfeinerung": {"runden": 1, "nachkommen": 2}},
    "validierung": {"beste": 2, "aufloesungen": [2, 4], "saaten": 2, "gewinn_min": 0.0},
    "strategien": {"aktiv": True, "kandidaten": 2},
    "grenzen": {"zeit_s": 600, "versuche": 5000, "ram_min_mib": 0, "ram_warten_s": 0},
}


def neuer_lauf(tmp_path, monkeypatch, adapter=None, profil=None, name="lauf", **kw):
    referenzen(monkeypatch)
    adapter = adapter or OptAttrappe(tmp_path)
    p = parse_profil({**PROFIL, **(profil or {})})
    cache = Zwischenspeicher(tmp_path / "cache")
    lauf = Lauf.neu(p, adapter, ordner=tmp_path / name, cache=cache, melde=lambda t: None)
    return lauf, adapter, cache


def test_ganzer_lauf_alle_stufen_und_vorschlagsdatei(tmp_path, monkeypatch):
    lauf, adapter, _ = neuer_lauf(tmp_path, monkeypatch)
    assert lauf.laufe() == 0
    phasen = {p["name"]: p["status"] for p in lauf.db.phasen()}
    assert phasen == {s: "fertig" for s in STUFEN}
    assert adapter.grenzen_aufrufe == 1 and lauf.db.meta("status") == "fertig"
    assert lauf.db.zaehle_messungen("ok") == adapter.rechnungen + lauf.auswerter.treffer + 0 or lauf.db.zaehle_messungen("ok") >= adapter.rechnungen
    # Sensitivität: Das Rauschen wirkt, die Grenze der Gratsuche (nur in der Ableitung) nicht in der Rechnung dieses Probegebirges.
    sens = lauf.db.phase("kettengebirge", "sensitivitaet")["daten"]
    assert sens["parameter"]["v12.rauschen"]["klasse"] in ("wirkt", "stark") and sens["parameter"]["netz.gratMin"]["klasse"] == "wirkungslos"
    assert sens["parameter"]["netz.gratMin"]["exakt_null"] is True and "netz.gratMin" not in sens["aktiv"] and "v12.rauschen" in sens["aktiv"]
    assert len(sens["aktiv"]) <= 6
    # Datei des Vorschlags: Kopf, Typ, Begründung, nie eine Fassung.
    datei = next(Path(lauf.ordner).glob("vorschlag-probe-*.json"))
    v = json.loads(datei.read_text(encoding="utf-8"))
    assert v["format"] == "avesmaps-terrainlab-vorschlag" and v["commit"] and v["fassung_basis"] == 19 and "keine Fassung" in v["hinweis"]
    e = v["typen"]["kettengebirge"]
    assert e["status"] in ("bestaetigt", "vorgabe_bleibt") and e["begruendung"] and e["strategie"]["urteil"]
    if e["status"] == "bestaetigt":
        assert e["ueberlagerung"]["presets"]["typen"]["kettengebirge"] and e["kennzahlen"]["2x"]["bestaetigt"]
    assert "config/terrain" not in json.dumps(v["typen"]) and not list(tmp_path.rglob("19.json"))
    lauf.schliesse()


def test_vorgabe_ist_ein_gueltiger_bezug_und_jede_messung_hat_protokoll(tmp_path, monkeypatch):
    lauf, adapter, _ = neuer_lauf(tmp_path, monkeypatch, profil={"strategien": {"aktiv": False}, "validierung": {"beste": 0}})
    assert lauf.laufe() == 0
    ms = lauf.db.messungen(rolle="optimierung", aufloesung=1)
    assert ms and all(m["commit_sha"] and m["auftrag_fingerprint"] and m["auftrag"]["typ"] == "kettengebirge" and m["werte"]["d3"]["wall_ms"] > 0 for m in ms)
    basis = lauf.db.phase("kettengebirge", "basis")["daten"]
    assert basis["vorgabe"]["saaten"] == 3 and basis["saaten"] == ["fixture", "11", "22"] and basis["referenzstreuung"]["leitwert"] is not None
    # Das Protokoll in Zeilen und der Stand.
    zeilen = (lauf.ordner / "protokoll.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(zeilen) == adapter.rechnungen and json.loads(zeilen[0])["typ"] == "kettengebirge"
    stand = json.loads((lauf.ordner / "stand.json").read_text(encoding="utf-8"))
    assert stand["status"] == "fertig" and stand["messungen"] == lauf.db.zaehle_messungen("ok")
    lauf.schliesse()


def test_ueberlagerung_im_auftrag_nur_die_abweichungen(tmp_path, monkeypatch):
    lauf, adapter, _ = neuer_lauf(tmp_path, monkeypatch)
    assert lauf.laufe(("basis", "sensitivitaet")) == 0
    vorgabe = [a for a in adapter.aufrufe if "ueberlagerung" not in a["rezept"]]
    assert vorgabe and all(a["reglerQuelle"] == "preset" and a["rezept"]["fassung"] == 19 and a["stufe"] == "vorschau" for a in adapter.aufrufe)
    mit = [a for a in adapter.aufrufe if "ueberlagerung" in a["rezept"]]
    assert mit
    for a in mit:
        preset = a["rezept"]["ueberlagerung"]["presets"]["typen"]["kettengebirge"]
        assert set(preset) <= {"werte", "rueckennetz", "muster"} and preset
    lauf.schliesse()


def test_grenze_haelt_an_und_fortsetzen_macht_dieselben_ergebnisse(tmp_path, monkeypatch):
    # Referenzlauf in einem Zug.
    a1 = OptAttrappe(tmp_path / "a")
    l1, _, _ = neuer_lauf(tmp_path / "a", monkeypatch, adapter=a1, name="eins")
    assert l1.laufe() == 0
    soll = json.loads(next(l1.ordner.glob("vorschlag-*.json")).read_text(encoding="utf-8"))["typen"]
    gesamt = a1.rechnungen
    l1.schliesse()
    # Derselbe Lauf mit einer Versuchsgrenze: hält an, ohne etwas zu verlieren, und macht in zwei weiteren Aufrufen weiter.
    a2 = OptAttrappe(tmp_path / "b")
    l2, _, cache = neuer_lauf(tmp_path / "b", monkeypatch, adapter=a2, profil={"grenzen": {"versuche": 25, "ram_min_mib": 0, "ram_warten_s": 0}}, name="zwei")
    assert l2.laufe() == EXIT_GESTOPPT
    assert a2.rechnungen == 25 and str(l2.db.meta("status")).startswith("gestoppt: Versuchsgrenze")
    stati = {p["name"]: p["status"] for p in l2.db.phasen()}
    assert stati["basis"] == "fertig" and "gestoppt" in stati.values() and not all(s == "fertig" for s in stati.values())
    ordner = l2.ordner
    l2.schliesse()
    codes = []
    for _ in range(40):
        weiter = Lauf.oeffne(ordner, a2, cache=cache, melde=lambda t: None)
        codes.append(weiter.laufe())
        weiter.schliesse()
        if codes[-1] == 0:
            break
    assert codes[-1] == 0 and len(codes) > 1
    # Nichts doppelt gerechnet: gleich viele Rechnungen wie in einem Zug; gleiches Ergebnis.
    assert a2.rechnungen == gesamt
    ist = json.loads(next(ordner.glob("vorschlag-*.json")).read_text(encoding="utf-8"))["typen"]
    assert ist == soll
    # Fertig und noch einmal: kein Rechnen mehr.
    nochmal = Lauf.oeffne(ordner, a2, cache=cache, melde=lambda t: None)
    assert nochmal.laufe() == 0 and a2.rechnungen == gesamt
    nochmal.schliesse()


def test_stop_datei_haelt_sauber_an_und_fortsetzen_loescht_sie(tmp_path, monkeypatch):
    referenzen(monkeypatch)
    ordner = tmp_path / "stoplauf"
    adapter = OptAttrappe(tmp_path, nach_rechnungen=10, stop_ordner=ordner)
    p = parse_profil(PROFIL)
    cache = Zwischenspeicher(tmp_path / "cache")
    lauf = Lauf.neu(p, adapter, ordner=ordner, cache=cache, melde=lambda t: None)
    assert lauf.laufe() == EXIT_GESTOPPT
    assert adapter.rechnungen == 10 and (ordner / "STOP").exists() and "STOP-Datei" in str(lauf.db.meta("status"))
    lauf.schliesse()
    weiter = Lauf.oeffne(ordner, adapter, cache=cache, melde=lambda t: None)
    adapter.nach_rechnungen = None
    assert weiter.laufe() == 0 and not (ordner / "STOP").exists()
    weiter.schliesse()


def test_budget_zeit_cpu_und_stop(tmp_path):
    b = Budget(tmp_path, {"zeit_s": 0.0})
    with pytest.raises(Gestoppt) as e:
        b.pruefe()
    assert e.value.art == "zeit"
    b = Budget(tmp_path, {"versuche": 1})
    b.pruefe()
    b.verbuche({"laeufe": [{"cpu_ms": 2000.0}]})
    assert b.verbraucht()["versuche"] == 1 and b.verbraucht()["cpu_s"] >= 2.0
    with pytest.raises(Gestoppt) as e:
        b.pruefe()
    assert e.value.art == "versuche"
    with pytest.raises(Gestoppt) as e:
        Budget(tmp_path, {"cpu_s": 0.0}).pruefe()
    assert e.value.art == "cpu"
    (tmp_path / "STOP").write_text("x")
    with pytest.raises(Gestoppt) as e:
        Budget(tmp_path, {}).pruefe()
    assert e.value.art == "stop"
    (tmp_path / "STOP").unlink()
    with pytest.raises(Gestoppt) as e:
        Budget(tmp_path, {"ram_min_mib": 10**9, "ram_warten_s": 0}).pruefe()
    assert e.value.art == "ram"
    Budget(tmp_path, {"ram_min_mib": 1, "ram_warten_s": 0}).pruefe()


def test_formtor_haelt_eingeebnete_kaemme_zurueck(tmp_path, monkeypatch):
    lauf, adapter, _ = neuer_lauf(tmp_path, monkeypatch)
    lauf.laufe(("basis",))
    aus = lauf.auswerter
    from terrainlab.optimierung.ranking import bewerte, vorgabe_zusammenfassung

    saaten = [None, 11]
    basis = vorgabe_zusammenfassung(aus, "kettengebirge", saaten)
    flach = bewerte(aus, "kettengebirge", {"v12.plateau": 1.0}, saaten, basis, 0.8)
    normal = bewerte(aus, "kettengebirge", {"v12.rauschen": 0.3}, saaten, basis, 0.8)
    assert not flach.tor_ok and any(v.startswith("grat") for v in flach.verstoesse)
    assert normal.tor_ok and normal.d1 is not None
    # Ein Kandidat, der das Tor hält, steht vor einem, der besser aussieht, aber das Tor verfehlt.
    a = Bewertet({}, "a", saaten, {}, True, [], 0.30, 0.1, 1.0)
    b = Bewertet({"x": 1}, "b", saaten, {}, False, ["x"], 0.05, 0.0, 1.0)
    assert [x.schluessel for x in ordne([b, a])] == ["a", "b"]
    lauf.schliesse()


def test_ordne_pareto_rang_vor_abstand_und_rauschen_gilt_als_gleich():
    nahe = Bewertet({}, "nahe", [], {}, True, [], 0.100, 0.30, 1.0)
    form = Bewertet({}, "form", [], {}, True, [], 0.150, 0.05, 1.0)
    dominiert = Bewertet({}, "dom", [], {}, True, [], 0.200, 0.40, 1.0)
    rauschen = Bewertet({}, "rausch", [], {}, True, [], 0.1005, 0.30, 1.0)
    erg = ordne([dominiert, rauschen, form, nahe])
    assert {x.schluessel for x in erg[:3]} == {"nahe", "form", "rausch"} and erg[-1].schluessel == "dom"
    assert erg[0].rang == 0 and erg[-1].rang == 1 and [x.schluessel for x in erg[:3]][0] == "nahe"


def test_strategien_ohne_kamm_verfehlen_das_formtor_und_werden_nie_empfohlen(tmp_path, monkeypatch):
    lauf, adapter, _ = neuer_lauf(tmp_path, monkeypatch)
    assert lauf.laufe() == 0
    st = lauf.db.phase("kettengebirge", "strategie")["daten"]
    assert set(st["strategien"]) == {"kaemme-rauschen", "kaemme-zellen", "ohne-kamm-rauschen", "ohne-kamm-zellen"}
    for name in ("ohne-kamm-rauschen", "ohne-kamm-zellen"):
        assert st["strategien"][name]["tor_erreichbar"] is False, "die Achse liegt 1,2 E neben der gezeichneten Linie"
        assert st["strategien"][name]["beste_ohne_tor"] is not None and st["strategien"][name]["beste_zulaessig"] is None
        assert st["strategien"][name]["parameter_aktiv"] and all(p.startswith("v12.") for p in st["strategien"][name]["parameter_aktiv"])
    assert st["empfehlung"]["name"].startswith("kaemme-") and st["urteil"]
    # Die Gebirgsdatei ohne Kamm besteht nur aus Gipfel und Regler.
    datei = json.loads((lauf.ordner / "gebirge" / "probe-ohne-kamm.json").read_text(encoding="utf-8"))
    assert "kaemme" not in datei["input"] and "nebengipfel" not in datei["input"] and datei["input"]["peaks"]
    lauf.schliesse()


def test_erzeuge_ohne_kamm(tmp_path):
    quelle = tmp_path / "q.json"
    quelle.write_text(json.dumps({**FIXTURE, "kaemmeLang": [1]}), encoding="utf-8")
    ziel = erzeuge_ohne_kamm(quelle, tmp_path / "x" / "z.json")
    j = json.loads(ziel.read_text(encoding="utf-8"))
    assert "kaemme" not in j["input"] and "kaemmeLang" not in j and j["input"]["regler"] == FIXTURE["input"]["regler"] and "ohne Kammnetz" in j["name"]
    assert "kaemme" in json.loads(quelle.read_text(encoding="utf-8"))["input"], "die Quelle bleibt unverändert"


def test_fassung_ohne_presets_bricht_ab(tmp_path, monkeypatch):
    referenzen(monkeypatch)

    class OhnePresets(OptAttrappe):
        def grenzen(self, *a, **k):
            g = super().grenzen()
            g["fassung_hat_presets"] = False
            return g

    lauf = Lauf.neu(parse_profil(PROFIL), OhnePresets(tmp_path), ordner=tmp_path / "x", cache=Zwischenspeicher(tmp_path / "cache"), melde=lambda t: None)
    with pytest.raises(ValueError, match="keine Gebirgs-Presets"):
        lauf.laufe()
    assert str(lauf.db.meta("status")).startswith("fehler")
    lauf.schliesse()


def test_lauf_nicht_zweimal_anlegen(tmp_path, monkeypatch):
    lauf, adapter, cache = neuer_lauf(tmp_path, monkeypatch)
    lauf.schliesse()
    with pytest.raises(FileExistsError):
        Lauf.neu(parse_profil(PROFIL), adapter, ordner=tmp_path / "lauf", cache=cache)
    with pytest.raises(FileNotFoundError):
        Lauf.oeffne(tmp_path / "gibt-es-nicht", adapter)


def test_befehle_stoppen_stand_und_vorschlag(tmp_path, monkeypatch, capsys):
    lauf, adapter, _ = neuer_lauf(tmp_path, monkeypatch, profil={"strategien": {"aktiv": False}, "validierung": {"beste": 0}})
    assert lauf.laufe() == 0
    ordner = lauf.ordner
    lauf.schliesse()
    assert main(["optimierung", "stoppen", str(ordner)]) == 0 and (ordner / "STOP").exists()
    capsys.readouterr()
    assert main(["optimierung", "stand", str(ordner)]) == 0
    ausgabe = capsys.readouterr().out
    assert "Status fertig" in ausgabe and "sensitivitaet" in ausgabe and "STOP angelegt" in ausgabe
    assert main(["optimierung", "vorschlag", str(ordner)]) == 0
    assert "kettengebirge (probe)" in capsys.readouterr().out
    assert main(["optimierung", "stoppen", str(tmp_path / "nichts")]) == 2
    assert main(["optimierung", "profile"]) == 0
    assert main(["optimierung", "starten", "gibt-es-nicht", "--trocken"]) == 2


def test_endgelaende_nur_wenn_das_profil_es_verlangt(tmp_path, monkeypatch):
    lauf, adapter, _ = neuer_lauf(tmp_path, monkeypatch, name="ohne")
    assert lauf.laufe() == 0
    assert not any(a["stufe"] == "endgelaende-lokal" for a in adapter.aufrufe), "ohne ausdrückliche Angabe im Profil nie"
    assert lauf.db.phase("kettengebirge", "endgelaende")["daten"] == {"aktiv": False}
    lauf.schliesse()
    profil = {"endgelaende": {"aktiv": True, "beste": 1, "schnappschuss": "C:/schnappschuss"}, "validierung": {"gewinn_min": -1.0, "beste": 2}}
    lauf2, adapter2, _ = neuer_lauf(tmp_path / "zwei", monkeypatch, profil=profil, adapter=OptAttrappe(tmp_path / "zwei"), name="mit")
    assert lauf2.laufe() == 0
    e = lauf2.db.phase("kettengebirge", "endgelaende")["daten"]
    auftraege = [a for a in adapter2.aufrufe if a["stufe"] == "endgelaende-lokal"]
    assert e["aktiv"] is True and auftraege and len(auftraege) <= 4  # Vorgabe und höchstens ein Kandidat, je Rolle ein Raster
    assert all(a["endgelaende"]["schnappschuss"] == "C:/schnappschuss" and "vorschau" not in a for a in auftraege)
    assert {k["name"] for k in e["kandidaten"]} >= {"vorgabe"} and all(k["d1"] is not None and k["wall_ms"] > 0 for k in e["kandidaten"])
    lauf2.schliesse()


def test_endgelaende_haelt_an_wenn_der_speicher_fehlt(tmp_path, monkeypatch):
    monkeypatch.setattr("terrainlab.optimierung.auswerter.arbeitsspeicher_mib", lambda: (2000.0, 32000.0))
    profil = {"endgelaende": {"aktiv": True, "beste": 1, "schnappschuss": "C:/schnappschuss"}, "validierung": {"gewinn_min": -1.0, "beste": 1}, "grenzen": {"zeit_s": 600, "ram_min_mib": 0, "ram_warten_s": 0}}
    lauf, adapter, _ = neuer_lauf(tmp_path, monkeypatch, profil=profil)
    assert lauf.laufe() == EXIT_GESTOPPT and "Arbeitsspeicher" in str(lauf.db.meta("status"))
    assert lauf.db.phase("kettengebirge", "endgelaende")["status"] == "gestoppt" and not any(a["stufe"] == "endgelaende-lokal" for a in adapter.aufrufe)
    lauf.schliesse()


def test_bedingt_wirksame_parameter_gelten_nicht_als_wirkungslos(tmp_path, monkeypatch):
    lauf, adapter, _ = neuer_lauf(tmp_path, monkeypatch, profil={"sensitivitaet": {"trajektorien": 1, "max_aktiv": 8}})
    assert lauf.laufe(("basis", "sensitivitaet")) == 0
    sens = lauf.db.phase("kettengebirge", "sensitivitaet")["daten"]["parameter"]
    for n, p in sens.items():
        if p["exakt_null"]:
            assert p["bestaetigung"] is not None, n
            assert (p["klasse"] == "wirkungslos") == (not p["bestaetigung"]["wirkt"]) and p["bedingt"] == p["bestaetigung"]["wirkt"], n
        else:
            assert p["bestaetigung"] is None and p["bedingt"] is False, n
    assert sens["netz.gratMin"]["klasse"] == "wirkungslos" and sens["netz.gratMin"]["bestaetigung"] == {"d1": 0.0, "form": 0.0, "wirkt": False}
    lauf.schliesse()


def test_waehle_aktiv_bestaetigte_wirkung_zaehlt():
    from terrainlab.optimierung.sensitivitaet import waehle_aktiv

    def zeile(mu_d1, mu_form, null=False, best=None):
        return {"n": 3, "d1": {"mu_stern": mu_d1, "mu": mu_d1, "sigma": 0.0}, "form": {"mu_stern": mu_form, "mu": mu_form, "sigma": 0.0}, "zeit": {"mu_stern": 0.0, "mu": 0.0, "sigma": 0.0},
                "exakt_null": null, "bestaetigung": best}

    ergebnis = {"parameter": {
        "stark": zeile(0.2, 0.2), "bedingt": zeile(0.0, 0.0, True, {"d1": 0.1, "form": 0.0, "wirkt": True}), "tot": zeile(0.0, 0.0, True, {"d1": 0.0, "form": 0.0, "wirkt": False}),
        "schwach": zeile(0.001, 0.0),
    }}
    erg = waehle_aktiv(ergebnis, 0.05, 10)
    p = erg["parameter"]
    assert p["tot"]["klasse"] == "wirkungslos" and p["tot"]["bedingt"] is False
    assert p["bedingt"]["bedingt"] is True and p["bedingt"]["klasse"] == "stark" and p["bedingt"]["wirkung"] == 0.5
    assert erg["aktiv"] == ["stark", "bedingt"] and p["schwach"]["klasse"] == "schwach"
