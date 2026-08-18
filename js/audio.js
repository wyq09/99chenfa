/* ============================================================
   audio.js —— Web Audio 合成音效 + 语音（文件优先 / TTS 兜底）
   - 音效用振荡器实时合成，零音频文件、零网络请求
   - 语音优先播放 audio/ 目录下的小花妖配音 mp3
     （manifest.json 由生成脚本产出，缺失的句子自动降级为
      Web Speech API 朗读，保证任何环境都有声音）
   - AudioContext / HTMLAudio 都遵循浏览器自动播放策略：
     首次用户手势时统一解锁
   - 音效/读题/BGM 三个开关，读取 Store 设置
   ============================================================ */
(function (global) {
  'use strict';

  var ctx = null;
  var masterGain = null;
  var bgmTimer = null;
  var bgmStep = 0;

  function settings() {
    try { return Store.get().settings; } catch (e) { return { sound: true, voice: true, music: false }; }
  }

  /* 首次交互时调用（浏览器要求用户手势后才能出声） */
  function unlock() {
    if (!ctx) {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (AC) {
        try {
          ctx = new AC();
          masterGain = ctx.createGain();
          masterGain.gain.value = 0.5;
          masterGain.connect(ctx.destination);
        } catch (e) { ctx = null; }
      }
    }
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(function () {});
    }
    unlockMedia();
  }

  /* 基础音符：频率/时长/波形/音量/延迟/滑音 */
  function tone(freq, dur, type, vol, delay, slideTo) {
    if (!ctx || !settings().sound) return;
    try {
      var t0 = ctx.currentTime + (delay || 0);
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
      }
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol || 0.25, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g); g.connect(masterGain);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    } catch (e) { /* 静默 */ }
  }

  /* ---------- 音效库 ---------- */
  var SFX = {
    click:   function () { tone(660, 0.08, 'triangle', 0.18); tone(880, 0.06, 'triangle', 0.12, 0.04); },
    correct: function () {
      tone(523.25, 0.12, 'triangle', 0.25);          // C5
      tone(659.25, 0.12, 'triangle', 0.25, 0.09);    // E5
      tone(783.99, 0.22, 'triangle', 0.28, 0.18);    // G5
    },
    wrong:   function () {
      tone(233, 0.25, 'sine', 0.2, 0, 180);          // 温和下行，不刺耳
      tone(180, 0.3, 'sine', 0.15, 0.16, 150);
    },
    combo:   function (n) {
      var base = 620 + Math.min(n, 8) * 60;
      for (var i = 0; i < 4; i++) {
        tone(base + i * 160, 0.09, 'square', 0.07, i * 0.05);
      }
    },
    star:    function () {
      tone(1568, 0.1, 'sine', 0.2);
      tone(2093, 0.16, 'sine', 0.18, 0.07);
      tone(2637, 0.22, 'sine', 0.12, 0.14);
    },
    coin:    function () {
      tone(988, 0.07, 'square', 0.12);
      tone(1319, 0.22, 'square', 0.12, 0.07);
    },
    heart:   function () { tone(140, 0.18, 'sine', 0.25, 0, 90); },
    tick:    function () { tone(1046, 0.05, 'square', 0.08); },
    timeUp:  function () { tone(392, 0.15, 'sawtooth', 0.12); tone(311, 0.3, 'sawtooth', 0.12, 0.12); },
    flip:    function () { tone(440, 0.06, 'triangle', 0.14, 0, 880); },
    pop:     function () { tone(880, 0.06, 'sine', 0.16, 0, 1320); },
    hop:     function () { tone(500, 0.14, 'sine', 0.2, 0, 900); },
    win:     function () {
      var seq = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
      for (var i = 0; i < seq.length; i++) {
        tone(seq[i], i === seq.length - 1 ? 0.5 : 0.16, 'triangle', 0.25, i * 0.14);
      }
      tone(261.6, 1.0, 'sine', 0.1, 0);
      tone(329.6, 1.0, 'sine', 0.08, 0.28);
    },
    fail:    function () {
      tone(392, 0.25, 'sine', 0.16);
      tone(349, 0.25, 'sine', 0.16, 0.2);
      tone(330, 0.45, 'sine', 0.14, 0.4);
    },
    levelup: function () {
      tone(523, 0.1, 'square', 0.14);
      tone(659, 0.1, 'square', 0.14, 0.08);
      tone(784, 0.1, 'square', 0.14, 0.16);
      tone(1047, 0.3, 'square', 0.16, 0.24);
    }
  };

  function play(name, arg) {
    if (!settings().sound) return;
    unlock();
    if (!ctx) return;
    var fn = SFX[name];
    if (fn) { try { fn(arg); } catch (e) {} }
  }

  /* ---------- 简易 BGM：轻快琶音循环（默认关闭，设置里可开） ---------- */
  var BGM_NOTES = [261.6, 329.6, 392, 523.25, 392, 329.6, 293.7, 349.2, 440, 587.3, 440, 349.2];
  function bgmTick() {
    if (!ctx || !settings().music) { stopBGM(); return; }
    var f = BGM_NOTES[bgmStep % BGM_NOTES.length];
    bgmStep++;
    try {
      var t0 = ctx.currentTime;
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.06, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
      osc.connect(g); g.connect(masterGain);
      osc.start(t0); osc.stop(t0 + 0.36);
    } catch (e) {}
  }
  function startBGM() {
    if (bgmTimer || !settings().music) return;
    unlock();
    if (!ctx) return;
    bgmTimer = setInterval(bgmTick, 340);
  }
  function stopBGM() {
    if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; }
  }
  function syncBGM() {
    if (settings().music) startBGM(); else stopBGM();
  }

  /* ============================================================
     语音引擎：优先播放预生成的小花妖 mp3，缺失时降级 Web Speech
     - 主路径：fetch + decodeAudioData + BufferSource
       AudioContext 在首次手势中 resume 后，异步解码仍能出声
       （HTMLAudio.play() 在手势过期后会被自动播放策略拦截）
     - 兜底：同一个 <audio> 元素换 src（iOS 解锁不能跨元素传递）
     manifest.json: { files: { "q_3x4": "q_3x4.mp3", ... } }
     ============================================================ */

  var manifest = null;
  var manifestReq = null;
  var voiceToken = 0;      /* 序列令牌：新语音开始时作废旧的序列 */
  var voiceEl = null;
  var currentSrc = null;
  var bufCache = {};
  var bufOrder = [];
  var SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

  function loadManifest() {
    if (manifestReq) return manifestReq;
    manifestReq = new Promise(function (resolve) {
      try {
        var xhr = new XMLHttpRequest();
        /* 时间戳参数：清单内容会随配音更新而变化，mp3 文件本身按 key 唯一可长缓存，
           但清单必须每次拿到最新，避免浏览器/中间层缓存旧版导致新句子哑音 */
        xhr.open('GET', 'audio/manifest.json?v=' + Date.now(), true);
        xhr.onload = function () {
          try {
            var m = JSON.parse(xhr.responseText);
            manifest = (m && m.files) ? m : null;
          } catch (e) { manifest = null; }
          if (!manifest) manifestReq = null;
          resolve(manifest);
        };
        xhr.onerror = function () { manifest = null; manifestReq = null; resolve(null); };
        xhr.send();
      } catch (e) { manifest = null; resolve(null); }
    });
    return manifestReq;
  }

  function hasVoiceFile(key) {
    return !!(manifest && manifest.files[key]);
  }

  function ensureVoiceEl() {
    if (voiceEl) return voiceEl;
    voiceEl = new global.Audio();
    voiceEl.preload = 'auto';
    voiceEl.playsInline = true;
    try { voiceEl.setAttribute('playsinline', ''); } catch (e) {}
    try { voiceEl.setAttribute('webkit-playsinline', ''); } catch (e) {}
    voiceEl.style.display = 'none';
    try { (document.body || document.documentElement).appendChild(voiceEl); } catch (e) {}
    return voiceEl;
  }

  /* iOS/微信：首次手势时用静音 wav 解锁「同一个」HTMLAudio */
  function unlockMedia() {
    if (unlockMedia._done) return;
    unlockMedia._done = true;
    try {
      var el = ensureVoiceEl();
      el.src = SILENT_WAV;
      var p = el.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
  }

  function stopCurrentSrc() {
    if (currentSrc) {
      try { currentSrc.onended = null; currentSrc.stop(); } catch (e) {}
      currentSrc = null;
    }
    if (voiceEl) {
      try { voiceEl.pause(); } catch (e) {}
    }
  }

  function stopVoiceAudio() {
    voiceToken++;
    stopCurrentSrc();
    try { global.speechSynthesis.cancel(); } catch (e) {}
  }

  function fetchArrayBuffer(url) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.responseType = 'arraybuffer';
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300 && xhr.response) resolve(xhr.response);
        else reject(new Error('http ' + xhr.status));
      };
      xhr.onerror = function () { reject(new Error('network')); };
      xhr.send();
    });
  }

  function decodeAb(ab) {
    return new Promise(function (resolve, reject) {
      if (!ctx) { reject(new Error('no ctx')); return; }
      var settled = false;
      function ok(buf) { if (!settled) { settled = true; resolve(buf); } }
      function fail(err) { if (!settled) { settled = true; reject(err || new Error('decode')); } }
      try {
        var p = ctx.decodeAudioData(ab, ok, fail);
        if (p && typeof p.then === 'function') p.then(ok, fail);
      } catch (e) { fail(e); }
    });
  }

  function rememberBuf(key, buf) {
    bufCache[key] = buf;
    var i = bufOrder.indexOf(key);
    if (i >= 0) bufOrder.splice(i, 1);
    bufOrder.push(key);
    while (bufOrder.length > 24) {
      var old = bufOrder.shift();
      if (old !== key) delete bufCache[old];
    }
  }

  function loadBuffer(key, url) {
    if (bufCache[key]) return Promise.resolve(bufCache[key]);
    return fetchArrayBuffer(url).then(decodeAb).then(function (buf) {
      rememberBuf(key, buf);
      return buf;
    });
  }

  /* AudioContext 已 resume 后，异步解码仍可出声 */
  function playViaContext(key, url, tok) {
    if (!ctx) return Promise.resolve(false);
    if (ctx.state === 'suspended') {
      try { ctx.resume(); } catch (e) {}
    }
    /* 无用户手势时 start() 会挂起，resume 后突然出声，和欢迎语叠在一起 */
    if (!ctx || ctx.state === 'suspended') return Promise.resolve(false);
    return loadBuffer(key, url).then(function (buf) {
      if (tok !== voiceToken) return false;
      stopCurrentSrc();
      var src = ctx.createBufferSource();
      var g = ctx.createGain();
      g.gain.value = 1;
      src.buffer = buf;
      src.connect(g);
      g.connect(ctx.destination);
      currentSrc = src;
      return new Promise(function (resolve) {
        var settled = false;
        function done(ok) {
          if (settled) return;
          settled = true;
          if (currentSrc === src) currentSrc = null;
          resolve(ok);
        }
        src.onended = function () { done(true); };
        try { src.start(0); } catch (e) { done(false); return; }
        setTimeout(function () { done(true); }, Math.min(15000, buf.duration * 1000 + 400));
      });
    }).catch(function () { return false; });
  }

  /* 复用解锁过的同一个 audio 元素换 src */
  function playViaElement(url) {
    return new Promise(function (resolve) {
      var el = ensureVoiceEl();
      var settled = false;
      function done(ok) {
        if (settled) return;
        settled = true;
        el.onended = el.onerror = null;
        resolve(ok);
      }
      el.onended = function () { done(true); };
      el.onerror = function () { done(false); };
      try { el.src = url; el.load(); } catch (e) {}
      var p = el.play();
      if (p && p.catch) p.catch(function () { done(false); });
      setTimeout(function () { done(true); }, 15000);
    });
  }

  /* 播放单个文件片段，resolve(true)=播完 / resolve(false)=不可用 */
  function playFile(key) {
    return new Promise(function (resolve) {
      if (!hasVoiceFile(key)) { resolve(false); return; }
      var url = 'audio/' + manifest.files[key];
      var tok = voiceToken;
      playViaContext(key, url, tok).then(function (ok) {
        if (tok !== voiceToken) { resolve(false); return; }
        if (ok) { resolve(true); return; }
        playViaElement(url).then(function (ok2) { resolve(!!ok2 && tok === voiceToken); });
      });
    });
  }

  /* ---------- Web Speech 兜底（中文） ---------- */
  var voiceCache = null;
  function pickVoice() {
    if (voiceCache) return voiceCache;
    try {
      var vs = global.speechSynthesis.getVoices() || [];
      for (var i = 0; i < vs.length; i++) {
        if (/zh[-_](CN|Hans)/i.test(vs[i].lang)) { voiceCache = vs[i]; return voiceCache; }
      }
      for (var j = 0; j < vs.length; j++) {
        if (/^zh/i.test(vs[j].lang)) { voiceCache = vs[j]; return voiceCache; }
      }
    } catch (e) {}
    return null;
  }
  if ('speechSynthesis' in global) {
    try { global.speechSynthesis.onvoiceschanged = function () { voiceCache = null; pickVoice(); }; } catch (e) {}
  }

  function speakSegment(text, done) {
    if (!('speechSynthesis' in global)) { done(); return; }
    try {
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN';
      u.rate = 0.9;
      u.pitch = 1.15;
      u.volume = 1;
      var v = pickVoice();
      if (v) u.voice = v;
      var fin = false;
      function end() { if (!fin) { fin = true; done(); } }
      u.onend = end;
      u.onerror = end;
      global.speechSynthesis.speak(u);
      setTimeout(end, Math.max(2500, text.length * 350)); /* iOS 偶发不回调，超时保底 */
    } catch (e) { done(); }
  }

  function fallbackSpeak(text) {
    try { global.speechSynthesis.cancel(); } catch (e) {}
    speakSegment(text, function () {});
  }

  /* ---------- 对外语音接口 ----------
     say(key, text, opts)      单句：有文件播文件，否则读 text
     saySeq(parts, opts)       顺序拼接：parts=[{key,text},...]
     speakQuestion(a,b)        读题 "a 乘 b 等于几？"
     speakKouge(a,b)           口诀 "a 乘 b 等于 c"
     受 settings.voice 开关控制，opts.force 可跳过检查（点读场景） */
  function say(key, text, opts) {
    return saySeq([{ key: key, text: text }], opts);
  }

  function saySeq(parts, opts) {
    if (!settings().voice && !(opts && opts.force)) return Promise.resolve(false);
    /* 新一句立刻停掉旧的，避免欢迎语和解码中的读题叠播 */
    stopCurrentSrc();
    try { global.speechSynthesis.cancel(); } catch (e) {}
    var tok = ++voiceToken;
    var gap = opts && opts.gap != null ? opts.gap : 130;
    unlock();

    return loadManifest().then(function () {
      /* 完全没有配音文件：整段降级为一次朗读 */
      if (!manifest) {
        fallbackSpeak(parts.map(function (p) { return p.text; }).join('，'));
        return false;
      }
      return new Promise(function (resolve) {
        var i = 0;
        function next() {
          if (tok !== voiceToken) { resolve(false); return; }
          if (i >= parts.length) { resolve(true); return; }
          var part = parts[i++];
          if (hasVoiceFile(part.key)) {
            playFile(part.key).then(function (ok) {
              if (tok !== voiceToken) { resolve(false); return; }
              if (!ok) fallbackSpeak(part.text);
              setTimeout(next, ok ? gap : 300);
            });
          } else {
            try { global.speechSynthesis.cancel(); } catch (e) {}
            speakSegment(part.text, function () {
              if (tok !== voiceToken) { resolve(false); return; }
              setTimeout(next, 160);
            });
          }
        }
        next();
      });
    });
  }

  /* 题目朗读："3 乘 4 等于几？" */
  function speakQuestion(a, b) {
    return say('q_' + a + 'x' + b, a + ' 乘 ' + b + '，等于几？');
  }

  /* 口诀朗读："3 乘 4 等于 12" */
  function speakKouge(a, b) {
    return say('k_' + a + 'x' + b, a + ' 乘 ' + b + ' 等于 ' + (a * b), { force: true });
  }

  global.GameAudio = {
    unlock: unlock,
    play: play,
    speak: fallbackSpeak,          /* 兼容旧接口：纯 TTS 朗读动态长句 */
    say: say,
    saySeq: saySeq,
    speakQuestion: speakQuestion,
    speakKouge: speakKouge,
    stopVoice: stopVoiceAudio,
    startBGM: startBGM,
    stopBGM: stopBGM,
    syncBGM: syncBGM
  };

  /* 进页即拉清单，避免第一次点击还要等 XHR 才 play */
  loadManifest();
  document.addEventListener('WeixinJSBridgeReady', function () { unlock(); }, false);
})(window);
