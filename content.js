// content.js

// Content script: extracts moves and player info from chess.com pages
// and sends structured game data to the background service worker.

console.log("🧩 [Content Script] Chess.com Assistant yüklendi.");

// State used to avoid repeated sends
let lastSavedCount = 0;
let lastGameData = null;
let lastSavedMoves = null;
let lastGameUrl = null;
let lastUserName = null;
let saveTimer = null;
// Saved player info (may be set via popup)
let playerName = null;
let playerColor = null;

// Load saved player name/color from storage (if any)
try {
    chrome.storage && chrome.storage.local && chrome.storage.local.get(['savedPlayerName','savedPlayerColor'], (res) => {
        if (res && res.savedPlayerName) playerName = res.savedPlayerName;
            if (res && res.savedPlayerColor) playerColor = res.savedPlayerColor;
    });
} catch (e) {
    // Not critical in non-extension context
}

// Listen for storage changes: update saved player info when popup writes new values
chrome.storage && chrome.storage.onChanged && chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.savedPlayerName) playerName = changes.savedPlayerName.newValue;
    if (changes.savedPlayerColor) playerColor = changes.savedPlayerColor.newValue;
    try { console.log('🗂️ [Content] storage.onChanged', changes); } catch (e) {}
});

// Respond to popup 'detectUser' requests by attempting to read a username from the page

chrome.runtime && chrome.runtime.onMessage && chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request && request.action === 'detectUser') {
        const possible = document.querySelector('.header-user-username, .user-block .username, [data-test-element="menu-username"], a.header-user-link, [data-test-element="user-tagline-username"]');
        const detected = possible && possible.textContent ? possible.textContent.trim() : null;
        try { console.log('📨 [Content] detectUser ->', detected); } catch (e) {}
        sendResponse({ suggestedName: detected });
        return true; // keep message channel open briefly
    }
    if (request && request.action === 'forceRefresh') {
        try { console.log('📨 [Content] forceRefresh received'); } catch (e) {}
        // Try to locate move list node and log status (helps debugging when popup is on different tab)
        try {
            const node = findMoveListNode();
            if (node) try { console.log('🔎 [Content] move list node found for forceRefresh'); } catch (e) {}
            else try { console.log('🔎 [Content] move list node NOT found for forceRefresh'); } catch (e) {}
        } catch (e) {}
        extractAndSaveMoves(true); // force refresh
        try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
        return true;
    }
});


// Oyuncu isimlerini Chess.com sayfasından çek
// getPlayerNames: attempts several selectors/heuristics to find white and black player names
function getPlayerNames() {
    // Öncelikle mümkünse iki kullanıcı adını al
    const usernameEls = Array.from(document.querySelectorAll('[data-test-element="user-tagline-username"], .player-info .username, .username'))
        .filter(el => el && el.textContent && el.textContent.trim().length > 0);

    // Helper: guess board orientation (returns 'white' or 'black' or null)
    function getBoardOrientation() {
        const board = document.querySelector('wc-chessboard-board, .board, .chessboard');
        if (!board) return null;
        const attr = board.getAttribute('orientation') || board.getAttribute('data-orientation') || board.getAttribute('data-side');
        if (attr) {
            const a = String(attr).toLowerCase();
            if (a.includes('black')) return 'black';
            if (a.includes('white')) return 'white';
        }
        const cls = (board.className || '').toLowerCase();
        if (cls.includes('flipped') || cls.includes('flip') || cls.includes('orientation-black')) return 'black';
        if (cls.includes('orientation-white')) return 'white';
        return null;
    }

    if (usernameEls.length >= 2) {
        const topName = usernameEls[0].textContent.trim();
        const bottomName = usernameEls[1].textContent.trim();

        // 1) If board orientation is available, use it to map top/bottom -> white/black
        const orientation = getBoardOrientation();
        if (orientation === 'black') {
            // bottom is black
            return { white: topName, black: bottomName };
        }
        if (orientation === 'white') {
            // bottom is white
            return { white: bottomName, black: topName };
        }

        // 2) If orientation not available, check ancestor classes for hints
        const topAnc = usernameEls[0].closest('.player-top, .player-bottom, .player, .player-info, .user-tagline');
        const bottomAnc = usernameEls[1].closest('.player-top, .player-bottom, .player, .player-info, .user-tagline');

        const topCls = (topAnc && topAnc.className) ? topAnc.className.toLowerCase() : '';
        const bottomCls = (bottomAnc && bottomAnc.className) ? bottomAnc.className.toLowerCase() : '';

        if (topCls.includes('white') || bottomCls.includes('black')) {
            return { white: topName, black: bottomName };
        }
        if (topCls.includes('black') || bottomCls.includes('white')) {
            return { white: bottomName, black: topName };
        }

        // 3) Fallback: assume bottom element is white (common layout)
        return { white: bottomName, black: topName };
    }

    // Eğer usernameEls bulunamadıysa diğer seçicilerle dene
    const playerInfos = document.querySelectorAll('.player-info');
    if (playerInfos.length >= 2) {
        const maybeWhite = playerInfos[0]?.querySelector('.username')?.textContent?.trim() || 'Unknown';
        const maybeBlack = playerInfos[1]?.querySelector('.username')?.textContent?.trim() || 'Unknown';
        return { white: maybeWhite, black: maybeBlack };
    }

    return { white: 'Unknown', black: 'Unknown' };
}

// Kullanıcının beyaz mı siyah mı oynadığını belirle
function isUserWhiteOrBlack() {
    const players = getPlayerNames();

    // Öncelikle script içindeki playerName değişkenini kullan (eğer gerçek kullanıcı adı varsa)
    let currentUser = (typeof playerName === 'string' && playerName.trim().length > 0) ? playerName.trim() : null;

    // Eğer yoksa sayfadaki header/menü kullanıcı adını dene
    if (!currentUser) {
        const possible = document.querySelector('.header-user-username, .user-block .username, [data-test-element="menu-username"], a.header-user-link');
        if (possible && possible.textContent) currentUser = possible.textContent.trim();
    }

    if (!currentUser) return 'unknown';

    // Doğrudan eşleşme
    if (players.white && currentUser === players.white) return 'white';
    if (players.black && currentUser === players.black) return 'black';

    // Küçük/büyük harf farkını yok say
    const cu = currentUser.toLowerCase();
    if (players.white && cu === players.white.toLowerCase()) return 'white';
    if (players.black && cu === players.black.toLowerCase()) return 'black';

    return 'unknown';
}

// Bir hamle öğesinden doğru SAN metnini çıkarır.
function getMoveTextFromElement(el) {
    if (!el) return '';
    const parts = [];
    Array.from(el.childNodes).forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) {
            // Eğer ikon veya element data-figurine içeriyorsa kullan
            // prefer data-figurine attribute which holds SAN letter (e.g. 'N' for knight)
            const fig = (node.getAttribute && (node.getAttribute('data-figurine') || (node.dataset && node.dataset.figurine))) || null;
            if (fig) {
                parts.push(String(fig));
            } else {
                // Bazı ikonlar iç metin de içerebilir
                const inner = node.textContent && node.textContent.trim();
                if (inner) parts.push(inner);
            }
        } else if (node.nodeType === Node.TEXT_NODE) {
            const txt = node.textContent.replace(/\s+/g, ' ');
            if (txt.trim()) parts.push(txt.trim());
        }
    });
    // Birleştir ve fazladan boşlukları temizle
    return parts.join('').replace(/\s+/g, ' ').trim();
}

function extractAndSaveMoves(force) {
    // extractAndSaveMoves invoked when observer detects updates or forced
    try { console.log('♟️ [Content] extractAndSaveMoves called, force=', !!force); } catch (e) {}

    const selectors = [
        'wc-simple-move-list .main-line-row.move-list-row',
        'wc-game-move-list .main-line-row.move-list-row',
        '.move-list .move-row',
        '.move-list li',
        '[data-whole-move-number]'
    ];

    // Set ile duplicate önle
    const rowsSet = new Set();
    selectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(n => rowsSet.add(n));
    });

    const moveRows = Array.from(rowsSet);
    let moves = [];
    try { console.log('♟️ [Content] moveRows length =', moveRows.length); } catch (e) {}

    moveRows.forEach(rowElement => {
        let whiteMove = '';
        const whiteEl = rowElement.querySelector('.node.white-move .node-highlight-content') || rowElement.querySelector('.white') || rowElement.querySelector('.move.white');
        if (whiteEl) whiteMove = getMoveTextFromElement(whiteEl);

        let blackMove = '';
        const blackEl = rowElement.querySelector('.node.black-move .node-highlight-content') || rowElement.querySelector('.black') || rowElement.querySelector('.move.black');
        if (blackEl) blackMove = getMoveTextFromElement(blackEl);

        if (whiteMove) moves.push(whiteMove);
        if (blackMove) moves.push(blackMove);
    });

    // Kullanıcı adı veya oyun url'si değiştiyse move listesini sıfırla
    const playerNames = getPlayerNames();
    // Prefer page header username for change detection; fall back to stored playerName
    const headerUser = document.querySelector('.header-user-username, .user-block .username, [data-test-element="menu-username"], a.header-user-link, [data-test-element="user-tagline-username"]')?.textContent?.trim() || null;
    const userNameNow = headerUser || (typeof playerName === 'string' && playerName.trim().length > 0 ? playerName.trim() : null);
    const urlNow = location.href;
    let reset = false;
    if (lastGameUrl && lastGameUrl !== urlNow) reset = true;
    if (lastUserName && userNameNow && lastUserName !== userNameNow) reset = true;
    // If header username changed (and we have a header value), force clear storage so popup stops showing old game
    if (headerUser && lastUserName && headerUser !== lastUserName) {
        try { console.log('🔁 [Content] header user changed from', lastUserName, 'to', headerUser); } catch (e) {}
        try {
            chrome.storage && chrome.storage.local && chrome.storage.local.set({ currentGameMoves: [], currentGameData: null }, () => {
                try { console.log('💾 [Content] cleared stored currentGameMoves/currentGameData due to header user change'); } catch (e) {}
            });
        } catch (e) { try { console.warn('⚠️ [Content] storage clear failed', e); } catch (z) {} }
        lastSavedMoves = null;
    }
    if (reset) {
        lastSavedMoves = null;
    }
    lastGameUrl = urlNow;
    lastUserName = userNameNow;

    // If moves are identical to last saved moves, skip (unless force)
    const same = Array.isArray(lastSavedMoves) && lastSavedMoves.length === moves.length && lastSavedMoves.every((v,i) => v === moves[i]);
    if (same && !force) return;

    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveTimer = null;
        const userSide = isUserWhiteOrBlack();
        const gameData = {
            moves: moves,
            white: playerNames.white,
            black: playerNames.black,
            userSide: userSide,
            url: location.href,
            timestamp: Date.now()
        };
        lastGameData = gameData;
        lastSavedMoves = moves.slice();

        try {
            chrome.storage && chrome.storage.local && chrome.storage.local.set({ currentGameMoves: moves, currentGameData: { white: gameData.white, black: gameData.black, userSide: gameData.userSide, url: gameData.url, timestamp: gameData.timestamp } }, () => {
                if (chrome.runtime.lastError) {
                    console.warn('⚠️ [Content] storage.set hata:', chrome.runtime.lastError.message);
                } else {
                    try { console.log('💾 [Content] saved currentGameMoves length=', moves.length, 'url=', gameData.url); } catch (e) {}
                }
            });
        } catch (e) {
            console.warn('⚠️ [Content] storage.set exception:', e && e.message);
        }

        try {
            chrome.runtime.sendMessage({ action: 'saveMoves', data: gameData });
        } catch (e) {
            // ignore messaging errors
        }
    }, 120);
}


// Hedef öğeyi arayan yardımcı
function findMoveListNode() {
    const trySelectors = [
        'wc-simple-move-list.play-controller-moveList',
        'wc-game-move-list',
        '.move-list',
        '[data-whole-move-number]'
    ];

    for (const sel of trySelectors) {
        const node = document.querySelector(sel);
        if (node) return node;
    }
    return null;
}

function setupObserver(targetNode) {
    // Observer started for move list node
    const callback = function(mutationsList) {
        let isMoveAdded = false;
        for (const mutation of mutationsList) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                isMoveAdded = true;
                break;
            }
            if (mutation.type === 'characterData') {
                isMoveAdded = true;
                break;
            }
        }
        if (isMoveAdded) {
                // move(s) added -> extract and send
            extractAndSaveMoves();

            const userSide = isUserWhiteOrBlack();
            // userSide detected: userSide

        }
    };

    const config = { childList: true, subtree: true, characterData: true };
    const observer = new MutationObserver(callback);
    observer.observe(targetNode, config);
    console.log('✅ [Gözlemci] Hamle listesi gözlemcisi başlatıldı.');
}


// Deneme döngüsü: sayfa yüklenince hedefi bulmaya çalış, bulamazsa body üzerinde eklenen düğümleri dinle
(function init() {
    let node = findMoveListNode();
    if (node) {
        setupObserver(node);
        extractAndSaveMoves();
        return;
    }

    console.warn('⚠️ [Hata] Hedef hamle listesi öğesi başlangıçta bulunamadı; 5s boyunca yeniden denenecek.');

    // Eğer başlangıçta yoksa başta document body üzerinde eklenen düğümleri izle ve sonrasında gözlemci kur
    const bodyObserver = new MutationObserver((mutations, obs) => {
        node = findMoveListNode();
        if (node) {
            obs.disconnect();
            setupObserver(node);
            extractAndSaveMoves();
        }
    });
    bodyObserver.observe(document.body, { childList: true, subtree: true });

    // 1 dakika sonra halen bulunmadıysa observer'ı kapat
    setTimeout(() => {
        if (!findMoveListNode()) {
            bodyObserver.disconnect();
            console.error('❌ [HATA] Hedef hamle listesi öğesi 5s içinde bulunamadı. Sayfa yapısı farklı olabilir.');
        }
    }, 60000);
})();
