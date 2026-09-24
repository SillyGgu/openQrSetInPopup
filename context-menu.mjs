// Mirrors the visibility and message rules used by SillyTavern's Quick Reply context menu.
export function getContextGroups(qr, message = qr.message ?? '', hierarchy = [], parentLabels = []) {
    const groups = [];
    for (const link of qr.contextList ?? []) {
        const set = link.set;
        if (!set?.qrList || hierarchy.includes(set)) continue;

        const ownSet = set.qrList.includes(qr);
        const nextHierarchy = [...hierarchy, set];
        const nextParentLabels = [...parentLabels, qr.label];
        const children = set.qrList
            .filter(child => ownSet ? child.isHidden && !!child.icon : !child.isHidden)
            .map(child => ({
                set,
                qr: child,
                message: (link.isChained && message && child.message ? `${message} | ` : '') + (child.message ?? ''),
                hierarchy: nextHierarchy,
                parentLabels: nextParentLabels,
            }));
        groups.push({ set, name: set.name, children });
    }
    return groups;
}

export function getQrSetReference(qr, api) {
    const command = qr?.message?.trim();
    const match = /^\/qr-set(?:[ \t]+visible=(?:true|false))?[ \t]+([^\r\n|]+)$/i.exec(command ?? '');
    if (!match) return null;
    const rawName = match[1].trim();
    const name = /^(["'])(.*)\1$/.exec(rawName)?.[2] ?? rawName;
    return api?.getSetByName?.(name) ?? null;
}

export function getPopupGroups(qr, api, message = qr.message ?? '', hierarchy = [], parentLabels = []) {
    const groups = getContextGroups(qr, message, hierarchy, parentLabels);
    const set = getQrSetReference(qr, api);
    if (set && !hierarchy.includes(set) && !groups.some(group => group.set === set)) {
        groups.push({
            set,
            name: set.name,
            children: set.qrList
                .filter(child => child !== qr && !child.isHidden)
                .map(child => ({
                    set,
                    qr: child,
                    message: child.message ?? '',
                    hierarchy: [...hierarchy, set],
                    parentLabels: [...parentLabels, qr.label],
                })),
        });
    }
    return groups;
}

export function resolveContextMessage(entry) {
    return entry.message.replace(/%%parent(-\d+)?%%/g, (_, index) =>
        entry.parentLabels.slice(Number.parseInt(index ?? '-1', 10))[0] ?? '');
}
