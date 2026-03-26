const DEFAULT_PROJECTS = {
  updated_at: "2026-03-25T08:30:00+08:00",
  records: [
    {
      id: "p1",
      fields: {
        Title: "AI 辅助创新提案系统",
        Owner: "Ming",
        Stage: "Prototype",
        Status: "In Progress",
        Impact: "High",
        Summary: "将创意从收集到评审自动化，缩短 60% 评审周期。",
        Tags: ["AI", "Workflow", "Automation"],
        Updated: "2026-03-24"
      }
    },
    {
      id: "p2",
      fields: {
        Title: "跨团队共创仪表盘",
        Owner: "Lina",
        Stage: "Discovery",
        Status: "Exploring",
        Impact: "Medium",
        Summary: "统一项目状态、风险与资源配置。",
        Tags: ["Collab", "Dashboard"],
        Updated: "2026-03-23"
      }
    },
    {
      id: "p3",
      fields: {
        Title: "客户洞察雷达",
        Owner: "Alex",
        Stage: "Pilot",
        Status: "Validating",
        Impact: "High",
        Summary: "实时抓取客户反馈信号并打分。",
        Tags: ["Insights", "Signal"],
        Updated: "2026-03-22"
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
        Title: "创新挑战赛小程序",
        Proposer: "Jin",
        Theme: "Community",
        Votes: 32,
        Feasibility: "Medium",
        Summary: "让员工以任务解锁的方式提交创意并互评。",
        Tags: ["Engagement", "Gamified"],
        Updated: "2026-03-25"
      }
    },
    {
      id: "i2",
      fields: {
        Title: "多维表格自动评分",
        Proposer: "Yuki",
        Theme: "Ops",
        Votes: 21,
        Feasibility: "High",
        Summary: "根据标签与预算自动计算优先级。",
        Tags: ["Scoring", "Bitable"],
        Updated: "2026-03-24"
      }
    }
  ]
};

const projectsList = document.getElementById("projectsList");
const ideasList = document.getElementById("ideasList");
const projectCount = document.getElementById("projectCount");
const ideaCount = document.getElementById("ideaCount");
const themeCount = document.getElementById("themeCount");
const momentum = document.getElementById("momentum");
const lastSync = document.getElementById("lastSync");
const today = document.getElementById("today");
const refreshBtn = document.getElementById("refreshBtn");
const ideaForm = document.getElementById("ideaForm");
const ideaStatus = document.getElementById("ideaStatus");
const ideaTitleInput = document.getElementById("ideaTitle");
const ideaProblemInput = document.getElementById("ideaProblem");
const ideaPlanInput = document.getElementById("ideaPlan");
const ideaOwnerInput = document.getElementById("ideaOwner");
const loginBtn = document.getElementById("loginBtn");
const authBanner = document.getElementById("authBanner");
const authBadge = document.getElementById("authBadge");
const guestToggleBtn = document.getElementById("guestToggleBtn");

const API_BASE = "/api";
let guestMode = false;

const FIELD_ALIASES = {
  projectTitle: ["DEMO名称", "项目名称", "Title", "标题"],
  ideaTitle: ["IDEA标题", "Idea", "Title", "标题"],
  owner: ["负责人", "Owner", "Owner/Lead", "Lead"],
  proposer: ["填写人", "提出人", "Owner", "Creator"],
  demoPlan: ["DEMO的思路", "demo的思路（非必填）", "思路", "Summary", "描述", "简介"],
  problem: ["解决的问题", "解决的问题（必填）"],
  expectedDate: ["预期可demo时间", "预期时间", "预计时间"],
  ideaLink: ["关联diea", "关联idea", "关联IDEA"],
  parent: ["父记录 2", "父记录"],
};

const EMPTY_MARKERS = new Set(["", null, undefined]);

function pickField(fields, keys) {
  for (const key of keys) {
    if (fields[key] !== undefined && fields[key] !== null) {
      return fields[key];
    }
  }
  return "";
}

function normalizeTags(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    return value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
  }
  return [];
}

function extractPersonNames(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => item?.name || item?.en_name).filter(Boolean);
  }
  if (typeof value === "string") return [value];
  return [];
}

function extractLinkedText(value) {
  if (!value || !Array.isArray(value)) return [];
  return value
    .map((item) => item?.text || (item?.text_arr || [])[0])
    .filter(Boolean);
}

function formatDate(value) {
  if (!value) return "";
  if (typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.valueOf())) {
      return date.toLocaleDateString("zh-CN", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    }
  }
  if (typeof value === "string") return value;
  return "";
}

function hasMeaningfulFields(fields) {
  if (!fields || typeof fields !== "object") return false;
  const keys = Object.keys(fields);
  if (!keys.length) return false;
  return keys.some((key) => !EMPTY_MARKERS.has(fields[key]));
}

function renderRow({ title, subtitle, metaA, metaB, tags }) {
  return `
    <div class="row reveal">
      <div>
        <div class="row-title">${title || "Untitled"}</div>
        <div class="row-sub">${subtitle || ""}</div>
      </div>
      <div class="row-meta">${metaA || ""}</div>
      <div class="row-meta">${metaB || ""}</div>
      <div class="row-tags">
        ${tags.map((tag) => `<span class="tag">${tag}</span>`).join("")}
      </div>
    </div>
  `;
}

function renderProjects(records = []) {
  const rows = records
    .filter((record) => hasMeaningfulFields(record.fields))
    .map((record) => {
      const fields = record.fields || {};
      const title = pickField(fields, FIELD_ALIASES.projectTitle);
      const owners = extractPersonNames(pickField(fields, FIELD_ALIASES.owner));
      const summary = pickField(fields, FIELD_ALIASES.demoPlan) || pickField(fields, FIELD_ALIASES.problem);
      const expected = formatDate(pickField(fields, FIELD_ALIASES.expectedDate));
      const parent = extractLinkedText(pickField(fields, FIELD_ALIASES.parent));
      const ideaLinks = extractLinkedText(pickField(fields, FIELD_ALIASES.ideaLink));

      const tags = [
        ...parent,
        ...ideaLinks,
      ].filter(Boolean);

      return renderRow({
        title,
        subtitle: summary,
        metaA: owners.length ? `负责人 · ${owners.join(" / ")}` : "负责人 · 待定",
        metaB: expected ? `预期可 Demo · ${expected}` : "预期可 Demo · 待定",
        tags: tags.length ? tags : ["Project"],
      });
    });

  projectsList.innerHTML = rows.join("");
  return rows.length;
}

function renderIdeas(records = []) {
  const rows = records
    .filter((record) => hasMeaningfulFields(record.fields))
    .map((record) => {
      const fields = record.fields || {};
      const title = pickField(fields, FIELD_ALIASES.ideaTitle);
      const proposers = extractPersonNames(pickField(fields, FIELD_ALIASES.proposer));
      const summary = pickField(fields, FIELD_ALIASES.problem) || pickField(fields, FIELD_ALIASES.demoPlan);

      return renderRow({
        title,
        subtitle: summary,
        metaA: proposers.length ? `提交人 · ${proposers.join(" / ")}` : "提交人 · 匿名",
        metaB: "Idea Intake · 待评估",
        tags: proposers.length ? proposers : ["Idea"],
      });
    });

  ideasList.innerHTML = rows.join("");
  return rows.length;
}

function calcMomentum(projects, ideas) {
  const count = projects.length + ideas.length;
  const score = Math.min(99, Math.max(45, count * 7));
  return `${score}`;
}

function updateStats(projectsCount, ideasCount, ideasRecords) {
  projectCount.textContent = projectsCount.toString().padStart(2, "0");
  ideaCount.textContent = ideasCount.toString().padStart(2, "0");
  const themes = new Set();
  ideasRecords.forEach((record) => {
    const fields = record.fields || {};
    const title = pickField(fields, FIELD_ALIASES.ideaTitle);
    if (title) themes.add(title);
  });
  themeCount.textContent = themes.size.toString().padStart(2, "0");
  momentum.textContent = calcMomentum(
    Array.from({ length: projectsCount }),
    Array.from({ length: ideasCount })
  );
}

function updateMeta(updatedAt) {
  if (!updatedAt) return;
  const date = new Date(updatedAt);
  if (!Number.isNaN(date.valueOf())) {
    lastSync.textContent = date.toLocaleString("zh-CN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
}

function updateToday() {
  const now = new Date();
  today.textContent = now.toLocaleDateString("zh-CN", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function setupParallax() {
  const grid = document.querySelector(".bg-grid");
  if (!grid) return;
  window.addEventListener("scroll", () => {
    const offset = window.scrollY * 0.06;
    grid.style.transform = `translate3d(0, ${offset}px, 0) scale(1.05)`;
  }, { passive: true });
}

function staggerReveal() {
  const rows = document.querySelectorAll(".reveal");
  rows.forEach((row, index) => {
    row.style.animationDelay = `${index * 60}ms`;
  });
}

async function loadData() {
  try {
    const [projectsRes, ideasRes] = await Promise.all([
      fetch(`${API_BASE}/projects`, { cache: "no-store" }),
      fetch(`${API_BASE}/ideas`, { cache: "no-store" })
    ]);

    const projectsData = projectsRes.ok ? await projectsRes.json() : DEFAULT_PROJECTS;
    const ideasData = ideasRes.ok ? await ideasRes.json() : DEFAULT_IDEAS;

    const projectsCount = renderProjects(projectsData.records || []);
    const ideasCount = renderIdeas(ideasData.records || []);
    updateStats(projectsCount, ideasCount, ideasData.records || []);
    updateMeta(projectsData.updated_at || ideasData.updated_at);
    staggerReveal();
  } catch (error) {
    try {
      const [projectsRes, ideasRes] = await Promise.all([
        fetch("data/projects.json", { cache: "no-store" }),
        fetch("data/ideas.json", { cache: "no-store" })
      ]);

      const projectsData = projectsRes.ok ? await projectsRes.json() : DEFAULT_PROJECTS;
      const ideasData = ideasRes.ok ? await ideasRes.json() : DEFAULT_IDEAS;

      const projectsCount = renderProjects(projectsData.records || []);
      const ideasCount = renderIdeas(ideasData.records || []);
      updateStats(projectsCount, ideasCount, ideasData.records || []);
      updateMeta(projectsData.updated_at || ideasData.updated_at);
      staggerReveal();
    } catch (fallbackError) {
      const projectsCount = renderProjects(DEFAULT_PROJECTS.records);
      const ideasCount = renderIdeas(DEFAULT_IDEAS.records);
      updateStats(projectsCount, ideasCount, DEFAULT_IDEAS.records);
      updateMeta(DEFAULT_PROJECTS.updated_at);
      staggerReveal();
    }
  }
}

refreshBtn.addEventListener("click", () => {
  loadData();
});

async function loadMe() {
  try {
    const configRes = await fetch(`${API_BASE}/config`, { cache: "no-store" });
    if (configRes.ok) {
      const config = await configRes.json();
      guestMode = Boolean(config?.guest_mode);
      if (guestToggleBtn) {
        guestToggleBtn.classList.toggle("active", guestMode);
        guestToggleBtn.textContent = guestMode ? "Guest On" : "Guest Off";
      }
    }

    const res = await fetch(`${API_BASE}/me`, { cache: "no-store" });
    if (!res.ok) throw new Error("not authed");
    const data = await res.json();
    authBanner.style.display = "none";
    ideaForm.setAttribute("aria-disabled", "false");
    authBadge.textContent = data?.user?.name ? `Authed · ${data.user.name}` : "Authed";
    return data;
  } catch (error) {
    if (guestMode) {
      authBanner.style.display = "none";
      ideaForm.setAttribute("aria-disabled", "false");
      authBadge.textContent = "Guest Mode";
    } else {
      authBanner.style.display = "flex";
      ideaForm.setAttribute("aria-disabled", "true");
      authBadge.textContent = "Login Required";
    }
    return null;
  }
}

if (loginBtn) {
  loginBtn.addEventListener("click", async () => {
    try {
      const res = await fetch(`${API_BASE}/login`, { cache: "no-store" });
      const data = await res.json();
      if (data?.auth_url) {
        window.location.href = data.auth_url;
      }
    } catch (error) {
      // ignore
    }
  });
}

if (guestToggleBtn) {
  guestToggleBtn.addEventListener("click", async () => {
    try {
      const res = await fetch(`${API_BASE}/guest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !guestMode }),
      });
      if (res.ok) {
        const data = await res.json();
        guestMode = Boolean(data?.guest_mode);
        await loadMe();
      }
    } catch (error) {
      // ignore
    }
  });
}

if (ideaForm) {
  ideaForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    ideaStatus.textContent = "Submitting...";

    const payload = {
      title: ideaTitleInput.value.trim(),
      problem: ideaProblemInput.value.trim(),
      plan: ideaPlanInput.value.trim(),
      owner_open_id: ideaOwnerInput.value.trim(),
    };

    if (!payload.title) {
      ideaStatus.textContent = "需要填写 IDEA 标题";
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/ideas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        ideaStatus.textContent = detail.message || "提交失败";
        return;
      }

      ideaStatus.textContent = "已写入飞书";
      ideaForm.reset();
      loadData();
      loadMe();
    } catch (error) {
      ideaStatus.textContent = "提交失败";
    }
  });
}

updateToday();
setupParallax();
loadData();
loadMe();
setInterval(loadData, 30000);
