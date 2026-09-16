const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const locations = [{ publicId: 'a', description: '', wikiSettlement: { title: 'Neu' }, wikiUrl: 'neu' }, { publicId: 'b', description: '', wikiSettlement: { title: 'Neu' }, wikiUrl: 'neu' }];
let linked = false;
const events = [];
const markers = locations.map(location => ({ location, marker: { isPopupOpen: () => true, openPopup: () => events.push('open') } }));
const sandbox = {
    URL, Map, console, document: undefined,
    window: { location: { href: 'https://example.test/' },
        __featureSourceRefs: {}, __featureKanon: { vorgabe: 'offiziell', abweichungen: { 'settlement:a': { kanon: 'inoffiziell' }, 'settlement:b': { kanon: 'inoffiziell' }, 'settlement:fremd': { kanon: 'inoffiziell' } } },
        avesmapsRefreshInfopanel: () => events.push('panel') },
    MAP_FEATURES_API_URL: '/api/app/map-features.php', locationData: locations,
    findLocationMarkerByPublicId: id => markers.find(m => m.location.publicId === id),
    fetch: async () => ({ ok: true, json: async () => ({ ok: true,
        feature_kanon: { vorgabe: 'offiziell', abweichungen: {} },
        features: locations.map(l => ({ id: l.publicId, properties: { revision: 10,
            ...(linked ? { wiki_settlement: { title: 'Neu' }, wiki_url: 'https://example.test/wiki/Neu', coat: { url: '/uploads/wiki.png' } } : { description: 'Alte Beschreibung' }),
        } })),
    }) }),
    refreshLocationMarkerPopup: () => {
        for (const l of locations) {
            assert.strictEqual(l.description, linked ? '' : 'Alte Beschreibung');
            assert.strictEqual(l.wikiSettlement?.title || '', linked ? 'Neu' : '');
            assert.strictEqual(l.wikiUrl, linked ? 'https://example.test/wiki/Neu' : '');
            assert.strictEqual(l.coat?.url || '', linked ? '/uploads/wiki.png' : '');
        }
        assert.strictEqual(sandbox.resolveFeatureKanon('settlement', 'a')?.kanon || '', linked ? 'inoffiziell' : '');
        assert.strictEqual(sandbox.resolveFeatureKanon('settlement', 'b')?.kanon || '', linked ? 'offiziell' : '');
        assert.strictEqual(sandbox.resolveFeatureKanon('settlement', 'fremd').kanon, 'inoffiziell');
        events.push('popup');
    },
};
vm.createContext(sandbox);
for (const relative of ['../../app/utils.js', '../../ui/popups.js', '../review-panels-change-log.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, relative), 'utf8'), sandbox);
}
(async () => {
    const group = { kanon_je_kennung: { a: null, b: null }, revision: 10, fields: ['wiki_settlement'], features: locations.map(l => ({ public_id: l.publicId, revision: 10 })) };
    await sandbox.applyLocationGroupAuditResponse(group);
    assert.deepStrictEqual(events, ['popup', 'open', 'popup', 'open', 'panel']);
    linked = true; events.length = 0;
    group.kanon_je_kennung = { a: { kanon: 'inoffiziell' }, b: { kanon: 'offiziell' } };
    await sandbox.applyLocationGroupAuditResponse(group);
    assert.deepStrictEqual(events, ['popup', 'open', 'popup', 'open', 'panel']);
    assert.strictEqual(sandbox.formatChangeAction('link_wiki_location_group'), 'Orte mit Wiki-Artikeln verknüpft');
    assert.strictEqual(sandbox.formatChangeAction('undo_link_wiki_location_group'), 'Wiki-Verknüpfungen zurückgenommen');
    assert.strictEqual(sandbox.formatChangeAction('undo_undo_link_wiki_location_group'), 'Wiki-Verknüpfungen wiederhergestellt');
    const before = JSON.stringify([locations, sandbox.window.__featureKanon]);
    delete group.kanon_je_kennung.b; events.length = 0;
    await assert.rejects(sandbox.applyLocationGroupAuditResponse(group), /Quellenhinweise fehlen/);
    assert.strictEqual(JSON.stringify([locations, sandbox.window.__featureKanon]), before);
    assert.deepStrictEqual(events, []);
    console.log('OK: Wiki-Gruppen stellen Beschreibung, Artikel, Wappen und Kanon gemeinsam dar.');
})().catch(error => { console.error(error); process.exitCode = 1; });
