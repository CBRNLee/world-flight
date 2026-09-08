/* =========================================================================
 *  mqtt-lite.js — 아주 작은 MQTT 클라이언트 (QoS 0 전용, 라이브러리 없음)
 *
 *  친구와 같은 하늘에서 날려면 서로의 위치를 주고받을 '중계소'가 필요합니다.
 *  깃허브 페이지는 정적 사이트라 서버를 둘 수 없으므로,
 *  누구나 쓸 수 있는 공개 MQTT 중계소에 WebSocket 으로 붙습니다.
 *
 *  MQTT 3.1.1 중에서 이 놀이에 필요한 것만 직접 만들었습니다.
 *    CONNECT / CONNACK / SUBSCRIBE / SUBACK / PUBLISH / PINGREQ / PINGRESP
 * ========================================================================= */
'use strict';

var MqttLite = (function () {

  var TE = new TextEncoder();
  var TD = new TextDecoder();

  /* 남은 길이(Remaining Length)는 128 진법 가변 길이로 적습니다 */
  function varint(n) {
    var out = [], b;
    do {
      b = n % 128; n = Math.floor(n / 128);
      if (n > 0) b |= 128;
      out.push(b);
    } while (n > 0);
    return out;
  }

  /* 문자열은 [길이 2바이트][UTF-8] 형태 */
  function utf(s) {
    var b = TE.encode(s), out = [b.length >> 8, b.length & 255], i;
    for (i = 0; i < b.length; i++) out.push(b[i]);
    return out;
  }

  function frame(head, body) {
    return new Uint8Array([head].concat(varint(body.length), body));
  }

  /* --------------------------------------------------------------------- */

  function Client(url, opts) {
    opts = opts || {};
    this.url       = url;
    this.clientId  = opts.clientId || ('wf' + Math.random().toString(16).slice(2, 14));
    this.keepalive = 45;
    this.onmessage = opts.onmessage || function () {};
    this.onready   = opts.onready   || function () {};
    this.onclose   = opts.onclose   || function () {};
    this.buf   = new Uint8Array(0);
    this.ready = false;
    this.dead  = false;
    this.subs  = [];
    this.pid   = 1;
    this._open();
  }

  Client.prototype._open = function () {
    var self = this;
    try {
      this.ws = new WebSocket(this.url, 'mqtt');
    } catch (e) {
      this.onclose('중계소에 연결할 수 없어요.');
      return;
    }
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = function () {
      /* CONNECT : 프로토콜 이름 MQTT, 버전 4(3.1.1), clean session */
      var body = utf('MQTT').concat(
        [0x04, 0x02, self.keepalive >> 8, self.keepalive & 255],
        utf(self.clientId));
      self._send(frame(0x10, body));
    };
    this.ws.onmessage = function (ev) { self._data(new Uint8Array(ev.data)); };
    this.ws.onerror   = function () { /* onclose 에서 함께 처리 */ };
    this.ws.onclose   = function () {
      self.ready = false;
      clearInterval(self.ping);
      if (!self.dead) self.onclose('중계소와 연결이 끊어졌어요.');
    };
  };

  Client.prototype._send = function (bytes) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(bytes);
  };

  /* 받은 바이트를 모아 두었다가 완성된 패킷만 꺼낸다 */
  Client.prototype._data = function (chunk) {
    var merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf); merged.set(chunk, this.buf.length);
    this.buf = merged;

    for (;;) {
      if (this.buf.length < 2) return;
      var mult = 1, len = 0, i = 1, b;
      do {
        if (i >= this.buf.length) return;          /* 아직 덜 왔다 */
        b = this.buf[i++];
        len += (b & 127) * mult;
        mult *= 128;
        if (mult > 128 * 128 * 128) { this.buf = new Uint8Array(0); return; }
      } while (b & 128);
      if (this.buf.length < i + len) return;       /* 본문이 덜 왔다 */

      var head = this.buf[0];
      var body = this.buf.subarray(i, i + len);
      this._packet(head >> 4, body);
      this.buf = this.buf.slice(i + len);
    }
  };

  Client.prototype._packet = function (type, body) {
    var self = this;
    if (type === 2) {                              /* CONNACK */
      if (body.length >= 2 && body[1] !== 0) {
        this.onclose('중계소가 연결을 거절했어요. (코드 ' + body[1] + ')');
        this.close();
        return;
      }
      this.ready = true;
      this.ping = setInterval(function () { self._send(frame(0xC0, [])); },
                              (this.keepalive * 1000) / 2);
      this.subs.forEach(function (t) { self.subscribe(t); });
      this.onready();
      return;
    }
    if (type === 3) {                              /* PUBLISH (QoS 0) */
      var tl = (body[0] << 8) | body[1];
      var topic = TD.decode(body.subarray(2, 2 + tl));
      var msg   = TD.decode(body.subarray(2 + tl));
      this.onmessage(topic, msg);
    }
    /* SUBACK(9) · PINGRESP(13) 은 따로 할 일이 없습니다 */
  };

  Client.prototype.subscribe = function (topic) {
    if (this.subs.indexOf(topic) < 0) this.subs.push(topic);
    if (!this.ready) return;
    var id = this.pid++ & 0xffff || 1;
    this._send(frame(0x82, [id >> 8, id & 255].concat(utf(topic), [0])));
  };

  Client.prototype.publish = function (topic, message) {
    if (!this.ready) return;
    var payload = TE.encode(message), body = utf(topic), i;
    for (i = 0; i < payload.length; i++) body.push(payload[i]);
    this._send(frame(0x30, body));
  };

  Client.prototype.close = function () {
    this.dead = true;
    clearInterval(this.ping);
    try { this._send(frame(0xE0, [])); } catch (e) { /* 이미 닫혔으면 그만 */ }
    try { this.ws.close(); } catch (e) { /* 무시 */ }
    this.ready = false;
  };

  return { Client: Client };
})();
