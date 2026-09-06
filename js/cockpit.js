/* =========================================================================
 *  cockpit.js — 조종석 (창틀 + 계기판 + 조종간)
 *
 *  3D 화면 위에 Canvas 2D 로 덧그립니다.
 *  계기는 4개: 속도계 · 고도계 · 수평의 · 나침반
 * ========================================================================= */
'use strict';

var Cockpit = (function () {

  var TAU = Math.PI * 2;

  /* 계기판 높이 (화면 크기에 맞춰 자동으로) */
  function panelHeight(W, H) {
    return Math.round(Math.max(170, Math.min(H * 0.36, 360)));
  }

  /* ---------------------------------------------------------------- 창틀 */
  function windowFrame(ctx, W, H, panelY) {
    var m  = Math.max(14, W * 0.030);        // 좌우 기둥 두께
    var mt = Math.max(12, H * 0.045);        // 위쪽 두께
    var rad = Math.min(70, W * 0.09);

    ctx.save();
    /* 유리 구멍을 뚫은 조종석 껍데기 */
    ctx.beginPath();
    ctx.rect(0, 0, W, panelY + 2);
    roundRectPath(ctx, m, mt, W - m * 2, panelY - mt + 6, rad);
    ctx.fillStyle = '#2a2f36';
    ctx.fill('evenodd');

    /* 창틀 안쪽 밝은 테두리 */
    ctx.beginPath();
    roundRectPath(ctx, m, mt, W - m * 2, panelY - mt + 6, rad);
    ctx.strokeStyle = 'rgba(255,255,255,0.13)';
    ctx.lineWidth = 3;
    ctx.stroke();

    /* 위쪽 햇빛 가리개 */
    var g = ctx.createLinearGradient(0, 0, 0, mt + 26);
    g.addColorStop(0, '#1b1f25');
    g.addColorStop(1, '#343b44');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, mt);

    /* 유리에 비친 빛 */
    ctx.save();
    ctx.beginPath();
    roundRectPath(ctx, m, mt, W - m * 2, panelY - mt + 6, rad);
    ctx.clip();
    var gl = ctx.createLinearGradient(m, mt, W * 0.62, panelY);
    gl.addColorStop(0,    'rgba(255,255,255,0.16)');
    gl.addColorStop(0.35, 'rgba(255,255,255,0.03)');
    gl.addColorStop(0.75, 'rgba(255,255,255,0.00)');
    ctx.fillStyle = gl;
    ctx.fillRect(0, 0, W, panelY);
    ctx.restore();
    ctx.restore();
  }

  /* -------------------------------------------------------------- 계기판 */
  function draw(ctx, W, H, s) {
    var panelH = panelHeight(W, H);
    var panelY = H - panelH;

    windowFrame(ctx, W, H, panelY);

    /* 계기판 몸통 */
    var g = ctx.createLinearGradient(0, panelY - 18, 0, H);
    g.addColorStop(0,    '#454d57');
    g.addColorStop(0.10, '#2c323a');
    g.addColorStop(0.55, '#232830');
    g.addColorStop(1,    '#171b21');
    ctx.beginPath();
    roundRectPath(ctx, -30, panelY - 20, W + 60, panelH + 60, Math.min(46, W * 0.05));
    ctx.fillStyle = g;
    ctx.fill();

    /* 대시보드 윗선(글레어실드) */
    ctx.beginPath();
    roundRectPath(ctx, -30, panelY - 20, W + 60, 26, 20);
    ctx.fillStyle = '#11151a';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, panelY + 6); ctx.lineTo(W, panelY + 6);
    ctx.stroke();

    /* --- 배치 : 위쪽 70% 는 계기, 아래쪽은 조종간 자리 --- */
    var R   = Math.min((panelH - 30) * 0.33, W * 0.072, 80);
    var cy  = panelY + 16 + R + 8;
    var gap = R * 2.62;
    var cx0 = W * 0.5 - gap * 1.5;

    gaugeSpeed   (ctx, cx0,           cy, R, s.speedKmh);
    gaugeAttitude(ctx, cx0 + gap,     cy, R, s.pitch, s.roll);
    gaugeAlt     (ctx, cx0 + gap * 2, cy, R, s.altM);
    gaugeCompass (ctx, cx0 + gap * 3, cy, R, s.yaw, s.bearing, s.destFlag);

    /* 왼쪽: 경고등 */
    lamps(ctx, Math.max(10, cx0 - R - 92), cy - R - 16, s);

    /* 오른쪽: 출력 레버 */
    throttleLever(ctx, Math.min(W - 62, cx0 + gap * 3 + R + 56), cy - R, R * 2, s.throttle);

    /* 아래: 조종간 */
    if (panelH > 200) yoke(ctx, W * 0.5, H + panelH * 0.11, panelH * 0.55, s.roll, s.pitch);

    /* 지금 어느 도시 위를 날고 있는지 — 계기판 바로 위에 띄운다 */
    if (s.overCity) {
      ctx.save();
      var fs = Math.round(Math.min(20, W * 0.017));
      ctx.font = '800 ' + fs + 'px "Apple SD Gothic Neo", sans-serif';
      var txt = '★ ' + s.overCity + ' 상공 ★';
      var tw = ctx.measureText(txt).width + 30;
      ctx.beginPath();
      roundRectPath(ctx, W * 0.5 - tw / 2, panelY - fs * 2.4, tw, fs * 1.9, fs);
      ctx.fillStyle = 'rgba(10,16,22,0.78)'; ctx.fill();
      ctx.strokeStyle = '#7fe0a8'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#7fe0a8';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(txt, W * 0.5, panelY - fs * 1.45);
      ctx.restore();
    }
  }

  /* -------------------------------------------------- 계기 공통 껍데기 */
  function bezel(ctx, x, y, r) {
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y + 4, r + 7, 0, TAU);
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fill();

    var g = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
    g.addColorStop(0,    '#9aa3ad');
    g.addColorStop(0.42, '#5b636d');
    g.addColorStop(1,    '#2b3138');
    ctx.beginPath(); ctx.arc(x, y, r + 7, 0, TAU);
    ctx.fillStyle = g; ctx.fill();

    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = '#0e131a'; ctx.fill();
    ctx.restore();
  }

  function glass(ctx, x, y, r) {
    var g = ctx.createLinearGradient(x - r, y - r, x + r * 0.3, y + r * 0.7);
    g.addColorStop(0,   'rgba(255,255,255,0.20)');
    g.addColorStop(0.45,'rgba(255,255,255,0.03)');
    g.addColorStop(1,   'rgba(255,255,255,0.00)');
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = g; ctx.fill();
  }

  function label(ctx, x, y, r, text) {
    ctx.save();
    ctx.font = '700 ' + Math.round(r * 0.19) + 'px "Apple SD Gothic Neo", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(text, x, y + r * 0.76);
    ctx.restore();
  }

  function needle(ctx, x, y, r, ang, color, wide) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.84);
    ctx.lineTo(wide, r * 0.12);
    ctx.lineTo(-wide, r * 0.12);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 4;
    ctx.fill();
    ctx.restore();
    ctx.beginPath(); ctx.arc(x, y, r * 0.09, 0, TAU);
    ctx.fillStyle = '#d8dde3'; ctx.fill();
  }

  /* 눈금이 있는 원형 계기 (270도 범위)
     숫자는 가운데 큰 창에만 띄우고, 눈금은 알록달록한 띠로 보여 줍니다. */
  function dial(ctx, x, y, r, value, max, name, arcColor) {
    bezel(ctx, x, y, r);
    var A0 = -Math.PI * 0.75, SPAN = Math.PI * 1.5;
    var t = Math.max(0, Math.min(1, value / max));
    var i;

    /* 값 띠 */
    ctx.save();
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.855, A0 - Math.PI / 2, A0 + SPAN - Math.PI / 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = r * 0.13; ctx.stroke();
    if (t > 0.004) {
      ctx.beginPath();
      ctx.arc(x, y, r * 0.855, A0 - Math.PI / 2, A0 + SPAN * t - Math.PI / 2);
      ctx.strokeStyle = arcColor; ctx.lineWidth = r * 0.13; ctx.stroke();
    }
    ctx.restore();

    /* 눈금 */
    ctx.save();
    for (i = 0; i <= 24; i++) {
      var a = A0 + SPAN * (i / 24);
      var big = (i % 4 === 0);
      var r1 = r * (big ? 0.58 : 0.66);
      ctx.beginPath();
      ctx.moveTo(x + Math.sin(a) * r1,       y - Math.cos(a) * r1);
      ctx.lineTo(x + Math.sin(a) * r * 0.74, y - Math.cos(a) * r * 0.74);
      ctx.strokeStyle = big ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.30)';
      ctx.lineWidth = big ? 2.4 : 1.2;
      ctx.stroke();
    }
    ctx.restore();

    needle(ctx, x, y, r, A0 + SPAN * t, '#e9edf2', r * 0.05);

    /* 숫자 표시창 */
    var bw = r * 1.04, bh = r * 0.32;
    ctx.beginPath();
    roundRectPath(ctx, x - bw / 2, y + r * 0.22, bw, bh, 5);
    ctx.fillStyle = 'rgba(0,0,0,0.70)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.save();
    ctx.font = '700 ' + Math.round(r * 0.26) + 'px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#8ef0b6';
    ctx.fillText(String(Math.round(value)), x, y + r * 0.39);
    ctx.restore();

    label(ctx, x, y, r, name);
    glass(ctx, x, y, r);
  }

  function gaugeSpeed(ctx, x, y, r, kmh) {
    dial(ctx, x, y, r, kmh, 1200, '속도 km/h', '#ff8a5c');
  }
  function gaugeAlt(ctx, x, y, r, m) {
    dial(ctx, x, y, r, m, 6000, '고도 m', '#7ec8ff');
  }

  /* 인공 수평의 */
  function gaugeAttitude(ctx, x, y, r, pitch, roll) {
    bezel(ctx, x, y, r);
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r * 0.93, 0, TAU); ctx.clip();
    ctx.translate(x, y);
    ctx.rotate(-roll);
    var off = pitch * r * 1.7;
    ctx.fillStyle = '#3d8fd6'; ctx.fillRect(-r * 2, -r * 2 + off, r * 4, r * 2);
    ctx.fillStyle = '#8f6034'; ctx.fillRect(-r * 2, off, r * 4, r * 2);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-r * 2, off); ctx.lineTo(r * 2, off); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1.6;
    for (var k = -3; k <= 3; k++) {
      if (!k) continue;
      var yy = off - k * r * 0.30;
      var ww = (k % 2 === 0) ? r * 0.36 : r * 0.20;
      ctx.beginPath(); ctx.moveTo(-ww, yy); ctx.lineTo(ww, yy); ctx.stroke();
    }
    ctx.restore();

    /* 고정된 비행기 표시 */
    ctx.save();
    ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - r * 0.55, y); ctx.lineTo(x - r * 0.16, y);
    ctx.moveTo(x + r * 0.16, y); ctx.lineTo(x + r * 0.55, y);
    ctx.moveTo(x, y - r * 0.14); ctx.lineTo(x, y + r * 0.02);
    ctx.stroke();
    ctx.restore();

    /* 기울기 눈금 */
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.6;
    [-60, -30, -15, 0, 15, 30, 60].forEach(function (deg) {
      var a = deg * Math.PI / 180;
      ctx.beginPath();
      ctx.moveTo(x + Math.sin(a) * r * 0.93, y - Math.cos(a) * r * 0.93);
      ctx.lineTo(x + Math.sin(a) * r * 0.80, y - Math.cos(a) * r * 0.80);
      ctx.stroke();
    });
    ctx.restore();
    label(ctx, x, y, r, '수평의');
    glass(ctx, x, y, r);
  }

  /* 나침반 + 목적지 화살표 */
  function gaugeCompass(ctx, x, y, r, yaw, bearing, flag) {
    bezel(ctx, x, y, r);
    var dirs = ['북', '동', '남', '서'];
    ctx.save();
    ctx.translate(x, y); ctx.rotate(-yaw);
    for (var i = 0; i < 24; i++) {
      var a = i / 24 * TAU;
      var big = (i % 6 === 0);
      ctx.beginPath();
      ctx.moveTo(Math.sin(a) * r * (big ? 0.72 : 0.82), -Math.cos(a) * r * (big ? 0.72 : 0.82));
      ctx.lineTo(Math.sin(a) * r * 0.92, -Math.cos(a) * r * 0.92);
      ctx.strokeStyle = big ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.32)';
      ctx.lineWidth = big ? 2.2 : 1;
      ctx.stroke();
    }
    for (i = 0; i < 4; i++) {
      var aa = i / 4 * TAU;
      var px = Math.sin(aa) * r * 0.56, py = -Math.cos(aa) * r * 0.56;
      ctx.save();
      ctx.translate(px, py); ctx.rotate(yaw);     /* 글자는 항상 똑바로 */
      ctx.font = '700 ' + Math.round(r * 0.26) + 'px "Apple SD Gothic Neo", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = i === 0 ? '#ff6b5c' : 'rgba(255,255,255,0.85)';
      ctx.fillText(dirs[i], 0, 0);
      ctx.restore();
    }
    ctx.restore();

    /* 목적지 방향 화살표 (분홍) */
    if (bearing !== null && bearing !== undefined) {
      var rel = bearing - yaw;
      ctx.save();
      ctx.translate(x, y); ctx.rotate(rel);
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.66);
      ctx.lineTo(r * 0.15, -r * 0.40);
      ctx.lineTo(r * 0.055, -r * 0.40);
      ctx.lineTo(r * 0.055, r * 0.42);
      ctx.lineTo(-r * 0.055, r * 0.42);
      ctx.lineTo(-r * 0.055, -r * 0.40);
      ctx.lineTo(-r * 0.15, -r * 0.40);
      ctx.closePath();
      ctx.fillStyle = '#ff5fd0';
      ctx.fill();
      ctx.restore();
    }
    /* 위쪽 고정 표식 */
    ctx.beginPath();
    ctx.moveTo(x, y - r * 0.98); ctx.lineTo(x - r * 0.09, y - r * 0.80);
    ctx.lineTo(x + r * 0.09, y - r * 0.80); ctx.closePath();
    ctx.fillStyle = '#ffd23f'; ctx.fill();

    label(ctx, x, y, r, '나침반');
    glass(ctx, x, y, r);
  }

  /* 경고등 */
  function lamps(ctx, x, y, s) {
    var w = 84, h = 26, gap = 8;
    var items = [
      ['자동조종', s.autopilot, '#4ade80'],
      ['몸조종',   s.camera,    '#c084fc'],
      ['저고도',   s.lowAlt,    '#fbbf24'],
      ['소리',     s.sound,     '#60a5fa']
    ];
    ctx.save();
    ctx.font = '700 12px "Apple SD Gothic Neo", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (var i = 0; i < items.length; i++) {
      var yy = y + i * (h + gap);
      ctx.beginPath(); roundRectPath(ctx, x, yy, w, h, 6);
      ctx.fillStyle = items[i][1] ? items[i][2] : 'rgba(255,255,255,0.07)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = items[i][1] ? 'rgba(0,0,0,0.78)' : 'rgba(255,255,255,0.38)';
      ctx.fillText(items[i][0], x + w / 2, yy + h / 2 + 1);
    }
    ctx.restore();
  }

  /* 출력(스로틀) 레버 */
  function throttleLever(ctx, x, y, h, v) {
    var w = 26;
    ctx.save();
    ctx.beginPath(); roundRectPath(ctx, x - w / 2, y, w, h, 12);
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1.5; ctx.stroke();

    var fh = (h - 10) * v;
    ctx.beginPath(); roundRectPath(ctx, x - w / 2 + 4, y + h - 5 - fh, w - 8, fh, 8);
    var g = ctx.createLinearGradient(0, y + h, 0, y);
    g.addColorStop(0, '#3ddc84'); g.addColorStop(1, '#ffb020');
    ctx.fillStyle = g; ctx.fill();

    var ky = y + h - 5 - fh;
    ctx.beginPath(); roundRectPath(ctx, x - w / 2 - 8, ky - 9, w + 16, 18, 7);
    ctx.fillStyle = '#e8ecf1'; ctx.fill();
    ctx.strokeStyle = '#7b828a'; ctx.lineWidth = 1.5; ctx.stroke();

    ctx.font = '700 12px "Apple SD Gothic Neo", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('출력', x, y - 8);
    ctx.fillStyle = '#8ef0b6';
    ctx.fillText(Math.round(v * 100) + '%', x, y + h + 16);
    ctx.restore();
  }

  /* 조종간 */
  function yoke(ctx, cx, cy, r, roll, pitch) {
    ctx.save();
    ctx.translate(cx, cy + pitch * r * 0.16);
    ctx.rotate(roll * 0.85);
    ctx.lineCap = 'round';

    ctx.strokeStyle = '#1b1f25'; ctx.lineWidth = r * 0.20;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.72, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
    ctx.strokeStyle = '#39414b'; ctx.lineWidth = r * 0.13;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.72, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();

    /* 손잡이 */
    [-1, 1].forEach(function (sgn) {
      var a = sgn > 0 ? Math.PI * 1.92 : Math.PI * 1.08;
      var hx = Math.cos(a) * r * 0.72, hy = Math.sin(a) * r * 0.72;
      ctx.save();
      ctx.translate(hx, hy);
      ctx.beginPath(); roundRectPath(ctx, -r * 0.11, -r * 0.20, r * 0.22, r * 0.42, r * 0.10);
      ctx.fillStyle = '#20252c'; ctx.fill();
      ctx.strokeStyle = '#4b5561'; ctx.lineWidth = 2; ctx.stroke();
      ctx.restore();
    });

    ctx.strokeStyle = '#2b323a'; ctx.lineWidth = r * 0.16;
    ctx.beginPath(); ctx.moveTo(0, -r * 0.10); ctx.lineTo(0, r * 0.55); ctx.stroke();
    ctx.restore();
  }

  /* 둥근 사각형 경로 */
  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y,     x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x,     y + h, r);
    ctx.arcTo(x,     y + h, x,     y,     r);
    ctx.arcTo(x,     y,     x + w, y,     r);
    ctx.closePath();
  }

  return { draw: draw, panelHeight: panelHeight };
})();
