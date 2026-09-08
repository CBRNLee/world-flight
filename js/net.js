/* =========================================================================
 *  net.js — 함께 날기 (같은 코드를 넣으면 같은 하늘)
 *
 *  · 네 자리 코드가 곧 '방'입니다. 같은 코드를 넣은 사람끼리 서로가 보입니다.
 *  · 1초에 열 번 내 위치를 보내고, 친구 위치를 받습니다.
 *  · 받은 위치는 그대로 찍지 않고 '추측 항법'으로 이어 그려서 부드럽게 만듭니다.
 *    (10 번/초로 받아도 60 번/초로 자연스럽게 움직입니다)
 *
 *  주고받는 것은 별명과 비행기 위치뿐입니다.
 * ========================================================================= */
'use strict';

var Net = (function () {

  /* 공개 중계소 — 하나가 막히면 다음 것으로 넘어갑니다 */
  var BROKERS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://test.mosquitto.org:8081/mqtt'
  ];
  var PREFIX  = 'wf7k2x';       /* 다른 사람의 MQTT 방과 섞이지 않도록 */
  var RATE    = 100;            /* 내 위치를 보내는 간격(ms) */
  var TIMEOUT = 7000;           /* 이만큼 소식이 없으면 나간 것으로 */

  var COLORS = [
    [232,  92,  84], [ 86, 158, 226], [104, 194, 122], [244, 190,  78],
    [190, 124, 226], [ 96, 208, 200], [244, 138,  92], [226, 128, 176]
  ];

  var client = null, brokerIx = 0;
  var code = null, myName = '', myId = null;
  var peers = Object.create(null);
  var beat = null;              /* 위치 보내기는 화면 그리기와 따로 돕니다 */
  var phase = 'off';            /* off | connecting | on | error */
  var msg = '';
  var onChange = null;

  function shortId() { return Math.random().toString(36).slice(2, 8); }
  function topicRoot() { return PREFIX + '/' + code; }

  function setPhase(p, m) {
    phase = p; msg = m || '';
    if (onChange) onChange(phase, msg);
  }

  /* ------------------------------------------------------------ 들어가기 */

  function join(roomCode, name, changeCallback) {
    leave(true);
    onChange = changeCallback || onChange;
    code   = String(roomCode).replace(/[^0-9A-Za-z]/g, '').slice(0, 8).toUpperCase();
    myName = (name || '조종사').slice(0, 10);
    myId   = shortId();
    peers  = Object.create(null);
    brokerIx = 0;
    connect();
    clearInterval(beat);
    beat = setInterval(tick, RATE);
  }

  function connect() {
    setPhase('connecting', '친구를 찾는 중…');
    client = new MqttLite.Client(BROKERS[brokerIx], {
      onready: function () {
        client.subscribe(topicRoot() + '/+');
        setPhase('on', '');
        send();
      },
      onmessage: receive,
      onclose: function (why) {
        if (phase === 'off') return;
        brokerIx++;
        if (brokerIx < BROKERS.length) { connect(); return; }   /* 다음 중계소로 */
        brokerIx = 0;
        setPhase('error', why + ' 다시 붙어 볼게요…');
        setTimeout(function () { if (phase === 'error') connect(); }, 3000);
      }
    });
  }

  function leave(quiet) {
    clearInterval(beat); beat = null;
    if (client) {
      if (client.ready && code && myId) {
        client.publish(topicRoot() + '/' + myId, JSON.stringify({ bye: 1 }));
      }
      client.close();
      client = null;
    }
    peers = Object.create(null);
    if (!quiet) { code = null; setPhase('off', ''); }
    else { phase = 'off'; }
  }

  /* --------------------------------------------------------- 주고받기 */

  function send() {
    if (!client || !client.ready) return;
    var p = Net.plane;
    if (!p) return;
    client.publish(topicRoot() + '/' + myId, JSON.stringify({
      n: myName,
      x: Math.round(p.pos[0]), y: Math.round(p.pos[1]), z: Math.round(p.pos[2]),
      h: +p.yaw.toFixed(3), t: +p.pitch.toFixed(3), r: +p.roll.toFixed(3),
      s: Math.round(p.speed)
    }));
  }

  function receive(topic, text) {
    var id = topic.slice(topic.lastIndexOf('/') + 1);
    if (id === myId) return;                       /* 내가 보낸 것 */
    var d;
    try { d = JSON.parse(text); } catch (e) { return; }

    if (d.bye) { delete peers[id]; if (onChange) onChange(phase, msg); return; }
    if (typeof d.x !== 'number' || typeof d.h !== 'number') return;

    var p = peers[id], isNew = false;
    if (!p) {
      var n = 0, i;
      for (i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) >>> 0;
      p = peers[id] = { ci: n % COLORS.length, rx: d.x, ry: d.y, rz: d.z, ryaw: d.h };
      isNew = true;
    }
    p.name  = String(d.n || '친구').slice(0, 10);
    p.x = d.x; p.y = d.y; p.z = d.z;
    p.yaw = d.h; p.pitch = d.t || 0; p.roll = d.r || 0;
    p.speed = d.s || 0;
    p.last = performance.now();
    if (isNew && onChange) onChange(phase, msg);   /* 이름까지 채운 뒤에 알린다 */
  }

  /* ------------------------------------------------------------ 심장박동
   * 위치 보내기와 친구 정리는 화면 그리기(requestAnimationFrame)와 따로 돕니다.
   * 창을 다른 데로 옮겨 두어도 친구 눈에는 계속 날고 있어야 하니까요.
   * ------------------------------------------------------------------- */
  function tick() {
    if (phase === 'off') return;
    send();
    var now = performance.now(), id, gone = false;
    for (id in peers) {
      if (now - peers[id].last > TIMEOUT) { delete peers[id]; gone = true; }
    }
    if (gone && onChange) onChange(phase, msg);
  }

  /* --------------------------------------------- 매 프레임 (부드럽게 잇기) */

  function update(dt) {
    if (phase === 'off') return;
    var id, p, k;
    for (id in peers) {
      p = peers[id];

      /* 추측 항법 — 마지막으로 받은 방향·속도로 계속 날려 둔다 */
      var cp = Math.cos(p.pitch);
      p.x += Math.sin(p.yaw) * cp * p.speed * dt;
      p.y += Math.sin(p.pitch)     * p.speed * dt;
      p.z += Math.cos(p.yaw) * cp * p.speed * dt;

      /* 화면에 그릴 위치는 그 값으로 부드럽게 따라간다 */
      k = Math.min(1, dt * 6);
      p.rx += (p.x - p.rx) * k;
      p.ry += (p.y - p.ry) * k;
      p.rz += (p.z - p.rz) * k;

      var da = p.yaw - p.ryaw;
      while (da >  Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      p.ryaw += da * k;
    }
  }

  function list() {
    var out = [], id;
    for (id in peers) out.push(peers[id]);
    return out;
  }

  return {
    plane: null,                 /* main.js 가 자기 비행기를 여기에 꽂아 줍니다 */
    join: join,
    leave: leave,
    update: update,
    peers: list,
    count: function () { return list().length; },
    isOn:  function () { return phase === 'on'; },
    phase: function () { return phase; },
    message: function () { return msg; },
    code:  function () { return code; },
    color: function (i) { return COLORS[i % COLORS.length]; },
    newCode: function () { return String(Math.floor(1000 + Math.random() * 9000)); }
  };
})();
