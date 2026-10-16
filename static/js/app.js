let itemList = document.getElementById("item_list");
const searchInput = document.getElementById("search_input");
const coursePills = document.getElementById("course_pills");
const unfinishedOnly = document.getElementById("unfinished_only");
const unknownOnly = document.getElementById("unknown_only");
const hubTitle = document.getElementById("hub_title");
let prevWeekBtn = document.getElementById("prev_week");
let nextWeekBtn = document.getElementById("next_week");
let weekInput = document.getElementById("week_input");

// Panel B DOM references (populated by enableSplitView)
let itemListB = null;
let prevWeekBtnB = null;
let nextWeekBtnB = null;
let weekInputB = null;
// Shared per-column mini-header DOM for the active column's course label
let activeColumnHeaderB = null;
let activeColumnHeaderA = null;
const viewTabs = document.querySelectorAll(".view_tab");
const themeToggle = document.getElementById("theme_toggle");
const workView = document.getElementById("work_view");
const timetableView = document.getElementById("timetable_view");
const resourceView = document.getElementById("resource_view");
const aboutView = document.getElementById("about_view");
const timetableGrid = document.getElementById("timetable_grid");
const timetableMobile = document.getElementById("timetable_mobile");
const languageToggle = document.getElementById("language_toggle");
const tagline = document.getElementById("tagline");
const timetableTitle = document.getElementById("timetable_title");
const timetableNote = document.getElementById("timetable_note");
const timetableHeader = document.querySelector(".timetable_header");
const subjectLabelEditBtn = document.getElementById("subject_label_edit_btn");

const VINFOCUS_SCRIPT_VERSION = "1.7.5";
const DEBUG = false;
function debugLog(...args) {
  if (DEBUG) console.log("[VinFocus Debug]", ...args);
}

// ── Consent-aware storage abstraction ────────────────────────
// Uses localStorage when consent is given, sessionStorage otherwise.

const STORAGE_CONSENT_KEY = "storage_consent";
let storageConsent = null; // null = not decided, true = accepted, false = rejected

function getStorageConsent() {
    if (storageConsent === null) {
        // Check localStorage first (accepted), then sessionStorage (rejected)
        const storedLocal = localStorage.getItem(STORAGE_CONSENT_KEY);
        const storedSession = sessionStorage.getItem(STORAGE_CONSENT_KEY);
        const stored = storedLocal !== null ? storedLocal : storedSession;
        storageConsent = stored === null ? null : stored === "true";
    }
    return storageConsent;
}

function setStorageConsent(value) {
    storageConsent = value ? true : false;
    if (value) {
        // Migrate all existing sessionStorage data to localStorage
        for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            if (key !== STORAGE_CONSENT_KEY) {
                localStorage.setItem(key, sessionStorage.getItem(key));
            }
        }
        localStorage.setItem(STORAGE_CONSENT_KEY, String(storageConsent));
        sessionStorage.clear();
    } else {
        sessionStorage.setItem(STORAGE_CONSENT_KEY, String(storageConsent));
        localStorage.removeItem(STORAGE_CONSENT_KEY);
    }
}

function getStorageTarget() {
    return getStorageConsent() === true ? localStorage : sessionStorage;
}

function storageGet(key) {
    try {
        return getStorageTarget().getItem(key);
    } catch {
        return null;
    }
}

function storageSet(key, value) {
    try {
        getStorageTarget().setItem(key, value);
    } catch {
        // ignore quota errors
    }
}

function storageRemove(key) {
    try {
        getStorageTarget().removeItem(key);
    } catch {
        // ignore
    }
}

// Token management
function getToken() {
  const token = storageGet("api_token") || "";
  debugLog("getToken():", token ? token.slice(0, 10) + "..." : "(empty)");
  return token;
}

function saveToken(token) {
  debugLog("saveToken called, token:", token ? token.slice(0, 10) + "..." : "(empty)");
  storageSet("api_token", token);
  storageSet("api_token_saved_at", String(Date.now()));
  debugLog("saveToken: storage now has api_token =", (storageGet("api_token") || "").slice(0, 10) + "...");
}

function clearToken() {
  debugLog("clearToken called");
  storageRemove("api_token");
  storageRemove("api_token_saved_at");
  debugLog("clearToken: api_token in storage =", storageGet("api_token"));
}

function getTokenAgeDays() {
  const savedAt = storageGet("api_token_saved_at");
  if (!savedAt) return null;
  return (Date.now() - Number(savedAt)) / (1000 * 60 * 60 * 24);
}

// Language state management
let currentLanguage = storageGet("language") || "en";

function setLanguage(lang) {
  currentLanguage = lang;
  storageSet("language", lang);
  if (languageToggle) {
    languageToggle.textContent = lang === "vi" ? "VN" : "EN";
  }
  renderAll();
}

function t(key) {
  return TRANSLATIONS[currentLanguage]?.[key] ?? key;
}

// ── Subject Label Override System ──────────────────────────────
// Each entry: { label: string }

function getCustomSubjectLabels() {
  if (_cachedCustomSubjectLabels === null) {
    try {
      const stored = storageGet("custom_subject_labels");
      _cachedCustomSubjectLabels = stored ? JSON.parse(stored) : {};
    } catch {
      _cachedCustomSubjectLabels = {};
    }
  }
  return _cachedCustomSubjectLabels;
}

function saveCustomSubjectLabels(labels) {
  _cachedCustomSubjectLabels = labels;
  storageSet("custom_subject_labels", JSON.stringify(labels));
}

function resetCustomSubjectLabels() {
  _cachedCustomSubjectLabels = {};
  storageRemove("custom_subject_labels");
}

function getSubjectLabel(subjectId) {
  const customLabels = getCustomSubjectLabels();
  const entry = customLabels[subjectId];
  if (entry && entry.label && entry.label.trim()) {
    return entry.label.trim();
  }
  return SUBJECT_LABELS[currentLanguage]?.[subjectId] ?? subjectId;
}

function setSubjectCustomization(subjectId, label) {
  const labels = getCustomSubjectLabels();
  if (label && label.trim()) {
    labels[subjectId] = { label: label.trim() };
  } else {
    delete labels[subjectId];
  }
  saveCustomSubjectLabels(labels);
}

// Subject label edit mode (rename only, no color)
let subjectLabelEditMode = false;

// Translation dictionaries
const TRANSLATIONS = {
  en: {
    monday: "Monday",
    tuesday: "Tuesday",
    wednesday: "Wednesday",
    thursday: "Thursday",
    friday: "Friday",
    today: "Today",
    free: "Free",
    done: "Done",
    unfinished: "Unfinished",
    unknown: "Unknown",
    loadingCourses: "Loading courses...",
    loadingItems: "Loading items...",
    noActiveCourses: "No active courses found.",
    noItemsWeek: "No items for this week.",
    noItemsMatch: "No items match your search.",
    time: "Time",
    period1: "Period 1",
    period2: "Period 2",
    period3: "Period 3",
    period4: "Period 4",
    period5: "Period 5",
    period6: "Period 6",
    period7: "Period 7",
    breaktime: "Breaktime",
    lunchBreak: "Lunch Break",
    work: "Work",
    timetable: "Timetable",
    about: "About",
    resource: "Resources",
    aboutTitle: "About VinFocus",
    aboutWhatTitle: "What is VinFocus?",
    aboutWhatDesc: "VinFocus is a personal dashboard for Vinschool's Canvas LMS. It organizes quizzes, assignments, files, and course modules into a cleaner, easier-to-navigate interface so students can quickly find what they need.",
    aboutWhyTitle: "Why I built it",
    aboutWhyDesc: "Vinschool LMS contains all the necessary information, but finding it often requires opening multiple pages and searching through long module lists. I built VinFocus to make course information easier to access, helping students spend less time navigating and more time studying.",
    aboutFeaturesTitle: "Features",
    aboutFeature1: "Browse your active Canvas courses.",
    aboutFeature2: "Navigate between weeks to view related modules and resources.",
    aboutFeature3: "Search across courses, modules, quizzes, assignments, and files.",
    aboutFeature4: "Filter unfinished items based on Canvas completion status.",
    aboutFeature5: "View and manage your weekly timetable.",
    aboutFeature6: "Switch between English and Vietnamese.",
    aboutFeature7: "Toggle between dark and light themes.",
    aboutFeature8: "For modules that don't have a week number, go to Week 0.",
    aboutShortcutsTitle: "Keyboard shortcuts",
    aboutShortcut1: "Toggle unfinished",
    aboutShortcut2: "Toggle unknown",
    aboutShortcut3: "Previous / next week",
    aboutShortcut4: "Previous / next week",
    aboutShortcut5: "Jump to week",
    aboutThanks: "Thanks for using VinFocus.",
    aboutTetoCaption: "almost any website will eventually have a mysterious mascot.\nthis one's ours.",
    aboutBlessing: "$ vinfocus --good-luck\n\ngood luck this semester.\n\nhope this little project saves you\na few clicks every day.\n\n(>ω<)ﾉ - fatass teto",
    resourceTitle: "Community Resources",
    resourceSubtitle: "Study guides, notes, and useful links contributed by students.",
    resourceDocsTitle: "Notes Library",
    resourceDocsDesc: "Notes, summaries, and links shared by students across subjects.",
    ebook_library: "E-Book Library",
    ebook_library_desc: "Textbooks and reference books organized by subject.",
    literature: "Literature",
    geography: "Geography",
    history: "History",
    open_ebook_library: "Open E-Book Library",
    ebook_modal_title: "E-Book Library",
    ebook_modal_close: "Close",
    offlineBanner: "Offline - showing cached data.",
    week: "Week",
    general: "Unassigned Modules",
    searchPlaceholder: "Search items",
    unfinishedLabel: "Unfinished",
    unknownLabel: "Unknown",
    tagline: "Canvas information hub - browse courses, weeks, and resources.",
    timetableTitle: "Weekly Timetable",
    timetableNote: "Manual schedule stored locally in this app.",
    openTimetable: "Open timetable",
    loadExampleSchedule: "Load Example Schedule",
    loadExampleConfirm: "Replace your current timetable with the example schedule?",
    timetableEmptyHint: "Your timetable is empty. Press the pencil to add your classes, or load the example schedule while editing.",
    clearSlot: "Empty",
    room: "Room",
    roomPlaceholder: "Room (e.g. B3-201)",
    items: "items",
    noClassesAdded: "No classes added yet.",
    weekendNoClasses: "No classes, it's the weekend.",
    indicatorCurrent: "Current",
    indicatorNext: "Next",
    passingPeriod: "Passing Period",
    breaktime: "Breaktime",
    lunchBreak: "Lunch Break",
    notInClass: "End of the school day",
    introTitle: "Welcome to VinFocus",
    introSubtitle: "Your dashboard for Vinschool Canvas - view courses, track modules, and stay on top of your work.",
    introCloseWarning: "You haven't saved a token yet, so the app can't load your course data. To add one later, open Settings (the gear icon) and choose Set API token.",
    introStep: "Step",
    introOf: "of",
    introNext: "Next",
    introPrev: "Back",
    introFinish: "Finish",
introChooseTitle: "Connect to Canvas",
introChooseDesc: "Paste a Personal Access Token from Canvas Settings → Approved Integrations. Tokens expire every 4 months.",
    introTokenLabel: "Paste your API token here",
    introTokenPlaceholder: "Paste API token…",
    introValidate: "Validate & Save",
    introValidating: "Validating...",
    introSuccess: "Token saved successfully!",
    introError: "Invalid token. Please check and try again.",
    introStep1Title: "What is VinFocus?",
    introStep1Desc: "A cleaner, simpler view of your Vinschool Canvas - browse courses, track modules, and stay on top of everything in one place.",
    introStep2Title: "Made for students",
    introStep2Desc: "See weekly schedules, course resources, and your progress at a glance. No install needed - it works right in your browser.",
    tokenExpiresSoon: "Your API token will expire in {days} days.",
    tokenExpired: "Your API token has expired. Please update it.",
    tokenExpiresToday: "Your API token expires today!",
    footerMadeBy: "Made by Pham Le Manh Hung",
    footerFeedback: "I appreciate any reviews or feedbacks towards this project.",
    footerCopyright: "© 2026 VinFocus",
    settingsTitle: "Settings",
    settingsAccount: "Account",
    settingsPreferences: "Preferences",
    settingsConnect: "Set API token",
    settingsFeedback: "Send Feedback",
    settingsSplitView: "Split View",
    settingsSplitViewDesc: "Compare two courses side by side",
    subjectLabelsTitle: "Custom Subject Labels",
    subjectLabelsDesc: "Set custom labels for subject codes. These override the default names and persist across language changes. Leave a field empty to use the default.",
    subjectLabelsReset: "Reset",
    subjectLabelsResetConfirm: "Reset all custom labels to defaults?",
    subjectLabelsResetDefault: "Reset to default",
    subjectLabelsSave: "Save",
    subjectLabelsCancel: "Cancel",
    subjectLabelsRename: "Rename",
    subjectLabelsColor: "Color",
    subjectLabelsDefault: "Default",
    feedbackTitle: "Send Feedback",
    feedbackRating: "How useful has VinFocus been?",
    feedbackStarLabel: "Rate {n} out of 5 stars",
    feedbackUsage: "What do you use it for most?",
    feedbackUsageQuizzes: "Finding quizzes, assignments and more",
    feedbackUsageTimetable: "Timetable",
    feedbackUsageUnfinished: "Unfinished work",
    feedbackUsageOther: "Other",
    feedbackRecommend: "Would you recommend VinFocus to another student?",
    feedbackRecommendYes: "Yes",
    feedbackRecommendMaybe: "Maybe",
    feedbackRecommendNo: "No",
    feedbackImprove: "What's one thing you'd improve?",
    feedbackImprovePlaceholder: "Type your suggestion...",
    feedbackSubmit: "Submit Feedback",
    feedbackSubmitting: "Submitting...",
    feedbackSuccess: "Thank you for your feedback!",
    feedbackError: "Something went wrong. Please try again.",
    feedbackValidationRating: "Please select a rating.",
    feedbackValidationUsage: "Please select what you use it for most.",
    feedbackValidationRecommend: "Please select a recommendation.",
    
    // Consent Banner
    consentText: "We use localStorage to save your Canvas API token and preferences. This allows you to use the app without re-entering your token. Your token is stored only in your browser and never sent to our servers.",
    consentAccept: "Accept & Save",
    consentReject: "Use without saving",
    consentLearn: "Learn more",
    
    // Terms and Conditions
    tcTitle: "Terms and Conditions",
    tcSection1Title: "1. Independent Project",
    tcSection1Text: "VinFocus is an independent student-created project and is not affiliated with, endorsed by, or operated by Vinschool, Canvas, or Instructure.",
    tcSection2Title: "2. Use of API Tokens",
    tcSection2Text: "Users are responsible for keeping their API tokens secure. VinFocus stores tokens locally in your browser and does not intentionally transmit them to third parties. Never share your API token with others.",
    tcSection3Title: "3. Privacy",
    tcSection3Text: "VinFocus may collect anonymous feedback submitted by users. Feedback may be stored and reviewed to improve the service. API tokens are not stored in the VinFocus database - they are stored only in your browser's local storage.",
    tcSection4Title: "4. No Warranty",
    tcSection4Text: "VinFocus is provided 'as is' without guarantees of availability, accuracy, or reliability. Course information displayed in VinFocus originates from Canvas and may be incomplete, outdated, or inaccurate.",
    tcSection5Title: "5. Limitation of Liability",
    tcSection5Text: "The creator of VinFocus is not responsible for missed assignments, lost data, academic consequences, or any damages resulting from the use of the service.",
    tcSection6Title: "6. Service Changes",
    tcSection6Text: "Features may be modified, suspended, or removed at any time without prior notice.",
    tcSection7Title: "7. Contact",
    tcSection7Text: "For questions or feedback about VinFocus, please use the feedback form available in the app.",
    tcSection8Title: "8. Data Retention and Deletion",
    tcSection8Text: "Feedback data is retained indefinitely unless deletion is requested. To request deletion of your feedback, contact hung020121@gmail.com with the subject 'Data Deletion Request'. API tokens stored in your browser can be removed at any time by clearing your browser data or using the 'Clear Token' option in Settings.",
    tcSection9Title: "9. Data Processing",
    tcSection9Text: "VinFocus is hosted on Render.com. Feedback data is stored in a PostgreSQL database. Your Canvas API token is NEVER sent to our servers - it remains in your browser's local storage and is only used directly from your browser to authenticate with Canvas.",
    tcSection10Title: "10. Your Rights (GDPR/CCPA)",
    tcSection10Text: "You have the right to:\n- Access any personal data we hold about you\n- Request deletion of your data\n- Opt-out of data collection\n- Withdraw consent at any time\n\nTo exercise these rights, contact hung020121@gmail.com.",
    tcApiWarning: "Your Canvas API token is like a password - keep it private.",
    tcAgreeCheckbox: "I agree to the Terms and Conditions",
    tcViewTerms: "View Terms",
    introTcError: "Please agree to the Terms and Conditions before proceeding.",
    
    // Overview
    overview: "Overview",
    overviewLoading: "Loading overview...",
    overviewTotal: "Total items",
    overviewUnknown: "Unknown",
    overviewDone: "Done",
    overviewUnfinished: "Unfinished",
    overviewWeeks: "Weeks",
    overviewNoData: "No overview data available.",
    overviewWeekGeneral: "Unassigned Modules",
    uncategorizedWarning: "{count} unfinished items in 'Unassigned Modules'",
    noItemsWithUncategorized: "No items found for this week.\n\nSome teachers post content without assigning a week.\nCheck 'Unassigned Modules' for uncategorized work.",
    overviewStillLoading: "Canvas is still loading...",
    overviewThinkingHard: "Canvas is thinking very hard.",
    overviewDrinkWater: "Go drink a glass of water. It'll get there at some point.",
    overviewTryRefresh: "If this continues, try refreshing the page.",
    overviewBadDay: "Canvas may be having a bad day. Try again later.",
    retry: "Retry",
  },
  vi: {
    feedbackError: "Đã xảy ra lỗi. Vui lòng thử lại.",
    
    // Consent Banner
    consentText: "Chúng tôi sử dụng localStorage để lưu mã API Canvas và tùy chọn của bạn. Điều này cho phép bạn sử dụng ứng dụng mà không cần nhập lại mã. Mã của bạn chỉ được lưu trong trình duyệt và không bao giờ được gửi đến máy chủ của chúng tôi.",
    consentAccept: "Chấp nhận & Lưu",
    consentReject: "Sử dụng không lưu",
    consentLearn: "Tìm hiểu thêm",
    
    // Terms and Conditions
    tcTitle: "Điều Khoản Dịch Vụ",
    tcSection1Title: "1. Dự án Độc lập",
    tcSection1Text: "VinFocus là một dự án độc lập do học sinh tạo ra và không liên kết, được chứng nhận, hoặc được vận hành bởi Vinschool, Canvas, hoặc Instructure.",
    tcSection2Title: "2. Sử dụng Mã API",
    tcSection2Text: "Người dùng chịu trách nhiệm giữ bảo mật mã API của họ. VinFocus lưu trữ mã cục bộ trong trình duyệt của bạn và không cố ý truyền chúng cho bên thứ ba. Không bao giờ chia sẻ mã API của bạn với người khác.",
    tcSection3Title: "3. Quyền Riêng Tư",
    tcSection3Text: "VinFocus có thể thu thập phản hồi ẩn danh do người dùng gửi. Phản hồi có thể được lưu trữ và xem xét để cải thiện dịch vụ. Mã API không được lưu trữ trong cơ sở dữ liệu VinFocus - chúng chỉ được lưu trữ trong bộ nhớ cục bộ của trình duyệt của bạn.",
    tcSection4Title: "4. Không Có Bảo Hàng",
    tcSection4Text: "VinFocus được cung cấp 'như hiện tại' mà không có đảm bảo về tính sẵn sàng, độ chính xác, hoặc độ tin cậy. Thông tin khóa học hiển thị trong VinFocus có nguồn gốc từ Canvas và có thể không đầy đủ, lỗi thời, hoặc không chính xác.",
    tcSection5Title: "5. Giới Hạn Trách Nhiệm",
    tcSection5Text: "Người tạo VinFocus không chịu trách nhiệm về bài tập bị bỏ lỡ, dữ liệu bị mất, hậu quả học tập, hoặc bất kỳ thiệt hại nào phát sinh từ việc sử dụng dịch vụ.",
    tcSection6Title: "6. Thay Đổi Dịch Vụ",
    tcSection6Text: "Các tính năng có thể được sửa đổi, tạm dừng, hoặc xóa bỏ bất kỳ lúc nào mà không cần thông báo trước.",
    tcSection7Title: "7. Liên Hệ",
    tcSection7Text: "Đối với câu hỏi hoặc phản hồi về VinFocus, vui lòng sử dụng biểu mẫu phản hồi có sẵn trong ứng dụng.",
    tcApiWarning: "Mã API Canvas của bạn giống như mật khẩu - hãy giữ bảo mật.",
    tcAgreeCheckbox: "Tôi đồng ý với Điều khoản Dịch vụ",
    tcViewTerms: "Xem Điều khoản",
    introTcError: "Vui lòng đồng ý với Điều khoản Dịch vụ trước khi tiếp tục.",
    
    monday: "Thứ Hai",
    tuesday: "Thứ Ba",
    wednesday: "Thứ Tư",
    thursday: "Thứ Năm",
    friday: "Thứ Sáu",
    today: "Hôm Nay",
    free: "Trống",
    done: "Hoàn Thành",
    unfinished: "Chưa Hoàn Thành",
    loadingCourses: "Đang tải khóa học...",
    loadingItems: "Đang tải mục...",
    noActiveCourses: "Không tìm thấy khóa học hoạt động.",
    noItemsWeek: "Không có mục nào trong tuần này.",
    noItemsMatch: "Không tìm thấy mục phù hợp.",
    time: "Thời Gian",
    period1: "Tiết 1",
    period2: "Tiết 2",
    period3: "Tiết 3",
    period4: "Tiết 4",
    period5: "Tiết 5",
    period6: "Tiết 6",
    period7: "Tiết 7",
    breaktime: "Giờ ra chơi",
    lunchBreak: "Nghỉ trưa",
    work: "Làm Việc",
    timetable: "Thời Khóa Biểu",
    about: "Giới Thiệu",
    resource: "Tài Nguyên",
    aboutTitle: "Giới Thiệu VinFocus",
    aboutWhatTitle: "VinFocus là gì?",
    aboutWhatDesc: "VinFocus là một bảng điều khiển cá nhân cho Canvas LMS của vinschool. Nó sắp xếp các bài kiểm tra, bài tập, tệp tin và các module khóa học vào một giao diện sạch hơn, dễ điều hướng hơn, giúp học sinh nhanh chóng tìm thấy những gì cần thiết.",
    aboutWhyTitle: "Tại sao mình xây dựng nó",
    aboutWhyDesc: "Vinschool LMS chứa tất cả thông tin cần thiết, nhưng việc tìm kiếm thường đòi hỏi phải mở nhiều trang và tìm kiếm qua danh sách module dài. Mình xây dựng VinFocus để giúp việc truy cập thông tin khóa học dễ dàng hơn, giúp học sinh dành ít thời gian điều hướng hơn và nhiều thời gian học tập hơn.",
    aboutFeaturesTitle: "Tính năng",
    aboutFeature1: "Duyệt các khóa học Canvas đang hoạt động của bạn.",
    aboutFeature2: "Điều hướng giữa các tuần để xem module và tài nguyên liên quan.",
    aboutFeature3: "Tìm kiếm qua các khóa học, module, bài kiểm tra, bài tập và tệp tin.",
    aboutFeature4: "Lọc các mục chưa hoàn thành dựa trên trạng thái hoàn thành của Canvas.",
    aboutFeature5: "Xem và quản lý thời khóa biểu hàng tuần của bạn.",
    aboutFeature6: "Chuyển đổi giữa Tiếng Anh và Tiếng Việt.",
    aboutFeature7: "Chuyển đổi giữa chủ đề tối và sáng.",
    aboutFeature8: "Đối với các học phần chung không có số tuần, hãy chuyển đến Tuần 0.",
    aboutShortcutsTitle: "Phím tắt",
    aboutShortcut1: "Bật/tắt Chưa Hoàn Thành",
    aboutShortcut2: "Bật/tắt Chưa rõ",
    aboutShortcut3: "Tuần trước / tiếp theo",
    aboutShortcut4: "Tuần trước / tiếp theo",
    aboutShortcut5: "Nhảy đến tuần",
    aboutThanks: "Cảm ơn bạn đã sử dụng VinFocus.",
    aboutTetoCaption: "bạn đã cuộn đến cuối trang. tuy nhiên, con Teto này đã ở đây từ trước, dù hình dạng của nó trông như vừa thua một trận với định luật vật lý.",
    aboutBlessing: "$ vinfocus --good-luck\n\nchúc bạn may mắn trong học kỳ này.\n\nhy vọng dự án nhỏ này giúp bạn\ntiết kiệm vài cú click mỗi ngày.\n\n(>ω<)ﾉ - fatass teto",
    resourceTitle: "Tài Nguyên Cộng Đồng",
    resourceSubtitle: "Hướng dẫn học, ghi chú và các liên kết hữu ích được đóng góp bởi học sinh.",
    resourceDocsTitle: "Thư viện ghi chú",
    resourceDocsDesc: "Ghi chú, tóm tắt và liên kết được chia sẻ bởi học sinh các khối lớp.",
    ebook_library: "Thư Viện Sách Điện Tử",
    ebook_library_desc: "Sách giáo khoa và tài liệu học tập được sắp xếp theo môn học.",
    literature: "Ngữ Văn",
    geography: "Địa Lí",
    history: "Lịch Sử",
    open_ebook_library: "Mở Thư Viện Sách Điện Tử",
    ebook_modal_title: "Thư Viện Sách Điện Tử",
    ebook_modal_close: "Đóng",
    offlineBanner: "Ngoại tuyến - đang hiển thị dữ liệu đã lưu.",
    week: "Tuần",
    general: "Học phần chưa phân tuần",
    searchPlaceholder: "Tìm kiếm mục",
    unfinishedLabel: "Chưa Hoàn Thành",
    unknownLabel: "Chưa rõ",
    tagline: "Trung tâm thông tin Canvas - duyệt khóa học, tuần và tài nguyên.",
    timetableTitle: "Thời Khóa Biểu Tuần",
    timetableNote: "Lịch học được lưu cục bộ trong ứng dụng này.",
    openTimetable: "Mở thời khóa biểu",
    loadExampleSchedule: "Tải Lịch Mẫu",
    loadExampleConfirm: "Thay thế thời khóa biểu hiện tại bằng lịch mẫu?",
    timetableEmptyHint: "Thời khóa biểu của bạn đang trống. Bấm bút chì để thêm lớp học, hoặc tải lịch mẫu khi đang chỉnh sửa.",
    clearSlot: "Trống",
    room: "Phòng",
    roomPlaceholder: "Phòng (vd. B3-201)",
    items: "bài",
    noClassesAdded: "Chưa có lớp học nào được thêm.",
    weekendNoClasses: "Không có tiết học nào, hôm nay là cuối tuần.",
    indicatorCurrent: "Hiện tại",
    indicatorNext: "Tiết tiếp",
    passingPeriod: "Giờ Ra Chơi",
    breaktime: "Giờ Ra Chơi",
    lunchBreak: "Nghỉ Trưa",
    notInClass: "Kết thúc ngày học",
    introTitle: "Chào mừng đến với VinFocus",
    introSubtitle: "Bảng điều khiển Vinschool Canvas của bạn - xem khóa học, theo dõi modules và luôn cập nhật bài vở.",
    introCloseWarning: "Bạn chưa lưu mã truy cập, nên ứng dụng không thể tải dữ liệu khóa học của bạn. Để thêm sau, hãy mở Cài Đặt (biểu tượng bánh răng) và chọn Đặt mã API.",
    introStep: "Bước",
    introOf: "trên",
    introNext: "Tiếp theo",
    introPrev: "Quay lại",
    introFinish: "Hoàn tất",
introChooseTitle: "Kết nối với Canvas",
introChooseDesc: "Dán Mã Truy Cập Cá Nhân từ Canvas Settings → Tích Hợp Được Phê Duyệt. Mã hết hạn sau 4 tháng.",
    introTokenLabel: "Dán mã API của bạn vào đây",
    introTokenPlaceholder: "Dán mã API…",
    introValidate: "Xác thực & Lưu",
    introValidating: "Đang xác thực...",
    introSuccess: "Đã lưu mã thành công!",
    introError: "Mã không hợp lệ. Vui lòng kiểm tra lại.",
    introStep1Title: "VinFocus là gì?",
    introStep1Desc: "Một góc nhìn đơn giản và rõ ràng hơn về Vinschool Canvas của bạn - duyệt khóa học, theo dõi modules và nắm rõ mọi thứ ở một nơi duy nhất.",
    introStep2Title: "Dành cho học sinh",
    introStep2Desc: "Xem thời khóa biểu tuần, tài nguyên khóa học và tiến độ của bạn chỉ trong nháy mắt. Không cần cài đặt - hoạt động ngay trên trình duyệt của bạn.",
    tokenExpiresSoon: "Mã API của bạn sẽ hết hạn trong {days} ngày.",
    tokenExpired: "Mã API của bạn đã hết hạn. Vui lòng cập nhật.",
    tokenExpiresToday: "Mã API của bạn hết hạn hôm nay!",
    footerMadeBy: "Được tạo bởi Phạm Lê Mạnh Hùng",
    footerFeedback: "Mình rất trân trọng mọi đánh giá và phản hồi về dự án này.",
    footerCopyright: "© 2026 VinFocus",
    settingsTitle: "Cài Đặt",
    settingsAccount: "Tài khoản",
    settingsPreferences: "Tùy chọn",
    settingsConnect: "Đặt mã API",
    settingsFeedback: "Gửi Phản Hồi",
    settingsSplitView: "Chia đôi màn hình",
    settingsSplitViewDesc: "So sánh hai khóa học cạnh nhau",
    subjectLabelsTitle: "Nhãn Môn Học Tùy Chỉnh",
    subjectLabelsDesc: "Đặt nhãn tùy chỉnh cho mã môn học. Các nhãn này ghi đè tên mặc định và duy trì khi chuyển ngôn ngữ. Để trống để dùng nhãn mặc định.",
    subjectLabelsReset: "Đặt Lại",
    subjectLabelsResetConfirm: "Đặt lại tất cả nhãn tùy chỉnh về mặc định?",
    subjectLabelsResetDefault: "Đặt về mặc định",
    subjectLabelsSave: "Lưu",
    subjectLabelsCancel: "Hủy",
    subjectLabelsRename: "Đổi tên",
    subjectLabelsColor: "Màu",
    subjectLabelsDefault: "Mặc định",
    feedbackTitle: "Gửi Phản Hồi",
    feedbackRating: "VinFocus hữu ích như thế nào?",
    feedbackStarLabel: "Đánh giá {n} trên 5 sao",
    feedbackUsage: "Bạn sử dụng VinFocus nhiều nhất để làm gì?",
    feedbackUsageQuizzes: "Tìm bài kiểm tra, bài tập và hơn thế nữa",
    feedbackUsageTimetable: "Thời khóa biểu",
    feedbackUsageUnfinished: "Công việc chưa hoàn thành",
    feedbackUsageOther: "Khác",
    feedbackRecommend: "Bạn có giới thiệu VinFocus cho học sinh khác không?",
    feedbackRecommendYes: "Có",
    feedbackRecommendMaybe: "Có thể",
    feedbackRecommendNo: "Không",
    feedbackImprove: "Một điều bạn muốn cải thiện?",
    feedbackImprovePlaceholder: "Nhập gợi ý của bạn...",
    feedbackSubmit: "Gửi Phản Hồi",
    feedbackSubmitting: "Đang gửi...",
    feedbackSuccess: "Cảm ơn bạn đã phản hồi!",
    feedbackError: "Đã xảy ra lỗi. Vui lòng thử lại.",
    feedbackValidationRating: "Vui lòng chọn đánh giá.",
    feedbackValidationUsage: "Vui lòng chọn mục đích sử dụng.",
    feedbackValidationRecommend: "Vui lòng chọn mức độ giới thiệu.",
    
    tcSection8Title: "8. Lưu trữ và Xóa Dữ liệu",
    tcSection8Text: "Dữ liệu phản hồi được lưu trữ không giới hạn trừ khi có yêu cầu xóa. Để yêu cầu xóa phản hồi của bạn, liên hệ hung020121@gmail.com với chủ đề 'Yêu cầu Xóa Dữ liệu'. Mã API được lưu trong trình duyệt có thể được xóa bất cứ lúc nào bằng cách xóa dữ liệu trình duyệt hoặc sử dụng tùy chọn 'Xóa Mã' trong Cài Đặt.",
    tcSection9Title: "9. Xử lý Dữ liệu",
    tcSection9Text: "VinFocus được lưu trữ trên Render.com. Dữ liệu phản hồi được lưu trong cơ sở dữ liệu PostgreSQL. Mã API Canvas của bạn KHÔNG BAO GIỜ được gửi đến máy chủ của chúng tôi - nó nằm trong bộ nhớ cục bộ của trình duyệt và chỉ được sử dụng trực tiếp từ trình duyệt để xác thực với Canvas.",
    tcSection10Title: "10. Quyền của Bạn (GDPR/CCPA)",
    tcSection10Text: "Bạn có quyền:\n- Truy cập mọi dữ liệu cá nhân chúng tôi lưu giữ về bạn\n- Yêu cầu xóa dữ liệu của bạn\n- Từ chối thu thập dữ liệu\n- Rút lại sự đồng thuận bất cứ lúc nào\n\nĐể thực hiện các quyền này, liên hệ hung020121@gmail.com.",
    
    // Overview
    overview: "Tổng Quan",
    overviewLoading: "Đang tải tổng quan...",
    overviewTotal: "Tổng số",
    overviewUnknown: "Chưa rõ",
    overviewDone: "Hoàn Thành",
    overviewUnfinished: "Chưa HT",
    overviewWeeks: "Tuần",
    overviewNoData: "Không có dữ liệu tổng quan.",
    overviewWeekGeneral: "Học phần chưa phân tuần",
    uncategorizedWarning: "{count} mục chưa hoàn thành nằm trong 'Học phần chưa phân tuần'",
    noItemsWithUncategorized: "Không tìm thấy học phần cho tuần này.\n\nMột số giáo viên đăng nội dung mà không gắn tuần học.\nHãy kiểm tra mục 'Học phần chưa phân tuần'.",
    overviewStillLoading: "Canvas vẫn đang tải...",
    overviewThinkingHard: "Canvas đang suy nghĩ rất chậm.",
    overviewDrinkWater: "Hãy đi uống một ly nước. Nó sẽ sớm xong thôi.",
    overviewTryRefresh: "Nếu tình trạng này tiếp diễn, hãy thử làm mới trang.",
    overviewBadDay: "Canvas có thể đang gặp sự cố. Hãy thử lại sau.",
    retry: "Thử lại",
  },
};

// Subject labels with bilingual support
const SUBJECT_LABELS = {
  en: {
    MATHS: "Math",
    PHY: "Physics",
    CHEM: "Chemistry",
    BIO: "Biology",
    IT: "ICT",
    TECH: "Tech",
    GEO: "Geography",
    HIS: "History",
    CIVIC: "Civics",
    GCED: "GCED",
    CLISE: "CLISE",
    NV: "Literature",
    LOCE: "Local Studies",
    CAREER: "Career",
    VNS: "VNH",
    "ESL (GVVN)": "ESL (GVVN)",
    "ESL (GVNN)": "ESL (GVNN)",
    MUS: "Music",
    PE: "Sports",
    ART: "Art",
  },
  vi: {
    MATHS: "Toán",
    PHY: "Vật Lý",
    CHEM: "Hóa Học",
    BIO: "Sinh Học",
    IT: "Tin Học",
    TECH: "Công Nghệ",
    GEO: "Địa Lý",
    HIS: "Lịch Sử",
    CIVIC: "GDCD",
    GCED: "GCED",
    CLISE: "CLISE",
    NV: "Ngữ Văn",
    LOCE: "ND-GDĐP",
    CAREER: "HĐTN-HN",
    VNS: "VNH",
    "ESL (GVVN)": "ESL (GVVN)",
    "ESL (GVNN)": "ESL (GVNN)",
    MUS: "Âm Nhạc",
    PE: "Thể Chất",
    ART: "Mỹ Thuật",
  },
};

const DEFAULT_TIMETABLE = {
  monday: [
    { period: "p1", subject: "GEO" },
    { period: "p2", subject: "PHY" },
    { period: "p3", subject: "ESL (GVNN)" },
    { period: "p4", subject: "ESL (GVNN)" },
    { period: "p5", subject: "MUS" },
    { period: "p6", subject: "NV" },
    { period: "p7", subject: "VNS" },
  ],
  tuesday: [
    { period: "p1", subject: "ESL (GVVN)" },
    { period: "p2", subject: "ESL (GVVN)" },
    { period: "p3", subject: "MATHS" },
    { period: "p4", subject: "MATHS" },
    { period: "p5", subject: "PHY" },
    { period: "p6", subject: "PE" },
    { period: "p7", subject: "CLISE" },
  ],
  wednesday: [
    { period: "p1", subject: "ESL (GVVN)" },
    { period: "p2", subject: "ESL (GVVN)" },
    { period: "p3", subject: "NV" },
    { period: "p4", subject: "GCED" },
    { period: "p5", subject: "ESL (GVNN)" },
    { period: "p6", subject: "MATHS" },
    { period: "p7", subject: "MATHS" },
  ],
  thursday: [
    { period: "p1", subject: "PE" },
    { period: "p2", subject: "NV" },
    { period: "p3", subject: "NV" },
    { period: "p4", subject: "MATHS" },
    { period: "p5", subject: "PHY" },
    { period: "p6", subject: "ESL (GVNN)" },
    { period: "p7", subject: "ESL (GVNN)" },
  ],
  friday: [
    { period: "p1", subject: "GCED" },
    { period: "p2", subject: "PHY" },
    { period: "p3", subject: "PHY" },
    { period: "p4", subject: "HIS" },
    { period: "p5", subject: "ESL (GVVN)" },
    { period: "p6", subject: "IT" },
    { period: "p7", subject: "IT" },
  ],
};

// ── E-Book Library Resource Card ───────────────────────────────
// Official NXBGD Grade 10 digital textbooks, keyed by translation key.
// Add new subjects to this array — the desktop hover grid and the mobile
// modal both render automatically and wrap via CSS Grid.
const EBOOK_SUBJECTS = [
  { key: "literature", icon: "📖", url: "https://taphuan.nxbgd.vn/tap-huan/doc-sach/sgk-ngu-van-10-tap-mot.4700658723#page=0" },
  { key: "geography", icon: "🌍", url: "https://taphuan.nxbgd.vn/tap-huan/doc-sach/sgk-dia-li-10.4700970617#page=0" },
  { key: "history", icon: "📜", url: "https://taphuan.nxbgd.vn/tap-huan/doc-sach/sgk-lich-su-10.4755748913#page=0" },
];

let ebookHoverDisabled = false;

// True on touch-first hardware where :hover is not meaningful.
function isEbookHoverDisabled() {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  // A touch-first device either can't hover, has a coarse pointer, or exposes
  // touch points. Any of these should switch the card to tap→modal behaviour.
  const hoverNone = window.matchMedia("(hover: none)").matches;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const touchPoints = typeof navigator !== "undefined" && !!navigator.maxTouchPoints
    ? navigator.maxTouchPoints > 0
    : false;
  return hoverNone || coarse || touchPoints;
}

// Build a fresh, localized subject link element.
function createEbookSubjectLink(subject) {
  const label = t(subject.key);
  const link = document.createElement("a");
  link.className = "ebook_subject_link";
  link.href = subject.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("aria-label", `${label} — ${t("open_ebook_library")}`);
  link.textContent = `${subject.icon} ${label}`;
  return link;
}

// (Re)renders the title/description, the desktop hover-grid links, the open
// modal's list (if present), and (re)applies the card's role/cursor for the
// current input modality. Called on first paint and after every language switch.
function renderEbookLibrary() {
  ebookHoverDisabled = isEbookHoverDisabled();

  const title = document.getElementById("ebook_library_title");
  const desc = document.getElementById("ebook_library_desc");
  if (title) title.textContent = t("ebook_library");
  if (desc) desc.textContent = t("ebook_library_desc");

  // Desktop hover grid (rebuilt so labels follow language changes)
  const hoverGrid = document.getElementById("ebook_subject_grid");
  if (hoverGrid) {
    hoverGrid.replaceChildren();
    EBOOK_SUBJECTS.forEach((s) => hoverGrid.appendChild(createEbookSubjectLink(s)));
  }

  // Mobile modal list (only re-rendered while the modal is open)
  const modalList = document.getElementById("ebook_modal_list");
  if (modalList) {
    modalList.replaceChildren();
    EBOOK_SUBJECTS.forEach((s) => modalList.appendChild(createEbookSubjectLink(s)));
  }

  // Keep card semantics in sync with the input modality.
  const card = document.getElementById("ebook_card");
  if (card) {
    const modalOpen = document.getElementById("ebook_modal") !== null;
    if (ebookHoverDisabled) {
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      card.setAttribute("aria-haspopup", "dialog");
      card.setAttribute("aria-expanded", String(modalOpen));
      card.setAttribute("aria-label", t("open_ebook_library"));
      card.style.cursor = "pointer";
    } else {
      card.removeAttribute("role");
      card.removeAttribute("tabindex");
      card.removeAttribute("aria-haspopup");
      card.setAttribute("aria-label", t("ebook_library"));
      card.style.cursor = "";
    }
  }
}

// Opens the tap-to-open modal (mobile/touch only).
function openEbookModal() {
  if (!ebookHoverDisabled) return;
  if (document.getElementById("ebook_modal")) return;

  const modal = document.createElement("div");
  modal.id = "ebook_modal";
  modal.className = "token_settings_modal ebook_modal";
  prepareModal(modal);

  const content = document.createElement("div");
  content.className = "token_settings_content ebook_modal_content";

  const title = document.createElement("h2");
  title.textContent = t("ebook_library");
  title.style.marginTop = "0";
  content.appendChild(title);

  const list = document.createElement("div");
  list.id = "ebook_modal_list";
  list.className = "ebook_modal_list";
  content.appendChild(list);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "intro_validate_btn";
  closeBtn.style.width = "100%";
  closeBtn.textContent = t("ebook_modal_close");
  closeBtn.addEventListener("click", () => closeEbookModal(modal));
  content.appendChild(closeBtn);

  // Top-right X close (reuses existing shared helper + styling).
  addModalCloseButton(content, () => closeEbookModal(modal));

  modal.appendChild(content);

  // Backdrop click closes the modal.
  modal.setAttribute("data-backdrop-listener", "true");
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeEbookModal(modal);
  });

  document.body.appendChild(modal);
  renderEbookLibrary(); // refresh labels + aria-expanded

  setTimeout(() => closeBtn.focus(), 0);
}

function closeEbookModal(modal) {
  removeModal(modal);
  renderEbookLibrary();
}

// Wire the card as a tap target on touch devices. Runs once on init.
function initEbookCard() {
  const card = document.getElementById("ebook_card");
  if (!card) return;

  card.addEventListener("click", (e) => {
    // On desktop the card is a no-op; only subject links navigate.
    if (!ebookHoverDisabled) return;
    if (e.target.closest(".ebook_subject_link")) return;
    e.preventDefault();
    openEbookModal();
  });

  card.addEventListener("keydown", (e) => {
    if (!ebookHoverDisabled) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openEbookModal();
    }
  });
}

function loadTimetable() {
  try {
    const stored = storageGet("timetable");
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // ignore parse errors
  }
  // New users start with an empty timetable. The example schedule is only
  // loaded on demand via the "Load Example Schedule" button in edit mode.
  return {};
}

function saveTimetable(timetable) {
  storageSet("timetable", JSON.stringify(timetable));
}

let TIMETABLE = loadTimetable();
let timetableEditMode = false;

const TIMETABLE_DAYS = [
  { key: "monday", labelKey: "monday", index: 1 },
  { key: "tuesday", labelKey: "tuesday", index: 2 },
  { key: "wednesday", labelKey: "wednesday", index: 3 },
  { key: "thursday", labelKey: "thursday", index: 4 },
  { key: "friday", labelKey: "friday", index: 5 },
];

const TIMETABLE_PERIODS = [
  { key: "p1", labelKey: "period1", start: "08:00am", end: "08:45am", type: "class" },
  { key: "p2", labelKey: "period2", start: "08:50am", end: "09:35am", type: "class" },
  { key: "break1", labelKey: "breaktime", start: "09:35am", end: "09:55am", type: "break" },
  { key: "p3", labelKey: "period3", start: "09:55am", end: "10:40am", type: "class" },
  { key: "p4", labelKey: "period4", start: "10:45am", end: "11:30am", type: "class" },
  { key: "p5", labelKey: "period5", start: "11:35am", end: "12:20pm", type: "class" },
  { key: "lunch", labelKey: "lunchBreak", start: "12:20pm", end: "01:30pm", type: "break" },
  { key: "p6", labelKey: "period6", start: "01:35pm", end: "02:20pm", type: "class" },
  { key: "break2", labelKey: "breaktime", start: "02:20pm", end: "02:40pm", type: "break" },
  { key: "p7", labelKey: "period7", start: "02:40pm", end: "03:25pm", type: "class" },
];

const TYPE_ORDER = ["Quiz", "Assignment", "File", "Page"];
const TYPE_LABELS = {
  Quiz: "Quizzes",
  Assignment: "Assignments",
  File: "Files",
  Page: "Pages",
};

// ── Split View Slot System ──────────────────────────────────────
// Split view splits the item-list region into two side-by-side columns
// (panels A and B). The course-pill bar, search box, hub title, and the
// Unfinished/Unknown filter toggles remain SHARED (single DOM, above/beside
// the panels). Each column keeps independent state: selected course, current
// week, loaded items, available weeks, requested overview, and its own
// filter state (though the filter STATE is private per column, the shared
// toggles mirror whichever column is currently active).
//
// When split view is disabled, slot "a" is always active and the globals
// point directly to its state.

let activeSlot = "a";
let splitViewEnabled = storageGet("splitView") === "true";
let _splitViewStructured = false;

// Per-slot state. These are NOT swapped via window; instead we read/write
// them through saveSlotState/restoreSlotState against the globals below.
const _slotState = { a: {}, b: {} };

// Per-slot boolean filter state (independent even though the toggles are shared)
function slotFilterState(slot) {
  const s = _slotState[slot];
  if (s.unfinished === undefined) s.unfinished = false;
  if (s.unknown === undefined) s.unknown = false;
  return s;
}

// Point the per-column `let` DOM refs at the given slot's elements.
function syncActiveDomRefs() {
  if (activeSlot === "b" && itemListB) {
    itemList = itemListB;
    prevWeekBtn = prevWeekBtnB;
    nextWeekBtn = nextWeekBtnB;
    weekInput = weekInputB;
  } else {
    itemList = document.getElementById("item_list");
    prevWeekBtn = document.getElementById("prev_week");
    nextWeekBtn = document.getElementById("next_week");
    weekInput = document.getElementById("week_input");
  }
}

// Mirror the active column's private filter state onto the shared toggles.
function syncFilterCheckboxes() {
  const s = slotFilterState(activeSlot);
  if (unfinishedOnly) unfinishedOnly.checked = !!s.unfinished;
  if (unknownOnly) unknownOnly.checked = !!s.unknown;
}

// Persist the (shared) checkbox states into the active column's private state.
function commitFilterState() {
  const s = slotFilterState(activeSlot);
  s.unfinished = unfinishedOnly.checked;
  s.unknown = unknownOnly.checked;
}

// Whether the current slot's cache is the "unfinished" scoped one.
function getActiveFilterBools() {
  const s = slotFilterState(activeSlot);
  return { unfinished: !!s.unfinished, unknown: !!s.unknown };
}

// Save the active global state into the given slot's record.
function saveSlotState(slot) {
  const s = _slotState[slot];
  s.selectedCourseId = selectedCourseId;
  s.currentWeek = currentWeek;
  s.availableWeeks = availableWeeks;
  s.items = items;
  s.overviewData = overviewData || null;
  s.currentRequestController = currentRequestController;
  s.currentOverviewController = currentOverviewController;
  s.overviewLoadingMessageTimer = overviewLoadingMessageTimer;
  s.overviewLoadStartTime = overviewLoadStartTime;
  // Preserve filter state (already stored on the record; kept independent)
}

// Load a slot's saved state into the globals (used when switching).
function restoreSlotState(slot) {
  const s = _slotState[slot];
  selectedCourseId = s.selectedCourseId !== undefined ? s.selectedCourseId : null;
  currentWeek = s.currentWeek !== undefined ? s.currentWeek : (() => {
    const w = Number(storageGet("selectedWeek"));
    return Number.isFinite(w) ? w : 36;
  })();
  availableWeeks = s.availableWeeks !== undefined ? s.availableWeeks : [];
  items = s.items !== undefined ? s.items : [];
  overviewData = s.overviewData !== undefined ? s.overviewData : null;
  currentRequestController = s.currentRequestController || null;
  currentOverviewController = s.currentOverviewController || null;
  overviewLoadingMessageTimer = s.overviewLoadingMessageTimer || null;
  overviewLoadStartTime = s.overviewLoadStartTime || 0;
  syncActiveDomRefs();
  syncFilterCheckboxes();
}

// ── Slot Switching ──────────────────────────────────────────────

function switchToSlot(newSlot) {
  if (newSlot === activeSlot) return;
  saveSlotState(activeSlot);
  activeSlot = newSlot;
  restoreSlotState(newSlot);
  updateSplitViewActiveIndicator();
  // Re-render the newly active column + shared chrome
  updateColumnHeaders();
  renderWorkView();
  updateSidebarForSlot(newSlot);
}

// ── Split View Enable/Disable ──────────────────────────────────

function updateSplitViewActiveIndicator() {
  if (!splitViewEnabled) return;
  const panelA = document.querySelector(".split_panel_a");
  const panelB = document.querySelector(".split_panel_b");
  if (panelA) panelA.classList.toggle("split_panel_active", activeSlot === "a");
  if (panelB) panelB.classList.toggle("split_panel_active", activeSlot === "b");
}

function updateColumnHeaders() {
  if (!splitViewEnabled) return;
  const labels = ["a", "b"];
  for (const slot of labels) {
    const el = slot === "b" ? activeColumnHeaderB : activeColumnHeaderA;
    if (!el) continue;
    const s = _slotState[slot];
    const cid = slot === activeSlot ? selectedCourseId : s.selectedCourseId;
    const course = courses.find((c) => c.id === cid);
    const name = course ? courseShortLabel(course) : "—";
    el.textContent = name;
  }
}

function enableSplitView() {
  const hubContent = document.querySelector(".hub_content");
  if (!hubContent) return;
  const workContent = hubContent.querySelector(".work_content");
  if (!workContent) return;

  // Guard: already enabled
  if (hubContent.classList.contains("hub_content_split")) return;

  // Save current single-column state into slot a
  saveSlotState("a");

  // Initialise slot b (start mirroring slot a's course/week so it isn't empty)
  if (_slotState.b.selectedCourseId === undefined) {
    _slotState.b.selectedCourseId = selectedCourseId;
    _slotState.b.currentWeek = currentWeek;
    _slotState.b.items = [];
    _slotState.b.availableWeeks = [];
    _slotState.b.overviewData = null;
    _slotState.b.unfinished = false;
    _slotState.b.unknown = false;
  }

  hubContent.classList.add("hub_content_split");

  // Keep the shared course pills at the top of work_content, then wrap only
  // the item list + week nav into a split_area with two panels.

  // Capture the existing single item list + week nav (these become panel A).
  const originalItemList = workContent.querySelector("#item_list");
  const originalWeekNav = workContent.querySelector(".week_nav");

  // Create split_area wrapper
  const splitArea = document.createElement("div");
  splitArea.className = "split_area";

  // ── Panel A ──
  const panelA = document.createElement("div");
  panelA.className = "split_panel split_panel_a split_panel_active";

  const headerA = document.createElement("div");
  headerA.className = "split_panel_header";
  activeColumnHeaderA = document.createElement("span");
  activeColumnHeaderA.className = "split_panel_course_label";
  headerA.appendChild(activeColumnHeaderA);
  panelA.appendChild(headerA);

  // Move the existing item_list + week nav into panel A
  const weekNavCloneA = originalWeekNav;
  panelA.appendChild(originalItemList);
  panelA.appendChild(weekNavCloneA);

  // ── Panel B ──
  const panelB = document.createElement("div");
  panelB.className = "split_panel split_panel_b";

  const headerB = document.createElement("div");
  headerB.className = "split_panel_header";
  activeColumnHeaderB = document.createElement("span");
  activeColumnHeaderB.className = "split_panel_course_label";
  headerB.appendChild(activeColumnHeaderB);
  panelB.appendChild(headerB);

  // Clone the item list + week nav for panel B, suffix ids with _b
  const itemListBClone = originalItemList.cloneNode(true);
  const weekNavBClone = originalWeekNav.cloneNode(true);
  itemListBClone.id = "item_list_b";
  itemListBClone.replaceChildren();
  weekNavBClone.id = "week_nav_b";
  weekNavBClone.querySelectorAll("[id]").forEach((el) => {
    el.id = el.id + "_b";
  });
  panelB.appendChild(itemListBClone);
  panelB.appendChild(weekNavBClone);

  // Register panel B refs
  itemListB = itemListBClone;
  weekInputB = weekNavBClone.querySelector("#week_input_b");
  prevWeekBtnB = weekNavBClone.querySelector("#prev_week_b");
  nextWeekBtnB = weekNavBClone.querySelector("#next_week_b");

  // Create divider
  const divider = document.createElement("div");
  divider.className = "split_divider";
  divider.setAttribute("role", "separator");
  divider.setAttribute("aria-label", "Resize split view");
  initDividerDrag(divider);

  splitArea.appendChild(panelA);
  splitArea.appendChild(divider);
  splitArea.appendChild(panelB);

  // Insert split_area after the pills, before the sidebar
  const pills = workContent.querySelector("#course_pills");
  workContent.insertBefore(splitArea, pills.nextSibling);

  activeSlot = "a";
  syncActiveDomRefs();
  syncFilterCheckboxes();
  updateSplitViewActiveIndicator();
  updateColumnHeaders();

  // Render panel A
  renderWorkView();

  // Load slot b
  const savedSlot = activeSlot;
  switchToSlot("b");
  updateColumnHeaders();
  if (selectedCourseId) {
    loadWeeks().then(() => {
      loadItems();
      loadOverview();
    });
  }

  // Switch back to a
  switchToSlot("a");
  updateSidebarForSlot("a");
  initPanelEvents();

  _splitViewStructured = true;
}

function disableSplitView() {
  const hubContent = document.querySelector(".hub_content");
  if (!hubContent) return;
  const workContent = hubContent.querySelector(".work_content");
  if (!workContent) return;

  if (!hubContent.classList.contains("hub_content_split")) return;

  // Save slot b state before removing
  saveSlotState("b");

  hubContent.classList.remove("hub_content_split");

  const splitArea = workContent.querySelector(".split_area");
  const panelA = splitArea ? splitArea.querySelector(".split_panel_a") : null;
  const panelB = splitArea ? splitArea.querySelector(".split_panel_b") : null;

  if (panelA) {
    // Move panel A's item list + week nav back to work_content (after pills)
    const pills = workContent.querySelector("#course_pills");
    const itemListA = panelA.querySelector("#item_list");
    const weekNavA = panelA.querySelector(".week_nav");
    if (itemListA) workContent.insertBefore(itemListA, pills ? pills.nextSibling : null);
    if (weekNavA) workContent.appendChild(weekNavA);
  }

  // Remove split_area (and divider/panel B inside it)
  if (splitArea) splitArea.remove();

  // Clear panel B refs
  itemListB = null;
  prevWeekBtnB = null;
  nextWeekBtnB = null;
  weekInputB = null;
  activeColumnHeaderA = null;
  activeColumnHeaderB = null;

  // Restore active slot to a
  activeSlot = "a";
  syncActiveDomRefs();
  restoreSlotState("a");
  renderWorkView();
  if (selectedCourseId) {
    updateSidebarForSlot("a");
  }
  _splitViewStructured = false;
}

// ── Shared Sidebar Update ──────────────────────────────────────

function updateSidebarForSlot(slot) {
  const state = _slotState[slot] || {};
  const data = slot === activeSlot && overviewData ? overviewData : state.overviewData;
  if (!data) return;
  renderOverview(data);
}

// ── Draggable Divider ──────────────────────────────────────────

function initDividerDrag(divider) {
  let dragging = false;
  let startPos = 0;
  let startPercent = 50;
  let isVertical = true; // true = column layout (desktop), false = row (mobile)

  const savedRatio = Number(storageGet("splitRatio"));
  if (Number.isFinite(savedRatio) && savedRatio > 20 && savedRatio < 80) {
    const splitArea = document.querySelector(".split_area");
    if (splitArea) {
      splitArea.style.gridTemplateColumns = `${savedRatio}% auto ${100 - savedRatio}%`;
    }
  }

  function applyColumns(percent) {
    const splitArea = document.querySelector(".split_area");
    if (!splitArea) return;
    splitArea.style.gridTemplateColumns = `${percent}% auto ${100 - percent}%`;
  }

  function onPointerDown(e) {
    const point = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0].clientX) || 0;
    dragging = true;
    isVertical = divider.offsetWidth >= divider.offsetHeight;
    startPos = point;
    const splitArea = document.querySelector(".split_area");
    if (splitArea) {
      startPercent = 50;
    }
    divider.classList.add("dragging");
    document.body.style.cursor = isVertical ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!dragging) return;
    const point = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0].clientX) || 0;
    const splitArea = document.querySelector(".split_area");
    if (!splitArea) return;
    if (isVertical) {
      const total = splitArea.offsetWidth;
      const delta = point - startPos;
      const deltaPercent = (delta / total) * 100;
      let newPercent = Math.max(20, Math.min(80, startPercent + deltaPercent));
      applyColumns(newPercent);
    }
  }

  function onPointerUp() {
    if (!dragging) return;
    dragging = false;
    divider.classList.remove("dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    const splitArea = document.querySelector(".split_area");
    if (splitArea && isVertical) {
      const cols = splitArea.style.gridTemplateColumns;
      const firstCol = parseFloat(cols.split(" ")[0]);
      const totalWidth = splitArea.offsetWidth;
      const ratio = Math.round((firstCol / totalWidth) * 100);
      storageSet("splitRatio", String(ratio));
    }
  }

  divider.addEventListener("mousedown", onPointerDown);
  divider.addEventListener("touchstart", onPointerDown, { passive: false });
  document.addEventListener("mousemove", onPointerMove);
  document.addEventListener("touchmove", onPointerMove, { passive: false });
  document.addEventListener("mouseup", onPointerUp);
  document.addEventListener("touchend", onPointerUp);

  divider.addEventListener("dblclick", () => {
    applyColumns(50);
    storageSet("splitRatio", "50");
  });
}

// ── Per-Panel Event Routing ────────────────────────────────────

function initPanelEvents() {
  if (!splitViewEnabled) return;
  const panelA = document.querySelector(".split_panel_a");
  const panelB = document.querySelector(".split_panel_b");

  if (panelA) {
    panelA.addEventListener("mousedown", (e) => {
      if (activeSlot !== "a") switchToSlot("a");
    });
  }
  if (panelB) {
    panelB.addEventListener("mousedown", (e) => {
      if (activeSlot !== "b") switchToSlot("b");
    });
  }

  // Panel B week nav
  if (prevWeekBtnB) prevWeekBtnB.addEventListener("click", (e) => { e.stopPropagation(); switchToSlot("b"); changeWeek(-1); });
  if (nextWeekBtnB) nextWeekBtnB.addEventListener("click", (e) => { e.stopPropagation(); switchToSlot("b"); changeWeek(1); });
  if (weekInputB) {
    weekInputB.addEventListener("change", (e) => {
      e.stopPropagation();
      switchToSlot("b");
      const val = Number(weekInputB.value);
      if (Number.isFinite(val) && val >= 0) {
        currentWeek = val;
        storageSet("selectedWeek", String(currentWeek));
        updateWeekNav();
        loadItems();
      }
    });
    weekInputB.addEventListener("blur", (e) => {
      e.stopPropagation();
      switchToSlot("b");
      applyWeekFromInput();
    });
  }
}

let items = [];
let courses = [];
let subjectCounts = new Map();
let availableWeeks = [];
let selectedCourseId = null;
let currentWeek = (() => { const w = Number(storageGet("selectedWeek")); return Number.isFinite(w) ? w : 36; })();
let coursesLoaded = false;
let itemCache = new Map();
let timetableMobileView = storageGet("timetableMobileView") || "today";
let currentRequestController = null; // For cancelling stale requests
let currentOverviewController = null; // For cancelling stale overview requests
let overviewLoadingMessageTimer = null; // For progressive loading messages
let overviewLoadStartTime = 0; // Tracks when overview loading started

// Parsed storage caches (invalidated on writes)
let _cachedCustomSubjectLabels = null;

// Client-side API response cache to reduce duplicate requests
// Key: URL, Value: { data, timestamp }
const apiResponseCache = new Map();
const API_CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds
const API_CACHE_MAX_SIZE = 500;

function apiCacheSet(key, data) {
  if (apiResponseCache.size >= API_CACHE_MAX_SIZE) {
    const oldestKeys = [...apiResponseCache.keys()].slice(0, Math.floor(API_CACHE_MAX_SIZE * 0.2));
    oldestKeys.forEach(k => apiResponseCache.delete(k));
  }
  apiResponseCache.set(key, { data, timestamp: Date.now() });
}

function apiCacheGet(key) {
  const cached = apiResponseCache.get(key);
  if (cached && Date.now() - cached.timestamp < API_CACHE_TTL) {
    return cached.data;
  }
  if (cached) apiResponseCache.delete(key);
  return undefined;
}

function clearApiCache() {
  apiResponseCache.clear();
  debugLog("API response cache cleared");
}

// ── Overview state ─────────────────────────────────────────────
let overviewData = null;
let courseProgress = new Map(); // course_id -> { done, total }
// Load persisted course progress so bars survive refresh
loadCourseProgress();

// Vietnamese full subject names (grade 10 course_code/name format, e.g.
// "HANGVM5-CÔNG DÂN TOÀN CẦU-10-2026 - 2027") map to canonical subject keys
// so SUBJECT_LABELS resolves them. Extend this map as more grade-10 courses
// are encountered.
const SUBJECT_NAME_TO_KEY = {
  "CÔNG DÂN TOÀN CẦU": "GCED",
  "VẬT LÝ" : "PHY",
  "LỊCH SỬ" : "HIS",
  "ĐỊA LÝ" : "GEO",
  "GIÁO DỤC THỂ CHẤT" : "PE",
  "NGỮ VĂN" : "NV",
  "CÔNG NGHỆ THÔNG TIN" : "IT",
  "VIỆT NAM HỌC" : "VNS",
  "GIÁO DỤC KỸ NĂNG PHẨM CHẤT" : "CLISE",
  "TOÁN" : "MATHS",
  "ÂM NHẠC" : "MUS",
  "SINH HỌC" : "BIO",
  "HÓA HỌC" : "CHEM",
  "MĨ THUẬT" : "ART",
  "ENGLISH (LOCAL TEACHERS)" : "ESL (GVVN)",
  "ENGLISH (FOREIGN TEACHERS)" : "ESL (GVNN)",
  "CÔNG NGHỆ" : "TECH",
  "GIÁO DỤC KINH TẾ VÀ PHÁP LUẬT": "GDKT-PL",
  "HOẠT ĐỘNG TRẢI NGHIỆM, HƯỚNG NGHIỆP": "CAREER"
};

function courseSubjectKey(course) {
  const parts = (course.course_code || "").split("-");
  if (parts.length < 2) {
    return null;
  }
  const raw = parts[1].trim();
  // Map Vietnamese full subject names to canonical English keys. For the
  // THPT format (e.g. "TRANGPT68-HÓA HỌC-10-THPT-OCEAN PARK-2026 - 2027")
  // parts[1] is the Vietnamese subject name which gets mapped via
  // SUBJECT_NAME_TO_KEY.
  return SUBJECT_NAME_TO_KEY[raw] || raw || null;
}

// Fallback subject resolution when a course_code does not yield a subject key.
// Tries to map a Vietnamese subject name found in the course name to its key.
function resolveNameSubject(course) {
  const token = (course.name || "").split("-")[1]?.trim();
  if (!token) {
    return null;
  }
  const key = SUBJECT_NAME_TO_KEY[token] || token;
  return getSubjectLabel(key) || null;
}

function courseTeacherCode(course) {
  const parts = (course.name || "").split("-");
  return parts.length >= 3 ? parts[2] : null;
}

function rebuildSubjectCounts() {
  subjectCounts = new Map();
  for (const course of courses) {
    const key = courseSubjectKey(course);
    if (key) {
      subjectCounts.set(key, (subjectCounts.get(key) || 0) + 1);
    }
  }
}

function courseShortLabel(course) {
  const subjectKey = courseSubjectKey(course);
  const subject = subjectKey
    ? getSubjectLabel(subjectKey)
    : resolveNameSubject(course) || `Course ${course.id}`;

  if ((subjectCounts.get(subjectKey) || 0) > 1) {
    const teacher = courseTeacherCode(course);
    if (teacher) {
      return `${subject} · ${teacher.slice(0, 6)}`;
    }
  }

  return subject;
}

function apiFetch(url, options = {}) {
  const token = getToken();
  const headers = {
    ...(options.headers || {}),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return fetch(url, { ...options, headers });
}


async function fetchJson(url, options = {}) {
  debugLog("fetchJson: calling", url);
  
  // Check client-side cache first (only for GET requests)
  if (options.method === undefined || options.method === "GET") {
    const cached = apiCacheGet(url);
    if (cached !== undefined) {
      debugLog("fetchJson: cache hit for", url);
      return cached;
    }
  }
  
  const response = await apiFetch(url, options);
  debugLog("fetchJson: response status", response.status, "for", url);

  if (response.headers.get("X-Offline") === "true") {
    debugLog("fetchJson: offline response served from cache for", url);
    showOfflineBanner();
  } else {
    hideOfflineBanner();
  }

  if (!response.ok) {
    const dataText = await response.text();
    let data;
    try { data = JSON.parse(dataText); } catch { data = { error: dataText }; }
    debugLog("fetchJson: error response body", data);

    if (response.status === 401) {
      // Token expired or invalid - clear it and show intro
      debugLog("fetchJson: got 401, clearing token and showing intro overlay");
      clearToken();
      clearApiCache();
      showIntroOverlay();
    }
    throw new Error(data.error || "Request failed.");
  }

  const data = await response.json();
  
  // Cache successful GET responses
  if (options.method === undefined || options.method === "GET") {
    apiCacheSet(url, data);
  }
  
  return data;
}

// ── Offline banner ─────────────────────────────────────────────
// Shown when the service worker serves cached data with X-Offline: true.

let offlineBannerShown = false;

function showOfflineBanner() {
  if (offlineBannerShown) return;
  offlineBannerShown = true;

  let banner = document.getElementById("offline_banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "offline_banner";
    banner.className = "offline_banner";
    banner.setAttribute("role", "status");
    const text = document.createElement("span");
    text.className = "offline_banner_text";
    text.textContent = t("offlineBanner");
    banner.appendChild(text);
    document.body.appendChild(banner);
  }
  banner.hidden = false;
}

function hideOfflineBanner() {
  if (!offlineBannerShown) return;
  offlineBannerShown = false;
  const banner = document.getElementById("offline_banner");
  if (banner) banner.hidden = true;
}

window.addEventListener("online", hideOfflineBanner);

function showMessage(text) {
  itemList.innerHTML = "";
  const message = document.createElement("p");
  message.className = "empty_message";
  message.textContent = text;
  itemList.appendChild(message);
}

function showErrorMessage(text, retryFn) {
  itemList.innerHTML = "";
  const message = document.createElement("p");
  message.className = "error_message";
  message.textContent = text;
  itemList.appendChild(message);

  if (retryFn) {
    const retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.className = "error_retry_btn";
    retryBtn.textContent = t("retry");
    retryBtn.addEventListener("click", () => {
      showSkeletonLoading();
      retryFn();
    });
    itemList.appendChild(retryBtn);
  }
}

function showSkeletonPills(count = 4) {
  coursePills.replaceChildren();
  for (let i = 0; i < count; i++) {
    const pill = document.createElement("div");
    pill.className = "course_pill_skeleton";
    coursePills.appendChild(pill);
  }
}

function showSkeletonLoading() {
  itemList.innerHTML = "";
  const skeletonCount = 6;
  for (let i = 0; i < skeletonCount; i++) {
    const skeleton = document.createElement("div");
    skeleton.className = "skeleton_item";
    
    const title = document.createElement("div");
    title.className = "skeleton_title";
    
    const meta = document.createElement("div");
    meta.className = "skeleton_meta";
    
    const badge = document.createElement("div");
    badge.className = "skeleton_badge";
    
    skeleton.append(title, meta, badge);
    itemList.appendChild(skeleton);
  }
}

function setFiltersEnabled(enabled) {
  if (unfinishedOnly) unfinishedOnly.disabled = !enabled;
  if (unknownOnly) unknownOnly.disabled = !enabled;
}

function itemMatchesSearch(item, query) {
  if (!query) {
    return true;
  }

  return [item.title, item.module, item.type, item.course_name]
    .join(" ")
    .toLowerCase()
    .includes(query);
}

// Keywords that indicate an item is important for scoring
const IMPORTANT_KEYWORDS = [
  "HKII", "HKI", "HK1", "HK2",
  "học kỳ 1", "học kì 1", "học kỳ 2", "học kì 2",
  "cuối năm",
  "hệ số 1", "hệ số 2", "hệ số 3",
  "HS1", "HS2", "HS3",
];

function isItemImportant(item) {
  const text = [item.title, item.module].join(" ").toLowerCase();
  return IMPORTANT_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase()));
}

// ── Manual Completion Override System ──────────────────────────
// Stores a map of item key -> true (manually marked done)
// Item key format: `${course_id}:${module_item_id}`

let _cachedManualCompletions = null;

function getManualCompletions() {
  if (_cachedManualCompletions === null) {
    try {
      const stored = storageGet("manual_completions");
      _cachedManualCompletions = stored ? JSON.parse(stored) : {};
    } catch {
      _cachedManualCompletions = {};
    }
  }
  return _cachedManualCompletions;
}

function saveManualCompletion(itemKey, completed) {
  const completions = getManualCompletions();
  if (completed) {
    completions[itemKey] = true;
  } else {
    delete completions[itemKey];
  }
  storageSet("manual_completions", JSON.stringify(completions));
}

function isManuallyCompleted(item) {
  const completions = getManualCompletions();
  const key = `${item.course_id}:${item.module_item_id}`;
  return completions[key] === true;
}

function getEffectiveCompletion(item) {
  // Manual override takes precedence
  if (isManuallyCompleted(item)) {
    return true;
  }
  return item.completed;
}

function saveCourseProgress() {
  try {
    const obj = {};
    courseProgress.forEach((v, k) => { obj[k] = v; });
    storageSet("course_progress", JSON.stringify(obj));
  } catch {
    // ignore quota errors
  }
}

function loadCourseProgress() {
  try {
    const stored = storageGet("course_progress");
    if (stored) {
      const obj = JSON.parse(stored);
      Object.entries(obj).forEach(([k, v]) => {
        if (v && Number.isFinite(v.done) && Number.isFinite(v.total)) {
          courseProgress.set(Number(k), { done: v.done, total: v.total });
        }
      });
    }
  } catch {
    // ignore parse errors
  }
}

function refreshOverviewFromState() {
  if (!overviewData) return;
  const adjusted = applyManualCompletionsToOverview(overviewData);
  if (adjusted && adjusted.totals) {
    courseProgress.set(selectedCourseId, {
      done: adjusted.totals.done || 0,
      total: adjusted.totals.total || 0,
    });
    saveCourseProgress();
    renderCoursePills();
  }
  renderOverview(adjusted);
}

function clearOverviewLoadingMessageTimer() {
  if (overviewLoadingMessageTimer) {
    clearTimeout(overviewLoadingMessageTimer);
    overviewLoadingMessageTimer = null;
  }
}

function showOverviewLoadingMessage() {
  const container = document.getElementById("week_overview_list") || document.getElementById("overview_container");
  if (!container) return;

  const elapsed = Date.now() - overviewLoadStartTime;
  let messageKey = "overviewLoading";
  
  if (elapsed >= 40000) {
    messageKey = "overviewBadDay";
  } else if (elapsed >= 32000) {
    messageKey = "overviewTryRefresh";
  } else if (elapsed >= 24000) {
    messageKey = "overviewDrinkWater";
  } else if (elapsed >= 16000) {
    messageKey = "overviewThinkingHard";
  } else if (elapsed >= 8000) {
    messageKey = "overviewStillLoading";
  }

  let loadingMsg = container.querySelector(".overview_loading_message");
  if (!loadingMsg) {
    loadingMsg = document.createElement("p");
    loadingMsg.className = "loading_message overview_loading_message";
    container.appendChild(loadingMsg);
  }
  loadingMsg.textContent = t(messageKey);

  // Schedule next update at the next milestone instead of polling every 1s
  const milestones = [8000, 16000, 24000, 32000, 40000];
  const nextMilestone = milestones.find((m) => m > elapsed);
  if (nextMilestone) {
    const delay = nextMilestone - elapsed;
    overviewLoadingMessageTimer = setTimeout(showOverviewLoadingMessage, delay);
  }
}

function showOverviewError(message, retryFn) {
  const container = document.getElementById("week_overview_list");
  if (!container) return;

  container.replaceChildren();

  const errorEl = document.createElement("p");
  errorEl.className = "error_message";
  errorEl.textContent = message;
  container.appendChild(errorEl);

  if (retryFn) {
    const retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.className = "error_retry_btn";
    retryBtn.textContent = t("retry");
    retryBtn.addEventListener("click", () => {
      showOverviewSkeleton();
      retryFn();
    });
    container.appendChild(retryBtn);
  }
}

function normalizeOverviewWeek(weekSummary) {
  return {
    ...weekSummary,
    typeCounts: weekSummary.typeCounts || weekSummary.type_counts || {},
  };
}

function normalizeOverviewData(data) {
  return {
    courseName: data.courseName || data.course_name,
    weeks: (data.weeks || []).map(normalizeOverviewWeek),
    totals: data.totals || {},
    uncategorized_unfinished_count: data.uncategorized_unfinished_count || 0,
  };
}

function createItemRow(item, isLastInType) {
  const row = document.createElement("div");
  row.className = "item_row item_row_animate";

  if (isItemImportant(item)) {
    row.classList.add("item_row_important");
  }

  const content = document.createElement("div");
  content.className = "item_content";

  const title = document.createElement("h3");
  title.className = "item_title";

  if (item.url) {
    const link = document.createElement("a");
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = item.title;
    title.appendChild(link);
  } else {
    title.textContent = item.title;
  }

  const meta = document.createElement("p");
  meta.className = "item_meta";
  const treePrefix = document.createElement("span");
  treePrefix.className = "item_tree_prefix";
  treePrefix.textContent = isLastInType ? "\u2514\u2500\u2500 " : "\u251C\u2500\u2500 ";
  meta.appendChild(treePrefix);
  meta.appendChild(document.createTextNode(item.module));

  content.append(title, meta);

  // Badge and manual toggle container
  const badgeGroup = document.createElement("div");
  badgeGroup.className = "item_badge_group";

  const effectiveCompleted = getEffectiveCompletion(item);
  const isUnknown = item.completed === null && !isManuallyCompleted(item);

  const badge = document.createElement("span");
  if (isManuallyCompleted(item)) {
    badge.className = "status_badge status_done status_manual";
    badge.textContent = t("done");
  } else if (effectiveCompleted) {
    badge.className = "status_badge status_done";
    badge.textContent = t("done");
  } else if (isUnknown) {
    badge.className = "status_badge status_unknown";
    badge.textContent = "?";
    badge.title = t("unknown");
    badge.setAttribute("aria-label", t("unknown"));
  } else {
    badge.className = "status_badge status_open";
    badge.textContent = t("unfinished");
  }

  // Manual toggle button (only for items without tracking or not completed)
  if (!isManuallyCompleted(item) && !effectiveCompleted) {
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "manual_done_btn";
    toggleBtn.textContent = "✓";
    toggleBtn.title = "Mark as done";
    toggleBtn.setAttribute("aria-label", "Mark as done");
    toggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = `${item.course_id}:${item.module_item_id}`;
      
      // Optimistic UI update - immediately show as done
      const newBadge = document.createElement("span");
      newBadge.className = "status_badge status_done status_manual status_pulse";
      newBadge.textContent = t("done");
      
      const undoBtn = document.createElement("button");
      undoBtn.type = "button";
      undoBtn.className = "manual_done_btn manual_done_btn_undo";
      undoBtn.textContent = "↩";
      undoBtn.title = "Undo manual completion";
      undoBtn.setAttribute("aria-label", "Undo manual completion");
      undoBtn.addEventListener("click", (ue) => {
        ue.stopPropagation();
        saveManualCompletion(key, false);
        
        const isUnknown = item.completed === null;
        const restoredBadge = document.createElement("span");
        if (isUnknown) {
          restoredBadge.className = "status_badge status_unknown";
          restoredBadge.textContent = "?";
          restoredBadge.title = t("unknown");
          restoredBadge.setAttribute("aria-label", t("unknown"));
        } else {
          restoredBadge.className = "status_badge status_open";
          restoredBadge.textContent = t("unfinished");
        }
        
        badgeGroup.replaceChildren(restoredBadge, toggleBtn);
        
        updateHubTitle();
        refreshOverviewFromState();
      });
      
      badgeGroup.replaceChildren(newBadge, undoBtn);
      
      // Persist to localStorage in background
      saveManualCompletion(key, true);
      updateHubTitle();
      refreshOverviewFromState();
    });
    badgeGroup.append(badge, toggleBtn);
  } else if (isManuallyCompleted(item)) {
    // Allow undoing manual completion
    const undoBtn = document.createElement("button");
    undoBtn.type = "button";
    undoBtn.className = "manual_done_btn manual_done_btn_undo";
    undoBtn.textContent = "↩";
    undoBtn.title = "Undo manual completion";
    undoBtn.setAttribute("aria-label", "Undo manual completion");
    undoBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = `${item.course_id}:${item.module_item_id}`;
      
      // Optimistic UI update - immediately revert to original state
      const newBadge = document.createElement("span");
      const isUnknown = item.completed === null;
      if (isUnknown) {
        newBadge.className = "status_badge status_unknown";
        newBadge.textContent = "?";
        newBadge.title = t("unknown");
        newBadge.setAttribute("aria-label", t("unknown"));
      } else {
        newBadge.className = "status_badge status_open";
        newBadge.textContent = t("unfinished");
      }
      
      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "manual_done_btn";
      toggleBtn.textContent = "✓";
      toggleBtn.title = "Mark as done";
      toggleBtn.setAttribute("aria-label", "Mark as done");
      toggleBtn.addEventListener("click", (te) => {
        te.stopPropagation();
        const k = `${item.course_id}:${item.module_item_id}`;
        
        const doneBadge = document.createElement("span");
        doneBadge.className = "status_badge status_done status_manual status_pulse";
        doneBadge.textContent = t("done");
        
        const newUndoBtn = document.createElement("button");
        newUndoBtn.type = "button";
        newUndoBtn.className = "manual_done_btn manual_done_btn_undo";
        newUndoBtn.textContent = "↩";
        newUndoBtn.title = "Undo manual completion";
        newUndoBtn.setAttribute("aria-label", "Undo manual completion");
        newUndoBtn.addEventListener("click", (ue2) => {
          ue2.stopPropagation();
          saveManualCompletion(k, false);
          updateHubTitle();
          refreshOverviewFromState();
        });
        
        badgeGroup.replaceChildren(doneBadge, newUndoBtn);
        saveManualCompletion(k, true);
        updateHubTitle();
        refreshOverviewFromState();
      });
      
      badgeGroup.replaceChildren(newBadge, toggleBtn);
      
      // Persist to localStorage in background
      saveManualCompletion(key, false);
      updateHubTitle();
      refreshOverviewFromState();
    });
    badgeGroup.append(badge, undoBtn);
  } else {
    badgeGroup.appendChild(badge);
  }

  row.append(content, badgeGroup);
  return row;
}

function renderItems() {
  const searchQuery = searchInput.value.trim().toLowerCase();
  
  // Precompute effective completion once for all items to avoid redundant calls
  const completionMap = new Map();
  for (const item of items) {
    completionMap.set(item, getEffectiveCompletion(item));
  }
  
  let scopedItems = items;
  if (unfinishedOnly.checked) {
    scopedItems = items.filter((item) => completionMap.get(item) !== true);
  } else if (unknownOnly.checked) {
    scopedItems = items.filter((item) => item.completed === null && !isManuallyCompleted(item));
  }
  const visibleItems = scopedItems.filter((item) => itemMatchesSearch(item, searchQuery));

  if (scopedItems.length === 0) {
    // Check if there are uncategorized modules with items
    const hasUncategorizedItems = overviewData && overviewData.weeks &&
      overviewData.weeks.some(w => w.week === 0 && w.total > 0);
    if (hasUncategorizedItems) {
      showMessage(t("noItemsWithUncategorized"));
    } else {
      showMessage(t("noItemsWeek"));
    }
    return;
  }

  if (visibleItems.length === 0) {
    showMessage(t("noItemsMatch"));
    return;
  }

  itemList.replaceChildren();

  for (const type of TYPE_ORDER) {
    const typeItems = visibleItems.filter((item) => item.type === type);
    if (typeItems.length === 0) {
      continue;
    }

    const section = document.createElement("section");
    section.className = "type_section";

    const heading = document.createElement("h3");
    heading.className = "type_heading";
    heading.textContent = `${TYPE_LABELS[type]} (${typeItems.length})`;

    const list = document.createElement("div");
    list.className = "type_list";
    list.append(...typeItems.map((item, i) => createItemRow(item, i === typeItems.length - 1)));

    section.append(heading, list);
    itemList.append(section);
  }
}

function renderCoursePills() {
  coursePills.replaceChildren(
    ...courses.map((course) => {
      const wrapper = document.createElement("div");
      wrapper.className = "course_pill_wrapper";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "course_pill";
      
      button.textContent = courseShortLabel(course);
      button.title = course.name || course.course_code || "";
      button.setAttribute("aria-label", button.title);
      button.setAttribute("aria-pressed", String(course.id === selectedCourseId));

      if (course.id === selectedCourseId) {
        button.classList.add("course_pill_active");
      }

      if (subjectLabelEditMode) {
        button.style.cursor = "pointer";
        const subjectKey = courseSubjectKey(course);
        button.dataset.subjectKey = subjectKey || "";
        button.dataset.courseId = course.id;
        button.addEventListener("click", (e) => {
          e.stopPropagation();
          const sk = button.dataset.subjectKey;
          if (sk) {
            openSubjectLabelEditor(sk, button);
          }
        });
      } else {
        button.addEventListener("click", () => selectCourse(course.id));
      }

      wrapper.appendChild(button);

      // Progress bar
      const prog = courseProgress.get(course.id);
      if (prog && prog.total > 0) {
        const pct = Math.round((prog.done / prog.total) * 100);
        const bar = document.createElement("div");
        bar.className = "course_progress_bar";
        bar.innerHTML = `<div class="course_progress_fill" style="width:${pct}%"></div>`;
        bar.title = `${prog.done}/${prog.total} (${pct}%)`;
        bar.setAttribute("aria-label", `${prog.done}/${prog.total} (${pct}%)`);
        wrapper.appendChild(bar);
      }
      
      return wrapper;
    })
  );
  
  // Show/hide reset all button in edit mode
  updateSubjectLabelResetBtn();
}

function updateSubjectLabelResetBtn() {
  const existing = document.getElementById("subject_label_reset_all");
  if (existing) existing.remove();
  
  if (subjectLabelEditMode) {
    const resetBtn = document.createElement("button");
    resetBtn.id = "subject_label_reset_all";
    resetBtn.type = "button";
    resetBtn.className = "subject_label_reset_all_btn";
    resetBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-arrow-counterclockwise" viewBox="0 0 16 16">
  <path fill-rule="evenodd" d="M8 3a5 5 0 1 1-4.546 2.914.5.5 0 0 0-.908-.417A6 6 0 1 0 8 2z"/>
  <path d="M8 4.466V.534a.25.25 0 0 0-.41-.192L5.23 2.308a.25.25 0 0 0 0 .384l2.36 1.966A.25.25 0 0 0 8 4.466"/>
</svg>`;
    resetBtn.setAttribute("aria-label", t("subjectLabelsReset"));
    resetBtn.title = t("subjectLabelsReset");
    resetBtn.addEventListener("click", () => {
      if (confirm(t("subjectLabelsResetConfirm"))) {
        resetCustomSubjectLabels();
        subjectLabelEditMode = false;
        updateSubjectLabelEditBtn();
        renderCoursePills();
        renderAll();
      }
    });
    const actionsContainer = document.getElementById("subject_label_actions");
    if (actionsContainer) {
      actionsContainer.appendChild(resetBtn);
    }
  }
}

function updateSubjectLabelEditBtn() {
  if (subjectLabelEditBtn) {
    subjectLabelEditBtn.classList.toggle("subject_label_edit_btn_active", subjectLabelEditMode);
  }
}

function toggleSubjectLabelEditMode() {
  subjectLabelEditMode = !subjectLabelEditMode;
  updateSubjectLabelEditBtn();
  renderCoursePills();
}

// Store references to event handlers for cleanup
let popoverOutsideClickHandler = null;
let popoverEscapeKeyHandler = null;

function openSubjectLabelEditor(subjectKey, pillElement) {
  // Close any existing editor
  closeSubjectLabelEditor();

  const currentCustom = getCustomSubjectLabels();
  const entry = currentCustom[subjectKey] || {};
  const currentLabel = entry.label || "";
  const defaultLabel = SUBJECT_LABELS[currentLanguage]?.[subjectKey] || subjectKey;

  const popover = document.createElement("div");
  popover.className = "subject_label_popover";

  // Rename input
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "subject_label_inline_input";
  nameInput.placeholder = defaultLabel;
  nameInput.value = currentLabel;
  nameInput.setAttribute("aria-label", `${t("subjectLabelsRename")} ${subjectKey}`);

  // Buttons
  const btnRow = document.createElement("div");
  btnRow.className = "subject_label_inline_btns";

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "timetable_editor_btn";
  saveBtn.textContent = t("subjectLabelsSave");
  saveBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const newLabel = nameInput.value.trim();
    setSubjectCustomization(subjectKey, newLabel);
    closeSubjectLabelEditor();
    renderCoursePills();
    renderAll();
    // Re-enter edit mode after re-render
    subjectLabelEditMode = true;
    updateSubjectLabelEditBtn();
    renderCoursePills();
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "timetable_editor_btn";
  cancelBtn.textContent = t("subjectLabelsCancel");
  cancelBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeSubjectLabelEditor();
  });

  const resetDefaultBtn = document.createElement("button");
  resetDefaultBtn.type = "button";
  resetDefaultBtn.className = "timetable_editor_btn";
  resetDefaultBtn.textContent = t("subjectLabelsResetDefault");
  resetDefaultBtn.setAttribute("aria-label", t("subjectLabelsResetDefault"));
  resetDefaultBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setSubjectCustomization(subjectKey, "");
    closeSubjectLabelEditor();
    renderCoursePills();
    renderAll();
    // Re-enter edit mode after re-render
    subjectLabelEditMode = true;
    updateSubjectLabelEditBtn();
    renderCoursePills();
  });

  btnRow.append(saveBtn, cancelBtn, resetDefaultBtn);
  popover.append(nameInput, btnRow);

  // Append to body and position
  document.body.appendChild(popover);
  positionPopoverBelow(popover, pillElement);

  // Auto-focus the input
  setTimeout(() => nameInput.focus(), 0);

  // Setup click-outside and escape key handlers
  initPopoverCloseHandlers(popover, pillElement);
}

function positionPopoverBelow(popover, anchorElement) {
  const rect = anchorElement.getBoundingClientRect();

  // The popover is position: fixed, so getBoundingClientRect() is already
  // viewport-relative — adding scroll offsets would double-count on scroll.
  let top = rect.bottom + 8;
  let left = rect.left;

  // Get popover width for boundary check (use estimated width since popover isn't rendered yet)
  const estimatedWidth = Math.min(280, Math.round(rect.width || 0) + 40);

  // Ensure popover doesn't go off-screen on the right
  const maxLeft = window.innerWidth - estimatedWidth - 16;
  if (left > maxLeft) {
    left = Math.max(16, maxLeft);
  }
  
  popover.style.top = `${top}px`;
  popover.style.left = `${left}px`;
}

function initPopoverCloseHandlers(popover, anchorElement) {
  // Click outside to close
  popoverOutsideClickHandler = function(e) {
    if (!popover.contains(e.target) && e.target !== anchorElement) {
      closeSubjectLabelEditor();
    }
  };
  
  // Escape key to close
  popoverEscapeKeyHandler = function(e) {
    if (e.key === "Escape") {
      closeSubjectLabelEditor();
    }
  };
  
  // Add event listeners
  document.addEventListener("mousedown", popoverOutsideClickHandler);
  document.addEventListener("touchstart", popoverOutsideClickHandler);
  document.addEventListener("keydown", popoverEscapeKeyHandler);
}

function closeSubjectLabelEditor() {
  const popover = document.querySelector(".subject_label_popover");
  if (popover) {
    popover.remove();
  }
  // Remove event listeners
  if (popoverOutsideClickHandler) {
    document.removeEventListener("mousedown", popoverOutsideClickHandler);
    document.removeEventListener("touchstart", popoverOutsideClickHandler);
    popoverOutsideClickHandler = null;
  }
  if (popoverEscapeKeyHandler) {
    document.removeEventListener("keydown", popoverEscapeKeyHandler);
    popoverEscapeKeyHandler = null;
  }
}

function updateWeekNav() {
  const weekIndex = availableWeeks.indexOf(currentWeek);

  weekInput.value = currentWeek != null ? String(currentWeek) : "";

  if (weekIndex < 0) {
    // Current week is not in available weeks, enable arrows to jump to nearest valid week
    prevWeekBtn.disabled = availableWeeks.length === 0;
    nextWeekBtn.disabled = availableWeeks.length === 0;
  } else {
    prevWeekBtn.disabled = weekIndex <= 0;
    nextWeekBtn.disabled = weekIndex >= availableWeeks.length - 1;
  }
}

function weekApiPath(courseId, week, bustCache = false) {
  let suffix = "";
  if (unfinishedOnly.checked) suffix = "/unfinished";
  const url = `/api/courses/${courseId}/week/${week}${suffix}`;
  if (bustCache) {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}_t=${Date.now()}`;
  }
  return url;
}

// Track whether the initial page load has completed.
// Used to ensure cache-busting only happens on actual reloads, not week navigation.
let _initialLoadBustCache = true;

function updateHubTitle() {
  const course = courses.find((entry) => entry.id === selectedCourseId);
  const courseLabel = course ? courseShortLabel(course) : "Course";
  let itemCount = items.length;
  let scope;
  if (unfinishedOnly.checked) {
    itemCount = items.filter((item) => getEffectiveCompletion(item) !== true).length;
    scope = t("unfinished");
  } else if (unknownOnly.checked) {
    itemCount = items.filter((item) => item.completed === null && !isManuallyCompleted(item)).length;
    scope = t("unknown");
  } else {
    scope = `${itemCount} ${t("items")}`;
  }
  const weekLabel = currentWeek === 0 ? t("general") : `${t("week")} ${currentWeek}`;
  hubTitle.textContent = `${courseLabel} · ${weekLabel} · ${scope}`;
}

async function loadCourses() {
  if (coursesLoaded) {
    // Keep the work view in sync when returning from overview cards, tabs, or language changes.
    if (selectedCourseId) {
      // Run items and overview in parallel since they are independent
      await Promise.all([
        loadItems(),
        loadOverview(),
      ]);
    }
    return;
  }

  // Initial course load: bust cache to ensure fresh completion data from Canvas
  const bustCache = _initialLoadBustCache;
  _initialLoadBustCache = false;

  showSkeletonPills();
  showSkeletonLoading();

  try {
    const data = await fetchJson("/api/courses");
    courses = data.courses;
    coursesLoaded = true;

    if (courses.length === 0) {
      showMessage(t("noActiveCourses"));
      return;
    }

    rebuildSubjectCounts();
    courses.sort((a, b) => courseShortLabel(a).localeCompare(courseShortLabel(b)));

    const savedCourseId = Number(storageGet("selectedCourseId"));
    selectedCourseId = courses.find((course) => course.id === savedCourseId)?.id ?? courses[0].id;

    renderCoursePills();
    await loadWeeks();
    
    // Run items and overview in parallel since they are independent
    await Promise.all([
      loadItems(bustCache),
      loadOverview(bustCache),
    ]);

    // Seed slot B once split view is structured (initial load happens before
    // courses are available, so both slots need populating here).
    if (splitViewEnabled && _splitViewStructured) {
      if (!_slotState.b.selectedCourseId) {
        _slotState.b.selectedCourseId = selectedCourseId;
        _slotState.b.currentWeek = currentWeek;
      }
      switchToSlot("b");
      updateColumnHeaders();
      await loadWeeks();
      await Promise.all([loadItems(), loadOverview()]);
      switchToSlot("a");
      updateSidebarForSlot("a");
    }
  } catch (error) {
    showErrorMessage(error.message, () => loadCourses());
  }
}

async function loadWeeks() {
  // Weeks list itself is small and rarely changes; no cache-bust needed.
  if (!selectedCourseId) {
    return;
  }

  try {
    const data = await fetchJson(`/api/courses/${selectedCourseId}/weeks`);
    availableWeeks = data.weeks;

    if (availableWeeks.length > 0 && !availableWeeks.includes(currentWeek)) {
      currentWeek = availableWeeks.at(-1);
      storageSet("selectedWeek", String(currentWeek));
    }
  } catch (error) {
    availableWeeks = [];
    showErrorMessage(error.message, () => loadWeeks());
    throw error;
  }

  updateWeekNav();
}

async function loadItems(bustCache = false) {
  if (!selectedCourseId || (currentWeek !== 0 && !currentWeek)) {
    return;
  }

  const cacheKey = `${selectedCourseId}:${currentWeek}:${unfinishedOnly.checked}:${unknownOnly.checked}`;
  
  if (itemCache.has(cacheKey)) {
    items = itemCache.get(cacheKey);
    updateHubTitle();
    updateWeekNav();
    renderItems();
    return;
  }

  showSkeletonLoading();
  setFiltersEnabled(false);

  // Cancel any previous request to prevent race conditions
  if (currentRequestController) {
    currentRequestController.abort();
  }
  currentRequestController = new AbortController();
  
  // Add a "still loading" message after 10 seconds for slow Canvas responses
  const loadItemsTimeout = setTimeout(() => {
    if (itemList.querySelector('.skeleton_item')) {
      itemList.innerHTML = "";
      const stillLoading = document.createElement("p");
      stillLoading.className = "loading_message";
      stillLoading.textContent = t("overviewStillLoading");
      itemList.appendChild(stillLoading);
    }
  }, 10000);

  try {
    const data = await fetchJson(weekApiPath(selectedCourseId, currentWeek, bustCache), {
      signal: currentRequestController.signal
    });
    clearTimeout(loadItemsTimeout);
    items = data.items;
    updateHubTitle();
    updateWeekNav();
    renderItems();
  } catch (error) {
    clearTimeout(loadItemsTimeout);
    if (error.name !== 'AbortError') {
      showErrorMessage(error.message, () => loadItems());
    }
  } finally {
    currentRequestController = null;
    setFiltersEnabled(true);
  }
}

async function selectCourse(courseId) {
  if (subjectLabelEditMode) return; // Don't switch courses in edit mode
  selectedCourseId = courseId;
  if (splitViewEnabled) {
    _slotState[activeSlot].selectedCourseId = courseId;
  }
  storageSet("selectedCourseId", String(courseId));
  renderCoursePills();
  showSkeletonLoading();
  setFiltersEnabled(false);
  await loadWeeks();
  
  // Run items and overview in parallel since they are independent
  await Promise.all([
    loadItems(),
    loadOverview(),
  ]);
  setFiltersEnabled(true);

  // Update the shared sidebar when in split view
  if (splitViewEnabled) {
    updateSidebarForSlot(activeSlot);
    updateColumnHeaders();
  }
}

function changeWeek(delta) {
  if (availableWeeks.length === 0) return;

  // Find where currentWeek would be inserted (first week >= currentWeek)
  let insertPoint = availableWeeks.findIndex((w) => w >= currentWeek);
  if (insertPoint < 0) insertPoint = availableWeeks.length;

  let targetIndex;
  if (delta > 0) {
    // Moving right
    if (insertPoint < availableWeeks.length && availableWeeks[insertPoint] === currentWeek) {
      // Current week exists in array, go to next
      targetIndex = insertPoint + 1;
    } else {
      // Current week doesn't exist, go to first week >= currentWeek
      targetIndex = insertPoint;
    }
  } else {
    // Moving left
    targetIndex = insertPoint - 1;
  }

  if (targetIndex < 0 || targetIndex >= availableWeeks.length) return;

  currentWeek = availableWeeks[targetIndex];
  storageSet("selectedWeek", String(currentWeek));
  
  showSkeletonLoading();
  setFiltersEnabled(false);
  // Load items and scroll to top after a short delay to let the render start
  loadItems().finally(() => {
    setFiltersEnabled(true);
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

function timetableEntryFor(dayKey, periodKey) {
  return (TIMETABLE[dayKey] || []).find((entry) => entry.period === periodKey);
}

function todayDayKey() {
  const todayIndex = new Date().getDay();
  return TIMETABLE_DAYS.find((day) => day.index === todayIndex)?.key ?? null;
}

function timeToMinutes(timeStr) {
  const match = timeStr.match(/(\d+):(\d+)(am|pm)/);
  if (!match) return 0;
  
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3];
  
  if (meridiem === "pm" && hours !== 12) {
    hours += 12;
  } else if (meridiem === "am" && hours === 12) {
    hours = 0;
  }
  
  return hours * 60 + minutes;
}

function currentPeriodKey() {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  for (const period of TIMETABLE_PERIODS) {
    const startTotal = timeToMinutes(period.start);
    const endTotal = timeToMinutes(period.end);
    
    if (currentMinutes >= startTotal && currentMinutes < endTotal) {
      return period.key;
    }
  }

  return null;
}

function nextPeriodKey() {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  
  for (const period of TIMETABLE_PERIODS) {
    if (period.type !== "class") continue;
    const startTotal = timeToMinutes(period.start);
    if (currentMinutes < startTotal) {
      return period.key;
    }
  }

  return null;
}

function createSlotContent(period, entry) {
  const fragment = document.createDocumentFragment();

  const subject = document.createElement("p");
  subject.className = "slot_subject";
  
  if (period.type === "break") {
    subject.textContent = t(period.labelKey);
  } else if (entry?.subject) {
    // Extract subject ID from the entry
    const subjectMatch = entry.subject.match(/^([A-Z]+)\s*(?:\(([^)]+)\))?$/);
    let subjectId;
    let teacherInfo;
    if (subjectMatch) {
      subjectId = subjectMatch[1];
      teacherInfo = subjectMatch[2];
    } else {
      subjectId = entry.subject;
      teacherInfo = null;
    }
    const subjectLabel = getSubjectLabel(subjectId);
    subject.textContent = teacherInfo ? `${subjectLabel} (${teacherInfo})` : subjectLabel;
  } else {
    subject.textContent = t("free");
  }

  const metaParts = [];
  if (entry?.room) {
    metaParts.push(entry.room);
  }

  const meta = document.createElement("p");
  meta.className = "slot_meta";
  meta.textContent = metaParts.length > 0
    ? metaParts.join(" · ")
    : "";

  fragment.append(subject, meta);
  return fragment;
}

function renderTimetableIndicators() {
  const container = document.getElementById("timetable_indicators");
  if (!container) return;

  const todayKey = todayDayKey();
  const currentPeriod = currentPeriodKey();
  const nextPeriod = nextPeriodKey();
  container.replaceChildren();

  if (!todayKey) return;

  const currentEntry = currentPeriod ? timetableEntryFor(todayKey, currentPeriod) : null;
  const nextEntry = nextPeriod ? timetableEntryFor(todayKey, nextPeriod) : null;

  const currentPeriodObj = TIMETABLE_PERIODS.find(p => p.key === currentPeriod);
  const nextPeriodObj = TIMETABLE_PERIODS.find(p => p.key === nextPeriod);

  // Determine current label and whether we're in an active class
  let currentLabel = "";
  let isActiveClass = false;

  if (currentPeriodObj) {
    if (currentPeriodObj.type === "class") {
      if (currentEntry?.subject) {
        currentLabel = getSubjectLabel(currentEntry.subject);
        isActiveClass = true;
      } else {
        currentLabel = t("free");
        isActiveClass = false;
      }
    } else if (currentPeriodObj.type === "break") {
      const duration = timeToMinutes(currentPeriodObj.end) - timeToMinutes(currentPeriodObj.start);
      if (currentPeriodObj.key === "lunch") {
        currentLabel = t("lunchBreak");
      } else if (duration <= 5) {
        currentLabel = t("passingPeriod");
      } else {
        currentLabel = t("breaktime");
      }
      isActiveClass = false;
    }
  } else {
    currentLabel = t("notInClass");
    isActiveClass = false;
  }

  const nextLabel = nextEntry?.subject
    ? getSubjectLabel(nextEntry.subject)
    : nextPeriod
      ? t("free")
      : null;

  const currentTimeStr = currentPeriodObj ? `${currentPeriodObj.start} – ${currentPeriodObj.end}` : "";
  const nextTimeStr = nextPeriodObj ? `${nextPeriodObj.start} – ${nextPeriodObj.end}` : "";

  // Current card
  const currentCard = document.createElement("div");
  currentCard.className = "indicator_card";
  if (isActiveClass) {
    currentCard.classList.add("indicator_card_current");
  } else {
    currentCard.classList.add("indicator_card_idle");
  }

  const currentHeader = document.createElement("div");
  currentHeader.className = "indicator_header";

  const currentTag = document.createElement("span");
  currentTag.className = "indicator_tag";
  if (isActiveClass) {
    currentTag.innerHTML = `<span class="indicator_dot" aria-hidden="true"></span>${t("indicatorCurrent")}`;
  } else {
    currentTag.textContent = t("indicatorCurrent");
  }

  const currentTitle = document.createElement("p");
  currentTitle.className = "indicator_title";
  currentTitle.textContent = currentLabel;

  const currentMeta = document.createElement("p");
  currentMeta.className = "indicator_meta";
  currentMeta.textContent = currentTimeStr;

  currentCard.append(currentHeader, currentTitle, currentMeta);
  currentHeader.appendChild(currentTag);

  container.appendChild(currentCard);

  // Next card
  if (nextLabel) {
    const nextCard = document.createElement("div");
    nextCard.className = "indicator_card indicator_card_next";

    const nextHeader = document.createElement("div");
    nextHeader.className = "indicator_header";

    const nextTag = document.createElement("span");
    nextTag.className = "indicator_tag";
    nextTag.textContent = t("indicatorNext");

    const nextTitle = document.createElement("p");
    nextTitle.className = "indicator_title";
    nextTitle.textContent = nextLabel;

    const nextMeta = document.createElement("p");
    nextMeta.className = "indicator_meta";
    nextMeta.textContent = nextTimeStr;

    nextCard.append(nextHeader, nextTitle, nextMeta);
    nextHeader.appendChild(nextTag);

    container.appendChild(nextCard);
  }
}

function renderTimetableGrid() {
  const todayKey = todayDayKey();
  const currentPeriod = currentPeriodKey();
  const nextPeriod = nextPeriodKey();
  const cells = [];

  const corner = document.createElement("div");
  corner.className = "day_cell";
  corner.textContent = t("time");
  cells.push(corner);

  for (const day of TIMETABLE_DAYS) {
    const dayCell = document.createElement("div");
    dayCell.className = "day_cell";
    dayCell.textContent = t(day.labelKey);

    if (day.key === todayKey) {
      dayCell.classList.add("day_cell_today");
    }

    cells.push(dayCell);
  }

  for (const period of TIMETABLE_PERIODS) {
    if (period.type === "break") {
      const breakCell = document.createElement("div");
      breakCell.className = "slot_cell slot_cell_break slot_cell_break_full";
      if (todayKey) {
        breakCell.classList.add("slot_cell_today");
      }
      const breakSubject = document.createElement("p");
      breakSubject.className = "slot_subject";
      breakSubject.textContent = t(period.labelKey);
      const breakMeta = document.createElement("p");
      breakMeta.className = "slot_meta";
      breakMeta.textContent = `${period.start}-\n${period.end}`;
      breakCell.append(breakSubject, breakMeta);
      cells.push(breakCell);
      continue;
    }

    const timeCell = document.createElement("div");
    timeCell.className = "time_cell";
    timeCell.textContent = `${t(period.labelKey)}\n${period.start}-\n${period.end}`;
    cells.push(timeCell);

    for (let i = 0; i < TIMETABLE_DAYS.length; i++) {
      const day = TIMETABLE_DAYS[i];
      const entry = timetableEntryFor(day.key, period.key);
      const slot = document.createElement("div");
      slot.className = "slot_cell";

      if (!entry) {
        slot.classList.add("slot_cell_free");
      }

      if (day.key === todayKey) {
        slot.classList.add("slot_cell_today");
      }

      if (day.key === todayKey && period.key === currentPeriod) {
        slot.classList.add("slot_cell_current");
      } else if (day.key === todayKey && period.key === nextPeriod) {
        slot.classList.add("slot_cell_next");
      }

      if (i === TIMETABLE_DAYS.length - 1) {
        slot.classList.add("last_col");
      }

      if (timetableEditMode && period.type === "class") {
        slot.style.cursor = "pointer";
        slot.title = "Click to edit subject";
        slot.setAttribute("aria-label", "Click to edit subject");
        slot.dataset.dayKey = day.key;
        slot.dataset.periodKey = period.key;
        slot.tabIndex = 0;
        slot.setAttribute("role", "button");
        // Use a single event listener on the parent instead of per-slot listeners
        slot.addEventListener("click", handleSlotClick);
        slot.addEventListener("keydown", handleSlotKeydown);
      }

      slot.append(createSlotContent(period, entry));
      cells.push(slot);
    }
  }

  timetableGrid.replaceChildren(...cells);
}

// Event handler for timetable slot clicks (single handler for all slots)
function handleSlotClick(event) {
  const slot = event.currentTarget;
  const dayKey = slot.dataset.dayKey;
  const periodKey = slot.dataset.periodKey;
  if (dayKey && periodKey) {
    openSubjectEditor(dayKey, periodKey, slot);
  }
}

// Keyboard navigation for timetable slots (Enter/Space to open editor)
function handleSlotKeydown(event) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    const slot = event.currentTarget;
    const dayKey = slot.dataset.dayKey;
    const periodKey = slot.dataset.periodKey;
    if (dayKey && periodKey) {
      openSubjectEditor(dayKey, periodKey, slot);
    }
  }
}

function renderTimetableMobile() {
  const todayKey = todayDayKey();
  const currentPeriod = currentPeriodKey();
  const nextPeriod = nextPeriodKey();
  
  // Check if it's a weekend (Saturday=6, Sunday=0) and "Today" view is active
  const dayIndex = new Date().getDay();
  const isWeekend = dayIndex === 0 || dayIndex === 6;
  
  // On weekend with "Today" view, show a message instead of days
  if (timetableMobileView === "today" && isWeekend) {
    timetableMobile.replaceChildren();
    const weekendMsg = document.createElement("p");
    weekendMsg.className = "weekend_message";
    weekendMsg.textContent = t("weekendNoClasses");
    timetableMobile.appendChild(weekendMsg);
    return;
  }
  
  // Filter days based on mobile view toggle
  let daysToShow = TIMETABLE_DAYS;
  if (timetableMobileView === "today" && todayKey) {
    daysToShow = TIMETABLE_DAYS.filter(day => day.key === todayKey);
  }
  
  const daySections = daysToShow.map((day) => {
    const section = document.createElement("section");
    section.className = "day_schedule";

    const heading = document.createElement("h3");
    heading.textContent = t(day.labelKey);

    if (day.key === todayKey) {
      const badge = document.createElement("span");
      badge.className = "today_label";
      badge.textContent = t("today");
      heading.appendChild(badge);
    }

    section.appendChild(heading);

    const hasClasses = (TIMETABLE[day.key] || []).some((entry) => entry.subject);
    if (!hasClasses) {
      // Fully free day: show only the empty message, no break/lunch slots.
      const empty = document.createElement("p");
      empty.className = "day_empty";
      empty.textContent = t("noClassesAdded");
      section.appendChild(empty);
      return section;
    }

    for (const period of TIMETABLE_PERIODS) {
      const entry = timetableEntryFor(day.key, period.key);
      if (period.type === "class" && !entry) {
        continue;
      }

      const slot = document.createElement("div");
      slot.className = "mobile_slot";

      const time = document.createElement("div");
      time.className = "mobile_time";
      time.textContent = `${t(period.labelKey)}\n${period.start}-\n${period.end}`;

      const content = document.createElement("div");
      if (day.key === todayKey && period.key === currentPeriod) {
        slot.classList.add("slot_cell_current");
      } else if (day.key === todayKey && period.key === nextPeriod) {
        slot.classList.add("slot_cell_next");
      }
      content.append(createSlotContent(period, entry));
      
      if (timetableEditMode && period.type === "class") {
        slot.style.cursor = "pointer";
        slot.dataset.dayKey = day.key;
        slot.dataset.periodKey = period.key;
        slot.tabIndex = 0;
        slot.setAttribute("role", "button");
        slot.setAttribute("aria-label", "Click to edit subject");
        // Use single event handler
        slot.addEventListener("click", handleSlotClick);
        slot.addEventListener("keydown", handleSlotKeydown);
      }

      slot.append(time, content);
      section.appendChild(slot);
    }

    return section;
  });

  timetableMobile.replaceChildren(...daySections);
}

let _lastIndicatorState = null;
let _lastTimetableTick = 0;
let _lastTimetableInteraction = 0;

function isWithinSchoolHours() {
  const now = new Date();
  const day = now.getDay();
  // Weekday only: Monday(1) – Friday(5)
  if (day === 0 || day === 6) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const start = timeToMinutes("07:40am");
  const end = timeToMinutes("03:30pm");
  return minutes >= start && minutes < end;
}

function timetableClockLoop(timestamp) {
  if (timestamp - _lastTimetableTick >= 15000) {
    _lastTimetableTick = timestamp;
    // Skip the auto refresh while the user is actively scrolling/interacting
    // with the mobile timetable so their scroll position isn't reset.
    if (isWithinSchoolHours() && Date.now() - _lastTimetableInteraction > 2000) {
      renderTimetable();
    }
  }
  requestAnimationFrame(timetableClockLoop);
}

function renderTimetable(force) {
  const todayKey = todayDayKey();
  const currentPeriod = currentPeriodKey();
  const nextPeriod = nextPeriodKey();
  const stateKey = `${todayKey}|${currentPeriod}|${nextPeriod}|${currentLanguage}|${timetableEditMode}`;

  updateTimetableEmptyHint();

  // Skip re-render if nothing changed (avoids flicker on the 15s tick),
  // unless a render was explicitly forced (e.g. after an edit/save).
  if (!force && _lastIndicatorState === stateKey) return;
  _lastIndicatorState = stateKey;

  renderTimetableIndicators();
  renderTimetableGrid();
  renderTimetableMobile();
  updateTimetableViewToggleButtons();
}

function hasAnyClasses() {
  return TIMETABLE_DAYS.some((day) => (TIMETABLE[day.key] || []).some((entry) => entry.subject));
}

function updateTimetableEmptyHint() {
  const hint = document.getElementById("timetable_empty_hint");
  if (!hint) return;
  hint.hidden = hasAnyClasses();
}

function loadExampleSchedule() {
  if (!confirm(t("loadExampleConfirm"))) return;
  TIMETABLE = JSON.parse(JSON.stringify(DEFAULT_TIMETABLE));
  saveTimetable(TIMETABLE);
  renderTimetable(true);
}

function isMobile() {
  return window.innerWidth <= 900;
}

function openSubjectEditor(dayKey, periodKey, slotElement) {
  const currentEntry = timetableEntryFor(dayKey, periodKey);
  const currentSubject = currentEntry?.subject || "";
  const currentRoom = currentEntry?.room || "";
  
  // Use modal editor on mobile, inline editor on desktop
  if (isMobile()) {
    openMobileSubjectEditor(dayKey, periodKey, slotElement, currentSubject, currentRoom);
  } else {
    openDesktopSubjectEditor(dayKey, periodKey, slotElement, currentSubject, currentRoom);
  }
}

function openDesktopSubjectEditor(dayKey, periodKey, slotElement, currentSubject, currentRoom) {
  const editor = document.createElement("div");
  editor.className = "timetable_editor";
  
  const select = document.createElement("select");
  select.className = "timetable_editor_select";
  
  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = t("clearSlot");
  if (!currentSubject) {
    emptyOption.selected = true;
  }
  select.appendChild(emptyOption);

  const allSubjects = Object.keys(SUBJECT_LABELS[currentLanguage] || {});
  allSubjects.forEach((subjectId) => {
    const option = document.createElement("option");
    option.value = subjectId;
    option.textContent = getSubjectLabel(subjectId);
    if (subjectId === currentSubject) {
      option.selected = true;
    }
    select.appendChild(option);
  });
  
  // Prevent select from losing focus
  select.addEventListener("mousedown", (e) => {
    e.stopPropagation();
  });
  
  select.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  const roomInput = document.createElement("input");
  roomInput.type = "text";
  roomInput.className = "timetable_editor_room_input";
  roomInput.placeholder = t("roomPlaceholder");
  roomInput.value = currentRoom || "";
  roomInput.setAttribute("aria-label", t("room"));
  roomInput.addEventListener("mousedown", (e) => {
    e.stopPropagation();
  });
  roomInput.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  const saveBtn = document.createElement("button");
  saveBtn.className = "timetable_editor_btn";
  saveBtn.textContent = currentLanguage === "vi" ? "Lưu" : "Save";
  saveBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const selectedSubject = select.value;
    const room = roomInput.value.trim();
    const day = TIMETABLE[dayKey] || [];
    const existingIndex = day.findIndex((entry) => entry.period === periodKey);

    if (!selectedSubject) {
      // "Empty" chosen — remove this period entirely (subject + room).
      if (existingIndex >= 0) {
        day.splice(existingIndex, 1);
        TIMETABLE[dayKey] = day;
      }
    } else if (existingIndex >= 0) {
      day[existingIndex].subject = selectedSubject;
      if (room) {
        day[existingIndex].room = room;
      } else {
        delete day[existingIndex].room;
      }
    } else {
      const entry = { period: periodKey, subject: selectedSubject };
      if (room) entry.room = room;
      day.push(entry);
    }
    
    TIMETABLE[dayKey] = day;
    saveTimetable(TIMETABLE);
    closeEditor(editor);
  });
  
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "timetable_editor_btn";
  cancelBtn.textContent = currentLanguage === "vi" ? "Hủy" : "Cancel";
  cancelBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeEditor(editor);
  });
  
  // Prevent editor clicks from bubbling to slot
  editor.addEventListener("click", (e) => {
    e.stopPropagation();
  });
  
  editor.addEventListener("mousedown", (e) => {
    e.stopPropagation();
  });
  
  editor.append(select, roomInput, saveBtn, cancelBtn);
  slotElement.innerHTML = "";
  slotElement.appendChild(editor);
  
  // Auto-focus the select
  setTimeout(() => select.focus(), 0);
}

function openMobileSubjectEditor(dayKey, periodKey, slotElement, currentSubject, currentRoom) {
  // Create modal overlay
  const modal = document.createElement("div");
  modal.className = "timetable_mobile_modal";
  
  const modalContent = document.createElement("div");
  modalContent.className = "timetable_mobile_modal_content";
  
  const period = TIMETABLE_PERIODS.find(p => p.key === periodKey);
  const entry = timetableEntryFor(dayKey, periodKey);
  
  // Period info (left column, row 1)
  const periodInfo = document.createElement("div");
  periodInfo.className = "timetable_mobile_period_info";
  periodInfo.textContent = `${t(period.labelKey)}\n${period.start}-\n${period.end}`;
  
  // Current subject text (left column, row 2)
  const currentSubjectText = document.createElement("p");
  currentSubjectText.className = "timetable_mobile_current_subject";
  const currentSubjectLabel = entry?.subject ? getSubjectLabel(entry.subject) : t("free");
  currentSubjectText.textContent = `${currentLanguage === "vi" ? "Môn hiện tại:" : "Current:"} ${currentSubjectLabel}`;
  
  // Subject selector (middle column, spans rows 1-2)
  const select = document.createElement("select");
  select.className = "timetable_mobile_select";

  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = t("clearSlot");
  if (!currentSubject) {
    emptyOption.selected = true;
  }
  select.appendChild(emptyOption);
  
  const allSubjects = Object.keys(SUBJECT_LABELS[currentLanguage] || {});
  allSubjects.forEach((subjectId) => {
    const option = document.createElement("option");
    option.value = subjectId;
    option.textContent = getSubjectLabel(subjectId);
    if (subjectId === currentSubject) {
      option.selected = true;
    }
    select.appendChild(option);
  });

  // Room input (full-width row 3)
  const roomInput = document.createElement("input");
  roomInput.type = "text";
  roomInput.className = "timetable_mobile_room_input";
  roomInput.placeholder = t("roomPlaceholder");
  roomInput.value = currentRoom || "";
  roomInput.setAttribute("aria-label", t("room"));
  
  // Save button (right column, row 1)
  const saveBtn = document.createElement("button");
  saveBtn.className = "timetable_mobile_btn timetable_mobile_btn_save";
  saveBtn.textContent = currentLanguage === "vi" ? "Lưu" : "Save";
  saveBtn.addEventListener("click", () => {
    const selectedSubject = select.value;
    const room = roomInput.value.trim();
    const day = TIMETABLE[dayKey] || [];
    const existingIndex = day.findIndex((entry) => entry.period === periodKey);

    if (!selectedSubject) {
      // "Empty" chosen — remove this period entirely (subject + room).
      if (existingIndex >= 0) {
        day.splice(existingIndex, 1);
        TIMETABLE[dayKey] = day;
      }
    } else if (existingIndex >= 0) {
      day[existingIndex].subject = selectedSubject;
      if (room) {
        day[existingIndex].room = room;
      } else {
        delete day[existingIndex].room;
      }
    } else {
      const entry = { period: periodKey, subject: selectedSubject };
      if (room) entry.room = room;
      day.push(entry);
    }
    
    TIMETABLE[dayKey] = day;
    saveTimetable(TIMETABLE);
    closeMobileSubjectEditor(modal);
    renderTimetable(true);
  });
  
  // Cancel button (right column, row 2)
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "timetable_mobile_btn timetable_mobile_btn_cancel";
  cancelBtn.textContent = currentLanguage === "vi" ? "Hủy" : "Cancel";
  cancelBtn.addEventListener("click", () => {
    closeMobileSubjectEditor(modal);
  });
  
  // Button container for grid layout
  const buttons = document.createElement("div");
  buttons.className = "timetable_mobile_buttons";
  buttons.append(saveBtn, cancelBtn);
  
  // Assemble grid layout - order matters for CSS grid placement
  modalContent.append(periodInfo, currentSubjectText, select, roomInput, buttons);
  modal.appendChild(modalContent);
  
  // Close modal when clicking outside
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      closeMobileSubjectEditor(modal);
    }
  });

  // Close on Escape (desktop keyboards, iPad)
  modal._escHandler = (e) => {
    if (e.key === "Escape") closeMobileSubjectEditor(modal);
  };
  document.addEventListener("keydown", modal._escHandler);
  
  document.body.appendChild(modal);

  // Prevent background scrolling while the modal is open
  document.body.classList.add("timetable_modal_open");
  
  // Focus the modal itself (not the select) so iOS does not instantly pop
  // the native picker and cover the Save/Cancel buttons.
  modal.tabIndex = -1;
  modal.focus();
}

function closeMobileSubjectEditor(modal) {
  if (!modal || !modal.isConnected) return;
  document.removeEventListener("keydown", modal._escHandler);
  modal.remove();
  document.body.classList.remove("timetable_modal_open");
}

function closeEditor(editor) {
  const slotElement = editor.parentElement;
  if (slotElement) {
    const dayKey = slotElement.dataset.dayKey;
    const periodKey = slotElement.dataset.periodKey;
    const period = TIMETABLE_PERIODS.find(p => p.key === periodKey);
    const entry = timetableEntryFor(dayKey, periodKey);
    
    slotElement.innerHTML = "";
    slotElement.appendChild(createSlotContent(period, entry || { subject: "" }));
  }
  editor.remove();
  updateTimetableEmptyHint();
}

function toggleTimetableEditMode() {
  timetableEditMode = !timetableEditMode;
  const editBtn = document.getElementById("timetable_edit_btn");
  if (editBtn) {
    editBtn.classList.toggle("timetable_edit_btn_active", timetableEditMode);
  }
  const exampleBtn = document.getElementById("timetable_example_btn");
  if (exampleBtn) {
    exampleBtn.hidden = !timetableEditMode;
  }
  renderTimetable(true);
}

// ── Overview ────────────────────────────────────────────────────

function applyManualCompletionsToOverview(overviewData) {
  // Adjust overview counts based on manual completions in localStorage
  const manualCompletions = getManualCompletions();
  const manualKeys = Object.keys(manualCompletions);
  if (manualKeys.length === 0) return overviewData;

  const adjustments = {}; // week -> {done_adj, unfinished_adj, unknown_adj}
  const seenManualKeys = new Set();
  
  function adjustForItem(week, item) {
    if (item.course_id !== selectedCourseId || !item.module_item_id) return;

    const key = `${item.course_id}:${item.module_item_id}`;
    if (!manualCompletions[key] || seenManualKeys.has(key)) return;
    seenManualKeys.add(key);

    if (!adjustments[week]) {
      adjustments[week] = { done_adj: 0, unfinished_adj: 0, unknown_adj: 0 };
    }

    // The item was previously not-done (unfinished or unknown), now manually done.
    if (item.completed === null) {
      adjustments[week].unknown_adj -= 1;
      adjustments[week].done_adj += 1;
    } else if (item.completed === false) {
      adjustments[week].unfinished_adj -= 1;
      adjustments[week].done_adj += 1;
    }
  }

  for (const weekSummary of overviewData.weeks || []) {
    for (const item of weekSummary.items || []) {
      adjustForItem(weekSummary.week, item);
    }
  }

  // Older overview responses did not include item ids. Fall back to loaded weeks.
  for (const key of manualKeys) {
    if (seenManualKeys.has(key)) continue;

    for (const [cacheKey, cachedItems] of itemCache.entries()) {
      // cacheKey format: `${courseId}:${week}:${unfinishedOnly}`
      const [cId, week, _unf] = cacheKey.split(":").map(x => isNaN(Number(x)) ? x : Number(x));
      if (cId !== selectedCourseId) continue;

      for (const item of cachedItems) {
        const itemKey = `${item.course_id}:${item.module_item_id}`;
        if (itemKey === key) {
          adjustForItem(week, item);
          break;
        }
      }
    }
  }

  if (Object.keys(adjustments).length === 0) return overviewData;

  // Apply adjustments to a deep copy of the overview data
  const adjusted = JSON.parse(JSON.stringify(overviewData));
  for (const weekSummary of adjusted.weeks) {
    const adj = adjustments[weekSummary.week];
    if (adj) {
      weekSummary.done += adj.done_adj;
      weekSummary.unfinished += adj.unfinished_adj;
      weekSummary.unknown += adj.unknown_adj;
    }
  }
  // Recompute totals
  adjusted.totals.total = adjusted.weeks.reduce((s, w) => s + w.total, 0);
  adjusted.totals.done = adjusted.weeks.reduce((s, w) => s + w.done, 0);
  adjusted.totals.unfinished = adjusted.weeks.reduce((s, w) => s + w.unfinished, 0);
  adjusted.totals.unknown = adjusted.weeks.reduce((s, w) => s + w.unknown, 0);

  // Also adjust uncategorized_unfinished_count for week 0 (Unassigned Modules) items
  const week0Adj = adjustments[0];
  if (week0Adj) {
    adjusted.uncategorized_unfinished_count = Math.max(
      0,
      adjusted.uncategorized_unfinished_count + week0Adj.unfinished_adj + week0Adj.unknown_adj
    );
  }
  
  return adjusted;
}

async function loadOverview(bustCache = false) {
  if (!selectedCourseId) return;

  // Capture which slot owns this load so async completion updates the right
  // slot's state and only touches the shared sidebar if that slot is active.
  const loadSlot = splitViewEnabled ? activeSlot : "a";
  const loadCourseId = selectedCourseId;

  // Cancel any previous overview request for this slot to prevent race conditions
  const prevController = splitViewEnabled ? _slotState[loadSlot].currentOverviewController : currentOverviewController;
  if (prevController) prevController.abort();
  const thisOverviewController = new AbortController();
  if (splitViewEnabled) {
    _slotState[loadSlot].currentOverviewController = thisOverviewController;
  } else {
    currentOverviewController = thisOverviewController;
  }
  const signal = thisOverviewController.signal;

  // The shared sidebar only shows the active slot's overview, so skeleton and
  // loading messages are only meaningful when this slot is active.
  if (loadSlot === activeSlot) {
    overviewData = null;
    overviewLoadStartTime = Date.now();
    clearOverviewLoadingMessageTimer();
    showOverviewSkeleton();
    overviewLoadingMessageTimer = setTimeout(showOverviewLoadingMessage, 8000);
  }

  try {
    // Use the dedicated overview endpoint for a single efficient call
    // Cache-bust on initial load to ensure fresh completion data from Canvas
    const overviewUrl = `/api/courses/${loadCourseId}/overview`;
    const cacheBustParam = bustCache ? `?_t=${Date.now()}` : "";
    const data = await fetchJson(`${overviewUrl}${cacheBustParam}`, { signal });

    const normalized = normalizeOverviewData(data);

    // Apply manual completions before computing progress for bars
    const adjusted = applyManualCompletionsToOverview(normalized);

    // Store overview for the owning slot
    if (splitViewEnabled) {
      _slotState[loadSlot].overviewData = adjusted;
    }

    // Store course progress for progress bars (use adjusted totals so manual
    // completions are reflected in the bar, matching the semester progress)
    if (adjusted && adjusted.totals) {
      courseProgress.set(loadCourseId, {
        done: adjusted.totals.done || 0,
        total: adjusted.totals.total || 0,
      });
      saveCourseProgress();
      renderCoursePills();
    }

    // Only update the shared sidebar / loading state if this slot is active
    if (loadSlot === activeSlot) {
      overviewData = adjusted;
      clearOverviewLoadingMessageTimer();
      renderOverview(adjusted);
    }
  } catch (error) {
    if (error.name === 'AbortError') return;
    if (loadSlot === activeSlot) {
      clearOverviewLoadingMessageTimer();
      showOverviewError(error.message, () => loadOverview());
    }
  } finally {
    if (splitViewEnabled) {
      _slotState[loadSlot].currentOverviewController = null;
    } else {
      currentOverviewController = null;
    }
  }
}

function renderOverview(data) {
  // Update new sidebar components
  updateSemesterProgress(data);
  updateStatsGrid(data);
  updateWarningBanner(data);
  updateWeekOverview(data);
}

function showOverviewSkeleton() {
  // Reset numeric displays to shimmer placeholders
  const doneEl = document.getElementById("semester_done");
  const totalEl = document.getElementById("semester_total");
  const percentEl = document.getElementById("semester_percent");
  if (doneEl) doneEl.innerHTML = '<span class="semester_progress_fraction_skeleton">&nbsp;</span>';
  if (totalEl) totalEl.innerHTML = '<span class="semester_progress_fraction_skeleton" style="width:40px;height:16px">&nbsp;</span>';
  if (percentEl) percentEl.innerHTML = '<span class="semester_progress_percent_skeleton">&nbsp;</span>';

  // Show shimmer progress bar
  const barContainer = document.getElementById("semester_progress_bar");
  if (barContainer) barContainer.innerHTML = '<div class="semester_progress_bar_skeleton" style="width:100%"></div>';

  // Reset stats grid to shimmer placeholders
  const statWeeks = document.getElementById("stat_weeks");
  const statUnknown = document.getElementById("stat_unknown");
  const statDone = document.getElementById("stat_done");
  const statUnfinished = document.getElementById("stat_unfinished");
  if (statWeeks) statWeeks.innerHTML = '<span class="stat_count_skeleton">&nbsp;</span>';
  if (statUnknown) statUnknown.innerHTML = '<span class="stat_count_skeleton">&nbsp;</span>';
  if (statDone) statDone.innerHTML = '<span class="stat_count_skeleton">&nbsp;</span>';
  if (statUnfinished) statUnfinished.innerHTML = '<span class="stat_count_skeleton">&nbsp;</span>';

  // Hide warning banner
  const banner = document.getElementById("warning_banner");
  if (banner) banner.hidden = true;

  // Show skeleton cards in week overview
  const listContainer = document.getElementById("week_overview_list");
  if (listContainer) {
    listContainer.replaceChildren();
    const skeletonCount = 4;
    for (let i = 0; i < skeletonCount; i++) {
      const card = document.createElement("div");
      card.className = "week_overview_card week_overview_card_skeleton";
      card.innerHTML = `
        <div class="week_overview_card_header">
          <span class="week_overview_card_name_skeleton">&nbsp;</span>
          <span class="week_overview_card_fraction_skeleton">&nbsp;</span>
        </div>
        <div class="week_overview_card_progress week_overview_card_progress_skeleton"></div>
        <div class="week_overview_card_types_skeleton">&nbsp;</div>
      `;
      listContainer.appendChild(card);
    }
  }
}

function updateSemesterProgress(data) {
  const barContainer = document.getElementById("semester_progress_bar");
  const doneEl = document.getElementById("semester_done");
  const totalEl = document.getElementById("semester_total");
  const percentEl = document.getElementById("semester_percent");
  
  if (!barContainer || !doneEl || !totalEl || !percentEl) return;
  
  if (!data || !data.weeks || data.weeks.length === 0) {
    barContainer.innerHTML = "";
    doneEl.textContent = "0";
    totalEl.textContent = "0";
    percentEl.textContent = "0%";
    return;
  }

  const totalItems = data.weeks.reduce((sum, w) => sum + w.total, 0);
  const totalDone = data.weeks.reduce((sum, w) => sum + w.done, 0);

  doneEl.textContent = totalDone;
  totalEl.textContent = totalItems;
  
  const percentage = totalItems > 0 ? Math.round((totalDone / totalItems) * 100) : 0;
  percentEl.textContent = `${percentage}%`;

  // Create segmented progress bar (max ~40 segments for visual clarity)
  const maxSegments = 40;
  const segmentCount = Math.min(maxSegments, Math.max(totalItems, 1));
  const doneSegments = totalItems > 0 ? Math.round((totalDone / totalItems) * segmentCount) : 0;
  
  let segmentsHTML = "";
  for (let i = 0; i < segmentCount; i++) {
    const doneClass = i < doneSegments ? "semester_progress_segment_done" : "";
    segmentsHTML += `<div class="semester_progress_segment ${doneClass}"></div>`;
  }
  barContainer.innerHTML = segmentsHTML;
}

function updateStatsGrid(data) {
  const weeksEl = document.getElementById("stat_weeks");
  const unknownEl = document.getElementById("stat_unknown");
  const doneEl = document.getElementById("stat_done");
  const unfinishedEl = document.getElementById("stat_unfinished");
  
  if (!weeksEl || !unknownEl || !doneEl || !unfinishedEl) return;
  
  if (!data || !data.weeks || data.weeks.length === 0) {
    weeksEl.textContent = "0";
    unknownEl.textContent = "0";
    doneEl.textContent = "0";
    unfinishedEl.textContent = "0";
    return;
  }

  const totalUnknown = data.weeks.reduce((sum, w) => sum + (w.unknown || 0), 0);
  const totalDone = data.weeks.reduce((sum, w) => sum + w.done, 0);
  const totalUnfinished = data.weeks.reduce((sum, w) => sum + w.unfinished, 0);

  weeksEl.textContent = data.weeks.length;
  unknownEl.textContent = totalUnknown;
  doneEl.textContent = totalDone;
  unfinishedEl.textContent = totalUnfinished;
}

function updateWarningBanner(data) {
  const banner = document.getElementById("warning_banner");
  const textEl = document.getElementById("warning_text");
  
  if (!banner || !textEl) return;
  
  if (!data || !data.weeks || data.weeks.length === 0 || data.uncategorized_unfinished_count === 0) {
    banner.hidden = true;
    return;
  }

  banner.hidden = false;
  textEl.textContent = t("uncategorizedWarning").replace("{count}", data.uncategorized_unfinished_count);
  
  // Make banner clickable to navigate to Week 0
  banner.style.cursor = "pointer";
  banner.addEventListener("click", () => {
    currentWeek = 0;
    storageSet("selectedWeek", "0");
    setView("work");
  }, { once: true });
}

function updateWeekOverview(data) {
  const listContainer = document.getElementById("week_overview_list");
  if (!listContainer) return;

  if (!data || !data.weeks || data.weeks.length === 0) {
    listContainer.innerHTML = `<p class="empty_message">${t("overviewNoData")}</p>`;
    return;
  }

  listContainer.replaceChildren();

  for (const weekSummary of data.weeks) {
    const typeCounts = weekSummary.typeCounts || weekSummary.type_counts || {};
    const weekCard = document.createElement("div");
    weekCard.className = "week_overview_card";
    weekCard.setAttribute("data-week", weekSummary.week);
    weekCard.tabIndex = 0;
    weekCard.setAttribute("role", "button");
    const weekLabel = weekSummary.week === 0 ? t("overviewWeekGeneral") : `${t("week")} ${weekSummary.week}`;
    weekCard.title = `Go to ${weekLabel}`;
    weekCard.setAttribute("aria-label", `Go to ${weekLabel}`);

    weekCard.addEventListener("click", () => {
      currentWeek = weekSummary.week;
      storageSet("selectedWeek", String(currentWeek));
      setView("work");
    });
    
    weekCard.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        weekCard.click();
      }
    });

    const progressPct = weekSummary.total > 0 ? Math.round((weekSummary.done / weekSummary.total) * 100) : 0;

    // Build type chips HTML
    let chipsHTML = "";
    for (const type of TYPE_ORDER) {
      const count = typeCounts[type] || 0;
      if (count === 0) continue;
      chipsHTML += `<span class="week_overview_card_type">${TYPE_LABELS[type]} (${count})</span>`;
    }

    weekCard.innerHTML = `
      <div class="week_overview_card_header">
        <span class="week_overview_card_name">${weekLabel}</span>
        <span class="week_overview_card_fraction">${weekSummary.done}/${weekSummary.total}</span>
      </div>
      <div class="week_overview_card_progress">
        <div class="week_overview_card_progress_fill" style="width: ${progressPct}%"></div>
      </div>
      <div class="week_overview_card_types">${chipsHTML}</div>
    `;

    listContainer.appendChild(weekCard);
  }
}

function renderWorkView() {
  renderCoursePills();
  renderItems();
  updateHubTitle();
  updateWeekNav();
  
  // Update static text elements for work view
  const workTab = document.querySelector(".view_tab[data-view='work']");
  if (workTab) workTab.textContent = t("work");
  const weekLabel = document.getElementById("week_label");
  if (weekLabel) weekLabel.childNodes[0].textContent = `${t("week")} `;
  searchInput.placeholder = t("searchPlaceholder");
  const filterToggleSpans = document.querySelectorAll(".filter_toggle span");
  if (filterToggleSpans[0]) filterToggleSpans[0].textContent = t("unfinishedLabel");
  if (filterToggleSpans[1]) filterToggleSpans[1].textContent = t("unknownLabel");
}

function renderTimetableView() {
  renderTimetable();
  
  // Update static text elements for timetable view
  const timetableTab = document.querySelector(".view_tab[data-view='timetable']");
  if (timetableTab) timetableTab.textContent = t("timetable");
  if (timetableTitle) timetableTitle.textContent = t("timetableTitle");
  if (timetableNote) timetableNote.textContent = t("timetableNote");
  const timetableOpenBtnText = document.querySelector(".timetable_open_btn_text");
  if (timetableOpenBtnText) timetableOpenBtnText.textContent = t("openTimetable");
  const timetableExampleBtnText = document.getElementById("timetable_example_btn_text");
  if (timetableExampleBtnText) timetableExampleBtnText.textContent = t("loadExampleSchedule");
  const timetableEmptyHint = document.getElementById("timetable_empty_hint");
  if (timetableEmptyHint) timetableEmptyHint.textContent = t("timetableEmptyHint");
}

function renderAll() {
  renderWorkView();
  renderTimetableView();
  refreshOverviewFromState();
  updateConsentBanner();
  
  // Update shared static text elements
  if (tagline) tagline.textContent = t("tagline");
  // Update about tab text
  const aboutTab = document.querySelector(".view_tab[data-view='about']");
  if (aboutTab) aboutTab.textContent = t("about");
  // Update about page content
  const aboutTitle = document.getElementById("about_title");
  if (aboutTitle) aboutTitle.textContent = t("aboutTitle");
  const aboutWhatTitle = document.getElementById("about_what_title");
  if (aboutWhatTitle) aboutWhatTitle.textContent = t("aboutWhatTitle");
  const aboutWhatDesc = document.getElementById("about_what_desc");
  if (aboutWhatDesc) aboutWhatDesc.textContent = t("aboutWhatDesc");
  const aboutWhyTitle = document.getElementById("about_why_title");
  if (aboutWhyTitle) aboutWhyTitle.textContent = t("aboutWhyTitle");
  const aboutWhyDesc = document.getElementById("about_why_desc");
  if (aboutWhyDesc) aboutWhyDesc.textContent = t("aboutWhyDesc");
  const aboutFeaturesTitle = document.getElementById("about_features_title");
  if (aboutFeaturesTitle) aboutFeaturesTitle.textContent = t("aboutFeaturesTitle");
  const aboutFeature1 = document.getElementById("about_feature_1");
  if (aboutFeature1) aboutFeature1.textContent = t("aboutFeature1");
  const aboutFeature2 = document.getElementById("about_feature_2");
  if (aboutFeature2) aboutFeature2.textContent = t("aboutFeature2");
  const aboutFeature3 = document.getElementById("about_feature_3");
  if (aboutFeature3) aboutFeature3.textContent = t("aboutFeature3");
  const aboutFeature4 = document.getElementById("about_feature_4");
  if (aboutFeature4) aboutFeature4.textContent = t("aboutFeature4");
  const aboutFeature5 = document.getElementById("about_feature_5");
  if (aboutFeature5) aboutFeature5.textContent = t("aboutFeature5");
  const aboutFeature6 = document.getElementById("about_feature_6");
  if (aboutFeature6) aboutFeature6.textContent = t("aboutFeature6");
  const aboutFeature7 = document.getElementById("about_feature_7");
  if (aboutFeature7) aboutFeature7.textContent = t("aboutFeature7");
  const aboutFeature8 = document.getElementById("about_feature_8");
  if (aboutFeature8) aboutFeature8.textContent = t("aboutFeature8");
  const aboutShortcutsTitle = document.getElementById("about_shortcuts_title");
  if (aboutShortcutsTitle) aboutShortcutsTitle.textContent = t("aboutShortcutsTitle");
  const aboutShortcut1 = document.getElementById("about_shortcut_1");
  if (aboutShortcut1) aboutShortcut1.textContent = t("aboutShortcut1");
  const aboutShortcut2 = document.getElementById("about_shortcut_2");
  if (aboutShortcut2) aboutShortcut2.textContent = t("aboutShortcut2");
  const aboutShortcut3 = document.getElementById("about_shortcut_3");
  if (aboutShortcut3) aboutShortcut3.textContent = t("aboutShortcut3");
  const aboutShortcut4 = document.getElementById("about_shortcut_4");
  if (aboutShortcut4) aboutShortcut4.textContent = t("aboutShortcut4");
  const aboutShortcut5 = document.getElementById("about_shortcut_5");
  if (aboutShortcut5) aboutShortcut5.textContent = t("aboutShortcut5");
  const aboutThanks = document.getElementById("about_thanks");
  if (aboutThanks) aboutThanks.textContent = t("aboutThanks");
  const aboutTetoCaption = document.getElementById("about_teto_caption");
  if (aboutTetoCaption) aboutTetoCaption.textContent = t("aboutTetoCaption");
  const aboutBlessing = document.getElementById("about_blessing");
  if (aboutBlessing) aboutBlessing.textContent = t("aboutBlessing");
  // Update resource tab text
  const resourceTab = document.querySelector(".view_tab[data-view='resource']");
  if (resourceTab) resourceTab.textContent = t("resource");
  // Update resource page content
  const resourceTitle = document.getElementById("resource_title");
  if (resourceTitle) resourceTitle.textContent = t("resourceTitle");
  const resourceSubtitle = document.getElementById("resource_subtitle");
  if (resourceSubtitle) resourceSubtitle.textContent = t("resourceSubtitle");
  const resourceDocsTitle = document.getElementById("resource_docs_title");
  if (resourceDocsTitle) resourceDocsTitle.textContent = t("resourceDocsTitle");
  const resourceDocsDesc = document.getElementById("resource_docs_desc");
  if (resourceDocsDesc) resourceDocsDesc.textContent = t("resourceDocsDesc");
  renderEbookLibrary();
  // Update footer text
  const footerMadeBy = document.getElementById("footer_made_by");
  if (footerMadeBy) footerMadeBy.textContent = t("footerMadeBy");
  const footerFeedback = document.getElementById("footer_feedback");
  if (footerFeedback) footerFeedback.textContent = t("footerFeedback");
  const footerCopyright = document.getElementById("footer_copyright");
  if (footerCopyright) footerCopyright.textContent = t("footerCopyright");
}

function setView(viewName) {
  const nextView = viewName === "timetable" ? "timetable" : viewName === "about" ? "about" : viewName === "resource" ? "resource" : "work";
  storageSet("selectedView", nextView);

  const currentView = document.querySelector(".app_view_active");
  const transitionDuration = 50;

  // Always ensure data is loaded for work view, even if already active
  if (nextView === "work" && currentView && currentView.id === "work_view") {
    if (!coursesLoaded) {
      loadCourses().catch((error) => showMessage(error.message));
    } else if (selectedCourseId) {
      Promise.all([
        loadItems(),
        loadOverview(),
      ]).catch((error) => showMessage(error.message));
    }
    return;
  }

  // Update tabs
  for (const tab of viewTabs) {
    const isActive = tab.dataset.view === nextView;
    tab.classList.toggle("view_tab_active", isActive);
    tab.setAttribute("aria-pressed", String(isActive));
  }

  // Get the next view element and the container
  const nextViewEl = nextView === "work" ? workView : nextView === "timetable" ? timetableView : nextView === "resource" ? resourceView : aboutView;

  // Switch views with animation
  const switchToNext = () => {
    // Hide the old view
    if (currentView) {
      currentView.classList.remove("app_view_active");
      currentView.classList.remove("app_view_transitioning");
    }
    // Show the new view (position: absolute, so it overlaps where the old view was)
    nextViewEl.classList.add("app_view_transitioning");
    nextViewEl.classList.add("app_view_active");

    requestAnimationFrame(() => {
      nextViewEl.classList.remove("app_view_transitioning");
    });

    // Load data for the work view
    if (nextView === "work") {
      if (selectedCourseId) {
        Promise.all([
          loadItems(),
          loadOverview(),
        ]).catch((error) => showMessage(error.message));
      } else {
        loadCourses().catch((error) => showMessage(error.message));
      }
    } else if (nextView === "timetable") {
      renderTimetable();
    }
  };

  if (currentView) {
    // Remove active class from current view to start fade-out
    currentView.classList.remove("app_view_active");
    currentView.classList.add("app_view_transitioning");
    // Wait for the fade-out to be visible before swapping panels.
    window.setTimeout(() => {
      switchToNext();
    }, transitionDuration);
  } else {
    // No current view, just show the next one
    switchToNext();
  }

}

window.addEventListener("resize", () => {
  // Tab indicator updated via CSS border-bottom
});

// Use a flag to prevent duplicate event listeners
let weekNavListenersAttached = false;

function attachWeekNavListeners() {
  if (weekNavListenersAttached) return;
  
  prevWeekBtn.addEventListener("click", () => changeWeek(-1));
  nextWeekBtn.addEventListener("click", () => changeWeek(1));
  weekNavListenersAttached = true;
}

// Attach listeners when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", attachWeekNavListeners);
} else {
  attachWeekNavListeners();
}

function applyWeekFromInput() {
  const value = Number(weekInput.value);
  if (!Number.isFinite(value) || value < 0) {
    updateWeekNav();
    return;
  }
  if (value === currentWeek) {
    updateWeekNav();
    return;
  }

  currentWeek = value;
  storageSet("selectedWeek", String(currentWeek));
  showSkeletonLoading();
  setFiltersEnabled(false);
  loadItems().finally(() => {
    setFiltersEnabled(true);
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

weekInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    applyWeekFromInput();
  }
});

// iOS has no Enter/"Go" on the number keyboard — the value only commits on
// blur/change, so handle those (idempotently) as well.
weekInput.addEventListener("change", applyWeekFromInput);
weekInput.addEventListener("blur", applyWeekFromInput);

document.addEventListener("keydown", (event) => {
  // Don't hijack typing inside inputs, textareas, contenteditable, selects,
  // or buttons/checkbox labels (e.g. a focused toggle while space/enter pressed).
  const tag = event.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON" || event.target.isContentEditable) {
    return;
  }

  // Don't navigate weeks if the intro overlay is open
  const overlay = document.getElementById("intro_overlay");
  if (overlay && !overlay.hidden) return;

  // Don't trigger shortcuts while any modal/dialog is open
  const openModals = document.querySelectorAll(".token_settings_modal:not([hidden]), .timetable_mobile_modal, .token_warning:not([hidden])");
  if (openModals.length > 0) return;

  if (event.key === "ArrowLeft" || event.key === "j") {
    event.preventDefault();
    changeWeek(-1);
  } else if (event.key === "ArrowRight" || event.key === "k") {
    event.preventDefault();
    changeWeek(1);
  } else if (event.key === "g") {
    event.preventDefault();
    weekInput.focus();
    weekInput.select();
  } else if (event.key === "d") {
    event.preventDefault();
    unfinishedOnly.checked = !unfinishedOnly.checked;
    if (unfinishedOnly.checked) unknownOnly.checked = false;
    commitFilterState();
    loadItems();
  } else if (event.key === "f") {
    event.preventDefault();
    unknownOnly.checked = !unknownOnly.checked;
    if (unknownOnly.checked) unfinishedOnly.checked = false;
    commitFilterState();
    loadItems();
  }
});

unfinishedOnly.addEventListener("click", () => {
  if (unfinishedOnly.checked) unknownOnly.checked = false;
  commitFilterState();
  loadItems();
});
unknownOnly.addEventListener("click", () => {
  if (unknownOnly.checked) unfinishedOnly.checked = false;
  commitFilterState();
  loadItems();
});

// Search input management
function updateSearchWrapperClass() {
  const wrapper = searchInput.closest('.input-wrapper');
  if (wrapper) {
    wrapper.classList.toggle('has-value', searchInput.value.trim() !== '');
  }
}

// Search debounce timer (300ms)
let searchDebounceTimer = null;

searchInput.addEventListener("input", () => {
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
  }
  searchDebounceTimer = setTimeout(() => {
    searchDebounceTimer = null;
    renderItems();
    updateSearchWrapperClass();
  }, 300);
});

const searchIconBtn = document.querySelector(".icon");
// Prevent the icon button from stealing focus on mousedown so the
// click handler can correctly detect whether the search bar is focused.
searchIconBtn.addEventListener("mousedown", (e) => e.preventDefault());
searchIconBtn.addEventListener("click", () => {
  if (document.activeElement === searchInput && searchInput.value.trim() === "") {
    searchInput.blur();
  } else {
    searchInput.focus();
  }
});

viewTabs.forEach((tab) => {
  tab.addEventListener("click", () => setView(tab.dataset.view));
});

const timetableEditBtn = document.getElementById("timetable_edit_btn");
if (timetableEditBtn) {
  timetableEditBtn.addEventListener("click", toggleTimetableEditMode);
}

const timetableExampleBtn = document.getElementById("timetable_example_btn");
if (timetableExampleBtn) {
  timetableExampleBtn.addEventListener("click", loadExampleSchedule);
}

// Mobile timetable view toggle (Today/Full Week)
const timetableViewToggleBtns = document.querySelectorAll(".timetable_view_toggle_btn");
timetableViewToggleBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    timetableMobileView = btn.dataset.view;
    storageSet("timetableMobileView", timetableMobileView);
    
    // Update active button state
    timetableViewToggleBtns.forEach((b) => b.classList.remove("timetable_view_toggle_btn_active"));
    btn.classList.add("timetable_view_toggle_btn_active");
    
    renderTimetableMobile();
  });
});

languageToggle.addEventListener("click", () => {
  const newLang = currentLanguage === "en" ? "vi" : "en";
  setLanguage(newLang);
});

// Clear search input on page load to prevent persisted text
searchInput.value = "";
updateSearchWrapperClass();

function applyTheme(theme) {
  if (theme === "light") {
    document.body.classList.add("light");
  } else {
    document.body.classList.remove("light");
  }
}

function toggleTheme() {
  const isLight = document.body.classList.contains("light");
  const newTheme = isLight ? "dark" : "light";
  storageSet("theme", newTheme);
  applyTheme(newTheme);
}

const savedTheme = storageGet("theme") || "dark";
applyTheme(savedTheme);

themeToggle.addEventListener("click", toggleTheme);

// ── Intro Wizard ──────────────────────────────────────────────

// Intro wizard: two intro steps, then a final step where the user pastes a
// manual Canvas Personal Access Token.
const INTRO_STEPS = [
  { titleKey: "introStep1Title", descKey: "introStep1Desc", image: "/static/images/work-view.png" },
  { titleKey: "introStep2Title", descKey: "introStep2Desc", image: "/static/images/timetable.png" },
  { titleKey: "introChooseTitle", descKey: "introChooseDesc", isChoice: true },
];

let introReopenMode = false; // wizard opened from Settings → closing is free

function renderIntroStep(stepIndex) {
  debugLog("renderIntroStep called, stepIndex:", stepIndex);
  const step = INTRO_STEPS[stepIndex];
  if (!step) {
    debugLog("renderIntroStep: no step found for index", stepIndex);
    return;
  }

  const content = document.getElementById("intro_content");
  content.innerHTML = "";

  // Step indicator
  const indicator = document.createElement("p");
  indicator.className = "intro_step_indicator";
  indicator.setAttribute("data-step", String(stepIndex + 1));
  indicator.textContent = `${t("introStep")} ${stepIndex + 1} ${t("introOf")} ${INTRO_STEPS.length}`;
  content.appendChild(indicator);

  // Title
  const title = document.createElement("h2");
  title.className = "intro_step_title";
  title.textContent = t(step.titleKey);
  content.appendChild(title);

  // Navigation buttons (defined before if/else so both branches can use them)
  const nav = document.createElement("div");
  nav.className = "intro_nav";

  // Step dots
  const dots = document.createElement("div");
  dots.className = "intro_dots";
  for (let i = 0; i < INTRO_STEPS.length; i++) {
    const dot = document.createElement("span");
    dot.className = `intro_dot${i === stepIndex ? " intro_dot_active" : ""}`;
    dot.addEventListener("click", () => renderIntroStep(i));
    dots.appendChild(dot);
  }

  // Final step: enter a manual Canvas API token
  if (step.isChoice) {
    renderIntroChoiceStep(content, nav, dots, stepIndex);
    content.appendChild(nav);
    content.appendChild(dots);
    return;
  }

  // Screenshot — one per intro step.
  if (step.image) {
    const screenshot = document.createElement("img");
    screenshot.className = "intro_screenshot";
    screenshot.src = step.image;
    screenshot.alt = t(step.titleKey);
    screenshot.loading = "lazy";
    content.appendChild(screenshot);
  }

  // Description
  const desc = document.createElement("p");
  desc.className = "intro_step_desc";
  desc.textContent = t(step.descKey);
  content.appendChild(desc);

  // Optional note
  if (step.noteKey) {
    const note = document.createElement("p");
    note.className = "intro_step_note";
    note.textContent = t(step.noteKey);
    content.appendChild(note);
  }

  // Non-final steps: Back + Next navigation
  if (stepIndex > 0) {
    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "intro_nav_btn intro_nav_btn_prev";
    prevBtn.textContent = t("introPrev");
    prevBtn.addEventListener("click", () => renderIntroStep(stepIndex - 1));
    nav.appendChild(prevBtn);
  } else {
    const spacer = document.createElement("div");
    nav.appendChild(spacer);
  }

  if (stepIndex < INTRO_STEPS.length - 1) {
    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "intro_nav_btn intro_nav_btn_next";
    nextBtn.textContent = t("introNext");
    nextBtn.addEventListener("click", () => renderIntroStep(stepIndex + 1));
    nav.appendChild(nextBtn);
  }

  content.appendChild(nav);
  content.appendChild(dots);
}

function renderIntroChoiceStep(content, nav, dots, stepIndex) {
  // Choice description
  const desc = document.createElement("p");
  desc.className = "intro_step_desc";
  desc.textContent = t("introChooseDesc");
  content.appendChild(desc);

  // Manual token panel — the only login method now that OAuth is removed.
  const manualPanel = document.createElement("div");
  manualPanel.className = "intro_tab_panel intro_panel_manual";
  content.appendChild(manualPanel);
  renderIntroManualTokenPanel(manualPanel);

  // Back button only on the choice step
  if (stepIndex > 0) {
    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "intro_nav_btn intro_nav_btn_prev";
    prevBtn.textContent = t("introPrev");
    prevBtn.addEventListener("click", () => renderIntroStep(stepIndex - 1));
    nav.appendChild(prevBtn);
  }

  // Hide step dots on final step
  dots.style.display = "none";
}

function renderIntroManualTokenPanel(panel) {
  const inputGroup = document.createElement("div");
  inputGroup.className = "intro_token_group";

  const input = document.createElement("input");
  input.type = "password";
  input.id = "intro_token_input";
  input.className = "intro_token_input";
  input.placeholder = t("introTokenPlaceholder");
  input.autocomplete = "off";
  input.spellcheck = false;
  inputGroup.appendChild(input);

  // Show/hide toggle button
  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "token_toggle_btn";
  toggleBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-eye-slash" viewBox="0 0 16 16"><path d="M13.359 11.238C15.06 9.72 16 8 16 8s-3-5.5-8-5.5a7 7 0 0 0-2.79.588l.77.771A6 6 0 0 1 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13 13 0 0 1 14.828 8q-.086.13-.195.288c-.335.48-.83 1.12-1.465 1.755q-.247.248-.517.486z"/><path d="M11.297 9.176a3.5 3.5 0 0 0-4.474-4.474l.823.823a2.5 2.5 0 0 1 2.829 2.829zm-2.943 1.299.822.822a3.5 3.5 0 0 1-4.474-4.474l.823.823a2.5 2.5 0 0 0 2.829 2.829"/><path d="M3.35 5.47q-.27.24-.518.487A13 13 0 0 0 1.172 8l.195.288c.335.48.83 1.12-1.465 1.755C4.121 11.332 5.881 12.5 8 12.5c.716 0 1.39-.133 2.02-.36l.77.772A7 7 0 0 1 8 13.5C3 13.5 0 8 0 8s.939-1.721 2.641-3.238l.708.709zm10.296 8.884-12-12 .708-.708 12 12z"/></svg>`;
  toggleBtn.setAttribute("aria-label", "Toggle token visibility");
  toggleBtn.addEventListener("click", () => {
    const isPassword = input.type === "password";
    input.type = isPassword ? "text" : "password";
    toggleBtn.innerHTML = isPassword
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-eye" viewBox="0 0 16 16"><path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8M1.173 8a13 13 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5s3.879 1.168 5.168 2.457A13 13 0 0 1 14.828 8q-.086.13-.195.288c-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5s-3.879-1.168-5.168-2.457A13 13 0 0 1 1.172 8z"/><path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5M4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0"/></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-eye-slash" viewBox="0 0 16 16"><path d="M13.359 11.238C15.06 9.72 16 8 16 8s-3-5.5-8-5.5a7 7 0 0 0-2.79.588l.77.771A6 6 0 0 1 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13 13 0 0 1 14.828 8q-.086.13-.195.288c-.335.48-.83 1.12-1.465 1.755q-.247.248-.517.486z"/><path d="M11.297 9.176a3.5 3.5 0 0 0-4.474-4.474l.823.823a2.5 2.5 0 0 1 2.829 2.829zm-2.943 1.299.822.822a3.5 3.5 0 0 1-4.474-4.474l.823.823a2.5 2.5 0 0 0 2.829 2.829"/><path d="M3.35 5.47q-.27.24-.518.487A13 13 0 0 0 1.172 8l.195.288c.335.48.83 1.12-1.465 1.755C4.121 11.332 5.881 12.5 8 12.5c.716 0 1.39-.133 2.02-.36l.77.772A7 7 0 0 1 8 13.5C3 13.5 0 8 0 8s.939-1.721 2.641-3.238l.708.709zm10.296 8.884-12-12 .708-.708 12 12z"/></svg>`;
  });
  inputGroup.appendChild(toggleBtn);

  // T&C agreement checkbox (must be created before validateBtn handler)
  const tcGroup = document.createElement("div");
  tcGroup.className = "intro_tc_group";

  const tcCheckbox = document.createElement("input");
  tcCheckbox.type = "checkbox";
  tcCheckbox.id = "intro_tc_checkbox";
  tcCheckbox.className = "intro_tc_checkbox";

  const tcLabel = document.createElement("label");
  tcLabel.className = "intro_tc_label";
  tcLabel.setAttribute("for", "intro_tc_checkbox");

  const tcLabelText = document.createElement("span");
  tcLabelText.textContent = t("tcAgreeCheckbox");

  const tcLink = document.createElement("button");
  tcLink.type = "button";
  tcLink.className = "intro_tc_link";
  tcLink.textContent = t("tcViewTerms");
  tcLink.addEventListener("click", (e) => {
    e.preventDefault();
    openTermsModal();
  });

  tcLabel.append(tcLabelText, " ", tcLink);
  tcGroup.append(tcCheckbox, tcLabel);

  // Message area
  const msg = document.createElement("p");
  msg.id = "intro_message";
  msg.className = "intro_message";
  msg.hidden = true;
  panel.appendChild(msg);

  const validateBtn = document.createElement("button");
  validateBtn.type = "button";
  validateBtn.className = "intro_validate_btn";
  validateBtn.textContent = t("introValidate");
  validateBtn.addEventListener("click", () => {
    if (!tcCheckbox.checked) {
      msg.textContent = t("introTcError");
      msg.className = "intro_message intro_message_error";
      msg.hidden = false;
      return;
    }
    validateAndSaveToken();
  });
  inputGroup.appendChild(validateBtn);

  panel.appendChild(inputGroup);

  // API warning text
  const apiWarning = document.createElement("p");
  apiWarning.className = "intro_api_warning";
  apiWarning.textContent = t("tcApiWarning");
  panel.appendChild(apiWarning);

  panel.appendChild(tcGroup);

  tcCheckbox.addEventListener("change", () => {
    validateBtn.disabled = !tcCheckbox.checked;
  });
}

async function validateAndSaveToken() {
  const input = document.getElementById("intro_token_input");
  const msg = document.getElementById("intro_message");
  const token = input.value.trim();
  debugLog("validateAndSaveToken called, token present:", !!token);

  if (!token) {
    msg.textContent = t("introError");
    msg.className = "intro_message intro_message_error";
    msg.hidden = false;
    return;
  }

  msg.textContent = t("introValidating");
  msg.className = "intro_message intro_message_info";
  msg.hidden = false;

  try {
    debugLog("validateAndSaveToken: sending POST to /api/validate-token");
    const csrfToken = await getCsrfToken();
    const response = await fetch("/api/validate-token", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ token }),
    });
    const data = await response.json();
    debugLog("validateAndSaveToken: response", data);

    if (data.valid) {
      debugLog("validateAndSaveToken: token is valid, saving");
      saveToken(token);
      msg.textContent = t("introSuccess");
      msg.className = "intro_message intro_message_success";
      setTimeout(() => {
        debugLog("validateAndSaveToken: hiding overlay and reinitializing");
        hideIntroOverlay();
        reinitializeApp();
      }, 1000);
    } else {
      debugLog("validateAndSaveToken: token invalid:", data.message);
      msg.textContent = data.message || t("introError");
      msg.className = "intro_message intro_message_error";
    }
  } catch (err) {
    debugLog("validateAndSaveToken: error:", err.message);
    msg.textContent = t("introError");
    msg.className = "intro_message intro_message_error";
  }
}

function showIntroOverlay(startAtChoice) {
  debugLog("showIntroOverlay called, startAtChoice:", startAtChoice);
  // Close settings modals if they're open to prevent overlap
  for (const id of ["settings_menu_modal", "token_settings_modal"]) {
    const settingsModal = document.getElementById(id);
    if (settingsModal) {
      removeModal(settingsModal);
      debugLog("showIntroOverlay: removed", id);
    }
  }

  // When opened from Settings, closing the wizard should be free (no "you
  // haven't signed in" warning) — the user is already past onboarding.
  introReopenMode = !!startAtChoice;

  const overlay = document.getElementById("intro_overlay");
  if (overlay) {
    overlay.hidden = false;
    // Update dynamic header text
    const titleEl = document.getElementById("intro_title");
    if (titleEl) titleEl.textContent = t("introTitle");
    const subtitleEl = document.getElementById("intro_subtitle");
    if (subtitleEl) subtitleEl.textContent = t("introSubtitle");

    // Hide the warning by default — it is only shown when the user tries to
    // exit the wizard without having provided an API token.
    const warningEl = document.getElementById("intro_warning");
    if (warningEl) warningEl.hidden = true;

    // Jump straight to the choice step when re-connecting from Settings; runs
    // of the wizard otherwise start at the beginning.
    const jumpToChoice = startAtChoice;
    debugLog("showIntroOverlay: overlay unhidden, calling renderIntroStep", jumpToChoice ? INTRO_STEPS.length - 1 : 0);
    renderIntroStep(jumpToChoice ? INTRO_STEPS.length - 1 : 0);
  } else {
    debugLog("showIntroOverlay: overlay element NOT FOUND (DOM not ready?)");
  }
}

function hideIntroOverlay() {
  debugLog("hideIntroOverlay called");
  introReopenMode = false;
  const overlay = document.getElementById("intro_overlay");
  if (overlay) {
    overlay.hidden = true;
    debugLog("hideIntroOverlay: overlay hidden");
  } else {
    debugLog("hideIntroOverlay: overlay element NOT FOUND");
  }
}

// Attempt to close the intro wizard. If the user hasn't provided an API token
// yet, show a warning on the first attempt and keep the wizard open. A second
// attempt (or an existing token) closes it freely. When the wizard was opened
// from Settings (introReopenMode), closing is always free.
function attemptCloseIntro() {
  const warningEl = document.getElementById("intro_warning");
  if (warningEl && !introReopenMode && !getToken() && warningEl.hidden) {
    warningEl.textContent = t("introCloseWarning");
    warningEl.hidden = false;
    return;
  }
  hideIntroOverlay();
}

// Wire up the intro close (X) button so users can exit the wizard.
const introCloseBtn = document.getElementById("intro_close_btn");
if (introCloseBtn) {
  introCloseBtn.addEventListener("click", attemptCloseIntro);
}

// Arrow key shortcuts for the intro wizard (left = back, right = next)
document.addEventListener("keydown", (event) => {
  const overlay = document.getElementById("intro_overlay");
  if (!overlay || overlay.hidden) return;
  // Don't steal arrow keys while the user is typing in an input
  if (event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA" || event.target.isContentEditable) return;
  // Don't steal arrow keys while a modal is open on top of the wizard
  if (document.querySelector(".token_settings_modal:not([hidden])")) return;

  if (event.key === "Escape") {
    attemptCloseIntro();
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    // Find the current step index from the step indicator
    const indicator = document.querySelector(".intro_step_indicator");
    if (indicator) {
      const currentStep = Number(indicator.getAttribute("data-step")) - 1;
      if (currentStep > 0) {
        renderIntroStep(currentStep - 1);
      }
    }
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    const indicator = document.querySelector(".intro_step_indicator");
    if (indicator) {
      const currentStep = Number(indicator.getAttribute("data-step")) - 1;
      if (currentStep < INTRO_STEPS.length - 1) {
        renderIntroStep(currentStep + 1);
      }
    }
  }
});

function reinitializeApp() {
  // Reset all state to force a fresh load
  coursesLoaded = false;
  courses = [];
  items = [];
  itemCache = new Map();
  availableWeeks = [];
  selectedCourseId = null;
  overviewData = null;
  clearApiCache();

  // Reload the app in-place
  const currentView = storageGet("selectedView") || "work";
  setView(currentView);
  updateTokenWarning();
}

// ── Token Expiry Warning ───────────────────────────────────────

function updateTokenWarning() {
  const banner = document.getElementById("token_warning");
  if (!banner) return;

  const token = getToken();
  if (!token) {
    banner.hidden = true;
    return;
  }

  const ageDays = getTokenAgeDays();
  if (ageDays === null) {
    banner.hidden = true;
    return;
  }

  const maxAgeDays = 120; // ~3 months
  const warningThreshold = 7; // Warn 1 week before
  const remaining = maxAgeDays - ageDays;

  let message = "";
  let isExpired = false;

  if (remaining <= 0) {
    message = t("tokenExpired");
    isExpired = true;
  } else if (remaining <= 1) {
    message = t("tokenExpiresToday");
  } else if (remaining <= warningThreshold) {
    message = t("tokenExpiresSoon").replace("{days}", String(Math.ceil(remaining)));
  }

  if (message) {
    banner.querySelector(".token_warning_text").textContent = message;
    banner.hidden = false;
    banner.className = `token_warning${isExpired ? " token_warning_expired" : ""}`;
  } else {
    banner.hidden = true;
  }
}

// ── Shared modal close (X) button ─────────────────────────────

// Focus is saved when a modal opens and restored when it closes so
// keyboard users don't lose their place after dismissing a dialog.
let modalFocusAnchor = null;

function saveModalFocus() {
  modalFocusAnchor = document.activeElement;
}

function restoreModalFocus() {
  if (modalFocusAnchor && typeof modalFocusAnchor.focus === "function") {
    modalFocusAnchor.focus();
  }
  modalFocusAnchor = null;
}

// Marks an element as an accessible modal dialog, saves the current
// focus, and makes the dialog itself focusable so focus can move into it.
function prepareModal(modal) {
  saveModalFocus();
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("tabindex", "-1");
}

// Closes a modal and restores focus. #tc_modal is a static DOM element
// that is hidden rather than removed.
function removeModal(modal) {
  if (modal.id === "tc_modal") {
    modal.hidden = true;
  } else {
    modal.remove();
  }
  restoreModalFocus();
}

// Adds a top-right X close button to a modal's content element. The button
// reuses the same styling as the intro wizard's close button for consistency.
function addModalCloseButton(content, onClose) {
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "intro_close_btn";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "✕";
  closeBtn.addEventListener("click", onClose);
  content.appendChild(closeBtn);
}

async function getCsrfToken() {
  const response = await fetch("/api/csrf-token");
  if (!response.ok) {
    throw new Error("Failed to get CSRF token.");
  }

  const data = await response.json();
  if (!data.csrf_token) {
    throw new Error("Missing CSRF token.");
  }

  return data.csrf_token;
}

// Esc shortcut to close any open modal (Settings, API Token, Feedback, T&C).
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    const modal = document.querySelector(".token_settings_modal:not([hidden])");
    if (modal) {
      removeModal(modal);
    }
  }
});

// ── Terms and Conditions Modal ─────────────────────────────────

function openTermsModal() {
  const modal = document.getElementById("tc_modal");
  if (!modal) return;

  saveModalFocus();

  // Populate content
  const titleEl = document.getElementById("tc_title");
  const bodyEl = document.getElementById("tc_body");
  
  if (titleEl) titleEl.textContent = t("tcTitle");
  if (bodyEl) {
    bodyEl.innerHTML = "";
    
    // Create sections for each T&C item
    for (let i = 1; i <= 10; i++) {
      const section = document.createElement("div");
      section.className = "tc_section";
      
      const title = document.createElement("h3");
      title.textContent = t(`tcSection${i}Title`);
      
      const text = document.createElement("p");
      text.textContent = t(`tcSection${i}Text`);
      
      section.append(title, text);
      bodyEl.appendChild(section);
    }
  }

  // Add close button to sticky header
  const header = modal.querySelector(".tc_header_sticky");
  if (header) {
    // Remove any existing close button first
    const existingClose = header.querySelector(".intro_close_btn");
    if (existingClose) existingClose.remove();
    
    // Create close button with proper event handling
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "intro_close_btn";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.textContent = "✕";
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation(); // Prevent backdrop click
      removeModal(modal);
    });
    header.appendChild(closeBtn);
  }

  // Close on backdrop click (use once flag to prevent multiple listeners)
  if (!modal.hasAttribute("data-backdrop-listener")) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        removeModal(modal);
      }
    });
    modal.setAttribute("data-backdrop-listener", "true");
  }

  modal.hidden = false;
  setTimeout(() => modal.focus(), 0);
}

// ── Settings Menu Modal ────────────────────────────────────────

function openSettingsMenu() {
  // Close intro overlay if it's open to prevent overlap
  const introOverlay = document.getElementById("intro_overlay");
  if (introOverlay && !introOverlay.hidden) {
    introOverlay.hidden = true;
  }

  const existing = document.getElementById("settings_menu_modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "settings_menu_modal";
  modal.className = "token_settings_modal";
  prepareModal(modal);

  const content = document.createElement("div");
  content.className = "token_settings_content";

  const header = document.createElement("div");
  header.className = "settings_header";
  const title = document.createElement("h2");
  title.textContent = t("settingsTitle");
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "settings_header_close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "✕";
  closeBtn.addEventListener("click", () => removeModal(modal));
  header.appendChild(title);
  header.appendChild(closeBtn);
  content.appendChild(header);

  // ACCOUNT group
  const accountGroup = document.createElement("div");
  accountGroup.className = "settings_group";
  const accountLabel = document.createElement("p");
  accountLabel.className = "settings_group_label";
  accountLabel.textContent = t("settingsAccount");

  // API Token option
  const apiOption = document.createElement("button");
  apiOption.type = "button";
  apiOption.className = "settings_menu_option";
  apiOption.innerHTML = `
    <span class="settings_menu_icon">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3"></circle>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
      </svg>
    </span>
    <span class="settings_menu_label">${t("settingsConnect")}</span>
    <span class="settings_chevron" aria-hidden="true">›</span>
  `;
  apiOption.addEventListener("click", () => {
    removeModal(modal);
    showIntroOverlay(true);
  });
  accountGroup.appendChild(accountLabel);
  accountGroup.appendChild(apiOption);
  content.appendChild(accountGroup);

  // PREFERENCES group
  const prefsGroup = document.createElement("div");
  prefsGroup.className = "settings_group";
  const prefsLabel = document.createElement("p");
  prefsLabel.className = "settings_group_label";
  prefsLabel.textContent = t("settingsPreferences");

  // Split View toggle
  const splitOption = document.createElement("div");
  splitOption.className = "settings_menu_option settings_menu_toggle_row";
  splitOption.innerHTML = `
    <span class="settings_menu_icon">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="12" y1="3" x2="12" y2="21"></line>
      </svg>
    </span>
    <span class="settings_menu_label_text">
      <span class="settings_menu_label">${t("settingsSplitView")}</span>
      <span class="settings_menu_desc">${t("settingsSplitViewDesc")}</span>
    </span>
    <label class="toggle_switch">
      <input type="checkbox" id="settings_split_toggle" ${splitViewEnabled ? "checked" : ""}>
      <span class="toggle_slider"></span>
    </label>
  `;
  const splitToggle = splitOption.querySelector("#settings_split_toggle");
  splitToggle.addEventListener("change", () => {
    splitViewEnabled = splitToggle.checked;
    storageSet("splitView", String(splitViewEnabled));
    if (splitViewEnabled) {
      enableSplitView();
    } else {
      disableSplitView();
    }
  });
  // Prevent the row click from toggling the checkbox twice
  splitOption.addEventListener("click", (e) => {
    if (e.target !== splitToggle && !e.target.classList.contains("toggle_slider")) {
      splitToggle.checked = !splitToggle.checked;
      splitToggle.dispatchEvent(new Event("change"));
    }
  });
  prefsGroup.appendChild(prefsLabel);
  prefsGroup.appendChild(splitOption);
  content.appendChild(prefsGroup);

  // Divider
  const divider = document.createElement("div");
  divider.className = "settings_divider";
  content.appendChild(divider);

  // Feedback option (iconless)
  const feedbackOption = document.createElement("button");
  feedbackOption.type = "button";
  feedbackOption.className = "settings_menu_option";
  feedbackOption.innerHTML = `
    <span class="settings_menu_label">${t("settingsFeedback")}</span>
    <span class="settings_chevron" aria-hidden="true">›</span>
  `;
  feedbackOption.addEventListener("click", () => {
    removeModal(modal);
    openFeedbackForm();
  });
  content.appendChild(feedbackOption);

  modal.appendChild(content);

  // Close on backdrop click
  modal.addEventListener("click", (e) => {
    if (e.target === modal) removeModal(modal);
  });

  document.body.appendChild(modal);
  setTimeout(() => modal.focus(), 0);
}

// ── Feedback Form ─────────────────────────────────────────────

function openFeedbackForm() {
  const existing = document.getElementById("feedback_modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "feedback_modal";
  modal.className = "token_settings_modal";
  prepareModal(modal);

  const content = document.createElement("div");
  content.className = "token_settings_content feedback_form";

  const title = document.createElement("h2");
  title.textContent = t("feedbackTitle");
  content.appendChild(title);

  // Question 1: Star rating
  const ratingLabel = document.createElement("p");
  ratingLabel.className = "feedback_question";
  ratingLabel.textContent = t("feedbackRating");
  content.appendChild(ratingLabel);

  const starContainer = document.createElement("div");
  starContainer.className = "star_rating";
  let selectedRating = 0;

  for (let i = 1; i <= 5; i++) {
    const star = document.createElement("button");
    star.type = "button";
    star.className = "star";
    star.dataset.value = i;
    star.textContent = "★";
    star.setAttribute("aria-label", t("feedbackStarLabel").replace("{n}", String(i)));
    star.setAttribute("aria-pressed", "false");
    star.addEventListener("click", () => {
      selectedRating = i;
      starContainer.querySelectorAll(".star").forEach((s, idx) => {
        s.classList.toggle("star_filled", idx < i);
        s.setAttribute("aria-pressed", String(idx < i));
      });
    });
    star.addEventListener("mouseenter", () => {
      starContainer.querySelectorAll(".star").forEach((s, idx) => {
        s.classList.toggle("star_filled", idx < i);
      });
    });
    star.addEventListener("mouseleave", () => {
      starContainer.querySelectorAll(".star").forEach((s, idx) => {
        s.classList.toggle("star_filled", idx < selectedRating);
      });
    });
    starContainer.appendChild(star);
  }
  content.appendChild(starContainer);

  // Question 2: Usage type (radio)
  const usageLabel = document.createElement("p");
  usageLabel.className = "feedback_question";
  usageLabel.textContent = t("feedbackUsage");
  content.appendChild(usageLabel);

  const usageGroup = document.createElement("div");
  usageGroup.className = "feedback_radio_group";

  const usageOptions = [
    { value: "quizzes_assignments", key: "feedbackUsageQuizzes" },
    { value: "timetable", key: "feedbackUsageTimetable" },
    { value: "unfinished", key: "feedbackUsageUnfinished" },
    { value: "other", key: "feedbackUsageOther" },
  ];

  let selectedUsage = null;
  usageOptions.forEach((opt) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "feedback_radio_btn";
    btn.textContent = t(opt.key);
    btn.addEventListener("click", () => {
      selectedUsage = opt.value;
      usageGroup.querySelectorAll(".feedback_radio_btn").forEach((b) => b.classList.remove("feedback_radio_btn_active"));
      btn.classList.add("feedback_radio_btn_active");
    });
    usageGroup.appendChild(btn);
  });
  content.appendChild(usageGroup);

  // Question 3: Recommend (radio)
  const recommendLabel = document.createElement("p");
  recommendLabel.className = "feedback_question";
  recommendLabel.textContent = t("feedbackRecommend");
  content.appendChild(recommendLabel);

  const recommendGroup = document.createElement("div");
  recommendGroup.className = "feedback_radio_group";

  const recommendOptions = [
    { value: "yes", key: "feedbackRecommendYes" },
    { value: "maybe", key: "feedbackRecommendMaybe" },
    { value: "no", key: "feedbackRecommendNo" },
  ];

  let selectedRecommend = null;
  recommendOptions.forEach((opt) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "feedback_radio_btn";
    btn.textContent = t(opt.key);
    btn.addEventListener("click", () => {
      selectedRecommend = opt.value;
      recommendGroup.querySelectorAll(".feedback_radio_btn").forEach((b) => b.classList.remove("feedback_radio_btn_active"));
      btn.classList.add("feedback_radio_btn_active");
    });
    recommendGroup.appendChild(btn);
  });
  content.appendChild(recommendGroup);

  // Question 4: Improvement text
  const improveLabel = document.createElement("p");
  improveLabel.className = "feedback_question";
  improveLabel.textContent = t("feedbackImprove");
  content.appendChild(improveLabel);

  const improveTextarea = document.createElement("textarea");
  improveTextarea.className = "feedback_textarea";
  improveTextarea.placeholder = t("feedbackImprovePlaceholder");
  improveTextarea.rows = 3;
  content.appendChild(improveTextarea);

  // Message area (hidden by default, shown when an error/success/info message is set)
  const feedbackMsg = document.createElement("p");
  feedbackMsg.id = "feedback_message";
  feedbackMsg.className = "intro_message";
  feedbackMsg.hidden = true;
  content.appendChild(feedbackMsg);

  // Submit button
  const submitBtn = document.createElement("button");
  submitBtn.type = "button";
  submitBtn.className = "intro_validate_btn";
  submitBtn.style.width = "100%";
  submitBtn.style.marginTop = "8px";
  submitBtn.textContent = t("feedbackSubmit");
  submitBtn.addEventListener("click", async () => {
    if (selectedRating === 0) {
      feedbackMsg.textContent = t("feedbackValidationRating");
      feedbackMsg.className = "intro_message intro_message_error";
      feedbackMsg.hidden = false;
      return;
    }
    if (!selectedUsage) {
      feedbackMsg.textContent = t("feedbackValidationUsage");
      feedbackMsg.className = "intro_message intro_message_error";
      feedbackMsg.hidden = false;
      return;
    }
    if (!selectedRecommend) {
      feedbackMsg.textContent = t("feedbackValidationRecommend");
      feedbackMsg.className = "intro_message intro_message_error";
      feedbackMsg.hidden = false;
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = t("feedbackSubmitting");
    feedbackMsg.textContent = "";
    feedbackMsg.className = "intro_message";
    feedbackMsg.hidden = true;

    try {
      const csrfToken = await getCsrfToken();
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({
          rating: selectedRating,
          usage_type: selectedUsage,
          recommend: selectedRecommend,
          improvement: improveTextarea.value.trim(),
        }),
      });
      const data = await response.json();

      if (data.success) {
        feedbackMsg.textContent = t("feedbackSuccess");
        feedbackMsg.className = "intro_message intro_message_success";
        feedbackMsg.hidden = false;
        submitBtn.textContent = t("feedbackSubmit");
        submitBtn.disabled = true;
        setTimeout(() => removeModal(modal), 2000);
      } else {
        feedbackMsg.textContent = data.message || t("feedbackError");
        feedbackMsg.className = "intro_message intro_message_error";
        feedbackMsg.hidden = false;
        submitBtn.disabled = false;
        submitBtn.textContent = t("feedbackSubmit");
      }
    } catch (err) {
      feedbackMsg.textContent = t("feedbackError");
      feedbackMsg.className = "intro_message intro_message_error";
      feedbackMsg.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = t("feedbackSubmit");
    }
  });
  content.appendChild(submitBtn);

  addModalCloseButton(content, () => removeModal(modal));

  modal.appendChild(content);

  // Close on backdrop click
  modal.addEventListener("click", (e) => {
    if (e.target === modal) removeModal(modal);
  });

  document.body.appendChild(modal);
  setTimeout(() => modal.focus(), 0);
}

// ── Consent Banner ─────────────────────────────────────────────

function updateConsentBanner() {
    const textEl = document.getElementById("consent_text");
    const acceptBtn = document.getElementById("consent_accept");
    const rejectBtn = document.getElementById("consent_reject");
    const learnBtn = document.getElementById("consent_learn");
    
    if (textEl) textEl.textContent = t("consentText");
    if (acceptBtn) acceptBtn.textContent = t("consentAccept");
    if (rejectBtn) rejectBtn.textContent = t("consentReject");
    if (learnBtn) learnBtn.textContent = t("consentLearn");
}

// ── Initialize ─────────────────────────────────────────────────

// Global handler for unhandled promise rejections to prevent silent failures
window.addEventListener("unhandledrejection", (event) => {
  console.error("[VinFocus] Unhandled rejection:", event.reason);
  // Don't show UI for AbortError (intentional request cancellations)
  if (event.reason && event.reason.name === "AbortError") return;
});

document.addEventListener("DOMContentLoaded", async () => {
  // Setup overlay
  const overlay = document.getElementById("intro_overlay");
  let showingSetup = false;
  if (overlay) {
    // Show the wizard unless the user already has a saved API token.
    const hasLocalToken = !!getToken();

    if (!hasLocalToken) {
      showIntroOverlay();
      showingSetup = true;
    }
  }

  // Only start the app if we have a token (overlay not shown)
  if (!showingSetup) {
    const urlParams = new URLSearchParams(window.location.search);
    const initialView = urlParams.get("view")
      || storageGet("selectedView")
      || "work";
    // Mark that the initial load should bust cache for fresh completion data
    _initialLoadBustCache = true;
    setView(initialView);
  }

  // Consent banner handlers
  const consentBanner = document.getElementById("consent_banner");
  const consentAccept = document.getElementById("consent_accept");
  const consentReject = document.getElementById("consent_reject");
  const consentLearn = document.getElementById("consent_learn");
  
  if (consentAccept) {
    consentAccept.addEventListener("click", () => {
      setStorageConsent(true);
      if (consentBanner) consentBanner.hidden = true;
    });
  }
  
  if (consentReject) {
    consentReject.addEventListener("click", () => {
      setStorageConsent(false);
      if (consentBanner) consentBanner.hidden = true;
    });
  }
  
  if (consentLearn) {
    consentLearn.addEventListener("click", () => {
      openTermsModal();
    });
  }
  
  // Show consent banner if no decision has been made
  if (consentBanner && getStorageConsent() === null) {
    consentBanner.hidden = false;
  }
  
  // Populate consent banner text
  updateConsentBanner();

  // Terms and Conditions button
  const tcBtn = document.getElementById("tc_btn");
  if (tcBtn) {
    tcBtn.addEventListener("click", openTermsModal);
  }

  // Settings button - opens the settings menu
  const settingsBtn = document.getElementById("token_settings_btn");
  if (settingsBtn) {
    settingsBtn.addEventListener("click", openSettingsMenu);
  }

    // Subject label edit button
  if (subjectLabelEditBtn) {
    subjectLabelEditBtn.addEventListener("click", toggleSubjectLabelEditMode);
  }

  // E-Book Library card (mobile tap → modal). init re-derives the input
  // modality from renderEbookLibrary(), which has already run via renderAll().
  initEbookCard();

  // Token expiry warning
  updateTokenWarning();
  // Check every hour
  setInterval(updateTokenWarning, 60 * 60 * 1000);

  // Keep the timetable's current/next indicators in sync with the clock.
  // Uses requestAnimationFrame so it pauses when the tab is hidden,
  // and only runs during weekday school hours (7:40am – 3:30pm).
  requestAnimationFrame(timetableClockLoop);

  // Warning banner "Update" button
  const warningBtn = document.getElementById("token_warning_btn");
  if (warningBtn) {
    warningBtn.addEventListener("click", openSettingsMenu);
  }

  // Warning banner dismiss button
  const dismissBtn = document.getElementById("token_warning_dismiss");
  if (dismissBtn) {
    dismissBtn.addEventListener("click", () => {
      const banner = document.getElementById("token_warning");
      if (banner) {
        banner.hidden = true;
      }
    });
  }
});

// Initialize language toggle text and render all text
if (languageToggle) {
  languageToggle.textContent = currentLanguage === "vi" ? "VN" : "EN";
}

renderAll();

// ── Restore Split View on Load ─────────────────────────────────
if (splitViewEnabled) {
  // Enable split view after initial render completes
  setTimeout(() => enableSplitView(), 0);
}

// ── Service Worker Registration ────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/static/sw.js').then(() => {
      console.log('[VinFocus] Service worker registered');
    }).catch((err) => {
      console.log('[VinFocus] Service worker registration failed:', err);
    });
  });
}

// Add swipe gesture for mobile timetable
let touchStartX = 0;
let touchStartY = 0;
let touchEndX = 0;
let touchEndY = 0;

timetableMobile.addEventListener("touchstart", (e) => {
  _lastTimetableInteraction = Date.now();
  const touch = e.changedTouches[0];
  touchStartX = touch.screenX;
  touchStartY = touch.screenY;
  touchEndX = touchStartX;
  touchEndY = touchStartY;
}, { passive: true });

timetableMobile.addEventListener("touchmove", (e) => {
  _lastTimetableInteraction = Date.now();
  // Track the last position so the swipe delta is the final drift
  const touch = e.changedTouches[0];
  touchEndX = touch.screenX;
  touchEndY = touch.screenY;
}, { passive: true });

timetableMobile.addEventListener("scroll", () => {
  _lastTimetableInteraction = Date.now();
}, { passive: true });

timetableMobile.addEventListener("touchend", () => {
  handleSwipe();
}, { passive: true });

timetableMobile.addEventListener("touchcancel", () => {
  touchStartX = 0;
  touchStartY = 0;
  touchEndX = 0;
  touchEndY = 0;
}, { passive: true });

function handleSwipe() {
  const swipeThreshold = 50;
  const diff = touchStartX - touchEndX;
  const diffY = touchEndY - touchStartY;

  // Only treat as a horizontal swipe when the horizontal drift clearly
  // dominates vertical drift — otherwise a diagonal vertical scroll would
  // accidentally flip the view.
  if (Math.abs(diff) < swipeThreshold || Math.abs(diff) < Math.abs(diffY) * 1.5) return;

  const todayKey = todayDayKey();
  if (!todayKey) return;

  // Swipe left: show full week, Swipe right: show today
  if (diff > 0 && timetableMobileView === "today") {
    // Swipe left - switch to full week
    timetableMobileView = "week";
    storageSet("timetableMobileView", "week");
    updateTimetableViewToggleButtons();
    renderTimetableMobile();
  } else if (diff < 0 && timetableMobileView === "week") {
    // Swipe right - switch to today
    timetableMobileView = "today";
    storageSet("timetableMobileView", "today");
    updateTimetableViewToggleButtons();
    renderTimetableMobile();
  }

  touchStartX = 0;
  touchStartY = 0;
  touchEndX = 0;
  touchEndY = 0;
}

function updateTimetableViewToggleButtons() {
  const btns = document.querySelectorAll(".timetable_view_toggle_btn");
  btns.forEach((btn) => {
    btn.classList.toggle("timetable_view_toggle_btn_active", btn.dataset.view === timetableMobileView);
  });
}
