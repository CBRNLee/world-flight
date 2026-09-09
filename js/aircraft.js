/* =========================================================================
 *  aircraft.js — 비행기 움직임 (유치원용으로 아주 부드럽게)
 *
 *  · 절대 추락하지 않습니다. 손을 놓으면 스스로 수평으로 돌아옵니다.
 *  · 조종간을 기울이면(roll) 비행기가 그쪽으로 천천히 돌아갑니다.
 * ========================================================================= */
'use strict';

function Aircraft() {
  this.pos   = [0, 900, -2600];   // 서울 남쪽 하늘에서 시작
  this.yaw   = 0;                 // 북쪽을 바라봄
  this.pitch = 0;
  this.roll  = 0;
  this.throttle = 0.55;
  this.speed = 150;               // m/s
}

Aircraft.MIN_ALT = 60;
Aircraft.MAX_ALT = 6000;

Aircraft.prototype.forward = function () {
  var cp = Math.cos(this.pitch);
  return [Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp];
};

Aircraft.prototype.update = function (dt, cmd) {
  var clamp = Engine3D.clamp;

  /* --- 출력 : 몸으로 조종할 때는 목표값으로 바로 맞춘다 --- */
  if (cmd.throttleAbs !== null && cmd.throttleAbs !== undefined) {
    this.throttle += (cmd.throttleAbs - this.throttle) * Math.min(1, dt * 1.8);
  } else {
    this.throttle = clamp(this.throttle + cmd.throttle * 0.45 * dt, 0, 1);
  }
  this.throttle = clamp(this.throttle, 0, 1);
  var target = 55 + this.throttle * 235;                 // 55 ~ 290 m/s
  this.speed += (target - this.speed) * Math.min(1, dt * 0.55);

  /* --- 좌우 기울이기 ---
   *
   *  방향키는 '누르는 동안 계속 기울어지는' 방식이 자연스럽습니다.
   *  하지만 태블릿을 기울이거나 팔을 기울이는 것은 '이만큼 기울여 줘' 라는
   *  자리(위치) 명령입니다. 이것을 속도 명령으로 받으면
   *   · 조금만 기울여도 시간이 지나며 끝까지 기울어지고
   *   · 기울기를 되돌려도 비행기는 기울어진 채로 남습니다.
   *  그래서 기울기·몸동작일 때는 기울인 만큼만 기울어지도록 합니다.
   */
  if (cmd.rollAbs !== null && cmd.rollAbs !== undefined) {
    var wantRoll = clamp(cmd.rollAbs, -1, 1) * 1.0;      /* 최대 약 57도 */
    this.roll += (wantRoll - this.roll) * Math.min(1, dt * 4.5);
  } else {
    this.roll += cmd.roll * 1.35 * dt;
    if (Math.abs(cmd.roll) < 0.04) this.roll *= Math.pow(0.22, dt);   // 자동 수평
  }
  this.roll = clamp(this.roll, -1.05, 1.05);

  /* --- 기수 올리고 내리기 --- */
  if (cmd.pitchAbs !== null && cmd.pitchAbs !== undefined) {
    var wantPitch = clamp(cmd.pitchAbs, -1, 1) * 0.42;
    this.pitch += (wantPitch - this.pitch) * Math.min(1, dt * 3.5);
  } else {
    this.pitch += cmd.pitch * 0.62 * dt;
    if (Math.abs(cmd.pitch) < 0.04) this.pitch *= Math.pow(0.34, dt);
  }
  this.pitch = clamp(this.pitch, -0.5, 0.55);

  /* --- 기울인 만큼 방향이 바뀐다 --- */
  this.yaw += Math.sin(this.roll) * 0.78 * dt * (0.55 + this.speed / 420);
  if (this.yaw >  Math.PI) this.yaw -= Math.PI * 2;
  if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;

  /* --- 앞으로 나아가기 --- */
  var f = this.forward();
  this.pos[0] += f[0] * this.speed * dt;
  this.pos[1] += f[1] * this.speed * dt;
  this.pos[2] += f[2] * this.speed * dt;

  /* --- 너무 낮거나 높지 않게 (착한 안전장치) --- */
  if (this.pos[1] < Aircraft.MIN_ALT) {
    this.pos[1] = Aircraft.MIN_ALT;
    if (this.pitch < 0) this.pitch += (0.12 - this.pitch) * Math.min(1, dt * 2.4);
  }
  if (this.pos[1] > Aircraft.MAX_ALT) {
    this.pos[1] = Aircraft.MAX_ALT;
    if (this.pitch > 0) this.pitch *= 0.9;
  }

  /* --- 세계는 사방으로 이어져 있다 --- */
  var S = World.SIZE;
  if (this.pos[0] >  S / 2) this.pos[0] -= S;
  if (this.pos[0] < -S / 2) this.pos[0] += S;
  if (this.pos[2] >  S / 2) this.pos[2] -= S;
  if (this.pos[2] < -S / 2) this.pos[2] += S;
};

/* 자동 조종: 목표 도시를 향해 스스로 날아갑니다 */
Aircraft.prototype.autopilot = function (target, cmd) {
  var dx = World.wrapDelta(target.x, this.pos[0]);
  var dz = World.wrapDelta(target.z, this.pos[2]);
  var want = Math.atan2(dx, dz);
  var err = want - this.yaw;
  while (err >  Math.PI) err -= Math.PI * 2;
  while (err < -Math.PI) err += Math.PI * 2;

  cmd.rollAbs = null; cmd.pitchAbs = null;      /* 자동조종은 스스로 몰아갑니다 */
  var wantRoll = Engine3D.clamp(err * 1.6, -0.85, 0.85);
  cmd.roll  = Engine3D.clamp((wantRoll - this.roll) * 3.2, -1, 1);

  var wantAlt = 1050;
  var wantPitch = Engine3D.clamp((wantAlt - this.pos[1]) * 0.0016, -0.16, 0.2);
  cmd.pitch = Engine3D.clamp((wantPitch - this.pitch) * 5.0, -1, 1);

  var dist = Math.hypot(dx, dz);
  cmd.throttleAbs = dist < 2600 ? 0.42 : 0.85;
};
