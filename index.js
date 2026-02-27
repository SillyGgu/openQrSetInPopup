import { saveSettingsDebounced } from '../../../../script.js';
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
};

let settings;
let scriptObserver = null;
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`; 

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
    
    $popupContent.find('[data-origin-id]').each(function() {
        const $btn = $(this);
        const originId = $btn.attr('data-origin-id');
        const $originContainer = $(`#${originId}`);
        
        if ($originContainer.length) {
            $originContainer.append($btn);
        }
        $btn.removeAttr('data-origin-id');
    });
}

function initScriptObserver() {
    $('body').addClass('qr-extension-active');

    const targetNode = document.getElementById('send_form');
    if (!targetNode) return;

    const config = { childList: true, subtree: true };
    const callback = function(mutationsList) {
        for(const mutation of mutationsList) {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1 && node.id && node.id.startsWith('script_container_')) {
                        $(node).addClass('script-container-managed');
                    }
                });
            }
        }
    };

    scriptObserver = new MutationObserver(callback);
    scriptObserver.observe(targetNode, config);
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
                <p class="qr-placeholder">Context Menu에서 '/qr-set' 항목을 클릭하면 여기에 QR 버튼이 표시됩니다.</p>
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

    $closeBtn.on('click', () => {
        restoreScriptButtons(); 
        $popup.hide();
        $('#qr-popup-content')
            .empty()
            .append($('<p class="qr-placeholder">Context Menu에서 \'/qr-set\' 항목을 클릭하면 여기에 QR 버튼이 표시됩니다.</p>'));
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

            settings.width = $popup.width();
            settings.height = $popup.height();
            saveSettingsDebounced(); 

            updatePopupContentHeight(); 
        }
    });

    if (window.ResizeObserver) {
        const ro = new ResizeObserver(() => {
            const newWidth = $popup.width();
            const newHeight = $popup.height();

            if (settings.width !== newWidth || settings.height !== newHeight) {
                settings.width = newWidth;
                settings.height = newHeight;
                saveSettingsDebounced(); 
            }
            updatePopupContentHeight();
        });
        ro.observe($popup[0]);
    }

    $(window).on('resize', updatePopupContentHeight);
}

// =================================================================================
// 5. 일반 QR 세트 팝업
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
            width: settings.width,
            height: settings.height,
        });
    }
    $popup.show();

    $('#qr-popup-header-title').text(setName);
    $popupContent.empty().append($('<p class="qr-placeholder">QR 세트 로딩 중...</p>'));

    updatePopupContentHeight(); 

    onQrApiReady((api) => {
        try {
            const qrSet = api.getSetByName(setName);
            if (!qrSet || !qrSet.qrList || qrSet.qrList.length === 0) {
                $popupContent.empty().append($('<p class="qr-placeholder">이 QR 세트 폴더는 비어 있거나 찾을 수 없습니다.</p>'));
                return;
            }

            $popupContent.empty();
            qrSet.qrList.forEach(qr => {
                const $button = $('<div class="popup-qr-button">');
                $button.attr('title', qr.command || qr.label);
                const $icon = $(`<div class="qr--button-icon fa-solid ${qr.icon || 'qr--hidden'}"></div>`);
                const $label = $(`<div class="qr--button-label"></div>`).text(qr.label);
                $button.append($icon, $label);

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
            $popupContent.empty().append($('<p class="qr-error">QR 세트 로드 중 오류 발생. 콘솔 확인.</p>'));
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
            width: settings.width,
            height: settings.height,
        });
    }
    $popup.show();

    $headerTitle.text("스크립트 도구");
    $popupContent.empty(); 
    
    const $containers = $('div[id^="script_container_"]');
    
    if ($containers.length === 0) {
        $popupContent.append($('<p class="qr-placeholder">활성화된 스크립트 QR 컨테이너가 없습니다.</p>'));
        updatePopupContentHeight();
        return;
    }

    $containers.each(function() {
        const $container = $(this);
        const containerId = $container.attr('id');
        
        const $buttons = $container.find('.qr--button');
        $buttons.each(function() {
            const $btn = $(this);
            $btn.attr('data-origin-id', containerId); 
            $popupContent.append($btn);
        });
    });

    if ($popupContent.children().length === 0) {
        $popupContent.append($('<p class="qr-placeholder">스크립트 컨테이너 내에 버튼이 없습니다.</p>'));
    }

    updatePopupContentHeight();
}

// =================================================================================
// 플로팅 버튼 생성 (#send_form 기준 절대 위치)
// =================================================================================
function createToolbarButton() {
    if ($('#qr-helper-toolbar-btn').length) return;

    const $sendForm = $('#send_form');
    if ($sendForm.css('position') === 'static') {
        $sendForm.css('position', 'relative');
    }

    const $btn = $(`<div id="qr-helper-toolbar-btn" title="스크립트 도구"><i class="fa-solid fa-boxes-stacked"></i></div>`);
    $sendForm.append($btn);

    $btn.on('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        openScriptPopup();
    });
}

// =================================================================================
// 7. Context Menu 핸들러
// =================================================================================
function handleCtxMenuClick(event) {
    const $item = $(event.currentTarget);
    const command = $item.attr('title');

    if (command && command.startsWith('/qr-set')) {
        event.preventDefault();
        event.stopPropagation();
        $('.list-group.ctx-menu').remove();
        openQrSetPopup(command);
    }
}

// =================================================================================
// 8. 진입점
// =================================================================================
(async function() {
    extension_settings[extensionName] = extension_settings[extensionName] || DEFAULT_SETTINGS;
    settings = extension_settings[extensionName];

    if (!settings.pos || !settings.pos.top) settings.pos = DEFAULT_POS;
    if (!settings.width) settings.width = DEFAULT_SIZE.width;
    if (!settings.height) settings.height = DEFAULT_SIZE.height;
    if (!settings.themeColor) settings.themeColor = DEFAULT_THEME_COLOR;
    if (typeof settings.lockSize === 'undefined') settings.lockSize = false; 

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