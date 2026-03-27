const DEFAULT_PROJECTS = {
  updated_at: "2026-03-25T08:30:00+08:00",
  records: [
    {
      id: "p1",
      fields: {
        "DEMO名称": "AI 辅助创新提案系统",
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
      fields: {
        "IDEA标题": "创新挑战赛小程序",
        "填写人": [{ name: "Jin" }],
        "demo的思路（非必填）": "用任务解锁和互评机制持续吸引参与。",
        "解决的问题（必填）": "团队创意输入零散，缺少可持续的收集和激励机制。"
      }
    }
  ]
};

const API_BASE = "/api";
const FIELD_ALIASES = {
  projectTitle: ["DEMO名称", "项目名称", "Title", "标题"],
  projectTag: ["标签", "Tag", "标签名"],
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

const state = {
  guestMode: false,
  authUser: null,
  submitMode: "auth",
  activePool: "projects",
  searchQuery: "",
  likingIdeaIds: new Set(),
  expandedProjects: new Set(),
  projectsTree: [],
  ideas: [],
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
  heroDescription: document.getElementById("heroDescription"),
  panelKicker: document.getElementById("panelKicker"),
  ideaModal: document.getElementById("ideaModal"),
  openIdeaModalBtn: document.getElementById("openIdeaModalBtn"),
  closeIdeaModalBtn: document.getElementById("closeIdeaModalBtn"),
  closeIdeaModalBg: document.getElementById("closeIdeaModalBg"),
  ideaForm: document.getElementById("ideaForm"),
  ideaTitleInput: document.getElementById("ideaTitle"),
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

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatRichText(value) {
  const text = String(value || "").trim();
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
  return String(value);
}

function normalizeProgress(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  if (num >= 0 && num <= 1) {
    return Math.round(num * 100);
  }
  return Math.max(0, Math.min(100, Math.round(num)));
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
      <defs>
        <linearGradient id="like-glow" x1="10%" y1="0%" x2="90%" y2="100%">
          <stop offset="0%" stop-color="#FF74D4"></stop>
          <stop offset="100%" stop-color="#7A5CFF"></stop>
        </linearGradient>
      </defs>
      <path d="M12 20.2 4.9 13.4a4.3 4.3 0 0 1 6.08-6.1L12 8.3l1.02-1a4.3 4.3 0 1 1 6.08 6.1L12 20.2Z" fill="url(#like-glow)" fill-opacity="0.22" stroke="url(#like-glow)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
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
    title: pickField(fields, FIELD_ALIASES.projectTitle) || "未命名项目",
    tag: pickField(fields, FIELD_ALIASES.projectTag) || "SYS-CORE",
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

function normalizeIdeaRecord(record) {
  const fields = record.fields || {};
  return {
    id: record.id,
    title: pickField(fields, FIELD_ALIASES.ideaTitle) || "未命名 Idea",
    problem: pickField(fields, FIELD_ALIASES.problem),
    plan: pickField(fields, FIELD_ALIASES.plan),
    owner: extractPersonName(pickField(fields, FIELD_ALIASES.proposer)),
    likes: normalizeLikes(pickField(fields, FIELD_ALIASES.likes))
  };
}

function calcSignalIndex(rootCount, childCount, ideaCount) {
  const score = Math.min(99, 34 + rootCount * 8 + childCount * 3 + ideaCount * 5);
  return String(score).padStart(2, "0");
}

function matchesSearch(parts) {
  const query = state.searchQuery.trim().toLowerCase();
  if (!query) return true;
  return parts.some((part) => String(part || "").toLowerCase().includes(query));
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

function renderProjects() {
  const filteredProjects = state.projectsTree.filter((project) => matchesSearch([
    project.title,
    project.problem,
    project.plan,
    project.owner,
    ...project.children.flatMap((child) => [child.title, child.problem, child.plan, child.owner])
  ]));

  elements.projectsList.innerHTML = filteredProjects.map((project, index) => {
    const expanded = state.expandedProjects.has(project.id);
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
          <div class="card-actions">
            <button
              class="subroute-btn"
              type="button"
              data-project-id="${escapeHtml(project.id)}"
              data-child-count="${childCount}"
              aria-expanded="${expanded ? "true" : "false"}"
            >
              ${expanded ? "HIDE SUB-ROUTINES" : `VIEW ${childCount} SUB-ROUTINES`}
            </button>
          </div>
        `
      : "";

    return `
      <article class="signal-card project-card reveal${expanded ? " expanded" : ""}" style="--progress:${project.progress}; animation-delay:${index * 70}ms">
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
        ${expandButton}
        <div class="children-panel${expanded ? " active" : ""}">
          <div class="children-grid">${childMarkup}</div>
        </div>
      </article>
    `;
  }).join("");

  if (!filteredProjects.length) {
    elements.projectsList.innerHTML = '<div class="empty-state wide">没有匹配的项目结果。</div>';
  }
}

function getFilteredIdeas() {
  return state.ideas.filter((idea) => matchesSearch([
    idea.title,
    idea.problem,
    idea.plan,
    idea.owner
  ]));
}

function createIdeaCardElement(idea) {
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
            <span class="tag-signal">CONCEPT</span>
            <span class="tag-meta">OPEN POOL</span>
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
    </article>
  `.trim();
  return template.content.firstElementChild;
}

function patchIdeaCard(card, idea) {
  if (!card || !idea) return;
  card.dataset.ideaId = idea.id;
  const title = card.querySelector(".project-title-row h3");
  const owner = card.querySelector(".owner-pill");
  const detailTexts = card.querySelectorAll(".detail-text");
  const likeButton = card.querySelector("[data-like-id]");
  const likeCount = card.querySelector(".like-btn-count");
  if (title) title.textContent = idea.title;
  if (owner) owner.textContent = idea.owner;
  if (detailTexts[0]) detailTexts[0].innerHTML = formatRichText(idea.problem);
  if (detailTexts[1]) detailTexts[1].innerHTML = formatRichText(idea.plan);
  if (likeButton) {
    likeButton.dataset.likeId = idea.id;
    likeButton.classList.toggle("loading", state.likingIdeaIds.has(idea.id));
    likeButton.disabled = state.likingIdeaIds.has(idea.id);
  }
  if (likeCount) likeCount.textContent = String(idea.likes);
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

    patchIdeaCard(card, idea);

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

function renderStats() {
  elements.projectCount.textContent = String(state.projectsTree.length).padStart(2, "0");
  elements.childCount.textContent = String(state.childCount).padStart(2, "0");
  elements.ideaCount.textContent = String(state.ideas.length).padStart(2, "0");
  elements.momentum.textContent = calcSignalIndex(state.projectsTree.length, state.childCount, state.ideas.length);
}

function renderAll() {
  renderProjects();
  renderIdeas();
  renderStats();
}

function signatureOf(value) {
  return JSON.stringify(value);
}

function setActivePool(pool) {
  state.activePool = pool;
  elements.projectsView.classList.toggle("active", pool === "projects");
  elements.ideasView.classList.toggle("active", pool === "ideas");
  elements.poolTabs.style.setProperty("--active-index", pool === "projects" ? "0" : "1");
  elements.poolTabs.querySelectorAll(".segmented-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.pool === pool);
  });
  elements.openIdeaModalBtn.classList.toggle("visible", pool === "ideas");
  elements.heroTitle.textContent = pool === "projects" ? "Grow Lab" : "Seed Hub";
  if (elements.heroKicker) {
    elements.heroKicker.textContent = "";
  }
  if (elements.heroDescription) {
    elements.heroDescription.textContent = pool === "projects"
    ? "Projects 以行动视角呈现父节点任务。每个模块都把问题、思路、负责人和进度压缩进同一块操作卡，展开后再进入子任务层。"
    : "Ideas 作为概念池存在，强调 problem space 与 approach。提交行为不离开当前页面，直接写回飞书。";
  }
  if (elements.panelKicker) {
    elements.panelKicker.textContent = "";
  }
  updateTitleJump();
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
      .filter((record) => hasMeaningfulFields(record.fields))
      .map(normalizeIdeaRecord)
      .filter((idea) => idea.title && idea.title !== "未命名 Idea");

    const nextProjectSignature = signatureOf({ roots: nextProjects, childCount: nextChildCount });
    const nextIdeaSignature = signatureOf(nextIdeas);
    const projectsChanged = nextProjectSignature !== state.projectSignature;
    const ideasChanged = nextIdeaSignature !== state.ideaSignature;

    state.projectsTree = nextProjects;
    state.childCount = nextChildCount;
    state.ideas = nextIdeas;

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

    updateMeta(projectsData.updated_at || ideasData.updated_at);
  } catch (error) {
    const projectTree = buildProjectTree(DEFAULT_PROJECTS.records);
    state.projectsTree = projectTree.roots;
    state.childCount = projectTree.childCount;
    state.ideas = DEFAULT_IDEAS.records.map(normalizeIdeaRecord);
    state.projectSignature = signatureOf({ roots: state.projectsTree, childCount: state.childCount });
    state.ideaSignature = signatureOf(state.ideas);
    renderAll();
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
    loadMe();
  });

  elements.poolTabs?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-pool]");
    if (!button) return;
    setActivePool(button.dataset.pool);
  });

  elements.searchInput?.addEventListener("input", (event) => {
    state.searchQuery = event.target.value;
    renderAll();
  });

  elements.projectsList?.addEventListener("click", (event) => {
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

  elements.ideasList?.addEventListener("click", async (event) => {
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
try { setActivePool("projects"); } catch (error) { console.error("setActivePool failed", error); }
Promise.resolve().then(() => loadData()).catch((error) => console.error("loadData failed", error));
Promise.resolve().then(() => loadMe()).catch((error) => console.error("loadMe failed", error));
setInterval(() => {
  loadData().catch((error) => console.error("interval loadData failed", error));
}, 30000);
