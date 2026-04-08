const DEFAULT_PROJECTS = {
  updated_at: "2026-03-25T08:30:00+08:00",
  records: [
    {
      id: "p1",
      fields: {
        "DEMO名称": "AI 辅助创新提案系统",
        "状态": "Experiment",
        "负责人": [{ name: "Ming" }],
        "DEMO的思路": "将创意从收集到评审自动化，缩短 60% 评审周期。",
        "解决的问题": "降低创新提案从收集到执行的转化门槛。",
        "进度": 72
      }
    }
  ]
};

const DEFAULT_IDEAS = {
  updated_at: "2026-03-25T08:15:00+08:00",
  records: [
    {
      id: "i1",
      created_time: "2026-03-25T08:15:00+08:00",
      fields: {
        "IDEA标题": "创新挑战赛小程序",
        "状态": "OPEN POOL",
        "填写人": [{ name: "Jin" }],
        "demo的思路（非必填）": "用任务解锁和互评机制持续吸引参与。",
        "解决的问题（必填）": "团队创意输入零散，缺少可持续的收集和激励机制。"
      }
    }
  ]
};

const API_BASE = "/api";
const PROJECT_STATUS_ORDER = ["Productization", "Experiment", "Proposal", "Terminated", "Archived"];
const PROJECT_STATUS_META = {
  Proposal: { label: "Proposal", subtitle: "提案阶段", className: "proposal" },
  Experiment: { label: "Experiment", subtitle: "实验阶段", className: "experiment" },
  Terminated: { label: "Terminated", subtitle: "终止阶段", className: "terminated" },
  Productization: { label: "Productization", subtitle: "产品化阶段", className: "productization" },
  Archived: { label: "Archived", subtitle: "归档阶段", className: "archived" },
};
const FIELD_ALIASES = {
  projectTitle: ["DEMO名称", "项目名称", "Title", "标题"],
  projectTag: ["标签", "Tag", "标签名"],
  projectStatus: ["状态", "Status", "项目状态", "阶段"],
  ideaTag: ["标签", "Tag", "标签名", "分类", "类型"],
  ideaStatus: ["状态", "Status", "阶段", "Stage"],
  ideaCreatedAt: ["创建时间", "Created Time", "created_at"],
  ideaTitle: ["IDEA标题", "Idea", "Title", "标题"],
  owner: ["负责人", "Owner", "Owner/Lead", "Lead"],
  proposer: ["填写人", "提出人", "Owner", "Creator"],
  likes: ["点赞", "点赞数", "Likes", "likes", "Votes", "votes"],
  problem: ["解决的问题", "解决的问题（必填）"],
  plan: ["DEMO的思路", "demo的思路（非必填）", "思路", "Summary", "描述", "简介"],
  expectedDate: ["预期可demo时间", "预期展示时间", "预期时间", "预计时间"],
  progress: ["进度", "Progress", "progress"],
  resultLink: ["成果展示", "成果展示链接", "成果链接", "展示链接", "Demo链接", "Demo Link", "成果demo", "Demo地址", "成果", "链接"],
  parent: ["父记录 2", "父记录"]
};

const EMPTY_MARKERS = new Set(["", null, undefined]);
const TAB_QUERY_PARAM = "tab";

const state = {
  guestMode: false,
  authUser: null,
  submitMode: "auth",
  activePool: "ideas",
  searchQuery: "",
  ideaCategoryOptions: [],
  likingIdeaIds: new Set(),
  likingCommentIds: new Set(),
  loadingCommentTargets: new Set(),
  submittingCommentTargets: new Set(),
  expandedProjects: new Set(),
  expandedComments: new Set(),
  projectsTree: [],
  ideas: [],
  commentCounts: {},
  commentsByTarget: {},
  commentSummarySignature: "",
  childCount: 0,
  projectSignature: "",
  ideaSignature: "",
  projectsTableUrl: "https://lq9n5lvfn2i.feishu.cn/wiki/CZBWwReNHic9m4kUV95cWKJwnRe?table=tblvIoMdw5nslGsy&view=vewRk0ObQk",
  ideasTableUrl: "https://lq9n5lvfn2i.feishu.cn/wiki/CZBWwReNHic9m4kUV95cWKJwnRe?table=tblPk1wR2xYSztdL&view=vewCeUkPfz"
};

const elements = {
  projectsList: document.getElementById("projectsList"),
  ideasList: document.getElementById("ideasList"),
  projectsView: document.getElementById("projectsView"),
  ideasView: document.getElementById("ideasView"),
  projectCount: document.getElementById("projectCount"),
  childCount: document.getElementById("childCount"),
  ideaCount: document.getElementById("ideaCount"),
  momentum: document.getElementById("momentum"),
  refreshBtn: document.getElementById("refreshBtn"),
  authBadge: document.getElementById("authBadge"),
  authBanner: document.getElementById("authBanner"),
  loginBtn: document.getElementById("loginBtn"),
  guestToggleBtn: document.getElementById("guestToggleBtn"),
  poolTabs: document.getElementById("poolTabs"),
  searchInput: document.getElementById("searchInput"),
  heroTitleLink: document.getElementById("heroTitleLink"),
  heroTitle: document.getElementById("heroTitle"),
  projectStatusOverviewWrap: document.getElementById("projectStatusOverviewWrap"),
  projectStatusOverview: document.getElementById("projectStatusOverview"),
  heroDescription: document.getElementById("heroDescription"),
  panelKicker: document.getElementById("panelKicker"),
  ideaModal: document.getElementById("ideaModal"),
  openIdeaModalBtn: document.getElementById("openIdeaModalBtn"),
  closeIdeaModalBtn: document.getElementById("closeIdeaModalBtn"),
  closeIdeaModalBg: document.getElementById("closeIdeaModalBg"),
  ideaForm: document.getElementById("ideaForm"),
  ideaTitleInput: document.getElementById("ideaTitle"),
  ideaTagInput: document.getElementById("ideaTag"),
  ideaTagOptions: document.getElementById("ideaTagOptions"),
  ideaTagSuggestions: document.getElementById("ideaTagSuggestions"),
  ideaProblemInput: document.getElementById("ideaProblem"),
  ideaPlanInput: document.getElementById("ideaPlan"),
  ideaOwnerInput: document.getElementById("ideaOwner"),
  ideaStatus: document.getElementById("ideaStatus"),
  submitModeToggle: document.getElementById("submitModeToggle"),
  submitModeMeta: document.getElementById("submitModeMeta"),
  modalLoginBtn: document.getElementById("modalLoginBtn")
};

function pickField(fields, keys) {
  for (const key of keys) {
    if (fields[key] !== undefined && fields[key] !== null) return fields[key];
  }
  return "";
}

function normalizePoolValue(value) {
  if (value === "projects") return "projects";
  if (value === "ideas") return "ideas";
  return "";
}

function getPoolFromLocation() {
  const url = new URL(window.location.href);
  const queryPool = normalizePoolValue(String(url.searchParams.get(TAB_QUERY_PARAM) || "").trim().toLowerCase());
  if (queryPool) return queryPool;
  const hashPool = normalizePoolValue(String(window.location.hash || "").replace(/^#/, "").trim().toLowerCase());
  return hashPool || "ideas";
}

function syncPoolUrl(pool, historyMode = "replace") {
  const normalizedPool = normalizePoolValue(pool) || "ideas";
  const url = new URL(window.location.href);
  url.searchParams.set(TAB_QUERY_PARAM, normalizedPool);
  if (historyMode === "push") {
    window.history.pushState({ pool: normalizedPool }, "", url);
    return;
  }
  window.history.replaceState({ pool: normalizedPool }, "", url);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getMentionLabel(mentionType) {
  switch (String(mentionType || "").trim()) {
    case "Docx":
      return "飞书文档";
    case "Sheet":
      return "飞书表格";
    case "Bitable":
      return "多维表格";
    case "Wiki":
      return "知识库";
    case "File":
      return "附件";
    default:
      return "";
  }
}

function extractTextContent(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => extractTextContent(item)).join("");
  if (typeof value !== "object") return "";

  const directText = [value.text, value.name, value.title, value.label]
    .find((candidate) => typeof candidate === "string" && candidate.trim());
  if (directText) return directText;

  const directLink = [value.link, value.url, value.href]
    .find((candidate) => typeof candidate === "string" && candidate.trim());
  if (directLink) return directLink;

  return "";
}

function collectRichSegments(value) {
  if (value === null || value === undefined || value === "") return [];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [{ text: String(value) }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectRichSegments(item));
  }
  if (typeof value !== "object") return [];

  const href = [value.link, value.url, value.href]
    .find((candidate) => typeof candidate === "string" && /^https?:\/\//i.test(candidate.trim()));
  const text = [value.text, value.name, value.title, value.label]
    .find((candidate) => typeof candidate === "string" && candidate.trim());

  if (href) {
    return [{
      text: text || getMentionLabel(value.mentionType) || href,
      href,
    }];
  }
  if (text) return [{ text }];
  return [];
}

function formatRichText(value) {
  const segments = collectRichSegments(value);
  if (segments.length) {
    return segments.map((segment) => {
      if (segment.href) {
        return `<a class="inline-link" href="${escapeHtml(segment.href)}" target="_blank" rel="noreferrer">${escapeHtml(segment.text).replace(/\n/g, "<br />")}</a>`;
      }
      return linkifyText(segment.text).replace(/\n/g, "<br />");
    }).join("");
  }

  const text = extractTextContent(value).trim();
  if (!text) return "暂无信息";
  return linkifyText(text).replace(/\n/g, "<br />");
}

function hasMeaningfulFields(fields) {
  if (!fields || typeof fields !== "object") return false;
  const keys = Object.keys(fields);
  if (!keys.length) return false;
  return keys.some((key) => !EMPTY_MARKERS.has(fields[key]));
}

function extractPersonName(value) {
  if (Array.isArray(value) && value.length) {
    return value[0]?.name || value[0]?.en_name || "未指定";
  }
  if (typeof value === "string" && value.trim()) return value.trim();
  return "未指定";
}

function extractParentId(value) {
  if (!Array.isArray(value) || !value.length) return null;
  const first = value[0];
  if (Array.isArray(first?.record_ids) && first.record_ids.length) {
    return first.record_ids[0];
  }
  if (typeof first?.id === "string" && first.id) return first.id;
  return null;
}

function formatDate(value) {
  if (!value) return "No ETA";
  if (typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.valueOf())) {
      return date.toLocaleDateString("zh-CN", {
        year: "numeric",
        month: "numeric",
        day: "numeric"
      });
    }
  }
  return extractTextContent(value) || String(value);
}

function normalizeProgress(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  if (num >= 0 && num <= 1) {
    return Math.round(num * 100);
  }
  return Math.max(0, Math.min(100, Math.round(num)));
}

function normalizeProjectStatus(value) {
  const raw = extractTextContent(value).trim().toLowerCase();
  if (!raw) return "Proposal";
  if (["proposal", "proposed", "提案阶段", "提案"].includes(raw)) return "Proposal";
  if (["experiment", "experimentation", "实验阶段", "实验"].includes(raw)) return "Experiment";
  if (["terminated", "terminate", "终止阶段", "终止"].includes(raw)) return "Terminated";
  if (["productization", "productized", "产品化阶段", "产品化"].includes(raw)) return "Productization";
  if (["archived", "archive", "归档阶段", "归档"].includes(raw)) return "Archived";
  return "Proposal";
}

function getProjectStatusMeta(status) {
  return PROJECT_STATUS_META[normalizeProjectStatus(status)] || PROJECT_STATUS_META.Proposal;
}

function getProjectStatusCounts() {
  const counts = Object.fromEntries(PROJECT_STATUS_ORDER.map((status) => [status, 0]));
  state.projectsTree.forEach((project) => {
    const normalized = normalizeProjectStatus(project.status);
    counts[normalized] = (counts[normalized] || 0) + 1;
  });
  return counts;
}

function renderProjectStatusOverview() {
  if (!elements.projectStatusOverview) return;
  const counts = getProjectStatusCounts();
  elements.projectStatusOverview.innerHTML = PROJECT_STATUS_ORDER.map((status) => {
    const meta = getProjectStatusMeta(status);
    return `
      <button class="status-overview-card" type="button" data-project-status-jump="${escapeHtml(status)}">
        <span class="status-overview-label">${escapeHtml(meta.label)}</span>
        <strong>${counts[status] || 0}</strong>
      </button>
    `;
  }).join("");
}

function extractLink(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    const match = trimmed.match(/https?:\/\/[^\s<>"'）)]+/i);
    return match ? match[0] : "";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = extractLink(item);
      if (candidate) return candidate;
    }
    return "";
  }
  if (typeof value === "object") {
    const candidates = [value.link, value.url, value.href, value.text];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && /^https?:\/\//i.test(candidate.trim())) {
        return candidate.trim();
      }
    }
  }
  return "";
}

function linkifyText(text) {
  const input = String(text || "");
  const pattern = /(https?:\/\/[^\s<>"'）)]+)/gi;
  let lastIndex = 0;
  let html = "";
  let match;
  while ((match = pattern.exec(input)) !== null) {
    html += escapeHtml(input.slice(lastIndex, match.index));
    const url = match[0];
    html += `<a class="inline-link" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(url)}</a>`;
    lastIndex = match.index + url.length;
  }
  html += escapeHtml(input.slice(lastIndex));
  return html;
}

function normalizeLikes(value) {
  const num = Number(value);
  if (Number.isFinite(num)) return Math.max(0, Math.round(num));
  return 0;
}

function getIdeaIconMarkup() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="idea-glow" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#00E5FF"></stop>
          <stop offset="55%" stop-color="#8A5CFF"></stop>
          <stop offset="100%" stop-color="#FF4FD8"></stop>
        </linearGradient>
      </defs>
      <path d="M12 3.2a4.9 4.9 0 0 0-3.45 8.38c.56.56.9 1.17 1.05 1.84h4.8c.15-.67.5-1.28 1.05-1.84A4.9 4.9 0 0 0 12 3.2Zm-2.15 12.9h4.3m-3.55 2.7h2.8" fill="none" stroke="url(#idea-glow)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M17.4 5.2 18 6.8l1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6.6-1.6Z" fill="url(#idea-glow)"/>
    </svg>
  `;
}

function getLikeIconMarkup() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 20.2 4.9 13.4a4.3 4.3 0 0 1 6.08-6.1L12 8.3l1.02-1a4.3 4.3 0 1 1 6.08 6.1L12 20.2Z" fill="currentColor" fill-opacity="0.16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
}

function canUseAuthMode() {
  return Boolean(state.authUser);
}

function canUseGuestMode() {
  return Boolean(state.guestMode);
}

function normalizeSubmitMode(preferredMode) {
  if (preferredMode === "guest") {
    return canUseGuestMode() ? "guest" : "auth";
  }
  return "auth";
}

function collectIdeaCategoryOptions(ideas) {
  const categories = new Set();
  ideas.forEach((idea) => {
    const tag = String(idea?.tag || "").trim();
    if (tag) categories.add(tag);
  });
  return Array.from(categories).sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function renderIdeaCategoryOptions() {
  if (elements.ideaTagOptions) {
    elements.ideaTagOptions.innerHTML = state.ideaCategoryOptions
      .map((tag) => `<option value="${escapeHtml(tag)}"></option>`)
      .join("");
  }
  if (elements.ideaTagSuggestions) {
    elements.ideaTagSuggestions.innerHTML = state.ideaCategoryOptions.length
      ? state.ideaCategoryOptions.map((tag) => `
          <button class="tag-picker-chip" type="button" data-idea-tag-option="${escapeHtml(tag)}">${escapeHtml(tag)}</button>
        `).join("")
      : '<div class="tag-picker-empty">No categories yet. Type a new one.</div>';
  }
}

function resolveActionSubmitMode(preferredMode) {
  if (preferredMode === "guest" && canUseGuestMode()) {
    return "guest";
  }
  if (preferredMode === "auth" && canUseAuthMode()) {
    return "auth";
  }
  if (canUseGuestMode()) {
    return "guest";
  }
  return "auth";
}

function resolveCommentSubmitMode() {
  if (canUseAuthMode()) return "auth";
  if (canUseGuestMode()) return "guest";
  return "auth";
}

function getCommentIdentityText() {
  const mode = resolveCommentSubmitMode();
  if (mode === "auth" && state.authUser?.name) {
    return `Authorized account: ${state.authUser.name}`;
  }
  if (mode === "guest") {
    return "Submitting as guest";
  }
  return "Authorization required to comment";
}

function renderSubmitMode() {
  state.submitMode = normalizeSubmitMode(state.submitMode);
  const buttons = elements.submitModeToggle?.querySelectorAll("[data-submit-mode]") || [];
  buttons.forEach((button) => {
    const mode = button.dataset.submitMode;
    const available = mode === "auth" ? true : canUseGuestMode();
    const selected = state.submitMode === mode;
    button.classList.toggle("active", selected);
    button.disabled = !available;
  });

  if (state.submitMode === "auth") {
    if (state.authUser?.name) {
      elements.submitModeMeta.textContent = `Authorized account: ${state.authUser.name}`;
      elements.modalLoginBtn.hidden = true;
    } else {
      elements.submitModeMeta.textContent = "";
      elements.modalLoginBtn.hidden = false;
    }
    return;
  }

  elements.submitModeMeta.textContent = "";
  elements.modalLoginBtn.hidden = true;
}

function normalizeProjectRecord(record) {
  const fields = record.fields || {};
  return {
    id: record.id,
    title: extractTextContent(pickField(fields, FIELD_ALIASES.projectTitle)).trim() || "未命名项目",
    tag: extractTextContent(pickField(fields, FIELD_ALIASES.projectTag)).trim() || "SYS-CORE",
    status: normalizeProjectStatus(pickField(fields, FIELD_ALIASES.projectStatus)),
    problem: pickField(fields, FIELD_ALIASES.problem),
    plan: pickField(fields, FIELD_ALIASES.plan),
    owner: extractPersonName(pickField(fields, FIELD_ALIASES.owner)),
    expectedDate: formatDate(pickField(fields, FIELD_ALIASES.expectedDate)),
    progress: normalizeProgress(pickField(fields, FIELD_ALIASES.progress)),
    resultLink: extractLink(pickField(fields, FIELD_ALIASES.resultLink)),
    parentId: extractParentId(pickField(fields, FIELD_ALIASES.parent)),
    children: []
  };
}

function buildTableUrl(pool) {
  return pool === "projects" ? state.projectsTableUrl : state.ideasTableUrl;
}

function updateTitleJump() {
  if (!elements.heroTitleLink) return;
  const href = buildTableUrl(state.activePool);
  if (href) {
    elements.heroTitleLink.href = href;
    elements.heroTitleLink.removeAttribute("aria-disabled");
    elements.heroTitleLink.classList.remove("disabled");
  } else {
    elements.heroTitleLink.removeAttribute("href");
    elements.heroTitleLink.setAttribute("aria-disabled", "true");
    elements.heroTitleLink.classList.add("disabled");
  }
}

function buildProjectTree(records) {
  const list = records
    .filter((record) => hasMeaningfulFields(record.fields))
    .map(normalizeProjectRecord)
    .filter((record) => record.title && record.title !== "未命名项目");

  const map = new Map(list.map((item) => [item.id, item]));
  const roots = [];
  let childCount = 0;

  list.forEach((item) => {
    if (item.parentId && map.has(item.parentId) && item.parentId !== item.id) {
      map.get(item.parentId).children.push(item);
      childCount += 1;
      return;
    }
    roots.push(item);
  });

  roots.forEach((root) => {
    if (!root.progress && root.children.length) {
      const total = root.children.reduce((sum, child) => sum + child.progress, 0);
      root.progress = Math.round(total / root.children.length);
    }
  });

  return {
    roots,
    childCount
  };
}

function compareProjectsByProgressDesc(a, b) {
  const progressDiff = (Number(b?.progress) || 0) - (Number(a?.progress) || 0);
  if (progressDiff !== 0) return progressDiff;

  const titleDiff = String(a?.title || "").localeCompare(String(b?.title || ""), "zh-CN");
  if (titleDiff !== 0) return titleDiff;

  return String(a?.id || "").localeCompare(String(b?.id || ""));
}

function groupProjectsByStatus(projects) {
  const groups = new Map(PROJECT_STATUS_ORDER.map((status) => [status, []]));
  projects.forEach((project) => {
    const normalized = normalizeProjectStatus(project.status);
    if (!groups.has(normalized)) groups.set(normalized, []);
    groups.get(normalized).push(project);
  });
  return PROJECT_STATUS_ORDER
    .map((status) => ({ status, items: (groups.get(status) || []).slice().sort(compareProjectsByProgressDesc) }))
    .filter((group) => group.items.length);
}

function normalizeIdeaRecord(record) {
  const fields = record.fields || {};
  return {
    id: record.id,
    createdAt: pickField(fields, FIELD_ALIASES.ideaCreatedAt) || record.created_time || record.createdAt || "",
    sourceOrder: Number.isFinite(record.sourceOrder) ? record.sourceOrder : -1,
    title: extractTextContent(pickField(fields, FIELD_ALIASES.ideaTitle)).trim() || "未命名 Idea",
    tag: extractTextContent(pickField(fields, FIELD_ALIASES.ideaTag)).trim() || "CONCEPT",
    status: extractTextContent(pickField(fields, FIELD_ALIASES.ideaStatus)).trim() || "OPEN POOL",
    problem: pickField(fields, FIELD_ALIASES.problem),
    plan: pickField(fields, FIELD_ALIASES.plan),
    owner: extractPersonName(pickField(fields, FIELD_ALIASES.proposer)),
    likes: normalizeLikes(pickField(fields, FIELD_ALIASES.likes))
  };
}

function parseSortableTime(value) {
  if (!value) return 0;
  const raw = String(value).trim();
  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) {
      return numeric > 1e12 ? numeric : numeric * 1000;
    }
  }
  const timestamp = new Date(raw).valueOf();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function compareIdeasByCreatedAtDesc(a, b) {
  const timeDiff = parseSortableTime(b?.createdAt) - parseSortableTime(a?.createdAt);
  if (timeDiff !== 0) return timeDiff;
  const idDiff = String(b?.id || "").localeCompare(String(a?.id || ""));
  if (idDiff !== 0) return idDiff;
  return Number(b?.sourceOrder || 0) - Number(a?.sourceOrder || 0);
}

function stableObject(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableObject(item));
  }
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = stableObject(value[key]);
      return acc;
    }, {});
  }
  return value;
}

function getIdeaRenderSignature(idea) {
  return signatureOf({
    id: idea.id,
    title: idea.title,
    tag: idea.tag,
    status: idea.status,
    problem: idea.problem,
    plan: idea.plan,
    owner: idea.owner,
    likes: idea.likes,
    commentCount: getCommentCount("idea", idea.id),
    commentsOpen: state.expandedComments.has(commentTargetKey("idea", idea.id))
  });
}

function commentTargetKey(targetType, targetRecordId) {
  return `${targetType}:${targetRecordId}`;
}

function getCommentCount(targetType, targetRecordId) {
  return Number(state.commentCounts[commentTargetKey(targetType, targetRecordId)] || 0);
}

function normalizeComment(comment) {
  return {
    id: String(comment.id || ""),
    content: String(comment.content || "").trim(),
    target_type: String(comment.target_type || "").trim().toLowerCase(),
    target_record_id: String(comment.target_record_id || "").trim(),
    parent_id: String(comment.parent_id || "").trim(),
    likes: normalizeLikes(comment.likes),
    status: String(comment.status || "active").trim().toLowerCase(),
    author_name: String(comment.author_name || "Unknown").trim() || "Unknown",
    created_at: String(comment.created_at || "")
  };
}

function formatCommentTime(value) {
  if (!value) return "";
  const raw = String(value).trim();
  let date = null;
  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) {
      date = new Date(numeric > 1e12 ? numeric : numeric * 1000);
    }
  } else {
    date = new Date(raw);
  }
  if (!date || Number.isNaN(date.valueOf())) return String(value);
  return date.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getCommentsForTarget(targetType, targetRecordId) {
  return state.commentsByTarget[commentTargetKey(targetType, targetRecordId)] || [];
}

function calcSignalIndex(rootCount, childCount, ideaCount) {
  const score = Math.min(99, 34 + rootCount * 8 + childCount * 3 + ideaCount * 5);
  return String(score).padStart(2, "0");
}

function matchesSearch(parts) {
  const query = state.searchQuery.trim().toLowerCase();
  if (!query) return true;
  return parts.some((part) => extractTextContent(part).toLowerCase().includes(query));
}

function updateToday() {
  if (!elements.today) return;
  const now = new Date();
  elements.today.textContent = now.toLocaleDateString("zh-CN", {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

function updateMeta(updatedAt) {
  if (!elements.lastSync) return;
  const date = new Date(updatedAt);
  if (Number.isNaN(date.valueOf())) {
    elements.lastSync.textContent = "--";
    return;
  }
  elements.lastSync.textContent = date.toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function renderCommentComposer(targetType, targetRecordId) {
  const targetKey = commentTargetKey(targetType, targetRecordId);
  const loading = state.submittingCommentTargets.has(targetKey);
  return `
    <form class="comment-composer" data-comment-form="${escapeHtml(targetKey)}">
      <textarea
        class="comment-input"
        data-comment-input="${escapeHtml(targetKey)}"
        placeholder="Write a comment..."
        rows="2"
      ></textarea>
      <div class="comment-composer-actions">
        <div class="comment-action-copy">
          <span class="comment-identity-line">${escapeHtml(getCommentIdentityText())}</span>
          <span class="comment-submit-hint" data-comment-status="${escapeHtml(targetKey)}"></span>
        </div>
        <button class="comment-submit-btn" type="submit" ${loading ? "disabled" : ""}>
          ${loading ? "Sending..." : "Comment"}
        </button>
      </div>
    </form>
  `;
}

function renderCommentPanel(targetType, targetRecordId) {
  const targetKey = commentTargetKey(targetType, targetRecordId);
  const active = state.expandedComments.has(targetKey);
  const loading = state.loadingCommentTargets.has(targetKey);
  const comments = getCommentsForTarget(targetType, targetRecordId);
  const commentsMarkup = comments.length
    ? comments.map((comment) => `
        <article class="comment-item" data-comment-id="${escapeHtml(comment.id)}">
          <div class="comment-item-head">
            <div class="comment-author">${escapeHtml(comment.author_name)}</div>
            <div class="comment-meta">
              <time>${escapeHtml(formatCommentTime(comment.created_at))}</time>
              <button
                class="comment-like-btn${state.likingCommentIds.has(comment.id) ? " loading" : ""}"
                type="button"
                data-comment-like-id="${escapeHtml(comment.id)}"
                ${state.likingCommentIds.has(comment.id) ? "disabled" : ""}
              >
                <span aria-hidden="true">${getLikeIconMarkup()}</span>
                <span>${comment.likes}</span>
              </button>
            </div>
          </div>
          <div class="comment-body">${formatRichText(comment.content)}</div>
        </article>
      `).join("")
    : `<div class="comment-empty">${loading ? "Loading comments..." : "No comments yet."}</div>`;

  return `
    <div class="comments-panel${active ? " active" : ""}" data-comments-panel="${escapeHtml(targetKey)}">
      <div class="comments-list" data-comments-list="${escapeHtml(targetKey)}">${commentsMarkup}</div>
      ${renderCommentComposer(targetType, targetRecordId)}
    </div>
  `;
}

function patchCommentsPanel(panel, targetType, targetRecordId) {
  if (!panel) return;
  const targetKey = commentTargetKey(targetType, targetRecordId);
  const active = state.expandedComments.has(targetKey);
  const loading = state.loadingCommentTargets.has(targetKey);
  const comments = getCommentsForTarget(targetType, targetRecordId);
  const list = panel.querySelector("[data-comments-list]");
  const input = panel.querySelector("[data-comment-input]");
  const status = panel.querySelector("[data-comment-status]");
  const submitButton = panel.querySelector(".comment-submit-btn");
  const identityLine = panel.querySelector(".comment-identity-line");
  panel.dataset.commentsPanel = targetKey;
  panel.classList.toggle("active", active);
  if (list) {
    list.innerHTML = comments.length
      ? comments.map((comment) => `
          <article class="comment-item" data-comment-id="${escapeHtml(comment.id)}">
            <div class="comment-item-head">
              <div class="comment-author">${escapeHtml(comment.author_name)}</div>
              <div class="comment-meta">
                <time>${escapeHtml(formatCommentTime(comment.created_at))}</time>
                <button
                  class="comment-like-btn${state.likingCommentIds.has(comment.id) ? " loading" : ""}"
                  type="button"
                  data-comment-like-id="${escapeHtml(comment.id)}"
                  ${state.likingCommentIds.has(comment.id) ? "disabled" : ""}
                >
                  <span aria-hidden="true">${getLikeIconMarkup()}</span>
                  <span>${comment.likes}</span>
                </button>
              </div>
            </div>
            <div class="comment-body">${formatRichText(comment.content)}</div>
          </article>
        `).join("")
      : `<div class="comment-empty">${loading ? "Loading comments..." : "No comments yet."}</div>`;
  }
  if (identityLine) identityLine.textContent = getCommentIdentityText();
  if (input) input.dataset.commentInput = targetKey;
  if (status) status.dataset.commentStatus = targetKey;
  if (submitButton) {
    const submitting = state.submittingCommentTargets.has(targetKey);
    submitButton.disabled = submitting;
    submitButton.textContent = submitting ? "Sending..." : "Comment";
  }
}

function buildProjectCardContent(project) {
  const statusMeta = getProjectStatusMeta(project.status);
  const expanded = state.expandedProjects.has(project.id);
  const commentKey = commentTargetKey("project", project.id);
  const commentsOpen = state.expandedComments.has(commentKey);
  const commentCount = getCommentCount("project", project.id);
  const resultMarkup = project.resultLink
    ? `<a class="result-link" href="${escapeHtml(project.resultLink)}" target="_blank" rel="noreferrer">成果展示<span aria-hidden="true">↗</span></a>`
    : "";
  const childMarkup = project.children.map((child) => `
    <article class="child-card">
      <div class="child-topline">
        <div class="progress-ring small" style="--progress:${child.progress}">
          <span>${child.progress}%</span>
        </div>
        <div>
          <div class="child-title">${escapeHtml(child.title)}</div>
          <div class="child-tags">
            <span class="tag-signal">${escapeHtml(child.tag || "SYS-CORE")}</span>
            <span class="status-chip status-chip-${escapeHtml(getProjectStatusMeta(child.status).className)}">${escapeHtml(getProjectStatusMeta(child.status).label)}</span>
            <span class="tag-meta">ETA · ${escapeHtml(child.expectedDate)}</span>
          </div>
        </div>
        <div class="owner-pill small">${escapeHtml(child.owner)}</div>
      </div>
      <div class="child-copy">
        <div class="detail-block compact">
          <div class="detail-label issue">Problem</div>
          <div class="detail-text">${formatRichText(child.problem)}</div>
        </div>
        <div class="detail-block compact">
          <div class="detail-label approach">Approach</div>
          <div class="detail-text">${formatRichText(child.plan)}</div>
        </div>
      </div>
      ${child.resultLink ? `<div class="child-footer"><a class="result-link small" href="${escapeHtml(child.resultLink)}" target="_blank" rel="noreferrer">成果展示<span aria-hidden="true">↗</span></a></div>` : ""}
    </article>
  `).join("");

  const childCount = project.children.length;
  const expandButton = childCount
    ? `
        <button
          class="subroute-btn"
          type="button"
          data-project-id="${escapeHtml(project.id)}"
          data-child-count="${childCount}"
          aria-expanded="${expanded ? "true" : "false"}"
        >
          ${expanded ? "HIDE SUB-ROUTINES" : `VIEW ${childCount} SUB-ROUTINES`}
        </button>
      `
    : "";

  return `
    <div class="card-topline">
      <div class="progress-ring" style="--progress:${project.progress}">
        <span>${project.progress}%</span>
      </div>
      <div class="project-headline">
        <div class="project-title-row">
          <h3>${escapeHtml(project.title)}</h3>
        </div>
        <div class="project-tags">
          <span class="tag-signal">${escapeHtml(project.tag || "SYS-CORE")}</span>
          <span class="status-chip status-chip-${escapeHtml(statusMeta.className)}">${escapeHtml(statusMeta.label)}</span>
          <span class="tag-meta">ETA · ${escapeHtml(project.expectedDate)}</span>
          ${resultMarkup}
        </div>
      </div>
      <div class="owner-pill">${escapeHtml(project.owner)}</div>
    </div>
    <div class="detail-grid">
      <section class="detail-block">
        <div class="detail-label issue">Problem</div>
        <div class="detail-text">${formatRichText(project.problem)}</div>
      </section>
      <section class="detail-block">
        <div class="detail-label approach">Approach</div>
        <div class="detail-text">${formatRichText(project.plan)}</div>
      </section>
    </div>
    ${expandButton ? `<div class="card-actions">${expandButton}</div>` : ""}
    <div class="children-panel${expanded ? " active" : ""}">
      <div class="children-grid">${childMarkup}</div>
    </div>
    <div class="project-card-footer">
      <button
        class="comment-toggle-btn${commentsOpen ? " active" : ""}"
        type="button"
        data-comments-target="${escapeHtml(commentKey)}"
        data-target-type="project"
        data-target-record-id="${escapeHtml(project.id)}"
        aria-expanded="${commentsOpen ? "true" : "false"}"
      >
        <span>Comments</span>
        <span class="comment-toggle-count">${commentCount}</span>
      </button>
    </div>
    ${renderCommentPanel("project", project.id)}
  `;
}

function createProjectCardElement(project, index) {
  const template = document.createElement("template");
  template.innerHTML = `
    <article
      class="signal-card project-card reveal${state.expandedProjects.has(project.id) ? " expanded" : ""}"
      data-project-id="${escapeHtml(project.id)}"
      style="--progress:${project.progress}; animation-delay:${index * 70}ms"
    >
      ${buildProjectCardContent(project)}
    </article>
  `.trim();
  return template.content.firstElementChild;
}

function patchProjectCard(card, project, index) {
  if (!card || !project) return;
  card.dataset.projectId = project.id;
  card.classList.toggle("expanded", state.expandedProjects.has(project.id));
  card.style.setProperty("--progress", String(project.progress));
  card.style.animationDelay = `${index * 70}ms`;
  card.innerHTML = buildProjectCardContent(project);
}

function renderProjects() {
  const filteredProjects = state.projectsTree.filter((project) => matchesSearch([
    project.title,
    project.status,
    project.problem,
    project.plan,
    project.owner,
    ...project.children.flatMap((child) => [child.title, child.status, child.problem, child.plan, child.owner])
  ]));

  if (!filteredProjects.length) {
    elements.projectsList.innerHTML = '<div class="empty-state wide">没有匹配的项目结果。</div>';
    return;
  }

  const existingCards = new Map(
    Array.from(elements.projectsList.querySelectorAll(".project-card[data-project-id]"))
      .map((card) => [card.dataset.projectId, card])
  );
  const groups = groupProjectsByStatus(filteredProjects);
  const fragment = document.createDocumentFragment();
  let projectIndex = 0;

  groups.forEach((group) => {
    const meta = getProjectStatusMeta(group.status);
    const section = document.createElement("section");
    section.className = "project-group";
    section.id = `project-group-${group.status}`;
    section.dataset.projectStatus = group.status;
    section.innerHTML = `
      <div class="project-group-head">
        <div>
          <div class="project-group-kicker">Project Status</div>
          <h2>${escapeHtml(meta.label)}</h2>
          <div class="project-group-subtitle">${escapeHtml(meta.subtitle)}</div>
        </div>
        <div class="project-group-count">${group.items.length}</div>
      </div>
    `;
    const grid = document.createElement("div");
    grid.className = "project-group-grid";

    group.items.forEach((project) => {
      let card = existingCards.get(project.id);
      if (!card) {
        card = createProjectCardElement(project, projectIndex);
      } else {
        existingCards.delete(project.id);
      }
      patchProjectCard(card, project, projectIndex);
      grid.appendChild(card);
      projectIndex += 1;
    });

    section.appendChild(grid);
    fragment.appendChild(section);
  });

  elements.projectsList.innerHTML = "";
  elements.projectsList.appendChild(fragment);
  existingCards.forEach((card) => card.remove());
}

function scrollToProjectStatusGroup(status) {
  setActivePool("projects");
  window.requestAnimationFrame(() => {
    const target = document.querySelector(`#project-group-${CSS.escape(status)}`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    elements.projectsView?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function getFilteredIdeas() {
  return state.ideas.filter((idea) => matchesSearch([
    idea.title,
    idea.tag,
    idea.status,
    idea.problem,
    idea.plan,
    idea.owner
  ]));
}

function createIdeaCardElement(idea) {
  const targetKey = commentTargetKey("idea", idea.id);
  const commentsOpen = state.expandedComments.has(targetKey);
  const template = document.createElement("template");
  template.innerHTML = `
    <article class="signal-card idea-card" data-idea-id="${escapeHtml(idea.id)}">
      <div class="card-topline">
        <div class="idea-orb">${getIdeaIconMarkup()}</div>
        <div class="project-headline">
          <div class="project-title-row">
            <h3>${escapeHtml(idea.title)}</h3>
          </div>
          <div class="project-tags">
            <span class="tag-signal">${escapeHtml(idea.tag)}</span>
            <span class="tag-meta">${escapeHtml(idea.status)}</span>
          </div>
        </div>
        <div class="owner-pill">${escapeHtml(idea.owner)}</div>
      </div>
      <div class="detail-grid single-column">
        <section class="detail-block">
          <div class="detail-label issue">Problem</div>
          <div class="detail-text">${formatRichText(idea.problem)}</div>
        </section>
        <section class="detail-block">
          <div class="detail-label approach">Approach</div>
          <div class="detail-text">${formatRichText(idea.plan)}</div>
        </section>
      </div>
      <div class="idea-actions">
        <button
          class="comment-toggle-btn${commentsOpen ? " active" : ""}"
          type="button"
          data-comments-target="${escapeHtml(targetKey)}"
          data-target-type="idea"
          data-target-record-id="${escapeHtml(idea.id)}"
          aria-expanded="${commentsOpen ? "true" : "false"}"
        >
          <span>Comments</span>
          <span class="comment-toggle-count">${getCommentCount("idea", idea.id)}</span>
        </button>
        <button
          class="like-btn${state.likingIdeaIds.has(idea.id) ? " loading" : ""}"
          type="button"
          data-like-id="${escapeHtml(idea.id)}"
          ${state.likingIdeaIds.has(idea.id) ? "disabled" : ""}
        >
          <span class="like-btn-icon" aria-hidden="true">${getLikeIconMarkup()}</span>
          <span>Like</span>
          <span class="like-btn-count">${idea.likes}</span>
        </button>
      </div>
      ${renderCommentPanel("idea", idea.id)}
    </article>
  `.trim();
  return template.content.firstElementChild;
}

function patchIdeaCard(card, idea) {
  if (!card || !idea) return;
  card.dataset.ideaId = idea.id;
  const title = card.querySelector(".project-title-row h3");
  const owner = card.querySelector(".owner-pill");
  const tagSignal = card.querySelector(".tag-signal");
  const tagMeta = card.querySelector(".tag-meta");
  const detailTexts = card.querySelectorAll(".detail-text");
  const likeButton = card.querySelector("[data-like-id]");
  const likeCount = card.querySelector(".like-btn-count");
  const commentButton = card.querySelector("[data-comments-target]");
  const commentCount = card.querySelector(".comment-toggle-count");
  const commentsPanel = card.querySelector(`[data-comments-panel="${CSS.escape(commentTargetKey("idea", idea.id))}"]`);
  if (title) title.textContent = idea.title;
  if (owner) owner.textContent = idea.owner;
  if (tagSignal) tagSignal.textContent = idea.tag;
  if (tagMeta) tagMeta.textContent = idea.status;
  if (detailTexts[0]) detailTexts[0].innerHTML = formatRichText(idea.problem);
  if (detailTexts[1]) detailTexts[1].innerHTML = formatRichText(idea.plan);
  if (likeButton) {
    likeButton.dataset.likeId = idea.id;
    likeButton.classList.toggle("loading", state.likingIdeaIds.has(idea.id));
    likeButton.disabled = state.likingIdeaIds.has(idea.id);
  }
  if (likeCount) likeCount.textContent = String(idea.likes);
  if (commentButton) {
    const targetKey = commentTargetKey("idea", idea.id);
    const active = state.expandedComments.has(targetKey);
    commentButton.dataset.commentsTarget = targetKey;
    commentButton.dataset.targetType = "idea";
    commentButton.dataset.targetRecordId = idea.id;
    commentButton.classList.toggle("active", active);
    commentButton.setAttribute("aria-expanded", active ? "true" : "false");
  }
  if (commentCount) commentCount.textContent = String(getCommentCount("idea", idea.id));
  if (commentsPanel) {
    patchCommentsPanel(commentsPanel, "idea", idea.id);
  }
}

function renderIdeas() {
  const filteredIdeas = getFilteredIdeas();

  if (!filteredIdeas.length) {
    elements.ideasList.innerHTML = '<div class="empty-state wide">没有匹配的创意结果。</div>';
    return;
  }

  const emptyState = elements.ideasList.querySelector(".empty-state");
  if (emptyState) emptyState.remove();

  const existingCards = new Map(
    Array.from(elements.ideasList.querySelectorAll(".idea-card[data-idea-id]"))
      .map((card) => [card.dataset.ideaId, card])
  );

  let previousCard = null;
  filteredIdeas.forEach((idea) => {
    let card = existingCards.get(idea.id);
    if (!card) {
      card = createIdeaCardElement(idea);
    } else {
      existingCards.delete(idea.id);
    }

    const nextRenderSignature = getIdeaRenderSignature(idea);
    if (card.dataset.renderSignature !== nextRenderSignature) {
      patchIdeaCard(card, idea);
      card.dataset.renderSignature = nextRenderSignature;
    }

    if (!card.isConnected) {
      if (previousCard?.nextSibling) {
        elements.ideasList.insertBefore(card, previousCard.nextSibling);
      } else {
        elements.ideasList.appendChild(card);
      }
    } else if (!previousCard) {
      if (elements.ideasList.firstElementChild !== card) {
        elements.ideasList.insertBefore(card, elements.ideasList.firstElementChild);
      }
    } else if (previousCard.nextElementSibling !== card) {
      elements.ideasList.insertBefore(card, previousCard.nextElementSibling);
    }

    previousCard = card;
  });

  existingCards.forEach((card) => card.remove());
}

function updateVisibleCommentCounts() {
  elements.projectsList?.querySelectorAll("[data-comments-target]").forEach((button) => {
    const targetType = button.dataset.targetType;
    const targetRecordId = button.dataset.targetRecordId;
    const countNode = button.querySelector(".comment-toggle-count");
    const targetKey = commentTargetKey(targetType, targetRecordId);
    const active = state.expandedComments.has(targetKey);
    if (countNode) countNode.textContent = String(getCommentCount(targetType, targetRecordId));
    button.classList.toggle("active", active);
    button.setAttribute("aria-expanded", active ? "true" : "false");
  });
  elements.projectsList?.querySelectorAll(".project-card[data-project-id]").forEach((card) => {
    const projectId = card.dataset.projectId;
    const panel = card.querySelector(`[data-comments-panel="${CSS.escape(commentTargetKey("project", projectId))}"]`);
    if (panel) patchCommentsPanel(panel, "project", projectId);
  });
  elements.ideasList?.querySelectorAll(".idea-card[data-idea-id]").forEach((card) => {
    const idea = state.ideas.find((item) => item.id === card.dataset.ideaId);
    if (!idea) return;
    const nextRenderSignature = getIdeaRenderSignature(idea);
    if (card.dataset.renderSignature !== nextRenderSignature) {
      patchIdeaCard(card, idea);
      card.dataset.renderSignature = nextRenderSignature;
    }
  });
}

function patchCommentTargetUI(targetType, targetRecordId) {
  const targetKey = commentTargetKey(targetType, targetRecordId);
  const list = targetType === "project" ? elements.projectsList : elements.ideasList;
  const selector = targetType === "project"
    ? `.project-card[data-project-id="${CSS.escape(targetRecordId)}"]`
    : `.idea-card[data-idea-id="${CSS.escape(targetRecordId)}"]`;
  const card = list?.querySelector(selector);
  if (!card) return;

  const button = card.querySelector(`[data-comments-target="${CSS.escape(targetKey)}"]`);
  if (button) {
    const active = state.expandedComments.has(targetKey);
    const countNode = button.querySelector(".comment-toggle-count");
    button.classList.toggle("active", active);
    button.setAttribute("aria-expanded", active ? "true" : "false");
    if (countNode) countNode.textContent = String(getCommentCount(targetType, targetRecordId));
  }

  const panel = card.querySelector(`[data-comments-panel="${CSS.escape(targetKey)}"]`);
  if (panel) patchCommentsPanel(panel, targetType, targetRecordId);
}

async function loadCommentSummary() {
  try {
    const response = await fetch(`${API_BASE}/comments?summary=1`, { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    const summary = data?.summary || {};
    const nextSignature = signatureOf(summary);
    if (nextSignature === state.commentSummarySignature) return;
    state.commentSummarySignature = nextSignature;
    state.commentCounts = summary;
    updateVisibleCommentCounts();
  } catch (error) {
    // ignore summary errors
  }
}

async function loadCommentsForTarget(targetType, targetRecordId) {
  const targetKey = commentTargetKey(targetType, targetRecordId);
  if (state.loadingCommentTargets.has(targetKey)) return;
  state.loadingCommentTargets.add(targetKey);
  patchCommentTargetUI(targetType, targetRecordId);
  let loaded = false;
  try {
    const response = await fetch(`${API_BASE}/comments?target_type=${encodeURIComponent(targetType)}&target_record_id=${encodeURIComponent(targetRecordId)}`, {
      cache: "no-store"
    });
    if (!response.ok) throw new Error("load comments failed");
    const data = await response.json();
    state.commentsByTarget[targetKey] = (data?.comments || []).map(normalizeComment);
    state.commentCounts[targetKey] = state.commentsByTarget[targetKey].length;
    state.commentSummarySignature = signatureOf(state.commentCounts);
    loaded = true;
  } catch (error) {
    if (!state.commentsByTarget[targetKey]) {
      state.commentsByTarget[targetKey] = [];
    }
  } finally {
    state.loadingCommentTargets.delete(targetKey);
    patchCommentTargetUI(targetType, targetRecordId);
  }
  return loaded;
}

async function likeComment(commentId, targetKey) {
  if (!commentId || !targetKey || state.likingCommentIds.has(commentId)) return;
  const comments = state.commentsByTarget[targetKey] || [];
  const comment = comments.find((item) => item.id === commentId);
  if (!comment) return;
  const previousLikes = comment.likes;
  state.likingCommentIds.add(commentId);
  comment.likes += 1;
  updateVisibleCommentCounts();
  try {
    const response = await fetch(`${API_BASE}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "like",
        id: commentId,
        submit_mode: resolveActionSubmitMode(state.submitMode)
      })
    });
    const detail = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(detail.message || "点赞评论失败");
    comment.likes = normalizeLikes(detail.likes);
  } catch (error) {
    comment.likes = previousLikes;
  } finally {
    state.likingCommentIds.delete(commentId);
    updateVisibleCommentCounts();
  }
}

async function submitComment(targetType, targetRecordId, form) {
  const targetKey = commentTargetKey(targetType, targetRecordId);
  const input = form.querySelector("[data-comment-input]");
  const status = form.querySelector("[data-comment-status]");
  const content = input?.value.trim();
  if (!content) {
    if (status) status.textContent = "请输入评论";
    return;
  }

  const submitMode = resolveCommentSubmitMode();
  if (submitMode === "auth" && !canUseAuthMode()) {
    if (status) status.textContent = "Please authorize first";
    return;
  }
  if (submitMode === "guest" && !canUseGuestMode()) {
    if (status) status.textContent = "Guest mode unavailable";
    return;
  }

  state.submittingCommentTargets.add(targetKey);
  if (status) status.textContent = "Sending...";
  updateVisibleCommentCounts();

  try {
    const response = await fetch(`${API_BASE}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        target_type: targetType,
        target_record_id: targetRecordId,
        submit_mode: submitMode
      })
    });
    const detail = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(detail.message || "评论发送失败");
    }
    if (input) input.value = "";
    const loaded = await loadCommentsForTarget(targetType, targetRecordId);
    if (status) status.textContent = loaded ? "" : "评论已创建，列表刷新失败";
  } catch (error) {
    if (status) status.textContent = error.message || "评论发送失败";
  } finally {
    state.submittingCommentTargets.delete(targetKey);
    patchCommentTargetUI(targetType, targetRecordId);
  }
}

function renderStats() {
  elements.projectCount.textContent = String(state.projectsTree.length).padStart(2, "0");
  elements.childCount.textContent = String(state.childCount).padStart(2, "0");
  elements.ideaCount.textContent = String(state.ideas.length).padStart(2, "0");
  elements.momentum.textContent = calcSignalIndex(state.projectsTree.length, state.childCount, state.ideas.length);
  renderProjectStatusOverview();
}

function renderAll() {
  renderProjects();
  renderIdeas();
  renderStats();
}

function signatureOf(value) {
  return JSON.stringify(stableObject(value));
}

function setActivePool(pool, options = {}) {
  const normalizedPool = normalizePoolValue(pool) || "ideas";
  const { updateUrl = true, historyMode = "replace" } = options;
  state.activePool = normalizedPool;
  elements.projectsView.classList.toggle("active", normalizedPool === "projects");
  elements.ideasView.classList.toggle("active", normalizedPool === "ideas");
  elements.poolTabs.style.setProperty("--active-index", normalizedPool === "ideas" ? "0" : "1");
  elements.poolTabs.querySelectorAll(".segmented-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.pool === normalizedPool);
  });
  elements.openIdeaModalBtn.classList.toggle("visible", normalizedPool === "ideas");
  if (elements.projectStatusOverviewWrap) {
    elements.projectStatusOverviewWrap.hidden = normalizedPool !== "projects";
  }
  elements.heroTitle.textContent = normalizedPool === "projects" ? "Grow Lab" : "Seed Hub";
  if (elements.heroKicker) {
    elements.heroKicker.textContent = "";
  }
  if (elements.heroDescription) {
    elements.heroDescription.textContent = normalizedPool === "projects"
    ? "Projects 以行动视角呈现父节点任务。每个模块都把问题、思路、负责人和进度压缩进同一块操作卡，展开后再进入子任务层。"
    : "Ideas 作为概念池存在，强调 problem space 与 approach。提交行为不离开当前页面，直接写回飞书。";
  }
  if (elements.panelKicker) {
    elements.panelKicker.textContent = "";
  }
  updateTitleJump();
  if (updateUrl) syncPoolUrl(normalizedPool, historyMode);
}

function openIdeaModal() {
  elements.ideaStatus.textContent = "Ready";
  renderSubmitMode();
  elements.ideaModal.classList.add("active");
  elements.ideaModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function closeIdeaModal() {
  elements.ideaModal.classList.remove("active");
  elements.ideaModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

async function loadData() {
  try {
    const [projectsRes, ideasRes] = await Promise.all([
      fetch(`${API_BASE}/projects`, { cache: "no-store" }),
      fetch(`${API_BASE}/ideas`, { cache: "no-store" })
    ]);

    const projectsData = projectsRes.ok ? await projectsRes.json() : DEFAULT_PROJECTS;
    const ideasData = ideasRes.ok ? await ideasRes.json() : DEFAULT_IDEAS;

    const projectTree = buildProjectTree(projectsData.records || []);
    const nextProjects = projectTree.roots;
    const nextChildCount = projectTree.childCount;
    const nextIdeas = (ideasData.records || [])
      .map((record, index) => ({ ...record, sourceOrder: index }))
      .filter((record) => hasMeaningfulFields(record.fields))
      .map(normalizeIdeaRecord)
      .sort(compareIdeasByCreatedAtDesc)
      .filter((idea) => idea.title && idea.title !== "未命名 Idea");

    const nextProjectSignature = signatureOf({ roots: nextProjects, childCount: nextChildCount });
    const nextIdeaSignature = signatureOf(nextIdeas);
    const projectsChanged = nextProjectSignature !== state.projectSignature;
    const ideasChanged = nextIdeaSignature !== state.ideaSignature;

    state.projectsTree = nextProjects;
    state.childCount = nextChildCount;
    state.ideas = nextIdeas;
    state.ideaCategoryOptions = collectIdeaCategoryOptions(nextIdeas);

    if (projectsChanged) {
      state.projectSignature = nextProjectSignature;
      renderProjects();
    }
    if (ideasChanged) {
      state.ideaSignature = nextIdeaSignature;
      renderIdeas();
    }
    if (projectsChanged || ideasChanged) {
      renderStats();
    }
    renderIdeaCategoryOptions();

    updateMeta(projectsData.updated_at || ideasData.updated_at);
  } catch (error) {
    const projectTree = buildProjectTree(DEFAULT_PROJECTS.records);
    state.projectsTree = projectTree.roots;
    state.childCount = projectTree.childCount;
    state.ideas = DEFAULT_IDEAS.records
      .map((record, index) => ({ ...record, sourceOrder: index }))
      .map(normalizeIdeaRecord)
      .sort(compareIdeasByCreatedAtDesc);
    state.ideaCategoryOptions = collectIdeaCategoryOptions(state.ideas);
    state.projectSignature = signatureOf({ roots: state.projectsTree, childCount: state.childCount });
    state.ideaSignature = signatureOf(state.ideas);
    renderAll();
    renderIdeaCategoryOptions();
    updateMeta(DEFAULT_PROJECTS.updated_at);
  }
}

async function loadConfig() {
  try {
    const response = await fetch(`${API_BASE}/config`, { cache: "no-store" });
    if (!response.ok) return;
    const config = await response.json();
    state.guestMode = Boolean(config?.guest_mode);
    state.projectsTableUrl = config?.projects_table_url || state.projectsTableUrl;
    state.ideasTableUrl = config?.ideas_table_url || state.ideasTableUrl;
    elements.guestToggleBtn.textContent = state.guestMode ? "Guest On" : "Guest Off";
    elements.guestToggleBtn.classList.toggle("active", state.guestMode);
    elements.guestToggleBtn.disabled = !config?.guest_editable;
    elements.guestToggleBtn.title = config?.guest_editable ? "" : "Managed by environment";
  } catch (error) {
    elements.guestToggleBtn.disabled = true;
  }
  state.submitMode = normalizeSubmitMode(state.submitMode);
  renderSubmitMode();
  updateTitleJump();
  renderProjects();
  elements.ideasList.innerHTML = "";
  renderIdeas();
}

async function loadMe() {
  await loadConfig();
  try {
    const response = await fetch(`${API_BASE}/me`, { cache: "no-store" });
    if (!response.ok) throw new Error("not authed");
    const data = await response.json();
    if (data?.guest) {
      state.authUser = null;
      elements.authBadge.textContent = "Guest Mode";
      elements.authBanner.classList.remove("active");
      elements.loginBtn.classList.remove("visible");
      state.submitMode = normalizeSubmitMode(state.submitMode);
      renderSubmitMode();
      return;
    }
    state.authUser = data?.user || null;
    elements.authBadge.textContent = data?.user?.name ? `Authed · ${data.user.name}` : "Authed";
    elements.authBanner.classList.remove("active");
    elements.loginBtn.classList.remove("visible");
    state.submitMode = normalizeSubmitMode("auth");
    renderSubmitMode();
  } catch (error) {
    state.authUser = null;
    if (state.guestMode) {
      elements.authBadge.textContent = "Guest Mode";
      elements.authBanner.classList.remove("active");
      elements.loginBtn.classList.remove("visible");
      state.submitMode = normalizeSubmitMode(state.submitMode);
      renderSubmitMode();
      return;
    }
    elements.authBadge.textContent = "Login Required";
    elements.authBanner.classList.add("active");
    elements.loginBtn.classList.add("visible");
    state.submitMode = normalizeSubmitMode("auth");
    renderSubmitMode();
  }
}

function bindEvents() {
  elements.refreshBtn?.addEventListener("click", () => {
    loadData();
    loadCommentSummary();
    loadMe();
  });

  elements.poolTabs?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-pool]");
    if (!button) return;
    setActivePool(button.dataset.pool, { updateUrl: true, historyMode: "push" });
  });

  elements.projectStatusOverview?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-project-status-jump]");
    if (!button) return;
    scrollToProjectStatusGroup(button.dataset.projectStatusJump);
  });

  window.addEventListener("popstate", () => {
    setActivePool(getPoolFromLocation(), { updateUrl: false });
  });

  elements.searchInput?.addEventListener("input", (event) => {
    state.searchQuery = event.target.value;
    renderAll();
  });

  elements.projectsList?.addEventListener("click", (event) => {
    const commentLikeButton = event.target.closest("[data-comment-like-id]");
    if (commentLikeButton) {
      const commentId = commentLikeButton.dataset.commentLikeId;
      const targetKey = commentLikeButton.closest("[data-comments-panel]")?.dataset.commentsPanel;
      likeComment(commentId, targetKey);
      return;
    }

    const commentButton = event.target.closest("[data-comments-target]");
    if (commentButton) {
      const targetType = commentButton.dataset.targetType;
      const targetRecordId = commentButton.dataset.targetRecordId;
      const targetKey = commentButton.dataset.commentsTarget;
      if (!targetType || !targetRecordId || !targetKey) return;
      if (state.expandedComments.has(targetKey)) {
        state.expandedComments.delete(targetKey);
        renderProjects();
        return;
      }
      state.expandedComments.add(targetKey);
      renderProjects();
      if (!state.commentsByTarget[targetKey]) {
        loadCommentsForTarget(targetType, targetRecordId);
      }
      return;
    }

    const button = event.target.closest("[data-project-id]");
    if (!button) return;
    const projectId = button.dataset.projectId;
    const card = button.closest(".project-card");
    const panel = card?.querySelector(".children-panel");
    const childCount = Number(button.dataset.childCount || 0);
    if (!card || !panel || !childCount) return;
    if (state.expandedProjects.has(projectId)) {
      state.expandedProjects.delete(projectId);
      card.classList.remove("expanded");
      panel.classList.remove("active");
      button.textContent = `VIEW ${childCount} SUB-ROUTINES`;
      button.setAttribute("aria-expanded", "false");
    } else {
      state.expandedProjects.add(projectId);
      card.classList.add("expanded");
      panel.classList.add("active");
      button.textContent = "HIDE SUB-ROUTINES";
      button.setAttribute("aria-expanded", "true");
    }
  });

  elements.projectsList?.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-comment-form]");
    if (!form) return;
    event.preventDefault();
    const targetKey = form.dataset.commentForm;
    const [targetType, targetRecordId] = String(targetKey || "").split(":");
    if (!targetType || !targetRecordId) return;
    await submitComment(targetType, targetRecordId, form);
  });

  elements.ideasList?.addEventListener("click", async (event) => {
    const commentLikeButton = event.target.closest("[data-comment-like-id]");
    if (commentLikeButton) {
      const commentId = commentLikeButton.dataset.commentLikeId;
      const targetKey = commentLikeButton.closest("[data-comments-panel]")?.dataset.commentsPanel;
      likeComment(commentId, targetKey);
      return;
    }

    const commentButton = event.target.closest("[data-comments-target]");
    if (commentButton) {
      const targetType = commentButton.dataset.targetType;
      const targetRecordId = commentButton.dataset.targetRecordId;
      const targetKey = commentButton.dataset.commentsTarget;
      if (!targetType || !targetRecordId || !targetKey) return;
      if (state.expandedComments.has(targetKey)) {
        state.expandedComments.delete(targetKey);
        const idea = state.ideas.find((item) => item.id === targetRecordId);
        const card = commentButton.closest(".idea-card");
        if (card && idea) patchIdeaCard(card, idea);
        return;
      }
      state.expandedComments.add(targetKey);
      const idea = state.ideas.find((item) => item.id === targetRecordId);
      const card = commentButton.closest(".idea-card");
      if (card && idea) patchIdeaCard(card, idea);
      if (!state.commentsByTarget[targetKey]) {
        loadCommentsForTarget(targetType, targetRecordId);
      }
      return;
    }

    const button = event.target.closest("[data-like-id]");
    if (!button) return;
    const ideaId = button.dataset.likeId;
    if (!ideaId || state.likingIdeaIds.has(ideaId)) return;

    const targetIdea = state.ideas.find((idea) => idea.id === ideaId);
    if (!targetIdea) return;

    const previousLikes = targetIdea.likes;
    state.likingIdeaIds.add(ideaId);
    targetIdea.likes += 1;
    patchIdeaCard(button.closest(".idea-card"), targetIdea);

    try {
      const response = await fetch(`${API_BASE}/ideas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "like",
          id: ideaId,
          submit_mode: resolveActionSubmitMode(state.submitMode)
        })
      });
      const detail = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(detail.message || "点赞失败");
      }
      targetIdea.likes = normalizeLikes(detail.likes);
    } catch (error) {
      targetIdea.likes = previousLikes;
    } finally {
      state.likingIdeaIds.delete(ideaId);
      const ideaCard = elements.ideasList.querySelector(`.idea-card[data-idea-id="${CSS.escape(ideaId)}"]`);
      if (ideaCard) {
        patchIdeaCard(ideaCard, targetIdea);
      }
    }
  });

  elements.ideasList?.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-comment-form]");
    if (!form) return;
    event.preventDefault();
    const targetKey = form.dataset.commentForm;
    const [targetType, targetRecordId] = String(targetKey || "").split(":");
    if (!targetType || !targetRecordId) return;
    await submitComment(targetType, targetRecordId, form);
  });


  elements.loginBtn?.addEventListener("click", async () => {
    const response = await fetch(`${API_BASE}/login`, { cache: "no-store" });
    const data = await response.json();
    if (data?.auth_url) {
      window.location.href = data.auth_url;
    }
  });

  elements.modalLoginBtn?.addEventListener("click", async () => {
    const response = await fetch(`${API_BASE}/login`, { cache: "no-store" });
    const data = await response.json();
    if (data?.auth_url) {
      window.location.href = data.auth_url;
    }
  });

  elements.guestToggleBtn?.addEventListener("click", async () => {
    if (elements.guestToggleBtn.disabled) return;
    try {
      const response = await fetch(`${API_BASE}/guest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !state.guestMode })
      });
      if (response.ok) {
        await loadMe();
      }
    } catch (error) {
      // ignore
    }
  });

  [elements.openIdeaModalBtn, elements.closeIdeaModalBtn, elements.closeIdeaModalBg].filter(Boolean).forEach((element) => {
    element.addEventListener("click", () => {
      if (element === elements.openIdeaModalBtn) {
        openIdeaModal();
        return;
      }
      closeIdeaModal();
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeIdeaModal();
  });

  elements.submitModeToggle?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-submit-mode]");
    if (!button || button.disabled) return;
    state.submitMode = normalizeSubmitMode(button.dataset.submitMode);
    renderSubmitMode();
  });

  elements.ideaTagSuggestions?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-idea-tag-option]");
    if (!button || !elements.ideaTagInput) return;
    elements.ideaTagInput.value = button.dataset.ideaTagOption || "";
    elements.ideaTagInput.focus();
  });

  elements.ideaForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    elements.ideaStatus.textContent = "Submitting...";

    const submitMode = normalizeSubmitMode(state.submitMode);
    if (submitMode === "auth" && !canUseAuthMode()) {
      elements.ideaStatus.textContent = "请先授权飞书账号";
      renderSubmitMode();
      return;
    }
    if (submitMode === "guest" && !canUseGuestMode()) {
      elements.ideaStatus.textContent = "当前未开启游客提交";
      renderSubmitMode();
      return;
    }

    const payload = {
      title: elements.ideaTitleInput.value.trim(),
      tag: elements.ideaTagInput.value.trim(),
      problem: elements.ideaProblemInput.value.trim(),
      plan: elements.ideaPlanInput.value.trim(),
      owner_open_id: elements.ideaOwnerInput.value.trim(),
      submit_mode: submitMode
    };

    if (!payload.title) {
      elements.ideaStatus.textContent = "需要填写 IDEA 标题";
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/ideas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        elements.ideaStatus.textContent = detail.message || "提交失败";
        return;
      }

      elements.ideaStatus.textContent = "已写入飞书";
      elements.ideaForm.reset();
      state.searchQuery = "";
      elements.searchInput.value = "";
      setActivePool("ideas");
      loadData();
      loadMe();
      closeIdeaModal();
    } catch (error) {
      elements.ideaStatus.textContent = "提交失败";
    }
  });
}

try { updateToday(); } catch (error) { console.error("updateToday failed", error); }
try { bindEvents(); } catch (error) { console.error("bindEvents failed", error); }
try { setActivePool(getPoolFromLocation(), { updateUrl: true, historyMode: "replace" }); } catch (error) { console.error("setActivePool failed", error); }
Promise.resolve().then(() => loadData()).catch((error) => console.error("loadData failed", error));
Promise.resolve().then(() => loadCommentSummary()).catch((error) => console.error("loadCommentSummary failed", error));
Promise.resolve().then(() => loadMe()).catch((error) => console.error("loadMe failed", error));
