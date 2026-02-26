let KEY_Space = false; // Space
let KEY_Up = false; // ArrowUp
let KEY_Down = false; // ArrowDown

// global vars used by many functions
let canvas, ctx;
const backgroundimage = new Image();

// high‑dpi & mobile scale support
let pixelRatio = window.devicePixelRatio || 1;
let scale = 1;                  // overall game scale (<=1 on narrow screens)
const MOBILE_BASE_WIDTH = 800;  // width at which scale becomes 1
const MOBILE_SCALE_FACTOR = 0.5; // additionally shrink on phones
const MOBILE_SPEED_FACTOR = 0.4; // slow movement/ufos further on small screens
// user-requested extra halving on phones
const MOBILE_SIZE_REDUCTION = 0.5;   // additional multiplicative reduction for UFOs
const MOBILE_SPEED_REDUCTION = 0.5;  // additional speed reduction for UFOs
const MOBILE_TOUCH_REDUCTION = 0.5;  // additional reduction for rocket touch movement

// new user-requested adjustments
const ROCKET_EXTRA_SCALE = 2;        // double rocket size on mobile
const UFO_SPEED_REDUCTION_FACTOR = 2/3; // reduce UFO speed by one third more
const BULLET_SPEED_BOOST = 2;        // double bullet speed

// additional orientation-specific reductions
const PORTRAIT_TOUCH_FACTOR = 0.5;     // further slow touch movement in portrait
const PORTRAIT_UFO_SPEED_FACTOR = 0.5; // further slow UFOs in portrait

function logicalWidth() { return canvas ? canvas.width / pixelRatio : 0; }
function logicalHeight() { return canvas ? canvas.height / pixelRatio : 0; }

// wait for DOM so we can query the canvas element and set up resizing
document.addEventListener("DOMContentLoaded", function () {
    canvas = document.getElementById("canvas");
    ctx = canvas.getContext("2d");

    function resizeCanvas() {
        const ratio = window.devicePixelRatio || 1;
        pixelRatio = ratio;
        // set actual pixel dimensions for high‑DPI displays
        canvas.width = window.innerWidth * ratio;
        canvas.height = window.innerHeight * ratio;
        // keep the CSS size at full viewport so page layout stays the same
        canvas.style.width = window.innerWidth + 'px';
        canvas.style.height = window.innerHeight + 'px';

        // update scale based on logical width (narrower => smaller)
        if (logicalWidth() < MOBILE_BASE_WIDTH) {
            scale = (logicalWidth() / MOBILE_BASE_WIDTH) * MOBILE_SCALE_FACTOR;
            // enforce a minimum so things don't vanish completely
            scale = Math.max(scale, 0.2);
        } else {
            scale = 1;
        }

        // adjust rocket size according to scale
        if (roket) {
            let rocketScale = scale;
            if (scale < 1) rocketScale *= ROCKET_EXTRA_SCALE;
            roket.width = BASE_ROCKET_WIDTH * rocketScale;
            roket.height = BASE_ROCKET_HEIGHT * rocketScale;
            // keep rocket on screen after resize
            roket.y = Math.max(0, Math.min(roket.y, logicalHeight() - roket.height));
        }

        // scale drawing operations so they match CSS pixels
        if (ctx) {
            ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        }
    }
    window.addEventListener("resize", resizeCanvas);
    resizeCanvas();

    // touch controls require a valid canvas element
    if (typeof initTouchControls === 'function') {
        initTouchControls();
    }
});

// base dimensions used for scaling
const BASE_ROCKET_WIDTH = 200;
const BASE_ROCKET_HEIGHT = 90;

let roket = {
    x: 50,
    y: 0, // will be initialized when canvas size is known
    width: BASE_ROCKET_WIDTH,
    height: BASE_ROCKET_HEIGHT,
    src: "./img/rocket.png",
    image: null
};

let ufos = [];
let explosions = [];
let score = 0;
let bestScore = parseInt(localStorage.getItem('bestScore')) || 0;
let gameOver = null; // { endTime: number }
let createUfosIntervalId = null;
let collisionIntervalId = null;
let bullets = [];
let lastShotTime = 0;
const SHOT_COOLDOWN = 300; // ms between shots
const LASER_LENGTH = 15;
const LASER_HEIGHT = 6;
// Procedural audio using WebAudio (no external files needed)
let audioCtx = null;
let masterGain = null;
let bgGain = null;
let bgNodes = null;
let audioMuted = false;
// UI overlay for volume debug
let showBgOverlay = false;
// load persisted bgVolume if present
const persistedBg = parseFloat(localStorage.getItem('bgGain'));
let bgVolumeDefault = isNaN(persistedBg) ? 0.34 : persistedBg; // increased default per user request

function setBgVolume(v) {
    const val = Math.max(0, Math.min(1, parseFloat(v) || 0));
    bgVolumeDefault = val;
    localStorage.setItem('bgGain', val.toString());
    try {
        if (bgGain && bgGain.gain) bgGain.gain.value = val;
    } catch (e) {}
}

function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 1.0;
    masterGain.connect(audioCtx.destination);
    bgGain = audioCtx.createGain();
    // background music volume: slightly louder and warmer
    bgGain.gain.value = bgVolumeDefault; // persisted or default
    bgGain.connect(masterGain);
}

function startBgMusic() {
    if (audioMuted) return;
    initAudio();
    if (bgNodes) return; // already running

    const osc1 = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    // softer pad: triangle + sine, detuned slightly
    osc1.type = 'triangle';
    osc2.type = 'sine';
    // lower drone pitches for a warmer, less 'high' sound
    osc1.frequency.value = 55; // lower pad (A1)
    osc2.frequency.value = 82.41; // E2-ish
    osc2.detune.value = 12; // slight detune for movement

    const mix = audioCtx.createGain();
    // mix volume for background pad
    mix.gain.value = 0.12;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    // make the pad more "dumpf" (muffled) by lowering the cutoff
    filter.frequency.value = 420;

    osc1.connect(mix);
    osc2.connect(mix);
    mix.connect(filter);
    filter.connect(bgGain);

    // LFO to modulate filter for a moving spacey feel
    const lfo = audioCtx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.03; // even slower
    const lfoGain = audioCtx.createGain();
    lfoGain.gain.value = 100; // more subtle modulation depth for a warmer drone
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);

    osc1.start(); osc2.start(); lfo.start();

    bgNodes = { osc1, osc2, mix, filter, lfo, lfoGain };

    // cheerful arpeggio/pluck with variation - C-major-ish and slightly louder
    const arpGain = audioCtx.createGain();
    arpGain.gain.value = 0.5; // slightly reduced so it sits in the mix
    // route the arpeggio through the same filter/mix so it becomes muffled with the pad
    arpGain.connect(filter);
    const arpPatterns = [
        [261.63, 329.63, 392.00, 523.25],
        [392.00, 329.63, 261.63, 196.00],
        [261.63, 392.00, 523.25, 659.25]
    ];
    let arpIndex = 0;
    const arpInterval = 250; // ms
    const arpTimer = setInterval(() => {
        if (!bgNodes) { clearInterval(arpTimer); return; }
        const pattern = arpPatterns[Math.floor(Math.random() * arpPatterns.length)];
        const baseNote = pattern[arpIndex % pattern.length];
    const osc = audioCtx.createOscillator();
    // prefer softer waves for a muffled sound
    osc.type = Math.random() > 0.95 ? 'sawtooth' : (Math.random() > 0.5 ? 'triangle' : 'sine');
    const freq = baseNote * (Math.random() > 0.9 ? 2 : 1);
        osc.frequency.value = freq;
        const g = audioCtx.createGain();
        g.gain.value = 0.0001;
        osc.connect(g);
        g.connect(arpGain);
        const t0 = audioCtx.currentTime;
    const peak = 0.25 * (0.6 + Math.random() * 0.6);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.01 + Math.random() * 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12 + Math.random() * 0.12);
        osc.start(t0);
        osc.stop(t0 + 0.15 + Math.random() * 0.15);
        // occasional flourish
        if (Math.random() < 0.12) {
            const osc2 = audioCtx.createOscillator();
            osc2.type = 'sine';
            osc2.frequency.value = freq * 1.5;
            const g2 = audioCtx.createGain();
            g2.gain.value = 0.0001;
            osc2.connect(g2); g2.connect(arpGain);
            const t1 = audioCtx.currentTime;
            g2.gain.setValueAtTime(0.0001, t1);
            g2.gain.linearRampToValueAtTime(0.3, t1 + 0.01);
            g2.gain.exponentialRampToValueAtTime(0.0001, t1 + 0.18);
            osc2.start(t1); osc2.stop(t1 + 0.18);
        }
        arpIndex++;
    }, arpInterval);
    // store arpTimer so we can clear it on stop
    bgNodes.arpTimer = arpTimer;
}

function stopBgMusic() {
    if (!bgNodes) return;
    try {
        bgNodes.osc1.stop();
        bgNodes.osc2.stop();
        bgNodes.lfo.stop();
        if (bgNodes.arpTimer) { clearInterval(bgNodes.arpTimer); bgNodes.arpTimer = null; }
    } catch (e) {}
    bgNodes = null;
}

function playExplosionSound() {
    if (audioMuted) return;
    initAudio();
    const now = audioCtx.currentTime;
    // low sine 'thump'
    const thump = audioCtx.createOscillator();
    thump.type = 'sine';
    thump.frequency.value = 80 + Math.random() * 40; // low punch
    const thumpG = audioCtx.createGain();
    thumpG.gain.setValueAtTime(0.0001, now);
    thump.connect(thumpG); thumpG.connect(masterGain);
    thumpG.gain.linearRampToValueAtTime(1.0, now + 0.01);
    thumpG.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    thump.start(now); thump.stop(now + 0.52);

    // filtered noise for the crack
    const bufferSize = Math.floor(audioCtx.sampleRate * 0.12);
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 1.8);
    }
    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;
    const noiseG = audioCtx.createGain();
    noiseG.gain.setValueAtTime(0.0001, now);
    const filt = audioCtx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = 900;
    filt.Q.value = 1.8;
    noise.connect(noiseG); noiseG.connect(filt); filt.connect(masterGain);
    noiseG.gain.linearRampToValueAtTime(0.9, now + 0.005);
    noiseG.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    noise.start(now); noise.stop(now + 0.2);
}

function playSadSound() {
    if (audioMuted) return;
    initAudio();
    const now = audioCtx.currentTime;
    const base = 220; // A3-ish
    const intervals = [0, -3, -7]; // minor-ish descent (semitones approx)
    intervals.forEach((it, idx) => {
        const osc = audioCtx.createOscillator();
        osc.type = idx === 1 ? 'triangle' : 'sine';
        const freq = base * Math.pow(2, it / 12);
        osc.frequency.value = freq;
        const g = audioCtx.createGain();
        g.gain.value = 0.0;
        osc.connect(g);
        g.connect(masterGain);
        const start = now + idx * 0.08;
        const dur = 1.6;
        g.gain.setValueAtTime(0.0001, start);
        g.gain.linearRampToValueAtTime(0.6 / (idx + 1), start + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
        osc.start(start);
        osc.stop(start + dur + 0.1);
    });
}

function setMuted(m) {
    audioMuted = !!m;
    if (audioMuted) {
        stopBgMusic();
    } else {
        startBgMusic();
    }
}
let startTime = 0;
const UFO_BASE_SPEED = 5;
let ufoSpeed = UFO_BASE_SPEED;
const SPEED_INCREASE_START = 60000; // ms (60 seconds)
// continuous growth: how long (ms) it should take to reach max speed from base once growth starts
const SPEED_GROWTH_TIME_TO_MAX_MS = 2 * 60 * 1000; // 2 minutes
let lastFrameTime = 0;
const UFO_BASE_SPEED_PPS = 300; // pixels per second base
let ufoSpeedPPS = UFO_BASE_SPEED_PPS;
const SPEED_RAMP_DURATION = 60000; // ms to ramp from base to max after start
const UFO_MAX_SPEED_PPS = 770; // hard cap for UFO speed (pixels per second)

// Use addEventListener so handlers don't overwrite each other
window.addEventListener('keydown', (e) => {
    // Prefer e.code for reliable key names
    if (e.code === 'Space') {
        KEY_Space = true;
        // try to spawn a bullet (respect cooldown and game state)
        const now = performance.now();
        if (!roket.isDestroyed && !gameOver && (now - lastShotTime) > SHOT_COOLDOWN) {
            spawnBullet();
            lastShotTime = now;
        }
    }
    if (e.code === 'ArrowUp') KEY_Up = true;
    if (e.code === 'ArrowDown') KEY_Down = true;
    // M = mute/unmute
    if (e.code === 'KeyM') {
        setMuted(!audioMuted);
    }
    // ] increase bg volume, [ decrease bg volume
    if (e.key === ']') {
        initAudio();
        bgGain.gain.value = Math.min(1.0, bgGain.gain.value + 0.03);
        localStorage.setItem('bgGain', bgGain.gain.value.toString());
    }
    if (e.key === '[') {
        initAudio();
        bgGain.gain.value = Math.max(0.0, bgGain.gain.value - 0.03);
        localStorage.setItem('bgGain', bgGain.gain.value.toString());
    }
    // V toggle overlay
    if (e.code === 'KeyV') {
        showBgOverlay = !showBgOverlay;
    }
});
window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') KEY_Space = false;
    if (e.code === 'ArrowUp') KEY_Up = false;
    if (e.code === 'ArrowDown') KEY_Down = false;
});

function createufos(params) {
    // size UFO according to current scale, then apply extra halving for mobile
    let U_WIDTH = 100 * scale;
    let U_HEIGHT = 40 * scale;
    if (scale < 1) {
        U_WIDTH *= MOBILE_SIZE_REDUCTION;
        U_HEIGHT *= MOBILE_SIZE_REDUCTION;
    }
    let ufo = {
     // x will be set to the right edge after width is known
     y: Math.random() * (logicalHeight() - U_HEIGHT - 20) + 20,
     width: U_WIDTH,
     height: U_HEIGHT,
     src: "./img/ufo.png",
     image: new Image()

};
    // place ufo exactly at the right edge so it's fully visible
    ufo.x = logicalWidth() - ufo.width;
    console.log('createufos: created ufo at x=' + ufo.x + ' y=' + ufo.y + ' (ufos before push=' + ufos.length + ')');
    ufo.image.onload = () => console.log('ufo loaded at y=' + ufo.y);
    ufo.image.onerror = () => console.error('Failed to load ufo (src=' + ufo.src + ')');
    ufo.image.src = ufo.src; // ufo bild wird geladen
     ufos.push(ufo);

}

function spawnBullet() {
    // Bullet originates from the front of the rocket
    const bx = roket.x + roket.width;
    const by = roket.y + roket.height / 2;
    // adjust bullet speed/size with scale (slower and shorter on mobile)
    // reduce bullet speed on mobile as well
    const bulletSpeedFactor = scale < 1 ? MOBILE_SPEED_FACTOR : 1;
    bullets.push({ x: bx, y: by, vx: 800 * scale * bulletSpeedFactor * BULLET_SPEED_BOOST, length: LASER_LENGTH * scale, height: LASER_HEIGHT * scale });
    // play a short laser sound
    playLaserSound();
}

function playLaserSound() {
    if (audioMuted) return;
    initAudio();
    const now = audioCtx.currentTime;
    // short pitch-sweep 'pew' using oscillator + bandpass for laser character
    const osc = audioCtx.createOscillator();
    osc.type = 'sawtooth';
    const g = audioCtx.createGain();
    const bp = audioCtx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1200;
    bp.Q.value = 8;
    osc.connect(bp);
    bp.connect(g);
    g.connect(masterGain);
    // envelope
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.7, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    // pitch sweep
    osc.frequency.setValueAtTime(1600, now);
    osc.frequency.exponentialRampToValueAtTime(700, now + 0.12);
    osc.start(now);
    osc.stop(now + 0.14);
}

function createExplosion(cx, cy, opts) {
    opts = opts || {};
    const count = opts.count || 18;
    const duration = opts.duration || 600;
    const colors = opts.colors || ['#ffd66b', '#ff9a3c', '#ff5c5c'];
    const particles = [];
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.06 + Math.random() * 0.26; // px per ms
        const vx = Math.cos(angle) * speed;
        const vy = Math.sin(angle) * speed;
        const radius = 2 + Math.random() * 4;
        const color = colors[Math.floor(Math.random() * colors.length)];
        particles.push({ vx: vx, vy: vy, r: radius, color: color });
    }
    explosions.push({ x: cx, y: cy, start: performance.now(), duration: duration, particles: particles });
}





async function startGame() {
    // initialize context first
    if (!canvas) {
        console.error('Canvas element not found');
        return;
    }
    ctx = canvas.getContext('2d');

    // center rocket vertically according to current canvas size
    let rocketScale = scale;
    if (scale < 1) rocketScale *= ROCKET_EXTRA_SCALE;
    roket.width = BASE_ROCKET_WIDTH * rocketScale;
    roket.height = BASE_ROCKET_HEIGHT * rocketScale;
    roket.y = (logicalHeight() - roket.height) / 2;

    // Load initial images (background + rocket), then start the render loop
    await loadImages();

    // start procedural background music (may be blocked until user gesture)
    startBgMusic();

    // Create ufos periodically every 3 seconds
    createUfosIntervalId = setInterval(createufos, 3000);
    collisionIntervalId = setInterval(checkforcollisions, 100 / 25);

    // set game start time and last frame time
    startTime = performance.now();
    lastFrameTime = startTime;

    requestAnimationFrame(draw);

}

function checkforcollisions(params) {
    ufos.forEach(function(ufo){
        // AABB collision check between `roket` and `ufo`
        if (roket.x < ufo.x + ufo.width &&
            roket.x + roket.width > ufo.x &&
            roket.y < ufo.y + ufo.height &&
            roket.y + roket.height > ufo.y) {
            // Only handle the first collision for the rocket
            if (!roket.isDestroyed) {
                // mark the ufo for removal
                ufo._hit = true;

                // score is NOT increased here; bullets give points. Rocket collision -> game over

                // replace the rocket image with boom.png (use preloaded image)
                roket.image = roket.boomImage || roket.image;
                roket.isDestroyed = true;

                // stop creating new ufos and collision checks, start 10s reload
                if (createUfosIntervalId) { clearInterval(createUfosIntervalId); createUfosIntervalId = null; }
                if (collisionIntervalId) { clearInterval(collisionIntervalId); collisionIntervalId = null; }
                // mark game over and schedule a soft restart in 5 seconds
                gameOver = { endTime: performance.now() + 5000 };
                // play sad sound for game over
                playSadSound();
                setTimeout(function(){ softRestart(); }, 5000);

                console.log('Collision detected !! rocket replaced by boom.png; reload in 5s');
            }
        }
    });
}
function loadImages() {
    // Return a promise that resolves once all images have loaded (or errored)
    const images = [];

    backgroundimage.src = './img/background.jpg';
    images.push(waitForImage(backgroundimage, 'background'));

    roket.image = new Image();
    roket.image.src = roket.src;
    images.push(waitForImage(roket.image, 'rocket'));

    // keep a reference to the original rocket image so we can restore it after an explosion
    // (waitForImage above ensures the image will be loaded)
    roket.origImage = roket.image;

    // preload boom image so replacement is instant on collision
    roket.boomImage = new Image();
    roket.boomImage.src = './img/boom.png';
    images.push(waitForImage(roket.boomImage, 'boom'));

    // Return a single promise so callers can await all images
    return Promise.all(images);

}

function waitForImage(img, name) {
    return new Promise((resolve) => {
        if (img.complete && img.naturalWidth !== 0) {
            console.log(name + ' already loaded');
            resolve();
            return;
        }
        img.onload = () => {
            console.log(name + ' loaded');
            resolve();
        };
        img.onerror = () => {
            console.error('Failed to load ' + name + ' (src=' + img.src + ')');
            resolve(); // resolve anyway so app can continue
        };
    });
}

function draw() {
    if (!ctx) return;
    // clear (physical pixels – unaffected by transform)
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const w = logicalWidth();
    const h = logicalHeight();

    // draw background stretched to logical size
    if (backgroundimage && backgroundimage.complete) {
        try {
            ctx.drawImage(backgroundimage, 0, 0, w, h);
        } catch (e) {
            console.warn('Could not draw background:', e);
        }
    }

    // simple controls for rocket (disabled when destroyed)
    if (!roket.isDestroyed) {
        // apply extra slow factor on mobile including user halving
        let speedFactor = scale < 1 ? MOBILE_SPEED_FACTOR * MOBILE_TOUCH_REDUCTION : 1;
        // if in portrait orientation, slow even more
        if (logicalHeight() > logicalWidth()) {
            speedFactor *= PORTRAIT_TOUCH_FACTOR;
        }
        const step = 9 * scale * speedFactor;
        if (KEY_Up) roket.y -= step;
        if (KEY_Down) roket.y += step;
        // clamp rocket to canvas
        if (roket.y < 0) roket.y = 0;
        if (roket.y + roket.height > h) roket.y = h - roket.height;
    }
    if (roket.image && roket.image.complete) {
        ctx.drawImage(roket.image, roket.x, roket.y, roket.width, roket.height);
    }

    // time delta (seconds)
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastFrameTime) / 1000); // clamp dt to avoid big jumps
    lastFrameTime = now;

    // determine ufo speed in px/s. We'll ramp from base to max linearly over SPEED_RAMP_DURATION after SPEED_INCREASE_START.
    // Calculate max speed so that an ufo spawned at right edge reaches rocket.x in ~1s: maxSpeed = (logicalWidth() - roket.x) / 1s
    let maxSpeedPPS = Math.max(200, (logicalWidth() - roket.x) / 1.0);
    // slow UFOs based on scale, mobile speed reduction, additional halving
    let speedFactor = scale < 1 ? MOBILE_SPEED_FACTOR * MOBILE_SPEED_REDUCTION : 1;
    maxSpeedPPS *= scale * speedFactor * UFO_SPEED_REDUCTION_FACTOR;
    // further reduce in portrait orientation
    if (logicalHeight() > logicalWidth()) {
        maxSpeedPPS *= PORTRAIT_UFO_SPEED_FACTOR;
    }
    const elapsed = now - startTime;
    if (elapsed <= SPEED_INCREASE_START) {
        ufoSpeedPPS = UFO_BASE_SPEED_PPS;
    } else {
        const rampElapsed = elapsed - SPEED_INCREASE_START;
        const t = Math.min(1, rampElapsed / SPEED_GROWTH_TIME_TO_MAX_MS); // 0..1
        ufoSpeedPPS = UFO_BASE_SPEED_PPS + (maxSpeedPPS - UFO_BASE_SPEED_PPS) * t;
        // clamp to hard max
        if (ufoSpeedPPS > UFO_MAX_SPEED_PPS) ufoSpeedPPS = UFO_MAX_SPEED_PPS;
    }

    // Move all ufos to the left by ufoSpeedPPS * dt
    ufos.forEach(function(u){
        u.x -= ufoSpeedPPS * dt;
    });

    // Update bullets (vx is px/s)
    bullets.forEach(function(b){
        b.x += b.vx * dt;
    });

    // Remove bullets off-screen
    bullets = bullets.filter(function(b){
        return b.x - b.length < logicalWidth();
    });

    // Bullet <-> Ufo collision: check and apply score (rectangular laser collision)
    bullets.forEach(function(b){
        ufos.forEach(function(u){
            if (!u._hit) {
                // bullet rect: [b.x, b.x + b.length] x [b.y - h/2, b.y + h/2]
                const bl = b.x;
                const br = b.x + b.length;
                const bt = b.y - b.height/2;
                const bb = b.y + b.height/2;

                if (br > u.x && bl < u.x + u.width && bb > u.y && bt < u.y + u.height) {
                    // hit
                    u._hit = true;
                    // spawn particle explosion
                    createExplosion(u.x + u.width/2, u.y + u.height/2, { count: 20, duration: 600 });
                    // play explosion sound
                    playExplosionSound();
                    // mark bullet for removal by moving it off-screen
                    b.x = logicalWidth() + 1000;
                    score += 10;
                    if (score > bestScore) { bestScore = score; localStorage.setItem('bestScore', bestScore); }
                }
            }
        });
    });

    // Remove ufos that were hit and filter out those off-screen
    // check if any live (not hit) UFO has passed the left edge -> Game Over
    for (let i = 0; i < ufos.length; i++) {
        const u = ufos[i];
        if (!u._hit && (u.x + u.width) < 0) {
            // trigger game over
            if (!roket.isDestroyed) {
                roket.image = roket.boomImage || roket.image;
                roket.isDestroyed = true;
                if (createUfosIntervalId) { clearInterval(createUfosIntervalId); createUfosIntervalId = null; }
                if (collisionIntervalId) { clearInterval(collisionIntervalId); collisionIntervalId = null; }
                gameOver = { endTime: performance.now() + 5000 };
                playSadSound();
                setTimeout(function(){ softRestart(); }, 5000);
                console.log('Game over: UFO passed left edge');
                break;
            }
        }
    }
    // remove hit ufos and those off-screen
    ufos = ufos.filter(function(u){
        if (u._hit) return false;
        return (u.x + u.width) > 0;
    });

    // Draw ufos (only if their images loaded)
    ufos.forEach(function(u){
        if (u.image && u.image.complete && u.image.naturalWidth !== 0) {
            ctx.drawImage(u.image, u.x, u.y, u.width, u.height);
        }
    });

    // Draw bullets as short lasers (rectangles)
    ctx.save();
    ctx.fillStyle = 'cyan';
    bullets.forEach(function(b){
        const bx = b.x;
        const by = b.y - b.height/2;
        ctx.fillRect(bx, by, b.length, b.height);
    });
    ctx.restore();

    // Update and draw particle explosions (use `now` from earlier)
    explosions = explosions.filter(function(ex){
        const t = (now - ex.start);
        if (t >= ex.duration) return false;
        const progress = t / ex.duration;
        // draw particles
        ex.particles.forEach(function(p){
            const px = ex.x + p.vx * t;
            const py = ex.y + p.vy * t;
            const alpha = 1 - progress;
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(px, py, p.r * (1 - progress * 0.5), 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        });
        return true;
    });

    // Draw score
    ctx.save();
    ctx.fillStyle = 'white';
    ctx.font = '24px sans-serif';
    ctx.fillText('Score: ' + score + '   Best: ' + bestScore, 20, 30);
    ctx.restore();

    // If game over, draw large semi-transparent countdown in the background and 'GAME OVER' centered
    if (gameOver) {
        const remaining = Math.max(0, Math.ceil((gameOver.endTime - now) / 1000));

        // big background timer
        ctx.save();
        ctx.globalAlpha = 0.15;
        ctx.fillStyle = 'black';
        ctx.font = '140px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(remaining.toString(), logicalWidth() / 2, logicalHeight() / 2);
        ctx.restore();

        // GAME OVER text (white)
        ctx.save();
        ctx.fillStyle = 'white';
        ctx.font = '72px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('GAME OVER', logicalWidth() / 2, logicalHeight() / 2 - 10);
        ctx.restore();
    }

    // draw current UFO speed (debug)
    ctx.save();
    ctx.fillStyle = 'lightgray';
    ctx.font = '16px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('UFO speed: ' + Math.round(ufoSpeedPPS) + ' px/s', logicalWidth() - 10, logicalHeight() - 10);
    ctx.restore();
    // optional background volume overlay
    if (showBgOverlay) {
        ctx.save();
        const w = 220, h = 60;
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = '#000';
        ctx.fillRect(10, 10, w, h);
        ctx.fillStyle = 'white';
        ctx.font = '16px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('BG Volume: ' + (bgGain ? bgGain.gain.value.toFixed(2) : 'n/a'), 20, 34);
        ctx.fillText('] increase  [ decrease  V toggle', 20, 52);
        ctx.restore();
    }
 
    requestAnimationFrame(draw);
}








// Expose startGame on the global so body onload can call it
function softRestart() {
    // preserve best score
    const preservedBest = bestScore;

    // clear intervals if any
    if (createUfosIntervalId) { clearInterval(createUfosIntervalId); createUfosIntervalId = null; }
    if (collisionIntervalId) { clearInterval(collisionIntervalId); collisionIntervalId = null; }

    // reset arrays and flags
    ufos = [];
    bullets = [];
    explosions = [];
    score = 0;
    bestScore = preservedBest;
    gameOver = null;

    // restore rocket image and state
    roket.image = roket.origImage || roket.image;
    roket.isDestroyed = false;
    roket.x = 50;
    // reapply scaled dimensions and center vertically
    let rocketScale = scale;
    if (scale < 1) rocketScale *= ROCKET_EXTRA_SCALE;
    roket.width = BASE_ROCKET_WIDTH * rocketScale;
    roket.height = BASE_ROCKET_HEIGHT * rocketScale;
    roket.y = (logicalHeight() - roket.height) / 2;

    // reset timers
    startTime = performance.now();
    lastFrameTime = startTime;

    // restart intervals
    createUfosIntervalId = setInterval(createufos, 3000);
    collisionIntervalId = setInterval(checkforcollisions, 100 / 25);

    // resume the draw loop (it's already running via rAF, but ensure state is fresh)
    requestAnimationFrame(draw);
}

window.startGame = startGame;


// ============================
// MOBILE TOUCH CONTROLS
// ============================

function initTouchControls() {
    let touchStartY = null;

    canvas.addEventListener("touchstart", (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        touchStartY = touch.clientY;

        // rechte Bildschirmhälfte = schießen
        if (touch.clientX > logicalWidth() / 2) {
            const now = performance.now();
            if (!roket.isDestroyed && !gameOver && (now - lastShotTime) > SHOT_COOLDOWN) {
                spawnBullet();
                lastShotTime = now;
            }
        }
    });

    canvas.addEventListener("touchmove", (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        const moveY = touch.clientY;

        if (moveY < logicalHeight() / 2) {
            KEY_Up = true;
            KEY_Down = false;
        } else {
            KEY_Down = true;
            KEY_Up = false;
        }
    });

    canvas.addEventListener("touchend", () => {
        KEY_Up = false;
        KEY_Down = false;
    });

    document.body.addEventListener("touchmove", function(e){
        e.preventDefault();
    }, { passive:false });
}