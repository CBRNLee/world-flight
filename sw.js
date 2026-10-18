/* =========================================================================
 *  sw.js — 인터넷 없이도 실행되게 해 주는 '서비스 워커'
 *
 *  인터넷이 될 때 한 번 접속하면, 게임 파일과 자세 인식 프로그램을
 *  기기(아이패드·갤럭시탭)에 저장해 둡니다. 그 다음부터는 와이파이가
 *  꺼져 있어도 저장해 둔 것으로 바로 실행됩니다.
 *
 *  인터넷이 될 때는 새 버전이 있는지 확인해서 저장본을 바꿔 둡니다.
 *  (친구와 함께 날기는 다른 기기와 주고받아야 하므로 인터넷이 필요합니다)
 * ========================================================================= */
'use strict';

/* 게임 파일을 고쳐서 올릴 때 이 숫자를 올리면 모든 기기가 새로 저장합니다 */
var VERSION = 'v1';
var APP   = 'flight-app-'   + VERSION;    /* 게임 파일 */
var MODEL = 'flight-model-v1';            /* 자세 인식 프로그램 (자주 바뀌지 않음) */

var APP_FILES = [
  './', './index.html', './manifest.json',
  './css/style.css',
  './js/engine3d.js', './js/mqtt-lite.js', './js/net.js', './js/pose.js',
  './js/vision.js', './js/tilt.js', './js/world.js', './js/aircraft.js',
  './js/cockpit.js', './js/input.js', './js/main.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'
];

var MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1';
var MODEL_FILES = [
  MP + '/vision_bundle.mjs',
  MP + '/wasm/vision_wasm_internal.js',
  MP + '/wasm/vision_wasm_internal.wasm',
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/' +
    'pose_landmarker_lite/float16/1/pose_landmarker_lite.task'
];

/* ---------------------------------------------------------------- 설치 */
self.addEventListener('install', function (e) {
  e.waitUntil((async function () {
    /* ① 게임 파일은 반드시 저장 */
    var app = await caches.open(APP);
    await app.addAll(APP_FILES.map(function (u) { return new Request(u, { cache: 'reload' }); }));

    /* ② 자세 인식 프로그램은 '되는 만큼' 저장 (실패해도 설치는 계속) */
    var model = await caches.open(MODEL);
    await Promise.all(MODEL_FILES.map(async function (u) {
      if (await model.match(u)) return;
      try {
        var r = await fetch(u, { mode: 'cors' });
        if (r.ok) await model.put(u, r);
      } catch (err) { /* 다음에 인터넷이 될 때 다시 */ }
    }));
    self.skipWaiting();
  })());
});

/* 옛날 저장본 정리 + 화면에 '준비 완료' 알리기 */
self.addEventListener('activate', function (e) {
  e.waitUntil((async function () {
    var keys = await caches.keys();
    await Promise.all(keys.map(function (k) {
      if (k !== APP && k !== MODEL) return caches.delete(k);
    }));
    await self.clients.claim();
    var model = await caches.open(MODEL);
    var have = 0;
    for (var i = 0; i < MODEL_FILES.length; i++) if (await model.match(MODEL_FILES[i])) have++;
    var all = await self.clients.matchAll();
    all.forEach(function (c) {
      c.postMessage({ type: 'offline-ready', model: have === MODEL_FILES.length });
    });
  })());
});

/* ---------------------------------------------------------------- 요청 처리 */
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  /* 자세 인식 프로그램: 저장본 먼저 (크고, 거의 안 바뀜) */
  if (url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'storage.googleapis.com') {
    e.respondWith((async function () {
      var cache = await caches.open(MODEL);
      var hit = await cache.match(req.url, { ignoreVary: true });
      if (hit) return hit;
      var r = await fetch(req);
      if (r.ok) cache.put(req.url, r.clone());
      return r;
    })());
    return;
  }

  /* 이 사이트의 게임 파일: 인터넷이 되면 새것을 받아 저장, 안 되면 저장본 */
  if (url.origin === self.location.origin) {
    e.respondWith((async function () {
      var cache = await caches.open(APP);
      try {
        /* 주소로 다시 요청 (페이지 이동 요청에 옵션을 붙이면 브라우저가 거부합니다) */
        var r = await fetch(req.url, { cache: 'no-cache' });
        if (r.ok) cache.put(req, r.clone());
        return r;
      } catch (err) {
        var hit = await cache.match(req, { ignoreSearch: true });
        if (hit) return hit;
        if (req.mode === 'navigate') return cache.match('./index.html');
        throw err;
      }
    })());
  }
  /* 그 밖(친구와 함께 날기 중계소 등)은 건드리지 않습니다 */
});
