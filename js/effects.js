/* ============================================================
   effects.js —— Canvas 粒子特效
   星星爆炸 / 烟花 / 彩带 / 彩虹弧 / 金币雨
   单个全屏 canvas，rAF 驱动，闲置时自动暂停省电
   ============================================================ */
(function (global) {
  'use strict';

  var canvas, ctx, W, H, dpr;
  var particles = [];
  var running = false;
  var rafId = null;
  var reducedMotion = false;

  try {
    reducedMotion = global.matchMedia &&
      global.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {}

  var COLORS = ['#FF7BAC', '#FFC93C', '#7BC62D', '#4FA8E8', '#A06CD5', '#FFA940', '#FF6B6B'];

  function init() {
    canvas = document.getElementById('fx-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    resize();
    global.addEventListener('resize', resize);
  }

  function resize() {
    if (!canvas) return;
    dpr = Math.min(global.devicePixelRatio || 1, 2);
    W = global.innerWidth; H = global.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function ensureLoop() {
    if (running || !ctx) return;
    running = true;
    rafId = requestAnimationFrame(loop);
  }

  function loop() {
    if (!ctx) { running = false; return; }
    ctx.clearRect(0, 0, W, H);
    if (particles.length === 0) {
      running = false;
      return;
    }
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.life -= p.decay;
      if (p.life <= 0 || p.y > H + 60) { particles.splice(i, 1); continue; }
      p.vy += p.gravity;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.spin;
      draw(p);
    }
    rafId = requestAnimationFrame(loop);
  }

  function draw(p) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    switch (p.shape) {
      case 'star': drawStar(p.size); break;
      case 'rect': ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); break;
      case 'ring':
        ctx.strokeStyle = p.color; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(0, 0, p.size * (1.6 - p.life), 0, Math.PI * 2); ctx.stroke();
        break;
      default:
        ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawStar(r) {
    ctx.beginPath();
    for (var i = 0; i < 5; i++) {
      var a = (i * 4 * Math.PI) / 5 - Math.PI / 2;
      var x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.fill();
  }

  function burstAt(x, y, opts) {
    if (reducedMotion || !ctx) return;
    opts = opts || {};
    var n = opts.count || 18;
    var shapes = opts.shapes || ['star', 'dot'];
    for (var i = 0; i < n; i++) {
      var ang = (Math.PI * 2 * i) / n + Math.random() * 0.5;
      var speed = (opts.speed || 5) * (0.5 + Math.random() * 0.8);
      particles.push({
        x: x, y: y,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed - (opts.up || 1.5),
        gravity: 0.12,
        size: (opts.size || 10) * (0.6 + Math.random() * 0.8),
        color: opts.colors ? opts.colors[i % opts.colors.length]
                           : COLORS[Math.floor(Math.random() * COLORS.length)],
        shape: shapes[Math.floor(Math.random() * shapes.length)],
        rot: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.25,
        life: 1,
        decay: 0.015 + Math.random() * 0.015
      });
    }
    ensureLoop();
  }

  var FX = {
    init: init,

    /* 答对：选项处星星爆炸 */
    starBurst: function (x, y) {
      burstAt(x, y, { count: 22, shapes: ['star', 'dot', 'ring'], speed: 6, size: 12 });
    },

    /* 连击：彩虹色爆炸 */
    rainbowBurst: function (x, y) {
      burstAt(x, y, { count: 30, shapes: ['star', 'dot'], speed: 7.5, size: 11, colors: COLORS });
    },

    /* 通关：多轮烟花 */
    fireworks: function () {
      if (reducedMotion || !ctx) return;
      var shots = 6;
      for (var s = 0; s < shots; s++) {
        (function (k) {
          setTimeout(function () {
            var x = W * (0.15 + Math.random() * 0.7);
            var y = H * (0.15 + Math.random() * 0.4);
            burstAt(x, y, { count: 40, shapes: ['dot', 'star'], speed: 8, size: 9, up: 0 });
          }, k * 320);
        })(s);
      }
    },

    /* 彩带雨（从顶部落下） */
    confetti: function () {
      if (reducedMotion || !ctx) return;
      for (var i = 0; i < 80; i++) {
        particles.push({
          x: Math.random() * W,
          y: -20 - Math.random() * H * 0.3,
          vx: (Math.random() - 0.5) * 1.6,
          vy: 2 + Math.random() * 3,
          gravity: 0.02,
          size: 10 + Math.random() * 8,
          color: COLORS[i % COLORS.length],
          shape: 'rect',
          rot: Math.random() * Math.PI,
          spin: (Math.random() - 0.5) * 0.3,
          life: 1,
          decay: 0.004
        });
      }
      ensureLoop();
    },

    /* 金币飞散 */
    coinShower: function (x, y) {
      burstAt(x, y, {
        count: 16, shapes: ['dot'], speed: 5, size: 12,
        colors: ['#FFC93C', '#FFB800', '#FFE08A']
      });
    },

    /* 答错：小灰云噗 */
    puff: function (x, y) {
      burstAt(x, y, {
        count: 10, shapes: ['dot'], speed: 2.5, size: 14,
        colors: ['#CFC4BC', '#E4DCD5'], up: 0.5
      });
    },

    clear: function () { particles.length = 0; }
  };

  global.FX = FX;
})(window);
