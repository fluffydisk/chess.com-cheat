// background.js

console.log("🧩 [Background] Servis Çalışanı Başlatıldı.");

// Keep track of popup window id (if opened as a persistent window)
chrome.storage.local.get(['popupWindowId'], (res) => {
    // ensure numeric or undefined
    if (res && res.popupWindowId) {
        // nothing to do on startup; we'll validate when clicked
    }
});

// When user clicks the extension action, toggle a persistent popup window (open if closed, close if open)
chrome.action && chrome.action.onClicked && chrome.action.onClicked.addListener(async (tab) => {
    try {
        const res = await new Promise(r => chrome.storage.local.get(['popupWindowId'], r));
        const existingId = res.popupWindowId;
        if (existingId) {
            // If window exists, try to close it (toggle behavior)
            try {
                await new Promise((resolve, reject) => chrome.windows.remove(existingId, () => {
                    if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
                    resolve();
                }));
            } catch (e) {
                // If removal failed (maybe already closed), ignore and continue to create
            }
            chrome.storage.local.remove('popupWindowId');
            return;
        }

        // Create a new popup window showing popup.html
        const popupUrl = chrome.runtime.getURL('popup.html');
        const created = await new Promise((resolve, reject) => chrome.windows.create({ url: popupUrl, type: 'popup', width: 380, height: 640 }, (w) => {
            if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
            resolve(w);
        }));
        if (created && created.id) {
            chrome.storage.local.set({ popupWindowId: created.id });
            // listen for window close to clear stored id
            chrome.windows.onRemoved.addListener(function onRemovedListener(winId) {
                if (winId === created.id) {
                    chrome.storage.local.remove('popupWindowId');
                    try { chrome.windows.onRemoved.removeListener(onRemovedListener); } catch(e){}
                }
            });
        }
    } catch (err) {
        console.error('❌ [Background] popup toggle error:', err);
    }
});

// Background message handler: receive structured game data from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action !== 'saveMoves') return;

    const gameData = request.data || {};
    const { moves = [], white = '', black = '', userSide = '', url = '', timestamp = Date.now() } = gameData;

    // Prepare values to persist
    const dataToSave = {
        currentGameMoves: moves,
        currentGameData: { white, black, userSide, url, timestamp }
    };

    // Update history (keep up to 50 entries)
    chrome.storage.local.get(['gameHistory'], (result) => {
        const history = result.gameHistory || [];
        history.push({ white, black, userSide, moveCount: moves.length, url, timestamp });
        if (history.length > 50) history.shift();
        dataToSave.gameHistory = history;

        chrome.storage.local.set(dataToSave, () => {
            if (chrome.runtime.lastError) {
                console.error('❌ [Background] Depolama Hatası:', chrome.runtime.lastError);
                return;
            }
            console.log(`✅ [Background] ${moves.length} hamle kaydedildi: ${white} vs ${black}`);

            // Show a brief notification (if available)
            if (chrome.notifications) {
                const title = 'Hamle kaydedildi';
                const msg = `${moves.length} hamle: ${white} vs ${black}`;
                chrome.notifications.create({ type: 'basic', title: title, message: msg });
            }
        });
    });

    return false; // signal async response not used
});