/* =========================================================================
 *  engine3d.js — 초경량 3D 렌더러
 *
 *  외부 라이브러리 없이 Canvas 2D 위에 다각형을 직접 투영해서 그립니다.
 *  (화가 알고리즘 = 먼 것부터 차례로 덧그리기)
 *
 *  좌표계 : X = 동쪽,  Y = 위,  Z = 북쪽   (오른손 좌표계)
 *  각도   : yaw = 좌우 방향, pitch = 기수 상하, roll = 좌우 기울기
 * ========================================================================= */
'use strict';

var Engine3D = (function () {

  var TAU  = Math.PI * 2;
  var NEAR = 1.5;                     // 근거리 절단면 (이보다 가까우면 잘라냄)

  function norm(v) {
    var l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  var SUN = norm([0.42, 0.78, -0.46]);   // 햇빛이 비쳐오는 방향

  /* ---------------------------------------------------------------------
   * 요·피치·롤 값으로부터 카메라(비행기)의 축 세 개를 만든다.
   * 회전 순서: 롤 → 피치 → 요
   * ------------------------------------------------------------------- */
  function makeBasis(yaw, pitch, roll) {
    var cy = Math.cos(yaw),   sy = Math.sin(yaw);
    var cp = Math.cos(pitch), sp = Math.sin(pitch);
    var cr = Math.cos(roll),  sr = Math.sin(roll);

    function rot(vx, vy, vz) {
      var x1 =  vx * cr + vy * sr;          // 롤 (앞뒤 축)
      var y1 = -vx * sr + vy * cr;
      var y2 =  y1 * cp + vz * sp;          // 피치 (좌우 축)
      var z2 = -y1 * sp + vz * cp;
      return [x1 * cy + z2 * sy, y2, -x1 * sy + z2 * cy];   // 요 (수직 축)
    }
    return { right: rot(1, 0, 0), up: rot(0, 1, 0), fwd: rot(0, 0, 1) };
  }

  /* 근거리 절단면으로 다각형 자르기 (Sutherland–Hodgman) */
  function clipNear(pts) {
    var out = [], n = pts.length, i, a, b, t;
    for (i = 0; i < n; i++) {
      a = pts[i]; b = pts[(i + 1) % n];
      var ain = a.z >= NEAR, bin = b.z >= NEAR;
      if (ain) out.push(a);
      if (ain !== bin) {
        t = (NEAR - a.z) / (b.z - a.z);
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: NEAR });
      }
    }
    return out;
  }

  /* 화면 사각형을 직선(A·x + B·y + C = 0)의 한쪽(<=0)으로 잘라내기 */
  function clipHalfPlane(poly, A, B, C) {
    var out = [], n = poly.length, i;
    for (i = 0; i < n; i++) {
      var a = poly[i], b = poly[(i + 1) % n];
      var ga = A * a[0] + B * a[1] + C;
      var gb = A * b[0] + B * b[1] + C;
      var ain = ga <= 0, bin = gb <= 0;
      if (ain) out.push(a);
      if (ain !== bin) {
        var t = ga / (ga - gb);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    return out;
  }

  /* ===================================================================== */

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d', { alpha: false });
    this.w = 1; this.h = 1; this.dpr = 1;
    this.items  = [];

    this.skyTop = [ 40, 112, 208];   // 하늘 꼭대기 색
    this.haze   = [198, 228, 246];   // 수평선 안개 색
    this.seaFar = [ 76, 150, 204];   // 먼 바다 / 가까운 바다
    this.seaNear= [ 20,  78, 142];

    this.fogStart = 2600;
    this.fogEnd   = 17000;
    this.horizonY = 0.4;             // 소실점의 화면 세로 위치 (px, main.js 가 설정)
    this.outline  = true;            // 면 사이 실틈 없애기
  }

  Renderer.prototype.resize = function (w, h, dpr) {
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width  = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width  = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  Renderer.prototype.begin = function (cam) {
    this.cam = cam;
    var b = makeBasis(cam.yaw, cam.pitch, cam.roll);
    this.rx = b.right; this.uy = b.up; this.fz = b.fwd;
    this.cx = this.w * 0.5;
    this.cy = this.horizonY;
    this.focal = (this.h * 0.5) / Math.tan(cam.fov * 0.5);
    this.items.length = 0;
  };

  /* 월드 좌표 → 카메라 좌표 */
  Renderer.prototype.toCam = function (x, y, z) {
    var p = this.cam.pos;
    var dx = x - p[0], dy = y - p[1], dz = z - p[2];
    var r = this.rx, u = this.uy, f = this.fz;
    return {
      x: dx * r[0] + dy * r[1] + dz * r[2],
      y: dx * u[0] + dy * u[1] + dz * u[2],
      z: dx * f[0] + dy * f[1] + dz * f[2]
    };
  };

  /* 색 = 기본색 × 밝기, 그리고 거리만큼 안개색으로 흐려지게 */
  Renderer.prototype._color = function (rgb, shade, dist) {
    var f = (dist - this.fogStart) / (this.fogEnd - this.fogStart);
    f = f < 0 ? 0 : (f > 1 ? 1 : f);
    var hz = this.haze;
    var r = rgb[0] * shade, g = rgb[1] * shade, b = rgb[2] * shade;
    r += (hz[0] - r) * f; g += (hz[1] - g) * f; b += (hz[2] - b) * f;
    return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
  };

  /* 다각형 하나를 그리기 목록에 넣는다 (클리핑 + 투영까지 여기서)
     bias = 겹쳐 놓은 바닥면끼리 순서가 흔들리지 않도록 하는 정렬 보정값 */
  Renderer.prototype.addPoly = function (pts, rgb, shade, bias) {
    var cam = [], minZ = Infinity, i, c;
    for (i = 0; i < pts.length; i++) {
      c = this.toCam(pts[i][0], pts[i][1], pts[i][2]);
      cam.push(c);
      if (c.z < minZ) minZ = c.z;
    }
    if (minZ < NEAR) {
      cam = clipNear(cam);
      if (cam.length < 3) return;
    }
    var flat = new Array(cam.length * 2), dsum = 0;
    for (i = 0; i < cam.length; i++) {
      c = cam[i];
      var k = this.focal / c.z;
      flat[i * 2]     = this.cx + c.x * k;
      flat[i * 2 + 1] = this.cy - c.y * k;
      dsum += c.z;
    }
    var d = dsum / cam.length;
    if (d > this.fogEnd) return;
    this.items.push({ p: flat, d: d - (bias || 0), c: this._color(rgb, shade, d) });
  };

  /* 앞면만 그리는 면(face) — 뒷면은 자동으로 걸러낸다 */
  Renderer.prototype.addFace = function (pts, rgb) {
    var p0 = pts[0], p1 = pts[1], p2 = pts[2];
    var ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    var bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
    var nx = ay * bz - az * by,
        ny = az * bx - ax * bz,
        nz = ax * by - ay * bx;
    var cp = this.cam.pos;
    if (nx * (cp[0] - p0[0]) + ny * (cp[1] - p0[1]) + nz * (cp[2] - p0[2]) <= 0) return;
    var nl = Math.hypot(nx, ny, nz) || 1;
    var lam = 0.55 + 0.45 * Math.max(0, (nx * SUN[0] + ny * SUN[1] + nz * SUN[2]) / nl);
    this.addPoly(pts, rgb, lam);
  };

  /* --- 기본 도형들 ---------------------------------------------------- */

  /* 상자: (x, z)는 중심, y는 바닥 높이, rot는 세로축 회전 */
  Renderer.prototype.addBox = function (x, y, z, w, h, d, rgb, rot) {
    var hw = w * 0.5, hd = d * 0.5;
    var c = Math.cos(rot || 0), s = Math.sin(rot || 0);
    function P(lx, ly, lz) {
      return [x + lx * c + lz * s, y + ly, z - lx * s + lz * c];
    }
    var A = P(-hw, 0, -hd), B = P(hw, 0, -hd), C = P(hw, 0, hd), D = P(-hw, 0, hd);
    var E = P(-hw, h, -hd), F = P(hw, h, -hd), G = P(hw, h, hd), H = P(-hw, h, hd);
    this.addFace([E, H, G, F], rgb);   // 윗면
    this.addFace([D, C, G, H], rgb);   // 북
    this.addFace([B, A, E, F], rgb);   // 남
    this.addFace([C, B, F, G], rgb);   // 동
    this.addFace([A, D, H, E], rgb);   // 서
  };

  /* 원뿔대: r1 = 0 이면 뿔, r0 = r1 이면 원기둥, n = 4 면 사각 기둥 */
  Renderer.prototype.addFrustum = function (x, y, z, r0, r1, h, n, rgb, rot) {
    n = n || 12;
    var phase = (rot || 0) + Math.PI / n;
    var bot = [], top = [], i, a;
    for (i = 0; i < n; i++) {
      a = phase - (i / n) * TAU;                  // 각도를 줄이며 = 바깥쪽 법선
      var ca = Math.cos(a), sa = Math.sin(a);
      bot.push([x + ca * r0, y,     z + sa * r0]);
      top.push([x + ca * r1, y + h, z + sa * r1]);
    }
    for (i = 0; i < n; i++) {
      var j = (i + 1) % n;
      if (r1 < 0.01) this.addFace([bot[i], bot[j], top[j]], rgb);
      else           this.addFace([bot[i], bot[j], top[j], top[i]], rgb);
    }
    if (r1 >= 0.01) this.addFace(top, rgb);       // 윗뚜껑
  };

  /* 땅에 눕힌 원판(섬, 광장 등) */
  Renderer.prototype.addDisc = function (x, y, z, r, n, rgb, bias) {
    var pts = [], i;
    for (i = 0; i < n; i++) {
      var a = -(i / n) * TAU;
      pts.push([x + Math.cos(a) * r, y, z + Math.sin(a) * r]);
    }
    this.addPoly(pts, rgb, 1.0, bias);
  };

  /* 땅에 눕힌 직사각형(활주로, 도로 등) */
  Renderer.prototype.addRect = function (x, y, z, w, d, rgb, rot, bias) {
    var hw = w * 0.5, hd = d * 0.5;
    var c = Math.cos(rot || 0), s = Math.sin(rot || 0);
    function P(lx, lz) { return [x + lx * c + lz * s, y, z - lx * s + lz * c]; }
    this.addPoly([P(-hw, -hd), P(-hw, hd), P(hw, hd), P(hw, -hd)], rgb, 1.0, bias);
  };

  /* 구름 한 뭉치 (화면을 향한 동그라미) */
  Renderer.prototype.addPuff = function (x, y, z, r, rgb, alpha) {
    var c = this.toCam(x, y, z);
    if (c.z < 260) return;                       /* 코앞의 구름은 그리지 않는다 */
    if (c.z < 950) alpha *= (c.z - 260) / 690;   /* 가까울수록 서서히 옅게 */
    var k = this.focal / c.z;
    var sr = r * k;
    if (sr < 1.2) return;
    var sx = this.cx + c.x * k, sy = this.cy - c.y * k;
    if (sx + sr < 0 || sx - sr > this.w || sy + sr < 0 || sy - sr > this.h) return;
    if (c.z > this.fogEnd) return;
    this.items.push({ p: [sx, sy], r: sr, d: c.z, a: alpha,
                      c: this._color(rgb, 1, c.z * 0.55) });
  };

  /* --- 하늘 · 바다 · 해 ------------------------------------------------ */

  Renderer.prototype.drawSky = function () {
    var ctx = this.ctx, W = this.w, H = this.h;

    /* 지평선 직선:  A·X + B·Y + C = 0,  지면은 값이 음수인 쪽 */
    var A = this.rx[1];
    var B = -this.uy[1];
    var C = -this.cx * this.rx[1] + this.cy * this.uy[1] + this.focal * this.fz[1];
    var len = Math.hypot(A, B) || 1;
    var nxu = A / len, nyu = B / len;                       // 하늘 쪽 방향
    var g0  = (A * this.cx + B * this.cy + C) / len;
    var px  = this.cx - nxu * g0, py = this.cy - nyu * g0;  // 지평선 위의 한 점
    var L   = H * 1.05;

    /* 하늘 */
    var sg = ctx.createLinearGradient(px + nxu * L, py + nyu * L, px, py);
    sg.addColorStop(0,    rgbs(this.skyTop));
    sg.addColorStop(0.55, rgbs(mix(this.skyTop, this.haze, 0.52)));
    sg.addColorStop(0.88, rgbs(mix(this.skyTop, this.haze, 0.94)));
    sg.addColorStop(1,    rgbs(this.haze));
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, W, H);

    /* 해 */
    var s = this.toCam(this.cam.pos[0] + SUN[0] * 1e4,
                       this.cam.pos[1] + SUN[1] * 1e4,
                       this.cam.pos[2] + SUN[2] * 1e4);
    if (s.z > 1) {
      var k = this.focal / s.z;
      var sx = this.cx + s.x * k, sy = this.cy - s.y * k;
      var rr = Math.max(24, this.h * 0.05);
      var gg = ctx.createRadialGradient(sx, sy, rr * 0.2, sx, sy, rr * 5);
      gg.addColorStop(0, 'rgba(255,252,225,0.95)');
      gg.addColorStop(0.16, 'rgba(255,246,196,0.55)');
      gg.addColorStop(1, 'rgba(255,246,196,0)');
      ctx.fillStyle = gg;
      ctx.beginPath(); ctx.arc(sx, sy, rr * 5, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fffdf0';
      ctx.beginPath(); ctx.arc(sx, sy, rr, 0, TAU); ctx.fill();
    }

    /* 바다 */
    var ground = clipHalfPlane([[0, 0], [W, 0], [W, H], [0, H]], A, B, C);
    if (ground.length >= 3) {
      var wg = ctx.createLinearGradient(px, py, px - nxu * L * 0.85, py - nyu * L * 0.85);
      wg.addColorStop(0,    rgbs(this.haze));
      wg.addColorStop(0.05, rgbs(mix(this.haze, this.seaFar, 0.88)));
      wg.addColorStop(0.17, rgbs(this.seaFar));
      wg.addColorStop(0.55, rgbs(this.seaNear));
      wg.addColorStop(1,    rgbs(mix(this.seaNear, [8, 46, 92], 0.7)));
      ctx.beginPath();
      ctx.moveTo(ground[0][0], ground[0][1]);
      for (var i = 1; i < ground.length; i++) ctx.lineTo(ground[i][0], ground[i][1]);
      ctx.closePath();
      ctx.fillStyle = wg;
      ctx.fill();
    }
  };

  /* --- 모아둔 다각형을 먼 것부터 그린다 -------------------------------- */

  Renderer.prototype.flush = function () {
    var it = this.items, ctx = this.ctx, i, k, o, p;
    it.sort(function (a, b) { return b.d - a.d; });
    for (i = 0; i < it.length; i++) {
      o = it[i];
      if (o.r !== undefined) {                     // 구름
        ctx.globalAlpha = o.a;
        ctx.beginPath(); ctx.arc(o.p[0], o.p[1], o.r, 0, TAU);
        ctx.fillStyle = o.c; ctx.fill();
        ctx.globalAlpha = 1;
        continue;
      }
      p = o.p;
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      for (k = 2; k < p.length; k += 2) ctx.lineTo(p[k], p[k + 1]);
      ctx.closePath();
      ctx.fillStyle = o.c;
      ctx.fill();
      if (this.outline) { ctx.strokeStyle = o.c; ctx.lineWidth = 1; ctx.stroke(); }
    }
  };

  /* --- 작은 도우미 ----------------------------------------------------- */

  function rgbs(c) { return 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')'; }
  function mix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  return {
    Renderer: Renderer,
    makeBasis: makeBasis,
    clamp: clamp,
    TAU: TAU
  };
})();
