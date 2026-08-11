/* ============================================================
   audio.js —— Web Audio 合成音效 + 语音朗读
   - 全部音效用振荡器实时合成，零音频文件、零网络请求
   - AudioContext 遵循浏览器自动播放策略：首次用户手势时解锁
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
      if (!AC) return;
      try {
        ctx = new AC();
        masterGain = ctx.createGain();
        masterGain.gain.value = 0.5;
        masterGain.connect(ctx.destination);
      } catch (e) { ctx = null; return; }
    }
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(function () {});
    }
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
    win:     function () {
      var seq = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
      for (var i = 0; i < seq.length; i++) {
        tone(seq[i], i === seq.length - 1 ? 0.5 : 0.16, 'triangle', 0.25, i * 0.14);
      }
      /* 和声垫底 */
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

  /* ---------- 语音朗读（Web Speech API，中文） ---------- */
  var voiceCache = null;
  function pickVoice() {
    if (voiceCache) return voiceCache;
    try {
      var vs = speechSynthesis.getVoices() || [];
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
    try { speechSynthesis.onvoiceschanged = function () { voiceCache = null; pickVoice(); }; } catch (e) {}
  }

  function speak(text, opts) {
    if (!settings().voice && !(opts && opts.force)) return;
    if (!('speechSynthesis' in global)) return;
    try {
      speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN';
      u.rate = 0.9;      // 稍慢，适合小朋友
      u.pitch = 1.15;    // 略高，更亲切
      u.volume = 1;
      var v = pickVoice();
      if (v) u.voice = v;
      speechSynthesis.speak(u);
    } catch (e) {}
  }

  /* 题目朗读："3 乘 4 等于几？" */
  function speakQuestion(a, b) {
    speak(a + ' 乘 ' + b + ' 等于几？');
  }

  global.GameAudio = {
    unlock: unlock,
    play: play,
    speak: speak,
    speakQuestion: speakQuestion,
    startBGM: startBGM,
    stopBGM: stopBGM,
    syncBGM: syncBGM
  };
})(window);
