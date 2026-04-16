let KEY_Space = false;
let KEY_Up    = false;
let KEY_Down  = false;

const canvas = document.getElementById("canvas");
let ctx;
const backgroundimage = new Image();

// ── Canvas füllt immer das gesamte Fenster ────────────────────────────────────
function resizeCanvas() {
    // window.innerWidth/Height ist auf allen modernen Browsern zuverlässig
    // wenn body/html overflow:hidden gesetzt ist (kein Scrollbar-Problem)
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', () => {
    resizeCanvas();
    showPortraitOverlay();
});

// ── Mobile-Erkennung ──────────────────────────────────────────────────────────
function isMobile() {
    return /Mobi|Android|iPhone|iPad|iPod|Samsung|Mobile/i.test(navigator.userAgent);
}

// Sprite-Basisgrößen – auf Mobil etwas kleiner damit mehr Spielfeld sichtbar
const ROCKET_W = 200, ROCKET_H = 90;
const UFO_W    = 100, UFO_H    = 40;

function spriteScale() { return isMobile() ? 0.7 : 1.0; }
function rocketSpeed() { return isMobile() ? 200 : 480; }  // px pro SEKUNDE (delta-time basiert!)

let roket = {
    x: 50,
    y: 300,
    width:  ROCKET_W,
    height: ROCKET_H,
    src:   "./img/rocket.png",
    image: null
};

let ufos        = [];
let explosions  = [];
let score       = 0;
let bestScore   = parseInt(localStorage.getItem('bestScore')) || 0;
let gameOver    = null;
let gameGeneration = 0;
let createUfosIntervalId = null;
let collisionIntervalId  = null;
let bullets      = [];
let lastShotTime = 0;
const SHOT_COOLDOWN = 300;
const LASER_LENGTH  = 15;
const LASER_HEIGHT  = 6;

// ── Audio ─────────────────────────────────────────────────────────────────────
let audioCtx   = null;
let masterGain = null;
let bgGain     = null;
let bgNodes    = null;
let audioMuted = false;
let showBgOverlay = false;
const persistedBg = parseFloat(localStorage.getItem('bgGain'));
let bgVolumeDefault = isNaN(persistedBg) ? 0.34 : persistedBg;

function initAudio() {
    if (audioCtx) return;
    audioCtx   = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 1.0;
    masterGain.connect(audioCtx.destination);
    bgGain = audioCtx.createGain();
    bgGain.gain.value = bgVolumeDefault;
    bgGain.connect(masterGain);
}

function startBgMusic() {
    if (audioMuted) return;
    initAudio();
    if (bgNodes) return;
    const osc1 = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    osc1.type = 'triangle'; osc2.type = 'sine';
    osc1.frequency.value = 55; osc2.frequency.value = 82.41; osc2.detune.value = 12;
    const mix = audioCtx.createGain(); mix.gain.value = 0.12;
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 420;
    osc1.connect(mix); osc2.connect(mix); mix.connect(filter); filter.connect(bgGain);
    const lfo = audioCtx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.03;
    const lfoGain = audioCtx.createGain(); lfoGain.gain.value = 100;
    lfo.connect(lfoGain); lfoGain.connect(filter.frequency);
    osc1.start(); osc2.start(); lfo.start();
    bgNodes = { osc1, osc2, mix, filter, lfo, lfoGain };
    const arpGain = audioCtx.createGain(); arpGain.gain.value = 0.5; arpGain.connect(filter);
    const arpPatterns = [
        [261.63, 329.63, 392.00, 523.25],
        [392.00, 329.63, 261.63, 196.00],
        [261.63, 392.00, 523.25, 659.25]
    ];
    let arpIndex = 0;
    const arpTimer = setInterval(() => {
        if (!bgNodes) { clearInterval(arpTimer); return; }
        const pattern  = arpPatterns[Math.floor(Math.random() * arpPatterns.length)];
        const baseNote = pattern[arpIndex % pattern.length];
        const osc = audioCtx.createOscillator();
        osc.type = Math.random() > 0.8 ? 'sawtooth' : (Math.random() > 0.5 ? 'triangle' : 'sine');
        const freq = baseNote * (Math.random() > 0.9 ? 2 : 1);
        osc.frequency.value = freq;
        const g = audioCtx.createGain(); g.gain.value = 0.0001;
        osc.connect(g); g.connect(arpGain);
        const t0 = audioCtx.currentTime;
        const peak = 0.25 * (0.6 + Math.random() * 0.6);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(peak, t0 + 0.01 + Math.random() * 0.04);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12 + Math.random() * 0.12);
        osc.start(t0); osc.stop(t0 + 0.15 + Math.random() * 0.15);
        if (Math.random() < 0.12) {
            const osc2b = audioCtx.createOscillator(); osc2b.type = 'sine';
            osc2b.frequency.value = freq * 1.5;
            const g2 = audioCtx.createGain(); g2.gain.value = 0.0001;
            osc2b.connect(g2); g2.connect(arpGain);
            const t1 = audioCtx.currentTime;
            g2.gain.setValueAtTime(0.0001, t1);
            g2.gain.linearRampToValueAtTime(0.3, t1 + 0.01);
            g2.gain.exponentialRampToValueAtTime(0.0001, t1 + 0.18);
            osc2b.start(t1); osc2b.stop(t1 + 0.18);
        }
        arpIndex++;
    }, 250);
    bgNodes.arpTimer = arpTimer;
}

function stopBgMusic() {
    if (!bgNodes) return;
    try {
        bgNodes.osc1.stop(); bgNodes.osc2.stop(); bgNodes.lfo.stop();
        if (bgNodes.arpTimer) { clearInterval(bgNodes.arpTimer); bgNodes.arpTimer = null; }
    } catch (e) {}
    bgNodes = null;
}

function playExplosionSound() {
    if (audioMuted) return;
    initAudio();
    const now = audioCtx.currentTime;
    const thump = audioCtx.createOscillator(); thump.type = 'sine';
    thump.frequency.value = 80 + Math.random() * 40;
    const thumpG = audioCtx.createGain();
    thumpG.gain.setValueAtTime(0.0001, now);
    thump.connect(thumpG); thumpG.connect(masterGain);
    thumpG.gain.linearRampToValueAtTime(1.0, now + 0.01);
    thumpG.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    thump.start(now); thump.stop(now + 0.52);
    const bufferSize = Math.floor(audioCtx.sampleRate * 0.12);
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data   = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++)
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 1.8);
    const noise  = audioCtx.createBufferSource(); noise.buffer = buffer;
    const noiseG = audioCtx.createGain(); noiseG.gain.setValueAtTime(0.0001, now);
    const filt   = audioCtx.createBiquadFilter();
    filt.type = 'bandpass'; filt.frequency.value = 900; filt.Q.value = 1.8;
    noise.connect(noiseG); noiseG.connect(filt); filt.connect(masterGain);
    noiseG.gain.linearRampToValueAtTime(0.9, now + 0.005);
    noiseG.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    noise.start(now); noise.stop(now + 0.2);
}

function playSadSound() {
    if (audioMuted) return;
    initAudio();
    const now = audioCtx.currentTime;
    [0, -3, -7].forEach((it, idx) => {
        const osc = audioCtx.createOscillator();
        osc.type = idx === 1 ? 'triangle' : 'sine';
        osc.frequency.value = 220 * Math.pow(2, it / 12);
        const g = audioCtx.createGain(); g.gain.value = 0.0;
        osc.connect(g); g.connect(masterGain);
        const start = now + idx * 0.08;
        g.gain.setValueAtTime(0.0001, start);
        g.gain.linearRampToValueAtTime(0.6 / (idx + 1), start + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, start + 1.6);
        osc.start(start); osc.stop(start + 1.7);
    });
}

function playLaserSound() {
    if (audioMuted) return;
    initAudio();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator(); osc.type = 'sawtooth';
    const g   = audioCtx.createGain();
    const bp  = audioCtx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 8;
    osc.connect(bp); bp.connect(g); g.connect(masterGain);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.7, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.frequency.setValueAtTime(1600, now);
    osc.frequency.exponentialRampToValueAtTime(700, now + 0.12);
    osc.start(now); osc.stop(now + 0.14);
}

function setMuted(m) {
    audioMuted = !!m;
    if (audioMuted) stopBgMusic(); else startBgMusic();
}

// ── Speed ─────────────────────────────────────────────────────────────────────
let startTime = 0;
const SPEED_INCREASE_START        = 60000;
const SPEED_GROWTH_TIME_TO_MAX_MS = 2 * 60 * 1000;
let lastFrameTime = 0;
const UFO_BASE_SPEED_PPS = 300;
let ufoSpeedPPS = UFO_BASE_SPEED_PPS;
const UFO_MAX_SPEED_PPS  = 1070;

// ── Keyboard ──────────────────────────────────────────────────────────────────
window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        KEY_Space = true;
        const now = performance.now();
        if (!roket.isDestroyed && !gameOver && (now - lastShotTime) > SHOT_COOLDOWN) {
            spawnBullet(); lastShotTime = now;
        }
    }
    if (e.code === 'ArrowUp')   KEY_Up   = true;
    if (e.code === 'ArrowDown') KEY_Down = true;
    if (e.code === 'KeyM') setMuted(!audioMuted);
    if (e.key === ']') { initAudio(); bgGain.gain.value = Math.min(1.0, bgGain.gain.value + 0.03); localStorage.setItem('bgGain', bgGain.gain.value); }
    if (e.key === '[') { initAudio(); bgGain.gain.value = Math.max(0.0, bgGain.gain.value - 0.03); localStorage.setItem('bgGain', bgGain.gain.value); }
    if (e.code === 'KeyV') showBgOverlay = !showBgOverlay;
});
window.addEventListener('keyup', (e) => {
    if (e.code === 'Space')     KEY_Space = false;
    if (e.code === 'ArrowUp')   KEY_Up    = false;
    if (e.code === 'ArrowDown') KEY_Down  = false;
});

// ── Touch-Steuerung ───────────────────────────────────────────────────────────
function initTouchControls() {
    if (!isMobile()) return;

    const touchControls = document.getElementById('touchControls');
    const touchShoot    = document.getElementById('touchShoot');
    if (touchControls) touchControls.style.display = 'flex';
    if (touchShoot)    touchShoot.style.display    = 'flex';

    const btnUp = document.getElementById('touchUp');
    if (btnUp) {
        btnUp.addEventListener('touchstart',  (e) => { e.preventDefault(); KEY_Up = true;  }, { passive: false });
        btnUp.addEventListener('touchend',    (e) => { e.preventDefault(); KEY_Up = false; }, { passive: false });
        btnUp.addEventListener('touchcancel', (e) => { e.preventDefault(); KEY_Up = false; }, { passive: false });
    }

    const btnDown = document.getElementById('touchDown');
    if (btnDown) {
        btnDown.addEventListener('touchstart',  (e) => { e.preventDefault(); KEY_Down = true;  }, { passive: false });
        btnDown.addEventListener('touchend',    (e) => { e.preventDefault(); KEY_Down = false; }, { passive: false });
        btnDown.addEventListener('touchcancel', (e) => { e.preventDefault(); KEY_Down = false; }, { passive: false });
    }

    if (touchShoot) {
        touchShoot.addEventListener('touchstart', (e) => {
            e.preventDefault();
            initAudio();
            if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
            const now = performance.now();
            if (!roket.isDestroyed && !gameOver && (now - lastShotTime) > SHOT_COOLDOWN) {
                spawnBullet(); lastShotTime = now;
            }
        }, { passive: false });
    }

    // Doppeltippen auf Canvas → schießen
    let lastTapTime = 0;
    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        initAudio();
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        const now = performance.now();
        if (now - lastTapTime < 300) {
            if (!roket.isDestroyed && !gameOver && (now - lastShotTime) > SHOT_COOLDOWN) {
                spawnBullet(); lastShotTime = now;
            }
            lastTapTime = 0;
        } else {
            lastTapTime = now;
        }
    }, { passive: false });

    canvas.addEventListener('touchcancel', () => { KEY_Up = false; KEY_Down = false; }, { passive: false });
}

// ── Querformat-Hinweis ────────────────────────────────────────────────────────
function checkOrientation() {
    if (!isMobile()) return;
    if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => showPortraitOverlay());
    }
    showPortraitOverlay();
}

function showPortraitOverlay() {
    const overlay = document.getElementById('orientationOverlay');
    if (!overlay) return;
    overlay.style.display = (window.innerHeight > window.innerWidth) ? 'flex' : 'none';
}

window.addEventListener('orientationchange', () => {
    // Mehrfach verzögert aufrufen da Browser unterschiedlich lange brauchen
    setTimeout(() => { resizeCanvas(); showPortraitOverlay(); }, 100);
    setTimeout(() => { resizeCanvas(); showPortraitOverlay(); }, 400);
});

// ── UFO erstellen ─────────────────────────────────────────────────────────────
function createufos() {
    if (gameOver || roket.isDestroyed) return; // keine neuen UFOs wenn Game Over
    const s    = spriteScale();
    const ufoW = Math.round(UFO_W * s);
    const ufoH = Math.round(UFO_H * s);
    const ufo  = {
        y:      Math.random() * (canvas.height - ufoH - 20) + 10,
        width:  ufoW,
        height: ufoH,
        src:    "./img/ufo.png",
        image:  new Image(),
        gen:    gameGeneration  // merkt sich zu welchem Spiel dieses UFO gehört
    };
    ufo.x = canvas.width - ufoW;
    ufo.image.onerror = () => console.error('Failed to load ufo');
    ufo.image.src = ufo.src;
    ufos.push(ufo);
}

function spawnBullet() {
    bullets.push({
        x: roket.x + roket.width,
        y: roket.y + roket.height / 2,
        vx: 800, length: LASER_LENGTH, height: LASER_HEIGHT
    });
    playLaserSound();
}

function createExplosion(cx, cy, opts) {
    opts = opts || {};
    const count    = opts.count    || 18;
    const duration = opts.duration || 600;
    const colors   = opts.colors   || ['#ffd66b', '#ff9a3c', '#ff5c5c'];
    const particles = [];
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.06 + Math.random() * 0.26;
        particles.push({
            vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
            r:  2 + Math.random() * 4,
            color: colors[Math.floor(Math.random() * colors.length)]
        });
    }
    explosions.push({ x: cx, y: cy, start: performance.now(), duration, particles });
}

// ── Game Over auslösen ────────────────────────────────────────────────────────
function triggerGameOver() {
    // Guard: nur einmal pro Spiel auslösen
    if (roket.isDestroyed || gameOver) return;
    roket.image = roket.boomImage || roket.image;
    roket.isDestroyed = true;
    if (createUfosIntervalId) { clearInterval(createUfosIntervalId); createUfosIntervalId = null; }
    if (collisionIntervalId)  { clearInterval(collisionIntervalId);  collisionIntervalId  = null; }
    gameOver = { endTime: performance.now() + 5000 };
    playSadSound();
    const myGen = gameGeneration;
    setTimeout(() => {
        if (gameGeneration === myGen) softRestart(); // nur wenn kein neueres Spiel läuft
    }, 5000);
}

// ── Kollisionsprüfung (läuft im Interval) ────────────────────────────────────
function checkforcollisions() {
    // Guard: nicht prüfen wenn bereits Game Over oder kein aktives Spiel
    if (roket.isDestroyed || gameOver || ufos.length === 0) return;
    for (let i = 0; i < ufos.length; i++) {
        const ufo = ufos[i];
        if (ufo._hit || ufo.gen !== gameGeneration) continue; // altes UFO ignorieren
        if (roket.x < ufo.x + ufo.width  &&
            roket.x + roket.width  > ufo.x &&
            roket.y < ufo.y + ufo.height &&
            roket.y + roket.height > ufo.y) {
            ufo._hit = true;
            triggerGameOver();
            return;
        }
    }
}

// ── Bilder laden ──────────────────────────────────────────────────────────────
function loadImages() {
    backgroundimage.src = './img/background.jpg';
    roket.image = new Image(); roket.image.src = roket.src;
    roket.origImage = roket.image;
    roket.boomImage = new Image(); roket.boomImage.src = './img/boom.png';
    return Promise.all([
        waitForImage(backgroundimage, 'background'),
        waitForImage(roket.image,     'rocket'),
        waitForImage(roket.boomImage, 'boom')
    ]);
}

function waitForImage(img, name) {
    return new Promise((resolve) => {
        if (img.complete && img.naturalWidth !== 0) { resolve(); return; }
        img.onload  = () => resolve();
        img.onerror = () => { console.error('Failed to load ' + name); resolve(); };
    });
}

// ── Spielstart ────────────────────────────────────────────────────────────────
async function startGame() {
    if (!canvas) { console.error('Canvas not found'); return; }
    ctx = canvas.getContext('2d');

    resizeCanvas(); // Canvas auf volle Fenstergröße setzen

    const s = spriteScale();
    roket.width  = Math.round(ROCKET_W * s);
    roket.height = Math.round(ROCKET_H * s);
    roket.y = canvas.height / 2 - roket.height / 2;

    await loadImages();
    startBgMusic();
    initTouchControls();
    checkOrientation();

    gameGeneration++;
    createUfosIntervalId = setInterval(createufos, 3000);
    collisionIntervalId  = setInterval(checkforcollisions, 40); // ~25fps

    startTime     = performance.now();
    lastFrameTime = startTime;
    requestAnimationFrame(draw);
}

// ── Haupt-Draw-Loop ───────────────────────────────────────────────────────────
function draw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Delta-Time zuerst berechnen - wird für Rakete UND UFOs genutzt
    const now = performance.now();
    const dt  = Math.min(0.05, (now - lastFrameTime) / 1000);
    lastFrameTime = now;

    if (backgroundimage.complete) {
        try { ctx.drawImage(backgroundimage, 0, 0, canvas.width, canvas.height); }
        catch (e) {}
    }

    // Rakete bewegen - delta-time basiert damit Geschwindigkeit auf allen Browsern gleich ist
    const spd = rocketSpeed() * dt;
    if (!roket.isDestroyed) {
        if (KEY_Up)   roket.y -= spd;
        if (KEY_Down) roket.y += spd;
        if (roket.y < 0) roket.y = 0;
        if (roket.y + roket.height > canvas.height) roket.y = canvas.height - roket.height;
    }
    if (roket.image && roket.image.complete) {
        ctx.drawImage(roket.image, roket.x, roket.y, roket.width, roket.height);
    }

    // UFO-Geschwindigkeit
    const elapsed = now - startTime;
    if (elapsed <= SPEED_INCREASE_START) {
        ufoSpeedPPS = UFO_BASE_SPEED_PPS;
    } else {
        // Geschwindigkeit linear von Basis (300) bis Max (1070) über 2 Minuten
        // Unabhängig von Bildschirmgröße damit Handy und Desktop gleich schnell werden
        const t = Math.min(1, (elapsed - SPEED_INCREASE_START) / SPEED_GROWTH_TIME_TO_MAX_MS);
        ufoSpeedPPS = UFO_BASE_SPEED_PPS + (UFO_MAX_SPEED_PPS - UFO_BASE_SPEED_PPS) * t;
    }

    // UFOs & Bullets bewegen
    ufos.forEach(u => { u.x -= ufoSpeedPPS * dt; });
    bullets.forEach(b => { b.x += b.vx * dt; });
    bullets = bullets.filter(b => b.x < canvas.width + b.length);

    // Treffer Kugel ↔ UFO
    bullets.forEach(b => {
        ufos.forEach(u => {
            if (!u._hit &&
                b.x + b.length > u.x && b.x < u.x + u.width &&
                b.y + b.height / 2 > u.y && b.y - b.height / 2 < u.y + u.height) {
                u._hit = true;
                createExplosion(u.x + u.width / 2, u.y + u.height / 2, { count: 20, duration: 600 });
                playExplosionSound();
                b.x = canvas.width + 1000;
                score += 10;
                if (score > bestScore) { bestScore = score; localStorage.setItem('bestScore', bestScore); }
            }
        });
    });

    // UFO vollständig links raus → Game Over (rechte Kante < 0)
    if (!gameOver && !roket.isDestroyed) {
        for (let i = 0; i < ufos.length; i++) {
            const u = ufos[i];
            if (!u._hit && u.gen === gameGeneration && (u.x + u.width) < 0) {
                triggerGameOver();
                break;
            }
        }
    }

    // UFOs aus Array entfernen: nur abgeschossene UND vollständig vorbeigeflogenene
    ufos = ufos.filter(u => {
        if (u._hit) return false;           // abgeschossen → weg
        if (u.x + u.width < -50) return false; // weit links raus → weg (nach Game Over check)
        return true;
    });

    // UFOs zeichnen
    ufos.forEach(u => {
        if (u.image && u.image.complete && u.image.naturalWidth !== 0) {
            ctx.drawImage(u.image, u.x, u.y, u.width, u.height);
        }
    });

    // Kugeln zeichnen
    ctx.save();
    ctx.fillStyle = 'cyan';
    bullets.forEach(b => ctx.fillRect(b.x, b.y - b.height / 2, b.length, b.height));
    ctx.restore();

    // Explosionen
    explosions = explosions.filter(ex => {
        const t = now - ex.start;
        if (t >= ex.duration) return false;
        const progress = t / ex.duration;
        ex.particles.forEach(p => {
            ctx.save();
            ctx.globalAlpha = 1 - progress;
            ctx.fillStyle   = p.color;
            ctx.beginPath();
            ctx.arc(ex.x + p.vx * t, ex.y + p.vy * t, p.r * (1 - progress * 0.5), 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        });
        return true;
    });

    // Score
    ctx.save();
    ctx.fillStyle = 'white';
    ctx.font      = '24px sans-serif';
    ctx.fillText('Score: ' + score + '   Best: ' + bestScore, 20, 30);
    ctx.restore();

    // Game Over Anzeige
    if (gameOver) {
        const remaining = Math.max(0, Math.ceil((gameOver.endTime - now) / 1000));
        ctx.save();
        ctx.globalAlpha = 0.15; ctx.fillStyle = 'black';
        ctx.font = '140px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(remaining.toString(), canvas.width / 2, canvas.height / 2);
        ctx.restore();
        ctx.save();
        ctx.fillStyle = 'white'; ctx.font = '72px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('GAME OVER', canvas.width / 2, canvas.height / 2 - 10);
        ctx.restore();
    }

    // Debug UFO-Speed
    ctx.save();
    ctx.fillStyle = 'lightgray'; ctx.font = '16px monospace'; ctx.textAlign = 'right';
    ctx.fillText('UFO speed: ' + Math.round(ufoSpeedPPS) + ' px/s', canvas.width - 10, canvas.height - 10);
    ctx.restore();

    // Lautstärke-Overlay
    if (showBgOverlay) {
        ctx.save();
        ctx.globalAlpha = 0.85; ctx.fillStyle = '#000';
        ctx.fillRect(10, 10, 220, 60);
        ctx.fillStyle = 'white'; ctx.font = '16px sans-serif'; ctx.textAlign = 'left';
        ctx.fillText('BG Volume: ' + (bgGain ? bgGain.gain.value.toFixed(2) : 'n/a'), 20, 34);
        ctx.fillText('] increase  [ decrease  V toggle', 20, 52);
        ctx.restore();
    }

    requestAnimationFrame(draw);
}

// ── Neustart ──────────────────────────────────────────────────────────────────
function softRestart() {
    const preservedBest = bestScore;
    if (createUfosIntervalId) { clearInterval(createUfosIntervalId); createUfosIntervalId = null; }
    if (collisionIntervalId)  { clearInterval(collisionIntervalId);  collisionIntervalId  = null; }

    gameGeneration++; // alle alten Callbacks werden ignoriert
    ufos = []; bullets = []; explosions = [];
    score = 0; bestScore = preservedBest; gameOver = null;

    const s = spriteScale();
    roket.width  = Math.round(ROCKET_W * s);
    roket.height = Math.round(ROCKET_H * s);
    roket.image  = roket.origImage || roket.image;
    roket.isDestroyed = false;
    roket.x = 50;
    roket.y = canvas.height / 2 - roket.height / 2;

    startTime     = performance.now();
    lastFrameTime = startTime;

    createUfosIntervalId = setInterval(createufos, 3000);
    collisionIntervalId  = setInterval(checkforcollisions, 40);

    requestAnimationFrame(draw);
}

window.startGame = startGame;