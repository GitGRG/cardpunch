// index.js (Server-side with rooms)

const express = require('express');
const app     = express();
const http    = require('http').createServer(app);
const io      = require('socket.io')(http);

app.use(express.static('public'));

// ─── Room management ─────────────────────────
const games = {}; // roomId → game state

// expose a webpage listing all active rooms
app.get('/rooms', (req, res) => {
  let html = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Active Games</title>
        <style>
          body { background: #0c0c0c; color: #eee; font-family: sans-serif; padding: 20px; }
          h1 { margin-bottom: 1em; }
          ul { list-style: none; padding: 0; }
          li { margin: 0.5em 0; }
          a { color: #4af; text-decoration: none; }
          a:hover { text-decoration: underline; }
        </style>
      </head>
      <body>
        <h1>Active Rooms</h1>
        <ul>
  `;

  for (const [roomId, game] of Object.entries(games)) {
    html += `<li>
      <strong>${roomId}</strong> (${game.players.length}/2)
      ${game.players.length < 2
        ? `<a href="/?room=${encodeURIComponent(roomId)}">Join</a>`
        : `<em>Full</em>`}
    </li>`;
  }

  html += `
        </ul>
      </body>
    </html>
  `;
  res.send(html);
});

// Layout constants (must match your client CSS)
const WIDTH            = 500;
const HEIGHT           = 500;
const DOT_COUNT        = 3;
const DOT_SIZE         = 20;
const DOT_MARGIN       = 10;
const DOT_LEFT_OFFSET  = 10;
const DOT_RIGHT_OFFSET = WIDTH - DOT_SIZE - DOT_LEFT_OFFSET;
const HEX_COUNT        = 3;
const SQUARE_COUNT     = 10;
const SQUARE_MARGIN    = 10;

// Shuffle helper
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Build decks
function createMainDeck() {
  const d = [];
  for (let i = 1; i <= 54; i++) d.push(i.toString().padStart(2, '0'));
  return shuffle(d);
}
function createSpecialDeck() {
  const d = [];
  for (let i = 1; i <= 10; i++) d.push(`glads/${i.toString().padStart(2, '0')}`);
  return shuffle(d);
}

// Initialize dot positions
function initDots() {
  const dots = [];
  const totalH = DOT_COUNT * DOT_SIZE + (DOT_COUNT - 1) * DOT_MARGIN;
  const startY = (HEIGHT - totalH) / 2;
  // Left column
  for (let i = 0; i < DOT_COUNT; i++) {
    dots.push({ x: DOT_LEFT_OFFSET, y: startY + i * (DOT_SIZE + DOT_MARGIN) });
  }
  // Right column
  for (let i = 0; i < DOT_COUNT; i++) {
    dots.push({ x: DOT_RIGHT_OFFSET, y: startY + i * (DOT_SIZE + DOT_MARGIN) });
  }
  return dots;
}

// Initialize hexagon positions and values
function initHexes() {
  const hexes = [];
  const totalH = DOT_COUNT * DOT_SIZE + (DOT_COUNT - 1) * DOT_MARGIN;
  const startY = (HEIGHT - totalH) / 2;
  const hexY   = startY - DOT_MARGIN - DOT_SIZE;
  // Three hexes above left column
  for (let i = 0; i < HEX_COUNT; i++) {
    hexes.push({ x: DOT_LEFT_OFFSET, y: hexY - i * (DOT_SIZE + DOT_MARGIN), value: 20 });
  }
  // Three hexes above right column
  for (let i = 0; i < HEX_COUNT; i++) {
    hexes.push({ x: DOT_RIGHT_OFFSET, y: hexY - i * (DOT_SIZE + DOT_MARGIN), value: 20 });
  }
  return hexes;
}

// Initialize square positions and values
function initSquares() {
  const squares = [];
  const totalW = SQUARE_COUNT * DOT_SIZE + (SQUARE_COUNT - 1) * SQUARE_MARGIN;
  const startX = (WIDTH - totalW) / 2;
  const topY   = DOT_MARGIN;
  const botY   = HEIGHT - DOT_MARGIN - DOT_SIZE;
  // Top row
  for (let i = 0; i < SQUARE_COUNT; i++) {
    squares.push({ x: startX + i * (DOT_SIZE + SQUARE_MARGIN), y: topY, value: 6 });
  }
  // Bottom row
  for (let i = 0; i < SQUARE_COUNT; i++) {
    squares.push({ x: startX + i * (DOT_SIZE + SQUARE_MARGIN), y: botY, value: 6 });
  }
  return squares;
}
// ────────────────────────────────────────────────

io.on('connection', socket => {
  let room, game;

  // helper to broadcast hand counts
  function broadcastHandCounts() {
    if (!game) return;
    const counts = game.players.map(id => ({
      id,
      count: (game.hands[id] || []).length
    }));
    io.in(room).emit('hand-counts', counts);
  }

  // 1) Client joins a room
  socket.on('join-room', roomId => {
    room = roomId;

    // Create new game state if needed
    if (!games[room]) {
      games[room] = {
        players: [],
        hands: {},
        table: [],
        deck: createMainDeck(),
        specialDeck: createSpecialDeck(),
        dotPositions: initDots(),
        hexPositions: initHexes(),
        squarePositions: initSquares()
      };
    }
    game = games[room];

    // Enforce two players max
    if (game.players.length >= 2) {
      return socket.emit('room-full');
    }

    // Join socket.io room
    socket.join(room);
    game.players.push(socket.id);
    game.hands[socket.id] = [];

    // Initial sync just to this client
    socket.emit('joined',       game.players.length);
    socket.emit('your-hand',    game.hands[socket.id]);
    socket.emit('table-update', game.table);
    socket.emit('dots-update',  game.dotPositions);
    socket.emit('hexes-update', game.hexPositions);
    socket.emit('squares-update', game.squarePositions);

    // broadcast updated counts
    broadcastHandCounts();
  });

  // 2) Draw / shuffle
  socket.on('draw-card', () => {
    if (!game || !game.deck.length) return;
    const c = game.deck.pop();
    game.hands[socket.id].push(c);
    socket.emit('your-hand', game.hands[socket.id]);
    broadcastHandCounts();
  });

  socket.on('shuffle-main-deck',    () => { if (game) game.deck = shuffle(game.deck); });
  

  // 3) Play & move cards
  socket.on('play-card', ({card, x, y}) => {
    if (!game) return;
    const idx = game.hands[socket.id].indexOf(card);
    if (idx !== -1) game.hands[socket.id].splice(idx, 1);
    game.table.push({card, x, y});
    io.in(room).emit('table-update', game.table);
    socket.emit('your-hand', game.hands[socket.id]);
    broadcastHandCounts();
  });

  socket.on('move-table-card', ({index, x, y}) => {
    if (!game || !game.table[index]) return;
    game.table[index].x = x;
    game.table[index].y = y;
    io.in(room).emit('table-update', game.table);
  });

  // 4) Return card from hand
  socket.on('return-card-from-hand', ({card}) => {
    if (!game) return;
    const h = game.hands[socket.id];
    const i = h.indexOf(card);
    if (i === -1) return;
    h.splice(i, 1);
    socket.emit('your-hand', h);
    broadcastHandCounts();
    const deckArr = card.startsWith('glads/') ? game.specialDeck : game.deck;
    deckArr.push(card);
    shuffle(deckArr);
  });

  // 5) Return card from table
  socket.on('return-card-from-table', ({index, card}) => {
    if (!game || !game.table[index] || game.table[index].card !== card) return;
    game.table.splice(index, 1);
    io.in(room).emit('table-update', game.table);
    broadcastHandCounts();
    const deckArr = card.startsWith('glads/') ? game.specialDeck : game.deck;
    deckArr.push(card);
    shuffle(deckArr);
  });

  // 6) Dot sync
  socket.on('move-dot', ({index, x, y}) => {
    if (!game || !game.dotPositions[index]) return;
    game.dotPositions[index] = {x, y};
    io.in(room).emit('dots-update', game.dotPositions);
  });

  // 7) Hex sync
  socket.on('move-hex', ({index, x, y}) => {
    if (!game || !game.hexPositions[index]) return;
    game.hexPositions[index].x = x;
    game.hexPositions[index].y = y;
    io.in(room).emit('hexes-update', game.hexPositions);
  });
  socket.on('update-hex', ({index, value}) => {
    if (!game || !game.hexPositions[index]) return;
    game.hexPositions[index].value = value;
    io.in(room).emit('hexes-update', game.hexPositions);
  });

  // 8) Square sync
  socket.on('move-square', ({index, x, y}) => {
    if (!game || !game.squarePositions[index]) return;
    game.squarePositions[index].x = x;
    game.squarePositions[index].y = y;
    io.in(room).emit('squares-update', game.squarePositions);
  });
  socket.on('update-square', ({index, value}) => {
    if (!game || !game.squarePositions[index]) return;
    game.squarePositions[index].value = value;
    io.in(room).emit('squares-update', game.squarePositions);
  });

  // 9) Cleanup on disconnect
  socket.on('disconnect', () => {
    if (!game) return;
    game.players = game.players.filter(id => id !== socket.id);
    delete game.hands[socket.id];
    socket.leave(room);
    broadcastHandCounts();
    if (game.players.length === 0) delete games[room];
  });
});

http.listen(3000, () => console.log('Server listening on port 3000'));
