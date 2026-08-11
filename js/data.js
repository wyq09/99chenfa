/* ============================================================
   data.js —— 关卡配置 / 伙伴 / 题库生成
   教学设计：
   - 关卡 1~9 对应「N 的乘法」，难度递进（题量↑ 倒计时↓）
   - 低关混入已学内容做「螺旋复习」，高关混入交换律
   - 选择题干扰项生成策略：±N、±1、个位/十位颠倒、相邻口诀
     保证干扰项"像真的"，考查理解而非运气
   ============================================================ */
(function (global) {
  'use strict';

  /* 每关的 UI 素材图标（来自 ui/ 目录） */
  var LEVEL_ICONS = {
    1: 'ui/layer-carrot-icon.png',
    2: 'ui/layer-flower-icon.png',
    3: 'ui/layer-apple-icon.png',
    4: 'ui/layer-bee-icon.png',
    5: 'ui/layer-whale-icon.png',
    6: 'ui/layer-duck-icon.png',
    7: 'ui/layer-leaf-icon.png',
    8: 'ui/layer-rocket-icon.png',
    9: 'ui/layer-trophy-icon.png'
  };
  var LEVEL_EMOJI = { 1: '🥕', 2: '🌸', 3: '🍎', 4: '🐝', 5: '🐳', 6: '🦆', 7: '🍃', 8: '🚀', 9: '🏆' };

  /* 关卡表：time=每题秒数(0=不限时) count=题量 review=混入之前关卡的比例 */
  var LEVELS = [];
  for (var n = 1; n <= 9; n++) {
    LEVELS.push({
      no: n,
      name: n + ' 的乘法',
      icon: LEVEL_ICONS[n],
      emoji: LEVEL_EMOJI[n],
      count: n <= 2 ? 8 : n <= 6 ? 10 : 12,
      time: n <= 1 ? 0 : n <= 4 ? 25 : n <= 6 ? 20 : 15,
      hearts: 3,
      baseScore: 100,          // 每题基础分
      tools: { hint: 2, skip: 1, time: 1 },   // 每关初始道具
      reward: 30 + n * 10,     // 通关金币
      reviewRatio: n <= 2 ? 0 : 0.25          // 螺旋复习题比例
    });
  }

  var BUDDIES = [
    { id: 'rabbit', name: '小白兔',  img: 'ui/layer-white-rabbit.png',    emoji: '🐰', cheer: '蹦蹦跳，你真棒！' },
    { id: 'cat',    name: '小橘猫',  img: 'ui/layer-orange-cat.png',      emoji: '🐱', cheer: '喵喵喵，好厉害！' },
    { id: 'bear',   name: '小棕熊',  img: 'ui/layer-brown-bear.png',      emoji: '🐻', cheer: '熊熊给你点赞！' },
    { id: 'penguin',name: '小企鹅',  img: 'ui/layer-penguin.png',         emoji: '🐧', cheer: '滑滑滑，冲呀！' },
    { id: 'croc',   name: '小鳄鱼',  img: 'ui/layer-green-crocodile.png', emoji: '🐊', cheer: '嗷呜，答对啦！' },
    { id: 'lion',   name: '狮子王',  img: 'ui/layer-crowned-lion.png',    emoji: '🦁', cheer: '王者就是你！' }
  ];

  var ACHIEVEMENTS = [
    { id: 'first',  ico: '🌱', name: '小能手',   desc: '第一次通关' },
    { id: 'half',   ico: '🌟', name: '进步星',   desc: '通关 5 个关卡' },
    { id: 'master', ico: '👑', name: '乘法高手', desc: '通关全部 9 关' },
    { id: 'flash',  ico: '⚡', name: '闪电手',   desc: '单题 3 秒内答对' },
    { id: 'perfect',ico: '💯', name: '满分王',   desc: '一关全部答对' },
    { id: 'rich',   ico: '💰', name: '小富翁',   desc: '金币超过 500' },
    { id: 'book',   ico: '📖', name: '爱学习',   desc: '口诀表点读 10 次' },
    { id: 'comeback',ico:'💪', name: '不放弃',   desc: '错题改正 5 次' }
  ];

  /* ---------- 工具 ---------- */
  function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /* ---------- 干扰项生成 ---------- */
  function makeDistractors(a, b, answer) {
    var set = {};
    set[answer] = true;
    var pool = [];
    function push(v) {
      if (v > 0 && v <= 99 && !set[v]) { set[v] = true; pool.push(v); }
    }
    /* 常见错误来源（教学视角）：口诀背串行 / 加当成乘 / 数错 */
    push(answer + a); push(answer - a);
    push(answer + b); push(answer - b);
    push(a * (b + 1)); push(a * (b - 1));
    push((a + 1) * b); push((a - 1) * b);
    push(a + b);                    // 加法混淆
    push(answer + 1); push(answer - 1);
    push(answer + 10); push(answer - 10);
    push(answer + 2); push(answer - 2);
    /* 打乱后取前 3 个 */
    shuffle(pool);
    return pool.slice(0, 3);
  }

  /* ---------- 生成一关的题目 ----------
     主考题：n × (1~9) 随机抽取；
     复习题：从 < n 的关卡中抽取（螺旋复习）；
     高关卡混入交换律形式 b × n（b 显示在前） */
  function genQuestions(levelNo) {
    var cfg = LEVELS[levelNo - 1];
    var count = cfg.count;
    var reviewCount = Math.round(count * cfg.reviewRatio);
    var mainCount = count - reviewCount;

    var qs = [];
    var used = {};

    /* 第一题固定为简单题（建立信心）：n × 1 或 n × 2，不做交换 */
    var easyB = levelNo === 1 ? 1 : randInt(1, 2);
    qs.push(makeQuestion(levelNo, easyB));
    used[levelNo * 100 + easyB] = true;

    /* 主考题：b 覆盖 1~9 尽量均匀（排除已用的 easyB） */
    var bs = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9].filter(function (x) { return x !== easyB; }));
    var bi = 0;
    while (qs.length < mainCount) {
      var b = bs[bi % bs.length]; bi++;
      var a = levelNo;
      /* 3 关起有 40% 概率交换位置，考查交换律 */
      var swapped = levelNo >= 3 && Math.random() < 0.4;
      var fa = swapped ? b : a, fb = swapped ? a : b;
      var key = fa * 100 + fb;
      if (used[key]) continue;
      used[key] = true;
      qs.push(makeQuestion(fa, fb));
      if (bi > 40) break; /* 保险丝 */
    }

    /* 复习题 */
    var guard = 0;
    while (qs.length < count && levelNo > 1 && guard < 60) {
      guard++;
      var ra = randInt(1, levelNo - 1);
      var rb = randInt(1, 9);
      var key2 = ra * 100 + rb;
      if (used[key2]) continue;
      used[key2] = true;
      qs.push(makeQuestion(ra, rb));
    }

    /* 首题保持简单题不变，其余题目打乱顺序 */
    var rest = shuffle(qs.slice(1));
    return [qs[0]].concat(rest);
  }

  function makeQuestion(a, b) {
    var answer = a * b;
    var options = shuffle([answer].concat(makeDistractors(a, b, answer)));
    return {
      a: a, b: b, answer: answer,
      options: options,
      correctIndex: options.indexOf(answer)
    };
  }

  /* 翻卡片随机题 */
  function genFlashcard() {
    return makeQuestion(randInt(1, 9), randInt(1, 9));
  }

  /* 星级评定：全对=3星；失误≤2次=2星；其余通关=1星 */
  function calcStars(mistakes, total) {
    if (mistakes === 0) return 3;
    if (mistakes <= Math.max(1, Math.floor(total * 0.25))) return 2;
    return 1;
  }

  global.GameData = {
    LEVELS: LEVELS,
    BUDDIES: BUDDIES,
    ACHIEVEMENTS: ACHIEVEMENTS,
    genQuestions: genQuestions,
    genFlashcard: genFlashcard,
    calcStars: calcStars,
    randInt: randInt,
    shuffle: shuffle
  };
})(window);
