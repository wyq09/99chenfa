/* ============================================================
   game.js —— 主逻辑 / 界面状态机
   屏幕：home / levels / learn / game / report + 结算/伙伴/设置弹窗
   健壮性设计（对抗性审查清单）：
   1. 计时器用时间戳计算，切后台不漂移；切后台自动暂停
   2. 答题输入锁，防止快速连点/双击穿透
   3. 所有图片带 emoji 降级（素材缺失也能玩）
   4. localStorage 异常已在 storage.js 兜底
   5. 离开游戏页必清计时器、取消朗读，防止幽灵回调
   6. 边界：第9关通关后"下一关"变"返回关卡"
   ============================================================ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var D = window.GameData;
  var A = window.GameAudio;
  var S = window.Store;

  /* ================= 通用工具 ================= */

  function toast(msg, ms) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.add('hidden'); }, ms || 1800);
  }

  /* 图片降级：加载失败换成 emoji */
  function guardImg(img, emoji) {
    img.addEventListener('error', function h() {
      img.removeEventListener('error', h);
      var span = document.createElement('span');
      span.textContent = emoji || '🎈';
      span.style.fontSize = (img.dataset.fbSize || '1.6em');
      span.style.lineHeight = '1';
      span.style.display = 'inline-flex';
      span.style.alignItems = 'center';
      span.style.justifyContent = 'center';
      span.style.minHeight = '1em';
      if (img.parentNode) img.parentNode.replaceChild(span, img);
    });
    return img;
  }
  function makeImg(src, emoji, cls) {
    var img = document.createElement('img');
    img.src = src;
    img.alt = emoji || '';
    if (cls) img.className = cls;
    guardImg(img, emoji);
    return img;
  }

  /* 元素中心点坐标（粒子定位用） */
  function centerOf(el) {
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  /* ================= 屏幕导航 ================= */

  var SCREENS = ['home', 'levels', 'learn', 'game', 'report'];
  var current = 'home';

  function show(name) {
    if (SCREENS.indexOf(name) < 0) return;
    /* 离开游戏页：停表、取消朗读（防幽灵回调） */
    if (current === 'game' && name !== 'game') {
      stopTimer();
      if ('speechSynthesis' in window) { try { speechSynthesis.cancel(); } catch (e) {} }
    }
    current = name;
    SCREENS.forEach(function (s) {
      $('screen-' + s).classList.toggle('active', s === name);
    });
    window.scrollTo(0, 0);
    if (name === 'home') renderHome();
    if (name === 'levels') renderLevels();
    if (name === 'report') renderReport();
  }

  /* ================= 主页 ================= */

  function renderHome() {
    var d = S.get();
    $('home-stars').textContent = totalStars(d);
    $('home-coins').textContent = d.coins;
    var next = Math.min(d.unlockedLevel, 9);
    $('start-sub').textContent = (d.unlockedLevel > 1 || (d.levels['1'] && d.levels['1'].stars))
      ? '继续第 ' + next + ' 关' : '从第 1 关开始';
    var buddy = buddyOf(d.buddy);
    var bi = $('home-buddy-img');
    bi.src = buddy.img;
    guardImg(bi, buddy.emoji);
    $('home-buddy-name').textContent = buddy.name;
  }

  function totalStars(d) {
    var sum = 0;
    for (var k in d.levels) sum += (d.levels[k].stars || 0);
    return sum;
  }
  function buddyOf(id) {
    for (var i = 0; i < D.BUDDIES.length; i++) {
      if (D.BUDDIES[i].id === id) return D.BUDDIES[i];
    }
    return D.BUDDIES[0];
  }

  /* 主页示例小卡片 */
  function renderMiniCards() {
    var samples = [
      { q: '2×5', a: 10 }, { q: '3×4', a: 12 }, { q: '6×3', a: 18 }, { q: '4×4', a: 16 }
    ];
    var box = $('mini-table');
    box.innerHTML = '';
    samples.forEach(function (s) {
      var c = document.createElement('div');
      c.className = 'mini-card';
      c.innerHTML = '<span>' + s.q + '</span><span class="ans">= ' + s.a + '</span>';
      box.appendChild(c);
    });
  }

  /* ================= 关卡选择 ================= */

  function renderLevels() {
    var d = S.get();
    $('levels-coins').textContent = d.coins;
    var grid = $('level-grid');
    grid.innerHTML = '';
    D.LEVELS.forEach(function (lv) {
      var st = d.levels[String(lv.no)];
      var locked = lv.no > d.unlockedLevel;
      var card = document.createElement('button');
      card.className = 'level-card' + (locked ? ' locked' : '');
      card.setAttribute('aria-label', lv.name + (locked ? '，未解锁' : ''));

      var no = document.createElement('span');
      no.className = 'lv-no';
      no.textContent = '第 ' + lv.no + ' 关';
      card.appendChild(no);

      if (locked) {
        card.appendChild(makeImg('ui/layer-lock-icon.png', '🔒', 'lock'));
      } else {
        card.appendChild(makeImg(lv.icon, lv.emoji));
      }

      var nm = document.createElement('span');
      nm.className = 'lv-name';
      nm.textContent = lv.name;
      card.appendChild(nm);

      var stars = document.createElement('span');
      stars.className = 'lv-stars';
      var n = st ? st.stars : 0;
      stars.textContent = n > 0 ? '⭐'.repeat(n) + '☆'.repeat(3 - n) : (locked ? '' : '☆☆☆');
      card.appendChild(stars);

      if (st && st.stars > 0) {
        card.appendChild(makeImg('ui/layer-check-mark.png', '✅', 'lv-check'));
      }

      if (!locked) {
        card.addEventListener('click', function () {
          A.play('click');
          startGame(lv.no);
        });
      } else {
        card.addEventListener('click', function () {
          A.play('tick');
          toast('先通关前面的关卡，就能解锁啦！');
        });
      }
      grid.appendChild(card);
    });
  }

  /* ================= 游戏进行 ================= */

  var G = null; /* 当前对局状态 */

  function startGame(levelNo) {
    var cfg = D.LEVELS[levelNo - 1];
    var d = S.get();
    G = {
      cfg: cfg,
      level: levelNo,
      qs: D.genQuestions(levelNo),
      idx: 0,
      score: 0,
      combo: 0,
      mistakes: 0,
      hearts: cfg.hearts,
      tools: { hint: cfg.tools.hint, skip: cfg.tools.skip, time: cfg.tools.time },
      locked: false,       // 输入锁
      timerId: null,
      endAt: 0,            // 本题截止时刻戳
      pausedLeft: 0,       // 暂停时剩余毫秒
      qStartAt: 0,         // 本题开始时刻（闪电手判定）
      lastTickSec: -1,
      over: false
    };
    $('game-level-name').textContent = '第 ' + levelNo + ' 关 · ' + cfg.name;
    var buddy = buddyOf(d.buddy);
    var gi = $('game-buddy-img');
    gi.src = buddy.img;
    guardImg(gi, buddy.emoji);
    $('q-total').textContent = G.qs.length;
    $('game-score').textContent = '0';
    show('game');
    renderHearts();
    renderTools();
    nextQuestion();
  }

  function renderHearts() {
    var box = $('game-hearts');
    box.innerHTML = '';
    for (var i = 0; i < G.cfg.hearts; i++) {
      var img = makeImg('ui/layer-life-hearts.png', '❤️');
      img.dataset.fbSize = '1.4em';
      if (i >= G.hearts) img.classList.add('lost');
      box.appendChild(img);
    }
  }

  function renderTools() {
    $('count-hint').textContent = G.tools.hint;
    $('count-skip').textContent = G.tools.skip;
    $('count-time').textContent = G.tools.time;
    $('tool-hint').disabled = G.tools.hint <= 0;
    $('tool-skip').disabled = G.tools.skip <= 0;
    /* 不限时的关卡，加时道具直接禁用 */
    $('tool-time').disabled = G.tools.time <= 0 || G.cfg.time === 0;
  }

  function stopTimer() {
    if (G && G.timerId) { clearInterval(G.timerId); G.timerId = null; }
  }

  function nextQuestion() {
    if (!G || G.over) return;
    if (G.idx >= G.qs.length) { endGame(true); return; }

    var q = G.qs[G.idx];
    G.locked = false;
    G.qStartAt = Date.now();

    $('q-index').textContent = G.idx + 1;
    $('q-text').innerHTML = q.a + ' × ' + q.b + ' = <span class="blank">?</span>';
    $('q-hint-line').classList.add('hidden');
    $('q-card').classList.remove('shake', 'right');
    $('cheer-bubble').classList.add('hidden');

    var box = $('answers');
    box.innerHTML = '';
    q.options.forEach(function (opt, i) {
      var btn = document.createElement('button');
      btn.className = 'ans-btn';
      btn.textContent = opt;
      btn.dataset.idx = i;
      btn.addEventListener('click', function () { onAnswer(i, btn); });
      box.appendChild(btn);
    });

    startTimer();

    /* 自动读题（略延迟等界面稳定） */
    setTimeout(function () {
      if (current === 'game' && G && !G.over && S.get().settings.voice) {
        A.speakQuestion(q.a, q.b);
      }
    }, 350);
  }

  /* ---------- 计时器（时间戳法，抗后台漂移） ---------- */
  function startTimer() {
    stopTimer();
    var total = G.cfg.time;
    var wrap = $('timer-wrap');
    if (!total) { wrap.classList.add('no-timer'); return; }
    wrap.classList.remove('no-timer');

    G.endAt = Date.now() + total * 1000;
    G.lastTickSec = -1;
    updateTimerUI(total * 1000, total * 1000);

    G.timerId = setInterval(function () {
      if (!G || G.over) { stopTimer(); return; }
      var left = G.endAt - Date.now();
      updateTimerUI(left, total * 1000);
      if (left <= 0) {
        stopTimer();
        onTimeout();
      }
    }, 100);
  }

  function updateTimerUI(left, total) {
    left = Math.max(0, left);
    var pct = (left / total) * 100;
    var fill = $('timer-fill');
    var num = $('timer-num');
    fill.style.width = pct + '%';
    fill.className = 'timer-fill' + (pct <= 25 ? ' danger' : pct <= 50 ? ' warn' : '');
    var sec = Math.ceil(left / 1000);
    num.textContent = sec;
    num.classList.toggle('danger', sec <= 5);
    /* 最后 5 秒滴答提示音（每秒一次） */
    if (sec <= 5 && sec >= 1 && sec !== G.lastTickSec) {
      G.lastTickSec = sec;
      A.play('tick');
    }
  }

  /* 切后台自动暂停（对小朋友公平） */
  document.addEventListener('visibilitychange', function () {
    if (!G || G.over || current !== 'game' || !G.cfg.time) return;
    if (document.hidden) {
      if (G.timerId) {
        G.pausedLeft = Math.max(0, G.endAt - Date.now());
        stopTimer();
      }
    } else if (G.pausedLeft > 0 && !G.locked) {
      G.endAt = Date.now() + G.pausedLeft;
      G.pausedLeft = 0;
      stopTimer();
      G.timerId = setInterval(function () {
        if (!G || G.over) { stopTimer(); return; }
        var left = G.endAt - Date.now();
        updateTimerUI(left, G.cfg.time * 1000);
        if (left <= 0) { stopTimer(); onTimeout(); }
      }, 100);
    }
  });

  /* ---------- 答题 ---------- */

  function onAnswer(i, btn) {
    if (!G || G.locked || G.over) return;
    G.locked = true;
    stopTimer();

    var q = G.qs[G.idx];
    var btns = $('answers').children;
    for (var k = 0; k < btns.length; k++) btns[k].disabled = true;

    var correct = (i === q.correctIndex);
    var usedSec = (Date.now() - G.qStartAt) / 1000;

    if (correct) {
      handleCorrect(btn, usedSec, q);
    } else {
      handleWrong(btn, q, q.options[i]);
    }
  }

  function handleCorrect(btn, usedSec, q) {
    G.combo++;
    var bonus = Math.min(G.combo - 1, 5) * 25;
    var gained = G.cfg.baseScore + bonus;
    G.score += gained;
    $('game-score').textContent = G.score;

    btn.classList.add('correct');
    $('q-card').classList.add('right');

    var c = centerOf(btn);
    if (G.combo >= 3) {
      window.FX.rainbowBurst(c.x, c.y);
      A.play('combo', G.combo);
    } else {
      window.FX.starBurst(c.x, c.y);
      A.play('correct');
    }

    /* 连击提示 */
    if (G.combo >= 2) {
      $('combo-num').textContent = G.combo;
      $('combo-chip').classList.remove('hidden');
    }

    /* 闪电手成就：3 秒内答对 */
    if (usedSec <= 3) unlockAch('flash');

    /* 错题改正（ comeback 成就） */
    markWrongFixed(q.a, q.b);

    /* 伙伴加油 */
    buddyReact('jump');

    S.update(function (d) {
      d.stats.answered++;
      d.stats.correct++;
      if (d.stats.correct % 20 === 0) d.coins += 5; /* 每答对20题小奖励 */
    });

    setTimeout(function () {
      if (!G || G.over) return;
      G.idx++;
      nextQuestion();
    }, 950);
  }

  function handleWrong(btn, q, picked) {
    G.combo = 0;
    G.mistakes++;
    G.hearts--;
    $('combo-chip').classList.add('hidden');

    if (btn) btn.classList.add('wrong');
    $('q-card').classList.add('shake');
    A.play('wrong');
    A.play('heart');
    buddyReact('sad');

    /* 显示正确答案（教学：错误必须是学习机会） */
    var btns = $('answers').children;
    var correctBtn = btns[q.correctIndex];
    setTimeout(function () {
      if (correctBtn) correctBtn.classList.add('correct');
      var hint = $('q-hint-line');
      hint.textContent = '💡 ' + q.a + ' × ' + q.b + ' = ' + q.answer +
        '（' + groupText(q.a, q.b) + '）';
      hint.classList.remove('hidden');
    }, 350);

    /* 心碎动画 */
    renderHearts();
    var imgs = $('game-hearts').children;
    if (imgs[G.hearts]) imgs[G.hearts].classList.add('pop');

    if (btn) { var c = centerOf(btn); window.FX.puff(c.x, c.y); }

    recordWrong(q, picked);
    S.update(function (d) { d.stats.answered++; });

    if (S.get().settings.voice) {
      setTimeout(function () {
        A.speak('没关系，正确答案是 ' + q.answer);
      }, 500);
    }

    var died = G.hearts <= 0;
    setTimeout(function () {
      if (!G || G.over) return;
      if (died) { endGame(false); return; }
      G.idx++;
      nextQuestion();
    }, died ? 1600 : 1900);
  }

  function onTimeout() {
    if (!G || G.locked || G.over) return;
    G.locked = true;
    A.play('timeUp');
    var q = G.qs[G.idx];
    var btns = $('answers').children;
    for (var k = 0; k < btns.length; k++) btns[k].disabled = true;
    toast('⏰ 时间到啦！');
    handleWrong(null, q, null);
  }

  function groupText(a, b) {
    /* 教学解释：a × b = a 个 b 相加 */
    var parts = [];
    for (var i = 0; i < Math.min(a, 6); i++) parts.push(b);
    var s = parts.join(' + ');
    if (a > 6) s += ' + … ';
    return a + ' 个 ' + b + ' 相加：' + s;
  }

  function buddyReact(kind) {
    var img = $('game-buddy-img');
    img.classList.remove('jump', 'sad');
    void img.offsetWidth; /* 重启动画 */
    img.classList.add(kind);
    if (kind === 'jump') {
      var bubble = $('cheer-bubble');
      var cheers = [buddyOf(S.get().buddy).cheer, '太棒了！', '继续加油！', '你真聪明！', '好厉害呀！'];
      bubble.textContent = cheers[D.randInt(0, cheers.length - 1)];
      bubble.classList.remove('hidden');
    }
  }

  /* ---------- 道具 ---------- */

  function useHint() {
    if (!G || G.locked || G.over || G.tools.hint <= 0) return;
    var q = G.qs[G.idx];
    var btns = $('answers').children;
    /* 去掉两个错误选项 */
    var removed = 0;
    var order = D.shuffle([0, 1, 2, 3].filter(function (i) { return i !== q.correctIndex; }));
    for (var i = 0; i < order.length && removed < 2; i++) {
      var b = btns[order[i]];
      if (b && !b.classList.contains('eliminated')) {
        b.classList.add('eliminated');
        removed++;
      }
    }
    /* 显示加法提示（教学性提示，不只是删选项） */
    var hint = $('q-hint-line');
    hint.textContent = '💡 小提示：' + q.a + ' × ' + q.b + ' 就是 ' + q.a + ' 个 ' + q.b + ' 相加';
    hint.classList.remove('hidden');
    G.tools.hint--;
    renderTools();
    A.play('pop');
  }

  function useSkip() {
    if (!G || G.locked || G.over || G.tools.skip <= 0) return;
    G.tools.skip--;
    renderTools();
    A.play('flip');
    toast('🍃 跳过这题，不扣爱心');
    G.locked = true;
    stopTimer();
    setTimeout(function () {
      if (!G || G.over) return;
      G.idx++;
      nextQuestion();
    }, 500);
  }

  function useTime() {
    if (!G || G.locked || G.over || G.tools.time <= 0 || !G.cfg.time) return;
    G.tools.time--;
    G.endAt += 10000;
    renderTools();
    A.play('coin');
    toast('⏰ 加了 10 秒！');
  }

  /* ---------- 结束 ---------- */

  function endGame(win) {
    if (!G || G.over) return;
    G.over = true;
    stopTimer();
    if ('speechSynthesis' in window) { try { speechSynthesis.cancel(); } catch (e) {} }

    var stars = win ? D.calcStars(G.mistakes, G.qs.length) : 0;
    var coins = win ? (G.cfg.reward + stars * 10) : Math.floor(G.score / 100);

    var firstPass = false;
    S.update(function (d) {
      d.coins += coins;
      if (win) {
        var key = String(G.level);
        var st = d.levels[key] || { stars: 0, best: 0, plays: 0, wins: 0 };
        firstPass = st.stars === 0;
        st.stars = Math.max(st.stars, stars);
        st.best = Math.max(st.best, G.score);
        st.plays++;
        st.wins++;
        d.levels[key] = st;
        if (G.level < 9 && d.unlockedLevel < G.level + 1) {
          d.unlockedLevel = G.level + 1;
        }
      }
      checkAchievements(d, win, stars);
    });

    showResult(win, stars, coins, firstPass);
  }

  /* ---------- 结算弹窗 ---------- */

  function showResult(win, stars, coins, firstPass) {
    var panel = $('result-panel');
    panel.className = 'result-panel' + (win ? '' : ' fail');
    var html = '';

    if (win) {
      var lastLevel = G.level >= 9;
      html += '<div class="result-emoji">🎉</div>';
      html += '<div class="result-title win">太棒了！</div>';
      html += '<div class="result-sub">恭喜通关「' + G.cfg.name + '」</div>';
      html += '<div class="result-stars">';
      for (var i = 1; i <= 3; i++) {
        html += i <= stars ? '<span class="star-on">⭐</span>' : '<span class="star-off">⭐</span>';
      }
      html += '</div>';
      html += '<div class="result-score">得分 <span class="num">' + G.score + '</span></div>';
      html += '<div class="result-coins">🪙 +' + coins + ' 金币</div>';
      html += '<div class="result-btns">';
      if (!lastLevel) {
        html += '<button class="big-btn green small" id="r-next">▶ 下一关</button>';
      }
      html += '<button class="big-btn blue small" id="r-replay">🔄 再玩一次</button>';
      html += '<button class="big-btn purple small" id="r-back">🏠 返回关卡</button>';
      html += '</div>';
    } else {
      html += '<div class="result-emoji">💪</div>';
      html += '<div class="result-title fail">加油！</div>';
      html += '<div class="result-sub">差一点点就成功啦，再试一次吧！</div>';
      html += '<div class="result-score">本次得分 <span class="num">' + G.score + '</span></div>';
      html += '<div class="result-sub">小提示：先去「学习模式」练一练也很棒哦</div>';
      html += '<div class="result-btns">';
      html += '<button class="big-btn green small" id="r-replay">🔄 重新挑战</button>';
      html += '<button class="big-btn blue small" id="r-learn">📖 去学习</button>';
      html += '<button class="big-btn purple small" id="r-back">🏠 返回关卡</button>';
      html += '</div>';
    }

    panel.innerHTML = html;
    $('modal-result').classList.remove('hidden');

    if (win) {
      A.play('win');
      setTimeout(function () { A.play('star'); }, 300);
      setTimeout(function () { A.play('star'); }, 550);
      setTimeout(function () { A.play('coin'); }, 800);
      window.FX.fireworks();
      window.FX.confetti();
      if (S.get().settings.voice) {
        setTimeout(function () { A.speak('太棒了！恭喜通关！获得了 ' + stars + ' 颗星星！'); }, 400);
      }
    } else {
      A.play('fail');
      if (S.get().settings.voice) {
        setTimeout(function () { A.speak('加油！再试一次，你一定可以的！'); }, 300);
      }
    }

    var nextBtn = $('r-next');
    if (nextBtn) nextBtn.addEventListener('click', function () {
      A.play('click');
      closeResult();
      startGame(G.level + 1);
    });
    $('r-replay').addEventListener('click', function () {
      A.play('click');
      closeResult();
      startGame(G.level);
    });
    $('r-back').addEventListener('click', function () {
      A.play('click');
      closeResult();
      show('levels');
    });
    var learnBtn = $('r-learn');
    if (learnBtn) learnBtn.addEventListener('click', function () {
      A.play('click');
      closeResult();
      show('learn');
    });
  }

  function closeResult() {
    $('modal-result').classList.add('hidden');
    window.FX.clear();
  }

  /* ================= 错题本 & 成就 ================= */

  function recordWrong(q, picked) {
    S.update(function (d) {
      var key = q.a * 100 + q.b;
      var found = null;
      for (var i = 0; i < d.wrongBook.length; i++) {
        var w = d.wrongBook[i];
        if (w.a * 100 + w.b === key) { found = w; break; }
      }
      if (found) {
        found.count++;
        found.picked = picked;
        found.ts = Date.now();
      } else {
        d.wrongBook.unshift({ a: q.a, b: q.b, answer: q.answer, picked: picked, ts: Date.now(), count: 1 });
      }
      if (d.wrongBook.length > 20) d.wrongBook.length = 20;
    });
  }

  function markWrongFixed(a, b) {
    S.update(function (d) {
      var key = a * 100 + b;
      for (var i = d.wrongBook.length - 1; i >= 0; i--) {
        if (d.wrongBook[i].a * 100 + d.wrongBook[i].b === key) {
          d.wrongBook.splice(i, 1);
          d.stats.comeback = (d.stats.comeback || 0) + 1;
          if (d.stats.comeback >= 5) d.achievements.comeback = true;
          break;
        }
      }
    });
  }

  function unlockAch(id) {
    S.update(function (d) {
      if (!d.achievements[id]) {
        d.achievements[id] = true;
        var meta = null;
        for (var i = 0; i < D.ACHIEVEMENTS.length; i++) {
          if (D.ACHIEVEMENTS[i].id === id) meta = D.ACHIEVEMENTS[i];
        }
        if (meta) {
          setTimeout(function () {
            A.play('levelup');
            toast('🎖️ 获得徽章：' + meta.name + '！', 2400);
          }, 600);
        }
      }
    });
  }

  function checkAchievements(d, win, stars) {
    if (win) {
      d.achievements.first = true;
      var passed = 0;
      for (var k in d.levels) if (d.levels[k].stars > 0) passed++;
      if (passed >= 5) d.achievements.half = true;
      if (passed >= 9) d.achievements.master = true;
      if (stars === 3) d.achievements.perfect = true;
    }
    if (d.coins >= 500) d.achievements.rich = true;
    if ((d.stats.tableReads || 0) >= 10) d.achievements.book = true;
  }

  /* ================= 学习模式 ================= */

  var meanA = 3, meanB = 4;

  function renderMeanPicker() {
    var boxA = $('mean-a'), boxB = $('mean-b');
    boxA.innerHTML = ''; boxB.innerHTML = '';
    for (var n = 1; n <= 6; n++) {
      (function (num) {
        var b1 = document.createElement('button');
        b1.className = 'mean-num' + (num === meanA ? ' sel' : '');
        b1.textContent = num;
        b1.addEventListener('click', function () {
          meanA = num; A.play('click'); renderMeanPicker(); renderMeanVisual(true);
        });
        boxA.appendChild(b1);

        var b2 = document.createElement('button');
        b2.className = 'mean-num' + (num === meanB ? ' sel' : '');
        b2.textContent = num;
        b2.addEventListener('click', function () {
          meanB = num; A.play('click'); renderMeanPicker(); renderMeanVisual(true);
        });
        boxB.appendChild(b2);
      })(n);
    }
  }

  var MEAN_EMOJIS = ['🍎', '🍊', '🍓', '🐥', '🌸', '🐠'];
  function renderMeanVisual(speakIt) {
    var vis = $('mean-visual');
    var exp = $('mean-explain');
    vis.innerHTML = '';
    var emoji = MEAN_EMOJIS[(meanA + meanB) % MEAN_EMOJIS.length];
    var delay = 0;
    for (var g = 0; g < meanA; g++) {
      var grp = document.createElement('div');
      grp.className = 'mean-group';
      for (var i = 0; i < meanB; i++) {
        var it = document.createElement('span');
        it.className = 'mean-item';
        it.textContent = emoji;
        it.style.animationDelay = (delay += 0.06) + 's';
        grp.appendChild(it);
      }
      vis.appendChild(grp);
    }
    var parts = [];
    for (var p = 0; p < meanA; p++) parts.push(meanB);
    exp.innerHTML =
      '<div>' + meanA + ' 个 ' + meanB + ' 相加：' + parts.join(' + ') + ' = <b class="ans">' + (meanA * meanB) + '</b></div>' +
      '<div class="eq">所以 ' + meanA + ' × ' + meanB + ' = <b class="ans">' + (meanA * meanB) + '</b></div>';
    if (speakIt && S.get().settings.voice) {
      A.speak(meanA + ' 乘 ' + meanB + ' 等于 ' + (meanA * meanB) + '，就是 ' + meanA + ' 个 ' + meanB + ' 相加');
    }
  }

  function renderMulTable() {
    var box = $('mul-table');
    box.innerHTML = '';
    for (var row = 1; row <= 9; row++) {
      for (var col = 1; col <= 9; col++) {
        var cell = document.createElement('button');
        if (col <= row) {
          cell.className = 'mul-cell';
          cell.innerHTML = col + '×' + row + '<br>=' + (col * row);
          (function (a, b, el) {
            el.addEventListener('click', function () {
              A.play('pop');
              el.classList.remove('pulse');
              void el.offsetWidth;
              el.classList.add('pulse');
              el.classList.add('done');
              A.speak(a + ' 乘 ' + b + ' 等于 ' + (a * b), { force: true });
              S.update(function (d) {
                d.stats.tableReads = (d.stats.tableReads || 0) + 1;
                if (d.stats.tableReads >= 10) d.achievements.book = true;
              });
            });
          })(col, row, cell);
        } else {
          cell.className = 'mul-cell empty';
          cell.disabled = true;
        }
        box.appendChild(cell);
      }
    }
  }

  /* 翻卡片 */
  var flashQ = null, flashFlipped = false;
  function newFlashcard() {
    flashQ = D.genFlashcard();
    flashFlipped = false;
    $('flash-card').classList.remove('flipped');
    $('flash-front').textContent = flashQ.a + ' × ' + flashQ.b + ' = ?';
    $('flash-back').textContent = flashQ.answer;
    if (S.get().settings.voice) A.speakQuestion(flashQ.a, flashQ.b);
  }
  function flipFlashcard() {
    flashFlipped = !flashFlipped;
    $('flash-card').classList.toggle('flipped', flashFlipped);
    A.play('flip');
    if (flashFlipped && S.get().settings.voice) {
      A.speak(flashQ.a + ' 乘 ' + flashQ.b + ' 等于 ' + flashQ.answer);
    }
  }

  /* ================= 学习报告 ================= */

  function renderReport() {
    var d = S.get();

    /* 总览 */
    var stars = totalStars(d);
    var acc = d.stats.answered > 0 ? Math.round((d.stats.correct / d.stats.answered) * 100) : 0;
    $('report-overview').innerHTML =
      '<div class="ov-card"><div class="ov-num">' + stars + '</div><div class="ov-label">⭐ 星星</div></div>' +
      '<div class="ov-card"><div class="ov-num">' + d.coins + '</div><div class="ov-label">🪙 金币</div></div>' +
      '<div class="ov-card"><div class="ov-num">' + acc + '%</div><div class="ov-label">🎯 正确率</div></div>';

    /* 每关 */
    var lv = '';
    D.LEVELS.forEach(function (l) {
      var st = d.levels[String(l.no)];
      var n = st ? st.stars : 0;
      lv += '<div class="rp-level"><div>' + l.emoji + ' ' + l.name + '</div>' +
            '<div class="rp-stars">' + (n ? '⭐'.repeat(n) : '—') + '</div>' +
            '<div class="rp-best">' + (st && st.best ? '最高 ' + st.best + ' 分' : '还没挑战') + '</div></div>';
    });
    $('report-levels').innerHTML = lv;

    /* 徽章墙 */
    var bw = '';
    D.ACHIEVEMENTS.forEach(function (a) {
      var got = !!d.achievements[a.id];
      bw += '<div class="badge-item' + (got ? '' : ' locked') + '" title="' + a.desc + '">' +
            '<span class="b-ico">' + a.ico + '</span>' + a.name +
            '<br><small>' + (got ? '已获得' : a.desc) + '</small></div>';
    });
    $('badge-wall').innerHTML = bw;

    /* 错题本 */
    if (d.wrongBook.length === 0) {
      $('wrong-list').innerHTML = '<div class="empty-note">🎈 太厉害了，现在没有错题！</div>';
    } else {
      var wl = '';
      d.wrongBook.slice(0, 10).forEach(function (w) {
        wl += '<div class="wrong-item">' +
              '<span class="w-q">' + w.a + ' × ' + w.b + ' = </span>' +
              '<span class="w-a">' + w.answer + '</span>' +
              (w.picked != null ? '<span class="w-pick">选过 ' + w.picked + '</span>' : '<span class="w-pick">超时</span>') +
              '<span class="w-times">错 ' + w.count + ' 次</span></div>';
      });
      $('wrong-list').innerHTML = wl;
    }
  }

  /* ================= 伙伴选择 ================= */

  function renderBuddyGrid() {
    var d = S.get();
    var grid = $('buddy-grid');
    grid.innerHTML = '';
    D.BUDDIES.forEach(function (b) {
      var item = document.createElement('button');
      item.className = 'buddy-item' + (b.id === d.buddy ? ' sel' : '');
      item.appendChild(makeImg(b.img, b.emoji));
      var nm = document.createElement('span');
      nm.textContent = b.name;
      item.appendChild(nm);
      item.addEventListener('click', function () {
        A.play('click');
        S.update(function (dd) { dd.buddy = b.id; });
        renderBuddyGrid();
        A.speak('你好呀！我是' + b.name + '，' + b.cheer, { force: true });
      });
      grid.appendChild(item);
    });
  }

  /* ================= 设置 ================= */

  function syncSettingsUI() {
    var st = S.get().settings;
    setSwitch($('set-sound'), st.sound);
    setSwitch($('set-voice'), st.voice);
    setSwitch($('set-music'), st.music);
  }
  function setSwitch(el, on) {
    el.classList.toggle('on', !!on);
    el.setAttribute('aria-checked', on ? 'true' : 'false');
  }
  function bindSwitch(id, key) {
    $(id).addEventListener('click', function () {
      S.update(function (d) { d.settings[key] = !d.settings[key]; });
      syncSettingsUI();
      A.play('click');
      if (key === 'music') A.syncBGM();
    });
  }

  /* ================= 初始化绑定 ================= */

  function bind() {
    /* 首次任意交互解锁音频（浏览器自动播放策略） */
    var unlockOnce = function () {
      A.unlock();
      A.syncBGM();
      document.removeEventListener('pointerdown', unlockOnce);
    };
    document.addEventListener('pointerdown', unlockOnce);

    /* 主页 */
    $('btn-start').addEventListener('click', function () {
      A.play('click');
      startGame(Math.min(S.get().unlockedLevel, 9));
    });
    $('btn-levels').addEventListener('click', function () { A.play('click'); show('levels'); });
    $('btn-learn').addEventListener('click', function () { A.play('click'); show('learn'); });
    $('btn-report').addEventListener('click', function () { A.play('click'); show('report'); });
    $('btn-buddy').addEventListener('click', function () {
      A.play('click');
      renderBuddyGrid();
      $('modal-buddy').classList.remove('hidden');
    });
    $('btn-settings').addEventListener('click', function () {
      A.play('click');
      syncSettingsUI();
      $('modal-settings').classList.remove('hidden');
    });

    /* 返回按钮 */
    var backs = document.querySelectorAll('.back-btn[data-go]');
    for (var i = 0; i < backs.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          A.play('click');
          show(btn.dataset.go);
        });
      })(backs[i]);
    }

    /* 游戏内 */
    $('btn-quit-game').addEventListener('click', function () {
      A.play('click');
      if (G) G.over = true;   /* 阻止进行中的回调 */
      show('levels');
    });
    $('btn-speak').addEventListener('click', function () {
      if (!G || G.over) return;
      var q = G.qs[G.idx];
      if (q) A.speakQuestion(q.a, q.b);
    });
    $('tool-hint').addEventListener('click', useHint);
    $('tool-skip').addEventListener('click', useSkip);
    $('tool-time').addEventListener('click', useTime);

    /* 学习模式 tab */
    var tabs = document.querySelectorAll('.learn-tab');
    for (var t = 0; t < tabs.length; t++) {
      (function (tab) {
        tab.addEventListener('click', function () {
          A.play('click');
          for (var j = 0; j < tabs.length; j++) tabs[j].classList.remove('active');
          tab.classList.add('active');
          var panes = document.querySelectorAll('.learn-pane');
          for (var p = 0; p < panes.length; p++) panes[p].classList.remove('active');
          $('pane-' + tab.dataset.tab).classList.add('active');
        });
      })(tabs[t]);
    }

    /* 翻卡片 */
    $('flash-card').addEventListener('click', flipFlashcard);
    $('btn-flash-flip').addEventListener('click', flipFlashcard);
    $('btn-flash-next').addEventListener('click', function () { A.play('click'); newFlashcard(); });

    /* 伙伴弹窗 */
    $('btn-buddy-close').addEventListener('click', function () {
      A.play('click');
      $('modal-buddy').classList.add('hidden');
      renderHome();
    });

    /* 设置弹窗 */
    bindSwitch('set-sound', 'sound');
    bindSwitch('set-voice', 'voice');
    bindSwitch('set-music', 'music');
    $('btn-settings-close').addEventListener('click', function () {
      A.play('click');
      $('modal-settings').classList.add('hidden');
      renderHome();
    });

    /* 清空记录：两步确认，防误触 */
    $('set-reset').addEventListener('click', function () {
      var btn = $('set-reset');
      if (btn.dataset.arm === '1') {
        S.reset();
        btn.textContent = '清空';
        delete btn.dataset.arm;
        syncSettingsUI();
        renderHome();
        toast('已清空学习记录，重新开始冒险吧！');
        $('modal-settings').classList.add('hidden');
      } else {
        btn.dataset.arm = '1';
        btn.textContent = '再点一次确认';
        setTimeout(function () {
          if (btn.dataset.arm === '1') { btn.textContent = '清空'; delete btn.dataset.arm; }
        }, 3000);
      }
    });

    /* 静态图片统一挂降级 */
    guardImg($('home-logo'), '🎡');
    guardImg($('home-buddy-img'), '🐰');
    guardImg($('game-buddy-img'), '🐰');
  }

  /* ================= 启动 ================= */

  function boot() {
    window.FX.init();
    bind();
    renderMiniCards();
    renderMeanPicker();
    renderMeanVisual(false);
    renderMulTable();
    newFlashcard();
    renderHome();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
