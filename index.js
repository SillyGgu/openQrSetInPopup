import { saveSettingsDebounced, eventSource, event_types } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';

const extensionName = 'openQrSetInPopup';
const DEFAULT_POS = { top: 100, left: 100 };
const DEFAULT_SIZE = { width: 400, height: 250 };
const DEFAULT_THEME_COLOR = '#64B5F6'; 

const DEFAULT_SETTINGS = {
    pos: DEFAULT_POS,
    width: DEFAULT_SIZE.width,
    height: DEFAULT_SIZE.height,
    themeColor: DEFAULT_THEME_COLOR,
    lockSize: false,
    mobileMode: false,
    showQrHelper: true,
    helperReplacement: {
        charName: '',
        userName: '',
    },
};

let settings;
let scriptObserver = null;
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`; 

// =================================================================================
// 0. 스타일 주입 (복사 버튼용 CSS)
// =================================================================================
function injectStyles() {
    const styleId = 'qr-popup-extra-styles';
    if ($(`#${styleId}`).length) return;

    const css = `
        .popup-qr-button {
            position: relative;
            display: flex;
            align-items: center;
            /* 기존 스타일과의 호환성을 위해 flex 사용 */
        }
        .qr-copy-btn {
            margin-left: auto; /* 우측 끝으로 밀기 */
            padding: 5px 10px;
            cursor: pointer;
            opacity: 0.6;
            transition: opacity 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            border-left: 1px solid rgba(255,255,255,0.1);
        }
        .qr-copy-btn:hover {
            opacity: 1;
            background-color: rgba(255,255,255,0.1);
        }
        .qr-copy-btn i {
            pointer-events: none;
        }
    `;
    $('head').append(`<style id="${styleId}">${css}</style>`);
}

// =================================================================================
// 1. QR API 준비 대기
// =================================================================================
function onQrApiReady(callback) {
    const interval = setInterval(() => {
        if (window.parent.quickReplyApi) {
            clearInterval(interval);
            callback(window.parent.quickReplyApi);
        }
    }, 100);
}

// =================================================================================
// 2. 스크립트 버튼 복구 (안전장치)
// =================================================================================
function restoreScriptButtons() {
    const $popupContent = $('#qr-popup-content');

    $popupContent.find('.qr-inline-submenu').remove();

    $popupContent.find('[data-origin-type="script"]').each(function() {
        const $btn = $(this);
        const originId = $btn.attr('data-origin-id');
        const $originContainer = $(`#${originId}`);
        if ($originContainer.length) {
            $originContainer.append($btn);
        }
        $btn.removeAttr('data-origin-id').removeAttr('data-origin-type');
    });

    $popupContent.find('[data-origin-type="chatqr"]').each(function() {
        $(this).find('.qr--button-expander').off('click.qrpopup');
    });
}

function updateToolbarButtonVisibility() {
    const $btn = $('#qr-helper-toolbar-btn');

    const buttonsInContainers = $('div[id^="script_container_"] .qr--button').length;
    const chatQrButtonsInPopup = $('#qr-popup-content [data-origin-type="chatqr"]').length;
    const scriptButtonsInPopup = $('#qr-popup-content [data-origin-type="script"]').length;

    if (buttonsInContainers + chatQrButtonsInPopup + scriptButtonsInPopup > 0) {
        $btn.show();
    } else {
        $btn.hide();
    }
}
function renderChatQrButtons() {
    const $popupContent = $('#qr-popup-content');

    $popupContent.find('[data-origin-type="chatqr"]').remove();
    $popupContent.find('.qr-inline-submenu').remove();

    $('#qr--bar').children('.qr--buttons').each(function(index) {
        if (index === 0) return; 
        const $group = $(this);
        if ($group.attr('id') && $group.attr('id').startsWith('script_container_')) return;
        $group.hide();
    });

    const api = window.quickReplyApi;
    if (!api) return;

    const chatQrGroups = [];
    $('#qr--bar').children('.qr--buttons').each(function(index) {
        if (index === 0) return;
        const $group = $(this);
        if ($group.attr('id') && $group.attr('id').startsWith('script_container_')) return;
        chatQrGroups.push($group);
    });

    if (chatQrGroups.length === 0) {
        updateToolbarButtonVisibility();
        return;
    }

    chatQrGroups.forEach($group => {
        $group.find('.qr--button').each(function() {
            const $origBtn = $(this);
            const label = $origBtn.find('.qr--button-label').text().trim();
            const hasCtx = $origBtn.hasClass('qr--hasCtx');
            const iconClass = $origBtn.find('.qr--button-icon').attr('class') || '';

            // 새 버튼 생성 (원본 DOM 이동 아닌 새로 그리기)
            const $btn = $('<div class="popup-qr-button" data-origin-type="chatqr"></div>');

            const $icon = $(`<div class="${iconClass}"></div>`);
            const $label = $('<div class="qr--button-label"></div>').text(label);
            $btn.append($icon, $label);

            // context menu 있는 버튼에만 ⋮ 표시
            if (hasCtx) {
                const $expander = $('<div class="qr--button-expander" title="메뉴 열기">⋮</div>');
                $btn.append($expander);

                $expander.on('click', function(e) {
                    e.stopPropagation();
                    e.preventDefault();

                    // 이미 열려 있으면 접기
                    const $existing = $btn.next('.qr-inline-submenu');
                    if ($existing.length > 0) {
                        $existing.remove();
                        return;
                    }

                    // 다른 서브메뉴 닫기
                    $popupContent.find('.qr-inline-submenu').remove();

                    // 원본 버튼의 expander를 클릭해 ST의 ctx-menu 생성
                    // 단, 생성된 즉시 가로채서 인라인으로 전환
                    const origExpander = $origBtn.find('.qr--button-expander')[0];
                    if (!origExpander) return;

                    // ST ctx-menu 생성 유도 (원본 expander 클릭)
                    origExpander.dispatchEvent(new MouseEvent('click', { bubbles: true }));

                    setTimeout(() => {
                        const $ctxMenu = $('.list-group.ctx-menu');
                        if ($ctxMenu.length === 0) return;

                        // ctx-menu를 즉시 제거하고 인라인 서브메뉴로 재구성
                        const $subMenu = $('<div class="qr-inline-submenu"></div>');

                        $ctxMenu.find('.ctx-item').each(function() {
                            const $item = $(this);
                            const itemTitle = $item.attr('title') || '';
                            const $subBtn = $('<div class="popup-qr-button qr-submenu-item"></div>');
                            // ctx-item 내부 HTML 그대로 복사 (아이콘+텍스트)
                            $subBtn.html($item.html());
                            $subBtn.attr('title', itemTitle);
                            $subBtn.on('click', function(ev) {
                                ev.stopPropagation();
                                $subMenu.remove();
                                // 원본 ctx-item 동작 실행
                                $item[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
                            });
                            $subMenu.append($subBtn);
                        });

                        $ctxMenu.remove();
                        $btn.after($subMenu);
                    }, 30);
                });
            }

            // 버튼 본체 클릭 → 원본 버튼 클릭 위임
            $btn.on('click', function(e) {
                if ($(e.target).hasClass('qr--button-expander')) return;
                $origBtn[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
            });

            $popupContent.append($btn);
        });
    });

    updateToolbarButtonVisibility();
}

function initScriptObserver() {
    $('body').addClass('qr-extension-active');

    renderChatQrButtons();

    eventSource.on(event_types.CHAT_CHANGED, () => {
        // CSS가 이미 숨겨주므로 딜레이 없이 바로 실행
        // 단 ST가 QR bar DOM을 업데이트할 시간 최소한만 확보
        setTimeout(() => renderChatQrButtons(), 50);
    });

    // script_container_ 감시는 유지 (send_form 기준)
    const targetNode = document.getElementById('send_form');
    if (!targetNode) return;

    const config = { childList: true, subtree: true };
    const callback = function(mutationsList) {
        for (const mutation of mutationsList) {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType !== 1) return;
                    if (node.id && node.id.startsWith('script_container_')) {
                        $(node).addClass('script-container-managed');
                        updateToolbarButtonVisibility();
                    }
                });
                mutation.removedNodes.forEach(node => {
                    if (node.nodeType !== 1) return;
                    if (node.id && node.id.startsWith('script_container_')) {
                        updateToolbarButtonVisibility();
                    }
                });
            }
        }
    };

    scriptObserver = new MutationObserver(callback);
    scriptObserver.observe(targetNode, config);

    updateToolbarButtonVisibility();
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
function updatePopupContentHeight() {
    const $popup = $('#qr-popup-container');
    const $header = $('#qr-popup-header');
    const $content = $('#qr-popup-content');

    if (!$popup.is(':visible')) return;

    const popupHeight = $popup.height();
    const headerHeight = $header.outerHeight(true);
    const available = popupHeight - headerHeight;

    $content.css({
        maxHeight: available + 'px',
        overflowY: 'auto'
    });
}

function setupDragAndResize($popup, $header) {
    let isDragging = false;
    let offsetX, offsetY;
    const $window = $(window);

    $header.on('mousedown', function(e) {
        if ($(e.target).closest('#qr-popup-close-btn').length) return;

        isDragging = true;
        offsetX = e.clientX - $popup.offset().left;
        offsetY = e.clientY - $popup.offset().top;
        $popup.addClass('grabbing').css('cursor', 'grabbing');
        e.preventDefault();
    });

    $window.on('mousemove', function(e) {
        if (!isDragging) return;
        let newX = e.clientX - offsetX;
        let newY = e.clientY - offsetY;

        const minX = 0;
        const minY = 0;
        const maxX = $window.width() - $popup.outerWidth();
        const maxY = $window.height() - $popup.outerHeight();

        newX = Math.max(minX, Math.min(newX, maxX));
        newY = Math.max(minY, Math.min(newY, maxY));

        $popup.offset({ top: newY, left: newX });

        settings.pos.top = newY;
        settings.pos.left = newX;
        saveSettingsDebounced();
    });

    $window.on('mouseup', function() {
        if (isDragging) {
            isDragging = false;
            $popup.removeClass('grabbing').css('cursor', 'grab');

            settings.width = Math.round($popup.outerWidth());
            settings.height = Math.round($popup.outerHeight());
            saveSettingsDebounced();

            updatePopupContentHeight();
        }
    });

    if (window.ResizeObserver) {
        let isResizingByUser = false;

        $popup[0].addEventListener('mousedown', function(e) {
            const rect = $popup[0].getBoundingClientRect();
            const onRightEdge = e.clientX >= rect.right - 16;
            const onBottomEdge = e.clientY >= rect.bottom - 16;
            if (onRightEdge || onBottomEdge) {
                isResizingByUser = true;
            }
        });

        $(window).on('mouseup.qr-resize', function() {
            isResizingByUser = false;
        });

        const ro = new ResizeObserver(() => {
            updatePopupContentHeight();
            if (!isResizingByUser) return;
            const newWidth = Math.round($popup.outerWidth());
            const newHeight = Math.round($popup.outerHeight());
            if (settings.width !== newWidth || settings.height !== newHeight) {
                settings.width = newWidth;
                settings.height = newHeight;
                saveSettingsDebounced();
            }
        });
        ro.observe($popup[0]);
    }

    $(window).on('resize', updatePopupContentHeight);
}

// =================================================================================
// 5. 일반 QR 세트 팝업 (복사 기능 추가)
// =================================================================================
function openQrSetPopup(command) {
    restoreScriptButtons(); 

    const setName = command.substring('/qr-set '.length).trim();
    const $popup = $('#qr-popup-container');
    const $popupContent = $('#qr-popup-content');

    if (settings.mobileMode) {
        $popup.addClass('mobile-layout');
        $popup.css({ top: '', left: '', width: '', height: '' });
    } else {
        $popup.removeClass('mobile-layout');
        $popup.css({
            top: settings.pos.top,
            left: settings.pos.left,
            width: settings.width + 'px',
            height: settings.height + 'px',
        });
    }
    $popup.show();

    $('#qr-popup-header-title').text(setName);
    $popupContent.empty();
    $popupContent.prepend($('<p class="qr-placeholder">QR 세트 로딩 중...</p>'));

    updatePopupContentHeight(); 

    onQrApiReady((api) => {
        try {
            const qrSet = api.getSetByName(setName);
            if (!qrSet || !qrSet.qrList || qrSet.qrList.length === 0) {
                $popupContent.empty();
                $popupContent.prepend($('<p class="qr-placeholder">이 QR 세트 폴더는 비어 있거나 찾을 수 없습니다.</p>'));
                return;
            }

            $popupContent.empty();
            qrSet.qrList.forEach(qr => {
                const $button = $('<div class="popup-qr-button">');
                $button.attr('title', qr.command || qr.label);
                
                const $icon = $(`<div class="qr--button-icon fa-solid ${qr.icon || 'qr--hidden'}"></div>`);
                const $label = $(`<div class="qr--button-label"></div>`).text(qr.label);
                
                const $copyBtn = $('<div class="qr-copy-btn" title="내용 복사"><i class="fa-solid fa-copy"></i></div>');

                $copyBtn.on('click', function(e) {
                    e.stopPropagation(); 
                    e.preventDefault();
                    
                    const contentToCopy = qr.message; 
                    
                    if (contentToCopy) {
                        navigator.clipboard.writeText(contentToCopy).then(() => {
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

                $button.append($icon, $label, $copyBtn);

                $button.on('click', function(e) {
                    e.stopPropagation();
                    e.preventDefault();
                    api.executeQuickReply(qrSet.name, qr.label);
                });
                
                $popupContent.append($button);
            });
            updatePopupContentHeight(); 
        } catch (error) {
            console.error(`[${extensionName}] QR 세트 로드 중 오류:`, error);
            $popupContent.children(':not([data-origin-type="chatqr"])').remove();
            $popupContent.prepend($('<p class="qr-error">QR 세트 로드 중 오류 발생. 콘솔 확인.</p>'));
        }
    });
}

// =================================================================================
// 6. 스크립트 도구 팝업 (토글 기능)
// =================================================================================
function openScriptPopup() {
    const $popup = $('#qr-popup-container');
    const $headerTitle = $('#qr-popup-header-title');

    if ($popup.is(':visible') && $headerTitle.text() === "스크립트 도구") {
        $('#qr-popup-close-btn').click();
        return;
    }

    restoreScriptButtons();

    const $popupContent = $('#qr-popup-content');

    if (settings.mobileMode) {
        $popup.addClass('mobile-layout');
        $popup.css({ top: '', left: '', width: '', height: '' });
    } else {
        $popup.removeClass('mobile-layout');
        $popup.css({
            top: settings.pos.top,
            left: settings.pos.left,
            width: settings.width + 'px',
            height: settings.height + 'px',
        });
    }
    $popup.show();

    $headerTitle.text("스크립트 도구");

    $popupContent.empty();

    const chatQrGroups = [];
    $('#qr--bar').children('.qr--buttons').each(function(index) {
        if (index === 0) return;
        const $group = $(this);
        if ($group.attr('id') && $group.attr('id').startsWith('script_container_')) return;
        chatQrGroups.push($group);
    });

    chatQrGroups.forEach($group => {
        $group.find('.qr--button').each(function() {
            const $origBtn = $(this);
            const label = $origBtn.find('.qr--button-label').text().trim();
            const hasCtx = $origBtn.hasClass('qr--hasCtx');
            const iconClass = $origBtn.find('.qr--button-icon').attr('class') || '';

            const $btn = $('<div class="popup-qr-button" data-origin-type="chatqr"></div>');
            const $icon = $(`<div class="${iconClass}"></div>`);
            const $label = $('<div class="qr--button-label"></div>').text(label);
            $btn.append($icon, $label);

            if (hasCtx) {
                const $expander = $('<div class="qr--button-expander" title="메뉴 열기">⋮</div>');
                $btn.append($expander);

                $expander.on('click', function(e) {
                    e.stopPropagation();
                    e.preventDefault();

                    const $existing = $btn.next('.qr-inline-submenu');
                    if ($existing.length > 0) {
                        $existing.remove();
                        return;
                    }

                    $popupContent.find('.qr-inline-submenu').remove();

                    const origExpander = $origBtn.find('.qr--button-expander')[0];
                    if (!origExpander) return;

                    origExpander.dispatchEvent(new MouseEvent('click', { bubbles: true }));

                    setTimeout(() => {
                        const $ctxMenu = $('.list-group.ctx-menu');
                        if ($ctxMenu.length === 0) return;

                        const $subMenu = $('<div class="qr-inline-submenu"></div>');

                        $ctxMenu.find('.ctx-item').each(function() {
                            const $item = $(this);
                            const itemTitle = $item.attr('title') || '';
                            const $subBtn = $('<div class="popup-qr-button qr-submenu-item"></div>');
                            $subBtn.html($item.html());
                            $subBtn.attr('title', itemTitle);
                            $subBtn.on('click', function(ev) {
                                ev.stopPropagation();
                                $subMenu.remove();
                                $item[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
                            });
                            $subMenu.append($subBtn);
                        });

                        $ctxMenu.remove();
                        $btn.after($subMenu);
                    }, 30);
                });
            }

            $btn.on('click', function(e) {
                if ($(e.target).hasClass('qr--button-expander')) return;
                $origBtn[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
            });

            $popupContent.append($btn);
        });
    });

    // script 버튼 앞에 추가
    const $containers = $('div[id^="script_container_"]');
    $containers.each(function() {
        const $container = $(this);
        const containerId = $container.attr('id');
        $container.find('.qr--button').each(function() {
            const $btn = $(this);
            $btn.attr('data-origin-id', containerId);
            $btn.attr('data-origin-type', 'script');
            $popupContent.prepend($btn);
        });
    });

    updatePopupContentHeight();
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
    const $popup = $('#qr-popup-container');
    const $headerTitle = $('#qr-popup-header-title');
    
    if ($popup.is(':visible') && $headerTitle.text() === "QR 도우미") {
        $('#qr-popup-close-btn').click();
        return;
    }

    restoreScriptButtons(); 

    const $popupContent = $('#qr-popup-content');

    if (settings.mobileMode) {
        $popup.addClass('mobile-layout');
        $popup.css({ top: '', left: '', width: '', height: '' });
    } else {
        $popup.removeClass('mobile-layout');
        $popup.css({
            top: settings.pos.top,
            left: settings.pos.left,
            width: settings.width + 'px',
            height: settings.height + 'px',
        });
    }
    $popup.show();
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
            const TEMP_TOKEN = '###_QR_TEMP_TOKEN_###';
            text = text.replaceAll('{{char}}', TEMP_TOKEN);
            text = text.replaceAll('{{user}}', '{{char}}');
            text = text.replaceAll(TEMP_TOKEN, '{{user}}');

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
            navigator.clipboard.writeText(lang.text).then(() => {
                if (window.toastr) window.toastr.success(`"${lang.text}" 복사 완료`);
                
                const originalText = $btn.text();
                $btn.text('Copied!');
                $btn.addClass('copied');
                setTimeout(() => {
                    $btn.text(originalText);
                    $btn.removeClass('copied');
                }, 1000);
            });
        });
        $langGrid.append($btn);
    });

    $langSection.append($langGrid);
    $popupContent.append($langSection);

    updatePopupContentHeight();
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

    if (command && command.startsWith('/qr-set')) {
        event.stopPropagation();
        $('.list-group.ctx-menu').remove();
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

	if (!settings.pos || !settings.pos.top) settings.pos = DEFAULT_POS;
	if (!settings.width) settings.width = DEFAULT_SIZE.width;
	if (!settings.height) settings.height = DEFAULT_SIZE.height;
	if (!settings.themeColor) settings.themeColor = DEFAULT_THEME_COLOR;
	if (typeof settings.lockSize === 'undefined') settings.lockSize = false;
	if (typeof settings.mobileMode === 'undefined') settings.mobileMode = false;
	if (typeof settings.showQrHelper === 'undefined') settings.showQrHelper = true;
    getHelperReplacementSettings();

    applyThemeColor(settings.themeColor);
    

    injectStyles();

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

            loadSettingsUI();
            
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
    
    const pWidth = settings.width || 400;
    const pHeight = settings.height || 250;
    const newLeft = Math.max(0, (winWidth - pWidth) / 2);
    const newTop = Math.max(0, (winHeight - pHeight) / 2);

    settings.pos = { top: newTop, left: newLeft };
    if ($popup.length) $popup.css({ top: newTop, left: newLeft });
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
            updatePopupContentHeight(); 
        }
    }
    saveSettingsDebounced();
}

function onMobileModeChange() {
    const isMobileMode = $(this).is(':checked');
    settings.mobileMode = isMobileMode;
    const $popup = $('#qr-popup-container');
    
    if (isMobileMode) {
        $popup.addClass('mobile-layout');
        $popup.css({ top: '', left: '', width: '', height: '' }); 
    } else {
        $popup.removeClass('mobile-layout');
        $popup.css({
            top: settings.pos.top,
            left: settings.pos.left,
            width: settings.width,
            height: settings.height
        });
    }
    updatePopupContentHeight();
    saveSettingsDebounced();
}
