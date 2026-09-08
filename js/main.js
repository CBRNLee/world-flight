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
  var lastT     = 0, hudTick = 0, shakeT = 0, netTick = 0;

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
    camNote:   document.getElementById('camNote'),
    btnNet:    document.getElementById('btnNet'),
    netHelp:   document.getElementById('netHelp'),
    netPanel:  document.getElementById('netPanel'),
    netList:   document.getElementById('netList'),
    netCodeTag:document.getElementById('netCodeTag'),
    netName:   document.getElementById('netName'),
    netCode:   document.getElementById('netCode'),
    netNote:   document.getElementById('netNote')
  };

  /* ---------------------------------------------------------- 화면 크기 */
  function resize() {
    var w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (w * h * dpr * dpr > 4.2e6) dpr = Math.sqrt(4.2e6 / (w * h));   /* 성능 보호 */
    R.resize(w, h, dpr);
    /* 카메라 미리보기는 계기판 바로 위에 (방향 버튼·계기와 겹치지 않게) */
    var pb = (Cockpit.panelHeight(w, h) + 10) + 'px';
    el.camPanel.style.bottom = pb;
    el.netPanel.style.bottom = pb;
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

  /* ------------------------------------------------------- 함께 하기 */
  function onNetChange(phase, m) {
    var on = (phase !== 'off');
    el.netPanel.classList.toggle('show', on);
    el.btnNet.classList.toggle('on', phase === 'on');
    el.netNote.textContent = m || '';
    el.netCodeTag.textContent = Net.code() || '----';
    if (phase === 'on') el.netHelp.classList.remove('show');
    renderNetList();
  }

  function renderNetList() {
    var friends = Net.peers();
    if (!friends.length) {
      el.netList.innerHTML = '<div class="none">' +
        (Net.phase() === 'on' ? '아직 친구가 없어요.<br />같은 코드를 넣으면 만나요!' : '연결하는 중…') +
        '</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < friends.length; i++) {
      var f = friends[i], c = Net.color(f.ci);
      var dx = World.wrapDelta(f.rx, plane.pos[0]);
      var dz = World.wrapDelta(f.rz, plane.pos[2]);
      html += '<div class="who">' +
        '<span class="dot" style="background:rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')"></span>' +
        '<span class="nm">' + esc(f.name || '친구') + '</span>' +
        '<span class="km">' + (Math.hypot(dx, dz) / 1000).toFixed(1) + 'km</span></div>';
    }
    el.netList.innerHTML = html;
  }

  function esc(t) {
    return String(t).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function openNet() {
    if (Net.phase() !== 'off') { el.netPanel.classList.toggle('show'); return; }
    if (!el.netCode.value) el.netCode.value = Net.newCode();
    el.netHelp.classList.add('show');
  }

  function bindNet() {
    Net.plane = plane;
    el.btnNet.addEventListener('click', openNet);
    document.getElementById('netNew').addEventListener('click', function () {
      el.netCode.value = Net.newCode();
    });
    document.getElementById('netJoin').addEventListener('click', function () {
      var codeVal = (el.netCode.value || '').trim();
      if (codeVal.length < 3) { el.netNote.textContent = '코드를 네 자리 넣어 주세요.'; return; }
      Net.join(codeVal, el.netName.value || '조종사', onNetChange);
    });
    document.getElementById('netLeave').addEventListener('click', function () {
      Net.leave(); onNetChange('off', '');
    });
    el.netCode.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') document.getElementById('netJoin').click();
    });
  }

  function bind() {
    bindCamera();
    bindNet();
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
  var frameErrors = 0;

  function loop(t) {
    /* 한 프레임이 잘못돼도 놀이가 통째로 멈추면 안 됩니다.
       (아이들 앞에서 화면이 까맣게 굳는 것이 가장 나쁜 고장이라서) */
    try { frame(t); }
    catch (e) {
      if (++frameErrors <= 3 && window.console) console.error('한 프레임을 건너뜁니다:', e);
    }
    requestAnimationFrame(loop);
  }

  function frame(t) {
    var dt = Math.min(0.05, (t - lastT) / 1000);
    lastT = t;

    Vision.update(t);
    Net.update(dt);
    if ((netTick += dt) > 0.4) { netTick = 0; if (Net.phase() !== 'off') renderNetList(); }

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

    var friends = Net.phase() !== 'off' ? Net.peers() : [];
    var tags = [], i, at;
    for (i = 0; i < friends.length; i++) {
      at = World.drawPlayer(R, plane.pos, friends[i]);
      if (at) tags.push({ at: at, f: friends[i] });
    }
    R.flush();
    drawNameTags(R, tags);

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
      friends:  Net.isOn() ? Net.count() : -1,
      overCity: overCity
    });
  }

  /* 친구 비행기 위에 이름표를 붙인다 (계기판보다 아래 순서로 그려서 가려지게) */
  function drawNameTags(R, tags) {
    if (!tags.length) return;
    var ctx = R.ctx, i;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (i = 0; i < tags.length; i++) {
      var t = tags[i], p = R.project(t.at[0], t.at[1] + 90, t.at[2]);
      if (!p) continue;
      if (p.x < -80 || p.x > R.w + 80 || p.y < -40 || p.y > R.h) continue;
      var fs = Math.max(10, Math.min(15, 2200 / p.d));
      ctx.font = '800 ' + fs.toFixed(0) + 'px "Apple SD Gothic Neo", sans-serif';
      var label = (t.f.name || '친구') + '  ' + (p.d / 1000).toFixed(1) + 'km';
      var w = ctx.measureText(label).width + 16, h = fs + 10;
      var c = Net.color(t.f.ci);
      ctx.globalAlpha = p.d > 9000 ? 0.35 : 1;
      ctx.beginPath();
      roundRect(ctx, p.x - w / 2, p.y - h / 2, w, h, h / 2);
      ctx.fillStyle = 'rgba(10,16,22,0.72)'; ctx.fill();
      ctx.strokeStyle = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
      ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.fillText(label, p.x, p.y + 1);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    if (!(w > 0) || !(h > 0)) return;
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
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
    if (action === 'friends')   openNet();
  });
  bind();
  updateStamps();
  updateHUD(true);

  /* 개발/확인용 — 브라우저 콘솔에서 SIM.plane 으로 상태를 볼 수 있습니다 */
  window.SIM = { plane: plane, setDest: setDest, renderer: R,
                 state: function () { return { autopilot: autopilot, visited: visited,
                                               dest: dest().name, overCity: overCity }; } };

  /* 시작 화면 뒤에서도 배경이 보이도록 한 장면 그려둔다 */
  try { render(0); } catch (e) { /* 창이 아직 자리를 못 잡았으면 다음 프레임에 */ }
})();
