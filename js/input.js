/* =========================================================================
 *  input.js — 조종 입력 (키보드 · 화면 버튼 · 마우스/손가락 · 카메라 신체 인식)
 *
 *  손이나 키보드를 쓰면 그 입력이 우선이고,
 *  가만히 있으면 카메라가 읽은 몸동작이 조종을 이어받습니다.
 * ========================================================================= */
'use strict';

var Input = (function () {

  var keys  = Object.create(null);
  var touch = { up: 0, down: 0, left: 0, right: 0, thrUp: 0, thrDown: 0 };
  var drag  = null;                       // 화면을 끌어서 조종할 때
  var cmd   = { pitch: 0, roll: 0, throttle: 0, throttleAbs: null, manual: false };
  var onAction = function () {};          // 스페이스/N 같은 단축키 알림

  function init(canvas, actionHandler) {
    if (actionHandler) onAction = actionHandler;

    window.addEventListener('keydown', function (e) {
      if (e.repeat) { return; }
      keys[e.code] = 1;
      if (e.code === 'Space')  { e.preventDefault(); onAction('autopilot'); }
      if (e.code === 'KeyN')   { onAction('nextCity'); }
      if (e.code === 'KeyM')   { onAction('sound'); }
      if (e.code === 'KeyP')   { onAction('passport'); }
      if (e.code === 'KeyC')   { onAction('camera'); }
      if (e.code === 'KeyF')   { onAction('friends'); }
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].indexOf(e.code) >= 0) e.preventDefault();
    });
    window.addEventListener('keyup', function (e) { keys[e.code] = 0; });
    window.addEventListener('blur', function () { for (var k in keys) keys[k] = 0; });

    /* 화면 버튼 (태블릿) */
    var pad = document.getElementById('touch');
    if (pad) {
      pad.querySelectorAll('[data-k]').forEach(function (btn) {
        var k = btn.getAttribute('data-k');
        var on  = function (e) { e.preventDefault(); touch[k] = 1; btn.classList.add('on'); };
        var off = function (e) { e.preventDefault(); touch[k] = 0; btn.classList.remove('on'); };
        btn.addEventListener('pointerdown', on);
        btn.addEventListener('pointerup', off);
        btn.addEventListener('pointercancel', off);
        btn.addEventListener('pointerleave', off);
      });
    }

    /* 창문 부분을 끌어서 조종하기 */
    canvas.addEventListener('pointerdown', function (e) {
      if (e.clientY > window.innerHeight - Cockpit.panelHeight(window.innerWidth, window.innerHeight)) return;
      canvas.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointermove', function (e) {
      if (drag) { drag.x = e.clientX; drag.y = e.clientY; }
    });
    function endDrag() { drag = null; }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  function poll() {
    var p = 0, r = 0, t = 0;

    if (keys['ArrowUp']    || touch.up)    p += 1;
    if (keys['ArrowDown']  || touch.down)  p -= 1;
    if (keys['ArrowLeft']  || touch.left)  r -= 1;
    if (keys['ArrowRight'] || touch.right) r += 1;

    if (keys['KeyW'] || keys['ShiftLeft'] || keys['ShiftRight'] || keys['Equal'] || touch.thrUp)   t += 1;
    if (keys['KeyS'] || keys['ControlLeft'] || keys['Minus'] || touch.thrDown) t -= 1;

    if (drag) {
      var W = window.innerWidth, H = window.innerHeight;
      r += Engine3D.clamp((drag.x - W / 2) / (W * 0.30), -1, 1);
      p += Engine3D.clamp((H * 0.36 - drag.y) / (H * 0.26), -1, 1);
    }

    cmd.pitch    = Engine3D.clamp(p, -1, 1);
    cmd.roll     = Engine3D.clamp(r, -1, 1);
    cmd.throttle = Engine3D.clamp(t, -1, 1);
    cmd.throttleAbs = null;
    cmd.manual   = (Math.abs(cmd.pitch) > 0.02 || Math.abs(cmd.roll) > 0.02 ||
                    Math.abs(cmd.throttle) > 0.02);

    /* 카메라 신체 인식 — 손을 대고 있지 않은 축만 몸동작이 맡는다 */
    if (typeof Vision !== 'undefined' && Vision.isActive()) {
      var v = Vision.out;
      if (Math.abs(cmd.roll)  < 0.02) cmd.roll  = v.roll;
      if (Math.abs(cmd.pitch) < 0.02) cmd.pitch = v.pitch;
      if (Math.abs(cmd.throttle) < 0.02 && v.throttle !== null) cmd.throttleAbs = v.throttle;
    }
    return cmd;
  }

  return { init: init, poll: poll, cmd: cmd };
})();
