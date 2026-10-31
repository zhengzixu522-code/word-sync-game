const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const ROUND_SECONDS = 20;
const rooms = new Map();

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 100_000) req.destroy();
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function makeRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function makeToken() {
  return crypto.randomBytes(18).toString('hex');
}

function cleanWord(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 30);
}

function normalizeWord(value) {
  return cleanWord(value).normalize('NFKC').toLocaleLowerCase();
}

function newRoom(code, token, nickname) {
  return {
    code,
    players: new Map([[token, { token, number: 1, nickname: cleanWord(nickname).slice(0, 12) || '玩家1', lastSeen: Date.now() }]]),
    submissions: new Map(),
    history: [],
    round: 1,
    status: 'waiting',
    deadline: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

function getRoomAndPlayer(code, token) {
  const room = rooms.get(String(code || '').toUpperCase());
  if (!room) return {};
  const player = room.players.get(String(token || ''));
  if (!player) return { room };
  player.lastSeen = Date.now();
  return { room, player };
}

function beginTimedRound(room) {
  room.round += 1;
  room.submissions.clear();
  room.status = 'writing';
  room.deadline = Date.now() + ROUND_SECONDS * 1000;
  room.updatedAt = Date.now();
}

function publicState(room, player) {
  const players = [...room.players.values()]
    .sort((a, b) => a.number - b.number)
    .map(p => ({ number: p.number, nickname: p.nickname }));

  return {
    ok: true,
    room: {
      code: room.code,
      playerCount: room.players.size,
      players,
      round: room.round,
      status: room.status,
      deadline: room.deadline,
      history: room.history,
      myPlayerNumber: player.number,
      mySubmitted: room.submissions.has(player.token),
      submittedCount: room.submissions.size
    }
  };
}

function submit(room, player, word) {
  if (room.players.size !== 2) return { ok: false, message: '请等待另一名玩家加入。' };
  if (room.status === 'matched') return { ok: false, message: '这一局已经成功，请重新开始。' };
  if (room.submissions.has(player.token)) return { ok: false, message: '这一轮你已经提交过了。' };

  const cleaned = cleanWord(word);
  if (!cleaned) return { ok: false, message: '请输入一个词语。' };

  room.submissions.set(player.token, cleaned);
  room.updatedAt = Date.now();

  if (room.submissions.size < 2) return { ok: true, revealed: false };

  const players = [...room.players.values()].sort((a, b) => a.number - b.number);
  const words = players.map(p => ({
    player: p.number,
    nickname: p.nickname,
    word: room.submissions.get(p.token)
  }));
  const same = normalizeWord(words[0].word) === normalizeWord(words[1].word);
  const revealedRound = room.round;
  const result = { round: revealedRound, words, same, revealedAt: Date.now() };
  room.history.push(result);

  if (same) {
    room.status = 'matched';
    room.deadline = null;
    room.updatedAt = Date.now();
  } else {
    beginTimedRound(room);
  }

  return { ok: true, revealed: true, result };
}

function restart(room) {
  room.submissions.clear();
  room.history = [];
  room.round = 1;
  room.status = room.players.size === 2 ? 'writing' : 'waiting';
  room.deadline = null;
  room.updatedAt = Date.now();
}

function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const safePath = path.normalize(requested).replace(/^([.][.][/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml'
    };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  try {
    if (req.method === 'POST' && pathname === '/api/create') {
      const body = await readJson(req);
      const code = makeRoomCode();
      const token = makeToken();
      const room = newRoom(code, token, body.nickname);
      rooms.set(code, room);
      return sendJson(res, 200, { ok: true, code, token, playerNumber: 1 });
    }

    if (req.method === 'POST' && pathname === '/api/join') {
      const body = await readJson(req);
      const code = String(body.code || '').trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) return sendJson(res, 404, { ok: false, message: '房间不存在，请检查房间号。' });
      if (room.players.size >= 2) return sendJson(res, 409, { ok: false, message: '这个房间已经有两名玩家了。' });
      const token = makeToken();
      room.players.set(token, { token, number: 2, nickname: cleanWord(body.nickname).slice(0, 12) || '玩家2', lastSeen: Date.now() });
      room.status = 'writing';
      room.updatedAt = Date.now();
      return sendJson(res, 200, { ok: true, code, token, playerNumber: 2 });
    }

    if (req.method === 'GET' && pathname === '/api/state') {
      const { room, player } = getRoomAndPlayer(url.searchParams.get('code'), url.searchParams.get('token'));
      if (!room) return sendJson(res, 404, { ok: false, message: '房间不存在。' });
      if (!player) return sendJson(res, 403, { ok: false, message: '玩家身份已失效。' });
      return sendJson(res, 200, publicState(room, player));
    }

    if (req.method === 'POST' && pathname === '/api/submit') {
      const body = await readJson(req);
      const { room, player } = getRoomAndPlayer(body.code, body.token);
      if (!room || !player) return sendJson(res, 403, { ok: false, message: '房间或玩家身份已失效。' });
      return sendJson(res, 200, submit(room, player, body.word));
    }

    if (req.method === 'POST' && pathname === '/api/restart') {
      const body = await readJson(req);
      const { room, player } = getRoomAndPlayer(body.code, body.token);
      if (!room || !player) return sendJson(res, 403, { ok: false, message: '房间或玩家身份已失效。' });
      restart(room);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && pathname === '/api/leave') {
      const body = await readJson(req).catch(() => ({}));
      const room = rooms.get(String(body.code || '').toUpperCase());
      if (room && room.players.has(String(body.token || ''))) {
        room.players.delete(String(body.token));
        room.submissions.delete(String(body.token));
        if (room.players.size === 0) rooms.delete(room.code);
        else restart(room);
      }
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'GET') return serveStatic(req, res, pathname);
    res.writeHead(405); res.end('Method Not Allowed');
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { ok: false, message: '服务器发生错误。' });
  }
});

// 清理长时间无人使用的房间。
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.updatedAt > 6 * 60 * 60 * 1000) rooms.delete(code);
  }
}, 30 * 60 * 1000).unref();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`同频词语已启动：http://localhost:${PORT}`);
});
