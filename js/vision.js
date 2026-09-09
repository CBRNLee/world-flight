/* =========================================================================
 *  vision.js — 카메라로 몸을 인식해서 비행기를 조종합니다.
 *
 *  외부 라이브러리 없이 직접 만든 실루엣 추적기입니다.
 *   1) 사람이 없을 때의 배경을 몇 초 동안 기억해 둡니다.
 *   2) 매 프레임 배경과 다른 부분(= 사람)을 찾아 실루엣을 만듭니다.
 *   3) 실루엣의 왼쪽 끝 · 오른쪽 끝(= 두 손)과 머리 꼭대기를 찾아
 *      팔의 기울기 · 팔의 높이 · 키 높이를 재서 조종 신호로 바꿉니다.
 *
 *  ★ 움직임 기반 인식
 *  복잡한 배경(교구장·게시물·장난감)에서는 "무엇이 배경인가"를 미리 찍어 두는 것만으로
 *  부족합니다. 그래서 '움직임'을 기준으로 삼습니다.
 *
 *   · 움직인 자리 기억(motion) — 앞 프레임과 달라진 곳을 표시하고 몇 초에 걸쳐 천천히
 *     지웁니다. 사람은 늘 조금씩 움직이므로 이 자리가 따뜻하게 남습니다.
 *   · 사람 고르기 — 덩어리 중 '최근에 움직인' 곳을 사람으로 봅니다. 의자·게시물처럼
 *     가만히 있는 것은 아무리 크게 잡혀도 사람이 아닙니다.
 *   · 배경 스스로 배우기 — 움직임이 없는 자리는 배경으로 계속 새로 배웁니다. 물건을
 *     옮겨 두었거나 배경을 찍을 때 누가 지나가도 몇 초 안에 알아서 바로잡힙니다.
 *
 *  단순한 프레임 차분과 달리, 실루엣 자체는 배경 빼기로 만들기 때문에
 *  팔을 벌리고 '가만히 있어도' 사람이 사라지지 않습니다.
 *
 *  교실에서 잘 되도록 넣은 장치들
 *   · 자동 밝기 보정 — 웹캠이 스스로 밝기를 바꿔도 배경이 통째로 사람으로
 *     잡히지 않도록, 매 프레임 전체 밝기 비율을 재서 배경에 곱해 맞춥니다.
 *   · 그림자 걸러내기 — 어두워지기만 하고 색은 그대로면 그림자로 봅니다.
 *   · 자동 기준값 — 화면 잡음 수준(중앙값)을 재서 경계값을 스스로 정합니다.
 *   · 느린 배경 따라가기 — 사람이 없는 자리는 조금씩 갱신해 조명 변화를 따라갑니다.
 *   · 이어진 덩어리 찾기 — 화면에 여러 개가 잡혀도 가장 큰 덩어리 하나만 사람으로 봅니다.
 *   · 스스로 고치기 — 화면 대부분이 사람으로 잡히면 배경을 다시 찍습니다.
 *
 *  조종 방법
 *    · 팔을 기울이면        → 그쪽으로 돌기 (좌우)
 *    · 팔을 나란히          → 수평 비행
 *    · 팔을 위로 / 아래로   → 고도 올리기 / 내리기
 *    · 키를 크게 / 앉기     → 속도 빠르게 / 느리게
 * ========================================================================= */
'use strict';

var Vision = (function () {

  var W = 208, H = 156;                 /* 처리용 해상도 (얇은 팔도 잡히도록 조금 크게) */
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
  var label = new Int32Array(NPX), stk = new Int32Array(NPX);   /* 덩어리(연결 성분) 찾기 */
  var luma = new Uint8Array(NPX), prevL = null;   /* 앞 프레임과 견주기 위한 밝기 */
  var motion = new Float32Array(NPX);             /* 최근에 움직인 자리 (천천히 식음) */
  var mhist = new Int32Array(64);
  var motionTh = 12, motionLevel = 0;
  var bestLabel = -1, blobShare = 0, blobCount = 0;
  var prevCx = -1, prevCy = -1;
  var sf = null;                        /* 부드럽게 이어 그리기 위한 이전 값 */
  var floodT = 0;                       /* 배경이 완전히 어긋났을 때 스스로 고치기 */

  var usingPose = false;  /* MediaPipe 자세 인식을 쓰는 중인지 */
  var poseLm = null;      /* 최근에 찾은 관절들 */

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
      if (typeof Pose !== 'undefined') Pose.load();   /* 받는 동안에도 놀이는 계속됩니다 */
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
    sf = null; prevCx = -1; floodT = 0; prevL = null; motion.fill(0);
    setPhase('bg', '카메라 앞에서 잠깐만 비켜 주세요');
  }

  /* 기준 자세(팔 벌리고 서기) 다시 잡기 */
  function capturePose() {
    var ready = (typeof Pose !== 'undefined' && Pose.isReady());
    if (!bg && !ready) { captureBackground(); return; }
    poseAcc = { hand: 0, head: 0, span: 0, sp: 0, n: 0 };
    setPhase('pose', ready ? '팔을 옆으로 쭉 펴 주세요'
                           : '팔을 옆으로 쭉! 살짝 흔들어 주세요');
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

    /* ① 자세 인식 모델이 준비됐으면 그것을 쓴다.
       이때는 배경을 기억할 필요가 아예 없으므로 '비켜 주세요' 단계를 건너뜁니다. */
    var f = null, ready = (typeof Pose !== 'undefined' && Pose.isReady());
    poseLm = null;
    if (ready) {
      poseLm = Pose.detect(video, now);
      if (poseLm) f = featuresFromPose(poseLm);
      if (phase === 'bg') { bg = null; capturePose(); }
    }
    usingPose = !!f;

    /* ② 자세 인식이 아직 없으면 예전처럼 배경을 기억해서 실루엣으로 찾는다 */
    if (!ready) {
      if (phase === 'bg') {
        accumulateBackground(px);
        if (now - phaseT > 2400) { finishBackground(); capturePose(); }
        drawPreview(false);
        return;
      }
      if (!bg) return;
      computeMotion(px);
      buildMask(px);
      f = extract();
    }
    if (f) { feat = f; featAt = now; }
    else if (now - featAt > 500) { feat = null; }   /* 잠깐 놓친 것은 버티기 */

    if (phase === 'pose') {
      /* 실루엣 방식은 배경이 자리를 잡는 앞부분을 버린다.
         자세 인식은 그럴 필요가 없어 처음부터 모읍니다. */
      if (f && (ready || now - phaseT > 1300)) {
        poseAcc.hand += f.hand; poseAcc.head += f.head;
        poseAcc.span += f.span;
        poseAcc.sp += (f.speedRef !== undefined ? f.speedRef : f.head);
        poseAcc.n++;
      }
      if (now - phaseT > 3200) {
        if (poseAcc.n > 8) {
          neutral = { hand: poseAcc.hand / poseAcc.n,
                      head: poseAcc.head / poseAcc.n,
                      span: poseAcc.span / poseAcc.n,
                      speedRef: poseAcc.sp / poseAcc.n };
          sm.roll = 0; sm.pitch = 0; sm.thr = 0.5;
          setPhase('on', '준비 완료! 몸으로 조종해 보세요');
        } else {
          setPhase('pose', '잘 안 보여요. 팔을 벌리고 흔들어 주세요');
        }
      }
      drawPreview(true);
      return;
    }

    /* 화면 대부분이 사람으로 잡히면 배경이 어긋난 것 — 스스로 다시 찍는다
       (조명을 켰거나 카메라를 옮겼을 때 선생님이 손대지 않아도 회복되도록) */
    if (!usingPose && !ready && (phase === 'on' || phase === 'lost') && fgRatio > 0.72) {
      if (!floodT) floodT = now;
      else if (now - floodT > 3000) {
        captureBackground();
        setPhase('bg', '배경이 바뀌었어요. 잠깐만 비켜 주세요');
        return;
      }
    } else { floodT = 0; }

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

  /* 앞 프레임과 견주어 '지금 움직인 곳'을 찾고, 몇 초에 걸쳐 천천히 지운다.
     사람은 숨쉬고 흔들리므로 이 자리가 계속 따뜻하게 남습니다. */
  function computeMotion(px) {
    var i, p, L, md, acc, med;
    mhist.fill(0);
    for (i = 0, p = 0; i < NPX; i++, p += 4) {
      luma[i] = (px[p] * 77 + px[p + 1] * 151 + px[p + 2] * 28) >> 8;
    }
    if (!prevL) { prevL = new Uint8Array(NPX); prevL.set(luma); motion.fill(0); return; }

    for (i = 0; i < NPX; i++) {
      md = luma[i] - prevL[i]; if (md < 0) md = -md;
      diff[i] = md;                       /* 잠시 빌려 쓴다 (아래에서 다시 채움) */
      var b = md >> 2; if (b > 63) b = 63;
      mhist[b]++;
    }
    /* 움직임 경계값도 화면 잡음에서 스스로 정한다 */
    var half = NPX >> 1;
    for (i = 0, acc = 0, med = 0; i < 64; i++) { acc += mhist[i]; if (acc >= half) { med = i << 2; break; } }
    motionTh = med * 2.5 + 7;
    if (motionTh < 6) motionTh = 6; else if (motionTh > 60) motionTh = 60;

    var lit = 0;
    for (i = 0; i < NPX; i++) {
      if (diff[i] > motionTh) { motion[i] = 255; lit++; }
      else motion[i] *= 0.975;            /* 약 2.5초에 걸쳐 식는다 */
    }
    motionLevel = lit / NPX;
    prevL.set(luma);
  }

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

    /* 잡티를 지운 뒤, 두 번 부풀렸다가 다시 줄여서 끊어진 팔을 이어 붙인다(닫기) */
    neighbours(tmp, mask, 4);      /* 열기 — 홀로 떠 있는 점 제거 */
    neighbours(mask, tmp, 2);      /* 부풀리기 */
    neighbours(tmp, mask, 2);      /* 한 번 더 — 1~2px 끊긴 곳을 잇는다 */
    neighbours(mask, tmp, 6);      /* 원래 굵기로 되돌리기 */
    mask.set(tmp);

    /* ⑤ 배경은 '움직임이 없는 자리'에서 계속 새로 배운다.
       복잡한 배경이라도, 물건을 옮겼거나 배경 찍을 때 누가 지나갔더라도
       몇 초 안에 스스로 바로잡힙니다. */
    for (i = 0, p = 0; i < NPX; i++, p += 4) {
      var rate;
      if (motion[i] > 40) rate = 0;              /* 지금 움직이는 곳 — 건드리지 않는다 */
      else if (mask[i]) {
        /* 사람으로 따라가고 있는 덩어리는 절대 배경으로 삼키지 않는다.
           (팔을 벌리고 가만히 있어도 사라지지 않도록)
           그 밖의 조용한 물체는 아주 천천히 배경이 된다 — 옮겨 둔 의자 같은 것 */
        rate = (label[i] === bestLabel) ? 0 : 0.012;
      }
      else                rate = 0.10;           /* 확실한 배경 — 빨리 배운다 */
      if (rate) {
        bg[i * 3]     += (px[p]     - bg[i * 3])     * rate;
        bg[i * 3 + 1] += (px[p + 1] - bg[i * 3 + 1]) * rate;
        bg[i * 3 + 2] += (px[p + 2] - bg[i * 3 + 2]) * rate;
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

  /* --------------------------------------------------- 실루엣에서 특징 뽑기
   *
   *  예전에는 '세로줄이 켜져 있는 구간'만 보고 사람을 찾았습니다. 그러면
   *  잡음이 한 줄만 껴도 팔 끝이 튀고, 옆에 있는 다른 물체와 한 덩어리로
   *  뭉쳐 버립니다. 그래서 진짜 '이어진 덩어리'를 찾아 가장 큰 것 하나만
   *  사람으로 보도록 바꿨습니다.
   * ------------------------------------------------------------------- */

  /* -------------------------------------------------- 관절 → 조종 특징
   *  MediaPipe 는 손목·어깨·코의 자리를 바로 알려 줍니다.
   *  아래 값들은 실루엣 방식과 똑같은 형태로 맞춰 두었기 때문에,
   *  보정·조종 계산은 하나도 바꾸지 않고 그대로 씁니다.
   * ------------------------------------------------------------------- */
  function featuresFromPose(L) {
    var J = Pose.JOINTS;
    if (!Pose.seen(L, J.LWR) || !Pose.seen(L, J.RWR)) return null;
    if (!Pose.seen(L, J.LSH) || !Pose.seen(L, J.RSH)) return null;

    /* 화면은 거울처럼 뒤집어 보여 주므로 x 도 뒤집는다.
       그러면 아이의 오른손이 화면 오른쪽에 옵니다. */
    function X(i) { return (1 - L[i].x) * W; }
    function Y(i) { return L[i].y * H; }

    var lwx = X(J.LWR), lwy = Y(J.LWR);      /* 아이의 왼손  → 화면 왼쪽 */
    var rwx = X(J.RWR), rwy = Y(J.RWR);      /* 아이의 오른손 → 화면 오른쪽 */
    /* 고도는 '어깨 대비 손 높이'로 잽니다. 어깨는 팔과 함께 움직이므로
       아이가 앉거나 서도 고도가 흔들리지 않습니다.
       속도는 따로 '머리가 화면에서 얼마나 높은가'로 잽니다. */
    var shoulder = (Y(J.LSH) + Y(J.RSH)) * 0.5;
    var nose = Pose.seen(L, J.NOSE) ? Y(J.NOSE) : shoulder - H * 0.08;

    /* 크기 기준은 두 손 사이 거리 — 아이가 앞뒤로 움직여도 함께 변하므로 안정적 */
    var span = Math.hypot(rwx - lwx, rwy - lwy);
    if (span < W * 0.08) return null;        /* 두 손이 붙어 있으면 조종하지 않는다 */

    var raw = { bs: lwx, be: rwx, span: span, ly: lwy, ry: rwy,
                hand: (lwy + rwy) * 0.5, head: shoulder, speedRef: nose,
                area: span * span };

    if (!sf) sf = { bs: raw.bs, be: raw.be, ly: raw.ly, ry: raw.ry,
                    head: raw.head, sp: raw.speedRef };
    else {
      var k = 0.5;
      sf.bs += (raw.bs - sf.bs) * k;  sf.be += (raw.be - sf.be) * k;
      sf.ly += (raw.ly - sf.ly) * k;  sf.ry += (raw.ry - sf.ry) * k;
      sf.head += (raw.head - sf.head) * k;
      sf.sp = (sf.sp === undefined) ? raw.speedRef : sf.sp + (raw.speedRef - sf.sp) * k;
    }
    raw.bs = sf.bs; raw.be = sf.be; raw.ly = sf.ly; raw.ry = sf.ry; raw.head = sf.head;
    raw.speedRef = sf.sp;
    raw.hand = (sf.ly + sf.ry) * 0.5;
    raw.span = Math.hypot(sf.be - sf.bs, sf.ry - sf.ly);
    return raw;
  }

  /* 이어진 덩어리들을 찾아 가장 사람다운 것 하나를 고른다 */
  function pickBlob() {
    label.fill(0);
    var cur = 0, i, p, x, y, sp, area, sx, sy, mo;
    var best = 0, bestScore = -1, bestArea = 0, total = 0, big = 0;
    bestMoved = 0;

    for (i = 0; i < NPX; i++) {
      if (!mask[i] || label[i]) continue;
      cur++;
      sp = 0; area = 0; sx = 0; sy = 0; mo = 0;
      stk[sp++] = i; label[i] = cur;
      while (sp) {
        p = stk[--sp];
        x = p % W; y = (p / W) | 0;
        area++; sx += x; sy += y; mo += motion[p];
        /* 여덟 방향으로 이어 붙인다 (대각선으로 스친 팔도 한 덩어리로) */
        if (x > 0     && mask[p-1]   && !label[p-1])   { label[p-1]=cur;   stk[sp++]=p-1; }
        if (x < W-1   && mask[p+1]   && !label[p+1])   { label[p+1]=cur;   stk[sp++]=p+1; }
        if (y > 0     && mask[p-W]   && !label[p-W])   { label[p-W]=cur;   stk[sp++]=p-W; }
        if (y < H-1   && mask[p+W]   && !label[p+W])   { label[p+W]=cur;   stk[sp++]=p+W; }
        if (x>0   && y>0   && mask[p-W-1] && !label[p-W-1]) { label[p-W-1]=cur; stk[sp++]=p-W-1; }
        if (x<W-1 && y>0   && mask[p-W+1] && !label[p-W+1]) { label[p-W+1]=cur; stk[sp++]=p-W+1; }
        if (x>0   && y<H-1 && mask[p+W-1] && !label[p+W-1]) { label[p+W-1]=cur; stk[sp++]=p+W-1; }
        if (x<W-1 && y<H-1 && mask[p+W+1] && !label[p+W+1]) { label[p+W+1]=cur; stk[sp++]=p+W+1; }
      }
      total += area;
      if (area > NPX * 0.008) big++;

      /* ★ 사람은 '최근에 움직인 덩어리'입니다.
         의자·게시물처럼 가만히 있는 것은 아무리 크게 잡혀도 사람이 아닙니다.
         다만 팔을 벌리고 잠깐 멈춰 있어도 놓치지 않도록, 넓이도 함께 봅니다. */
      var cx = sx / area, cy = sy / area;
      var moved = mo / (area * 255);                    /* 0 ~ 1 */
      var score = area * (0.30 + 0.70 * Math.min(1, moved * 4));

      /* 조금 전까지 따라가던 자리와 가까우면 크게 쳐준다
         (가만히 있는 동안 다른 것으로 옮겨가지 않도록) */
      if (prevCx >= 0) {
        var d = Math.hypot(cx - prevCx, cy - prevCy);
        if (d < W * 0.12) score *= 2.2;
      }
      if (score > bestScore) { bestScore = score; best = cur; bestArea = area;
                               bestMoved = moved; prevCandX = cx; prevCandY = cy; }
    }

    blobCount = big;
    blobShare = total > 0 ? bestArea / total : 0;
    bestLabel = best;
    return bestArea;
  }
  var prevCandX = -1, prevCandY = -1, bestMoved = 0;

  function extract() {
    var area = pickBlob();
    if (!bestLabel || area < NPX * 0.010) { prevCx = -1; return null; }

    prevCx = prevCandX; prevCy = prevCandY;

    /* 고른 덩어리에 대해서만 세로줄 통계를 낸다 */
    var x, y, i;
    colCount.fill(0); colSum.fill(0); colTop.fill(-1);
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        i = y * W + x;
        if (label[i] === bestLabel) {
          colCount[x]++; colSum[x] += y;
          if (colTop[x] < 0) colTop[x] = y;
        }
      }
    }

    /* 양쪽 끝(손)은 '맨 끝 픽셀'이 아니라 넓이 기준 1.5% 지점으로 잡는다.
       점 하나 때문에 노란 선이 튀지 않도록 */
    var edge = area * 0.015, acc, bs = -1, be = -1;
    for (x = 0, acc = 0; x < W; x++) { acc += colCount[x]; if (acc >= edge) { bs = x; break; } }
    for (x = W - 1, acc = 0; x >= 0; x--) { acc += colCount[x]; if (acc >= edge) { be = x; break; } }
    if (bs < 0 || be < 0 || be - bs < 18) return null;

    var span = be - bs;
    var wing = Math.max(2, Math.round(span * 0.09));
    var ly = meanY(bs, bs + wing), ry = meanY(be - wing + 1, be + 1);
    if (ly === null || ry === null) return null;

    /* 가운데 기둥들의 꼭대기 = 머리 (팔을 옆으로 올려도 흔들리지 않음) */
    var mid = (bs + be) / 2, half = Math.max(2, Math.round(span * 0.13));
    var tops = [];
    for (x = Math.round(mid - half); x <= Math.round(mid + half); x++) {
      if (x >= 0 && x < W && colTop[x] >= 0) tops.push(colTop[x]);
    }
    if (tops.length < 3) return null;
    tops.sort(function (a, b) { return a - b; });
    var head = tops[tops.length >> 1];

    /* 프레임마다 조금씩 흔들리는 값을 부드럽게 이어 준다 (노란 선이 뚝뚝 끊기지 않게) */
    var raw = { bs: bs, be: be, span: span, ly: ly, ry: ry,
                hand: (ly + ry) * 0.5, head: head, area: area };
    if (!sf) sf = { bs: bs, be: be, ly: ly, ry: ry, head: head };
    else {
      var k = 0.45;
      sf.bs   += (bs   - sf.bs)   * k;
      sf.be   += (be   - sf.be)   * k;
      sf.ly   += (ly   - sf.ly)   * k;
      sf.ry   += (ry   - sf.ry)   * k;
      sf.head += (head - sf.head) * k;
    }
    raw.bs = sf.bs; raw.be = sf.be; raw.ly = sf.ly; raw.ry = sf.ry;
    raw.head = sf.head; raw.span = sf.be - sf.bs;
    raw.hand = (sf.ly + sf.ry) * 0.5;
    return raw;
  }

  function meanY(x0, x1) {
    var sum = 0, n = 0, x;
    for (x = Math.max(0, x0); x < Math.min(W, x1); x++) {
      if (colCount[x] > 0) { sum += colSum[x] / colCount[x] * colCount[x]; n += colCount[x]; }
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
    var sref  = (f.speedRef !== undefined) ? f.speedRef : f.head;
    var sref0 = (neutral.speedRef !== undefined) ? neutral.speedRef : neutral.head;
    var thr = clamp(0.5 + (sref0 - sref) / (H * 0.34), 0, 1);

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
    if (phase === 'pose') return { level: 'wait', text: '팔 벌리고 살짝 흔들기!' };
    if (fgRatio < 0.012)  return { level: 'low',  text: '사람이 잘 안 보여요 → 민감도 ▲' };
    if (fgRatio > 0.45)   return { level: 'high', text: '배경까지 잡혀요 → 🖼 배경 다시' };
    if (usingPose)        return { level: 'ok',   text: '자세 인식 중 (정확)' };
    if (typeof Pose !== 'undefined' && Pose.isLoading() && !feat)
                          return { level: 'wait', text: '자세 인식 준비 중…' };
    if (!feat && motionLevel < 0.004)
                          return { level: 'low',  text: '조금 움직여 보세요' };
    if (!feat)            return { level: 'low',  text: '몸 전체가 보이게 서 주세요' };
    /* 다른 덩어리가 좀 보여도 사람을 제대로 고르고 있으면 괜찮습니다.
       사람 덩어리가 작아졌을 때만 알려 줍니다. */
    if (blobShare < 0.55) return { level: 'high', text: '인식이 흩어져요 → 🖼 배경 다시' };
    if (blobCount > 3 && blobShare < 0.75)
                          return { level: 'high', text: '다른 것도 잡혀요 → 🖼 배경 다시' };
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
    /* 자세 인식 중이면 뼈대를 그린다 (덩어리 색칠은 필요 없습니다) */
    if (usingPose && poseLm) { drawSkeleton(poseLm, cw, ch); }
    else if (showMask) {
      var d = mimg.data, i, p;
      for (i = 0, p = 0; i < NPX; i++, p += 4) {
        if (!mask[i]) { d[p + 3] = 0; }
        else if (label[i] === bestLabel) {          /* 사람으로 고른 덩어리 */
          d[p] = 90; d[p + 1] = 240; d[p + 2] = 170; d[p + 3] = 95;
        } else {                                    /* 사람이 아니라고 본 것 */
          d[p] = 255; d[p + 1] = 110; d[p + 2] = 90; d[p + 3] = 55;
        }
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

  /* 어깨 → 팔꿈치 → 손목, 그리고 머리 */
  function drawSkeleton(L, cw, ch) {
    var J = Pose.JOINTS;
    function px(i) { return { x: (1 - L[i].x) * cw, y: L[i].y * ch, ok: Pose.seen(L, i) }; }
    var bone = [[J.LSH, J.RSH], [J.LSH, J.LEL], [J.LEL, J.LWR],
                [J.RSH, J.REL], [J.REL, J.RWR]];
    pctx.lineWidth = 3; pctx.lineCap = 'round';
    pctx.strokeStyle = 'rgba(255,255,255,0.85)';
    bone.forEach(function (b) {
      var a = px(b[0]), c = px(b[1]);
      if (!a.ok || !c.ok) return;
      pctx.beginPath(); pctx.moveTo(a.x, a.y); pctx.lineTo(c.x, c.y); pctx.stroke();
    });
    /* 두 손을 잇는 '핸들' 선 */
    var lw = px(J.LWR), rw = px(J.RWR);
    if (lw.ok && rw.ok) {
      pctx.strokeStyle = '#ffd23f'; pctx.lineWidth = 4;
      pctx.beginPath(); pctx.moveTo(lw.x, lw.y); pctx.lineTo(rw.x, rw.y); pctx.stroke();
      pctx.fillStyle = '#ffd23f';
      [lw, rw].forEach(function (h) {
        pctx.beginPath(); pctx.arc(h.x, h.y, 5, 0, 6.284); pctx.fill();
      });
    }
    var n = px(J.NOSE);
    if (n.ok) { pctx.fillStyle = '#ff5fd0';
      pctx.beginPath(); pctx.arc(n.x, n.y, 5.5, 0, 6.284); pctx.fill(); }
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
    blobShare: function () { return blobShare; },
    usingPose: function () { return usingPose; },
    engine: function () {
      if (usingPose) return 'pose';
      if (typeof Pose !== 'undefined' && Pose.isLoading()) return 'loading';
      return 'silhouette';
    },
    motionLevel: function () { return motionLevel; },
    blobMotion: function () { return bestMoved; },
    blobCount: function () { return blobCount; },
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
    /* 확인용 — 관절 좌표를 직접 넣어 조종 신호를 확인합니다 */
    __feedPose: function (L) {
      poseLm = L;
      var f = featuresFromPose(L);
      usingPose = !!f;
      if (f) { feat = f; if (neutral) control(f); }
      return f;
    },
    __setNeutral: function (n) { neutral = n; sm.roll = 0; sm.pitch = 0; sm.thr = 0.5; },
    __size: [W, H]
  };
})();
