/* =========================================================================
 *  main.js — 전체를 이어 붙이고 매 순간 화면을 새로 그립니다.
 * ========================================================================= */
'use strict';

/* ------------------------------------------------------------------ 소리 */
var Sound = (function () {
  var ac = null, osc1, osc2, filt, gain;
  var enabled = true;

  function start() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    gain = ac.createGain(); gain.gain.value = 0;
    filt = ac.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 400;
    osc1 = ac.createOscillator(); osc1.type = 'sawtooth'; osc1.frequency.value = 60;
    osc2 = ac.createOscillator(); osc2.type = 'square';   osc2.frequency.value = 90;
    var g2 = ac.createGain(); g2.gain.value = 0.3;
    osc1.connect(filt); osc2.connect(g2); g2.connect(filt);
    filt.connect(gain); gain.connect(ac.destination);
    osc1.start(); osc2.start();
  }
  function update(thr) {
    if (!ac) return;
    var t = ac.currentTime, f = 48 + thr * 66;
    osc1.frequency.setTargetAtTime(f, t, 0.18);
    osc2.frequency.setTargetAtTime(f * 1.51, t, 0.18);
    filt.frequency.setTargetAtTime(280 + thr * 950, t, 0.25);
    gain.gain.setTargetAtTime(enabled ? 0.022 + thr * 0.05 : 0, t, 0.25);
  }
  function chime() {
    if (!ac || !enabled) return;
    [0, 0.13, 0.26, 0.42].forEach(function (d, i) {
      var o = ac.createOscillator(), g = ac.createGain();
      o.type = 'triangle';
      o.frequency.value = [523.25, 659.25, 783.99, 1046.5][i];
      g.gain.setValueAtTime(0.0001, ac.currentTime + d);
      g.gain.exponentialRampToValueAtTime(0.16, ac.currentTime + d + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + d + 0.5);
      o.connect(g); g.connect(ac.destination);
      o.start(ac.currentTime + d); o.stop(ac.currentTime + d + 0.55);
    });
  }
  return {
    start: start, update: update, chime: chime,
    toggle: function () { enabled = !enabled; return enabled; },
    isOn: function () { return enabled; }
  };
})();

/* ------------------------------------------------------------------ 본체 */
(function () {

  var canvas = document.getElementById('scene');
  var R      = new Engine3D.Renderer(canvas);
  var plane  = new Aircraft();

  var running   = false;
  var autopilot = false;
  var destIdx   = 1;                 /* 처음 목적지 = 도쿄 */
  var visited   = Object.create(null);
  var overCity  = null;
  var lastT     = 0, hudTick = 0, shakeT = 0;

  var el = {
    destName:  document.getElementById('destName'),
    destFlag:  document.getElementById('destFlag'),
    destDist:  document.getElementById('destDist'),
    stampCount:document.getElementById('stampCount'),
    stampTotal:document.getElementById('stampTotal'),
    banner:    document.getElementById('cityBanner'),
    start:     document.getElementById('startScreen'),
    passport:  document.getElementById('passport'),
    stamps:    document.getElementById('stamps'),
    help:      document.getElementById('help'),
    btnAuto:   document.getElementById('btnAuto'),
    btnSound:  document.getElementById('btnSound'),
    btnCam:    document.getElementById('btnCam'),
    camHelp:   document.getElementById('camHelp'),
    camPanel:  document.getElementById('camPanel'),
    camView:   document.getElementById('camView'),
    camStart:  document.getElementById('camStart'),
    camNote:   document.getElementById('camNote')
  };

  /* ---------------------------------------------------------- 화면 크기 */
  function resize() {
    var w = window.innerWidth, h = window.innerHeight;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (w * h * dpr * dpr > 4.2e6) dpr = Math.sqrt(4.2e6 / (w * h));   /* 성능 보호 */
    R.resize(w, h, dpr);
    /* 카메라 미리보기는 계기판 바로 위에 (방향 버튼·계기와 겹치지 않게) */
    el.camPanel.style.bottom = (Cockpit.panelHeight(w, h) + 10) + 'px';
  }
  window.addEventListener('resize', resize);

  /* ------------------------------------------------------------ 목적지 */
  function dest() { return World.cities()[destIdx]; }

  function setDest(i) {
    var list = World.cities();
    destIdx = ((i % list.length) + list.length) % list.length;
    updateHUD(true);
  }
  function nextDest() {
    var list = World.cities(), i;
    for (i = 1; i <= list.length; i++) {
      var k = (destIdx + i) % list.length;
      if (!visited[list[k].id]) { setDest(k); return; }
    }
    setDest(destIdx + 1);
  }

  function distTo(c) {
    var dx = World.wrapDelta(c.x, plane.pos[0]);
    var dz = World.wrapDelta(c.z, plane.pos[2]);
    return Math.hypot(dx, dz);
  }
  function bearingTo(c) {
    var dx = World.wrapDelta(c.x, plane.pos[0]);
    var dz = World.wrapDelta(c.z, plane.pos[2]);
    return Math.atan2(dx, dz);
  }

  /* -------------------------------------------------------------- 도착 */
  function checkArrival() {
    var list = World.cities(), i, near = null;
    for (i = 0; i < list.length; i++) {
      if (distTo(list[i]) < 1700) { near = list[i]; break; }
    }
    overCity = near ? near.name : null;
    if (near && !visited[near.id]) {
      visited[near.id] = true;
      Sound.chime();
      showBanner(near);
      updateStamps();
      if (near.id === dest().id) setTimeout(nextDest, 2600);
    }
  }

  function showBanner(c) {
    el.banner.innerHTML =
      '<div class="bn-flag">' + c.flag + '</div>' +
      '<div class="bn-txt">' +
        '<div class="bn-sub">도착했어요!</div>' +
        '<div class="bn-name">' + c.name + ' <small>' + c.country + '</small></div>' +
        '<div class="bn-fact">' + c.fact + '</div>' +
      '</div>' +
      '<div class="bn-stamp">여권 도장 +1</div>';
    el.banner.classList.add('show');
    clearTimeout(showBanner.t);
    showBanner.t = setTimeout(function () { el.banner.classList.remove('show'); }, 6000);
  }

  function updateStamps() {
    var list = World.cities(), n = 0, html = '';
    for (var i = 0; i < list.length; i++) {
      var c = list[i], got = !!visited[c.id];
      if (got) n++;
      html += '<div class="stamp' + (got ? ' got' : '') + '" data-i="' + i + '">' +
                '<div class="st-flag">' + c.flag + '</div>' +
                '<div class="st-name">' + c.name + '</div>' +
                '<div class="st-lm">' + c.landmark + '</div>' +
                (got ? '<div class="st-mark">✓ 다녀옴</div>'
                     : '<div class="st-go">여기로 가기</div>') +
              '</div>';
    }
    el.stamps.innerHTML = html;
    el.stampCount.textContent = n;
    if (el.stampTotal) el.stampTotal.textContent = list.length;
    el.stamps.querySelectorAll('.stamp').forEach(function (d) {
      d.addEventListener('click', function () {
        setDest(parseInt(d.getAttribute('data-i'), 10));
        el.passport.classList.remove('show');
      });
    });
  }

  /* ---------------------------------------------------------------- HUD */
  function updateHUD(force) {
    var c = dest();
    el.destName.textContent = c.name;
    el.destFlag.textContent = c.flag;
    el.destDist.textContent = (distTo(c) / 1000).toFixed(1);
    if (force) el.stampCount.textContent = Object.keys(visited).length;
  }

  /* -------------------------------------------------------------- 버튼 */
  function toggleAuto() {
    autopilot = !autopilot;
    el.btnAuto.classList.toggle('on', autopilot);
  }
  function toggleSound() {
    var on = Sound.toggle();
    el.btnSound.classList.toggle('off', !on);
    el.btnSound.innerHTML = on ? '🔊 소리' : '🔇 소리';
  }

  /* ---------------------------------------------------- 카메라(몸으로 조종) */
  function onCamPhase(phase, m) {
    var on = (phase !== 'off' && phase !== 'error');
    el.camPanel.classList.toggle('show', on);
    el.btnCam.classList.toggle('on', phase === 'on');
    el.camStart.disabled = on;
    el.camNote.textContent = m || '';
    if (phase === 'on') {
      el.camHelp.classList.remove('show');
      if (autopilot) toggleAuto();            /* 몸으로 조종할 땐 자동조종 끄기 */
    }
  }

  function openCam() {
    if (Vision.isRunning()) { el.camPanel.classList.toggle('show'); return; }
    el.camHelp.classList.add('show');
  }

  function bindCamera() {
    el.btnCam.addEventListener('click', openCam);
    el.camStart.addEventListener('click', function () {
      el.camNote.textContent = '카메라 사용을 허락해 주세요…';
      Vision.start(el.camView, onCamPhase);
    });
    document.getElementById('camBg').addEventListener('click', Vision.captureBackground);
    document.getElementById('camPose').addEventListener('click', Vision.capturePose);
    document.getElementById('camOff').addEventListener('click', Vision.stop);
    document.getElementById('camSens').addEventListener('input', function () {
      Vision.setSensitivity(parseInt(this.value, 10));
    });
  }

  function bind() {
    bindCamera();
    document.getElementById('btnDest').addEventListener('click', function () { setDest(destIdx + 1); });
    el.btnAuto.addEventListener('click', toggleAuto);
    el.btnSound.addEventListener('click', toggleSound);
    document.getElementById('btnPassport').addEventListener('click', function () {
      updateStamps(); el.passport.classList.toggle('show');
    });
    document.getElementById('btnHelp').addEventListener('click', function () {
      el.help.classList.toggle('show');
    });
    document.querySelectorAll('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () {
        document.getElementById(b.getAttribute('data-close')).classList.remove('show');
      });
    });
    document.getElementById('btnGo').addEventListener('click', begin);
  }

  function begin() {
    el.start.classList.add('gone');
    Sound.start();
    if (!running) { running = true; lastT = performance.now(); requestAnimationFrame(loop); }
  }

  /* --------------------------------------------------------------- 루프 */
  function loop(t) {
    var dt = Math.min(0.05, (t - lastT) / 1000);
    lastT = t;

    Vision.update(t);

    var cmd = Input.poll();
    if (autopilot) {
      /* 아이가 조종간을 만지면 자동조종은 즉시 꺼진다 */
      if (cmd.manual) toggleAuto();
      else plane.autopilot(dest(), cmd);
    }
    plane.update(dt, cmd);
    Sound.update(plane.throttle);

    render(t);

    checkArrival();
    if ((hudTick += dt) > 0.12) { hudTick = 0; updateHUD(); }

    requestAnimationFrame(loop);
  }

  function render(t) {
    var W = R.w, H = R.h;
    var panelH = Cockpit.panelHeight(W, H);
    R.horizonY = (H - panelH) * 0.53;

    /* 속도에 따른 아주 작은 흔들림 */
    shakeT += 0.016;
    var amp = 0.0016 + plane.throttle * 0.0022;

    R.begin({
      pos:   plane.pos,
      yaw:   plane.yaw,
      pitch: plane.pitch + Math.sin(shakeT * 3.7) * amp,
      roll:  plane.roll  + Math.sin(shakeT * 2.3) * amp * 1.4,
      fov:   1.18
    });
    R.drawSky();
    World.collect(R, plane.pos, t / 1000);
    R.flush();

    Cockpit.draw(R.ctx, W, H, {
      speedKmh: plane.speed * 3.6,
      altM:     plane.pos[1],
      pitch:    plane.pitch,
      roll:     plane.roll,
      yaw:      plane.yaw,
      throttle: plane.throttle,
      bearing:  bearingTo(dest()),
      destFlag: dest().flag,
      autopilot: autopilot,
      lowAlt:   plane.pos[1] < 200 && (t % 700 < 420),
      sound:    Sound.isOn(),
      camera:   Vision.isActive(),
      overCity: overCity
    });
  }

  /* --------------------------------------------------------------- 시작 */
  World.init();
  resize();
  Input.init(canvas, function (action) {
    if (!running) { begin(); return; }
    if (action === 'autopilot') toggleAuto();
    if (action === 'nextCity')  setDest(destIdx + 1);
    if (action === 'sound')     toggleSound();
    if (action === 'passport')  { updateStamps(); el.passport.classList.toggle('show'); }
    if (action === 'camera')    openCam();
  });
  bind();
  updateStamps();
  updateHUD(true);

  /* 개발/확인용 — 브라우저 콘솔에서 SIM.plane 으로 상태를 볼 수 있습니다 */
  window.SIM = { plane: plane, setDest: setDest, renderer: R,
                 state: function () { return { autopilot: autopilot, visited: visited,
                                               dest: dest().name, overCity: overCity }; } };

  /* 시작 화면 뒤에서도 배경이 보이도록 한 장면 그려둔다 */
  render(0);
})();
