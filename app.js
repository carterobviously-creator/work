// ===========================
// Chore Quest Hub — app.js
// ===========================

// ── State ──────────────────────────────────────────────────
let chores = JSON.parse(localStorage.getItem('chores') || '[]');
let breakPoints = parseInt(localStorage.getItem('breakPoints') || '0', 10);
let communityGames = JSON.parse(localStorage.getItem('communityGames') || '[]');
let aiLog = [];
let currentGame = null;

let breakInterval = null;
let breakSecondsLeft = 0;
let breakTotalSeconds = 0;

// ── Settings ────────────────────────────────────────────────
function openSettings() {
  const panel = document.getElementById('settings-panel');
  const overlay = document.getElementById('settings-overlay');
  const keyInput = document.getElementById('api-key-input');
  keyInput.value = localStorage.getItem('openaiApiKey') || '';
  document.getElementById('api-key-status').textContent = '';
  panel.style.display = 'block';
  overlay.style.display = 'block';
}

function closeSettings() {
  document.getElementById('settings-panel').style.display = 'none';
  document.getElementById('settings-overlay').style.display = 'none';
}

function saveApiKey() {
  const key = document.getElementById('api-key-input').value.trim();
  if (key) {
    localStorage.setItem('openaiApiKey', key);
    document.getElementById('api-key-status').textContent = '✅ API key saved!';
  } else {
    localStorage.removeItem('openaiApiKey');
    document.getElementById('api-key-status').textContent = '🗑️ API key removed.';
  }
}

// ── Daily Game Creation Limit ───────────────────────────────
const DAILY_GAME_LIMIT = 10;

function getDailyCount() {
  const today = new Date().toISOString().slice(0, 10);
  const saved = JSON.parse(localStorage.getItem('gameCreation') || '{}');
  if (saved.gameCreationDate !== today) return 0;
  return saved.gameCreationCount || 0;
}

function incrementDailyCount() {
  const today = new Date().toISOString().slice(0, 10);
  const count = getDailyCount() + 1;
  localStorage.setItem('gameCreation', JSON.stringify({
    gameCreationDate: today,
    gameCreationCount: count,
  }));
}

// ── OpenAI API Call ─────────────────────────────────────────
async function callOpenAI(gameIdea) {
  const apiKey = localStorage.getItem('openaiApiKey');
  if (!apiKey) throw new Error('No API key');

  const prompt = `You are a game developer. Generate a complete, self-contained JavaScript function called \`launchGame(container)\` that creates a fun, playable HTML5 canvas game inside the provided DOM element \`container\`.

Game idea: ${gameIdea}

Requirements:
- Create a canvas element, append it to container
- The game must be fully playable with keyboard or mouse controls
- Include score display, win/lose conditions
- Use bright colors on a dark background
- Keep it under 200 lines of JavaScript
- Return ONLY the raw JavaScript function, no markdown, no explanation, no code fences`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const msg = errBody.error?.message || '';
    if (res.status === 401) throw new Error('Invalid API key. Please check your key in ⚙️ Settings.');
    if (res.status === 429) throw new Error('Rate limit exceeded. Please wait a moment and try again.');
    if (res.status === 400) throw new Error(`Bad request: ${msg}`);
    throw new Error(msg || `OpenAI error ${res.status}`);
  }

  const data = await res.json();
  return data.choices[0].message.content.trim();
}

// ── Game Generation with Countdown ─────────────────────────
const GENERATION_SECONDS = 300; // 5 minutes
// Each polling attempt is 5 s; 60 attempts = 5 min max wait after countdown
const MAX_POLL_ATTEMPTS = 60;

function startGameGeneration(gameIdea) {
  const icons = ['🎲','🃏','🏆','🌌','⚡','🔮','🎯','🛸','🌀'];
  const gameId = 'llm_' + Date.now();
  const icon = icons[Math.floor(Math.random() * icons.length)];

  // Placeholder entry — not yet playable
  const pendingGame = {
    id: gameId,
    icon,
    title: gameIdea,
    diff: 'AI-Generated',
    playable: false,
    generating: true,
  };
  communityGames.push(pendingGame);
  saveCommunityGames();
  renderGameGrid();

  // Start API call immediately in background
  let generatedCode = null;
  let apiError = null;
  callOpenAI(gameIdea)
    .then(code => { generatedCode = code; })
    .catch(err => { apiError = err.message || String(err); });

  // Add countdown message to chat
  const box = document.getElementById('chat-messages');
  const countdownDiv = document.createElement('div');
  countdownDiv.className = 'chat-msg countdown';
  box.appendChild(countdownDiv);
  box.scrollTop = box.scrollHeight;

  let secondsLeft = GENERATION_SECONDS;

  function formatTime(s) {
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  }

  countdownDiv.textContent = `⏳ Generating "${gameIdea}"... ${formatTime(secondsLeft)} remaining`;

  const timer = setInterval(() => {
    secondsLeft--;
    if (secondsLeft > 0) {
      countdownDiv.textContent = `⏳ Generating "${gameIdea}"... ${formatTime(secondsLeft)} remaining`;
      box.scrollTop = box.scrollHeight;
    } else {
      clearInterval(timer);
      countdownDiv.textContent = `✅ Generation complete for "${gameIdea}"!`;

      // Find the pending game and update it
      const idx = communityGames.findIndex(g => g.id === gameId);
      if (idx !== -1) {
        if (apiError) {
          communityGames[idx].generating = false;
          communityGames[idx].playable = false;
          communityGames[idx].error = apiError;
          saveCommunityGames();
          renderGameGrid();
          addChatMessage(`⚠️ Game generation failed: ${apiError}`, 'bot');
        } else if (generatedCode) {
          communityGames[idx].generating = false;
          communityGames[idx].playable = true;
          communityGames[idx].launchCode = generatedCode;
          saveCommunityGames();
          renderGameGrid();
          addChatMessage(`🎉 Your game "${gameIdea}" is ready! Head to the 🎮 Game Hub to play it!`, 'bot');
        } else {
          // API still running — wait a bit more and retry reveal
          addChatMessage(`⏳ Still finalizing "${gameIdea}"… please wait a moment then try the Game Hub.`, 'bot');
          waitForApiAndReveal(gameId, gameIdea, () => generatedCode, () => apiError);
        }
      }
      box.scrollTop = box.scrollHeight;
    }
  }, 1000);
}

function waitForApiAndReveal(gameId, gameIdea, getCode, getError) {
  let attempts = 0;
  const poller = setInterval(() => {
    attempts++;
    const code = getCode();
    const err = getError();
    if (code || err || attempts > MAX_POLL_ATTEMPTS) {
      clearInterval(poller);
      const idx = communityGames.findIndex(g => g.id === gameId);
      if (idx === -1) return;
      if (err) {
        communityGames[idx].generating = false;
        communityGames[idx].error = err;
        saveCommunityGames();
        renderGameGrid();
        addChatMessage(`⚠️ Game generation failed: ${err}`, 'bot');
      } else if (code) {
        communityGames[idx].generating = false;
        communityGames[idx].playable = true;
        communityGames[idx].launchCode = code;
        saveCommunityGames();
        renderGameGrid();
        addChatMessage(`🎉 Your game "${gameIdea}" is ready! Head to the 🎮 Game Hub to play it!`, 'bot');
      } else {
        communityGames[idx].generating = false;
        saveCommunityGames();
        renderGameGrid();
        addChatMessage(`⚠️ Game generation timed out for "${gameIdea}". Please try again.`, 'bot');
      }
    }
  }, 5000);
}

// ── Default Games ───────────────────────────────────────────
const defaultGames = [
  { id: 'snake',   icon: '🐍', title: 'Snake',         diff: 'Easy',   playable: true  },
  { id: 'memory',  icon: '🧩', title: 'Memory Match',  diff: 'Easy',   playable: true  },
  { id: 'breakout',icon: '🧱', title: 'Breakout',      diff: 'Medium', playable: true  },
  { id: 'space',   icon: '🚀', title: 'Space Shooter', diff: 'Medium', playable: false },
  { id: 'race',    icon: '🏎️', title: 'Race Track',    diff: 'Hard',   playable: false },
  { id: 'soccer',  icon: '⚽', title: 'Soccer Kick',   diff: 'Easy',   playable: false },
];

// ── Tab Navigation ──────────────────────────────────────────
function showTab(id) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  const btns = document.querySelectorAll('.tab-btn');
  const map = { chores: 0, break: 1, gamehub: 2, aibuddy: 3, chatbot: 4 };
  if (map[id] !== undefined) btns[map[id]].classList.add('active');
}

// ── Persistence ─────────────────────────────────────────────
function saveChores() { localStorage.setItem('chores', JSON.stringify(chores)); }
function saveBreakPoints() { localStorage.setItem('breakPoints', breakPoints); }
function saveCommunityGames() { localStorage.setItem('communityGames', JSON.stringify(communityGames)); }

// ── Chore Tracker ───────────────────────────────────────────
function renderChores() {
  const list = document.getElementById('chore-list');
  list.innerHTML = '';
  chores.forEach((c, i) => {
    const li = document.createElement('li');
    li.className = 'chore-item' + (c.done ? ' done' : '');
    const icons = { low: '🟢', medium: '🟡', high: '🔴' };
    li.innerHTML = `
      <span class="priority">${icons[c.priority] || '🟡'}</span>
      <span class="name">${escHtml(c.text)}</span>
      ${!c.done ? `<button onclick="completeChore(${i})">✅ Done</button>` : ''}
      <button onclick="deleteChore(${i})" style="background:#c0392b">🗑</button>
    `;
    list.appendChild(li);
  });
  updateBreakPointsDisplay();
}

function addChore() {
  const input = document.getElementById('chore-input');
  const priority = document.getElementById('chore-priority').value;
  const text = input.value.trim();
  if (!text) return;
  chores.push({ text, priority, done: false });
  input.value = '';
  saveChores();
  renderChores();
}

function completeChore(i) {
  if (chores[i].done) return;
  chores[i].done = true;
  const pts = { high: 3, medium: 2, low: 1 };
  breakPoints += pts[chores[i].priority] || 1;
  saveChores();
  saveBreakPoints();
  renderChores();
  checkBreakEarned();
}

function deleteChore(i) {
  chores.splice(i, 1);
  saveChores();
  renderChores();
}

function checkBreakEarned() {
  const bar = document.getElementById('break-earned');
  if (breakPoints >= 5 && !breakInterval) {
    bar.style.display = 'flex';
  } else {
    bar.style.display = 'none';
  }
}

function updateBreakPointsDisplay() {
  document.getElementById('break-points').textContent = `⭐ Break Points: ${breakPoints}`;
  checkBreakEarned();
}

// ── Break Timer ─────────────────────────────────────────────
function startBreak() {
  const mins = parseInt(document.getElementById('break-length').value, 10);
  breakTotalSeconds = mins * 60;
  breakSecondsLeft = breakTotalSeconds;

  document.getElementById('break-timer-display').style.display = 'block';

  // hide the start controls
  document.getElementById('break-pick-label').style.display = 'none';
  document.getElementById('break-length').style.display = 'none';
  document.getElementById('break-start-btn').style.display = 'none';

  updateTimerDisplay();
  showTab('gamehub');

  breakInterval = setInterval(() => {
    breakSecondsLeft--;
    updateTimerDisplay();
    if (breakSecondsLeft <= 0) {
      clearInterval(breakInterval);
      breakInterval = null;
      onBreakEnd();
    }
  }, 1000);

  addAiLog('⏱️ Break started! Enjoy the Game Hub!');
}

function updateTimerDisplay() {
  const m = Math.floor(breakSecondsLeft / 60).toString().padStart(2, '0');
  const s = (breakSecondsLeft % 60).toString().padStart(2, '0');
  document.getElementById('timer-text').textContent = `${m}:${s}`;
  const pct = breakTotalSeconds > 0 ? (breakSecondsLeft / breakTotalSeconds) * 100 : 0;
  document.getElementById('progress-fill').style.width = pct + '%';
}

function endBreak() {
  if (breakInterval) { clearInterval(breakInterval); breakInterval = null; }
  onBreakEnd();
}

function onBreakEnd() {
  breakSecondsLeft = 0;
  document.getElementById('timer-text').textContent = '00:00';
  document.getElementById('progress-fill').style.width = '0%';
  document.getElementById('break-timer-display').style.display = 'none';

  // Restore break controls
  document.getElementById('break-pick-label').style.display = '';
  document.getElementById('break-length').style.display = '';
  document.getElementById('break-start-btn').style.display = '';

  // AI saves game
  addAiLog('💾 AI Buddy saved your game progress!');
  addAiLog('🔄 Break over — back to chores!');
  document.getElementById('ai-status').textContent = 'I saved your game progress! Now back to your chores. 🧹';

  // Deduct 5 break points
  if (breakPoints >= 5) { breakPoints -= 5; } else { breakPoints = 0; }
  saveBreakPoints();

  closeGame();
  showTab('chores');
  renderChores();
}

// ── Game Hub ────────────────────────────────────────────────
function renderGameGrid() {
  const grid = document.getElementById('game-grid');
  grid.innerHTML = '';
  const allGames = [...defaultGames, ...communityGames];
  allGames.forEach(g => {
    const card = document.createElement('div');
    card.className = 'game-card' + (g.generating ? ' generating' : '');
    const statusHtml = g.generating
      ? `<div class="game-status">⏳ Generating…</div>`
      : g.error
        ? `<div class="game-status" style="color:#e74c3c">⚠️ Failed</div>`
        : '';
    card.innerHTML = `
      <div class="game-icon">${g.icon}</div>
      <div class="game-title">${escHtml(g.title)}</div>
      <div class="game-diff">${escHtml(g.diff || 'Easy')}</div>
      ${statusHtml}
    `;
    card.onclick = () => openGame(g);
    grid.appendChild(card);
  });
}

function openGame(g) {
  if (g.generating) {
    addChatMessage(`⏳ "${g.title}" is still being generated. Please wait for the countdown to finish!`, 'bot');
    showTab('chatbot');
    return;
  }
  currentGame = g;
  document.getElementById('game-grid').style.display = 'none';
  document.getElementById('game-frame-wrap').style.display = 'block';
  const container = document.getElementById('active-game');
  container.innerHTML = '';

  if (g.id === 'snake')         { launchSnake(container); }
  else if (g.id === 'memory')   { launchMemory(container); }
  else if (g.id === 'breakout') { launchBreakout(container); }
  else if (g.launchCode)        { launchLLMGame(container, g); }
  else                          { launchComingSoon(container, g); }
}

function closeGame() {
  const ag = document.getElementById('active-game');
  const cvs = ag ? ag.querySelector('canvas') : null;
  if (cvs && cvs._cleanup) cvs._cleanup();
  currentGame = null;
  const grid = document.getElementById('game-grid');
  const wrap = document.getElementById('game-frame-wrap');
  if (grid) grid.style.display = '';
  if (wrap) wrap.style.display = 'none';
  if (ag) ag.innerHTML = '';
}

// ── Snake Game ──────────────────────────────────────────────
function launchSnake(container) {
  container.style.flexDirection = 'column';
  container.style.padding = '0';
  const scoreEl = document.createElement('p');
  scoreEl.style.cssText = 'color:#48dbfb;font-size:1.1em;margin:10px 0 4px;';
  scoreEl.textContent = 'Score: 0';
  const canvas = document.createElement('canvas');
  canvas.width = 400; canvas.height = 400;
  canvas.style.cssText = 'display:block;background:#0d1b2a;border-radius:8px;';
  const info = document.createElement('p');
  info.style.cssText = 'color:#aac;font-size:12px;margin-top:8px;';
  info.textContent = '🎮 Arrow keys or WASD to move';
  container.appendChild(scoreEl);
  container.appendChild(canvas);
  container.appendChild(info);

  const ctx = canvas.getContext('2d');
  const CELL = 20, COLS = 20, ROWS = 20;
  let snake = [{ x: 10, y: 10 }];
  let dir = { x: 1, y: 0 };
  let nextDir = { x: 1, y: 0 };
  let food = randomFood();
  let score = 0;
  let gameOver = false;
  let loop = null;

  function randomFood() {
    return { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
  }

  function draw() {
    ctx.fillStyle = '#0d1b2a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    // food
    ctx.fillStyle = '#f7971e';
    ctx.beginPath();
    ctx.arc(food.x * CELL + CELL / 2, food.y * CELL + CELL / 2, CELL / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    // snake
    snake.forEach((seg, i) => {
      ctx.fillStyle = i === 0 ? '#6c63ff' : '#48dbfb';
      ctx.fillRect(seg.x * CELL + 1, seg.y * CELL + 1, CELL - 2, CELL - 2);
    });
    if (gameOver) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 28px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Game Over!', canvas.width / 2, canvas.height / 2 - 20);
      ctx.font = '18px sans-serif';
      ctx.fillText(`Score: ${score}`, canvas.width / 2, canvas.height / 2 + 14);
      ctx.fillText('Press Space / Tap to restart', canvas.width / 2, canvas.height / 2 + 44);
    }
  }

  function step() {
    dir = nextDir;
    const head = { x: (snake[0].x + dir.x + COLS) % COLS, y: (snake[0].y + dir.y + ROWS) % ROWS };
    if (snake.some(s => s.x === head.x && s.y === head.y)) { gameOver = true; draw(); return; }
    snake.unshift(head);
    if (head.x === food.x && head.y === food.y) {
      score++;
      scoreEl.textContent = `Score: ${score}`;
      food = randomFood();
    } else { snake.pop(); }
    draw();
  }

  function restart() {
    snake = [{ x: 10, y: 10 }]; dir = { x: 1, y: 0 }; nextDir = { x: 1, y: 0 };
    food = randomFood(); score = 0; gameOver = false;
    scoreEl.textContent = 'Score: 0';
    if (loop) clearInterval(loop);
    loop = setInterval(step, 130);
  }

  const keyMap = {
    ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
    ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
    w: { x: 0, y: -1 }, s: { x: 0, y: 1 }, a: { x: -1, y: 0 }, d: { x: 1, y: 0 },
  };

  const keyHandler = (e) => {
    if (gameOver && e.key === ' ') { restart(); return; }
    if (keyMap[e.key]) {
      const nd = keyMap[e.key];
      if (nd.x !== -dir.x || nd.y !== -dir.y) nextDir = nd;
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) e.preventDefault();
    }
  };
  document.addEventListener('keydown', keyHandler);

  canvas.addEventListener('click', () => { if (gameOver) restart(); });

  // cleanup when game is closed
  canvas._cleanup = () => { clearInterval(loop); document.removeEventListener('keydown', keyHandler); };

  restart();
}

// ── Memory Match ────────────────────────────────────────────
function launchMemory(container) {
  container.style.flexDirection = 'column';
  container.style.padding = '16px';
  const emojis = ['🍕','🌟','🦄','🎸','🌈','🐉','🎩','🍀'];
  let cards = [...emojis, ...emojis].sort(() => Math.random() - 0.5)
    .map((e, i) => ({ id: i, emoji: e, flipped: false, matched: false }));
  let selected = [];
  let moves = 0;
  let locked = false;

  const header = document.createElement('p');
  header.style.cssText = 'color:#48dbfb;font-size:1.1em;margin-bottom:12px;';
  header.textContent = 'Moves: 0';

  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(4,70px);gap:8px;justify-content:center;';

  container.appendChild(header);
  container.appendChild(grid);

  function renderCards() {
    grid.innerHTML = '';
    cards.forEach(c => {
      const el = document.createElement('div');
      el.style.cssText = `width:70px;height:70px;border-radius:10px;display:flex;align-items:center;
        justify-content:center;font-size:2em;cursor:pointer;transition:all 0.2s;
        background:${c.flipped || c.matched ? '#2a5298' : '#1e3a5f'};
        border:2px solid ${c.matched ? '#6c63ff' : '#2a5298'};
        ${c.matched ? 'opacity:0.5;' : ''}`;
      el.textContent = c.flipped || c.matched ? c.emoji : '❓';
      if (!c.matched && !c.flipped) el.onclick = () => flipCard(c);
      grid.appendChild(el);
    });
  }

  function flipCard(c) {
    if (locked || c.flipped || c.matched) return;
    c.flipped = true; selected.push(c); renderCards();
    if (selected.length === 2) {
      locked = true; moves++;
      header.textContent = `Moves: ${moves}`;
      if (selected[0].emoji === selected[1].emoji) {
        selected[0].matched = selected[1].matched = true;
        selected = []; locked = false;
        renderCards();
        if (cards.every(c => c.matched)) {
          setTimeout(() => {
            grid.innerHTML = `<p style="color:#ffd200;font-size:1.4em;text-align:center;grid-column:1/-1">
              🎉 You win in ${moves} moves!</p>`;
          }, 400);
        }
      } else {
        setTimeout(() => {
          selected.forEach(c => c.flipped = false);
          selected = []; locked = false; renderCards();
        }, 900);
      }
    }
  }

  renderCards();
  const info = document.createElement('p');
  info.style.cssText = 'color:#aac;font-size:12px;margin-top:12px;';
  info.textContent = 'Click cards to flip and find matching pairs!';
  container.appendChild(info);
}

// ── Breakout ────────────────────────────────────────────────
function launchBreakout(container) {
  container.style.flexDirection = 'column';
  container.style.padding = '0';
  const scoreEl = document.createElement('p');
  scoreEl.style.cssText = 'color:#48dbfb;font-size:1.1em;margin:10px 0 4px;';
  scoreEl.textContent = 'Score: 0';
  const canvas = document.createElement('canvas');
  canvas.width = 400; canvas.height = 420;
  canvas.style.cssText = 'display:block;background:#0d1b2a;border-radius:8px;';
  const info = document.createElement('p');
  info.style.cssText = 'color:#aac;font-size:12px;margin-top:8px;';
  info.textContent = '← → Arrow keys or A/D to move paddle';
  container.appendChild(scoreEl);
  container.appendChild(canvas);
  container.appendChild(info);

  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const ROWS = 5, COLS = 10, BPAD = 4;
  const BW = (W - BPAD * (COLS + 1)) / COLS, BH = 20;

  let score = 0, lives = 3, gameOver = false, win = false;
  let paddle = { x: W / 2 - 40, w: 80, h: 12, y: H - 30, speed: 7 };
  let ball = { x: W / 2, y: H - 60, r: 8, vx: 4, vy: -4 };
  let bricks = [];
  const colors = ['#e74c3c','#e67e22','#f1c40f','#2ecc71','#3498db'];
  let keys = {};

  function initBricks() {
    bricks = [];
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        bricks.push({ x: BPAD + c * (BW + BPAD), y: 40 + r * (BH + BPAD), alive: true, color: colors[r] });
  }

  function draw() {
    ctx.fillStyle = '#0d1b2a'; ctx.fillRect(0, 0, W, H);
    // bricks
    bricks.filter(b => b.alive).forEach(b => {
      ctx.fillStyle = b.color; ctx.beginPath();
      ctx.roundRect(b.x, b.y, BW, BH, 4); ctx.fill();
    });
    // paddle
    ctx.fillStyle = '#6c63ff'; ctx.beginPath();
    ctx.roundRect(paddle.x, paddle.y, paddle.w, paddle.h, 6); ctx.fill();
    // ball
    ctx.fillStyle = '#48dbfb'; ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2); ctx.fill();
    // lives
    ctx.fillStyle = '#aac'; ctx.font = '14px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`Lives: ${'❤️'.repeat(lives)}`, 8, 24);
    // overlay
    if (gameOver || win) {
      ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = win ? '#ffd200' : '#e74c3c'; ctx.font = 'bold 28px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(win ? '🎉 You Win!' : '💀 Game Over', W / 2, H / 2 - 20);
      ctx.fillStyle = '#fff'; ctx.font = '18px sans-serif';
      ctx.fillText(`Score: ${score}`, W / 2, H / 2 + 16);
      ctx.fillText('Press Space / Tap to restart', W / 2, H / 2 + 46);
    }
  }

  function step() {
    if (gameOver || win) return;
    if (keys['ArrowLeft'] || keys['a']) paddle.x = Math.max(0, paddle.x - paddle.speed);
    if (keys['ArrowRight'] || keys['d']) paddle.x = Math.min(W - paddle.w, paddle.x + paddle.speed);

    ball.x += ball.vx; ball.y += ball.vy;
    if (ball.x - ball.r < 0 || ball.x + ball.r > W) ball.vx *= -1;
    if (ball.y - ball.r < 0) ball.vy *= -1;
    if (ball.y + ball.r > H) { lives--; if (lives <= 0) { gameOver = true; } else { resetBall(); } }
    // paddle
    if (ball.y + ball.r >= paddle.y && ball.y + ball.r <= paddle.y + paddle.h &&
        ball.x >= paddle.x && ball.x <= paddle.x + paddle.w) {
      ball.vy = -Math.abs(ball.vy);
      ball.vx = ((ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2)) * 6;
    }
    // bricks
    bricks.filter(b => b.alive).forEach(b => {
      if (ball.x + ball.r > b.x && ball.x - ball.r < b.x + BW &&
          ball.y + ball.r > b.y && ball.y - ball.r < b.y + BH) {
        b.alive = false; ball.vy *= -1; score += 10;
        scoreEl.textContent = `Score: ${score}`;
      }
    });
    if (bricks.every(b => !b.alive)) win = true;
    draw();
  }

  function resetBall() {
    ball.x = W / 2; ball.y = H - 60; ball.vx = 4 * (Math.random() > 0.5 ? 1 : -1); ball.vy = -4;
  }

  function restart() {
    score = 0; lives = 3; gameOver = false; win = false;
    scoreEl.textContent = 'Score: 0';
    paddle.x = W / 2 - 40;
    resetBall(); initBricks();
  }

  const keyHandler = (e) => {
    keys[e.key] = e.type === 'keydown';
    if (e.type === 'keydown') {
      if ((gameOver || win) && e.key === ' ') restart();
      if (['ArrowLeft','ArrowRight'].includes(e.key)) e.preventDefault();
    }
  };
  document.addEventListener('keydown', keyHandler);
  document.addEventListener('keyup', keyHandler);
  canvas.addEventListener('click', () => { if (gameOver || win) restart(); });

  canvas._cleanup = () => {
    clearInterval(loopId);
    document.removeEventListener('keydown', keyHandler);
    document.removeEventListener('keyup', keyHandler);
  };

  initBricks();
  const loopId = setInterval(step, 16);
}

// ── Coming Soon ─────────────────────────────────────────────
function launchComingSoon(container, g) {
  container.style.flexDirection = 'column';
  container.style.padding = '20px';
  container.innerHTML = `
    <div style="font-size:4em;margin-bottom:16px">${g.icon}</div>
    <h3 style="color:#ffd200;margin-bottom:8px">${escHtml(g.title)}</h3>
    <p style="color:#aac;margin-bottom:20px">🚧 Coming soon! This game is being built.</p>
    <button onclick="showTab('aibuddy')">🤖 Ask AI Buddy for Help</button>
  `;
}

function launchLLMGame(container, g) {
  container.style.flexDirection = 'column';
  container.style.padding = '0';

  // Run the LLM-generated code inside a sandboxed iframe so it cannot
  // access or modify the parent page — "allow-scripts" only, no same-origin.
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'width:100%;flex:1;min-height:420px;border:none;border-radius:14px;background:#0d1b2a;';
  iframe.sandbox = 'allow-scripts';

  const escapedCode = g.launchCode
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  iframe.srcdoc = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0d1b2a; color: #eee; font-family: sans-serif; overflow: hidden; }
  #error { color: #e74c3c; padding: 20px; font-size: 14px; }
</style>
</head>
<body>
<script>
(function() {
  try {
    ${g.launchCode}
    launchGame(document.body);
  } catch (e) {
    var d = document.createElement('div');
    d.id = 'error';
    d.textContent = '\u26a0\ufe0f Game error: ' + e.message;
    document.body.appendChild(d);
  }
})();
<\/script>
</body>
</html>`;

  container.appendChild(iframe);
}

// ── AI Buddy ────────────────────────────────────────────────
function addAiLog(msg) {
  aiLog.unshift({ time: new Date().toLocaleTimeString(), msg });
  if (aiLog.length > 20) aiLog.pop();
  renderAiLog();
}

function renderAiLog() {
  const log = document.getElementById('ai-log');
  log.innerHTML = aiLog.map(e =>
    `<div class="ai-log-entry"><span style="color:#6c63ff">[${e.time}]</span> ${escHtml(e.msg)}</div>`
  ).join('');
}

const aiPlayMessages = [
  "🕹️ Activating turbo mode… I'm on it!",
  "🤖 Analyzing patterns… scoring combos!",
  "💡 Pro strats engaged. Watch and learn!",
  "🚀 I took over! Your high score is safe with me.",
  "🎮 AI autopilot enabled. Sit back and relax!",
];

const aiHelpMessages = [
  "💡 Tip: Focus on clearing the top rows first in Breakout!",
  "🐍 In Snake, cut corners to give yourself more room.",
  "🧩 For Memory Match, track the first card you flip each turn.",
  "🎯 General strategy: take it slow and look before you move.",
  "🔑 The secret? Practice! Every run teaches you something new.",
];

function aiBuddyPlay() {
  const msg = aiPlayMessages[Math.floor(Math.random() * aiPlayMessages.length)];
  document.getElementById('ai-status').textContent = msg;
  addAiLog(`🎮 Play For Me: ${msg}`);
}

function aiBuddyHelp() {
  const game = currentGame ? currentGame.title : 'current game';
  const tip = aiHelpMessages[Math.floor(Math.random() * aiHelpMessages.length)];
  const out = `[${game}] ${tip}`;
  document.getElementById('ai-status').textContent = out;
  addAiLog(`💡 Help: ${out}`);
}

function aiBuddySave() {
  const game = currentGame ? currentGame.title : 'your game';
  const msg = `💾 Saved progress for ${game} at ${new Date().toLocaleTimeString()}!`;
  document.getElementById('ai-status').textContent = msg;
  addAiLog(msg);
}

// ── Chatbot ─────────────────────────────────────────────────
function addChatMessage(text, role) {
  const box = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;
  div.textContent = text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

const botResponses = {
  chore: [
    "🧹 Chores are the path to freedom! Complete them to earn ⭐ break points.",
    "💪 You've got this! High-priority chores earn 3 break points each.",
    "🏆 Pro tip: knock out the hard chores first — you'll feel amazing after!",
  ],
  game: [
    "🎮 The Game Hub has Snake, Memory Match, Breakout, and more!",
    "🐍 Try Snake first — it's a classic and super fun!",
    "🧩 Memory Match is great for a quick mental workout.",
    "💡 AI Buddy can help you with tough games — just ask!",
  ],
  break: [
    "⏸️ Breaks are important! Head to the Break tab and choose a duration.",
    "🌟 You need 5 break points to earn a break. Keep completing chores!",
    "🎯 A good break makes you more productive when you return to chores!",
  ],
  ai: [
    "🤖 I'm your AI Buddy! I can play games, give tips, and save your progress.",
    "💾 Use 'Save My Game Progress' in the AI Buddy tab before your break ends!",
    "🚀 When a game is too hard, I can take over — just hit 'Play a Game For Me'!",
  ],
  hi: [
    "Hey there! 👋 I'm your Chore Quest buddy. Ask me about chores, games, or breaks!",
    "Hello! 🌟 Ready to crush some chores and earn game time?",
    "Hi! 😄 Need help getting started? Just ask about anything in the app!",
  ],
  default: [
    "Hmm, I'm not sure about that! Try asking about chores, games, breaks, or the AI Buddy.",
    "Great question! Try 'create game: [name]' to add your own game to the hub!",
    "I'm still learning, but I'm here to help! Ask me about anything in Chore Quest Hub.",
  ],
};

function getBotReply(text) {
  const t = text.toLowerCase();
  if (/\b(hi|hello|hey|howdy|sup)\b/.test(t)) return pick(botResponses.hi);
  if (/chore|task|homework|work/.test(t)) return pick(botResponses.chore);
  if (/game|play|snake|memory|breakout|space|race|soccer/.test(t)) return pick(botResponses.game);
  if (/break|rest|timer|point/.test(t)) return pick(botResponses.break);
  if (/ai|buddy|help|robot|bot/.test(t)) return pick(botResponses.ai);
  return pick(botResponses.default);
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function sendChat() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  addChatMessage(text, 'user');

  // Special: create game command
  const m = text.match(/^create\s+game\s*:\s*(.+)/i);
  if (m) {
    const gameIdea = m[1].trim();

    // Check API key
    const apiKey = localStorage.getItem('openaiApiKey');
    if (!apiKey) {
      setTimeout(() => addChatMessage('🔑 Please set your OpenAI API key in ⚙️ Settings first!', 'bot'), 400);
      return;
    }

    // Check daily limit
    const count = getDailyCount();
    if (count >= DAILY_GAME_LIMIT) {
      setTimeout(() => addChatMessage("🚫 You've reached your 10 game limit for today! Come back tomorrow.", 'bot'), 400);
      return;
    }

    incrementDailyCount();
    setTimeout(() => {
      addChatMessage(`🎮 Game creation started! ⏳ Generating "${gameIdea}"... Check back in 5 minutes!`, 'bot');
      startGameGeneration(gameIdea);
    }, 400);
    return;
  }

  setTimeout(() => addChatMessage(getBotReply(text), 'bot'), 400 + Math.random() * 400);
}

// ── Helpers ─────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Polyfill for roundRect (Safari / older browsers)
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    this.beginPath();
    this.moveTo(x + r, y);
    this.lineTo(x + w - r, y);
    this.quadraticCurveTo(x + w, y, x + w, y + r);
    this.lineTo(x + w, y + h - r);
    this.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    this.lineTo(x + r, y + h);
    this.quadraticCurveTo(x, y + h, x, y + h - r);
    this.lineTo(x, y + r);
    this.quadraticCurveTo(x, y, x + r, y);
    this.closePath();
  };
}

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  renderChores();
  renderGameGrid();
  renderAiLog();
  addChatMessage("👋 Hey! I'm your Chore Quest Buddy. Ask me about chores, games, or breaks! Try: create game: [your idea] 🚀", 'bot');
});
