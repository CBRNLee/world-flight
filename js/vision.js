/* =========================================================================
 *  vision.js — 카메라로 몸을 인식해서 비행기를 조종합니다.
 *
 *  외부 라이브러리 없이 직접 만든 실루엣 추적기입니다.
 *   1) 사람이 없을 때의 배경을 몇 초 동안 기억해 둡니다.
 *   2) 매 프레임 배경과 다른 부분(= 사람)을 찾아 실루엣을 만듭니다.
 *   3) 실루엣의 왼쪽 끝 · 오른쪽 끝(= 두 손)과 머리 꼭대기를 찾아
 *      팔의 기울기 · 팔의 높이 · 키 높이를 재서 조종 신호로 바꿉니다.
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
  var mcv = null, mctx = null, mimg = null;          /* 실루엣 미리보기용 */
  var preview = null, pctx = null;

  var bgSum = new Float32Array(NPX * 3), bgN = 0;
  var bg    = null;
  var mask  = new Uint8Array(NPX), tmp = new Uint8Array(NPX);
  var colCount = new Int32Array(W), colSum = new Int32Array(W), colTop = new Int32Array(W);

  var phase = 'off';      /* off | starting | bg | pose | on | lost | error */
  var phaseT = 0;
  var neutral = null;     /* 기준 자세: {hand, head, span} */
  var poseAcc = null;
  var sens = 46;          /* 배경과 얼마나 달라야 사람으로 볼지 */
  var lastRun = 0;
  var feat = null;
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
    stream = null; video = null; bg = null; neutral = null;
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
    feat = extract();

    if (phase === 'pose') {
      if (feat) {
        poseAcc.hand += feat.hand; poseAcc.head += feat.head;
        poseAcc.span += feat.span; poseAcc.n++;
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
    var i, p, d;
    for (i = 0, p = 0; i < NPX; i++, p += 4) {
      d = Math.abs(px[p]     - bg[i * 3])
        + Math.abs(px[p + 1] - bg[i * 3 + 1])
        + Math.abs(px[p + 2] - bg[i * 3 + 2]);
      tmp[i] = d > sens ? 1 : 0;
    }
    neighbours(tmp, mask, 6);      /* 잡티 지우기 */
    neighbours(mask, tmp, 3);      /* 구멍 메우기 */
    mask.set(tmp);
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
    var x, y, i;
    colCount.fill(0); colSum.fill(0); colTop.fill(-1);
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        if (mask[y * W + x]) {
          colCount[x]++; colSum[x] += y;
          if (colTop[x] < 0) colTop[x] = y;
        }
      }
    }

    /* 사람일 가능성이 가장 큰 = 가장 넓은 연속 구간 */
    var s = -1, bs = -1, be = -1;
    for (x = 0; x <= W; x++) {
      var on = x < W && colCount[x] >= 3;
      if (on && s < 0) s = x;
      if (!on && s >= 0) {
        if (bs < 0 || (x - s) > (be - bs)) { bs = s; be = x; }
        s = -1;
      }
    }
    if (bs < 0) return null;
    var span = be - bs;
    if (span < 16) return null;

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

    var area = 0;
    for (x = bs; x < be; x++) area += colCount[x];
    if (area < 140) return null;

    return { bs: bs, be: be, span: span, ly: ly, ry: ry,
             hand: (ly + ry) * 0.5, head: head, area: area };
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

    /* 좌우 · 수평 : 두 손을 잇는 선의 기울기 */
    var tilt = (f.ly - f.ry) / scale;                 /* 오른손이 내려가면 음수 */
    var roll = clamp(-tilt * 3.4, -1, 1);

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

  /* ----------------------------------------------------------- 미리보기 */

  function drawPreview(showMask) {
    if (!pctx) return;
    var d = mimg.data, i, p, on;
    for (i = 0, p = 0; i < NPX; i++, p += 4) {
      on = showMask && mask[i];
      d[p]     = on ? 126 : 20;
      d[p + 1] = on ? 232 : 28;
      d[p + 2] = on ? 168 : 38;
      d[p + 3] = 255;
    }
    mctx.putImageData(mimg, 0, 0);

    var cw = preview.width, ch = preview.height;
    pctx.imageSmoothingEnabled = false;
    pctx.drawImage(mcv, 0, 0, cw, ch);

    if (showMask && feat) {
      var kx = cw / W, ky = ch / H;
      pctx.strokeStyle = '#ffd23f'; pctx.lineWidth = 2; pctx.lineCap = 'round';
      pctx.beginPath();
      pctx.moveTo(feat.bs * kx, feat.ly * ky);
      pctx.lineTo(feat.be * kx, feat.ry * ky);
      pctx.stroke();
      pctx.fillStyle = '#ff5fd0';
      pctx.beginPath();
      pctx.arc((feat.bs + feat.be) / 2 * kx, feat.head * ky, 4, 0, Math.PI * 2);
      pctx.fill();
    }
    if (phase !== 'on') {
      pctx.fillStyle = 'rgba(0,0,0,0.55)';
      pctx.fillRect(0, ch - 22, cw, 22);
      pctx.fillStyle = '#fff';
      pctx.font = '600 11px "Apple SD Gothic Neo", sans-serif';
      pctx.textAlign = 'center';
      pctx.fillText(msg || '준비 중…', cw / 2, ch - 7);
    }
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
    setSensitivity: function (v) { sens = v; },
    sensitivity: function () { return sens; },
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
