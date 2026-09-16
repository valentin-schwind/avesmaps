const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const locations = [{ publicId: 'a', coat: null }, { publicId: 'b', coat: { url: '/uploads/b.png' } }];
const markers = locations.map(location => ({ location, marker: { isPopupOpen: () => false } }));
let states = [{ url: '/uploads/a.png' }, null];
const events = [];
const sandbox = {
    URL, Map, console, document: undefined,
    window: { location: { href: 'https://example.test/' }, avesmapsRefreshInfopanel: () => events.push('panel') },
    MAP_FEATURES_API_URL: '/api/app/map-features.php', locationData: locations,
    findLocationMarkerByPublicId: id => markers.find(m => m.location.publicId === id),
    fetch: async () => ({ ok: true, json: async () => ({ ok: true, features: locations.map((l, i) => ({
        id: l.publicId, properties: { revision: 10, ...(states[i] ? { coat: states[i] } : {}) },
    })) }) }),
    refreshLocationMarkerPopup: () => { assert.deepStrictEqual(locations.map(l => l.coat), states); events.push('popup'); },
    syncLocationNameLabelVisibility: () => { assert.deepStrictEqual(locations.map(l => l.coat), states); events.push('labels'); },
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../review-panels-change-log.js'), 'utf8'), sandbox);
(async () => {
    const group = { revision: 10, fields: ['coat'], features: locations.map(l => ({ public_id: l.publicId, revision: 10 })) };
    await sandbox.applyLocationGroupAuditResponse(group);
    assert.deepStrictEqual(events, ['popup', 'popup', 'panel']);
    states = [null, { url: '/uploads/b.png' }]; events.length = 0;
    await sandbox.applyLocationGroupAuditResponse(group);
    assert.deepStrictEqual(locations.map(l => l.coat), states);
    assert.deepStrictEqual(events, ['popup', 'popup', 'panel']);
    assert.strictEqual(sandbox.formatChangeAction('set_coat_location_group'), 'Wiki-Wappen für Orte übernommen');
    assert.strictEqual(sandbox.formatChangeAction('undo_set_coat_location_group'), 'Wappenübernahme zurückgenommen');
    assert.strictEqual(sandbox.formatChangeAction('undo_undo_set_coat_location_group'), 'Wappenübernahme wiederhergestellt');
    console.log('OK: Wappengruppe aktualisiert alle Ortsdaten vor Popup und Infopanel.');
})().catch(error => { console.error(error); process.exitCode = 1; });
