/* =========================================================================
 *  world.js — 세계(오픈월드) 만들기
 *
 *  · 바다 위에 24개의 도시 섬이 떠 있고, 지도는 사방으로 이어져 있습니다.
 *    (끝까지 날아가면 반대편에서 다시 나옵니다 = 진짜 오픈월드)
 *  · 도시마다 실제 랜드마크를 단순한 도형으로 만들어 두었습니다.
 *
 *  ★ 새 도시를 추가하려면 아래 CITY_DATA 배열에 항목을 하나 더 쓰면 됩니다.
 * ========================================================================= */
'use strict';

var World = (function () {

  var SIZE = 62000;            // 세계 한 변의 크기(m). 이 거리마다 지도가 이어짐
  var TAU  = Math.PI * 2;

  /* 되풀이되는 난수 (같은 씨앗 → 항상 같은 도시 모양) */
  function rngFrom(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* 지도가 이어져 있으므로 "가장 가까운 쪽"의 차이를 구한다 */
  function wrapDelta(a, b) {
    var d = a - b;
    while (d >  SIZE / 2) d -= SIZE;
    while (d < -SIZE / 2) d += SIZE;
    return d;
  }

  /* ---------------------------------------------------------------------
   *  도시 목록
   *  x, z : 세계 안에서의 위치   /  tall : 건물 높이 배율
   * ------------------------------------------------------------------- */
  /* 서울을 가운데 두고 안쪽 고리 7곳 · 바깥 고리 8곳으로 둘러쌉니다 */
  function ring(i) {
    var a = (i / 7) * TAU - Math.PI * 0.25;
    return [Math.round(Math.cos(a) * 8600), Math.round(Math.sin(a) * 8600)];
  }
  function ring2(i) {
    var a = (i / 8) * TAU - Math.PI * 0.25 + Math.PI / 8;
    return [Math.round(Math.cos(a) * 16200), Math.round(Math.sin(a) * 16200)];
  }
  function ring3(i) {
    var a = (i / 8) * TAU - Math.PI * 0.25;
    return [Math.round(Math.cos(a) * 23800), Math.round(Math.sin(a) * 23800)];
  }

  var CITY_DATA = [
    { id: 'seoul',  name: '서울',   country: '대한민국', flag: '🇰🇷',
      landmark: 'N서울타워', pos: [0, 0], tall: 1.15, seed: 101,
      grass: [126, 176, 96], walls: [[214,206,196],[186,192,200],[226,214,190],[176,186,178]],
      fact: '남산 위에 우뚝 선 N서울타워! 밤이 되면 알록달록 불이 켜져요.',
      real: '우리나라의 수도예요. 한강이 도시 한가운데를 흘러가요.',
      build: buildSeoul },

    { id: 'tokyo',  name: '도쿄',   country: '일본',     flag: '🇯🇵',
      landmark: '도쿄타워',  pos: ring(0), tall: 1.30, seed: 202,
      grass: [120, 172, 104], walls: [[224,222,216],[196,200,206],[172,180,190],[210,206,198]],
      fact: '빨간색과 하얀색 줄무늬가 있는 도쿄타워가 반짝여요.',
      real: '서울에서 비행기로 약 2시간, 8,900km가 아니라 1,150km 떨어져 있어요.',
      build: buildTokyo },

    { id: 'beijing', name: '베이징', country: '중국', flag: '🇨🇳',
      landmark: '천단 & 만리장성', pos: ring(6), tall: 1.00, seed: 909,
      grass: [134, 172, 96], walls: [[218,206,192],[196,186,176],[230,220,204],[178,170,162]],
      fact: '지붕이 파란 천단, 그리고 산을 따라 구불구불 이어진 만리장성이에요.',
      real: '만리장성은 아주 아주 길어서 걸어서 다 보려면 몇 달이 걸려요.',
      build: buildBeijing },

    { id: 'agra', name: '아그라', country: '인도', flag: '🇮🇳',
      landmark: '타지마할', pos: ring(2), tall: 0.55, seed: 1010,
      grass: [166, 186, 104], walls: [[236,220,198],[222,202,176],[244,232,214],[208,188,164]],
      fact: '하얀 돌로 지은 타지마할! 가운데 동그란 지붕이 양파처럼 생겼어요.',
      real: '옛날 임금님이 사랑하는 사람을 위해 20년 동안 지은 건물이래요.',
      build: buildAgra },

    { id: 'dubai', name: '두바이', country: '아랍에미리트', flag: '🇦🇪',
      landmark: '부르즈 할리파', pos: ring(3), tall: 1.45, seed: 1111,
      grass: [222, 200, 148], walls: [[196,208,220],[172,186,202],[214,222,230],[158,174,192]],
      fact: '세상에서 가장 높은 건물이에요. 고개를 아주 많이 들어야 꼭대기가 보여요!',
      real: '사막 옆 바닷가에 있는 도시예요. 아주 덥답니다.',
      build: buildDubai },

    { id: 'moscow', name: '모스크바', country: '러시아', flag: '🇷🇺',
      landmark: '성 바실리 대성당', pos: ring(5), tall: 0.80, seed: 1212,
      grass: [112, 162, 104], walls: [[212,198,186],[188,176,168],[226,214,200],[170,160,154]],
      fact: '알록달록 양파 모양 지붕이 여러 개! 사탕처럼 예쁜 성당이에요.',
      real: '겨울에 눈이 아주 많이 내리는 나라의 수도예요.',
      build: buildMoscow },

    { id: 'istanbul', name: '이스탄불', country: '튀르키예', flag: '🇹🇷',
      landmark: '아야소피아', pos: ring2(0), tall: 0.70, seed: 1313,
      grass: [156, 180, 104], walls: [[228,206,178],[210,186,158],[238,222,200],[196,174,148]],
      fact: '커다란 둥근 지붕과 뾰족한 탑 네 개가 있어요.',
      real: '한 도시가 아시아와 유럽에 걸쳐 있는 신기한 곳이에요.',
      build: buildIstanbul },

    { id: 'athens', name: '아테네', country: '그리스', flag: '🇬🇷',
      landmark: '파르테논 신전', pos: ring2(1), tall: 0.50, seed: 1414,
      grass: [186, 192, 118], walls: [[240,234,220],[226,218,202],[248,244,234],[214,206,190]],
      fact: '기둥이 아주 많은 하얀 신전이에요. 기둥을 한번 세어 볼까요?',
      real: '올림픽이 처음 시작된 나라랍니다.',
      build: buildAthens },

    { id: 'sanfran', name: '샌프란시스코', country: '미국', flag: '🇺🇸',
      landmark: '금문교', pos: ring2(6), tall: 1.05, seed: 1515,
      noBuild: function (x, z) { return Math.abs(x) < 380 && z > 220; },
      grass: [138, 176, 108], walls: [[224,220,214],[198,196,194],[236,232,226],[176,176,178]],
      fact: '바다 위에 걸린 아주 긴 빨간 다리예요. 다리도 교통기관이지요!',
      real: '언덕이 많아서 케이블카가 다니는 도시예요.',
      build: buildSF },

    { id: 'rio', name: '리우데자네이루', country: '브라질', flag: '🇧🇷',
      landmark: '예수상', pos: ring2(7), tall: 0.90, seed: 1616,
      grass: [104, 168, 92], walls: [[236,226,206],[214,200,180],[244,236,220],[196,184,166]],
      fact: '높은 산 위에서 두 팔을 활짝 벌린 커다란 조각상이 있어요.',
      real: '바닷가와 초록 산이 함께 있는 도시예요. 축구를 아주 좋아해요.',
      build: buildRio },

    { id: 'sydney', name: '시드니', country: '오스트레일리아', flag: '🇦🇺',
      landmark: '오페라하우스', pos: ring(1), tall: 0.85, seed: 303,
      grass: [150, 186, 100], walls: [[232,228,218],[206,210,206],[188,196,204],[220,212,196]],
      fact: '조개껍데기처럼 생긴 하얀 지붕! 바로 오페라하우스예요.',
      real: '남반구에 있어서 우리나라가 겨울일 때 여기는 여름이에요.',
      build: buildSydney },

    { id: 'cairo',  name: '카이로', country: '이집트',   flag: '🇪🇬',
      landmark: '피라미드', pos: ring(4), tall: 0.55, seed: 404,
      grass: [214, 188, 122], walls: [[226,206,166],[212,190,150],[236,220,184],[200,180,146]],
      fact: '아주 아주 옛날 사람들이 돌을 쌓아 만든 삼각형 피라미드예요.',
      real: '사막 옆에 나일강이 흐르는 아주 오래된 도시예요.',
      build: buildCairo },

    { id: 'rome',   name: '로마',   country: '이탈리아', flag: '🇮🇹',
      landmark: '콜로세움', pos: ring2(2), tall: 0.55, seed: 505,
      grass: [156, 180, 96], walls: [[228,196,158],[218,178,140],[236,214,180],[204,166,132]],
      fact: '동그란 운동장 콜로세움! 옛날 사람들이 여기 모여 구경했대요.',
      real: '피자와 스파게티가 태어난 나라의 수도랍니다.',
      build: buildRome },

    { id: 'paris',  name: '파리',   country: '프랑스',   flag: '🇫🇷',
      landmark: '에펠탑', pos: ring2(3), tall: 0.60, seed: 606,
      grass: [138, 178, 104], walls: [[228,220,204],[214,206,190],[236,230,216],[200,192,178]],
      fact: '쇠로 만든 아주 높은 에펠탑이 하늘을 찌를 듯 서 있어요.',
      real: '빵집이 정말 많은 도시예요. 크루아상이 유명해요.',
      build: buildParis },

    { id: 'london', name: '런던',   country: '영국',     flag: '🇬🇧',
      landmark: '빅벤 & 런던아이', pos: ring2(4), tall: 0.70, seed: 707,
      grass: [116, 166, 106], walls: [[196,178,164],[176,160,150],[212,196,182],[164,152,146]],
      fact: '땡땡 종을 치는 시계탑 빅벤, 그리고 커다란 관람차 런던아이!',
      real: '이층 빨간 버스와 검은 택시가 다니는 도시예요.',
      build: buildLondon },

    { id: 'newyork', name: '뉴욕',  country: '미국',     flag: '🇺🇸',
      landmark: '자유의 여신상', pos: ring2(5), tall: 1.60, seed: 808,
      grass: [124, 168, 100], walls: [[186,192,200],[164,172,184],[208,212,216],[148,156,170]],
      fact: '횃불을 든 초록빛 자유의 여신상이 바다를 바라보고 있어요.',
      real: '하늘을 찌를 듯 높은 빌딩이 아주 많아서 마천루의 도시라고 불려요.',
      build: buildNewYork },

    /* ---- 바깥 고리 (조금 더 먼 나라들) ---- */

    { id: 'singapore', name: '싱가포르', country: '싱가포르', flag: '🇸🇬',
      landmark: '마리나 베이 샌즈', pos: ring3(0), tall: 1.35, seed: 1717,
      grass: [128, 176, 112], walls: [[204,214,224],[180,194,210],[222,228,234],[164,180,198]],
      fact: '기둥 세 개 위에 커다란 배가 올라앉은 것 같은 건물이에요!',
      real: '아주 작은 섬나라인데 도시 하나가 곧 나라예요.',
      build: buildSingapore },

    { id: 'bangkok', name: '방콕', country: '태국', flag: '🇹🇭',
      landmark: '왓 아룬', pos: ring3(1), tall: 0.75, seed: 1818,
      grass: [140, 180, 96], walls: [[238,226,204],[224,206,176],[246,238,222],[212,192,164]],
      fact: '뾰족뾰족 하얀 탑에 금빛 장식이 반짝이는 새벽 사원이에요.',
      real: '강 위로 배가 다니는 물의 도시랍니다. 코끼리가 유명해요.',
      build: buildBangkok },

    { id: 'capetown', name: '케이프타운', country: '남아프리카공화국', flag: '🇿🇦',
      landmark: '테이블 마운틴', pos: ring3(2), tall: 0.75, seed: 1919,
      grass: [166, 178, 108], walls: [[234,228,216],[212,206,196],[244,238,228],[194,190,182]],
      fact: '꼭대기가 책상처럼 평평한 산이에요. 그래서 테이블 마운틴!',
      real: '아프리카 맨 아래쪽, 두 바다가 만나는 곳에 있어요.',
      build: buildCapeTown },

    { id: 'amsterdam', name: '암스테르담', country: '네덜란드', flag: '🇳🇱',
      landmark: '풍차와 운하', pos: ring3(3), tall: 0.60, seed: 2020,
      grass: [122, 178, 108], walls: [[196,150,126],[172,128,108],[214,170,144],[152,116,100]],
      fact: '빙글빙글 도는 풍차와, 도시 사이로 흐르는 운하가 있어요.',
      real: '자전거가 사람보다 많다고 할 만큼 자전거를 많이 타요.',
      build: buildAmsterdam },

    { id: 'berlin', name: '베를린', country: '독일', flag: '🇩🇪',
      landmark: '브란덴부르크 문', pos: ring3(4), tall: 0.85, seed: 2121,
      grass: [118, 168, 100], walls: [[218,212,202],[196,190,182],[232,226,216],[174,170,164]],
      fact: '기둥이 늘어선 커다란 문과, 공이 달린 높은 텔레비전 탑이 있어요.',
      real: '커다란 곰이 도시의 상징이에요.',
      build: buildBerlin },

    { id: 'barcelona', name: '바르셀로나', country: '스페인', flag: '🇪🇸',
      landmark: '사그라다 파밀리아', pos: ring3(5), tall: 0.70, seed: 2222,
      grass: [172, 184, 104], walls: [[238,216,180],[224,198,158],[246,232,206],[210,184,148]],
      fact: '뾰족한 탑이 여러 개 솟은 성당이에요. 아직도 짓는 중이래요!',
      real: '100년 넘게 짓고 있는 아주 특별한 건물이랍니다.',
      build: buildBarcelona },

    { id: 'toronto', name: '토론토', country: '캐나다', flag: '🇨🇦',
      landmark: 'CN 타워', pos: ring3(6), tall: 1.25, seed: 2323,
      grass: [116, 170, 104], walls: [[198,206,216],[176,186,200],[216,222,228],[158,170,186]],
      fact: '가늘고 아주 높은 탑! 가운데에 동그란 전망대가 달려 있어요.',
      real: '겨울에 아주 춥고 눈이 많이 오는 나라의 큰 도시예요.',
      build: buildToronto },

    { id: 'mexico', name: '멕시코시티', country: '멕시코', flag: '🇲🇽',
      landmark: '태양의 피라미드', pos: ring3(7), tall: 0.80, seed: 2424,
      grass: [188, 182, 108], walls: [[232,204,164],[218,186,142],[242,222,190],[206,174,134]],
      fact: '계단이 층층이 있는 커다란 돌 피라미드예요. 올라가 볼까요?',
      real: '이집트 피라미드와는 모양이 달라요. 꼭대기가 평평하답니다.',
      build: buildMexico }
  ];

  /* ---------------------------------------------------------------------
   *  도형을 담는 목록 만들기 도우미
   *  종류 t: box(상자) / fru(원뿔대) / disc(원판) / rect(직사각형)
   *  lm 이 true 면 아주 멀리서도 보이는 랜드마크
   * ------------------------------------------------------------------- */
  function G() { return []; }
  function box(g, x, y, z, w, h, d, c, rot, lm) {
    g.push({ t: 'box', x: x, y: y, z: z, w: w, h: h, d: d, c: c, r: rot || 0,
             big: (y + h) > 90, lm: !!lm });
  }
  function fru(g, x, y, z, r0, r1, h, n, c, rot, lm) {
    g.push({ t: 'fru', x: x, y: y, z: z, r0: r0, r1: r1, h: h, n: n, c: c, r: rot || 0,
             big: (y + h) > 90, lm: !!lm });
  }
  /* b = 겹쳐 놓은 바닥면의 그리는 순서(클수록 위에 그려짐) */
  function disc(g, x, y, z, r, n, c, lm, b) {
    g.push({ t: 'disc', x: x, y: y, z: z, r0: r, n: n, c: c, b: b || 0,
             big: r > 300, lm: !!lm });
  }
  function rect(g, x, y, z, w, d, c, rot, b) {
    g.push({ t: 'rect', x: x, y: y, z: z, w: w, d: d, c: c, r: rot || 0, b: b || 0,
             big: w > 400 });
  }

  /* ======================= 랜드마크들 ==================================== */

  function buildSeoul(g) {
    /* 남산 */
    fru(g, 0, 0, -260, 300, 170, 90, 14, [104, 150, 88]);
    /* N서울타워 */
    fru(g, 0,  90, -260, 26, 18, 190, 10, [238, 238, 240], 0, true);
    fru(g, 0, 262, -260, 48, 40,  42, 12, [206, 216, 228], 0, true);
    fru(g, 0, 304, -260, 20, 13,  46, 10, [238, 238, 240], 0, true);
    fru(g, 0, 350, -260,  5,  1,  86,  6, [226, 96, 84],   0, true);
    /* 경복궁 느낌의 한옥들 */
    var hx = [-330, -140, 60], hz = [300, 380, 300];
    for (var i = 0; i < 3; i++) {
      box(g, hx[i], 0, hz[i], 150, 34, 92, [214, 176, 138]);
      fru(g, hx[i], 34, hz[i], 118, 20, 40, 4, [78, 106, 92], Math.PI / 4);
      box(g, hx[i], 0, hz[i] + 56, 150, 8, 12, [176, 74, 60]);
    }
  }

  function buildTokyo(g) {
    /* 도쿄타워 */
    fru(g, 0,   0, 0, 96, 40, 165, 4, [226, 84, 66], Math.PI / 4, true);
    box(g, 0, 150, 0, 96, 16, 96, [244, 244, 240], Math.PI / 4, true);
    fru(g, 0, 166, 0, 38, 22, 120, 4, [226, 84, 66], Math.PI / 4, true);
    box(g, 0, 286, 0, 48, 12, 48, [244, 244, 240], Math.PI / 4, true);
    fru(g, 0, 298, 0, 20,  7,  96, 4, [226, 84, 66], Math.PI / 4, true);
    fru(g, 0, 394, 0,  4,  1,  70, 6, [230, 230, 230], 0, true);
    /* 신사 문(토리이) */
    box(g, 330, 0, 260, 14, 70, 14, [214, 76, 62]);
    box(g, 390, 0, 260, 14, 70, 14, [214, 76, 62]);
    box(g, 360, 70, 260, 110, 12, 18, [214, 76, 62]);
  }

  function buildSydney(g) {
    /* 오페라하우스 */
    box(g, 0, 0, 0, 340, 22, 190, [232, 226, 210]);
    var sz = [[-105, 96], [-20, 128], [70, 104], [140, 72]];
    for (var i = 0; i < sz.length; i++) {
      fru(g, sz[i][0], 22, 10, sz[i][1], 0, sz[i][1] * 1.55, 4,
          [246, 244, 238], Math.PI / 4, true);
    }
    /* 하버 브리지 */
    var span = 520, n = 15;
    for (var k = 0; k <= n; k++) {
      var t = k / n;
      var y = Math.sin(t * Math.PI) * 110;
      box(g, -420, y, -300 + span * t, 30, 16, span / n + 6, [130, 138, 146]);
    }
    box(g, -420, 0, -300, 46, 130, 46, [140, 148, 156]);
    box(g, -420, 0,  220, 46, 130, 46, [140, 148, 156]);
  }

  function buildCairo(g) {
    var sand = [230, 208, 158], sand2 = [216, 192, 142];
    fru(g,    0, 0,    0, 280, 0, 300, 4, sand,  Math.PI / 4, true);
    fru(g,  380, 0, -170, 230, 0, 245, 4, sand2, Math.PI / 4, true);
    fru(g, -320, 0, -230, 165, 0, 175, 4, sand,  Math.PI / 4, true);
    /* 스핑크스 */
    box(g, 60, 0, 380, 200, 46, 70, [222, 196, 148], 0.2);
    box(g, 145, 40, 393, 54, 54, 54, [222, 196, 148], 0.2);
    /* 야자수 몇 그루 */
    for (var i = 0; i < 8; i++) {
      var a = i / 8 * TAU, x = Math.cos(a) * 620, z = Math.sin(a) * 620;
      fru(g, x, 0, z, 5, 4, 42, 6, [150, 118, 76]);
      fru(g, x, 42, z, 34, 0, 26, 6, [92, 154, 88]);
    }
  }

  function buildRome(g) {
    /* 콜로세움 */
    var n = 26, R = 170;
    for (var i = 0; i < n; i++) {
      var a = i / n * TAU;
      var x = Math.cos(a) * R, z = Math.sin(a) * R;
      box(g, x, 0,  z, 46, 62, 30, [226, 200, 158], -a, true);
      box(g, x, 62, z, 46, 44, 28, [214, 186, 146], -a, true);
    }
    disc(g, 0, 3, 0, R - 22, 20, [198, 172, 132], false, 8);
    /* 개선문 */
    box(g, -420, 0, 260, 34, 96, 34, [224, 202, 166]);
    box(g, -320, 0, 260, 34, 96, 34, [224, 202, 166]);
    box(g, -370, 96, 260, 134, 34, 40, [230, 210, 176]);
  }

  function buildParis(g) {
    /* 에펠탑 */
    fru(g, 0,   0, 0, 118, 52, 118, 4, [166, 132, 96], Math.PI / 4, true);
    box(g, 0, 118, 0, 118, 10, 118, [150, 118, 84], Math.PI / 4, true);
    fru(g, 0, 128, 0,  50, 27, 132, 4, [166, 132, 96], Math.PI / 4, true);
    box(g, 0, 260, 0,  62,  9,  62, [150, 118, 84], Math.PI / 4, true);
    fru(g, 0, 269, 0,  25,  8, 148, 4, [172, 138, 100], Math.PI / 4, true);
    box(g, 0, 417, 0,  22, 14,  22, [200, 196, 190], Math.PI / 4, true);
    fru(g, 0, 431, 0,   4,  1,  56, 6, [220, 218, 214], 0, true);
    /* 개선문 + 성당 */
    box(g, -430, 0, 300, 30, 84, 30, [230, 222, 204]);
    box(g, -340, 0, 300, 30, 84, 30, [230, 222, 204]);
    box(g, -385, 84, 300, 120, 30, 36, [236, 228, 210]);
    box(g, 380, 0, -300, 120, 60, 80, [226, 218, 200]);
    fru(g, 380, 60, -300, 60, 0, 70, 8, [110, 124, 130]);
  }

  function buildLondon(g) {
    /* 빅벤 */
    box(g, 0, 0, 0, 46, 172, 46, [216, 190, 148], 0, true);
    box(g, 0, 150, 0, 52, 30, 52, [244, 242, 232], 0, true);
    fru(g, 0, 180, 0, 34, 0, 76, 4, [92, 118, 96], Math.PI / 4, true);
    box(g, -70, 0, 0, 96, 60, 60, [206, 182, 142]);
    /* 런던아이 (관람차) */
    var cxw = 330, cyw = 130, czw = 180, RW = 118;
    for (var i = 0; i < 20; i++) {
      var a = i / 20 * TAU;
      box(g, cxw, cyw + Math.cos(a) * RW - 6, czw + Math.sin(a) * RW,
          14, 14, 14, [228, 234, 240], 0, true);
    }
    box(g, cxw, 0, czw - 46, 16, cyw, 16, [190, 198, 206]);
    box(g, cxw, 0, czw + 46, 16, cyw, 16, [190, 198, 206]);
  }

  function buildNewYork(g) {
    /* 자유의 여신상 */
    fru(g, 0,   0, 0, 82, 66, 56, 8, [176, 166, 150], 0, true);
    fru(g, 0,  56, 0, 46, 34, 40, 8, [162, 152, 138], 0, true);
    fru(g, 0,  96, 0, 27, 16, 96, 8, [116, 190, 168], 0, true);
    box(g, 0, 192, 0, 20, 22, 20, [116, 190, 168], 0, true);
    fru(g, 0, 214, 0, 15,  9, 12, 9, [128, 200, 178], 0, true);
    box(g, 22, 150, 0, 12, 96, 12, [116, 190, 168], 0.25, true);   /* 든 팔 */
    fru(g, 26, 246, 0, 11, 4, 20, 8, [240, 210, 120], 0, true);    /* 횃불 */
    /* 엠파이어스테이트 느낌의 마천루 */
    box(g, -420, 0, -260, 90, 300, 90, [156, 166, 180], 0, true);
    box(g, -420, 300, -260, 58, 90, 58, [166, 176, 190], 0, true);
    fru(g, -420, 390, -260, 12, 1, 70, 6, [200, 206, 214], 0, true);
    box(g, 400, 0, -320, 76, 250, 76, [170, 178, 192], 0.3, true);
  }

  /* --- 양파 모양 지붕 (모스크바·타지마할에 씁니다) --- */
  function onion(g, x, y, z, r, h, c, tip) {
    fru(g, x, y,              z, r * 0.60, r,        h * 0.34, 10, c, 0, true);
    fru(g, x, y + h * 0.34,   z, r,        r * 0.16, h * 0.52, 10, c, 0, true);
    fru(g, x, y + h * 0.86,   z, r * 0.18, r * 0.26, h * 0.07,  8, tip, 0, true);
    fru(g, x, y + h * 0.93,   z, r * 0.10, 0,        h * 0.24,  6, tip, 0, true);
  }

  function buildBeijing(g) {
    /* 천단 — 파란 지붕이 세 겹 */
    var wh = [240, 234, 220], blue = [56, 106, 168], gold = [232, 196, 96];
    fru(g, 0,   0, 0, 156, 146, 22, 18, [228, 220, 204], 0, true);
    fru(g, 0,  22, 0, 118, 108, 26, 18, wh,   0, true);
    fru(g, 0,  48, 0, 124,  22, 42, 18, blue, 0, true);
    fru(g, 0,  90, 0,  88,  82, 22, 18, wh,   0, true);
    fru(g, 0, 112, 0,  92,  18, 36, 18, blue, 0, true);
    fru(g, 0, 148, 0,  62,  56, 20, 18, wh,   0, true);
    fru(g, 0, 168, 0,  66,  10, 32, 18, blue, 0, true);
    fru(g, 0, 200, 0,  10,   2, 28,  8, gold, 0, true);

    /* 만리장성 — 구불구불 이어지는 성벽과 망루 */
    var n = 24, prev = null, stone = [188, 180, 166];
    for (var i = 0; i <= n; i++) {
      var t = i / n;
      var wx = -1050 + t * 2100, wz = 620 + Math.sin(t * 5.6) * 300;
      if (prev) {
        var dx = wx - prev[0], dz = wz - prev[1];
        box(g, (wx + prev[0]) / 2, 0, (wz + prev[1]) / 2,
            Math.hypot(dx, dz) + 8, 46, 34, stone, -Math.atan2(dz, dx), true);
      }
      if (i % 6 === 3) box(g, wx, 0, wz, 68, 86, 68, [176, 168, 152], 0, true);
      prev = [wx, wz];
    }
  }

  function buildAgra(g) {
    var wh = [246, 242, 234], gold = [228, 192, 98];
    box(g, 0, 0, 0, 470, 16, 470, [232, 226, 212]);
    box(g, 0, 16, 0, 252, 96, 252, wh, 0, true);
    /* 가운데 큰 돔 */
    fru(g, 0, 112, 0, 76, 88, 28, 16, wh, 0, true);
    fru(g, 0, 140, 0, 88, 58, 66, 16, wh, 0, true);
    fru(g, 0, 206, 0, 58,  8, 44, 12, wh, 0, true);
    fru(g, 0, 250, 0,  9,  1, 28,  8, gold, 0, true);
    /* 모서리의 작은 돔 4개 */
    [[-94,-94],[94,-94],[-94,94],[94,94]].forEach(function (o) {
      fru(g, o[0], 112, o[1], 26, 30, 16, 10, wh, 0, true);
      fru(g, o[0], 128, o[1], 30,  4, 30, 10, wh, 0, true);
    });
    /* 첨탑 4개 */
    [[-205,-205],[205,-205],[-205,205],[205,205]].forEach(function (o) {
      fru(g, o[0],   0, o[1], 17, 12, 168, 10, wh, 0, true);
      fru(g, o[0], 168, o[1], 21,  2,  30, 10, [232, 224, 208], 0, true);
    });
    rect(g, 0, 1.6, 470, 60, 520, [156, 200, 220], 0, 6);   /* 앞의 긴 연못 */
  }

  function buildDubai(g) {
    var s1 = [192, 206, 220], s2 = [168, 184, 202];
    fru(g, 0,   0, 0, 98, 66, 195, 6, s1, 0, true);
    fru(g, 0, 195, 0, 66, 44, 165, 6, s2, 0, true);
    fru(g, 0, 360, 0, 44, 26, 150, 6, s1, 0, true);
    fru(g, 0, 510, 0, 26, 12, 120, 6, s2, 0, true);
    fru(g, 0, 630, 0, 12,  2, 155, 6, [224, 232, 240], 0, true);
    box(g, -330, 0,  250, 82, 300, 82, [172, 186, 202], 0.3, true);
    box(g,  310, 0, -270, 72, 262, 72, [184, 198, 212], 0.6, true);
    disc(g, 0, 1.2, 760, 430, 18, [242, 226, 178], false, 6);   /* 백사장 */
  }

  function buildMoscow(g) {
    var wall = [234, 226, 212], gold = [244, 206, 96];
    box(g, 0, 0, 0, 290, 62, 290, wall, 0, true);
    onion(g, 0, 62, 0, 46, 155, [198, 70, 64], gold);
    var off  = [[-98,-98],[98,-98],[-98,98],[98,98],[0,-146],[0,146]];
    var cols = [[70,140,196],[96,168,104],[228,196,86],[196,108,178],[228,120,72],[240,238,232]];
    off.forEach(function (o, i) {
      box(g, o[0], 62, o[1], 58, 46, 58, wall, 0, true);
      onion(g, o[0], 108, o[1], 31, 92, cols[i], gold);
    });
    /* 크렘린 붉은 성벽 */
    box(g, 0, 0, 340, 620, 34, 40, [176, 84, 72], 0, true);
    box(g, -300, 0, 340, 54, 96, 54, [166, 78, 68], 0, true);
    box(g,  300, 0, 340, 54, 96, 54, [166, 78, 68], 0, true);
  }

  function buildIstanbul(g) {
    var sand = [228, 200, 168], dome = [172, 166, 158], wh = [238, 232, 220];
    box(g, 0,  0, 0, 256, 78, 214, sand, 0, true);
    fru(g, 0, 78, 0, 102, 98, 26, 16, sand, 0, true);
    fru(g, 0,104, 0,  98, 20, 76, 16, dome, 0, true);
    fru(g, 0,180, 0,  10,  2, 26,  8, [224, 198, 122], 0, true);
    fru(g, -112, 78, 0, 62, 12, 48, 12, dome, 0, true);
    fru(g,  112, 78, 0, 62, 12, 48, 12, dome, 0, true);
    [[-152,-134],[152,-134],[-152,134],[152,134]].forEach(function (o) {
      fru(g, o[0],   0, o[1], 15, 11, 192, 10, wh, 0, true);
      fru(g, o[0], 192, o[1], 18,  0,  42, 10, dome, 0, true);
    });
  }

  function buildAthens(g) {
    var st = [240, 234, 218];
    box(g, 0,  0, 0, 340, 10, 200, [214, 206, 188]);
    box(g, 0, 10, 0, 314, 10, 174, [226, 218, 200]);
    box(g, 0, 20, 0, 288, 10, 148, st);
    var i;
    for (i = 0; i < 8; i++) {                      /* 앞뒤 기둥 8개씩 */
      var cx = -122 + i * 34.8;
      fru(g, cx, 30, -60, 11, 10, 76, 8, st, 0, true);
      fru(g, cx, 30,  60, 11, 10, 76, 8, st, 0, true);
    }
    for (i = 1; i <= 3; i++) {                     /* 옆줄 기둥 */
      fru(g, -122, 30, -60 + i * 30, 11, 10, 76, 8, st, 0, true);
      fru(g,  122, 30, -60 + i * 30, 11, 10, 76, 8, st, 0, true);
    }
    box(g, 0, 106, 0, 300, 20, 160, st, 0, true);
    box(g, 0, 126, 0, 250, 14, 128, [228, 220, 202], 0, true);
    box(g, 0, 140, 0, 170, 12,  90, [216, 208, 190], 0, true);
    box(g, 0, 152, 0,  92, 10,  50, [204, 196, 178], 0, true);
  }

  var SF_Z = 1000;                 /* 다리는 섬 북쪽의 해협 위에 놓습니다 */

  function buildSF(g) {
    var red = [201, 74, 54], deck = [178, 180, 184];
    var i, t, x, y;
    /* 섬을 가르는 바닷길 */
    rect(g, 0, 1.2, 1330, 680, 2140, [38, 108, 172], 0, 6);
    /* 다리 상판 */
    for (i = 0; i < 26; i++) {
      x = -780 + (i / 25) * 1560;
      box(g, x, 96, SF_Z, 66, 10, 92, deck, 0, true);
    }
    /* 붉은 탑 두 개 */
    [-330, 330].forEach(function (tx) {
      box(g, tx,   0, SF_Z - 32, 42, 300, 42, red, 0, true);
      box(g, tx,   0, SF_Z + 32, 42, 300, 42, red, 0, true);
      box(g, tx, 186, SF_Z, 42, 20, 106, red, 0, true);
      box(g, tx, 262, SF_Z, 42, 20, 106, red, 0, true);
    });
    /* 늘어진 주 케이블 */
    for (i = 0; i <= 30; i++) {
      t = i / 30; x = -780 + t * 1560;
      if (x <= -330)     y = 300 - Math.pow((x + 330) / 450, 2) * 190;
      else if (x >= 330) y = 300 - Math.pow((x - 330) / 450, 2) * 190;
      else               y = 160 + Math.pow(x / 330, 2) * 140;
      box(g, x, y, SF_Z - 32, 56, 9, 9, red, 0, true);
      box(g, x, y, SF_Z + 32, 56, 9, 9, red, 0, true);
    }
    /* 언덕 위의 동네 */
    fru(g, -680, 0, 300, 300, 170, 96, 10, [128, 168, 100], 0, true);
    fru(g,  700, 0, 240, 260, 150, 84, 10, [118, 160, 94],  0, true);
  }

  function buildRio(g) {
    var stone = [214, 212, 208];
    fru(g, 0, 0, 0, 350, 120, 255, 12, [86, 132, 78], 0, true);   /* 코르코바두 산 */
    box(g, 0, 255, 0, 78, 46, 78, [186, 184, 180], 0, true);
    box(g, 0, 301, 0, 34, 122, 26, stone, 0, true);
    box(g, 0, 378, 0, 200, 20, 22, stone, 0, true);               /* 활짝 편 두 팔 */
    box(g, 0, 423, 0, 24, 26, 22, stone, 0, true);
    fru(g, 640, 0, -340, 200, 92, 240, 10, [96, 128, 84], 0, true); /* 슈가로프산 */
    rect(g, -520, 1.6, 520, 900, 260, [244, 228, 180], 0.5, 6);     /* 코파카바나 해변 */
  }

  function buildSingapore(g) {
    var col = [204, 212, 222], top = [230, 234, 240];
    [-185, 0, 185].forEach(function (x) {
      box(g, x, 0, 0, 74, 300, 116, col, 0, true);
      box(g, x, 0, 0, 30, 300, 120, [176, 190, 206], 0, true);
    });
    box(g, 0, 300, 0, 580, 26, 134, top, 0, true);            /* 배 모양 옥상 */
    box(g, 0, 326, 0, 470, 8, 84, [116, 192, 214], 0, true);  /* 하늘 수영장 */
    fru(g, 250, 334, 0, 20, 4, 60, 8, top, 0, true);
    /* 슈퍼트리 (커다란 나무 모양 탑) */
    for (var i = 0; i < 5; i++) {
      var tx = -300 + i * 150;
      fru(g, tx, 0, 420, 16, 26, 130, 8, [128, 148, 120], 0, true);
      fru(g, tx, 130, 420, 46, 8, 34, 8, [96, 168, 110], 0, true);
    }
  }

  function buildBangkok(g) {
    var wh = [242, 238, 228], gold = [230, 194, 96];
    fru(g, 0,   0, 0, 156, 128, 40, 12, [232, 226, 212], 0, true);
    fru(g, 0,  40, 0, 122,  92, 66, 12, wh, 0, true);
    fru(g, 0, 106, 0,  88,  54, 128, 12, wh, 0, true);
    fru(g, 0, 234, 0,  52,  20, 110, 12, wh, 0, true);
    fru(g, 0, 344, 0,  18,   3,  76,  8, gold, 0, true);
    [[-150,-150],[150,-150],[-150,150],[150,150]].forEach(function (o) {
      fru(g, o[0],   0, o[1], 46, 32, 64, 10, wh, 0, true);
      fru(g, o[0],  64, o[1], 32, 12, 76, 10, wh, 0, true);
      fru(g, o[0], 140, o[1], 10,  2, 44,  8, gold, 0, true);
    });
    /* 황금 불탑 */
    fru(g, 420, 0, 320, 60, 46, 40, 12, gold, 0, true);
    fru(g, 420, 40, 320, 46, 10, 90, 12, gold, 0, true);
  }

  function buildCapeTown(g) {
    var rock = [150, 134, 112];
    fru(g, 0,   0, 0, 660, 500, 300, 12, rock, 0, true);
    fru(g, 0, 300, 0, 500, 470,  70, 12, [162, 146, 124], 0, true);
    disc(g, 0, 371, 0, 468, 16, [128, 146, 104], true, 3);      /* 평평한 꼭대기 */
    fru(g, 620, 0, 520, 190, 90, 240, 10, [140, 126, 106], 0, true);  /* 라이언스 헤드 */
    /* 케이블카 줄 */
    for (var i = 0; i <= 12; i++) {
      var t = i / 12;
      box(g, 470 - t * 470, 60 + t * 310, 620 - t * 620, 26, 6, 6, [90, 92, 96], 0, true);
    }
  }

  function buildAmsterdam(g) {
    var water = [64, 118, 152];
    rect(g, 0, 1.2, -120, 1900, 100, water, 0, 6);       /* 운하 두 줄 */
    rect(g, 0, 1.2,  360, 1900, 100, water, 0, 6);
    /* 풍차 세 대 */
    [[-380, -420], [80, -470], [470, -400]].forEach(function (o, i) {
      fru(g, o[0], 0, o[1], 46, 28, 100, 8, [196, 156, 116], 0, true);
      fru(g, o[0], 100, o[1], 34, 0, 44, 8, [142, 92, 70], 0, true);
      box(g, o[0], 104, o[1] - 30, 200, 14, 10, [240, 236, 226], 0, true);   /* 가로 날개 */
      box(g, o[0], 14,  o[1] - 30,  14, 190, 10, [240, 236, 226], 0, true);  /* 세로 날개 */
    });
    /* 운하를 따라 늘어선 좁고 높은 집 */
    var cols = [[186,120,96],[150,104,90],[204,146,116],[132,96,86]];
    for (var i = 0; i < 22; i++) {
      var x = -760 + i * 72;
      var h = 76 + (i % 4) * 16;
      box(g, x, 0, 20, 56, h, 60, cols[i % 4], 0, true);
      fru(g, x, h, 20, 42, 0, 30, 4, [110, 84, 78], 0, true);
    }
    /* 다리 */
    box(g, -180, 22, -120, 44, 10, 150, [216, 208, 194], 0, true);
    box(g,  260, 22,  360, 44, 10, 150, [216, 208, 194], 0, true);
  }

  function buildBerlin(g) {
    var st = [230, 224, 212], i;
    /* 브란덴부르크 문 */
    for (i = 0; i < 6; i++) {
      fru(g, -125 + i * 50, 0,  0, 17, 15, 98, 8, st, 0, true);
      fru(g, -125 + i * 50, 0, 62, 17, 15, 98, 8, st, 0, true);
    }
    box(g, 0,  98, 31, 310, 32, 116, st, 0, true);
    box(g, 0, 130, 31,  76, 28,  38, [178, 170, 152], 0, true);   /* 네 마리 말 마차 */
    /* 텔레비전 탑 */
    fru(g, 480,   0, -340, 28, 15, 250, 12, [216, 220, 226], 0, true);
    fru(g, 480, 250, -340, 20, 48,  32, 14, [234, 238, 244], 0, true);   /* 공 아래 */
    fru(g, 480, 282, -340, 48, 18,  34, 14, [234, 238, 244], 0, true);   /* 공 위 */
    fru(g, 480, 316, -340, 14,  2, 140,  8, [204, 210, 218], 0, true);
  }

  function buildBarcelona(g) {
    var st = [232, 216, 186];
    box(g, 0, 0, 0, 270, 96, 190, st, 0, true);
    /* 뾰족한 탑들 — 가운데가 가장 높다 */
    var sp = [[-96,-64,190],[-34,-70,235],[34,-70,235],[96,-64,190],
              [-74, 66,215],[  0, 74,320],[ 74, 66,215]];
    sp.forEach(function (s) {
      fru(g, s[0], 96, s[1], 27, 5, s[2], 8, st, 0, true);
      fru(g, s[0], 96 + s[2], s[1], 9, 0, 30, 6, [228, 190, 96], 0, true);
    });
    box(g, 0, 96, 0, 120, 40, 120, [222, 204, 172], 0, true);
  }

  function buildToronto(g) {
    var c = [216, 220, 226];
    fru(g, 0,   0, 0, 42, 19, 336, 10, c, 0, true);
    fru(g, 0, 336, 0, 54, 54,  48, 12, [230, 234, 240], 0, true);   /* 전망대 */
    fru(g, 0, 384, 0, 42, 22,  44, 12, c, 0, true);
    fru(g, 0, 428, 0, 22, 22,  42, 10, [200, 206, 214], 0, true);
    fru(g, 0, 470, 0,  6,  1, 160,  6, c, 0, true);
    /* 받침 다리 세 개 */
    for (var i = 0; i < 3; i++) {
      var a = i / 3 * TAU;
      box(g, Math.cos(a) * 46, 0, Math.sin(a) * 46, 26, 120, 26, [196, 202, 210], -a, true);
    }
    /* 지붕 열리는 야구장 */
    fru(g, 340, 0, 280, 156, 148, 46, 16, [208, 208, 204], 0, true);
    fru(g, 340, 46, 280, 148,  24, 62, 16, [220, 220, 216], 0, true);
  }

  function buildMexico(g) {
    var st = [198, 166, 130], y = 0;
    [[250, 62], [204, 56], [158, 50], [112, 46], [66, 40]].forEach(function (l) {
      fru(g, 0, y, 0, l[0], l[0] * 0.85, l[1], 4, st, 0, true);
      y += l[1];
    });
    box(g, 0, y, 0, 62, 28, 62, [176, 146, 112], 0, true);
    /* 정면 계단 */
    for (var i = 0; i < 8; i++) {
      box(g, 0, i * 30, 250 - i * 26, 74, 30, 30, [184, 152, 118], 0, true);
    }
    /* 달의 피라미드 */
    var y2 = 0;
    [[170, 46], [132, 42], [92, 38]].forEach(function (l) {
      fru(g, -560, y2, -420, l[0], l[0] * 0.84, l[1], 4, st, 0, true);
      y2 += l[1];
    });
  }

  /* ======================= 도시 한 채 만들기 ============================= */

  function makeCity(c) {
    var r = rngFrom(c.seed);
    var g = G();

    /* 섬 : 모래 → 잔디 (아주 멀리서도 보이도록 lm = true) */
    disc(g, 0, 0.4, 0, 2250, 26, [236, 216, 158], true, 0);
    disc(g, 0, 0.9, 0, 2020, 26, c.grass, true, 4);

    /* 활주로 */
    rect(g, 0, 1.4, -1240, 1500, 130, [78, 80, 86], 0, 8);
    for (var m = -6; m <= 6; m++) rect(g, m * 100, 1.8, -1240, 52, 10, [235, 235, 230], 0, 12);
    rect(g, 0, 1.5, -1080, 1300, 26, [212, 206, 190], 0, 10);
    /* 터미널 + 관제탑 */
    box(g, -180, 0, -1010, 320, 46, 90, [226, 228, 232]);
    box(g,  120, 0, -1000, 40, 96, 40, [196, 200, 208]);
    box(g,  120, 96, -1000, 62, 26, 62, [128, 176, 214]);

    /* 랜드마크 */
    c.build(g);

    /* 일반 건물들 — 가운데(도심)일수록 높게 */
    var i, tries = 0;
    for (i = 0; i < 96 && tries < 700; tries++) {
      var a = r() * TAU, rad = 470 + Math.pow(r(), 0.72) * 1420;
      var x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      if (z < -880 && Math.abs(x) < 900) continue;          /* 공항 자리 비우기 */
      if (Math.abs(x) < 500 && Math.abs(z) < 500) continue; /* 랜드마크 자리 */
      if (c.noBuild && c.noBuild(x, z)) continue;           /* 도시마다 비워 둘 곳 */
      var w = 52 + r() * 96, d = 52 + r() * 96;
      var downtown = Math.max(0, 1 - rad / 1500);           /* 도심일수록 1 에 가까움 */
      var h = (30 + Math.pow(r(), 1.45) * (170 + downtown * 340)) * c.tall;
      var col = c.walls[(r() * c.walls.length) | 0];
      box(g, x, 0, z, w, h, d, col, r() * 1.57);
      if (r() < 0.5) box(g, x, h, z, w * 0.5, 10 + r() * 26, d * 0.5,
                         [col[0] * 0.84, col[1] * 0.84, col[2] * 0.84], 0);
      i++;
    }

    /* 나무 */
    for (i = 0; i < 46; i++) {
      var ta = r() * TAU, tr = 700 + r() * 1250;
      var tx = Math.cos(ta) * tr, tz = Math.sin(ta) * tr;
      if (tz < -880 && Math.abs(tx) < 900) continue;
      if (c.noBuild && c.noBuild(tx, tz)) continue;
      fru(g, tx, 0, tz, 4, 3, 16 + r() * 10, 5, [128, 100, 66]);
      fru(g, tx, 20, tz, 20 + r() * 12, 0, 34 + r() * 22, 6,
          [70 + r() * 40, 130 + r() * 40, 70 + r() * 20]);
    }
    return g;
  }

  /* ======================= 작은 무인도 ================================= */

  function makeIslets() {
    var r = rngFrom(9090), out = [], i, k;
    for (i = 0; i < 110; i++) {
      var x = (r() - 0.5) * SIZE, z = (r() - 0.5) * SIZE;
      if (Math.hypot(x, z) < 2600) continue;
      var g = G(), rad = 180 + r() * 380;
      disc(g, 0, 0.4, 0, rad, 14, [238, 220, 166], true, 0);
      disc(g, 0, 0.9, 0, rad * 0.8, 14, [122, 172, 96], true, 4);
      for (k = 0; k < 5 + (r() * 6 | 0); k++) {
        var a = r() * TAU, d = r() * rad * 0.6;
        var tx = Math.cos(a) * d, tz = Math.sin(a) * d;
        fru(g, tx, 0, tz, 4, 3, 14 + r() * 8, 5, [132, 102, 68]);
        fru(g, tx, 18, tz, 18 + r() * 12, 0, 30 + r() * 20, 6, [78, 142, 84]);
      }
      if (r() < 0.35) fru(g, 0, 0, 0, 90 + r() * 70, 20, 60 + r() * 70, 8, [140, 150, 130]);
      out.push({ x: x, z: z, geom: g });
    }
    return out;
  }

  /* =================================================================== *
   *  다른 교통기관 — 배 · 다른 비행기 · 열기구
   *  (유치원 '교통기관' 주제에 맞춰 하늘과 바다에 친구들을 띄웁니다)
   * =================================================================== */

  var SHIP = (function () {
    var g = G();
    box(g, 0,  0,   4, 34, 15, 108, [198,  68,  60]);   /* 배 몸통 */
    box(g, 0, 15,   6, 30,  7,  88, [238, 240, 242]);   /* 갑판 */
    box(g, 0, 22, -22, 24, 18,  30, [238, 240, 242]);   /* 조타실 */
    fru(g, 0, 40, -24,  6,  5,  20, 8, [246, 196,  62]); /* 굴뚝 */
    box(g, 0, 15,  46, 16,  6,  22, [222, 226, 230]);   /* 뱃머리 */
    rect(g, 0, 0.6, -120, 34, 150, [214, 236, 248]);    /* 물살 자국 */
    return g;
  })();

  var JET = (function () {
    var g = G();
    box(g,   0,  0,   0, 14, 13,  86, [242, 244, 248]);   /* 동체 */
    box(g,   0,  2,  -4, 98,  4,  24, [230, 234, 240]);   /* 날개 */
    box(g,   0,  9, -34,  5, 24,  18, [ 72, 140, 214]);   /* 꼬리 날개 */
    box(g,   0,  9, -34, 40,  3,  12, [230, 234, 240]);
    box(g, -26, -6,   0, 11, 10,  22, [178, 186, 196]);   /* 엔진 */
    box(g,  26, -6,   0, 11, 10,  22, [178, 186, 196]);
    box(g,   0,  5,  10, 15,  4,  60, [ 72, 140, 214]);   /* 파란 줄무늬 */
    return g;
  })();

  var BALLOONS = [
    [[232, 88, 84],  [250, 210, 90]],
    [[92, 168, 226], [246, 246, 250]],
    [[124, 198, 120],[250, 154, 96]],
    [[196, 128, 220],[250, 232, 120]]
  ].map(function (pal) {
    var g = G();
    box(g, 0,  0, 0, 16, 13, 16, [148, 108,  66]);          /* 바구니 */
    fru(g, 0, 18, 0,  5, 30, 26, 10, pal[0]);
    fru(g, 0, 44, 0, 30, 27, 20, 10, pal[1]);
    fru(g, 0, 64, 0, 27,  5, 26, 10, pal[0]);
    return g;
  });

  function makeTraffic() {
    var r = rngFrom(7777), i, t = { ships: [], jets: [], balloons: [] };
    for (i = 0; i < 225; i++)
      t.ships.push({ x: (r() - 0.5) * SIZE, z: (r() - 0.5) * SIZE, y: 0,
                     a: r() * TAU, v: 5 + r() * 8 });
    for (i = 0; i < 56; i++)
      t.jets.push({ x: (r() - 0.5) * SIZE, z: (r() - 0.5) * SIZE, y: 620 + r() * 1700,
                    a: r() * TAU, v: 70 + r() * 70 });
    for (i = 0; i < 46; i++)
      t.balloons.push({ x: (r() - 0.5) * SIZE, z: (r() - 0.5) * SIZE, y: 260 + r() * 560,
                        a: r() * TAU, v: 3 + r() * 4, p: (r() * BALLOONS.length) | 0 });
    return t;
  }

  function wrapPos(v) { return ((v + SIZE / 2) % SIZE + SIZE) % SIZE - SIZE / 2; }

  /* ======================= 구름 ======================================== */

  function makeClouds() {
    var r = rngFrom(4242), out = [], i, k;
    for (i = 0; i < 620; i++) {
      var puffs = [], n = 4 + (r() * 4 | 0), base = 60 + r() * 110;
      for (k = 0; k < n; k++) {
        puffs.push({
          dx: (r() - 0.5) * base * 2.6,
          dy: (r() - 0.5) * base * 0.5,
          dz: (r() - 0.5) * base * 2.0,
          r: base * (0.55 + r() * 0.6)
        });
      }
      out.push({
        x: (r() - 0.5) * SIZE,
        y: 620 + r() * 1900,
        z: (r() - 0.5) * SIZE,
        a: 0.62 + r() * 0.3,
        puffs: puffs
      });
    }
    return out;
  }

  /* ======================= 준비 & 그리기 ================================ */

  var cities = [], islets = [], clouds = [], traffic = null;

  function init() {
    cities = CITY_DATA.map(function (c) {
      return {
        id: c.id, name: c.name, country: c.country, flag: c.flag,
        landmark: c.landmark, fact: c.fact, real: c.real,
        x: c.pos[0], z: c.pos[1],
        geom: makeCity(c)
      };
    });
    islets  = makeIslets();
    clouds  = makeClouds();
    traffic = makeTraffic();
  }

  /* 도형 하나를 렌더러에 넘긴다. ang 은 덩어리 전체를 돌리는 각도 */
  function emit(R, p, ox, oy, oz, ang) {
    var x = p.x, z = p.z;
    if (ang) {
      var ca = Math.cos(ang), sa = Math.sin(ang);
      x = p.x * ca + p.z * sa;
      z = -p.x * sa + p.z * ca;
    }
    x += ox; z += oz;
    var y = p.y + oy, rr = (p.r || 0) + (ang || 0);
    switch (p.t) {
      case 'box':  R.addBox(x, y, z, p.w, p.h, p.d, p.c, rr); break;
      case 'fru':  R.addFrustum(x, y, z, p.r0, p.r1, p.h, p.n, p.c, rr); break;
      case 'disc': R.addDisc(x, y, z, p.r0, p.n, p.c, p.b); break;
      case 'rect': R.addRect(x, y, z, p.w, p.d, p.c, rr, p.b); break;
    }
  }

  function drawGeom(R, geom, ox, oy, oz, level, ang) {
    for (var i = 0; i < geom.length; i++) {
      var p = geom[i];
      if (level === 2 && !p.lm) continue;         /* 아주 멀면 랜드마크만 */
      if (level === 1 && !(p.big || p.lm)) continue;
      emit(R, p, ox, oy, oz, ang);
    }
  }

  /* 움직이는 교통기관의 지금 위치 */
  function movedPos(o, t) {
    return [wrapPos(o.x + Math.sin(o.a) * o.v * t),
            wrapPos(o.z + Math.cos(o.a) * o.v * t)];
  }

  function drawFleet(R, camPos, list, geomOf, t, maxDist) {
    for (var i = 0; i < list.length; i++) {
      var o = list[i], p = movedPos(o, t);
      var dx = wrapDelta(p[0], camPos[0]), dz = wrapDelta(p[1], camPos[2]);
      if (Math.abs(dx) > maxDist || Math.abs(dz) > maxDist) continue;
      if (Math.hypot(dx, dz) > maxDist) continue;
      drawGeom(R, geomOf(o), camPos[0] + dx, o.y, camPos[2] + dz, 0, o.a);
    }
  }

  /* 이번 프레임에 보일 것들을 모두 렌더러에 담는다 */
  function collect(R, camPos, time) {
    var i, c, dx, dz, d;

    for (i = 0; i < cities.length; i++) {
      c = cities[i];
      dx = wrapDelta(c.x, camPos[0]); dz = wrapDelta(c.z, camPos[2]);
      d = Math.hypot(dx, dz);
      if (d > 16500) continue;
      var lv = d > 9000 ? 2 : (d > 4800 ? 1 : 0);
      drawGeom(R, c.geom, camPos[0] + dx, 0, camPos[2] + dz, lv, 0);
    }

    for (i = 0; i < islets.length; i++) {
      c = islets[i];
      dx = wrapDelta(c.x, camPos[0]); dz = wrapDelta(c.z, camPos[2]);
      d = Math.hypot(dx, dz);
      if (d > 12000) continue;
      drawGeom(R, c.geom, camPos[0] + dx, 0, camPos[2] + dz, d > 4200 ? 1 : 0, 0);
    }

    drawFleet(R, camPos, traffic.ships,    function ()  { return SHIP; },      time, 7500);
    drawFleet(R, camPos, traffic.jets,     function ()  { return JET;  },      time, 9500);
    drawFleet(R, camPos, traffic.balloons, function (o) { return BALLOONS[o.p]; }, time, 6000);

    for (i = 0; i < clouds.length; i++) {
      c = clouds[i];
      dx = wrapDelta(c.x, camPos[0]); dz = wrapDelta(c.z, camPos[2]);
      if (Math.abs(dx) > 9000 || Math.abs(dz) > 9000) continue;
      var bx = camPos[0] + dx, bz = camPos[2] + dz;
      for (var k = 0; k < c.puffs.length; k++) {
        var q = c.puffs[k];
        R.addPuff(bx + q.dx, c.y + q.dy, bz + q.dz, q.r, [255, 255, 255], c.a);
      }
    }
  }

  return {
    SIZE: SIZE,
    init: init,
    collect: collect,
    wrapDelta: wrapDelta,
    cities: function () { return cities; }
  };
})();
