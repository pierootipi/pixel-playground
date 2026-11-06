const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");
const W = canvas.width;
const H = canvas.height;
const GRAVITY = 1700;
const RUN_SPEED = 300;
const JUMP_SPEED = 650;

const overlay = document.querySelector("#overlay");
const actionButton = document.querySelector("#action");
const pauseButton = document.querySelector("#pause");
const newLevelButton = document.querySelector("#new-level");
const statusText = document.querySelector("#status");
const titleText = document.querySelector("#panel-title");
const detailText = document.querySelector("#panel-detail");
const gemsText = document.querySelector("#gems");
const heartsText = document.querySelector("#hearts");
const checkpointText = document.querySelector("#checkpoint");
const seedText = document.querySelector("#seed");

const held = new Set();
const touchHeld = new Map();
let level, player, cameraX = 0, state = "ready", lives = 3, gems = 0;
let activeCheckpoint;
let jumpQueued = false;
let previousTime;
let particles = [];

function randomFrom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function generateLevel() {
  const seed = Math.floor(Math.random() * 0xffffff) + 1;
  const random = randomFrom(seed);
  const platforms = [{ x: 0, y: 426, w: 260, h: 114, kind: "ground" }];
  const coins = [];
  const spikes = [];
  const enemies = [];
  const pogoObjects = [];
  const checkpoints = [{ x: 96, y: 426, label: "Entrance", reached: true }];
  let x = 260;
  let lastY = 426;
  let pathIndex = 0;

  // Four rest stops plus the entrance checkpoint make five checkpoints total.
  // The fifth checkpoint is the exit and ends this finite cave.
  while (pathIndex < 20) {
    const gap = 20 + Math.floor(random() * 20);
    const width = (pathIndex < 4 ? 185 : 158) + Math.floor(random() * (pathIndex < 4 ? 66 : 93));
    const segmentIndex = pathIndex + 1;
    const elevation = segmentIndex >= 17
      ? -(24 + random() * 12)
      : segmentIndex % 2 === 0
      ? -(28 + random() * 34)
      : 20 + random() * 32;
    const y = Math.max(300, Math.min(438, lastY + elevation));
    x += gap;
    platforms.push({ x, y, w: width, h: H - y + 100, kind: "ground" });
    pathIndex += 1;
    const isCheckpoint = pathIndex % 5 === 0;

    if (pathIndex >= 16 && pathIndex < 20 && pathIndex % 2 === 0 && width > 155) {
      pogoObjects.push({ x: x + width * (pathIndex === 18 ? 0.68 : 0.36), y: y - 18, w: 30, h: 18, phase: random() * Math.PI * 2 });
    }

    if (pathIndex % 2 === 0 || random() > 0.28) {
      coins.push({ x: x + width * (0.3 + random() * 0.4), y: y - 34, r: 10, taken: false, phase: random() * Math.PI * 2 });
    }
    if (!isCheckpoint && pathIndex > 4 && pathIndex < 20 && width > 175 && random() > 0.72) {
      const spikeX = x + 42 + random() * Math.max(8, width - 92);
      spikes.push({ x: spikeX, y: y - 19, w: 34, h: 19 });
    } else if (!isCheckpoint && pathIndex > 1 && pathIndex < 20 && width > 165 && (pathIndex <= 3 || pathIndex % 3 === 0 || random() > 0.25)) {
      const enemyX = x + 38 + random() * (width - 76);
      enemies.push({ x: enemyX, y: y - 25, w: 28, h: 25, minX: x + 24, maxX: x + width - 24, dx: random() > 0.5 ? 1 : -1, speed: 62 + random() * 42, startX: enemyX });
    }
    if (isCheckpoint) {
      const isFinalCheckpoint = pathIndex === 20;
      checkpoints.push({
        x: isFinalCheckpoint ? x + width - 38 : x + 36,
        y,
        label: isFinalCheckpoint ? "Cave exit" : `Rest stop ${checkpoints.length}`,
        reached: false,
        final: isFinalCheckpoint
      });
    }

    if ((pathIndex === 1 || pathIndex % 2 === 1) && width > 155 && (pathIndex === 1 || random() > 0.2)) {
      const bonusW = pathIndex === 1 ? 126 + random() * 24 : 92 + random() * 65;
      const bonusX = pathIndex === 1 ? x + (width - bonusW) / 2 : x + Math.max(14, (width - bonusW) * random());
      const bonusY = Math.max(190, y - (pathIndex === 1 ? 96 : 90 + random() * 45));
      platforms.push({ x: bonusX, y: bonusY, w: bonusW, h: 16, kind: "float" });
      if (pathIndex === 1) {
        for (const gemOffset of [.22, .5, .78]) {
          coins.push({ x: bonusX + bonusW * gemOffset, y: bonusY - 28, r: 9, taken: false, phase: random() * Math.PI * 2 });
        }
      } else if (random() > 0.3) {
        coins.push({ x: bonusX + bonusW / 2, y: bonusY - 28, r: 9, taken: false, phase: random() * Math.PI * 2 });
      }
    }
    x += width;
    lastY = y;
  }

  return { seed, platforms, coins, spikes, enemies, pogoObjects, checkpoints, width: x };
}

function createPlayer() {
  return { x: 64, y: 388, w: 27, h: 38, vx: 0, vy: 0, onGround: false, invincible: 0, pogoing: false, slashTime: 0 };
}

function updateHud() {
  const collected = level.coins.reduce((count, coin) => count + Number(coin.taken), 0);
  gemsText.textContent = `${collected} / ${level.coins.length}`;
  heartsText.textContent = Array.from({ length: 3 }, (_, i) => i < lives ? "♥" : "♡").join(" ");
  checkpointText.textContent = activeCheckpoint?.label ?? "Entrance";
  seedText.textContent = level.seed.toString(16).toUpperCase().padStart(6, "0");
}

function resetRun() {
  player = createPlayer();
  cameraX = 0;
  lives = 3;
  gems = 0;
  particles = [];
  activeCheckpoint = level.checkpoints[0];
  for (const checkpoint of level.checkpoints) checkpoint.reached = checkpoint === activeCheckpoint;
  for (const coin of level.coins) coin.taken = false;
  for (const enemy of level.enemies) {
    enemy.x = enemy.startX;
    enemy.dx = Math.abs(enemy.dx) * (Math.random() > 0.5 ? 1 : -1);
  }
  updateHud();
}

function beginRun() {
  resetRun();
  state = "playing";
  overlay.hidden = true;
  pauseButton.disabled = false;
  pauseButton.textContent = "Pause";
  previousTime = undefined;
  canvas.focus();
}

function showOverlay(status, title, detail, buttonText) {
  statusText.textContent = status;
  titleText.textContent = title;
  detailText.textContent = detail;
  actionButton.textContent = buttonText;
  overlay.hidden = false;
  actionButton.focus();
}

function pauseRun() {
  if (state !== "playing") return;
  state = "paused";
  held.clear();
  touchHeld.clear();
  jumpQueued = false;
  pauseButton.textContent = "Resume";
  showOverlay("TAKE YOUR TIME", "Cave paused", "Your crystals and hearts are safe. Press Esc to continue.", "Resume exploring");
}

function resumeRun() {
  if (state !== "paused") return;
  state = "playing";
  overlay.hidden = true;
  pauseButton.textContent = "Pause";
  previousTime = undefined;
  canvas.focus();
}

function newLevel() {
  level = generateLevel();
  beginRun();
}

function respawn() {
  player.x = activeCheckpoint.x - player.w / 2;
  player.y = activeCheckpoint.y - player.h;
  player.vx = 0;
  player.vy = 0;
  player.onGround = true;
  player.invincible = 1.4;
  cameraX = Math.max(0, Math.min(level.width - W, player.x - W * .34));
  particles = [];
}

function hitPlayer() {
  if (player.invincible > 0 || state !== "playing") return;
  lives -= 1;
  updateHud();
  if (lives <= 0) {
    state = "over";
    pauseButton.disabled = true;
    showOverlay("RUN OVER", "One more try?", `You found ${gems} crystal${gems === 1 ? "" : "s"}. Cave map ${level.seed.toString(16).toUpperCase().padStart(6, "0")}.`, "Try again");
  } else respawn();
}

function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function burst(x, y, color, count = 9) {
  for (let i = 0; i < count; i += 1) {
    const angle = Math.PI * 2 * i / count;
    const speed = 40 + Math.random() * 85;
    particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: .55, color });
  }
}

// Sweep the player across solid platform sides so a fast frame cannot tunnel through them.
function resolveHorizontal(previousX) {
  if (player.vx === 0) return;
  for (const platform of level.platforms) {
    const overlapsY = player.y < platform.y + platform.h && player.y + player.h > platform.y;
    if (!overlapsY) continue;

    if (player.vx > 0 && player.x + player.w > platform.x && previousX + player.w <= platform.x) {
      player.x = platform.x - player.w;
      player.vx = 0;
      break;
    } else if (player.vx < 0 && player.x < platform.x + platform.w && previousX >= platform.x + platform.w) {
      player.x = platform.x + platform.w;
      player.vx = 0;
      break;
    }
  }
  player.x = Math.max(0, Math.min(level.width - player.w, player.x));
}

// Land on the nearest crossed top, or stop a jump at the underside of a platform.
function resolveVertical(previousY, previousBottom) {
  const overlapsX = platform => player.x + player.w > platform.x && player.x < platform.x + platform.w;

  if (player.vy >= 0) {
    let landing = null;
    for (const platform of level.platforms) {
      const crossedTop = previousBottom <= platform.y && player.y + player.h >= platform.y;
      if (crossedTop && overlapsX(platform) && (!landing || platform.y < landing.y)) landing = platform;
    }
    if (landing) {
      player.y = landing.y - player.h;
      player.vy = 0;
      player.onGround = true;
    }
    return;
  }

  let ceiling = null;
  for (const platform of level.platforms) {
    const underside = platform.y + platform.h;
    const crossedUnderside = previousY >= underside && player.y <= underside;
    if (crossedUnderside && overlapsX(platform) && (!ceiling || underside > ceiling.y + ceiling.h)) ceiling = platform;
  }
  if (ceiling) {
    player.y = ceiling.y + ceiling.h;
    player.vy = 0;
  }
}

function update(dt) {
  if (player.invincible > 0) player.invincible = Math.max(0, player.invincible - dt);
  if (player.slashTime > 0) player.slashTime = Math.max(0, player.slashTime - dt);
  const left = held.has("arrowleft") || held.has("a") || [...touchHeld.values()].includes("left");
  const right = held.has("arrowright") || held.has("d") || [...touchHeld.values()].includes("right");
  player.vx = (Number(right) - Number(left)) * RUN_SPEED;
  const previousX = player.x;
  player.x += player.vx * dt;
  resolveHorizontal(previousX);

  if (jumpQueued && player.onGround) {
    player.vy = -JUMP_SPEED;
    player.onGround = false;
    burst(player.x + player.w / 2, player.y + player.h, "#9ce7be", 5);
  }
  jumpQueued = false;

  const previousY = player.y;
  const previousBottom = player.y + player.h;
  player.vy = Math.min(player.vy + GRAVITY * dt, 900);
  const impactVelocity = player.vy;
  player.y += player.vy * dt;
  player.onGround = false;
  resolveVertical(previousY, previousBottom);

  for (const checkpoint of level.checkpoints) {
    if (!checkpoint.reached && overlaps(player, { x: checkpoint.x - 12, y: checkpoint.y - 42, w: 24, h: 42 })) {
      checkpoint.reached = true;
      activeCheckpoint = checkpoint;
      updateHud();
      burst(checkpoint.x, checkpoint.y - 28, "#9ce7be", 12);
      if (checkpoint.final) {
        state = "won";
        pauseButton.disabled = true;
        showOverlay("CAVE CLEARED", "You found the exit!", `You gathered ${gems} of ${level.coins.length} crystals. You made it through all five checkpoints.`, "New random cave");
        return;
      }
    }
  }

  for (const enemy of level.enemies) {
    enemy.x += enemy.dx * enemy.speed * dt;
    if (enemy.x < enemy.minX || enemy.x + enemy.w > enemy.maxX) enemy.dx *= -1;
    enemy.x = Math.max(enemy.minX, Math.min(enemy.maxX - enemy.w, enemy.x));
    if (overlaps(player, enemy)) {
      if (player.pogoing && impactVelocity > 100 && previousBottom <= enemy.y + enemy.h) {
        player.y = enemy.y - player.h;
        player.vy = -JUMP_SPEED * .8;
        player.onGround = false;
        player.pogoing = false;
        burst(enemy.x + enemy.w / 2, enemy.y + enemy.h / 2, "#ffd17d", 10);
      } else {
        hitPlayer();
        if (state !== "playing") return;
      }
    }
  }
  for (const pogo of level.pogoObjects) {
    if (impactVelocity > 100 && previousBottom <= pogo.y + pogo.h && overlaps(player, pogo)) {
      player.y = pogo.y - player.h;
      player.vy = -JUMP_SPEED * 1.55;
      player.onGround = false;
      player.pogoing = false;
      burst(pogo.x + pogo.w / 2, pogo.y, "#8ce8df", 12);
    }
  }
  if (player.onGround) player.pogoing = false;
  for (const spike of level.spikes) {
    if (overlaps(player, { x: spike.x + 5, y: spike.y + 6, w: spike.w - 10, h: spike.h - 6 })) {
      hitPlayer();
      if (state !== "playing") return;
    }
  }

  for (const coin of level.coins) {
    if (!coin.taken && overlaps(player, { x: coin.x - coin.r, y: coin.y - coin.r, w: coin.r * 2, h: coin.r * 2 })) {
      coin.taken = true;
      gems += 1;
      updateHud();
      burst(coin.x, coin.y, "#70e7d0", 10);
    }
  }
  if (player.y > H + 80) {
    hitPlayer();
    if (state !== "playing") return;
  }
  cameraX = Math.max(0, Math.min(level.width - W, player.x - W * .34));
  for (const particle of particles) {
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vy += 100 * dt;
    particle.life -= dt;
  }
  particles = particles.filter(particle => particle.life > 0);
}

function drawBackground() {
  const wall = ctx.createLinearGradient(0, 0, 0, H);
  wall.addColorStop(0, "#111a19");
  wall.addColorStop(.55, "#26312b");
  wall.addColorStop(1, "#151d19");
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, W, H);

  const glow = ctx.createRadialGradient(W * .58, 280, 30, W * .58, 280, 500);
  glow.addColorStop(0, "#42634b55");
  glow.addColorStop(1, "#17201d00");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Jagged ceiling and hanging stalactites.
  const ceilingScroll = cameraX * .22;
  const ceilingStart = Math.floor(ceilingScroll / 48) * 48;
  ctx.fillStyle = "#101715";
  ctx.beginPath();
  ctx.moveTo(ceilingStart - ceilingScroll, 0);
  ctx.lineTo(ceilingStart - ceilingScroll, 100);
  for (let worldX = ceilingStart; worldX <= ceilingScroll + W + 48; worldX += 48) {
    const x = worldX - ceilingScroll;
    const edge = 80 + (Math.sin(worldX * .027) + 1) * 17 + (Math.sin(worldX * .011) + 1) * 11;
    ctx.lineTo(x, edge);
    if (Math.round(worldX / 48) % 3 === 0) {
      const tip = edge + 38 + (Math.sin(worldX) + 1) * 17;
      ctx.lineTo(x + 12, tip);
      ctx.lineTo(x + 24, edge + 3);
    }
  }
  ctx.lineTo(W, 0);
  ctx.closePath(); ctx.fill();

  // Deep cave silhouettes along the bottom edge.
  const floorScroll = cameraX * .32;
  const floorStart = Math.floor(floorScroll / 52) * 52;
  ctx.fillStyle = "#101715";
  ctx.beginPath();
  ctx.moveTo(floorStart - floorScroll, H);
  ctx.lineTo(floorStart - floorScroll, 500);
  for (let worldX = floorStart; worldX <= floorScroll + W + 52; worldX += 52) {
    const x = worldX - floorScroll;
    const tip = 480 + (Math.sin(worldX * .021) + 1) * 19;
    ctx.lineTo(x, tip);
    if (Math.round(worldX / 52) % 2 === 0) ctx.lineTo(x + 24, tip - 25);
  }
  ctx.lineTo(W, H);
  ctx.closePath(); ctx.fill();

  // Small glowing crystal clusters in the far wall.
  const crystalScroll = cameraX * .14;
  const firstCrystal = Math.floor((crystalScroll - 55) / 137) - 1;
  const lastCrystal = Math.ceil((crystalScroll + W - 55) / 137) + 1;
  for (let i = firstCrystal; i <= lastCrystal; i += 1) {
    const x = i * 137 + 55 - crystalScroll;
    const y = 190 + (Math.abs(i) % 4) * 57;
    ctx.globalAlpha = .28;
    ctx.fillStyle = i % 2 ? "#5ee3d2" : "#a3ed9a";
    ctx.beginPath();
    ctx.moveTo(x, y + 22); ctx.lineTo(x + 9, y - 11); ctx.lineTo(x + 18, y + 22);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + 16, y + 22); ctx.lineTo(x + 23, y - 3); ctx.lineTo(x + 30, y + 22);
    ctx.closePath(); ctx.fill();
  }
  // A sunlit cave mouth becomes visible as the player reaches the final stretch.
  const openingX = level.width - 130 - cameraX;
  if (openingX > -420 && openingX < W + 420) {
    const mouth = ctx.createRadialGradient(openingX, 255, 12, openingX, 255, 300);
    mouth.addColorStop(0, "#fff5c9");
    mouth.addColorStop(.24, "#b8f0d4");
    mouth.addColorStop(.52, "#75b9a8");
    mouth.addColorStop(1, "#263b35");
    ctx.save();
    ctx.globalAlpha = .96;
    ctx.fillStyle = mouth;
    ctx.beginPath(); ctx.ellipse(openingX, 255, 280, 205, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = .32;
    ctx.fillStyle = "#fff3bf";
    ctx.beginPath();
    ctx.moveTo(openingX - 190, 185); ctx.lineTo(openingX + 210, 320);
    ctx.lineTo(openingX + 245, 352); ctx.lineTo(openingX - 220, 218);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawPlatform(platform) {
  const x = Math.round(platform.x - cameraX);
  const y = Math.round(platform.y);
  ctx.fillStyle = platform.kind === "float" ? "#394941" : "#303a34";
  ctx.fillRect(x, y, platform.w, platform.h);
  ctx.fillStyle = platform.kind === "float" ? "#849b7d" : "#657c65";
  ctx.fillRect(x, y, platform.w, 6);
  ctx.fillStyle = "#3d4940";
  ctx.fillRect(x, y + 12, platform.w, 2);
}

function drawCrystal(coin, time) {
  if (coin.taken) return;
  const x = coin.x - cameraX;
  const bob = Math.sin(time / 330 + coin.phase) * 4;
  ctx.save();
  ctx.translate(x, coin.y + bob);
  ctx.shadowColor = "#54e6d5";
  ctx.shadowBlur = 16;
  ctx.fillStyle = "#62e5d0";
  ctx.beginPath();
  ctx.moveTo(0, -coin.r - 3); ctx.lineTo(coin.r, -2); ctx.lineTo(coin.r * .7, coin.r + 2);
  ctx.lineTo(-coin.r * .7, coin.r + 2); ctx.lineTo(-coin.r, -2);
  ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#d0fff0";
  ctx.beginPath(); ctx.moveTo(0, -coin.r - 3); ctx.lineTo(2, -1); ctx.lineTo(-2, -1); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawPlayer() {
  if (player.invincible > 0 && Math.floor(player.invincible * 12) % 2 === 0) return;
  const x = Math.round(player.x - cameraX), y = Math.round(player.y);
  ctx.shadowColor = "#9ce7be"; ctx.shadowBlur = 12;
  ctx.fillStyle = "#a1ebc0"; ctx.fillRect(x + 2, y + 3, player.w - 4, player.h - 7);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#e2ffdf"; ctx.fillRect(x + 6, y + 7, player.w - 12, 7);
  ctx.fillStyle = "#23372d"; ctx.fillRect(x + 8, y + 16, 4, 5); ctx.fillRect(x + 17, y + 16, 4, 5);
  ctx.fillStyle = "#526251"; ctx.fillRect(x, y + player.h - 5, 13, 5); ctx.fillRect(x + 15, y + player.h - 5, 13, 5);
  if (player.slashTime > 0) {
    ctx.save();
    ctx.globalAlpha = player.slashTime / .28;
    ctx.strokeStyle = "#e5fff6";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.shadowColor = "#8ce8df";
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(x + 2, y + player.h - 2);
    ctx.lineTo(x + player.w / 2, y + player.h + 18);
    ctx.lineTo(x + player.w - 2, y + player.h - 2);
    ctx.stroke();
    ctx.restore();
  }
}

function draw(time = 0) {
  drawBackground();
  for (const platform of level.platforms) drawPlatform(platform);
  for (const checkpoint of level.checkpoints) {
    const x = checkpoint.x - cameraX;
    const current = checkpoint === activeCheckpoint;
    const color = checkpoint.final ? "#ffd17d" : current ? "#9ce7be" : checkpoint.reached ? "#719d82" : "#c2ad7b";
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = current || checkpoint.final ? 17 : 8;
    ctx.fillStyle = color;
    ctx.fillRect(x - 3, checkpoint.y - 32, 6, 32);
    ctx.fillRect(x - 9, checkpoint.y - 5, 18, 5);
    ctx.beginPath();
    ctx.moveTo(x, checkpoint.y - 45);
    ctx.lineTo(x + 8, checkpoint.y - 34);
    ctx.lineTo(x, checkpoint.y - 24);
    ctx.lineTo(x - 8, checkpoint.y - 34);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  for (const spike of level.spikes) {
    const x = spike.x - cameraX;
    ctx.fillStyle = "#d98571";
    ctx.beginPath(); ctx.moveTo(x, spike.y + spike.h); ctx.lineTo(x + spike.w / 2, spike.y); ctx.lineTo(x + spike.w, spike.y + spike.h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#f4c59e"; ctx.fillRect(x + spike.w / 2 - 2, spike.y + 7, 4, 7);
  }
  for (const enemy of level.enemies) {
    const x = Math.round(enemy.x - cameraX);
    ctx.fillStyle = "#ba806d"; ctx.fillRect(x, enemy.y + 5, enemy.w, enemy.h - 5); ctx.fillRect(x + 4, enemy.y, enemy.w - 8, 8);
    ctx.fillStyle = "#252d27"; ctx.fillRect(x + 6, enemy.y + 10, 4, 5); ctx.fillRect(x + 18, enemy.y + 10, 4, 5);
  }
  for (const pogo of level.pogoObjects) {
    const x = Math.round(pogo.x - cameraX);
    const pulse = Math.sin(time / 180 + pogo.phase) * 2;
    ctx.save();
    ctx.shadowColor = "#8ce8df"; ctx.shadowBlur = 14;
    ctx.fillStyle = "#63b9a7"; ctx.fillRect(x, pogo.y + 8, pogo.w, pogo.h - 8);
    ctx.fillStyle = "#a4fff0";
    ctx.beginPath(); ctx.ellipse(x + pogo.w / 2, pogo.y + 8 + pulse, pogo.w / 2, 9, 0, Math.PI, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  for (const coin of level.coins) drawCrystal(coin, time);

  drawPlayer();
  for (const particle of particles) {
    ctx.globalAlpha = Math.max(0, particle.life / .55); ctx.fillStyle = particle.color;
    ctx.fillRect(particle.x - cameraX - 3, particle.y - 3, 6, 6);
  }
  ctx.globalAlpha = 1;
}

function frame(time) {
  const dt = previousTime === undefined ? 0 : Math.min((time - previousTime) / 1000, .033);
  previousTime = time;
  if (state === "playing" && !document.hidden) update(dt);
  draw(time);
  requestAnimationFrame(frame);
}

function requestJump() { if (state === "playing") jumpQueued = true; }
function requestPogo() {
  if (state !== "playing" || player.onGround || player.pogoing) return;
  player.pogoing = true;
  player.slashTime = .28;
}
canvas.addEventListener("pointerdown", event => {
  if (event.button !== 0) return;
  event.preventDefault();
  requestPogo();
});
actionButton.addEventListener("click", () => {
  if (state === "paused") resumeRun();
  else if (state === "won") newLevel();
  else beginRun();
});
pauseButton.addEventListener("click", () => state === "paused" ? resumeRun() : pauseRun());
newLevelButton.addEventListener("click", newLevel);

window.addEventListener("keydown", event => {
  const key = event.key.toLowerCase();
  if (key === "escape") {
    event.preventDefault();
    if (!event.repeat && state === "playing") pauseRun();
    else if (!event.repeat && state === "paused") resumeRun();
    return;
  }
  if (key === "n" && !event.repeat && !event.altKey && !event.ctrlKey && !event.metaKey) { newLevel(); return; }
  if (state !== "playing" || event.altKey || event.ctrlKey || event.metaKey) return;
  if (["arrowleft", "arrowright", "a", "d", "arrowup", "w", " "].includes(key)) event.preventDefault();
  if (["arrowup", "w", " "].includes(key) && !event.repeat) requestJump();
  held.add(key);
});
window.addEventListener("keyup", event => held.delete(event.key.toLowerCase()));
window.addEventListener("blur", () => { held.clear(); touchHeld.clear(); });
document.addEventListener("visibilitychange", () => { held.clear(); touchHeld.clear(); });

for (const button of document.querySelectorAll("[data-key], [data-action='jump']")) {
  button.addEventListener("pointerdown", event => {
    if (state !== "playing") return;
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    if (button.dataset.action === "jump") requestJump();
    else touchHeld.set(event.pointerId, button.dataset.key);
  });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) button.addEventListener(name, event => touchHeld.delete(event.pointerId));
}

level = generateLevel();
activeCheckpoint = level.checkpoints[0];
player = createPlayer();
updateHud();
pauseButton.disabled = true;
requestAnimationFrame(frame);
