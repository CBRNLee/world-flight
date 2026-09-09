/* =========================================================================
 *  vision.js — 카메라로 몸을 인식해서 비행기를 조종합니다.
 *
 *  외부 라이브러리 없이 직접 만든 실루엣 추적기입니다.
 *   1) 사람이 없을 때의 배경을 몇 초 동안 기억해 둡니다.
 *   2) 매 프레임 배경과 다른 부분(= 사람)을 찾아 실루엣을 만듭니다.
 *   3) 실루엣의 왼쪽 끝 · 오른쪽 끝(= 두 손)과 머리 꼭대기를 찾아
 *      팔의 기울기 · 팔의 높이 · 키 높이를 재서 조종 신호로 바꿉니다.
 *
 *  교실에서 잘 되도록 넣은 장치들
 *   · 자동 밝기 보정 — 웹캠이 스스로 밝기를 바꿔도 배경이 통째로 사람으로
 *     잡히지 않도록, 매 프레임 전체 밝기 비율을 재서 배경에 곱해 맞춥니다.
 *   · 그림자 걸러내기 — 어두워지기만 하고 색은 그대로면 그림자로 봅니다.
 *   · 자동 기준값 — 화면 잡음 수준(중앙값)을 재서 경계값을 스스로 정합니다.
 *   · 느린 배경 따라가기 — 사람이 없는 자리는 조금씩 갱신해 조명 변화를 따라갑니다.
 *
 *  조종 방법
 *    · 팔을 기울이면        → 그쪽으로 돌기 (좌우)
 *    · 팔을 나란히          → 수평 비행
 *    · 팔을 위로 / 아래로   → 고도 올리기 / 내리기
 *    · 키를 크게 / 앉기     → 속도 빠르게 / 느리게
 * ========================================================================= */
'use strict';

var Vision = (function () {

  var W = 160, H = 120;                 /* 처리용 작은 해상도 */
  var NPX = W * H;

  var video = null, cap = null, cctx = null, stream = null;
  var mcv = null, mctx = null, mimg = null;          /* 실루엣 겹쳐 그리기용 */
  var preview = null, pctx = null;

  var bgSum = new Float32Array(NPX * 3), bgN = 0;
  var bg    = null;
  var mask  = new Uint8Array(NPX), tmp = new Uint8Array(NPX);
  var diff  = new Uint16Array(NPX);
  var hist  = new Int32Array(96);
  var colCount = new Int32Array(W), colSum = new Int32Array(W), colTop = new Int32Array(W);

  var phase = 'off';      /* off | starting | bg | pose | on | lost | error */
  var phaseT = 0;
  var neutral = null;
  var poseAcc = null;
  var sensMul = 1.10;     /* 슬라이더: 경계값 배수 (작을수록 민감) */
  var autoTh  = 40;       /* 스스로 정한 경계값 */
  var fgRatio = 0;        /* 화면에서 사람으로 잡힌 비율 */
  var flipRoll = false;   /* 좌우가 반대로 느껴질 때 뒤집기 */
  var lastRun = 0;
  var feat = null, featAt = 0;
  var sm = { roll: 0, pitch: 0, thr: 0.5 };
  var msg = '';
  var onPhase = null;

  var out = { roll: 0, pitch: 0, throttle: null };

  /* ------------------------------------------------------------- 켜고 끄기 */

  function start(previewCanvas, phaseCallback) {
    preview = previewCanvas || null;
    pctx = preview ? preview.getContext('2d') : null;
    onPhase = phaseCallback || null;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return fail('이 브라우저에서는 카메라를 쓸 수 없어요.');
    }
    if (!window.isSecureContext && location.protocol !== 'file:') {
      return fail('카메라는 http://localhost 또는 https 에서만 켤 수 있어요.');
    }

    setPhase('starting', '카메라를 켜는 중…');

    return navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: false
    }).then(function (s) {
      stream = s;
      video = document.createElement('video');
      video.srcObject = s;
      video.playsInline = true;
      video.muted = true;
      return video.play();
    }).then(function () {
      cap = document.createElement('canvas'); cap.width = W; cap.height = H;
      cctx = cap.getContext('2d', { willReadFrequently: true });
      mcv = document.createElement('canvas'); mcv.width = W; mcv.height = H;
      mctx = mcv.getContext('2d');
      mimg = mctx.createImageData(W, H);
      captureBackground();
      return true;
    }).catch(function (e) {
      var name = (e && e.name) ? e.name : '알 수 없음';
      if (name === 'NotAllowedError') {
        return fail(cameraBlockedByPage()
          ? '이 페이지에서는 카메라를 쓸 수 없어요. 파일을 내려받아 실행하면 됩니다.'
          : '카메라 사용을 허락해 주세요. (주소창 옆 카메라 아이콘 → 허용)');
      }
      if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        return fail('연결된 카메라를 찾지 못했어요.');
      }
      return fail('카메라를 열지 못했어요. (' + name + ')');
    });
  }

  /* 페이지(iframe) 자체가 카메라를 막고 있는지 — 사용자가 거절한 것과 구분한다 */
  function cameraBlockedByPage() {
    try {
      var fp = document.featurePolicy || document.permissionsPolicy;
      if (fp && fp.allowsFeature) return !fp.allowsFeature('camera');
    } catch (err) { /* 확인할 수 없으면 모르는 것으로 둔다 */ }
    return false;
  }

  function fail(m) { setPhase('error', m); return Promise.resolve(false); }

  function stop() {
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null; video = null; bg = null; neutral = null; feat = null;
    setPhase('off', '');
    out.roll = 0; out.pitch = 0; out.throttle = null;
  }

  function setPhase(p, m) {
    phase = p; msg = m || ''; phaseT = performance.now();
    if (onPhase) onPhase(p, msg);
  }

  /* 배경 다시 기억하기 */
  function captureBackground() {
    bgSum.fill(0); bgN = 0; bg = null;
    setPhase('bg', '카메라 앞에서 잠깐만 비켜 주세요');
  }

  /* 기준 자세(팔 벌리고 서기) 다시 잡기 */
  function capturePose() {
    if (!bg) { captureBackground(); return; }
    poseAcc = { hand: 0, head: 0, span: 0, n: 0 };
    setPhase('pose', '팔을 옆으로 쭉 펴고 서 주세요');
  }

  /* -------------------------------------------------------------- 매 프레임 */

  function update(now) {
    if (!video || video.readyState < 2) return;
    if (now - lastRun < 45) return;              /* 초당 약 22번만 처리 */
    lastRun = now;

    cctx.save();
    cctx.scale(-1, 1);
    cctx.drawImage(video, -W, 0, W, H);          /* 거울처럼 좌우 반전 */
    cctx.restore();
    var px = cctx.getImageData(0, 0, W, H).data;

    if (phase === 'bg') {
      accumulateBackground(px);
      if (now - phaseT > 2400) {
        finishBackground();
        capturePose();
      }
      drawPreview(false);
      return;
    }
    if (!bg) return;

    buildMask(px);
    var f = extract();
    if (f) { feat = f; featAt = now; }
    else if (now - featAt > 500) { feat = null; }   /* 잠깐 놓친 것은 버티기 */

    if (phase === 'pose') {
      if (f) {
        poseAcc.hand += f.hand; poseAcc.head += f.head;
        poseAcc.span += f.span; poseAcc.n++;
      }
      if (now - phaseT > 2600) {
        if (poseAcc.n > 12) {
          neutral = { hand: poseAcc.hand / poseAcc.n,
                      head: poseAcc.head / poseAcc.n,
                      span: poseAcc.span / poseAcc.n };
          sm.roll = 0; sm.pitch = 0; sm.thr = 0.5;
          setPhase('on', '준비 완료! 몸으로 조종해 보세요');
        } else {
          setPhase('pose', '사람이 잘 안 보여요. 팔을 벌리고 서 주세요');
        }
      }
      drawPreview(true);
      return;
    }

    if (phase === 'on' || phase === 'lost') {
      if (feat && neutral) {
        if (phase === 'lost') setPhase('on', '');
        control(feat);
      } else {
        if (phase === 'on') setPhase('lost', '사람이 안 보여요');
        decay();
      }
      drawPreview(true);
    }
  }

  /* ------------------------------------------------------------- 배경 기억 */

  function accumulateBackground(px) {
    for (var i = 0, p = 0; i < NPX; i++, p += 4) {
      bgSum[i * 3]     += px[p];
      bgSum[i * 3 + 1] += px[p + 1];
      bgSum[i * 3 + 2] += px[p + 2];
    }
    bgN++;
  }

  function finishBackground() {
    bg = new Float32Array(NPX * 3);
    var k = bgN > 0 ? 1 / bgN : 1;
    for (var i = 0; i < NPX * 3; i++) bg[i] = bgSum[i] * k;
  }

  /* ------------------------------------------------------------- 실루엣 */

  function buildMask(px) {
    var i, p, d, dr, dg, db;

    /* ① 웹캠이 스스로 밝기를 바꿔도 괜찮도록, 전체 밝기 비율을 구해 배경에 곱한다 */
    var sumC = 0, sumB = 0;
    for (i = 0; i < NPX; i += 7) {
      p = i * 4;
      sumC += px[p] + px[p + 1] + px[p + 2];
      sumB += bg[i * 3] + bg[i * 3 + 1] + bg[i * 3 + 2];
    }
    var gain = sumB > 1 ? sumC / sumB : 1;
    if (gain < 0.55) gain = 0.55; else if (gain > 1.8) gain = 1.8;

    /* ② 배경과의 차이를 재고, 잡음 수준을 알기 위해 분포를 센다 */
    hist.fill(0);
    for (i = 0, p = 0; i < NPX; i++, p += 4) {
      dr = px[p]     - bg[i * 3]     * gain;
      dg = px[p + 1] - bg[i * 3 + 1] * gain;
      db = px[p + 2] - bg[i * 3 + 2] * gain;
      d = (dr < 0 ? -dr : dr) + (dg < 0 ? -dg : dg) + (db < 0 ? -db : db);
      diff[i] = d;
      var b = d >> 3; if (b > 95) b = 95;
      hist[b]++;
    }

    /* ③ 경계값은 스스로 정한다 — 화면 잡음의 중앙값을 기준으로 */
    var half = NPX >> 1, acc = 0, med = 0;
    for (i = 0; i < 96; i++) { acc += hist[i]; if (acc >= half) { med = i << 3; break; } }
    var th = (med * 2.2 + 26) * sensMul;
    if (th < 20) th = 20; else if (th > 190) th = 190;
    autoTh = th;

    /* ④ 사람 = 차이가 큰 곳. 단, 그림자는 뺀다 */
    for (i = 0, p = 0; i < NPX; i++, p += 4) {
      var on = diff[i] > th ? 1 : 0;
      if (on) {
        var lb = (bg[i * 3] + bg[i * 3 + 1] + bg[i * 3 + 2]) * gain;
        var lc = px[p] + px[p + 1] + px[p + 2];
        if (lb > 40 && lc < lb) {
          var ratio = lc / lb;
          if (ratio > 0.45 && ratio < 0.93) {
            /* 어두워지기만 하고 색조가 그대로면 그림자 */
            var cd = Math.abs(px[p] / (lc || 1) - bg[i * 3] * gain / lb)
                   + Math.abs(px[p + 1] / (lc || 1) - bg[i * 3 + 1] * gain / lb);
            if (cd < 0.055) on = 0;
          }
        }
      }
      tmp[i] = on;
    }

    neighbours(tmp, mask, 5);      /* 잡티 지우기 (팔이 얇아도 남도록 5) */
    neighbours(mask, tmp, 2);      /* 구멍 메우기 */
    mask.set(tmp);

    /* ⑤ 사람이 없는 자리는 배경을 천천히 갱신 — 조명이 변해도 따라간다 */
    var a = 0.02, ia = 1 - a;
    for (i = 0, p = 0; i < NPX; i++, p += 4) {
      if (!mask[i]) {
        bg[i * 3]     = bg[i * 3]     * ia + px[p]     * a;
        bg[i * 3 + 1] = bg[i * 3 + 1] * ia + px[p + 1] * a;
        bg[i * 3 + 2] = bg[i * 3 + 2] * ia + px[p + 2] * a;
      }
    }

    var on2 = 0;
    for (i = 0; i < NPX; i++) on2 += mask[i];
    fgRatio = on2 / NPX;
  }

  /* 3x3 이웃 중 k개 이상이 켜져 있으면 켠다 */
  function neighbours(src, dst, k) {
    var x, y, i, n, yy, xx;
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        i = y * W + x;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) { dst[i] = 0; continue; }
        n = 0;
        for (yy = -1; yy <= 1; yy++)
          for (xx = -1; xx <= 1; xx++)
            n += src[i + yy * W + xx];
        dst[i] = n >= k ? 1 : 0;
      }
    }
  }

  /* --------------------------------------------------- 실루엣에서 특징 뽑기 */

  function extract() {
    var x, y;
    colCount.fill(0); colSum.fill(0); colTop.fill(-1);
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        if (mask[y * W + x]) {
          colCount[x]++; colSum[x] += y;
          if (colTop[x] < 0) colTop[x] = y;
        }
      }
    }

    /* 사람일 가능성이 가장 큰 덩어리 = 이어진 구간 중 넓이가 가장 큰 것.
       (가로로 길기만 한 잡음 띠에 속지 않도록 폭이 아니라 넓이로 고릅니다) */
    var s = -1, bs = -1, be = -1, area = 0, best = 0;
    for (x = 0; x <= W; x++) {
      var on = x < W && colCount[x] >= 3;
      if (on) { if (s < 0) { s = x; area = 0; } area += colCount[x]; }
      if (!on && s >= 0) {
        if (area > best) { best = area; bs = s; be = x; }
        s = -1;
      }
    }
    if (bs < 0) return null;
    var span = be - bs;
    if (span < 16 || best < 160) return null;

    /* 양쪽 끝 = 두 손 */
    var wing = Math.max(2, Math.round(span * 0.09));
    var ly = meanY(bs, bs + wing), ry = meanY(be - wing, be);
    if (ly === null || ry === null) return null;

    /* 가운데 기둥들의 꼭대기 = 머리 (팔을 옆으로 벌려도 흔들리지 않음) */
    var mid = (bs + be) / 2, half = Math.max(2, Math.round(span * 0.13));
    var tops = [];
    for (x = Math.round(mid - half); x <= Math.round(mid + half); x++) {
      if (x >= 0 && x < W && colTop[x] >= 0) tops.push(colTop[x]);
    }
    if (tops.length < 3) return null;
    tops.sort(function (a, b) { return a - b; });
    var head = tops[tops.length >> 1];          /* 중앙값 */

    return { bs: bs, be: be, span: span, ly: ly, ry: ry,
             hand: (ly + ry) * 0.5, head: head, area: best };
  }

  function meanY(x0, x1) {
    var sum = 0, n = 0, x;
    for (x = Math.max(0, x0); x < Math.min(W, x1); x++) {
      if (colCount[x] > 0) { sum += colSum[x] / colCount[x]; n++; }
    }
    return n ? sum / n : null;
  }

  /* ------------------------------------------------------- 특징 → 조종 신호 */

  function control(f) {
    var scale = Math.max(24, neutral.span);

    /* 좌우 · 수평 : 두 손을 잇는 선의 기울기
       (거울처럼 보이므로 화면 오른쪽 = 아이의 오른손입니다.
        오른손을 내리면 오른쪽으로 돌아요) */
    var tilt = (f.ly - f.ry) / scale;
    var roll = clamp(-tilt * 3.4, -1, 1);
    if (flipRoll) roll = -roll;

    /* 고도 : 손 높이 − 머리 높이 (앉거나 서도 영향 없음) */
    var now  = (f.hand - f.head) / scale;
    var base = (neutral.hand - neutral.head) / Math.max(24, neutral.span);
    var pitch = clamp((base - now) * 3.6, -1, 1);

    /* 속도 : 머리가 화면에서 얼마나 높은가 (가까이 오거나 키를 키우면 빠르게) */
    var thr = clamp(0.5 + (neutral.head - f.head) / (H * 0.34), 0, 1);

    sm.roll  += (dead(roll,  0.12) - sm.roll)  * 0.30;
    sm.pitch += (dead(pitch, 0.12) - sm.pitch) * 0.26;
    sm.thr   += (thr - sm.thr) * 0.10;

    out.roll = sm.roll;
    out.pitch = sm.pitch;
    out.throttle = sm.thr;
  }

  function decay() {
    sm.roll *= 0.90; sm.pitch *= 0.90;
    out.roll = sm.roll; out.pitch = sm.pitch;
    out.throttle = sm.thr;
  }

  function dead(v, d) {
    if (v > d)  return (v - d) / (1 - d);
    if (v < -d) return (v + d) / (1 - d);
    return 0;
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* 지금 인식이 잘 되고 있는지 한마디로 */
  function quality() {
    if (phase === 'bg')   return { level: 'wait', text: '배경을 기억하는 중…' };
    if (phase === 'pose') return { level: 'wait', text: '팔을 옆으로 쭉!' };
    if (fgRatio < 0.012)  return { level: 'low',  text: '사람이 잘 안 보여요 → 민감도 ▲' };
    if (fgRatio > 0.45)   return { level: 'high', text: '배경까지 잡혀요 → 🖼 배경 다시' };
    if (!feat)            return { level: 'low',  text: '몸 전체가 보이게 서 주세요' };
    return { level: 'ok', text: '잘 보여요' };
  }

  /* ----------------------------------------------------------- 미리보기
   * 실제 카메라 영상을 그대로 보여 주고, 그 위에 인식 결과를 살짝 덧그립니다.
   * (예전처럼 초록 실루엣만 보이면 무섭고, 어디가 잘못됐는지도 알 수 없어서)
   * ------------------------------------------------------------------- */

  function drawPreview(showMask) {
    if (!pctx) return;
    var cw = preview.width, ch = preview.height;

    /* ① 진짜 카메라 화면 */
    pctx.drawImage(cap, 0, 0, cw, ch);

    /* ② 사람으로 잡힌 부분만 살짝 초록으로 덧칠 */
    if (showMask) {
      var d = mimg.data, i, p;
      for (i = 0, p = 0; i < NPX; i++, p += 4) {
        if (mask[i]) { d[p] = 90; d[p + 1] = 240; d[p + 2] = 170; d[p + 3] = 90; }
        else         { d[p + 3] = 0; }
      }
      mctx.putImageData(mimg, 0, 0);
      pctx.drawImage(mcv, 0, 0, cw, ch);
    }

    /* ③ 두 팔을 잇는 선과 머리 */
    if (showMask && feat) {
      var kx = cw / W, ky = ch / H;
      pctx.strokeStyle = '#ffd23f'; pctx.lineWidth = 3; pctx.lineCap = 'round';
      pctx.beginPath();
      pctx.moveTo(feat.bs * kx, feat.ly * ky);
      pctx.lineTo(feat.be * kx, feat.ry * ky);
      pctx.stroke();
      pctx.fillStyle = '#ffd23f';
      pctx.beginPath(); pctx.arc(feat.bs * kx, feat.ly * ky, 4, 0, 6.284); pctx.fill();
      pctx.beginPath(); pctx.arc(feat.be * kx, feat.ry * ky, 4, 0, 6.284); pctx.fill();
      pctx.fillStyle = '#ff5fd0';
      pctx.beginPath();
      pctx.arc((feat.bs + feat.be) / 2 * kx, feat.head * ky, 4.5, 0, 6.284);
      pctx.fill();
    }

    /* ④ 지금 어느 쪽으로 조종되고 있는지 */
    if (phase === 'on') {
      var cx = cw / 2, by = ch - 26;
      arrow(pctx, cx - 34, by, -1, 0, sm.roll < -0.12);
      arrow(pctx, cx + 34, by,  1, 0, sm.roll >  0.12);
      arrow(pctx, cx, by - 18, 0, -1, sm.pitch >  0.12);
      arrow(pctx, cx, by + 12, 0,  1, sm.pitch < -0.12);
    }

    /* ⑤ 상태 한 줄 */
    var q = quality();
    var col = q.level === 'ok' ? '#7fe0a8' : (q.level === 'wait' ? '#ffd23f' : '#ff9a6c');
    pctx.fillStyle = 'rgba(0,0,0,0.62)';
    pctx.fillRect(0, ch - 17, cw, 17);
    pctx.fillStyle = col;
    pctx.font = '700 11px "Apple SD Gothic Neo", sans-serif';
    pctx.textAlign = 'center';
    pctx.fillText(phase === 'on' || phase === 'lost' ? q.text : (msg || q.text), cw / 2, ch - 5);
  }

  function arrow(ctx, x, y, dx, dy, lit) {
    var s = 9;
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.moveTo(dx * s, dy * s);
    ctx.lineTo(dx * -2 + dy * s * 0.8, dy * -2 + dx * s * 0.8);
    ctx.lineTo(dx * -2 - dy * s * 0.8, dy * -2 - dx * s * 0.8);
    ctx.closePath();
    ctx.fillStyle = lit ? '#ffd23f' : 'rgba(255,255,255,0.22)';
    ctx.fill();
    ctx.restore();
  }

  /* ------------------------------------------------------------------ API */

  return {
    start: start,
    stop: stop,
    update: update,
    captureBackground: captureBackground,
    capturePose: capturePose,
    isActive: function () { return phase === 'on'; },
    isRunning: function () { return phase !== 'off' && phase !== 'error'; },
    phase: function () { return phase; },
    message: function () { return msg; },
    quality: quality,
    /* 슬라이더 0(둔감) ~ 100(민감) → 경계값 배수 */
    setSensitivity: function (v) { sensMul = 1.75 - (v / 100) * 1.30; },
    setMirror: function (v) { flipRoll = !!v; },
    mirror: function () { return flipRoll; },
    threshold: function () { return Math.round(autoTh); },
    coverage: function () { return fgRatio; },
    out: out,

    /* 확인용 — 카메라 없이 가짜 화면을 넣어 볼 수 있습니다 */
    __feed: function (rgba, asBackground) {
      if (asBackground) {
        bgSum.fill(0); bgN = 0;
        accumulateBackground(rgba); finishBackground();
        return null;
      }
      buildMask(rgba);
      feat = extract();
      if (feat && neutral) control(feat);
      return feat;
    },
    __setNeutral: function (n) { neutral = n; sm.roll = 0; sm.pitch = 0; sm.thr = 0.5; },
    __size: [W, H]
  };
})();
