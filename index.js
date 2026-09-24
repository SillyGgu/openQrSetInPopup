import { saveSettingsDebounced } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { getPopupGroups, getQrSetReference, resolveContextMessage } from './context-menu.mjs';

const extensionName = 'openQrSetInPopup';
const DEFAULT_POS = { top: 100, left: 100 };
const DEFAULT_SIZE = { width: 400, height: 250 };
const DEFAULT_THEME_COLOR = '#64B5F6'; 

let settings;
let popupRequestId = 0;
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`; 

// =================================================================================
// 1. QR API 준비 대기
// =================================================================================
async function getQrApi() {
    if (globalThis.quickReplyApi) return globalThis.quickReplyApi;
    for (let attempt = 0; attempt < 50; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (globalThis.quickReplyApi) return globalThis.quickReplyApi;
    }
    throw new Error('Quick Reply API를 사용할 수 없습니다. Quick Replies가 활성화되어 있는지 확인하세요.');
}

async function copyToClipboard(text) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }
    const input = document.createElement('textarea');
    input.value = text;
    input.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.append(input);
    input.select();
    try {
        if (!document.execCommand('copy')) throw new Error('Clipboard copy was denied');
    } finally {
        input.remove();
    }
}

// =================================================================================
// 2. 스크립트 버튼 복구 (안전장치)
// =================================================================================
function restoreScriptButtons() {
    const $popupContent = $('#qr-popup-content');

    $popupContent.find('.qr-inline-submenu').remove();

    $popupContent.find('[data-origin-type="script"][data-origin-id]').each(function() {
        const $btn = $(this);
        $btn.children('.qr-popup-context-toggle').remove();
        $btn.children('.qr-script-location-toggle').remove();
        $btn.removeClass('qr-popup-managed');
        const originId = $btn.attr('data-origin-id');
        const $originContainer = $(document.getElementById(originId));
        if ($originContainer.length) {
            $originContainer.append($btn);
        }
        $btn.removeAttr('data-origin-id').removeAttr('data-origin-type');
    });

}

function scriptButtonKey(button, containerId, index, api, qrByDom) {
    const $button = $(button);
    const existing = $button.attr('data-qr-popup-key');
    if (existing) return existing;
    const qr = qrByDom.get(button);
    const set = qr && api.getSetByQr?.(qr);
    const key = set && qr?.id != null
        ? `qr:${set.name}:${qr.id}`
        : `button:${containerId}:${index}:${$button.find('.qr--button-label').text().trim()}`;
    $button.attr('data-qr-popup-key', key);
    return key;
}

function getScriptButtonLabel(button, qr) {
    const $button = $(button);
    return [
        qr?.label,
        $button.find('.qr--button-label').text(),
        $button.text(),
        $button.attr('aria-label'),
        $button.attr('title'),
        $button.attr('id'),
    ].find(value => typeof value === 'string' && value.trim())?.trim() || '이름 없는 버튼';
}

function isOriginalScriptButton(button) {
    return !!settings.originalScriptButtons?.[$(button).attr('data-qr-popup-key')];
}

function setOriginalScriptButton(key, enabled) {
    if (enabled) settings.originalScriptButtons[key] = true;
    else delete settings.originalScriptButtons[key];
    syncScriptButtonLocations();
    if ($('#qr-popup-container').is(':visible') && $('#qr-popup-header-title').text() === '스크립트 도구') {
        openScriptPopup(true);
    }
    updateToolbarButtonVisibility();
    refreshScriptButtonSettings();
    saveSettingsDebounced();
}

function addScriptLocationToggle($row, sourceButton) {
    const key = $(sourceButton).attr('data-qr-popup-key');
    if (!key) return;
    const $toggle = $('<button type="button" class="qr-toggle-switch qr-script-location-toggle" role="switch" aria-label="원래 위치에 표시" title="원래 위치에 표시"><span class="qr-toggle-slider"></span></button>')
        .attr('aria-checked', String(isOriginalScriptButton(sourceButton)));
    $toggle.on('click', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        setOriginalScriptButton(key, $toggle.attr('aria-checked') !== 'true');
    });
    $row.append($toggle);
}

function syncScriptButtonLocations() {
    const api = globalThis.quickReplyApi;
    let qrByDom = new WeakMap();
    try {
        if (api) qrByDom = indexQrButtons(api);
    } catch (error) {
        console.warn(`[${extensionName}] QR 버튼 위치 정보를 불러오지 못했습니다.`, error);
    }
    getSecondaryQrGroups().each(function(groupIndex) {
        const $group = $(this);
        $group.find('.qr--button').each(function(index) {
            scriptButtonKey(this, this.closest('[id^="script_container_"]')?.id || `secondary-${groupIndex}`, index, api, qrByDom);
            $(this).toggleClass('qr-popup-original', isOriginalScriptButton(this));
        });
        $group.toggleClass('qr-popup-original-group', $group.find('.qr--button.qr-popup-original').length > 0);
    });
    $('div[id^="script_container_"]').each(function() {
        const $container = $(this);
        $container.find('.qr--button').each(function(index) {
            scriptButtonKey(this, $container.attr('id'), index, api, qrByDom);
            $(this).toggleClass('qr-popup-original', isOriginalScriptButton(this));
        });
        $container.toggleClass('qr-popup-original-group', $container.find('.qr--button.qr-popup-original').length > 0);
    });
}

function refreshScriptButtonSettings() {
    const $list = $('#qr_popup_original_buttons');
    if (!$list.length) return;
    const buttons = new Set([
        ...getSecondaryQrGroups().find('.qr--button').toArray(),
        ...$('div[id^="script_container_"] .qr--button').toArray(),
    ]);
    $list.empty();
    let shown = 0;
    const seenKeys = new Set();
    for (const button of buttons) {
        const key = $(button).attr('data-qr-popup-key');
        if (!key || seenKeys.has(key)) continue;
        seenKeys.add(key);
        shown++;
        const label = getScriptButtonLabel(button);
        const $row = $('<label class="qr-script-location-row"></label>');
        const $input = $('<input type="checkbox">').val(key).prop('checked', isOriginalScriptButton(button));
        $row.append($('<span></span>').text(label), $('<span class="qr-toggle-switch"></span>').append($input, '<span class="qr-toggle-slider"></span>'));
        $list.append($row);
    }
    if (!shown) $list.append('<small>표시할 스크립트 도구 버튼이 없습니다.</small>');
}

function updateToolbarButtonVisibility() {
    const $btn = $('#qr-helper-toolbar-btn');

    const buttonsInContainers = $('div[id^="script_container_"] .qr--button').length;
    const chatQrButtonsInBar = getSecondaryQrGroups().find('.qr--button').length;

    if (buttonsInContainers + chatQrButtonsInBar > 0) {
        $btn.show();
    } else {
        $btn.hide();
    }
}
function initScriptObserver() {
    $('body').addClass('qr-extension-active');
    syncScriptButtonLocations();
    updateToolbarButtonVisibility();

    const sendForm = document.getElementById('send_form');
    if (!sendForm) return;

    let updateQueued = false;
    const observer = new MutationObserver(mutations => {
        const relevant = mutations.some(({ addedNodes, removedNodes }) =>
            [...addedNodes, ...removedNodes].some(node => node.nodeType === 1 &&
                (node.matches('.qr--button, .qr--buttons, [id^="script_container_"]') ||
                 node.querySelector('.qr--button, .qr--buttons, [id^="script_container_"]'))));
        if (!relevant || updateQueued) return;
        updateQueued = true;
        queueMicrotask(() => {
            updateQueued = false;
            syncScriptButtonLocations();
            updateToolbarButtonVisibility();
            refreshScriptButtonSettings();
        });
    });
    observer.observe(sendForm, { childList: true, subtree: true });
}

function getSecondaryQrGroups() {
    const $holder = $('#qr--bar').length ? $('#qr--bar') : $('#qr--popout .qr--body');
    const $directGroups = $holder.children('.qr--buttons');
    const $groups = $directGroups.length === 1 && $directGroups.first().children('.qr--buttons').length
        ? $directGroups.first().children('.qr--buttons')
        : $directGroups;
    return $groups.slice(1).filter(function() {
        return !this.id?.startsWith('script_container_');
    });
}

function reportQrError(error) {
    console.error(`[${extensionName}] QR 실행 실패:`, error);
    window.toastr?.error('QR 실행에 실패했습니다.');
}

function addContextToggle($row, state) {
    if (getPopupGroups(state.qr, state.api, state.message, state.hierarchy, state.parentLabels).length === 0) return;

    const $toggle = $('<button type="button" class="qr-popup-context-toggle" aria-expanded="false" aria-label="하위 QR 펼치기">▾</button>');
    $toggle.on('click', function(event) {
        event.stopPropagation();
        event.preventDefault();

        const $existing = $row.next('.qr-inline-submenu');
        if ($existing.length) {
            $existing.remove();
            $toggle.attr({ 'aria-expanded': 'false', 'aria-label': '하위 QR 펼치기' });
            return;
        }

        const $submenu = $('<div class="qr-inline-submenu" role="group"></div>');
        for (const group of getPopupGroups(state.qr, state.api, state.message, state.hierarchy, state.parentLabels)) {
            $submenu.append($('<div class="qr-context-set-name"></div>').text(group.name));
            for (const entry of group.children) {
                const $child = $('<div class="popup-qr-button qr-submenu-item"></div>')
                    .attr('title', entry.qr.title || entry.qr.message || entry.qr.label);
                const $icon = $('<div class="qr--button-icon fa-solid"></div>').addClass(entry.qr.icon || 'qr--hidden');
                $child.append($icon, $('<div class="qr--button-label"></div>').text(entry.qr.label));
                $child.on('click', event => {
                    event.stopPropagation();
                    if (getQrSetReference(entry.qr, state.api) && $child.children('.qr-popup-context-toggle').length) {
                        $child.children('.qr-popup-context-toggle').trigger('click');
                        return;
                    }
                    Promise.resolve()
                        .then(() => entry.set.execute(entry.qr, resolveContextMessage(entry)))
                        .catch(reportQrError);
                });
                addContextToggle($child, { ...entry, api: state.api });
                $submenu.append($child);
            }
        }
        $row.after($submenu);
        $toggle.attr({ 'aria-expanded': 'true', 'aria-label': '하위 QR 접기' });
    });
    $row.append($toggle);
}

function indexQrButtons(api) {
    const byDom = new WeakMap();
    for (const name of api.listSets?.() ?? []) {
        for (const qr of api.getSetByName(name)?.qrList ?? []) {
            if (qr.dom) byDom.set(qr.dom, qr);
        }
    }
    return byDom;
}
// =================================================================================
// 3. 팝업 UI 생성
// =================================================================================
function createQrPopup() {
    const popupHTML = `
        <div id="qr-popup-container" style="display: none;">
            <div id="qr-popup-header">
                <span id="qr-popup-header-title">Quick Reply Set</span>
                <button id="qr-popup-close-btn" title="닫기"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div id="qr-popup-content">
            </div>
        </div>
    `;

    $('body').append(popupHTML);

    const $popup = $('#qr-popup-container');
    const $header = $('#qr-popup-header');
    const $closeBtn = $('#qr-popup-close-btn');

    $popup.css({
        top: settings.pos.top,
        left: settings.pos.left,
        width: settings.width,
        height: settings.height,
    });

    if (settings.lockSize) {
        $popup.addClass('no-resize');
    }

    $closeBtn.on('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        popupRequestId++;
        $('#qr-popup-content').find('.qr-inline-submenu').remove();
        $('.list-group.ctx-menu').remove();
        restoreScriptButtons();
        $popup.hide();
        $('#qr-popup-content').empty();
    });
    setupDragAndResize($popup, $header);
	
}

// =================================================================================
// 4. 리사이즈 및 드래그
// =================================================================================
function applyPopupLayout($popup) {
    if (settings.mobileMode) {
        $popup.addClass('mobile-layout').css({ top: '', left: '', width: '', height: '' });
        return;
    }
    const width = Math.min(settings.width, window.innerWidth);
    const height = Math.min(settings.height, window.innerHeight);
    $popup.removeClass('mobile-layout').css({
        top: Math.max(0, Math.min(settings.pos.top, window.innerHeight - height)),
        left: Math.max(0, Math.min(settings.pos.left, window.innerWidth - width)),
        width,
        height,
    });
}

function setupDragAndResize($popup, $header) {
    let isDragging = false;
    let offsetX, offsetY;
    let maxX, maxY;
    const $window = $(window);

    $header.on('mousedown', function(e) {
        if ($(e.target).closest('#qr-popup-close-btn').length) return;
        if (settings.mobileMode) return;

        isDragging = true;
        const rect = $popup[0].getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        maxX = Math.max(0, window.innerWidth - rect.width);
        maxY = Math.max(0, window.innerHeight - rect.height);
        $popup.addClass('grabbing').css('cursor', 'grabbing');
        e.preventDefault();
    });

    $window.on('mousemove', function(e) {
        if (!isDragging) return;
        let newX = e.clientX - offsetX;
        let newY = e.clientY - offsetY;

        newX = Math.max(0, Math.min(newX, maxX));
        newY = Math.max(0, Math.min(newY, maxY));

        $popup.css({ top: newY, left: newX });

        settings.pos.top = newY;
        settings.pos.left = newX;
    });

    $window.on('mouseup', function() {
        if (isDragging) {
            isDragging = false;
            $popup.removeClass('grabbing').css('cursor', 'grab');

            saveSettingsDebounced();
        }
    });

    let isResizingByUser = false;
    $popup[0].addEventListener('mousedown', function(e) {
        if (settings.lockSize || settings.mobileMode) return;
        const rect = $popup[0].getBoundingClientRect();
        isResizingByUser = e.clientX >= rect.right - 16 || e.clientY >= rect.bottom - 16;
    });
    $window.on('mouseup.qr-resize', function() {
        if (isResizingByUser) {
            settings.width = Math.round($popup.outerWidth());
            settings.height = Math.round($popup.outerHeight());
            saveSettingsDebounced();
        }
        isResizingByUser = false;
    });
    $window.on('resize', () => {
        if ($popup.is(':visible') && !settings.mobileMode) applyPopupLayout($popup);
    });
}

// =================================================================================
// 5. 일반 QR 세트 팝업 (복사 기능 추가)
// =================================================================================
async function openQrSetPopup(command) {
    const requestId = ++popupRequestId;
    restoreScriptButtons(); 

    const setName = command.substring('/qr-set '.length).trim();
    const $popup = $('#qr-popup-container');
    const $popupContent = $('#qr-popup-content');

    applyPopupLayout($popup);
    $popup.css('display', 'flex');

    $('#qr-popup-header-title').text(setName);
    $popupContent.empty();
    $popupContent.prepend($('<p class="qr-placeholder">QR 세트 로딩 중...</p>'));


    try {
            const api = await getQrApi();
            if (requestId !== popupRequestId) return;
            const qrSet = api.getSetByName(setName);
            const visibleQrs = qrSet?.qrList?.filter(qr => !qr.isHidden) || [];
            if (visibleQrs.length === 0) {
                $popupContent.empty();
                $popupContent.prepend($('<p class="qr-placeholder">이 QR 세트 폴더는 비어 있거나 찾을 수 없습니다.</p>'));
                return;
            }

            $popupContent.empty();
            const buttons = document.createDocumentFragment();
            visibleQrs.forEach(qr => {
                const $button = $('<div class="popup-qr-button">');
                $button.attr('title', qr.title || qr.message || qr.label);
                const folderSet = getQrSetReference(qr, api);
                
                const $icon = $('<div class="qr--button-icon fa-solid"></div>');
                $icon.addClass(qr.icon || 'qr--hidden');
                const $label = $(`<div class="qr--button-label"></div>`).text(qr.label);
                
                const $copyBtn = $('<div class="qr-copy-btn" title="내용 복사"><i class="fa-solid fa-copy"></i></div>');

                $copyBtn.on('click', function(e) {
                    e.stopPropagation(); 
                    e.preventDefault();
                    
                    const contentToCopy = qr.message; 
                    
                    if (contentToCopy) {
                        copyToClipboard(contentToCopy).then(() => {
                            if (window.toastr) {
                                window.toastr.success('클립보드에 복사되었습니다.', 'QR 복사 완료');
                            } else {
                                alert('복사되었습니다!');
                            }
                            
                            const $icon = $(this).find('i');
                            $icon.removeClass('fa-copy').addClass('fa-check');
                            setTimeout(() => {
                                $icon.removeClass('fa-check').addClass('fa-copy');
                            }, 1000);
                        }).catch(err => {
                            console.error('복사 실패:', err);
                            if (window.toastr) window.toastr.error('복사에 실패했습니다.');
                        });
                    } else {
                        if (window.toastr) window.toastr.warning('복사할 내용이 없습니다 (Execute 전용 QR일 수 있음).');
                    }
                });

                $button.append($icon, $label);
                if (!folderSet) $button.append($copyBtn);
                addContextToggle($button, { qr, api, message: qr.message ?? '', hierarchy: [], parentLabels: [] });

                $button.on('click', function(e) {
                    e.stopPropagation();
                    e.preventDefault();
                    if (folderSet && $button.children('.qr-popup-context-toggle').length) {
                        $button.children('.qr-popup-context-toggle').trigger('click');
                        return;
                    }
                    api.executeQuickReply(qrSet.name, Number.isInteger(qr.id) ? qr.id : qr.label)
                        .catch(error => {
                            console.error(`[${extensionName}] QR 실행 실패:`, error);
                            window.toastr?.error('QR 실행에 실패했습니다.');
                        });
                });
                
                buttons.append($button[0]);
            });
            $popupContent.append(buttons);
    } catch (error) {
            if (requestId !== popupRequestId) return;
            console.error(`[${extensionName}] QR 세트 로드 중 오류:`, error);
            $popupContent.empty();
            $popupContent.prepend($('<p class="qr-error">QR 세트 로드 중 오류 발생. 콘솔 확인.</p>'));
    }
}

// =================================================================================
// 6. 스크립트 도구 팝업 (토글 기능)
// =================================================================================
function createScriptPopupRow(button, originType, qrByDom, api) {
    const $original = $(button);
    const qr = qrByDom.get(button);
    const $row = $('<div class="popup-qr-button"></div>').attr('data-origin-type', originType);
    const iconClass = $original.find('.qr--button-icon').attr('class') || '';
    $row.append(
        $('<div></div>').addClass(iconClass),
        $('<div class="qr--button-label"></div>').text(getScriptButtonLabel(button, qr)),
    );
    if (qr) {
        addContextToggle($row, { qr, api, message: qr.message ?? '', hierarchy: [], parentLabels: [] });
    } else if ($original.hasClass('qr--hasCtx')) {
        const $fallback = $('<button type="button" class="qr-popup-context-toggle" aria-label="기본 메뉴 열기">⋮</button>');
        $fallback.on('click', event => {
            event.stopPropagation();
            $original.find('.qr--button-expander')[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        $row.append($fallback);
    }
    addScriptLocationToggle($row, button);
    $row.on('click', event => {
        event.stopPropagation();
        if (qr && getQrSetReference(qr, api) && $row.children('.qr-popup-context-toggle').length) {
            $row.children('.qr-popup-context-toggle').trigger('click');
            return;
        }
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    return $row;
}

function openScriptPopup(refresh = false) {
    popupRequestId++;
    const $popup = $('#qr-popup-container');
    const $headerTitle = $('#qr-popup-header-title');
    if (!refresh && $popup.is(':visible') && $headerTitle.text() === '스크립트 도구') {
        $('#qr-popup-close-btn').click();
        return;
    }

    restoreScriptButtons();
    syncScriptButtonLocations();
    const $popupContent = $('#qr-popup-content');
    applyPopupLayout($popup);
    $popup.css('display', 'flex');
    $headerTitle.text('스크립트 도구');
    $popupContent.empty();
    const api = globalThis.quickReplyApi;
    let qrByDom = new WeakMap();
    try {
        if (api) qrByDom = indexQrButtons(api);
    } catch (error) {
        console.warn(`[${extensionName}] QR 데이터를 불러오지 못해 기본 메뉴를 사용합니다.`, error);
    }

    getSecondaryQrGroups().each(function() {
        $(this).find('.qr--button').each(function() {
            $popupContent.append(createScriptPopupRow(this, 'chatqr', qrByDom, api));
        });
    });

    const $firstChatQr = $popupContent.children('[data-origin-type="chatqr"]').first();
    $('div[id^="script_container_"]').each(function() {
        $(this).find('.qr--button').each(function() {
            const $row = createScriptPopupRow(this, 'script', qrByDom, api);
            if ($firstChatQr.length) $firstChatQr.before($row);
            else $popupContent.append($row);
        });
    });
}
function getHelperReplacementSettings() {
    if (!settings.helperReplacement || typeof settings.helperReplacement !== 'object') {
        settings.helperReplacement = {};
    }

    if (typeof settings.helperReplacement.charName !== 'string') {
        settings.helperReplacement.charName = '';
    }

    if (typeof settings.helperReplacement.userName !== 'string') {
        settings.helperReplacement.userName = '';
    }

    return settings.helperReplacement;
}

function replacePlaceholdersWithSavedNames(text) {
    const replacements = getHelperReplacementSettings();
    const charName = replacements.charName.trim();
    const userName = replacements.userName.trim();

    return text
        .replaceAll('{{char}}', charName || '{{char}}')
        .replaceAll('{{user}}', userName || '{{user}}');
}

// =================================================================================
// 6.5. QR 도우미 팝업
// =================================================================================
function openQrHelperPopup() {
    popupRequestId++;
    const $popup = $('#qr-popup-container');
    const $headerTitle = $('#qr-popup-header-title');
    
    if ($popup.is(':visible') && $headerTitle.text() === "QR 도우미") {
        $('#qr-popup-close-btn').click();
        return;
    }

    restoreScriptButtons(); 

    const $popupContent = $('#qr-popup-content');

    applyPopupLayout($popup);
    $popup.css('display', 'flex');
    $headerTitle.text("QR 도우미");

    // chatqr 포함 전부 제거, Chat QR 버튼 없이 도우미 전용 내용만 표시
    $popupContent.empty();

    const $swapSection = $('<div class="qr-helper-section">');
    $swapSection.append('<div class="qr-helper-label">플레이스홀더 치환</div>');
    
    const $swapBtn = $('<button class="qr-helper-action-btn"><i class="fa-solid fa-right-left"></i> {{char}} ↔ {{user}} 변환</button>');
    
    $swapBtn.on('click', function() {
        const $textarea = $('#send_textarea');
        let text = $textarea.val();

        if (!text) {
            if (window.toastr) window.toastr.warning('입력창이 비어있습니다.');
            return;
        }

        if (text.includes('{{char}}') || text.includes('{{user}}')) {
            text = text.replace(/\{\{char\}\}|\{\{user\}\}/g, match =>
                match === '{{char}}' ? '{{user}}' : '{{char}}');

            $textarea.val(text);
            $textarea.trigger('input'); 

            if (window.toastr) window.toastr.success('치환 완료!');
        } else {
            if (window.toastr) window.toastr.info('변환할 태그({{char}}, {{user}})가 없습니다.');
        }
    });
    $swapSection.append($swapBtn);
    $popupContent.append($swapSection);

    const savedReplacements = getHelperReplacementSettings();
    const $nameReplaceSection = $('<div class="qr-helper-section">');
    $nameReplaceSection.append('<div class="qr-helper-label">플레이스홀더 이름 치환</div>');

    const $nameReplaceInputs = $('<div class="qr-helper-name-grid"></div>');
    const $charField = $('<label class="qr-helper-name-field"><span>{{char}}</span><input type="text" class="text_pole" data-qr-helper-name="charName" placeholder="{{char}} 유지"></label>');
    const $userField = $('<label class="qr-helper-name-field"><span>{{user}}</span><input type="text" class="text_pole" data-qr-helper-name="userName" placeholder="{{user}} 유지"></label>');
    const $charInput = $charField.find('input').val(savedReplacements.charName);
    const $userInput = $userField.find('input').val(savedReplacements.userName);

    $nameReplaceInputs.append($charField, $userField);

    $nameReplaceInputs.on('input', 'input[data-qr-helper-name]', function() {
        const key = $(this).attr('data-qr-helper-name');
        getHelperReplacementSettings()[key] = $(this).val();
        saveSettingsDebounced();
    });

    const $nameReplaceBtn = $('<button class="qr-helper-action-btn"><i class="fa-solid fa-pen-to-square"></i> 입력창의 {{char}} / {{user}} 치환</button>');
    $nameReplaceBtn.on('click', function() {
        const $textarea = $('#send_textarea');
        const text = $textarea.val();

        if (!text) {
            if (window.toastr) window.toastr.warning('입력창이 비어있습니다.');
            return;
        }

        if (!text.includes('{{char}}') && !text.includes('{{user}}')) {
            if (window.toastr) window.toastr.info('치환할 태그({{char}}, {{user}})가 없습니다.');
            return;
        }

        savedReplacements.charName = $charInput.val();
        savedReplacements.userName = $userInput.val();
        saveSettingsDebounced();

        const replacedText = replacePlaceholdersWithSavedNames(text);
        $textarea.val(replacedText);
        $textarea.trigger('input');

        if (window.toastr) window.toastr.success('이름 치환 완료!');
    });

    $nameReplaceSection.append($nameReplaceInputs, $nameReplaceBtn);
    $popupContent.append($nameReplaceSection);

    const $langSection = $('<div class="qr-helper-section">');
    $langSection.append('<div class="qr-helper-label">언어 지정 프롬프트 복사</div>');
    
    const languages = [
        { label: 'English', text: 'respond in ENGLISH!' },
        { label: 'Japanese', text: 'respond in JAPANESE!' },
        { label: 'Korean', text: 'respond in KOREAN!' },
        { label: 'Chinese', text: 'respond in CHINESE!' }
    ];

    const $langGrid = $('<div class="qr-lang-grid"></div>');

    languages.forEach(lang => {
        const $btn = $(`<button class="qr-lang-btn">${lang.label}</button>`);
        $btn.on('click', function() {
            copyToClipboard(lang.text).then(() => {
                if (window.toastr) window.toastr.success(`"${lang.text}" 복사 완료`);
                
                const originalText = $btn.text();
                $btn.text('Copied!');
                $btn.addClass('copied');
                setTimeout(() => {
                    $btn.text(originalText);
                    $btn.removeClass('copied');
                }, 1000);
            }).catch(error => {
                console.error(`[${extensionName}] 복사 실패:`, error);
                window.toastr?.error('복사에 실패했습니다.');
            });
        });
        $langGrid.append($btn);
    });

    $langSection.append($langGrid);
    $popupContent.append($langSection);

}

// =================================================================================
// 플로팅 버튼 생성 (#send_form 기준 절대 위치)
// =================================================================================
function createToolbarButton() {
    const $sendForm = $('#send_form');
    if ($sendForm.css('position') === 'static') {
        $sendForm.css('position', 'relative');
    }

    if ($('#qr-helper-toolbar-btn').length === 0) {
        const $btn = $(`<div id="qr-helper-toolbar-btn" title="스크립트 도구" style="display: none;"><i class="fa-solid fa-boxes-stacked"></i></div>`);
        $sendForm.append($btn);

        $btn.on('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            openScriptPopup();
        });
    }

    createQrHelperButton();

    updateToolbarButtonVisibility();
}

function createQrHelperButton() {
    const $sendForm = $('#send_form');
    const btnId = 'qr-helper-extra-btn';

    if (!settings.showQrHelper) {
        $(`#${btnId}`).remove();
        return;
    }

    if ($(`#${btnId}`).length) return; 

    const $btn = $(`<div id="${btnId}" title="QR 도우미"><i class="fa-solid fa-wand-magic-sparkles"></i></div>`);
    $sendForm.append($btn);

    $btn.on('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        openQrHelperPopup();
    });
}
// =================================================================================
// 7. Context Menu 핸들러
// =================================================================================
function handleCtxMenuClick(event) {
    const $item = $(event.currentTarget);
    const command = $item.attr('title');

    if (command?.startsWith('/qr-set ')) {
        event.stopPropagation();
        $item.closest('.list-group.ctx-menu').remove();
        setTimeout(() => openQrSetPopup(command), 0);
    }
}

// =================================================================================
// 8. 진입점
// =================================================================================
(async function() {
	if (!extension_settings[extensionName]) {
		extension_settings[extensionName] = {};
	}
	settings = extension_settings[extensionName];

    if (!settings.pos || !Number.isFinite(settings.pos.top) || !Number.isFinite(settings.pos.left)) {
        settings.pos = { ...DEFAULT_POS };
    }
    if (!Number.isFinite(settings.width) || settings.width < 100) settings.width = DEFAULT_SIZE.width;
    if (!Number.isFinite(settings.height) || settings.height < 100) settings.height = DEFAULT_SIZE.height;
	if (!settings.themeColor) settings.themeColor = DEFAULT_THEME_COLOR;
	if (typeof settings.lockSize === 'undefined') settings.lockSize = false;
	if (typeof settings.mobileMode === 'undefined') settings.mobileMode = false;
	if (typeof settings.showQrHelper === 'undefined') settings.showQrHelper = true;
    if (!settings.originalScriptButtons || typeof settings.originalScriptButtons !== 'object') settings.originalScriptButtons = {};
    getHelperReplacementSettings();

    applyThemeColor(settings.themeColor);
    

    createQrPopup();
    createToolbarButton(); 
    initScriptObserver(); 

    $('body').on('mousedown', '.list-group.ctx-menu .ctx-item', handleCtxMenuClick);
    
    if (window.jQuery) {
        try {
            const settingsHtml = await window.jQuery.get(`${extensionFolderPath}/settings.html`);
            window.jQuery("#extensions_settings2").append(settingsHtml);
            
            window.jQuery('#qr-popup-default-width').on('input', onSettingsInput);
            window.jQuery('#qr-popup-default-height').on('input', onSettingsInput);
            window.jQuery('#qr_popup_theme_color').on('input', onThemeColorInput);
            window.jQuery('#qr_popup_reset_pos_btn').on('click', resetPopupPosition);
            window.jQuery('#qr_popup_lock_size').on('change', onLockSizeChange);
            window.jQuery('#qr_popup_mobile_mode').on('change', onMobileModeChange);

            window.jQuery('#qr_popup_show_helper').on('change', onShowHelperChange);
            window.jQuery('#qr_popup_original_buttons').on('change', 'input[type="checkbox"]', onScriptButtonLocationChange);

            loadSettingsUI();
            refreshScriptButtonSettings();
            
        } catch (error) {
            console.warn(`[${extensionName}] settings.html 불러오기 실패.`, error);
        }
    }
})();


// =================================================================================
// 9. 설정 UI 기능
// =================================================================================
function resetPopupPosition() {
    const $popup = $('#qr-popup-container');
    const winWidth = $(window).width();
    const winHeight = $(window).height();
    
    const pWidth = $popup.is(':visible') ? $popup.outerWidth() : Math.min(settings.width, winWidth);
    const pHeight = $popup.is(':visible') ? $popup.outerHeight() : Math.min(settings.height, winHeight);
    const newLeft = Math.max(0, (winWidth - pWidth) / 2);
    const newTop = Math.max(0, (winHeight - pHeight) / 2);

    settings.pos = { top: newTop, left: newLeft };
    if ($popup.length && !settings.mobileMode) $popup.css({ top: newTop, left: newLeft });
    saveSettingsDebounced();
    alert('팝업 위치가 화면 중앙으로 초기화되었습니다.'); 
}

function onLockSizeChange() {
    const isLocked = $(this).is(':checked');
    settings.lockSize = isLocked;
    const $popup = $('#qr-popup-container');

    if (isLocked) {
        $popup.addClass('no-resize');
        $popup.css({ width: settings.width + 'px', height: settings.height + 'px' });
    } else {
        $popup.removeClass('no-resize');
    }
    saveSettingsDebounced();
}

function hexToRgbaSoft(hex) {
    let r = 0, g = 0, b = 0;
    if (hex.length === 4) {
        r = parseInt(hex[1] + hex[1], 16);
        g = parseInt(hex[2] + hex[2], 16);
        b = parseInt(hex[3] + hex[3], 16);
    } else if (hex.length === 7) {
        r = parseInt(hex.substring(1, 3), 16);
        g = parseInt(hex.substring(3, 5), 16);
        b = parseInt(hex.substring(5, 7), 16);
    }
    return `rgba(${r}, ${g}, ${b}, 0.7)`;
}

function applyThemeColor(color) {
    const softColor = hexToRgbaSoft(color);
    document.documentElement.style.setProperty('--qr-theme-color', color);
    document.documentElement.style.setProperty('--qr-theme-color-soft', softColor);
}

function onThemeColorInput() {
    const color = window.jQuery(this).val();
    settings.themeColor = color;
    applyThemeColor(color);
    saveSettingsDebounced();
}

function loadSettingsUI() {
    window.jQuery('#qr-popup-default-width').val(settings.width);
    window.jQuery('#qr-popup-default-height').val(settings.height);
    window.jQuery('#qr_popup_theme_color').val(settings.themeColor);
    window.jQuery('#qr_popup_lock_size').prop('checked', settings.lockSize);
    window.jQuery('#qr_popup_mobile_mode').prop('checked', settings.mobileMode);
    window.jQuery('#qr_popup_show_helper').prop('checked', settings.showQrHelper);
}
function onShowHelperChange() {
    const isChecked = $(this).is(':checked');
    settings.showQrHelper = isChecked;
    saveSettingsDebounced();
    createQrHelperButton();
}

function onSettingsInput() {
    const $input = window.jQuery(this);
    const key = $input.attr('id').endsWith('width') ? 'width' : 'height';
    let value = parseInt($input.val());
    if (isNaN(value) || value < 100) value = 100; 
    
    settings[key] = value;
    if (settings.lockSize) {
        const $popup = window.jQuery('#qr-popup-container');
        if ($popup.length) {
            $popup.css(key, `${value}px`);
        }
    }
    saveSettingsDebounced();
}

function onMobileModeChange() {
    const isMobileMode = $(this).is(':checked');
    settings.mobileMode = isMobileMode;
    const $popup = $('#qr-popup-container');
    
    applyPopupLayout($popup);
    saveSettingsDebounced();
}

function onScriptButtonLocationChange() {
    setOriginalScriptButton($(this).val(), this.checked);
}
