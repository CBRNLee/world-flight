/* =========================================================================
 *  pose.js — 진짜 자세 인식 (MediaPipe Pose)
 *
 *  손목·어깨·코의 위치를 직접 알려 주는 모델입니다.
 *  배경이 아무리 복잡해도, 옷 색이 벽과 같아도 상관없습니다.
 *
 *  · 카메라 조종을 켤 때만 인터넷에서 한 번 받아 옵니다(약 5MB, 이후 캐시).
 *  · 받지 못하면 (인터넷이 없는 교실 등) 직접 만든 실루엣 방식으로 자동으로 넘어갑니다.
 *    그래서 인터넷이 없어도 놀이는 계속됩니다.
 * ========================================================================= */
'use strict';

var Pose = (function () {

  var CDN   = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1';
  var MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/' +
              'pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

  var lm = null;
  var state = 'idle';        /* idle | loading | ready | failed */
  var err = '';
  var lastTs = -1;

  /* 필요한 관절 번호 (MediaPipe Pose 33점 기준) */
  var NOSE = 0, LSH = 11, RSH = 12, LEL = 13, REL = 14, LWR = 15, RWR = 16;

  function load() {
    if (state === 'ready')   return Promise.resolve(true);
    if (state === 'loading') return Promise.resolve(false);
    state = 'loading'; err = '';

    return import(/* @vite-ignore */ CDN + '/vision_bundle.mjs')
      .then(function (v) {
        return v.FilesetResolver.forVisionTasks(CDN + '/wasm').then(function (fs) {
          return v.PoseLandmarker.createFromOptions(fs, {
            baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' },
            runningMode: 'VIDEO',
            numPoses: 1,
            minPoseDetectionConfidence: 0.5,
            minPosePresenceConfidence: 0.5,
            minTrackingConfidence: 0.5
          });
        });
      })
      .then(function (p) { lm = p; state = 'ready'; return true; })
      .catch(function (e) {
        state = 'failed';
        err = (e && e.message) ? e.message : String(e);
        return false;
      });
  }

  /* 한 프레임에서 관절을 찾는다. 못 찾으면 null */
  function detect(video, tsMs) {
    if (state !== 'ready' || !lm || !video) return null;
    /* 아직 크기가 잡히지 않은 영상은 넘긴다 (모델이 오류를 냅니다) */
    if (!video.videoWidth || !video.videoHeight) return null;
    var ts = Math.round(tsMs);
    if (ts <= lastTs) ts = lastTs + 1;      /* 시각은 반드시 커져야 합니다 */
    lastTs = ts;
    try {
      var r = lm.detectForVideo(video, ts);
      if (r && r.landmarks && r.landmarks.length) return r.landmarks[0];
    } catch (e) { /* 한 프레임 실패는 그냥 넘어갑니다 */ }
    return null;
  }

  function seen(L, i) {
    var p = L[i];
    return !!p && (p.visibility === undefined || p.visibility > 0.4);
  }

  return {
    load: load,
    detect: detect,
    seen: seen,
    isReady:   function () { return state === 'ready'; },
    isLoading: function () { return state === 'loading'; },
    failed:    function () { return state === 'failed'; },
    error:     function () { return err; },
    state:     function () { return state; },
    JOINTS: { NOSE: NOSE, LSH: LSH, RSH: RSH, LEL: LEL, REL: REL, LWR: LWR, RWR: RWR }
  };
})();
