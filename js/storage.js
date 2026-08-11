/* ============================================================
   storage.js —— 学习进度本地存储
   - localStorage 持久化（隐私模式等不可用时自动降级为内存）
   - 数据带版本号，便于将来迁移
   ============================================================ */
(function (global) {
  'use strict';

  var KEY = 'mul99_save_v1';

  var DEFAULTS = {
    version: 1,
    coins: 0,                 // 金币
    unlockedLevel: 1,         // 最高已解锁关卡 1~9
    buddy: 'rabbit',          // 学习伙伴
    levels: {},               // { '1': { stars, best, plays, wins } }
    wrongBook: [],            // 错题本 [{a, b, answer, picked, ts, count}]
    achievements: {},         // { novice:true, flash:true ... }
    stats: { answered: 0, correct: 0 },
    settings: { sound: true, voice: true, music: false }
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* 检测 localStorage 是否可用（隐私模式/禁用 Cookie 时可能抛错） */
  var memFallback = null;
  var usable = (function () {
    try {
      var t = '__mul99_test__';
      global.localStorage.setItem(t, '1');
      global.localStorage.removeItem(t);
      return true;
    } catch (e) {
      return false;
    }
  })();

  function isPlainObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  /* 类型安全合并：存档字段类型与默认值不一致时保留默认（防污染/防注入） */
  function deepMerge(base, extra) {
    var out = clone(base);
    if (!isPlainObj(extra)) return out;
    Object.keys(extra).forEach(function (k) {
      var b = out[k], e = extra[k];
      if (e === undefined) return;
      if (isPlainObj(b)) {
        if (isPlainObj(e)) out[k] = deepMerge(b, e);
      } else if (Array.isArray(b)) {
        if (Array.isArray(e)) out[k] = e;
      } else if (b === undefined || b === null) {
        out[k] = e;                 /* 未来新增字段：直接接受 */
      } else if (typeof b === typeof e) {
        out[k] = e;                 /* 原始类型：类型一致才接受 */
      }
    });
    return out;
  }

  var Store = {
    available: usable,
    _cache: null,

    load: function () {
      if (this._cache) return this._cache;
      var raw = null;
      if (usable) {
        try { raw = global.localStorage.getItem(KEY); } catch (e) { raw = null; }
      } else if (memFallback) {
        raw = memFallback;
      }
      var data = null;
      if (raw) {
        try { data = JSON.parse(raw); } catch (e) { data = null; }
      }
      this._cache = deepMerge(DEFAULTS, data);
      return this._cache;
    },

    save: function () {
      if (!this._cache) return;
      var raw;
      try { raw = JSON.stringify(this._cache); } catch (e) { return; }
      if (usable) {
        try { global.localStorage.setItem(KEY, raw); } catch (e) { /* 存储满等情况静默 */ }
      } else {
        memFallback = raw;
      }
    },

    get: function () { return this.load(); },

    update: function (fn) {
      /* 读-改-写前强制重读底层存储：
         防止多标签页同时游玩时，本页的过期缓存覆盖另一页刚保存的进度 */
      this._cache = null;
      var d = this.load();
      fn(d);
      this.save();
      return d;
    },

    reset: function () {
      this._cache = clone(DEFAULTS);
      if (usable) {
        try { global.localStorage.removeItem(KEY); } catch (e) {}
      }
      memFallback = null;
      this.save();
      return this._cache;
    }
  };

  global.Store = Store;
})(window);
