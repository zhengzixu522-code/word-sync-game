const $ = (id) => document.getElementById(id);
const homeView = $('homeView');
const gameView = $('gameView');
const createBtn = $('createBtn');
const showJoinBtn = $('showJoinBtn');
const joinBox = $('joinBox');
const joinBtn = $('joinBtn');
const roomCodeInput = $('roomCodeInput');
const nickname = $('nickname');
const homeError = $('homeError');
const roomCodeText = $('roomCodeText');
const copyCodeBtn = $('copyCodeBtn');
const roundText = $('roundText');
const waitingPanel = $('waitingPanel');
const playPanel = $('playPanel');
const statusBadge = $('statusBadge');
const timerText = $('timerText');
const revealArea = $('revealArea');
const p1Name = $('p1Name');
const p2Name = $('p2Name');
const p1Word = $('p1Word');
const p2Word = $('p2Word');
const inputArea = $('inputArea');
const promptText = $('promptText');
const wordInput = $('wordInput');
const submitWordBtn = $('submitWordBtn');
const submitHint = $('submitHint');
const gameError = $('gameError');
const matchBanner = $('matchBanner');
const matchText = $('matchText');
const restartBtn = $('restartBtn');
const historyList = $('historyList');
const historyCount = $('historyCount');
const toast = $('toast');

let session = null;
let pollTimer = null;
let timerInterval = null;
let previousHistoryLength = 0;
let previousRound = 1;
let latestState = null;

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[ch]));
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(showToast.t);
  showToast.t = setTimeout(() => toast.classList.add('hidden'), 1600);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    cache: 'no-store',
    ...options
  });
  const data = await response.json().catch(() => ({ ok: false, message: '服务器响应异常。' }));
  if (!response.ok && data.ok !== false) data.ok = false;
  return data;
}

function enterRoom(data) {
  session = { code: data.code, token: data.token, playerNumber: data.playerNumber };
  roomCodeText.textContent = data.code;
  homeView.classList.add('hidden');
  gameView.classList.remove('hidden');
  previousHistoryLength = 0;
  previousRound = 1;
  startPolling();
}

function startPolling() {
  clearInterval(pollTimer);
  refreshState();
  pollTimer = setInterval(refreshState, 550);
}

async function refreshState() {
  if (!session) return;
  try {
    const data = await api(`/api/state?code=${encodeURIComponent(session.code)}&token=${encodeURIComponent(session.token)}`);
    if (!data.ok) return;
    renderState(data.room);
  } catch (_) {}
}

function renderState(room) {
  latestState = room;
  roundText.textContent = room.round;
  renderHistory(room.history || []);

  if (room.playerCount < 2) {
    waitingPanel.classList.remove('hidden');
    playPanel.classList.add('hidden');
    stopCountdown();
    return;
  }

  waitingPanel.classList.add('hidden');
  playPanel.classList.remove('hidden');

  const last = room.history?.[room.history.length - 1];
  const justRevealed = room.history.length > previousHistoryLength;
  const newRound = room.round !== previousRound;

  if (last) renderReveal(last);
  else revealArea.classList.add('hidden');

  if (room.status === 'matched') {
    stopCountdown();
    inputArea.classList.add('hidden');
    matchBanner.classList.remove('hidden');
    restartBtn.classList.remove('hidden');
    statusBadge.textContent = '同频成功';
    if (last) matchText.textContent = `第 ${last.round} 轮，你们同时写出了「${last.words[0].word}」`;
  } else {
    matchBanner.classList.add('hidden');
    restartBtn.classList.add('hidden');
    inputArea.classList.remove('hidden');

    if (room.mySubmitted) setSubmittedState(room.submittedCount);
    else setWritingState(room, justRevealed || newRound);

    if (room.deadline) startCountdown(room.deadline);
    else stopCountdown();
  }

  if (justRevealed && last && !last.same) showToast('词语不同，开始下一轮联想！');
  previousHistoryLength = room.history.length;
  previousRound = room.round;
}

function renderReveal(item) {
  revealArea.classList.remove('hidden');
  const a = item.words[0];
  const b = item.words[1];
  p1Name.textContent = a.nickname || '玩家1';
  p2Name.textContent = b.nickname || '玩家2';
  p1Word.textContent = a.word;
  p2Word.textContent = b.word;
}

function setWritingState(room) {
  gameError.textContent = '';
  wordInput.disabled = false;
  submitWordBtn.disabled = false;
  submitWordBtn.textContent = '锁定这个词';

  if (room.round === 1) {
    statusBadge.textContent = '写下你的词';
    promptText.textContent = '先写下你想到的第一个词';
  } else {
    statusBadge.textContent = '根据刚才两个词继续联想';
    promptText.textContent = '在 20 秒内写下你联想到的下一个词';
  }

  submitHint.textContent = room.submittedCount === 1
    ? '对方已经提交了，你提交后就会同时揭晓。'
    : '提交后，在对方提交前不会显示你的答案。';
}

function setSubmittedState(submittedCount) {
  wordInput.disabled = true;
  submitWordBtn.disabled = true;
  submitWordBtn.textContent = '已锁定';
  statusBadge.textContent = submittedCount === 2 ? '正在揭晓…' : '等待对方提交…';
  submitHint.textContent = '你的词已经锁定，对方现在还看不到。';
}

function startCountdown(deadline) {
  timerText.classList.remove('hidden');
  clearInterval(timerInterval);
  const tick = () => {
    const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    timerText.textContent = left;
    timerText.title = left > 0 ? `剩余 ${left} 秒` : '20 秒已到，仍可提交以避免游戏卡住';
    if (left <= 0) {
      clearInterval(timerInterval);
      timerInterval = null;
      statusBadge.textContent = latestState?.mySubmitted ? '等待对方提交…' : '时间到，尽快提交';
    }
  };
  tick();
  timerInterval = setInterval(tick, 250);
}

function stopCountdown() {
  clearInterval(timerInterval);
  timerInterval = null;
  timerText.classList.add('hidden');
}

function renderHistory(history = []) {
  historyCount.textContent = `${history.length} 轮`;
  if (!history.length) {
    historyList.innerHTML = '<p class="empty-history">还没有揭晓过词语。</p>';
    return;
  }
  historyList.innerHTML = [...history].reverse().map(item => {
    const a = item.words[0];
    const b = item.words[1];
    return `<div class="history-item ${item.same ? 'same' : ''}">
      <span class="history-round">#${item.round}</span>
      <span class="history-word">${escapeHtml(a.word)}</span>
      <span class="history-symbol">${item.same ? '=' : '→'}</span>
      <span class="history-word">${escapeHtml(b.word)}</span>
    </div>`;
  }).join('');
}

showJoinBtn.addEventListener('click', () => {
  joinBox.classList.toggle('hidden');
  if (!joinBox.classList.contains('hidden')) roomCodeInput.focus();
});

createBtn.addEventListener('click', async () => {
  homeError.textContent = '';
  createBtn.disabled = true;
  try {
    const data = await api('/api/create', { method: 'POST', body: JSON.stringify({ nickname: nickname.value }) });
    if (!data.ok) homeError.textContent = data.message || '创建失败';
    else enterRoom(data);
  } catch {
    homeError.textContent = '无法连接服务器。';
  } finally {
    createBtn.disabled = false;
  }
});

showJoinBtn.addEventListener('dblclick', e => e.preventDefault());
joinBtn.addEventListener('click', joinRoom);
roomCodeInput.addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
roomCodeInput.addEventListener('input', () => {
  roomCodeInput.value = roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
});

async function joinRoom() {
  homeError.textContent = '';
  const code = roomCodeInput.value.trim().toUpperCase();
  if (code.length !== 5) return homeError.textContent = '请输入 5 位房间号。';
  joinBtn.disabled = true;
  try {
    const data = await api('/api/join', { method: 'POST', body: JSON.stringify({ code, nickname: nickname.value }) });
    if (!data.ok) homeError.textContent = data.message || '加入失败';
    else enterRoom(data);
  } catch {
    homeError.textContent = '无法连接服务器。';
  } finally {
    joinBtn.disabled = false;
  }
}

copyCodeBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(session?.code || '');
    showToast('房间号已复制');
  } catch {
    showToast(`房间号：${session?.code || ''}`);
  }
});

submitWordBtn.addEventListener('click', submitWord);
wordInput.addEventListener('keydown', e => { if (e.key === 'Enter') submitWord(); });

async function submitWord() {
  if (!session || latestState?.mySubmitted) return;
  const word = wordInput.value.trim();
  gameError.textContent = '';
  if (!word) return gameError.textContent = '先写一个词再提交。';
  submitWordBtn.disabled = true;
  try {
    const data = await api('/api/submit', {
      method: 'POST',
      body: JSON.stringify({ ...session, word })
    });
    if (!data.ok) {
      submitWordBtn.disabled = false;
      gameError.textContent = data.message || '提交失败';
    } else {
      wordInput.value = '';
      await refreshState();
    }
  } catch {
    submitWordBtn.disabled = false;
    gameError.textContent = '提交失败，请检查网络。';
  }
}

restartBtn.addEventListener('click', async () => {
  if (!session) return;
  const data = await api('/api/restart', { method: 'POST', body: JSON.stringify(session) });
  if (data.ok) {
    previousHistoryLength = 0;
    previousRound = 1;
    wordInput.value = '';
    showToast('新游戏开始');
    refreshState();
  }
});

window.addEventListener('beforeunload', () => {
  if (!session) return;
  navigator.sendBeacon('/api/leave', new Blob([JSON.stringify(session)], { type: 'application/json' }));
});
