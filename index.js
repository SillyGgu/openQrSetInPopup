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
// 2. 팝업 UI 생성 (수정됨: lockSize 반영)
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

    // 초기 위치 및 크기 설정
    $popup.css({
        top: settings.pos.top,
        left: settings.pos.left,
        width: settings.width,
        height: settings.height,
    });

    // 💡 저장된 설정이 크기 고정이면 클래스 추가
    if (settings.lockSize) {
        $popup.addClass('no-resize');
    }

    // 닫기 버튼
    $closeBtn.on('click', () => {
        $popup.hide();
        $('#qr-popup-content')
            .empty()
            .append($('<p class="qr-placeholder">Context Menu에서 \'/qr-set\' 항목을 클릭하면 여기에 QR 버튼이 표시됩니다.</p>'));
    });

    // 드래그 및 리사이즈 핸들러 연결
    setupDragAndResize($popup, $header);
}

// =================================================================================
// 3. 팝업 콘텐츠 높이 자동 조정
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

// =================================================================================
// 4. 드래그 및 리사이즈 설정
// =================================================================================
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

            // 💡 드래그 종료 시, 위치뿐 아니라 크기도 저장 (리사이즈 되었을 수 있으므로)
            settings.width = $popup.width();
            settings.height = $popup.height();
            saveSettingsDebounced(); // 위치/크기 최종 저장

            updatePopupContentHeight(); // ✅ 리사이즈 후 높이 다시 계산
        }
    });

    // 팝업 자체 리사이즈 감시 (유동적 대응)
    if (window.ResizeObserver) {
        const ro = new ResizeObserver(() => {
            // 💡 크기가 변경될 때마다 설정에 저장 (사용자가 리사이즈 핸들을 놓았을 때 반영)
            const newWidth = $popup.width();
            const newHeight = $popup.height();

            // 이전 크기와 달라졌다면 저장
            if (settings.width !== newWidth || settings.height !== newHeight) {
                settings.width = newWidth;
                settings.height = newHeight;
                saveSettingsDebounced(); // 크기 변경 저장
            }

            updatePopupContentHeight();
        });
        ro.observe($popup[0]);
    }

    // 창 크기 변경 시도 대응
    $(window).on('resize', updatePopupContentHeight);
}

// =================================================================================
// 5. QR 세트 로드 및 표시
// =================================================================================
function openQrSetPopup(command) {
    const setName = command.substring('/qr-set '.length).trim();
    const $popup = $('#qr-popup-container');
    const $popupContent = $('#qr-popup-content');

    // 💡 모바일 모드 설정 확인 및 클래스 적용
    if (settings.mobileMode) {
        $popup.addClass('mobile-layout');
        // 모바일 모드에서는 top/left/width/height를 JS로 설정하지 않고 CSS(.mobile-layout)에 맡김
        $popup.show();
    } else {
        $popup.removeClass('mobile-layout');
        // 일반 모드에서는 저장된 위치/크기 적용
        $popup.show().css({
            top: settings.pos.top,
            left: settings.pos.left,
            width: settings.width,
            height: settings.height,
        });
    }

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
// 6. Context Menu 핸들러
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
// 7. 진입점
// =================================================================================
(async function() {
    extension_settings[extensionName] = extension_settings[extensionName] || DEFAULT_SETTINGS;
    settings = extension_settings[extensionName];

    // 설정 무결성 검사
    if (!settings.pos || !settings.pos.top) settings.pos = DEFAULT_POS;
    if (!settings.width) settings.width = DEFAULT_SIZE.width;
    if (!settings.height) settings.height = DEFAULT_SIZE.height;
    if (!settings.themeColor) settings.themeColor = DEFAULT_THEME_COLOR;
    if (typeof settings.lockSize === 'undefined') settings.lockSize = false; // 💡 신규 설정 초기화

    applyThemeColor(settings.themeColor);

    createQrPopup();
    $('body').on('mousedown', '.list-group.ctx-menu .ctx-item', handleCtxMenuClick);
    
    if (window.jQuery) {
        try {
            const settingsHtml = await window.jQuery.get(`${extensionFolderPath}/settings.html`);
            window.jQuery("#extensions_settings2").append(settingsHtml);
            
            // 이벤트 바인딩
            window.jQuery('#qr-popup-default-width').on('input', onSettingsInput);
            window.jQuery('#qr-popup-default-height').on('input', onSettingsInput);
            window.jQuery('#qr_popup_theme_color').on('input', onThemeColorInput);
            
            window.jQuery('#qr_popup_reset_pos_btn').on('click', resetPopupPosition);
            window.jQuery('#qr_popup_lock_size').on('change', onLockSizeChange);
            
            window.jQuery('#qr_popup_mobile_mode').on('change', onMobileModeChange);

            // UI 값 로드
            loadSettingsUI();
            
        } catch (error) {
            console.warn(`[${extensionName}] settings.html 불러오기 실패.`, error);
        }
    }
})();


// =================================================================================
// 8. 설정 UI 기능 (New/Modified)
// =================================================================================


function resetPopupPosition() {
    const $popup = $('#qr-popup-container');
    const winWidth = $(window).width();
    const winHeight = $(window).height();
    
    // 현재 팝업 크기 (설정값 기준)
    const pWidth = settings.width || 400;
    const pHeight = settings.height || 250;

    // 중앙 좌표 계산
    const newLeft = Math.max(0, (winWidth - pWidth) / 2);
    const newTop = Math.max(0, (winHeight - pHeight) / 2);

    // 설정 업데이트
    settings.pos = { top: newTop, left: newLeft };
    
    // 팝업이 생성되어 있다면 즉시 이동
    if ($popup.length) {
        $popup.css({ top: newTop, left: newLeft });
    }

    saveSettingsDebounced();
    
    console.log(`[${extensionName}] 팝업 위치가 중앙으로 초기화되었습니다.`);
    alert('팝업 위치가 화면 중앙으로 초기화되었습니다.'); // 필요 시 toast로 변경 가능
}

/**
 * 💡 [신규] 크기 고정 모드 토글 핸들러
 */
function onLockSizeChange() {
    const isLocked = $(this).is(':checked');
    settings.lockSize = isLocked;
    
    const $popup = $('#qr-popup-container');
    const $inputs = $('#qr_popup_manual_size_inputs input');

    if (isLocked) {
        $popup.addClass('no-resize');
        // 고정 모드 진입 시, 현재 입력 필드의 값으로 크기 강제 적용
        $popup.css({
            width: settings.width + 'px',
            height: settings.height + 'px'
        });
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

/**
 * 설정 UI에 현재 저장된 값들을 로드합니다.
 */
function loadSettingsUI() {
    // 크기
    window.jQuery('#qr-popup-default-width').val(settings.width);
    window.jQuery('#qr-popup-default-height').val(settings.height);
    // 색상
    window.jQuery('#qr_popup_theme_color').val(settings.themeColor);
    // 잠금 상태
    window.jQuery('#qr_popup_lock_size').prop('checked', settings.lockSize);
    // 모바일 모드 상태
    window.jQuery('#qr_popup_mobile_mode').prop('checked', settings.mobileMode);
}

/**
 * 너비/높이 입력값 변경 시 호출
 */
function onSettingsInput() {
    const $input = window.jQuery(this);
    const key = $input.attr('id').endsWith('width') ? 'width' : 'height';
    
    let value = parseInt($input.val());
    
    if (isNaN(value) || value < 100) { 
        value = 100; // 최소값 방어
    }
    
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

/**
 * 💡 모바일 모드 변경 핸들러
 */
function onMobileModeChange() {
    const isMobileMode = $(this).is(':checked');
    settings.mobileMode = isMobileMode;
    
    const $popup = $('#qr-popup-container');
    
    if (isMobileMode) {
        $popup.addClass('mobile-layout');
        // 모바일 모드 진입 시 강제로 스타일 재계산 (필요시)
        $popup.css({ top: '', left: '', width: '', height: '' }); 
    } else {
        $popup.removeClass('mobile-layout');
        // 모바일 모드 해제 시 기존 저장된 위치/크기로 복구
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