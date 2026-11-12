"""Parameterraum, Sobol, Morris, Speicher und Profil der Optimierung."""

import json

import numpy as np
import pytest

from terrainlab.optimierung.profil import PROFIL_ORDNER, ProfilFehler, lade_profil, parse_profil
from terrainlab.optimierung.raum import GANZ, STETIG, WAHL, Raum, morris_trajektorien, sobol
from terrainlab.optimierung.speicher import Speicher

GRENZEN = {
    "typen": ["kettengebirge", "karst"],
    "muster": ["rauschen", "zellen"],
    "v12": {
        "werte": ["erosion", "rauschen", "bergform"],
        "grenzen": {
            "erosion": {"min": 0, "max": 5, "schritt": 1, "gruppe": "form"},
            "rauschen": {"min": 0, "max": 1, "schritt": 0.01, "gruppe": "form"},
            "bergform": {"min": 0, "max": 12, "schritt": 0.1, "gruppe": "fein"},
        },
    },
    "rueckennetz": [
        {"id": "form.breite", "gruppe": "form", "min": 0.3, "max": 4, "schritt": 0.05},
        {"id": "struktur.welle", "gruppe": "struktur", "min": 2, "max": 40, "schritt": 1},
    ],
    "basis": {
        "kettengebirge": {"werte": {"erosion": 5, "rauschen": 0.5, "bergform": 2.5}, "muster": "rauschen", "rueckennetz": {"form.breite": 1.2, "struktur.welle": 12}},
        "karst": {"werte": {"erosion": 4, "rauschen": 0.94, "bergform": 10.5}, "muster": "rauschen", "rueckennetz": {"form.breite": 1.4, "struktur.welle": 7}},
    },
}


def raum(typ="kettengebirge", **kw):
    return Raum.aus_grenzen(GRENZEN, typ, **kw)


def test_raum_aus_den_vertraegen():
    r = raum()
    assert r.namen == ["v12.erosion", "v12.rauschen", "v12.bergform", "netz.form.breite", "netz.struktur.welle", "muster"]
    assert r["v12.erosion"].art == GANZ and r["netz.struktur.welle"].art == GANZ and r["v12.rauschen"].art == STETIG and r["muster"].art == WAHL
    assert r["netz.form.breite"].basis == 1.2 and raum("karst")["netz.form.breite"].basis == 1.4
    assert raum(ausschluss=["netz.*", "muster"]).namen == ["v12.erosion", "v12.rauschen", "v12.bergform"]
    with pytest.raises(KeyError):
        Raum.aus_grenzen(GRENZEN, "unbekannt")
    ohne = json.loads(json.dumps(GRENZEN))
    ohne["basis"]["karst"]["werte"] = None
    with pytest.raises(ValueError):
        Raum.aus_grenzen(ohne, "karst")


def test_wert_und_einheit_sind_eine_abbildung():
    r = raum()
    erosion, rauschen, muster = r["v12.erosion"], r["v12.rauschen"], r["muster"]
    assert [erosion.wert(u) for u in (0.0, 0.1, 0.5, 1.0)] == [0, 1, 2, 5] or erosion.wert(0.5) in (2, 3)
    assert isinstance(erosion.wert(0.7), int) and erosion.wert(1.0) == 5 and erosion.wert(-3) == 0
    assert rauschen.wert(0.333) == pytest.approx(0.33) and rauschen.wert(2.0) == 1.0
    assert muster.wert(0.1) == "rauschen" and muster.wert(0.9) == "zellen" and muster.wert(1.0) == "zellen"
    for p in r.parameter:
        w = p.wert(p.einheit(p.basis))
        assert p.gleich(w, p.basis) or p.art != WAHL, p.name
    assert rauschen.einheit(0.5) == pytest.approx(0.5) and muster.einheit("zellen") == pytest.approx(0.75)


def test_kandidat_besteht_nur_aus_abweichungen():
    r = raum()
    assert r.kandidat(r.vorgabe_einheiten()) == {}, "die Vorgabe selbst ist kein Kandidat"
    k = r.kandidat({"v12.erosion": 0.0, "v12.rauschen": 0.5, "muster": 0.9})
    assert k == {"v12.erosion": 0, "muster": "zellen"}, "Rauschen 0,5 ist die Vorgabe und entfällt"
    assert r.kandidat([0.2], ["v12.bergform"]) == {"v12.bergform": 2.4}
    assert r.kandidat({"v12.erosion": 1.0}, fest={"muster": "zellen"}) == {"muster": "zellen"}  # Erosion 5 = Vorgabe
    with pytest.raises(ValueError):
        r.kandidat([0.1, 0.2], ["v12.erosion"])


def test_ueberlagerung_in_der_form_von_19_test():
    r = raum()
    assert r.ueberlagerung({}) is None
    ue = r.ueberlagerung({"v12.erosion": 3, "netz.form.breite": 2.0, "muster": "zellen"})
    assert ue == {"presets": {"typen": {"kettengebirge": {"werte": {"erosion": 3}, "rueckennetz": {"form.breite": 2.0}, "muster": "zellen"}}}}
    with pytest.raises(ValueError):
        r.ueberlagerung({"v12.erosion": 2.5})  # nur ganze Zahlen
    with pytest.raises(ValueError):
        r.ueberlagerung({"v12.rauschen": 1.5})  # außerhalb der Grenzen
    with pytest.raises(ValueError):
        r.ueberlagerung({"muster": "lava"})


def test_schluessel_ist_stabil_und_unterscheidet_varianten():
    a = Raum.schluessel({"a": 1, "b": 2})
    assert a == Raum.schluessel({"b": 2, "a": 1}) and a != Raum.schluessel({"a": 1, "b": 3})
    assert Raum.schluessel({"a": 1}, "gezeichnet") != Raum.schluessel({"a": 1}, "ohne-kamm") and len(a) == 16


def test_sobol_ist_deterministisch_und_gleichmaessig():
    a, b = sobol(5, 32, seed=7), sobol(5, 32, seed=7)
    assert np.array_equal(a, b) and a.shape == (32, 5) and not np.array_equal(a, sobol(5, 32, seed=8))
    assert a.min() >= 0 and a.max() <= 1
    # Zweierpotenz: in jeder Achse genau gleich viele Punkte je Hälfte (ausgewogen).
    assert ((a < 0.5).sum(axis=0) == 16).all()
    assert sobol(0, 4, 1).shape == (4, 0)
    assert sobol(3, 5, 1).shape == (5, 3)


def test_morris_jeder_parameter_genau_einmal_um_delta():
    spuren = morris_trajektorien(6, 4, 4, seed=3)
    assert len(spuren) == 4
    delta = 4 / (2 * 3)
    for spur in spuren:
        assert len(spur) == 7
        geaendert = [i for _, i, _ in spur[1:]]
        assert sorted(geaendert) == list(range(6))
        for (vorher, _, _), (nachher, i, schritt) in zip(spur[:-1], spur[1:]):
            diff = nachher - vorher
            assert abs(schritt) == pytest.approx(delta) and diff[i] == pytest.approx(schritt)
            assert np.count_nonzero(np.abs(diff) > 1e-12) == 1
        assert all(0 <= p <= 1 for punkt, _, _ in spur for p in punkt)
    assert [s[0][0].tolist() for s in spuren] == [s[0][0].tolist() for s in morris_trajektorien(6, 4, 4, seed=3)]
    with pytest.raises(ValueError):
        morris_trajektorien(3, 1, 3, 1)


def test_wahl_wechselt_in_jedem_morris_schritt_die_stufe():
    p = raum()["muster"]
    for spur in morris_trajektorien(1, 20, 4, seed=1):
        (u0, _, _), (u1, _, _) = spur
        assert p.wert(u0[0]) != p.wert(u1[0])


def test_speicher_dauerhaft_und_ohne_doppelte(tmp_path):
    pfad = tmp_path / "x" / "lauf.sqlite"
    db = Speicher(pfad)
    db.setze_meta("commit", "abc")
    k1 = db.kandidat("karst", "gezeichnet", "h1", {"v12.erosion": 3}, "sobol")
    assert db.kandidat("karst", "gezeichnet", "h1", {"v12.erosion": 3}, "andere") == k1
    assert db.kandidat("karst", "ohne-kamm", "h1", {"v12.erosion": 3}, "sobol") != k1
    assert db.messung(k1, 1, "fixture", "optimierung") is None
    db.speichere_messung(k1, 1, "fixture", "optimierung", "ok", commit="c", fingerprint="f", auftrag={"a": 1}, werte={"d1": {"leitwert": 0.2}}, aus_cache=True, dauer_s=1.5)
    db.speichere_messung(k1, 1, "fixture", "validierung", "fehler", fehler="kaputt")
    db.setze_phase("karst", "suche", "fertig", {"x": [1, 2]})
    db.ereignis("meldung", "hallo")
    db.schliesse()
    neu = Speicher(pfad)
    assert neu.meta("commit") == "abc" and neu.meta("fehlt", 5) == 5
    m = neu.messung(k1, 1, "fixture", "optimierung")
    assert m["status"] == "ok" and m["werte"]["d1"]["leitwert"] == 0.2 and m["aus_cache"] is True and m["auftrag"] == {"a": 1}
    assert neu.messung(k1, 1, "fixture", "validierung")["status"] == "fehler"
    assert neu.zaehle_messungen() == 2 and neu.zaehle_messungen("ok") == 1
    assert neu.phase("karst", "suche")["daten"] == {"x": [1, 2]} and neu.phase("karst", "basis") is None
    assert [e["text"] for e in neu.ereignisse("meldung")] == ["hallo"]
    assert neu.kandidaten("karst", "gezeichnet")[0]["werte"] == {"v12.erosion": 3}
    # Überschreiben (derselbe Schlüssel) ersetzt, statt zu verdoppeln.
    neu.speichere_messung(k1, 1, "fixture", "validierung", "ok", werte={"d1": {"leitwert": 0.1}})
    assert neu.zaehle_messungen() == 2 and neu.messung(k1, 1, "fixture", "validierung")["werte"]["d1"]["leitwert"] == 0.1
    neu.schliesse()


MINI = {"name": "t", "commit": "HEAD", "typen": [{"typ": "karst", "gebirge": "trollzacken"}]}


def test_profil_vorgaben_und_pruefung():
    p = parse_profil(MINI)
    assert p.saaten == [None, 4711, 9173] and p.suche["kandidaten"] == 32 and p.validierung["aufloesungen"] == [2, 4] and p.fassung == 19
    assert p.saat_name(None) == "fixture" and p.saat_name(4711) == "4711"
    q = parse_profil({**MINI, "suche": {"kandidaten": 8, "verfeinerung": {"runden": 0}}, "grenzen": {"zeit_s": 60}})
    assert q.suche["kandidaten"] == 8 and q.suche["eta"] == 3 and q.suche["verfeinerung"] == {"runden": 0, "nachkommen": 6, "schritt": 0.15} and q.grenzen["zeit_s"] == 60 and q.grenzen["versuche"] == 600
    for kaputt in (
        {**MINI, "commit": ""}, {**MINI, "typen": []}, {**MINI, "typen": [{"typ": "karst"}]}, {**MINI, "unsinn": 1}, {**MINI, "suche": {"kandidaten": 0}},
        {**MINI, "suche": {"unsinn": 1}}, {**MINI, "saaten": [1, 1]}, {**MINI, "validierung": {"aufloesungen": [3]}}, {**MINI, "sensitivitaet": {"ebenen": 3}},
        {**MINI, "bewertung": {"tor_faktor": 2}}, {**MINI, "vorschau": {"talboden": "x"}}, {**MINI, "bewertung": {"plausibilitaet": {"zzz": 1}}},
        {**MINI, "typen": [{"typ": "karst", "gebirge": "A b"}]}, {**MINI, "suche": {"saaten": 9}}, {**MINI, "name": "a b"}, {**MINI, "commit": "-x"},
    ):
        with pytest.raises(ProfilFehler):
            parse_profil(kaputt)


def test_mitgelieferte_profile_sind_gueltig():
    dateien = sorted(PROFIL_ORDNER.glob("*.json"))
    assert dateien, "tools/terrain-lab/konfig enthält mindestens das Profil des Durchstichs"
    for d in dateien:
        p = lade_profil(d)
        assert p.name == d.stem
    with pytest.raises(ProfilFehler):
        lade_profil("gibt-es-nicht")


def test_vorschlagsdateien_im_repository_sind_gueltig():
    from pathlib import Path

    wurzel = Path(__file__).resolve().parents[1] / "vorschlaege"
    dateien = sorted(wurzel.glob("*.json"))
    assert dateien, "tools/terrain-lab/vorschlaege enthält den Vorschlag des Durchstichs"
    for d in dateien:
        j = json.loads(d.read_text(encoding="utf-8"))
        assert j["format"] == "avesmaps-terrainlab-vorschlag" and j["version"] == 1 and len(j["commit"]) == 40 and "keine Fassung" in j["hinweis"], d.name
        assert j["nach_wi_0249"] and d.stem.endswith(j["commit"][:12])
        for typ, e in j["typen"].items():
            assert e["status"] in ("bestaetigt", "vorgabe_bleibt") and e["begruendung"], (d.name, typ)
            if e["status"] == "bestaetigt":
                preset = e["ueberlagerung"]["presets"]["typen"][typ]
                assert set(preset) <= {"werte", "rueckennetz", "muster"} and preset, (d.name, typ)
                assert set(e["werte"]) <= {"v12", "netz", "muster"} and set(e["vorgabe"]) == set(e["werte"]), (d.name, typ)
            else:
                assert e["ueberlagerung"] is None and e["werte"] == {}
