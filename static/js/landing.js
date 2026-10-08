(function () {

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ── Nav scroll state ── */
  var nav = document.getElementById("nav");
  var navScrolled = false;
  var heroEl = document.getElementById("hero");

  function updateNavScroll() {
    var shouldScroll = false;
    if (heroEl) {
      /* stay dark while the dark hero still reaches the nav strip */
      shouldScroll = heroEl.getBoundingClientRect().bottom <= 64;
    } else {
      shouldScroll = window.scrollY > 40;
    }
    if (shouldScroll !== navScrolled) {
      navScrolled = shouldScroll;
      nav.classList.toggle("nav_scrolled", shouldScroll);
    }
  }

  window.addEventListener("scroll", updateNavScroll, { passive: true });
  updateNavScroll();

  /* ── Mobile nav toggle ── */
  var toggleBtn = document.getElementById("nav_mobile_toggle");
  var navLinks = document.getElementById("nav_links");

  if (toggleBtn && navLinks) {
    toggleBtn.addEventListener("click", function () {
      navLinks.classList.toggle("nav_links_open");
    });

    document.addEventListener("click", function (e) {
      if (!nav.contains(e.target)) {
        navLinks.classList.remove("nav_links_open");
      }
    });

    navLinks.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        navLinks.classList.remove("nav_links_open");
      });
    });
  }

  /* ── Smooth scroll for anchor links ── */
  document.addEventListener("click", function (e) {
    var target = e.target.closest('a[href^="#"]');
    if (target) {
      var id = target.getAttribute("href").slice(1);
      var el = document.getElementById(id);
      if (el) {
        e.preventDefault();
        scrollToSection(id);
      }
    }
  });

  function scrollToSection(id) {
    var el = document.getElementById(id);
    if (!el) return;
    var offset = 72;
    var top = el.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: top, behavior: reduceMotion ? "auto" : "smooth" });
  }

  /* ── Scroll-to-top button ── */
  var scrollTopBtn = document.getElementById("scroll_top");

  if (scrollTopBtn) {
    window.addEventListener("scroll", function () {
      scrollTopBtn.classList.toggle("scroll_top_visible", window.scrollY > 400);
    }, { passive: true });

    scrollTopBtn.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    });
  }

  /* ── FAQ Accordion ── */
  document.querySelectorAll(".faq_question").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var expanded = btn.getAttribute("aria-expanded") === "true";
      var answer = btn.nextElementSibling;

      document.querySelectorAll(".faq_question").forEach(function (other) {
        if (other !== btn) {
          other.setAttribute("aria-expanded", "false");
          other.nextElementSibling.classList.remove("faq_answer_open");
        }
      });

      btn.setAttribute("aria-expanded", expanded ? "false" : "true");
      answer.classList.toggle("faq_answer_open", !expanded);
    });
  });

  /* ── Keyboard navigation: j / k between sections ── */
  var SECTION_IDS = [
    "hero", "problem", "tour", "about", "privacy", "faq", "cta"
  ];

  document.addEventListener("keydown", function (e) {
    var tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || e.target.isContentEditable) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    var key = e.key.toLowerCase();
    if (key !== "j" && key !== "k") return;

    var currentIndex = -1;
    for (var i = 0; i < SECTION_IDS.length; i++) {
      var el = document.getElementById(SECTION_IDS[i]);
      if (el && el.getBoundingClientRect().top <= 140) {
        currentIndex = i;
      }
    }
    if (currentIndex < 0) currentIndex = 0;

    var nextIndex = key === "j" ? currentIndex + 1 : currentIndex - 1;
    if (nextIndex < 0 || nextIndex >= SECTION_IDS.length) return;
    scrollToSection(SECTION_IDS[nextIndex]);
  });

  /* ── Dashboard carousel (CSS keyframe infinite loop) ── */
  var dashViewport = document.getElementById("dash_viewport");
  var dashTrack = document.getElementById("dash_track");
  var originalSlides = null;

  function buildDashLoop() {
    if (!dashTrack) return;

    if (!originalSlides) {
      originalSlides = Array.from(dashTrack.children);
    }
    if (originalSlides.length === 0) return;

    dashTrack.innerHTML = "";
    var frag = document.createDocumentFragment();
    for (var r = 0; r < 4; r++) {
      originalSlides.forEach(function (s) {
        frag.appendChild(s.cloneNode(true));
      });
    }
    dashTrack.appendChild(frag);

    function measure() {
      if (!dashTrack || dashTrack.children.length <= originalSlides.length) return;
      var distance =
        dashTrack.children[originalSlides.length].offsetLeft -
        dashTrack.children[0].offsetLeft;

      dashTrack.style.setProperty(
        "--dash-distance",
        "-" + distance + "px"
      );

      dashTrack.style.animationDuration =
        (distance / 60) + "s";
    }

    requestAnimationFrame(measure);

    // Re-measure once every image has decoded so the loop seam is
    // based on final rendered widths, not an early frame measurement.
    var images = dashTrack.querySelectorAll("img");
    var loadedCount = 0;
    function onReady() {
      loadedCount++;
      if (loadedCount >= images.length) {
        requestAnimationFrame(measure);
      }
    }
    images.forEach(function (img) {
      if (img.complete) {
        onReady();
      } else {
        img.addEventListener("load", onReady, { once: true });
        img.addEventListener("error", onReady, { once: true });
      }
    });
  }

  var resizeTimer = null;
  function onDashResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (dashViewport && dashTrack) {
        buildDashLoop();
      }
    }, 200);
  }

  if (dashViewport && dashTrack) {
    buildDashLoop();
    window.addEventListener("resize", onDashResize, { passive: true });
  }

  /* Resume the carousel only after every image has decoded so the
     first animation frames don't fight main-thread decode work. */
  if (!reduceMotion && dashViewport && dashTrack) {
    var readyCount = 0;
    var totalImages = dashTrack.querySelectorAll("img").length;
    if (totalImages > 0) {
      function tryResume() {
        readyCount++;
        if (readyCount >= totalImages) {
          requestAnimationFrame(function () {
            dashTrack.classList.add("dash_ready");
          });
        }
      }
      Array.from(dashTrack.querySelectorAll("img")).forEach(function (img) {
        if (img.complete) {
          tryResume();
        } else {
          img.addEventListener("load", tryResume, { once: true });
          img.addEventListener("error", tryResume, { once: true });
        }
      });
    } else {
      dashTrack.classList.add("dash_ready");
    }
  } else if (reduceMotion && dashTrack) {
    dashTrack.classList.add("dash_ready");
  }

  /* ── Scroll-triggered reveal ── */
  var revealTargets = document.querySelectorAll(
    ".section .eyebrow, .section .section_title, .section .section_desc, " +
    ".window, .perm_table, .privacy_note, .faq_item"
  );

  if (!reduceMotion) {
    revealTargets.forEach(function (el) { el.classList.add("fade_in"); });

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("fade_in_visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: "0px 0px -40px 0px" });

    revealTargets.forEach(function (el) { observer.observe(el); });
  }

  /* ── Hero entrance + typewriter ── */
  var heroPromptText = document.getElementById("hero_prompt_text");
  var heroCaret = document.querySelector(".hero_caret");
  var typingTimer = null;

  function typeHero() {
    if (!heroPromptText || reduceMotion) return;
    var full = heroPromptText.textContent;
    heroPromptText.textContent = "";
    var i = 0;
    typingTimer = setInterval(function () {
      if (i < full.length) {
        heroPromptText.textContent = full.slice(0, ++i);
      } else {
        clearInterval(typingTimer);
        typingTimer = null;
        if (heroCaret) setTimeout(function () { heroCaret.classList.add("hero_caret--hidden"); }, 1400);
      }
    }, 30);
  }

  document.querySelectorAll(".hero_title, .hero_desc, .hero_kbd, .hero_shot")
    .forEach(function (el) {
      var map = {
        "hero_title": "hero_load_title",
        "hero_desc": "hero_load_desc",
        "hero_kbd": "hero_load_kbd",
        "hero_shot": "hero_load_shot"
      };
      var cls = map[el.className.replace(/ .*/, "")];
      if (cls) el.classList.add(cls);
    });

  /* ── Bilingual i18n ── */
  var i18nStrings = {
    en: {
      nav_features: "Features",
      nav_privacy: "Privacy",
      nav_faq: "FAQ",
      nav_github: "GitHub",
      nav_launch: "Launch App",
      hero_eyebrow: "vinfocus --view this-week",
      hero_title: "Browse Canvas. Not the clutter.",
      hero_desc: "A faster way through Vinschool's Canvas LMS.<br>Everything from Canvas, nothing in your way.",
      hero_kbd: "navigate sections",
      hero_status_courses: "courses",
      hero_status_weeks: "weeks",
      hero_status_indexed: "items indexed",
      problem_eyebrow: "// the problem",
      problem_title: "Canvas has everything.<br>Finding it is the hard part.",
      problem_body1: "Open a course. Scroll the module list. Hope the quiz you need is where you left it. Repeat for every subject, every week.",
      problem_body2: "Canvas isn't bad. It's just slow to navigate. VinFocus doesn't replace it — it rearranges the same information into something you can actually move through.",
      fix_eyebrow: "// everything in one place",
      fix_title: "Your Canvas. Finally clean.",
      fix_desc: "Browse assignments, check today's timetable, and stay on top of every subject without digging through endless LMS pages.",
      dash_work: "Find assignments by week without digging through modules.",
      dash_timetable: "See what class comes next at a glance.",
      dash_setup: "Go from Access Card to your week in minutes.",
      about_eyebrow: "// why this exists",
      about_title: "Built because Canvas was in the way.",
      about_body1: "I'm a student at Vinschool. Every week meant opening Canvas, clicking a course, scrolling a module list, and hoping the quiz I needed was where I remembered it. It usually wasn't.",
      about_body2: "So I built VinFocus. It reads the same courses you already have and rearranges them into a calmer, faster dashboard. It doesn't decide what you should do. It just makes what exists easier to find.",
      about_mono: "not affiliated with vinschool or canvas. it just makes them usable.",
      privacy_eyebrow: "// privacy",
      privacy_title: "Check the permissions yourself.",
      privacy_prompt: "$ vinfocus --check-permissions",
      privacy_intro: "No signup. No account. No server-side storage of anything that matters.",
      privacy_note: "Your Access Card lives in your browser and goes straight to Canvas. It is never stored on VinFocus servers, and nothing is collected or shared.",
      perm_op_read_courses: "READ courses",
      perm_op_read_assignments: "READ assignments",
      perm_op_write: "WRITE anything",
      perm_op_submit: "SUBMIT assignments",
      perm_op_store: "STORE token",
      perm_op_send: "SEND your data",
      perm_yes: "yes",
      perm_no: "no",
      perm_browser_only: "browser only",
      perm_nowhere: "nowhere",
      faq_title: "Frequently asked questions",
      faq_subtitle: "Quick answers to common questions.",
      faq1_q: "Is VinFocus an official Vinschool product?",
      faq1_a: "No. VinFocus is an independent project created by a student. It is not affiliated with Vinschool or Canvas LMS. It uses Canvas's public API to read course data with your permission.",
      faq2_q: "Why do I need an Access Card?",
      faq2_a: "VinFocus uses Canvas's API to fetch your course data. The API requires an access token (Access Card) to authenticate you. The token is never stored on our servers.",
      faq3_q: "Is my data safe?",
      faq3_a: "Yes. Your token is stored only in your browser's localStorage or sessionStorage. It is sent directly to Canvas with each request and is never logged or stored on VinFocus servers. No data is collected or shared.",
      faq4_q: "Can teachers see that I use VinFocus?",
      faq4_a: "No. VinFocus uses the same Canvas API that any student can use. It makes read-only requests that are indistinguishable from normal Canvas usage. There is no way for teachers to detect VinFocus.",
      faq5_q: "Why not use Vinschool LMS?",
      faq5_a: "VinFocus isn't a replacement — it's a faster, read-only window onto the same Canvas data you already use. Because it reads straight from Canvas, there's no second account, no migration, and nothing new to manage. It just saves the clicks.",
      cta_eyebrow: "$ ./vinfocus",
      cta_title: "Your next week is one tab away.",
      cta_desc: "Open the app, paste your Access Card, and see everything Canvas hides in module lists.",
      cta_launch: "Launch App",
      footer_credit: "Made by Pham Le Manh Hung",
      footer_disclaimer: "VinFocus is an independent project and is not affiliated with Vinschool or Canvas LMS.",
      footer_copyright: "© 2026 VinFocus"
    },
    vi: {
      nav_features: "Tính năng",
      nav_privacy: "Quyền riêng tư",
      nav_faq: "FAQ",
      nav_github: "GitHub",
      nav_launch: "Mở ứng dụng",
      hero_eyebrow: "vinfocus --view this-week",
      hero_title: "Lướt Canvas. Không rối rắm.",
      hero_desc: "Một cách nhanh gọn hơn để dùng Canvas LMS của Vinschool.<br>Tất cả từ Canvas. Tập trung vào điều quan trọng nhất.",
      hero_kbd: "điều hướng các phần",
      hero_status_courses: "khóa học",
      hero_status_weeks: "tuần",
      hero_status_indexed: "mục đã đánh chỉ mục",
      problem_eyebrow: "// vấn đề",
      problem_title: "Canvas chứa tất cả.<br>Tìm nó mới là phần khó.",
      problem_body1: "Mở khóa học. Cuộn danh sách học phần. Hy vọng bài kiểm tra cần tìm nằm đúng chỗ bạn nhớ. Lặp lại cho mỗi môn, mỗi tuần.",
      problem_body2: "Canvas không tệ. Chỉ là việc điều hướng hơi chậm. VinFocus không thay thế nó — nó sắp xếp lại cùng một thông tin để bạn có thể điều hướng dễ dàng hơn.",
      fix_eyebrow: "// giải pháp",
      fix_title: "Canvas của bạn. Cuối cùng cũng gọn gàng.",
      fix_desc: "Xem bài tập, kiểm tra thời khóa biểu hôm nay và theo dõi mọi môn học mà không cần phải lục tìm qua vô số trang trên LMS.",
      dash_work: "Tìm bài tập theo tuần mà không cần lục danh sách học phần.",
      dash_timetable: "Biết ngay tiết tiếp theo là gì.",
      dash_setup: "Từ Access Card đến tuần của bạn chỉ trong vài phút.",
      about_eyebrow: "// câu chuyện phía sau",
      about_title: "Được tạo ra vì Canvas làm mọi thứ khó hơn.",
      about_body1: "Tôi là học sinh Vinschool. Mỗi tuần nghĩa là mở Canvas, bấm vào khóa học, cuộn danh sách học phần, và hy vọng bài kiểm tra cần tìm nằm đúng chỗ tôi nhớ. Thường thì không.",
      about_body2: "Nên tôi tạo ra VinFocus. Nó đọc chính những khóa học bạn đang có và sắp xếp lại chúng thành một bảng điều khiển gọn gàng và nhanh hơn. Nó không quyết định bạn nên làm gì. Nó chỉ giúp những gì đang có dễ tìm hơn.",
      about_mono: "không liên kết với vinschool hay canvas. chỉ làm chúng dễ dùng hơn.",
      privacy_eyebrow: "// quyền riêng tư",
      privacy_title: "Tự kiểm tra quyền hạn của ứng dụng.",
      privacy_prompt: "$ vinfocus --check-permissions",
      privacy_intro: "Không đăng ký. Không tài khoản. Không lưu gì quan trọng trên máy chủ.",
      privacy_note: "Access Card của bạn nằm trong trình duyệt và được gửi thẳng tới Canvas. Nó không bao giờ được lưu trên máy chủ VinFocus, và không có dữ liệu nào bị thu thập hay chia sẻ.",
      perm_op_read_courses: "ĐỌC khóa học",
      perm_op_read_assignments: "ĐỌC bài tập",
      perm_op_write: "GHI bất kỳ thứ gì",
      perm_op_submit: "NỘP bài tập",
      perm_op_store: "LƯU mã truy cập",
      perm_op_send: "GỬI dữ liệu của bạn",
      perm_yes: "có",
      perm_no: "không",
      perm_browser_only: "chỉ trong trình duyệt",
      perm_nowhere: "không nơi nào",
      faq_title: "Câu hỏi thường gặp",
      faq_subtitle: "Câu trả lời nhanh cho các thắc mắc phổ biến.",
      faq1_q: "VinFocus có phải sản phẩm chính thức của Vinschool không?",
      faq1_a: "Không. VinFocus là dự án độc lập do một học sinh xây dựng, không liên kết với Vinschool hay Canvas LMS. Ứng dụng sử dụng API công khai của Canvas để đọc dữ liệu khóa học với sự cho phép của bạn.",
      faq2_q: "Tôi cần Access Card để làm gì?",
      faq2_a: "VinFocus dùng API của Canvas để truy xuất dữ liệu khóa học. API yêu cầu mã truy cập (Access Card) để xác thực và mã này không bao giờ được lưu trên máy chủ.",
      faq3_q: "Dữ liệu của tôi có an toàn không?",
      faq3_a: "Có. Mã của bạn chỉ được lưu trong localStorage hoặc sessionStorage của trình duyệt, được gửi trực tiếp đến Canvas khi cần và không bao giờ lưu hay ghi lại trên máy chủ VinFocus. Không có dữ liệu nào bị thu thập hay chia sẻ.",
      faq4_q: "Giáo viên có biết tôi dùng VinFocus không?",
      faq4_a: "Không. VinFocus sử dụng cùng API Canvas mà bất kỳ học sinh nào cũng có thể dùng. Các yêu cầu chỉ mang tính đọc dữ liệu và không thể phân biệt với việc sử dụng Canvas thông thường. Giáo viên không có cách nào để biết bạn đang dùng VinFocus.",
      faq5_q: "Tại sao không dùng LMS Vinschool?",
      faq5_a: "VinFocus không phải là công cụ thay thế — nó là một cửa sổ chỉ-đọc nhanh hơn vào chính dữ liệu Canvas bạn đang dùng. Vì đọc thẳng từ Canvas, bạn không cần tài khoản thứ hai, không phải di chuyển dữ liệu, cũng không có gì mới phải quản lý. Nó chỉ giúp bạn đỡ phải bấm nhiều lần.",
      cta_eyebrow: "$ ./vinfocus",
      cta_title: "Tuần tới của bạn chỉ cách một tab.",
      cta_desc: "Mở ứng dụng, dán Access Card và xem mọi thứ Canvas chôn trong các danh sách học phần",
      cta_launch: "Mở ứng dụng",
      footer_credit: "Một dự án của Phạm Lê Mạnh Hùng",
      footer_disclaimer: "VinFocus là dự án độc lập và không liên kết với Vinschool hay Canvas LMS.",
      footer_copyright: "© 2026 VinFocus"
    }
  };

  var currentLang = localStorage.getItem("vinfocus_lang") || "en";

  function updateSwitcher(lang) {
    document.querySelectorAll(".lang_option").forEach(function (opt) {
      opt.classList.toggle("lang_option_active", opt.getAttribute("data-lang") === lang);
    });
    var ind = document.querySelector(".lang_indicator");
    if (ind) {
      ind.classList.toggle("lang_indicator_vi", lang === "vi");
    }
  }

  function applyLanguage(lang) {
    if (typingTimer) {
      clearInterval(typingTimer);
      typingTimer = null;
      if (heroPromptText && i18nStrings[lang] && i18nStrings[lang].hero_eyebrow !== undefined) {
        heroPromptText.textContent = i18nStrings[lang].hero_eyebrow;
      }
      if (heroCaret) heroCaret.classList.add("hero_caret--hidden");
    }

    var strings = i18nStrings[lang];
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      if (strings[key] !== undefined) {
        el.innerHTML = strings[key];
      }
    });
    document.querySelectorAll("[data-i18n-ph]").forEach(function (el) {
      var key = el.getAttribute("data-i18n-ph");
      if (strings[key] !== undefined) {
        el.setAttribute("placeholder", strings[key]);
      }
    });
    currentLang = lang;
    localStorage.setItem("vinfocus_lang", lang);
    updateSwitcher(lang);
  }

  var switcher = document.getElementById("lang_switcher");
  if (switcher) {
    switcher.addEventListener("click", function (e) {
      var opt = e.target.closest(".lang_option");
      if (opt) {
        var lang = opt.getAttribute("data-lang");
        if (lang !== currentLang) {
          applyLanguage(lang);
        }
      }
    });
  }

  applyLanguage(currentLang);

  /* start the typewriter only after i18n is applied */
  window.addEventListener("load", function () {
    typeHero();
  });

  console.log("[VinFocus] Landing page loaded");
})();
