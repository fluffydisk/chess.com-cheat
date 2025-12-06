// Popup script: manages UI for Moves and Best Move (Stockfish).
// It reads `chrome.storage.local` keys: currentGameMoves, currentGameData, lastOpenTab.
document.addEventListener('DOMContentLoaded', () => {
  const movesList = document.getElementById('movesList');
  const movesContainer = document.getElementById('movesContainer');
  const gameMeta = document.getElementById('gameMeta');
  const refreshMoves = document.getElementById('refreshMoves');
  const computeBest = document.getElementById('computeBest');
  const bestResult = document.getElementById('bestResult');
  const bestInfo = document.getElementById('bestInfo');
  const depthSelect = document.getElementById('depth');

  // Tab switching function
  function switchTab(tabName) {
    const tabBtns = Array.from(document.querySelectorAll('.tab-btn'));
    tabBtns.forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    if (btn) btn.classList.add('active');
    document.querySelectorAll('.tab-panel').forEach(p => p.style.display = p.id === tabName ? 'block' : 'none');
    // Save selected tab to storage
    chrome.storage.local.set({ lastOpenTab: tabName });
  }

  // Tabs (toggle between Moves and Best Move)
  const tabBtns = Array.from(document.querySelectorAll('.tab-btn'));
  tabBtns.forEach(btn => btn.addEventListener('click', (e) => {
    const tab = btn.getAttribute('data-tab');
    switchTab(tab);
  }));

  // Load last open tab from storage
  try {
    chrome.storage.local.get(['lastOpenTab'], (res) => {
      const lastTab = res.lastOpenTab || 'moves';
      switchTab(lastTab);
    });
  } catch (e) {}

  // Load moves from storage
  try {
    chrome.storage.local.get(['currentGameMoves','currentGameData'], (res) => {
      renderMoves(res.currentGameMoves || [], res.currentGameData || null);
    });
  } catch (e) {}

  // Storage change listener to update moves live
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.currentGameMoves || changes.currentGameData) {
        const moves = (changes.currentGameMoves && changes.currentGameMoves.newValue) || null;
        const meta = (changes.currentGameData && changes.currentGameData.newValue) || null;
        if (moves !== null) renderMoves(moves, meta);
        else chrome.storage.local.get(['currentGameMoves','currentGameData'], (res) => renderMoves(res.currentGameMoves||[], res.currentGameData||null));
      }
    });
  } catch (e) {}

  refreshMoves.addEventListener('click', () => {
    chrome.storage.local.get(['currentGameMoves','currentGameData'], (res) => renderMoves(res.currentGameMoves||[], res.currentGameData||null));
  });

  // Drag-to-scroll implementation for movesContainer
  (function enableDragScroll() {
    if (!movesContainer) return;
    let isDown = false;
    let startY; let startScroll;
    movesContainer.addEventListener('mousedown', (e) => {
      isDown = true; movesContainer.classList.add('active'); startY = e.clientY; startScroll = movesContainer.scrollTop; e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!isDown) return; const dy = e.clientY - startY; movesContainer.scrollTop = startScroll - dy;
    });
    document.addEventListener('mouseup', () => { isDown = false; movesContainer.classList.remove('active'); });
    // Touch support
    movesContainer.addEventListener('touchstart', (e) => { startY = e.touches[0].clientY; startScroll = movesContainer.scrollTop; });
    movesContainer.addEventListener('touchmove', (e) => { const dy = e.touches[0].clientY - startY; movesContainer.scrollTop = startScroll - dy; });
  })();

  function renderMoves(moves, meta) {
    // Normalize moves array
    moves = moves || [];
    movesList.innerHTML = '';
    if (!moves || moves.length === 0) {
      movesList.innerHTML = '<li>Henüz hamle yok.</li>';
    } else {
      moves.forEach((m, idx) => {
        const li = document.createElement('li');
        li.textContent = m;
        // Beyaz hamleleri: 0, 2, 4, ... (çift indeksler)
        // Siyah hamleleri: 1, 3, 5, ... (tek indeksler)
        if (idx % 2 === 0) {
          li.classList.add('white-move');
        } else {
          li.classList.add('black-move');
        }
        movesList.appendChild(li);
      });
    }

    if (meta) {
      const w = meta.white || '';
      const b = meta.black || '';
      const side = meta.userSide || '';
      gameMeta.textContent = `${w} vs ${b} — Siz: ${side || 'unknown'}`;
    } else {
      gameMeta.textContent = 'Oyun bilgisi yok';
    }
  }

  // --- Stockfish worker integration ---
  let engineWorker = null;
  let engineReady = false; // becomes true after worker posts 'readyok'
  try {
    // stockfish.js is built to run as a worker (it sets its own onmessage handler)
    engineWorker = new Worker(chrome.runtime.getURL('stockfish.js'));
    engineWorker.onmessage = (e) => {
      const line = (typeof e.data === 'string') ? e.data : (e.data && e.data.toString && e.data.toString()) || '';
      if (!line) return;
      // reflect engine output for debugging; truncate long messages
      bestInfo.textContent = line.length > 300 ? line.slice(0,300) + '...' : line;
      // mark ready when engine replies 'readyok'
      if (line.trim() === 'readyok') engineReady = true;
      // detect bestmove output
      if (line.startsWith('bestmove')) {
        const parts = line.split(' ');
        const best = parts[1] || '';
        bestResult.textContent = best;
      }
    };
  } catch (err) {
    bestInfo.textContent = 'Worker oluşturulamadı: ' + (err && err.message);
  }

  async function computeBestMove() {
    bestResult.textContent = 'Düşünüyor...';
    bestInfo.textContent = '';
    try {
      const s = await new Promise((res) => chrome.storage.local.get(['currentGameMoves','currentGameData'], res));
      const moves = s.currentGameMoves || [];
      const meta = s.currentGameData || {};

      // Build FEN using chess.js
      if (typeof Chess === 'undefined') {
        bestResult.textContent = 'Chess.js yok; yüklenemedi.';
        bestInfo.textContent = 'ERROR: Chess sınıfı tanımlanmadı.';
        console.error('Chess tanımlanmadı!');
        return;
      }
      const game = new Chess();
      for (const mv of moves) {
        // Convert Swedish notation (=S) to standard (=N) if needed
        const normalizedMove = mv.replace(/=S/i, '=N');
        const ok = game.move(normalizedMove, { sloppy: true });
        if (!ok) {
          console.warn('Hamle uygulanmadı:', normalizedMove);
        }
      }
      const fen = game.fen();
      const depth = parseInt(depthSelect.value || '15', 10);
      if (!engineWorker) {
        bestResult.textContent = 'Engine worker çalışmıyor.';
        return;
      }
      // Ensure engine is ready before asking for a search
      engineReady = false;
      engineWorker.postMessage('uci');
      engineWorker.postMessage('isready');

      // wait up to 5s for readyok
      const readyOk = await new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(false), 5000);
        const check = () => {
          if (engineReady) { clearTimeout(timeout); resolve(true); }
          else setTimeout(check, 50);
        };
        check();
      });

      if (!readyOk) {
        bestResult.textContent = 'Engine hazır değil (timeout).';
        return;
      }

      // Send the position and start search
      engineWorker.postMessage('ucinewgame');
      engineWorker.postMessage('position fen ' + fen);
      engineWorker.postMessage('go depth ' + depth);
    } catch (e) {
      bestResult.textContent = 'Hata: ' + e.message;
      console.error('computeBestMove hatası:', e);
    }
  }

  if (computeBest) {
    computeBest.addEventListener('click', () => {
      computeBestMove();
    });
  }
});
