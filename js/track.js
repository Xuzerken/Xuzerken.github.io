// Analytics / attention tracking — 数据闭环接口（统一入口 window.track）。
//
// 行为：
//   - 把每个事件写成一条结构化记录，追加进 localStorage 环形缓冲（key `ttk.attention.v1`，上限 ~500）。
//     记录形如 { e: 事件名, p: props, u: pathname+hash, ts: 时间戳 }。
//   - 提供 window.__attention（read/clear/count/last）供回放/调试/导出。
//   - 页面加载时自动发 page_view；并挂全局唯一的 click 委托 + details 展开捕获，
//     使 首页 与 news 详情页等所有走 Base 布局的页面埋点一致、且不重复计数。
//   - 全程 localStorage 读写套 try/catch（隐私模式 / 禁用存储时不抛错）。
//
// 真实统计（当前方向 Umami）：本文件做**双写转发**——
//   1. 启用条件在 Base.astro：analytics.enabled（src/lib/analytics.ts 读 PUBLIC_UMAMI_SRC /
//      PUBLIC_UMAMI_WEBSITE_ID）为真时，页面 head 才注入 Umami loader <script>；
//   2. 每条自定义事件在写本地日志后，若 window.umami.track 存在，再转发给 provider；
//   3. 例外：page_view 不转发 —— Umami 自带原生页面浏览统计，转发会双计；
//      page_view 仅保留在本地日志，供 __attention 复盘。
//   调用点与事件词表无需改动；未启用时本文件与"仅本地日志"逐字节等价。
//
// 事件即"注意力漏斗"——stage 表示观众注意力的投入深度：
//   stage 0 到达
//     page_view                     进入页面（每页加载一次；props.ref = referrer）
//   stage 1 主题层（对某个主题表态）
//     mission_theme_open / mission_theme_close   hero mission 词展开/收起说明卡（JS 直发；props.tag/label/verb）
//     focus_click                   Research 方向卡 → 过滤+滚动
//   stage 2 承诺/筛选（愿意走深一层：把主题落成"看论文"）
//     mission_see_papers            hero 说明卡里的 See papers →
//     filter_select                 点 Publications chips（含 All；props.tag/label）
//     filter_clear                  主题条 × 清除筛选
//     filter_toggle                 chips "+N more / Show less"（props.state）
//     nav_link                      顶部导航 section 链接（props.label）
//   stage 3 深入消费（单条成果）
//     publication_figure_click      论文代表图
//     publication_link_click        论文外链（arXiv/doi/…）
//     publication_project_page      论文 Project page
//     publication_abstract_expand   论文摘要展开（details）
//     publication_pdf_click         论文本地 PDF 下载（摘要折叠内，比 abstract_expand 更深一步）
//     grant_expand / grant_project_page   Grant 展开 / 外链
//     news_click / news_link_click  news 列表条目 / 详情页外链
//   stage 4 资产/联系
//     cv_download                   CV PDF 下载
//     contact_click                 邮箱 / GitHub / Scholar / service 外链（props.target ∈ email|github|scholar|service）
//     nav_toggle                    移动端汉堡开合（props.state）
//
// 埋点约定：元素上加 data-track="<event>"，可附加任意 data-* 作为属性（props），
//   委托在此统一从 el.dataset 读取**全部非空键**采集（含 tag/label/verb/state/desc/slug/title/
//   tags/section/target 等），不再限定白名单。状态相关（开/关、展开/收起）的事件由
//   模块脚本先行写入 data-state 再冒泡到本委托，或由 JS 直接调 window.track。
(function () {
  var KEY = 'ttk.attention.v1';
  var CAP = 500;

  // 从元素 dataset 读取所有非空键作 props（细粒度下钻：title/slug/tag/desc/section 等）。
  function readData(ds) {
    var props = {};
    if (!ds) return props;
    for (var k in ds) {
      if (Object.prototype.hasOwnProperty.call(ds, k) && ds[k]) props[k] = ds[k];
    }
    return props;
  }

  function rec(event, props) {
    if (typeof event !== 'string' || !event) return;
    try {
      var list;
      try {
        list = JSON.parse(localStorage.getItem(KEY) || '[]');
      } catch (e) {
        list = [];
      }
      if (!Array.isArray(list)) list = [];
      list.push({
        e: event,
        p: props || {},
        u: location.pathname + location.hash,
        ts: Date.now(),
      });
      if (list.length > CAP) list = list.slice(list.length - CAP);
      try {
        localStorage.setItem(KEY, JSON.stringify(list));
      } catch (e) {
        /* storage full / disabled — drop */
      }
    } catch (e) {
      /* never throw out of track */
    }
  }

  window.track = function (event, props) {
    // 入口统一守卫：非空字符串事件名才处理（本地日志与转发都不做），与 rec 内部守卫一致。
    if (typeof event !== 'string' || !event) return;
    rec(event, props);
    // 双写转发给真实 provider（Umami）：仅自定义事件；page_view 例外（原生统计，见头部注释）。
    // guard window.umami 在调用时刻判断 —— loader 是 async，不得假设已加载完成。
    if (event !== 'page_view') {
      try {
        var u = window.umami;
        if (u && typeof u.track === 'function') u.track(event, props || {});
      } catch (e) {
        /* provider 异常不影响本地日志 */
      }
    }
  };

  window.__attention = {
    read: function () {
      try {
        return JSON.parse(localStorage.getItem(KEY) || '[]');
      } catch (e) {
        return [];
      }
    },
    clear: function () {
      try {
        localStorage.removeItem(KEY);
      } catch (e) {
        /* ignore */
      }
    },
    count: function () {
      return this.read().length;
    },
    last: function (n) {
      var a = this.read();
      return a.slice(Math.max(0, a.length - (n || 1)));
    },
  };

  document.addEventListener('DOMContentLoaded', function () {
    window.track('page_view', { ref: document.referrer || '' });

    // 全局 click 委托：data-track → window.track。DETAILS 元素跳过，
    // 其"展开"由下方 capture 的 toggle 监听负责（避免点 summary 与 toggle 双计）。
    document.addEventListener('click', function (ev) {
      var el = ev.target && ev.target.closest ? ev.target.closest('[data-track]') : null;
      if (!el || el.tagName === 'DETAILS') return;
      window.track(el.getAttribute('data-track'), readData(el.dataset));
    });

    // details 展开才计一次：toggle 不冒泡，故用 capture；仅在 open 时记录，
    // 并带上元素上的 data-* 作 props（细粒度：哪篇论文/哪个 grant 被展开）。
    document.addEventListener(
      'toggle',
      function (ev) {
        var d = ev.target;
        if (d && d.tagName === 'DETAILS' && d.open && d.getAttribute('data-track')) {
          window.track(d.getAttribute('data-track'), readData(d.dataset));
        }
      },
      true
    );
  });
})();
