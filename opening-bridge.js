/* =============================================================
 * 开场动画接驳层
 * 作用：接管 Phigros 模拟器原来的 #loading-screen，
 *       用原版的「三角网格 → 白屏 → 褪出」动画替换它。
 *
 * 设计原则：
 *   1. 不修改 main.js，不覆盖它的任何函数
 *   2. 保留 #loading-screen 的全部 id / class，main.js 的查询不会失败
 *   3. 用 MutationObserver 监听「加载页要被隐藏」的时机，
 *      拦截这次隐藏，改为播放开场动画，播完再真正隐藏
 *   4. 若 8 秒内 main.js 始终没触发隐藏（例如加载失败），
 *      自动接管，避免永远卡在加载页
 * ============================================================= */
(function () {
  'use strict';

  /* ---------------- 可调参数 ---------------- */
  var CONFIG = {
    // 原版加载页最短展示时间（秒）。
    // 这是「黑屏 + ORBIT 呼吸」的时长，然后才进网格升起。
    // 越小，进入动画越快；0.6 左右就不会显得黑屏太久。
    minimumLoading: 0.6,

    // 后景界面淡入的关键时间点（秒，从动画开始算）
    // revealStartsAt：网格升起到这个时刻，界面淡入到 75%（白屏会遮住）
    // revealFullAt  ：到这个时刻界面完全显示（此时仍被白屏盖着，褪去即露出）
    revealStartsAt: 1.68,    // = GRID_TRANSITION.duration
    revealFullAt: 2.60,      // 白屏完全铺满之前
    // 是否监听 main.js 的隐藏动作（false 则加载完立刻播放）
    waitForMain: true,
    // 兜底：多少秒后强制开始动画（毫秒），设 0 关闭
    fallbackAfter: 8000,
    // 动画结束后回调
    onComplete: null
  };

  var loadingScreen = document.getElementById('loading-screen');
  if (!loadingScreen) {
    console.warn('[开场动画] 未找到 #loading-screen，跳过');
    return;
  }
  if (!window.OrgOpening) {
    console.warn('[开场动画] opening-original.js 未加载，跳过');
    return;
  }

  /* ---------------- 把原加载页改造成动画容器 ---------------- */
  function buildStage() {
    // 原内容（h1 / 进度条 / 文字）保留在 DOM 里，只是视觉上隐藏，
    // 这样 main.js 对 #loading-bar、#loading-text 的读写全部继续有效。
    var original = document.createElement('div');
    original.className = 'phigros-original-loading';
    while (loadingScreen.firstChild) {
      original.appendChild(loadingScreen.firstChild);
    }
    loadingScreen.appendChild(original);

    // 动画层
    var black = document.createElement('div');
    black.className = 'loading-black';

    var canvas = document.createElement('canvas');
    canvas.id = 'loading-grid';
    canvas.setAttribute('aria-hidden', 'true');

    var white = document.createElement('div');
    white.className = 'loading-white';

    var emblem = document.createElement('div');
    emblem.className = 'loading-emblem';
    emblem.setAttribute('aria-hidden', 'true');
    emblem.innerHTML =
      '<div class="loading-orbit"></div>' +
      '<div class="loading-wordmark">ORBIT</div>' +
      '<div class="loading-caption">穹顶孤舟</div>' +
      '<div class="loading-dots"><span></span><span></span><span></span></div>';

    loadingScreen.appendChild(black);
    loadingScreen.appendChild(canvas);
    loadingScreen.appendChild(white);
    loadingScreen.appendChild(emblem);

    loadingScreen.classList.add('phigros-opening-stage');
    // 注意：这里「不加」 .is-playing，让原来的进度条继续可见，
    // 直到真正开始播动画时才切换（见 play()）。
    loadingScreen.hidden = false;
    loadingScreen.style.display = 'flex';
    loadingScreen.style.opacity = '1';
    loadingScreen.style.visibility = 'visible';

    return canvas;
  }

  /* ---------------- 让后面的界面在黑屏期间同步淡入 ---------------- */
  var revealTargets = [];

  function collectRevealTargets() {
    revealTargets = [];
    var ids = ['start-screen', 'main-canvas', 'tools', 'offset-toggle'];
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (el && el !== loadingScreen) revealTargets.push(el);
    }
  }

  // 让界面「先存在但透明」，之后由动画进度驱动 opacity
  function prepareReveal() {
    collectRevealTargets();
    for (var i = 0; i < revealTargets.length; i++) {
      var el = revealTargets[i];
      // 关键：#start-screen 初始带 class="hidden"（display:none），
      // 必须先去掉，否则它根本不存在于布局中去无从淡入。
      el.classList.remove('hidden');
      el.hidden = false;
      if (!el.style.display || el.style.display === 'none') {
        el.style.display = el.id === 'main-canvas' ? 'block' : '';
      }
      el.style.transition = 'none';
      el.style.opacity = '0';
      el.dataset.openingRevealed = '1';
    }
  }

  // progress: 0 → 1，控制界面淡入程度
  function applyReveal(progress) {
    var p = progress < 0 ? 0 : progress > 1 ? 1 : progress;
    for (var i = 0; i < revealTargets.length; i++) {
      revealTargets[i].style.opacity = String(p);
    }
  }

  function clearReveal() {
    for (var i = 0; i < revealTargets.length; i++) {
      var el = revealTargets[i];
      el.style.opacity = '';
      el.style.transition = '';
      el.style.display = '';
      delete el.dataset.openingRevealed;
    }
    revealTargets = [];
  }

  /* ---------------- 拦截「隐藏加载页」 ---------------- */
  var animating = false;
  var done = false;
  var stageHidden = false;

  // main.js 通常用 style.opacity / style.display / classList 隐藏
  function looksHidden() {
    var s = loadingScreen.style;
    return s.display === 'none' ||
      s.opacity === '0' ||
      loadingScreen.hidden === true ||
      loadingScreen.classList.contains('hidden');
  }

  function restoreVisible() {
    loadingScreen.hidden = false;
    loadingScreen.classList.remove('hidden');
    loadingScreen.style.display = 'flex';
    loadingScreen.style.opacity = '1';
    loadingScreen.style.visibility = 'visible';
    loadingScreen.style.pointerEvents = 'none';
  }

  function hideForReal() {
    stageHidden = true;
    loadingScreen.style.opacity = '0';
    setTimeout(function () {
      loadingScreen.style.display = 'none';
      loadingScreen.hidden = true;
      loadingScreen.style.pointerEvents = 'none';
    }, 320);
  }

  /* ---------------- 播放动画 ---------------- */
  function play() {
    if (animating || done) return;
    animating = true;

    var canvas = document.getElementById('loading-grid');
    if (!canvas) canvas = buildStage();

    var reducedMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var boot;
    try {
      // 把 CONFIG.minimumLoading 传进去，否则 LoadingSequence 内部
      // 会用 LOADING_PROFILE.minimumDuration（1.1s）再次拖长时间
      boot = new window.OrgOpening.LoadingSequence(
        loadingScreen,
        { duration: CONFIG.minimumLoading },
        reducedMotion
      );
    } catch (err) {
      console.error('[开场动画] 初始化失败，跳过动画：', err);
      finish();
      return;
    }

    // 切换显示：原进度条淡出，动画层（黑屏 + ORBIT）淡入接上
    loadingScreen.classList.add('is-playing');

    // 让后面的游戏界面「先存在、透明」，稍后由动画进度驱动淡入
    prepareReveal();

    // 关键：让 CSS 过渡跑完再开始计时，避免黑屏压着原进度条时「空等」。
    // 这样 ORBIT 呼吸 / 网格升起 与用户视觉上的切换点是对齐的。
    boot.preload().catch(function (err) {
      console.error('[开场动画] 着色器预编译失败：', err);
    });

    var startAt = 0;

    function frame(now) {
      // 首帧不立刻计入动画，等黑屏淡入（约 280ms）完成后再开始计时
      if (!startAt) {
        startAt = now + 180;
        loadingScreen.dataset.phase = 'loading';
      }
      if (now < startAt) {
        requestAnimationFrame(frame);
        return;
      }
      var elapsed = (now - startAt) / 1000 + 0.18;   // startAt 前已有 180ms 黑屏淡入
      var ready = elapsed >= CONFIG.minimumLoading;

      try {
        boot.update(now, ready);
      } catch (err) {
        console.error('[开场动画] 渲染错误，直接结束：', err);
        finish();
        return;
      }

      if (!boot.active) {
        finish();
        return;
      }

      // ---------- 后景界面同步淡入 ----------
      // 时间轴：
      //   0 ~ 0.6s      黑屏 + ORBIT      界面 opacity 0 → 0.35
      //   0.6 ~ 1.68s   网格升起          界面 0.35 → 0.75
      //   1.68s ~ 白屏  全白遮住          界面 0.75 → 1
      //   白屏褪去后                     界面已是 1，自然露出
      var reveal;
      if (elapsed < CONFIG.minimumLoading) {
        // 黑屏阶段：缓慢淡入到 35%
        reveal = 0.35 * (elapsed / CONFIG.minimumLoading);
      } else if (elapsed < CONFIG.revealStartsAt) {
        // 网格升起阶段：继续到 75%
        var k = (elapsed - CONFIG.minimumLoading) /
                Math.max(0.001, CONFIG.revealStartsAt - CONFIG.minimumLoading);
        reveal = 0.35 + 0.40 * k;
      } else {
        // 白屏及之后：补满
        var k2 = (elapsed - CONFIG.revealStartsAt) /
                 Math.max(0.001, CONFIG.revealFullAt - CONFIG.revealStartsAt);
        reveal = 0.75 + 0.25 * (k2 > 1 ? 1 : k2);
      }
      applyReveal(reveal);

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }

  function finish() {
    if (done) return;
    done = true;
    animating = false;
    // 界面此时应已完全可见，清掉临时 opacity，交还给 main.js 自己管理
    clearReveal();
    hideForReal();
    if (typeof CONFIG.onComplete === 'function') {
      try { CONFIG.onComplete(); } catch (e) { console.error(e); }
    }
    if (typeof window.onOpeningComplete === 'function') {
      try { window.onOpeningComplete(); } catch (e) { console.error(e); }
    }
  }

  /* ---------------- 启动流程 ---------------- */
  function boot() {
    buildStage();

    if (!CONFIG.waitForMain) {
      // 直接播放
      setTimeout(play, 60);
      return;
    }

    // 监听 main.js 对加载页的隐藏动作
    var observer = new MutationObserver(function () {
      if (done || animating) return;
      if (looksHidden()) {
        // 撤销这次隐藏，改为播放动画
        restoreVisible();
        play();
      }
    });

    observer.observe(loadingScreen, {
      attributes: true,
      attributeFilter: ['style', 'class', 'hidden']
    });

    // 兜底：main.js 若一直不隐藏（加载失败/结构不符），到时强制播放
    if (CONFIG.fallbackAfter > 0) {
      setTimeout(function () {
        if (!done && !animating) {
          console.warn('[开场动画] main.js 未在限定时间内结束加载，自动接管');
          restoreVisible();
          play();
        }
      }, CONFIG.fallbackAfter);
    }
  }

  window.PhigrosOpening = {
    config: CONFIG,
    play: play,
    finish: finish
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
