import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getContextGroups, getPopupGroups, getQrSetReference, resolveContextMessage } from './context-menu.mjs';

test('context groups follow ST visibility, chaining, parent labels, and cycle rules', () => {
    const root = { label: 'Root', message: '/echo root', contextList: [] };
    const child = { label: 'Child', message: '/echo %%parent%%', contextList: [] };
    const grandchild = { label: 'Grandchild', message: '%%parent-2%% / %%parent%%', contextList: [] };
    const childSet = { name: 'Children', qrList: [child] };
    const grandchildSet = { name: 'Grandchildren', qrList: [grandchild] };
    root.contextList.push({ set: childSet, isChained: true });
    child.contextList.push({ set: grandchildSet, isChained: false });
    child.contextList.push({ set: childSet, isChained: false });

    const childEntry = getContextGroups(root)[0].children[0];
    assert.equal(resolveContextMessage(childEntry), '/echo root | /echo Root');
    const grandGroups = getContextGroups(child, childEntry.message, childEntry.hierarchy, childEntry.parentLabels);
    assert.deepEqual(grandGroups.map(group => group.name), ['Grandchildren']);
    assert.equal(resolveContextMessage(grandGroups[0].children[0]), 'Root / Child');

    const hiddenWithIcon = { label: 'Menu', message: '/echo menu', isHidden: true, icon: 'fa-bars' };
    const hiddenWithoutIcon = { label: 'Library', isHidden: true, icon: '' };
    const visible = { label: 'Visible', isHidden: false };
    const ownSet = { name: 'Own', qrList: [root, hiddenWithIcon, hiddenWithoutIcon, visible] };
    root.contextList = [{ set: ownSet, isChained: false }];
    assert.deepEqual(getContextGroups(root)[0].children.map(entry => entry.qr.label), ['Menu']);
});

test('a QR containing only /qr-set to an existing set opens its visible children', () => {
    const folder = { label: 'Folder', message: '/qr-set "My Set"' };
    const visible = { label: 'Visible', message: '/echo hi', isHidden: false };
    const hidden = { label: 'Hidden', isHidden: true };
    const set = { name: 'My Set', qrList: [visible, hidden] };
    const api = { getSetByName: name => name === set.name ? set : null };

    assert.equal(getQrSetReference(folder, api), set);
    assert.deepEqual(getPopupGroups(folder, api)[0].children.map(entry => entry.qr), [visible]);
    assert.deepEqual(getPopupGroups(folder, api, folder.message, [set]), []);
    assert.equal(getQrSetReference({ message: '/qr-set My Set | /echo hi' }, api), null);
    assert.equal(getQrSetReference({ message: '/qr-set Missing' }, api), null);
});
