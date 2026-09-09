/* =========================================================================
 *  tilt.js — 태블릿을 핸들처럼 기울여서 조종하기
 *
 *   · 좌우로 기울이면   → 비행기가 그쪽으로 돌아요
 *   · 위아래로 기울이면 → 비행기가 올라가고 내려가요
 *   · 가만히 들고 있으면 → 수평 비행
 *   · 빠르기는 화면 오른쪽 '출력' 막대로
 *
 *  ★ 절대 각도가 아니라 '지금 잡고 있는 자세'를 중립으로 삼습니다.
 *    책상에 눕혀 두든, 세워서 들든, 비스듬히 들든 편한 자세 그대로 쓰면 됩니다.
 *    자세가 틀어지면 '가운데' 버튼을 한 번 누르면 다시 맞춰집니다.
 *
 *  화면을 가로로 돌려도 되도록 화면 회전 각도를 함께 봅니다.
 *
 *  ★ 왜 '중력 방향'을 쓰나
 *    기기가 알려 주는 기울기 각(beta·gamma)은 태블릿을 세워서 잡으면
 *    값이 튀어 버립니다(짐벌락). 그런데 핸들처럼 잡으려면 세워서 잡게 되니,
 *    제대로 잡을수록 조종이 안 되는 셈이었습니다.
 *    그래서 각도 대신 '중력이 어느 쪽인지'를 직접 재서 씁니다.
 *    이 방식은 눕히든 세우든 값이 튀지 않습니다.
 * ========================================================================= */
'use strict';

var Tilt = (function () {

  var phase = 'off';        /* off | asking | calib | on | error */
  var msg = '', onChange = null;
  var roll0 = null, pitch0 = null;
  var g = { x: 0, y: -1, z: 0 };        /* 중력 방향 (기기 기준) */
  var haveG = false;
  var cur = { roll: 0, pitch: 0 };      /* 중립에서 몇 도 기울었나 */
  var sm  = { roll: 0, pitch: 0 };
  var out = { roll: 0, pitch: 0 };
  var rangeDeg = 30;                    /* 이만큼 기울이면 최대 */
  var DEAD = 3;                         /* 이보다 작게 흔들리는 건 무시 */
  var flipR = false, flipP = false;
  var haveEvent = false, startedAt = 0;
  var handler = null, watchdog = null, calibTimer = null;
  var preview = null, pctx = null, lastDraw = 0;
  var forcedAngle = null;               /* 확인용으로만 화면 회전을 흉내 냅니다 */

  function setPhase(p, m) {
    phase = p; msg = m || '';
    if (onChange) onChange(phase, msg);
  }

  /* ------------------------------------------------------------- 켜고 끄기 */

  function start(previewCanvas, cb) {
    preview = previewCanvas || null;
    pctx = preview ? preview.getContext('2d') : null;
    onChange = cb || onChange;

    if (typeof DeviceOrientationEvent === 'undefined') {
      return fail('이 기기에는 기울기 센서가 없어요.');
    }
    if (!window.isSecureContext && location.protocol !== 'file:') {
      return fail('기울기 센서는 https 주소에서만 쓸 수 있어요.');
    }

    /* 아이폰·아이패드는 허락을 받아야 합니다 (버튼을 누른 그 순간에만 물어볼 수 있어요) */
    var MotionEvt = (typeof DeviceMotionEvent !== 'undefined') ? DeviceMotionEvent : null;
    if (MotionEvt && typeof MotionEvt.requestPermission === 'function') {
      setPhase('asking', '기울기 센서 사용을 허락해 주세요…');
      return MotionEvt.requestPermission().then(function (state) {
        if (state !== 'granted') return fail('기울기 센서 사용이 허락되지 않았어요.');
        attach(); return true;
      }).catch(function () {
        return fail('기울기 센서를 켜지 못했어요.');
      });
    }
    attach();
    return Promise.resolve(true);
  }

  function attach() {
    haveEvent = false;
    startedAt = performance.now();
    handler = onMotion;
    window.addEventListener('devicemotion', handler);
    /* devicemotion 이 없는 기기를 위한 예비 */
    window.addEventListener('deviceorientation', onOrient);
    setPhase('calib', '기기를 편한 자세로 잡아 주세요…');

    clearTimeout(calibTimer);
    calibTimer = setTimeout(function () {
      if (phase !== 'calib') return;
      if (!haveEvent) return;
      recenter();
      setPhase('on', '');
    }, 900);

    /* 센서가 아예 없는 기기(대부분의 데스크톱)를 알아채기 */
    clearTimeout(watchdog);
    watchdog = setTimeout(function () {
      if (!haveEvent && phase !== 'off') {
        stop();
        setPhase('error', '기울기 센서가 없는 기기예요. 화면 버튼으로 조종하세요.');
      }
    }, 2200);
  }

  function fail(m) { setPhase('error', m); return Promise.resolve(false); }

  function stop() {
    if (handler) window.removeEventListener('devicemotion', handler);
    window.removeEventListener('deviceorientation', onOrient);
    handler = null; haveG = false;
    clearTimeout(watchdog); clearTimeout(calibTimer);
    roll0 = pitch0 = null;
    sm.roll = 0; sm.pitch = 0; out.roll = 0; out.pitch = 0;
    setPhase('off', '');
  }

  /* ------------------------------------------------------------- 센서 읽기 */

  /* 중력 방향을 그대로 받는다 (가장 확실한 방법) */
  function onMotion(e) {
    var a = e.accelerationIncludingGravity;
    if (!a || (a.x === null && a.y === null && a.z === null)) return;
    haveEvent = true; haveG = true;
    /* 손 떨림을 눌러 주는 저역 통과 */
    var k = 0.22;
    g.x += ((a.x || 0) - g.x) * k;
    g.y += ((a.y || 0) - g.y) * k;
    g.z += ((a.z || 0) - g.z) * k;
    if (roll0 === null) return;
    compute();
    draw();
  }

  /* devicemotion 이 없는 기기에서만 쓰는 예비 — 각도에서 중력 방향을 되돌린다 */
  function onOrient(e) {
    if (haveG) return;
    if (e.beta === null && e.gamma === null) return;
    haveEvent = true;
    var b = (e.beta || 0) * Math.PI / 180, c = (e.gamma || 0) * Math.PI / 180;
    g.x = -Math.sin(c);
    g.y =  Math.sin(b) * Math.cos(c);
    g.z = -Math.cos(b) * Math.cos(c);
    if (roll0 === null) return;
    compute();
    draw();
  }

  /* 화면을 가로로 돌리면 앞뒤·좌우가 서로 바뀝니다 */
  function screenAngle() {
    if (forcedAngle !== null) return forcedAngle;
    var a = 0;
    if (window.screen && window.screen.orientation && typeof window.screen.orientation.angle === 'number') {
      a = window.screen.orientation.angle;
    } else if (typeof window.orientation === 'number') {
      a = window.orientation;
    }
    a = ((a % 360) + 360) % 360;
    return (a >= 45 && a < 135) ? 90 : (a >= 135 && a < 225) ? 180 : (a >= 225 && a < 315) ? 270 : 0;
  }

  function wrapDeg(d) {
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return d;
  }

  function compute() {
    var A = angles();
    var r = wrapDeg(A.roll  - roll0);
    var p = wrapDeg(A.pitch - pitch0);
    if (flipR) r = -r;
    if (flipP) p = -p;
    cur.roll = r; cur.pitch = p;

    sm.roll  += (curve(r) - sm.roll)  * 0.35;
    sm.pitch += (curve(p) - sm.pitch) * 0.35;
    out.roll = sm.roll;
    out.pitch = sm.pitch;
  }

  /* 중력 방향에서 두 각도를 뽑는다.
   *
   *  · 좌우(roll)   = 화면 면 안에서 중력이 가리키는 방향.
   *    핸들처럼 돌리면 이 값이 그대로 따라 돕니다.
   *  · 위아래(pitch) = 중력이 화면 밖으로 얼마나 벗어났나.
   *    위쪽을 앞뒤로 눕히면 이 값이 바뀝니다.
   *
   *  화면을 가로로 돌리면 화면의 좌우·위아래 축도 함께 돌아가므로
   *  중력을 그 각도만큼 되돌려 놓고 잽니다.
   */
  function angles() {
    var D = 180 / Math.PI;
    var a = screenAngle() * Math.PI / 180;
    var c = Math.cos(a), s2 = Math.sin(a);
    var sx =  g.x * c - g.y * s2;      /* 화면 오른쪽 방향 성분 */
    var sy =  g.x * s2 + g.y * c;      /* 화면 위쪽 방향 성분 */
    return {
      roll:  Math.atan2(sx, -sy) * D,
      pitch: Math.atan2(-g.z, Math.hypot(sx, sy)) * D
    };
  }

  /* 각도 → −1 ~ +1. 조금 흔들리는 건 무시하고, 많이 기울일수록 커집니다 */
  function curve(deg) {
    var s = deg < 0 ? -1 : 1, a = Math.abs(deg);
    if (a <= DEAD) return 0;
    var v = (a - DEAD) / (rangeDeg - DEAD);
    if (v > 1) v = 1;
    /* 가운데 근처는 더 천천히, 많이 기울일수록 크게.
       살짝 기울였을 때 비행기가 확 도는 느낌을 없애 줍니다. */
    return s * v * (0.4 + 0.6 * v);
  }

  function recenter() {
    var A = angles();
    roll0 = A.roll; pitch0 = A.pitch;
    sm.roll = 0; sm.pitch = 0; out.roll = 0; out.pitch = 0;
  }

  /* ------------------------------------------------------------- 미리보기 */

  function draw() {
    if (!pctx) return;
    var now = performance.now();
    if (now - lastDraw < 33) return;
    lastDraw = now;

    var w = preview.width, h = preview.height;
    var cx = w / 2, cy = h / 2;

    pctx.clearRect(0, 0, w, h);
    pctx.fillStyle = '#0e131a';
    pctx.fillRect(0, 0, w, h);

    /* 기울인 만큼 기울어지는 수평선 */
    pctx.save();
    pctx.beginPath(); pctx.rect(4, 4, w - 8, h - 8); pctx.clip();
    pctx.translate(cx, cy);
    pctx.rotate(-out.roll * 0.5);
    var off = out.pitch * h * 0.30;
    pctx.fillStyle = '#3d8fd6'; pctx.fillRect(-w, -h + off, w * 2, h);
    pctx.fillStyle = '#8f6034'; pctx.fillRect(-w, off, w * 2, h);
    pctx.strokeStyle = '#fff'; pctx.lineWidth = 2;
    pctx.beginPath(); pctx.moveTo(-w, off); pctx.lineTo(w, off); pctx.stroke();
    pctx.restore();

    /* 가운데 고정 표식 */
    pctx.strokeStyle = '#ffd23f'; pctx.lineWidth = 3; pctx.lineCap = 'round';
    pctx.beginPath();
    pctx.moveTo(cx - 22, cy); pctx.lineTo(cx - 7, cy);
    pctx.moveTo(cx + 7, cy);  pctx.lineTo(cx + 22, cy);
    pctx.moveTo(cx, cy - 6);  pctx.lineTo(cx, cy + 2);
    pctx.stroke();

    /* 지금 몇 도 기울었는지 */
    pctx.fillStyle = 'rgba(0,0,0,0.6)';
    pctx.fillRect(0, h - 16, w, 16);
    pctx.fillStyle = phase === 'on' ? '#7fe0a8' : '#ffd23f';
    pctx.font = '700 11px "Apple SD Gothic Neo", sans-serif';
    pctx.textAlign = 'center';
    pctx.fillText(phase === 'on'
      ? ('좌우 ' + Math.round(cur.roll) + '°   위아래 ' + Math.round(cur.pitch) + '°')
      : (msg || '준비 중…'), w / 2, h - 4);
  }

  /* ------------------------------------------------------------------ API */

  return {
    start: start,
    stop: stop,
    recenter: recenter,
    isActive: function () { return phase === 'on'; },
    isRunning: function () { return phase !== 'off' && phase !== 'error'; },
    phase: function () { return phase; },
    message: function () { return msg; },
    /* 슬라이더 0(둔감) ~ 100(민감) → 최대 기울기 45° ~ 15° */
    setSensitivity: function (v) { rangeDeg = 45 - (v / 100) * 30; },
    flipRoll:  function (v) { flipR = v === undefined ? !flipR : !!v; return flipR; },
    flipPitch: function (v) { flipP = v === undefined ? !flipP : !!v; return flipP; },
    isFlipR: function () { return flipR; },
    isFlipP: function () { return flipP; },
    degrees: function () { return { roll: cur.roll, pitch: cur.pitch }; },
    out: out,

    /* 확인용 — 실제 기기 없이 센서 값을 넣어 볼 수 있습니다 */
    /* 확인용 — 중력 방향을 직접 넣습니다 (기기 기준 x, y, z) */
    __feed: function (gx, gy, gz) {
      var n = Math.hypot(gx, gy, gz) || 1;
      g.x = gx / n; g.y = gy / n; g.z = gz / n;
      if (roll0 === null) { recenter(); return out; }
      compute();
      return out;
    },
    __setAngle: function (a) { forcedAngle = a; },
    __on: function () { setPhase('on', ''); },
    __reset: function () { roll0 = null; pitch0 = null; sm.roll = 0; sm.pitch = 0; haveG = true; },
    __recenter: recenter
  };
})();
