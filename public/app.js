/* ============================================================
   DayLog — public/app.js  |  Talks to /api/* (Express backend)
   ============================================================ */
console.log("DayLog: app.js loading...");

// ── 1. Global State & Initialization ──────────────────────────
let isSignupMode = true;
let supabaseClient;
let config = null;

async function fetchConfig() {
  try {
    const res = await fetch("/api/config");
    config = await res.json();
    return config;
  } catch (err) {
    console.error("DayLog: Failed to fetch config:", err);
    return null;
  }
}

async function initSupabase() {
  if (supabaseClient) return supabaseClient;
  
  if (!config) {
    await fetchConfig();
  }

  if (config && config.supabaseUrl && config.supabaseKey) {
    if (window.supabase) {
      supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseKey);
      return supabaseClient;
    }
  }
  console.warn("DayLog: Supabase initialization deferred (config or library missing)");
  return null;
}
// Initialization is now managed within the async init chain

// ── 2. Auth Handlers (Moved to top for resilience) ────────────
async function handleAuthToggle() {
  console.log("DayLog: Toggling Auth Mode. Current isSignupMode:", isSignupMode);
  isSignupMode = !isSignupMode;
  
  const title = document.getElementById("authTitle");
  const desc = document.getElementById("authDesc");
  const submitBtn = document.getElementById("authSubmitBtn");
  const toggleBtn = document.getElementById("authToggleBtn");
  const toggleText = document.getElementById("authToggleText");
  const nameGroup = document.getElementById("nameGroup");

  if (!title || !submitBtn || !toggleBtn) {
    console.error("DayLog: Auth elements missing from DOM!");
    return;
  }

  if (isSignupMode) {
    if (nameGroup) nameGroup.classList.remove("hidden");
    title.textContent = "Create Account";
    desc.textContent = "Join DayLog to start tracking your progress.";
    submitBtn.textContent = "Get Started — Free";
    toggleText.textContent = "Already have an account?";
    toggleBtn.textContent = "Sign in instead";
  } else {
    if (nameGroup) nameGroup.classList.add("hidden");
    title.textContent = "Welcome Back";
    desc.textContent = "Please enter your details to sign in.";
    submitBtn.textContent = "Login to Dashboard";
    toggleText.textContent = "New to DayLog?";
    toggleBtn.textContent = "Create an account";
  }
}
// Ensure it's globally accessible for HTML onclick
window.handleAuthToggle = handleAuthToggle;

async function handleAuthSubmit(e) {
  if (e) e.preventDefault();
  console.log("DayLog: Auth form submitted. Mode:", isSignupMode ? "Signup" : "Login");
  
  const email = document.getElementById("authEmail").value;
  const password = document.getElementById("authPassword").value;
  const name = document.getElementById("authName") ? document.getElementById("authName").value : "";
  const btn = document.getElementById("authSubmitBtn");

  if (password.length < 6) {
    showToast("Password must be at least 6 characters", "error");
    return;
  }
  
  if (isSignupMode && !name) {
    showToast("Please enter your full name", "error");
    return;
  }

  btn.disabled = true;
  btn.textContent = isSignupMode ? "Creating account..." : "Logging in...";

  try {
    let result;
    const sb = await initSupabase();
    if (isSignupMode) {
      result = await sb.auth.signUp({ 
        email, 
        password,
        options: { 
          emailRedirectTo: window.location.origin,
          data: { full_name: name }
        }
      });
    } else {
      result = await sb.auth.signInWithPassword({ email, password });
    }

    if (result.error) throw result.error;
    
    console.log("DayLog: Auth result data:", result.data);

    if (isSignupMode && !result.data.session) {
      showToast("Success! Please check your email for a confirmation link.", "success");
      handleAuthToggle();
    } else {
      showToast(isSignupMode ? "Account created!" : "Welcome back!", "success");
      updateUIForAuth();
    }
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = isSignupMode ? "Get Started — Free" : "Login to Dashboard";
  }
}
window.handleAuthSubmit = handleAuthSubmit;

async function handleLogout() {
  const sb = await initSupabase();
  await sb.auth.signOut();
  updateUIForAuth();
  showToast("Logged out", "info");
}
window.handleLogout = handleLogout;

async function updateUIForAuth() {
  const sb = await initSupabase();
  if (!sb) return;
  const { data: { session } } = await sb.auth.getSession();
  const overlay = document.getElementById("authOverlay");
  const container = document.getElementById("appContainer");

  if (session) {
    overlay.classList.add("hidden");
    container.classList.remove("hidden");
    if (typeof switchSection === 'function') switchSection("daily");
  } else {
    overlay.classList.remove("hidden");
    container.classList.add("hidden");
  }
}
window.updateUIForAuth = updateUIForAuth;


// ── API client ────────────────────────────────────────────────
const api = {
  async _req(method, path, body) {
    const sb = await initSupabase();
    if (!sb) {
      showToast("Storage initialization failed. Please refresh.", "error");
      throw new Error("Supabase not initialized");
    }
    const { data: { session } } = await sb.auth.getSession();
    const opts = { 
      method, 
      headers: {
        "Authorization": session ? `Bearer ${session.access_token}` : ""
      } 
    };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(path, opts);
    
    // Handle session expiry
    if (r.status === 401) {
      console.warn("DayLog: Session expired or invalid. Redirecting to auth.");
      updateUIForAuth();
      throw new Error("Unauthorized — Please sign in again.");
    }

    // Try to parse JSON body only if there is content
    const contentType = r.headers.get("Content-Type");
    let responseData = null;
    if (contentType && contentType.includes("application/json")) {
      const text = await r.text();
      if (text) {
        try {
          responseData = JSON.parse(text);
        } catch (e) {
          console.error("DayLog: Failed to parse JSON response:", text);
        }
      }
    }

    if (!r.ok) {
      const errMsg = (responseData && responseData.error) || r.statusText || `Request failed with status ${r.status}`;
      throw new Error(errMsg);
    }
    
    return responseData;
  },

  get: (path) => api._req("GET", path),
  post: (path, body) => api._req("POST", path, body),
  patch: (path, body) => api._req("PATCH", path, body),
  del: (path) => api._req("DELETE", path),
};

// ── Global state ──────────────────────────────────────────────
let currentDate = getTodayKey();
let activeSection = "daily";
let activeLearnTopic = "";
let learnTopics = [];
let activeWorkTopic = "";
let workTopics = [];

// ── Helpers ───────────────────────────────────────────────────
function getTodayKey() {
  return toDateKey(new Date());
}
function toDateKey(date) {
  return date.toISOString().split("T")[0];
}
function parseKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function generateId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}
function escapeHtml(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeTopicName(raw) {
  return (raw || "").replace(/\s+/g, " ").trim();
}

function formatPrettyDate(dateKey) {
  if (!dateKey) return "";
  const date = new Date(dateKey + "T00:00:00");
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ── Loading state ─────────────────────────────────────────────
function setLoading(listId, on) {
  const el = document.getElementById(listId);
  if (!el || !on) return;
  el.innerHTML =
    '<div class="list-loading"><div class="spinner"></div><span>Loading...</span></div>';
}

// ── Toast ─────────────────────────────────────────────────────
let toastContainer = null;
function showToast(message, type) {
  type = type || "info";
  if (!toastContainer) {
    toastContainer = document.createElement("div");
    toastContainer.className = "toast-container";
    document.body.appendChild(toastContainer);
  }

  const icons = {
    success: '<i class="ph-fill ph-check-circle" style="color: var(--green); font-size: 1.2rem;"></i>',
    error: '<i class="ph-fill ph-warning-circle" style="color: var(--red); font-size: 1.2rem;"></i>',
    info: '<i class="ph-fill ph-info" style="color: var(--blue); font-size: 1.2rem;"></i>'
  };

  const toast = document.createElement("div");
  toast.className = "toast " + type;
  toast.innerHTML = (icons[type] || icons.info) + "<span>" + message + "</span>";
  toastContainer.appendChild(toast);
  
  setTimeout(function () {
    toast.style.animation = "toastOut 0.3s ease forwards";
    setTimeout(function () {
      toast.remove();
    }, 300);
  }, 3500);
}

// ── Top-level tab switching ───────────────────────────────────
function switchSection(section) {
  activeSection = section;
  document.querySelectorAll(".top-tab").forEach(function (btn) {
    btn.classList.toggle("active", btn.dataset.section === section);
  });
  document.querySelectorAll(".section-page").forEach(function (el) {
    el.classList.add("hidden");
  });
  document.getElementById("section-" + section).classList.remove("hidden");

  // Keep dateNavWrapper visible but toggle navigation buttons
  const isDaily = section === "daily";
  document.getElementById("prevDay").classList.toggle("hidden", !isDaily);
  document.getElementById("nextDay").classList.toggle("hidden", !isDaily);
  document.getElementById("todayBtn").classList.toggle("hidden", !isDaily);

  renderDateHeader();

  if (section === "daily") renderDaily();
  if (section === "work") renderWorkTasks();
  if (section === "learnings") renderLearnings();
}

// ── Panel Toggling ────────────────────────────────────────────
function togglePanel(panelId, btn) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  const isCollapsed = panel.classList.contains("collapsed");
  if (isCollapsed) {
    panel.classList.remove("collapsed");
    btn.innerHTML = '<i class="ph ph-x"></i> Cancel';
  } else {
    panel.classList.add("collapsed");
    btn.innerHTML = '<i class="ph ph-plus"></i> Add Task';
  }
}

function closePanel(panelId) {
  const panel = document.getElementById(panelId);
  if (!panel || panel.classList.contains("collapsed")) return;
  panel.classList.add("collapsed");
  const btn = document.querySelector(`button[onclick*="'${panelId}'"]`);
  if (btn) btn.innerHTML = '<i class="ph ph-plus"></i> Add Task';
}


// ══════════════════════════════════════════════════════════════
//  SECTION 1 — DAILY LOG
// ══════════════════════════════════════════════════════════════

function shiftDate(days) {
  const d = parseKey(currentDate);
  d.setDate(d.getDate() + days);
  currentDate = toDateKey(d);
  renderDaily();
}

function formatDateLabel(key) {
  const today = getTodayKey();
  const yesterday = toDateKey(new Date(Date.now() - 86400000));
  const tomorrow = toDateKey(new Date(Date.now() + 86400000));
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  if (key === tomorrow) return "Tomorrow";
  return parseKey(key).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateSub(key) {
  return parseKey(key).toLocaleDateString("en-US", { weekday: "long" });
}

function formatTime(h, m) {
  h = parseInt(h, 10) || 0;
  m = parseInt(m, 10) || 0;
  if (!h && !m) return "--";
  if (!h) return m + "m";
  if (!m) return h + "h";
  return h + "h " + m + "m";
}

function totalMins(tasks) {
  return tasks.reduce(function (s, t) {
    return (
      s + (parseInt(t.hours, 10) || 0) * 60 + (parseInt(t.minutes, 10) || 0)
    );
  }, 0);
}

function minsToDisplay(total) {
  if (!total) return "0h 0m";
  const h = Math.floor(total / 60),
    m = total % 60;
  if (!h) return m + "m";
  if (!m) return h + "h";
  return h + "h " + m + "m";
}

const STATUS_LABEL = {
  completed: "Completed",
  pending: "Pending",
  "in-progress": "In Progress",
};
const PRIORITY_LABEL = { high: "High", medium: "Medium", low: "Low" };

function renderDateHeader() {
  document.getElementById("dateLabel").textContent =
    formatDateLabel(currentDate);
  document.getElementById("dateSub").textContent = formatDateSub(currentDate);
  const nextBtn = document.getElementById("nextDay");
  const overToday = currentDate >= getTodayKey();
  nextBtn.disabled = overToday;
  nextBtn.style.opacity = overToday ? "0.35" : "1";
  nextBtn.style.cursor = overToday ? "not-allowed" : "pointer";
}

async function renderDaily() {
  renderDateHeader();
  setLoading("taskList", true);

  try {
    const all = await api.get("/api/daily?date=" + currentDate);

    const search = (
      document.getElementById("searchInput")?.value || ""
    ).toLowerCase();
    const statusF = document.getElementById("filterStatus")?.value || "all";

    document.getElementById("totalHours").textContent = minsToDisplay(
      totalMins(all),
    );
    document.getElementById("completedCount").textContent = all.filter(
      function (t) {
        return t.status === "completed";
      },
    ).length;
    document.getElementById("pendingCount").textContent = all.filter(
      function (t) {
        return t.status !== "completed";
      },
    ).length;
    document.getElementById("totalTasks").textContent = all.length;

    let tasks = all.slice();
    if (statusF !== "all")
      tasks = tasks.filter(function (t) {
        return t.status === statusF;
      });
    if (search)
      tasks = tasks.filter(function (t) {
        return (
          t.name.toLowerCase().includes(search) ||
          (t.notes || "").toLowerCase().includes(search)
        );
      });

    const list = document.getElementById("taskList");
    const empty = document.getElementById("emptyState");
    list.innerHTML = "";
    if (!tasks.length) {
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");
    tasks.forEach(function (t) {
      list.appendChild(buildDailyCard(t));
    });
  } catch (err) {
    showToast("Failed to load tasks: " + err.message, "error");
    document.getElementById("taskList").innerHTML = "";
  }
}

function buildDailyCard(task) {
  const card = document.createElement("div");
  const isDone = task.status === "completed";
  const time = formatTime(task.hours, task.minutes);
  card.className = "task-card status-" + task.status;
  card.dataset.id = task.id;
  const timeBadge =
    time !== "--"
      ? '<span class="task-badge badge-time"><i class="ph ph-clock"></i> ' + time + "</span>"
      : "";
  const noteHtml = task.notes
    ? '<div class="task-notes">' + escapeHtml(task.notes) + "</div>"
    : "";
  card.innerHTML =
    '<div class="task-card-top">' +
    '<div class="task-card-left">' +
    '<div class="task-check ' +
    (isDone ? "checked" : "") +
    '" data-daily-toggle="' +
    task.id +
    '" title="Toggle">' +
    (isDone ? '<i class="ph-bold ph-check"></i>' : "") +
    "</div>" +
    '<div class="task-info">' +
    '<div class="task-name ' +
    (isDone ? "done" : "") +
    '">' +
    escapeHtml(task.name) +
    "</div>" +
    '<div class="task-meta">' +
    '<span class="task-badge badge-status-' +
    task.status +
    '">' +
    (STATUS_LABEL[task.status] || task.status) +
    "</span>" +
    timeBadge +
    "</div>" +
    "</div>" +
    "</div>" +
    '<div class="task-actions">' +
    '<button class="action-btn" data-daily-edit="' +
    task.id +
    '" title="Edit"><i class="ph ph-pencil-simple"></i></button>' +
    '<button class="action-btn delete" data-daily-delete="' +
    task.id +
    '" title="Delete"><i class="ph ph-trash"></i></button>' +
    "</div>" +
    "</div>" +
    noteHtml;
  return card;
}

async function handleAddDailyTask(e) {
  e.preventDefault();
  const name = document.getElementById("taskName").value.trim();
  const hours = parseInt(document.getElementById("taskHours").value, 10) || 0;
  const minutes =
    parseInt(document.getElementById("taskMinutes").value, 10) || 0;
  const notes = document.getElementById("taskNotes").value.trim();
  const status =
    document.querySelector('input[name="taskStatus"]:checked')?.value ||
    "completed";
  if (!name) {
    showToast("Please enter a task name.", "error");
    return;
  }

  const btn = e.target.querySelector(".submit-btn");
  btn.disabled = true;
  btn.textContent = "Saving...";

  try {
    await api.post("/api/daily", {
      id: generateId(),
      name,
      hours,
      minutes,
      notes,
      status,
      date_key: currentDate,
    });
    document.getElementById("taskForm").reset();
    document.getElementById("taskHours").value = 0;
    document.getElementById("taskMinutes").value = 0;
    const si = document.querySelector(
      'input[name="taskStatus"][value="completed"]',
    );
    if (si) si.checked = true;
    showToast("Task added!", "success");
    closePanel("dailyAddPanel");
    renderDaily();
  } catch (err) {
    showToast("Failed to add task: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Add Task";
  }
}

async function toggleDailyTask(id) {
  const card = document.querySelector('.task-card[data-id="' + id + '"]');
  const isDone = card
    ? card.querySelector(".task-check")?.classList.contains("checked")
    : false;
  const newStatus = isDone ? "pending" : "completed";
  try {
    await api.patch("/api/daily/" + id, { status: newStatus });
    showToast(
      newStatus === "completed" ? "Marked complete!" : "Marked pending",
      "info",
    );
    renderDaily();
  } catch (err) {
    showToast("Failed to update: " + err.message, "error");
  }
}

async function deleteDailyTask(id) {
  try {
    await api.del("/api/daily/" + id);
    showToast("Task deleted.", "info");
    renderDaily();
  } catch (err) {
    showToast("Failed to delete: " + err.message, "error");
  }
}

async function openDailyEditModal(id) {
  try {
    const data = await api.get("/api/daily/" + id);
    document.getElementById("editTaskId").value = data.id;
    document.getElementById("editTaskName").value = data.name;
    document.getElementById("editTaskHours").value = data.hours;
    document.getElementById("editTaskMinutes").value = data.minutes;
    document.getElementById("editTaskNotes").value = data.notes || "";
    const si = document.querySelector(
      'input[name="editTaskStatus"][value="' + data.status + '"]',
    );
    if (si) si.checked = true;
    document.getElementById("editModal").classList.remove("hidden");
    document.getElementById("editTaskName").focus();
  } catch (err) {
    showToast("Could not load task: " + err.message, "error");
  }
}

async function handleEditDailyTask(e) {
  e.preventDefault();
  const id = document.getElementById("editTaskId").value;
  const name = document.getElementById("editTaskName").value.trim();
  if (!name) {
    showToast("Name cannot be empty.", "error");
    return;
  }

  const btn = e.target.querySelector(".submit-btn");
  btn.disabled = true;
  btn.textContent = "Saving...";

  try {
    await api.patch("/api/daily/" + id, {
      name,
      hours: parseInt(document.getElementById("editTaskHours").value, 10) || 0,
      minutes:
        parseInt(document.getElementById("editTaskMinutes").value, 10) || 0,
      notes: document.getElementById("editTaskNotes").value.trim(),
      status:
        document.querySelector('input[name="editTaskStatus"]:checked')?.value ||
        "completed",
    });
    closeModal("editModal");
    showToast("Task updated!", "success");
    renderDaily();
  } catch (err) {
    showToast("Failed to update: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Save Changes";
  }
}

// ══════════════════════════════════════════════════════════════
//  SECTION 2 — WORK TASKS
// ══════════════════════════════════════════════════════════════

async function loadWorkTopics() {
  const res = await api.get("/api/work/topics");
  const names = (res || [])
    .map((item) => normalizeTopicName(item.name))
    .filter(Boolean);

  workTopics = Array.from(new Set(names));
  workTopics.unshift("All"); // Add 'All' topic to the beginning

  if (!workTopics.length) {
    workTopics = ["All", "General"];
  }

  if (!activeWorkTopic || !workTopics.includes(activeWorkTopic)) {
    activeWorkTopic = workTopics[0];
  }
  updateTopicDeleteButtons();
}

function updateTopicDeleteButtons() {
  const workDelBtn = document.getElementById("workDeleteTopicBtn");
  if (workDelBtn) {
    if (activeWorkTopic && activeWorkTopic !== "All") {
      workDelBtn.classList.remove("hidden");
    } else {
      workDelBtn.classList.add("hidden");
    }
  }

  const learnDelBtn = document.getElementById("learnDeleteTopicBtn");
  if (learnDelBtn) {
    if (activeLearnTopic && activeLearnTopic !== "All") {
      learnDelBtn.classList.remove("hidden");
    } else {
      learnDelBtn.classList.add("hidden");
    }
  }
}

async function deleteWorkTopic() {
  if (!activeWorkTopic || activeWorkTopic === "All") return;
  const confirmed = confirm(
    `Are you sure you want to delete the topic "${activeWorkTopic}"? This will delete all tasks associated with it.`
  );
  if (!confirmed) return;

  try {
    await api.del("/api/work/topics/" + encodeURIComponent(activeWorkTopic));
    showToast(`Topic "${activeWorkTopic}" deleted.`, "info");
    activeWorkTopic = "All";
    await renderWorkTasks();
  } catch (err) {
    showToast("Failed to delete topic: " + err.message, "error");
  }
}

async function deleteLearnTopic() {
  if (!activeLearnTopic || activeLearnTopic === "All") return;
  const confirmed = confirm(
    `Are you sure you want to delete the topic "${activeLearnTopic}"? This will delete all learning nodes associated with it.`
  );
  if (!confirmed) return;

  try {
    await api.del("/api/learn/topics/" + encodeURIComponent(activeLearnTopic));
    showToast(`Topic "${activeLearnTopic}" deleted.`, "info");
    activeLearnTopic = "All";
    await renderLearnings();
  } catch (err) {
    showToast("Failed to delete topic: " + err.message, "error");
  }
}window.deleteWorkTopic = deleteWorkTopic;
window.deleteLearnTopic = deleteLearnTopic;

function renderWorkTopicTabs() {
  const tabs = document.getElementById("workTopicTabs");
  tabs.innerHTML = "";

  workTopics.forEach((topic) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sub-tab" + (topic === activeWorkTopic ? " active" : "");
    btn.dataset.topic = topic;
    btn.textContent = topic;
    tabs.appendChild(btn);
  });
}

function renderWorkTitles() {
  const tName = activeWorkTopic === "All" ? "All Tasks" : activeWorkTopic;
  document.getElementById("workAddTitle").innerHTML =
    '<i class="ph-fill ph-plus-circle"></i> Add Task — ' + tName;
  document.getElementById("workListTitle").innerHTML =
    '<i class="ph-fill ph-briefcase"></i> ' + (activeWorkTopic === "All" ? "All Topics" : activeWorkTopic + " Tasks");
}

async function renderWorkTasks() {
  try {
    await loadWorkTopics();
    renderWorkTopicTabs();
    renderWorkTitles();
    await fetchAndRenderWorkTasks();
  } catch (err) {
    showToast("Failed to load topics: " + err.message, "error");
  }
}

function switchWorkTopic(topic) {
  activeWorkTopic = topic;
  updateTopicDeleteButtons();
  renderWorkTopicTabs();
  renderWorkTitles();
  fetchAndRenderWorkTasks();
}

async function fetchAndRenderWorkTasks() {
  const listEl = document.getElementById("workTaskList");
  const empty = document.getElementById("workEmptyState");
  if (!activeWorkTopic) {
    listEl.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }

  listEl.innerHTML =
    '<div class="list-loading"><div class="spinner"></div><span>Loading...</span></div>';

  try {
    const fetchUrl = activeWorkTopic === "All"
      ? "/api/work"
      : "/api/work?topic=" + encodeURIComponent(activeWorkTopic);
    const all = await api.get(fetchUrl);
    const search = (
      document.getElementById("workSearchInput")?.value || ""
    ).toLowerCase();
    const statusF = document.getElementById("workFilterStatus")?.value || "all";
    const priorityF =
      document.getElementById("workFilterPriority")?.value || "all";

    let tasks = all.slice();
    if (statusF !== "all")
      tasks = tasks.filter(function (t) {
        return t.status === statusF;
      });
    if (priorityF !== "all")
      tasks = tasks.filter(function (t) {
        return t.priority === priorityF;
      });
    if (search)
      tasks = tasks.filter(function (t) {
        return (
          t.name.toLowerCase().includes(search) ||
          (t.notes || "").toLowerCase().includes(search)
        );
      });

    listEl.innerHTML = "";
    if (!tasks.length) {
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");

    // Group tasks by status
    const inProgressTasks = tasks.filter(t => t.status === "in-progress");
    const pendingTasks = tasks.filter(t => t.status === "pending" || !t.status);
    const completedTasks = tasks.filter(t => t.status === "completed");

    // Helper to render a group
    const renderGroup = (groupTasks, titleTitle, titleIcon, isFirst) => {
      if (groupTasks.length > 0) {
        const header = document.createElement("div");
        header.className = "group-title" + (isFirst ? " first" : "");
        header.innerHTML = '<i class="' + titleIcon + '"></i> ' + titleTitle + ' (' + groupTasks.length + ')';
        listEl.appendChild(header);
        
        groupTasks.forEach(function (item) {
          listEl.appendChild(buildWorkCard(item));
        });
      }
    };

    // Render in specific order
    let isFirst = true;
    if (inProgressTasks.length > 0) {
      renderGroup(inProgressTasks, "In Progress", "ph-fill ph-lightning", isFirst);
      isFirst = false;
    }
    if (pendingTasks.length > 0) {
      renderGroup(pendingTasks, "Pending", "ph-fill ph-clock", isFirst);
      isFirst = false;
    }
    if (completedTasks.length > 0) {
      renderGroup(completedTasks, "Completed", "ph-fill ph-check-circle", isFirst);
    }
  } catch (err) {
    showToast("Failed to load work tasks: " + err.message, "error");
    document.getElementById("workTaskList").innerHTML = "";
  }
}

async function handleAddWorkTopic(e) {
  e.preventDefault();
  const input = document.getElementById("newWorkTopic");
  const name = normalizeTopicName(input.value);
  if (!name) {
    showToast("Please enter a topic name.", "error");
    return;
  }

  const btn = e.target.querySelector(".submit-btn");
  btn.disabled = true;
  btn.textContent = "Adding...";

  try {
    await api.post("/api/work/topics", { id: generateId(), name });
    if (!workTopics.includes(name)) workTopics.push(name);
    activeWorkTopic = name;
    input.value = "";
    showToast("Topic created!", "success");
    renderWorkTopicTabs();
    renderWorkTitles();
    fetchAndRenderWorkTasks();
  } catch (err) {
    showToast("Failed to create topic: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Add Topic";
  }
}

function buildWorkCard(task) {
  const card = document.createElement("div");
  const isDone = task.status === "completed";
  card.className = "task-card status-" + task.status;
  card.dataset.id = task.id;
  const endDateBadge = task.end_date
    ? '<span class="task-badge badge-end-date"><i class="ph ph-calendar-blank"></i> ' +
      escapeHtml(formatPrettyDate(task.end_date)) +
      "</span>"
    : "";
  const noteHtml = task.notes
    ? '<div class="task-notes">' + escapeHtml(task.notes) + "</div>"
    : "";
  card.innerHTML =
    '<div class="task-card-top">' +
    '<div class="task-card-left">' +
    '<div class="task-check ' +
    (isDone ? "checked" : "") +
    '" data-work-toggle="' +
    task.id +
    '" title="Toggle">' +
    (isDone ? '<i class="ph-bold ph-check"></i>' : "") +
    "</div>" +
    '<div class="task-info">' +
    '<div class="task-name ' +
    (isDone ? "done" : "") +
    '">' +
    escapeHtml(task.name) +
    "</div>" +
    '<div class="task-meta">' +
    '<span class="task-badge badge-status-' +
    task.status +
    '">' +
    (STATUS_LABEL[task.status] || task.status) +
    "</span>" +
    '<span class="task-badge badge-priority-' +
    task.priority +
    '">' +
    (PRIORITY_LABEL[task.priority] || task.priority) +
    "</span>" +
    endDateBadge +
    "</div>" +
    "</div>" +
    "</div>" +
    '<div class="task-actions">' +
    '<button class="action-btn" data-work-edit="' +
    task.id +
    '" title="Edit"><i class="ph ph-pencil-simple"></i></button>' +
    '<button class="action-btn delete" data-work-delete="' +
    task.id +
    '" data-work-topic="' +
    escapeHtml(task.topic) +
    '" title="Delete"><i class="ph ph-trash"></i></button>' +
    "</div>" +
    "</div>" +
    noteHtml;
  return card;
}

async function handleAddWorkTask(e) {
  e.preventDefault();
  if (!activeWorkTopic || activeWorkTopic === "All") {
    showToast("Please select a specific topic first to add a task.", "error");
    return;
  }

  const name = document.getElementById("workTaskName").value.trim();
  const priority = document.getElementById("workTaskPriority").value;
  const end_date =
    document.getElementById("workTaskEndDate").value || undefined;
  const notes = document.getElementById("workTaskNotes").value.trim();
  const status =
    document.querySelector('input[name="workTaskStatus"]:checked')?.value ||
    "pending";
  if (!name) {
    showToast("Please enter a task name.", "error");
    return;
  }

  const btn = e.target.querySelector(".submit-btn");
  btn.disabled = true;
  btn.textContent = "Saving...";

  try {
    await api.post("/api/work", {
      id: generateId(),
      topic: activeWorkTopic,
      name,
      priority,
      end_date,
      notes,
      status,
    });
    document.getElementById("workTaskForm").reset();
    const si = document.querySelector(
      'input[name="workTaskStatus"][value="pending"]',
    );
    if (si) si.checked = true;
    showToast("Work task added!", "success");
    closePanel("workAddPanel");
    fetchAndRenderWorkTasks();
  } catch (err) {
    showToast("Failed to add task: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Add Task";
  }
}

async function toggleWorkTask(id) {
  const card = document.querySelector('.task-card[data-id="' + id + '"]');
  const isDone = card
    ? card.querySelector(".task-check")?.classList.contains("checked")
    : false;
  const newStatus = isDone ? "pending" : "completed";
  try {
    await api.patch("/api/work/" + id, { status: newStatus });
    showToast(
      newStatus === "completed" ? "Marked complete!" : "Marked pending",
      "info",
    );
    fetchAndRenderWorkTasks();
  } catch (err) {
    showToast("Failed to update: " + err.message, "error");
  }
}

async function deleteWorkTask(id, topic) {
  try {
    await api.del("/api/work/" + id);
    showToast("Task deleted.", "info");
    if (topic === activeWorkTopic || activeWorkTopic === "All") fetchAndRenderWorkTasks();
  } catch (err) {
    showToast("Failed to delete: " + err.message, "error");
  }
}

async function openWorkEditModal(id) {
  try {
    const data = await api.get("/api/work/" + id);
    document.getElementById("editWorkTaskId").value = data.id;
    document.getElementById("editWorkTaskName").value = data.name;
    document.getElementById("editWorkTaskPriority").value = data.priority;
    document.getElementById("editWorkTaskEndDate").value = data.end_date || "";
    document.getElementById("editWorkTaskNotes").value = data.notes || "";
    const si = document.querySelector(
      'input[name="editWorkTaskStatus"][value="' + data.status + '"]',
    );
    if (si) si.checked = true;
    document.getElementById("workEditModal").classList.remove("hidden");
    document.getElementById("editWorkTaskName").focus();
  } catch (err) {
    showToast("Could not load task: " + err.message, "error");
  }
}

async function handleEditWorkTask(e) {
  e.preventDefault();
  const id = document.getElementById("editWorkTaskId").value;
  const name = document.getElementById("editWorkTaskName").value.trim();
  if (!name) {
    showToast("Name cannot be empty.", "error");
    return;
  }

  const btn = e.target.querySelector(".submit-btn");
  btn.disabled = true;
  btn.textContent = "Saving...";

  try {
    await api.patch("/api/work/" + id, {
      name,
      priority: document.getElementById("editWorkTaskPriority").value,
      end_date:
        document.getElementById("editWorkTaskEndDate").value || undefined,
      notes: document.getElementById("editWorkTaskNotes").value.trim(),
      status:
        document.querySelector('input[name="editWorkTaskStatus"]:checked')
          ?.value || "pending",
    });
    closeModal("workEditModal");
    showToast("Task updated!", "success");
    fetchAndRenderWorkTasks();
  } catch (err) {
    showToast("Failed to update: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Save Changes";
  }
}

// ══════════════════════════════════════════════════════════════
//  SECTION 3 — LEARNINGS (dynamic topics)
// ══════════════════════════════════════════════════════════════

async function loadLearnTopics() {
  const res = await api.get("/api/learn/topics");
  const names = (res || [])
    .map((item) => normalizeTopicName(item.name))
    .filter(Boolean);

  learnTopics = Array.from(new Set(names));
  learnTopics.unshift("All"); // Add 'All' topic to the beginning

  if (!learnTopics.length) {
    learnTopics = ["All", "General"];
  }

  if (!activeLearnTopic || !learnTopics.includes(activeLearnTopic)) {
    activeLearnTopic = learnTopics[0];
  }
  updateTopicDeleteButtons();
}

function renderLearnTopicTabs() {
  const tabs = document.getElementById("learnTopicTabs");
  tabs.innerHTML = "";

  learnTopics.forEach((topic) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sub-tab" + (topic === activeLearnTopic ? " active" : "");
    btn.dataset.topic = topic;
    btn.textContent = topic;
    tabs.appendChild(btn);
  });
}

function renderLearnTitles() {
  const tName = activeLearnTopic === "All" ? "All Tasks" : activeLearnTopic;
  document.getElementById("learnAddTitle").innerHTML =
    '<i class="ph-fill ph-plus-circle"></i> Add Task — ' + tName;
  document.getElementById("learnListTitle").innerHTML =
    '<i class="ph-fill ph-books"></i> ' + (activeLearnTopic === "All" ? "All Topics" : activeLearnTopic + " Tasks");
}

async function renderLearnings() {
  try {
    await loadLearnTopics();
    renderLearnTopicTabs();
    renderLearnTitles();
    await renderLearnTasks();
  } catch (err) {
    showToast("Failed to load topics: " + err.message, "error");
  }
}

function switchLearnTopic(topic) {
  activeLearnTopic = topic;
  updateTopicDeleteButtons();
  renderLearnTopicTabs();
  renderLearnTitles();
  renderLearnTasks();
}

async function renderLearnTasks() {
  const listEl = document.getElementById("learnTaskList");
  const empty = document.getElementById("learnEmptyState");
  if (!activeLearnTopic) {
    listEl.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }

  listEl.innerHTML =
    '<div class="list-loading"><div class="spinner"></div><span>Loading...</span></div>';

  try {
    const fetchUrl = activeLearnTopic === "All"
      ? "/api/learn"
      : "/api/learn?topic=" + encodeURIComponent(activeLearnTopic);
    const all = await api.get(fetchUrl);
    const search = (
      document.getElementById("learnSearchInput")?.value || ""
    ).toLowerCase();

    let tasks = all.slice();
    if (search) {
      tasks = tasks.filter(function (item) {
        return (
          item.title.toLowerCase().includes(search) ||
          (item.content || "").toLowerCase().includes(search) ||
          (item.status || "").toLowerCase().includes(search) ||
          (item.start_date || "").includes(search) ||
          (item.end_date || "").includes(search)
        );
      });
    }

    listEl.innerHTML = "";
    if (!tasks.length) {
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");

    // Group tasks by status
    const inProgressTasks = tasks.filter(t => t.status === "in-progress");
    const pendingTasks = tasks.filter(t => t.status === "pending" || !t.status);
    const completedTasks = tasks.filter(t => t.status === "completed");

    // Helper to render a group
    const renderGroup = (groupTasks, titleTitle, titleIcon, isFirst) => {
      if (groupTasks.length > 0) {
        const header = document.createElement("div");
        header.className = "group-title" + (isFirst ? " first" : "");
        header.innerHTML = '<i class="' + titleIcon + '"></i> ' + titleTitle + ' (' + groupTasks.length + ')';
        listEl.appendChild(header);
        
        groupTasks.forEach(function (item) {
          listEl.appendChild(buildLearnCard(item));
        });
      }
    };

    // Render in specific order
    let isFirst = true;
    if (inProgressTasks.length > 0) {
      renderGroup(inProgressTasks, "In Progress", "ph-fill ph-lightning", isFirst);
      isFirst = false;
    }
    if (pendingTasks.length > 0) {
      renderGroup(pendingTasks, "Pending", "ph-fill ph-clock", isFirst);
      isFirst = false;
    }
    if (completedTasks.length > 0) {
      renderGroup(completedTasks, "Completed", "ph-fill ph-check-circle", isFirst);
    }
  } catch (err) {
    showToast("Failed to load learning tasks: " + err.message, "error");
    listEl.innerHTML = "";
  }
}

function buildLearnCard(note) {
  const card = document.createElement("div");
  const isDone = note.status === "completed";
  card.className = "learn-card status-" + (note.status || "pending");
  card.dataset.id = note.id;
  card.dataset.topic = note.topic;
  const date = new Date(note.created_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const status = note.status || "pending";
  const statusBadge =
    '<span class="task-badge badge-status-' +
    status +
    '">' +
    (STATUS_LABEL[status] || status) +
    "</span>";
  const startDateBadge = note.start_date
    ? '<span class="task-badge badge-start-date"><i class="ph ph-flag"></i> ' +
      escapeHtml(formatPrettyDate(note.start_date)) +
      "</span>"
    : "";
  const endDateBadge = note.end_date
    ? '<span class="task-badge badge-end-date"><i class="ph ph-calendar-blank"></i> ' +
      escapeHtml(formatPrettyDate(note.end_date)) +
      "</span>"
    : "";
  const contentHtml = note.content
    ? '<div class="learn-card-content">' + escapeHtml(note.content) + "</div>"
    : "";
  card.innerHTML =
    '<div class="learn-card-top">' +
    '<div class="task-card-left">' +
    '<div class="task-check ' +
    (isDone ? "checked" : "") +
    '" data-learn-toggle="' +
    note.id +
    '" title="Toggle status">' +
    (isDone ? '<i class="ph-bold ph-check"></i>' : "") +
    "</div>" +
    '<div class="learn-card-title ' +
    (isDone ? "done" : "") +
    '">' +
    escapeHtml(note.title) +
    "</div>" +
    "</div>" +
    '<div class="task-actions">' +
    '<button class="action-btn" data-learn-edit="' +
    note.id +
    '" title="Edit"><i class="ph-fill ph-pencil-simple"></i></button>' +
    '<button class="action-btn delete" data-learn-delete="' +
    note.id +
    '" data-learn-topic="' +
    escapeHtml(note.topic) +
    '" title="Delete"><i class="ph ph-trash"></i></button>' +
    "</div>" +
    "</div>" +
    '<div class="task-meta">' +
    statusBadge +
    startDateBadge +
    endDateBadge +
    "</div>" +
    contentHtml +
    '<div class="learn-card-date">Added ' +
    date +
    "</div>";
  return card;
}

async function handleAddLearnTopic(e) {
  e.preventDefault();
  const input = document.getElementById("newLearnTopic");
  const name = normalizeTopicName(input.value);
  if (!name) {
    showToast("Please enter a topic name.", "error");
    return;
  }

  const btn = e.target.querySelector(".submit-btn");
  btn.disabled = true;
  btn.textContent = "Adding...";

  try {
    await api.post("/api/learn/topics", { id: generateId(), name });
    if (!learnTopics.includes(name)) learnTopics.push(name);
    activeLearnTopic = name;
    input.value = "";
    showToast("Topic created!", "success");
    renderLearnTopicTabs();
    renderLearnTitles();
    renderLearnTasks();
  } catch (err) {
    showToast("Failed to create topic: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Add Topic";
  }
}

async function handleAddLearnTask(e) {
  e.preventDefault();
  if (!activeLearnTopic || activeLearnTopic === "All") {
    showToast("Please select a specific topic first to add a task.", "error");
    return;
  }

  const title = document.getElementById("learnTaskTitle").value.trim();
  const content = document.getElementById("learnTaskContent").value.trim();
  const start_date =
    document.getElementById("learnTaskStartDate").value || undefined;
  const end_date =
    document.getElementById("learnTaskEndDate").value || undefined;
  const status =
    document.querySelector('input[name="learnTaskStatus"]:checked')?.value ||
    "pending";

  if (!title) {
    showToast("Please enter a task name.", "error");
    return;
  }

  if (start_date && end_date && start_date > end_date) {
    showToast("End date cannot be before start date.", "error");
    return;
  }

  const btn = e.target.querySelector(".submit-btn");
  btn.disabled = true;
  btn.textContent = "Saving...";

  try {
    await api.post("/api/learn", {
      id: generateId(),
      topic: activeLearnTopic,
      title,
      content,
      tags: [],
      status,
      start_date,
      end_date,
    });
    document.getElementById("learnTaskForm").reset();
    const defaultStatus = document.querySelector(
      'input[name="learnTaskStatus"][value="pending"]',
    );
    if (defaultStatus) defaultStatus.checked = true;
    showToast("Learning task added!", "success");
    closePanel("learnAddPanel");
    renderLearnTasks();
  } catch (err) {
    showToast("Failed to add task: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Add Task";
  }
}

async function deleteLearnTask(id, topic) {
  try {
    await api.del("/api/learn/" + id);
    showToast("Task deleted.", "info");
    if (topic === activeLearnTopic) renderLearnTasks();
  } catch (err) {
    showToast("Failed to delete: " + err.message, "error");
  }
}

async function toggleLearnTask(id) {
  const card = document.querySelector('.learn-card[data-id="' + id + '"]');
  const isDone = card
    ? card.querySelector(".task-check")?.classList.contains("checked")
    : false;
  const newStatus = isDone ? "pending" : "completed";

  try {
    await api.patch("/api/learn/" + id, { status: newStatus });
    showToast(
      newStatus === "completed" ? "Marked complete!" : "Marked pending",
      "info",
    );
    renderLearnTasks();
  } catch (err) {
    showToast("Failed to update: " + err.message, "error");
  }
}

async function openLearnEditModal(id) {
  try {
    const data = await api.get("/api/learn/" + id);
    document.getElementById("editLearnId").value = data.id;
    document.getElementById("editLearnTopic").value = data.topic;
    document.getElementById("editLearnTitle").value = data.title;
    document.getElementById("editLearnContent").value = data.content || "";
    document.getElementById("editLearnStartDate").value = data.start_date || "";
    document.getElementById("editLearnEndDate").value = data.end_date || "";
    const selected = document.querySelector(
      'input[name="editLearnStatus"][value="' +
        (data.status || "pending") +
        '"]',
    );
    if (selected) selected.checked = true;
    document.getElementById("learnEditModal").classList.remove("hidden");
    document.getElementById("editLearnTitle").focus();
  } catch (err) {
    showToast("Could not load task: " + err.message, "error");
  }
}

async function handleEditLearnTask(e) {
  e.preventDefault();
  const id = document.getElementById("editLearnId").value;
  const topic = document.getElementById("editLearnTopic").value;
  const title = document.getElementById("editLearnTitle").value.trim();
  const start_date =
    document.getElementById("editLearnStartDate").value || undefined;
  const end_date =
    document.getElementById("editLearnEndDate").value || undefined;
  const status =
    document.querySelector('input[name="editLearnStatus"]:checked')?.value ||
    "pending";
  if (!title) {
    showToast("Task cannot be empty.", "error");
    return;
  }

  if (start_date && end_date && start_date > end_date) {
    showToast("End date cannot be before start date.", "error");
    return;
  }

  const btn = e.target.querySelector(".submit-btn");
  btn.disabled = true;
  btn.textContent = "Saving...";

  try {
    await api.patch("/api/learn/" + id, {
      title,
      content: document.getElementById("editLearnContent").value.trim(),
      start_date,
      end_date,
      status,
    });
    closeModal("learnEditModal");
    showToast("Task updated!", "success");
    if (topic === activeLearnTopic) renderLearnTasks();
  } catch (err) {
    showToast("Failed to update: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Save Changes";
  }
}

// ── Modal helpers ─────────────────────────────────────────────
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add("hidden");
}

// ── Event delegation ──────────────────────────────────────────
function handleListClick(e) {
  const dToggle = e.target.closest("[data-daily-toggle]");
  const dEdit = e.target.closest("[data-daily-edit]");
  const dDel = e.target.closest("[data-daily-delete]");
  if (dToggle) {
    toggleDailyTask(dToggle.dataset.dailyToggle);
    return;
  }
  if (dEdit) {
    openDailyEditModal(dEdit.dataset.dailyEdit);
    return;
  }
  if (dDel) {
    deleteDailyTask(dDel.dataset.dailyDelete);
    return;
  }

  const wToggle = e.target.closest("[data-work-toggle]");
  const wEdit = e.target.closest("[data-work-edit]");
  const wDel = e.target.closest("[data-work-delete]");
  if (wToggle) {
    toggleWorkTask(wToggle.dataset.workToggle);
    return;
  }
  if (wEdit) {
    openWorkEditModal(wEdit.dataset.workEdit);
    return;
  }
  if (wDel) {
    const btn = e.target.closest("[data-work-delete]");
    deleteWorkTask(btn.dataset.workDelete, btn.dataset.workTopic);
    return;
  }

  const lEdit = e.target.closest("[data-learn-edit]");
  const lDel = e.target.closest("[data-learn-delete]");
  const lToggle = e.target.closest("[data-learn-toggle]");
  const topicTab = e.target.closest(".sub-tab[data-topic]");
  if (topicTab) {
    if (activeSection === "learnings") switchLearnTopic(topicTab.dataset.topic);
    else if (activeSection === "work") switchWorkTopic(topicTab.dataset.topic);
    return;
  }
  if (lToggle) {
    toggleLearnTask(lToggle.dataset.learnToggle);
    return;
  }
  if (lEdit) {
    openLearnEditModal(lEdit.dataset.learnEdit);
    return;
  }
  if (lDel) {
    const btn = e.target.closest("[data-learn-delete]");
    deleteLearnTask(btn.dataset.learnDelete, btn.dataset.learnTopic);
    return;
  }
}

// ── Auth Handlers ─────────────────────────────────────────────
// (The actual handlers have been moved to the top of the file for better reliability)


// ── Init ──────────────────────────────────────────────────────

let searchTimeout; // Declare searchTimeout globally or in a scope accessible by init

async function init() {
  console.log("DayLog: Initializing UI...");

  try {
    // 0. Ensure Supabase is initialized with server config
    await initSupabase();

    // 1. Auth Listeners (The most critical part)
    const authForm = document.getElementById("authForm");
    const authToggleBtn = document.getElementById("authToggleBtn");
    const logoutBtn = document.getElementById("logoutBtn");

    if (authForm) {
      authForm.onsubmit = handleAuthSubmit;
    }
    if (authToggleBtn) {
      authToggleBtn.onclick = handleAuthToggle;
    }
    if (logoutBtn) {
      logoutBtn.onclick = handleLogout;
    }

    updateUIForAuth();

    // 2. Navigation
    document.querySelectorAll(".top-tab").forEach(function (btn) {
      btn.onclick = () => switchSection(btn.dataset.section);
    });

    // 3. Daily
    const safeAddListener = (id, event, handler) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener(event, handler);
    };

    safeAddListener("prevDay", "click", () => shiftDate(-1));
    safeAddListener("nextDay", "click", () => shiftDate(1));
    safeAddListener("todayBtn", "click", () => { currentDate = getTodayKey(); renderDaily(); });
    safeAddListener("taskForm", "submit", handleAddDailyTask);
    safeAddListener("searchInput", "input", renderDaily);
    safeAddListener("filterStatus", "change", renderDaily);
    safeAddListener("editForm", "submit", handleEditDailyTask);
    safeAddListener("closeModal", "click", () => closeModal("editModal"));
    safeAddListener("cancelEdit", "click", () => closeModal("editModal"));

    // 4. Work
    safeAddListener("workTopicForm", "submit", handleAddWorkTopic);
    safeAddListener("workTaskForm", "submit", handleAddWorkTask);
    safeAddListener("workFilterStatus", "change", fetchAndRenderWorkTasks);
    safeAddListener("workFilterPriority", "change", fetchAndRenderWorkTasks);
    safeAddListener("workEditForm", "submit", handleEditWorkTask);
    safeAddListener("closeWorkModal", "click", () => closeModal("workEditModal"));
    safeAddListener("cancelWorkEdit", "click", () => closeModal("workEditModal"));

    const workSearchInput = document.getElementById("workSearchInput");
    if (workSearchInput) {
      workSearchInput.oninput = () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(fetchAndRenderWorkTasks, 300);
      };
    }

    // 5. Learn
    safeAddListener("learnTopicForm", "submit", handleAddLearnTopic);
    safeAddListener("learnTaskForm", "submit", handleAddLearnTask);
    safeAddListener("learnSearchInput", "input", renderLearnTasks);
    safeAddListener("learnEditForm", "submit", handleEditLearnTask);
    safeAddListener("closeLearnModal", "click", () => closeModal("learnEditModal"));
    safeAddListener("cancelLearnEdit", "click", () => closeModal("learnEditModal"));

    // Global
    document.addEventListener("click", handleListClick);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") ["editModal", "workEditModal", "learnEditModal"].forEach(closeModal);
    });

    console.log("DayLog: Initialization complete.");
  } catch (err) {
    console.error("DayLog: Critical failure during initialization:", err);
  }
}

document.addEventListener("DOMContentLoaded", init);
