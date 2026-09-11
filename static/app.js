/* 能源电力科研工作台 - SPA */
const token = {
  get: () => localStorage.getItem("wb_token") || "",
  set: (t) => localStorage.setItem("wb_token", t),
};

const api = {
  async req(method, url, body) {
    const headers = body ? { "Content-Type": "application/json" } : {};
    if (token.get()) headers["x-workbench-token"] = token.get();
    const r = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 401) {
      askToken();
      throw new Error("需要访问令牌");
    }
    if (r.status === 204) return null;
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || "请求失败 " + r.status);
    return data;
  },
  get: (u) => api.req("GET", u),
  post: (u, b) => api.req("POST", u, b || {}),
  put: (u, b) => api.req("PUT", u, b),
  patch: (u, b) => api.req("PATCH", u, b),
  del: (u) => api.req("DELETE", u),
};

const state = {
  meta: null,
  projects: [],
  view: "dashboard",
  project: null,
  stage: "investigate",
  prompts: [],
  doc: null,
  selectedPrompt: null,
};

const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function boot() {
  state.meta = await api.get("/api/meta");
  await refreshProjects();
  window.addEventListener("hashchange", route);
  route();
}

async function refreshProjects() {
  state.projects = await api.get("/api/projects");
  renderSidebar();
}

function stageLabel(key) {
  const s = (state.meta?.stages || []).find((x) => x.key === key);
  return s ? s.label : key;
}

function renderSidebar() {
  $$(".nav-item").forEach((a) => a.classList.toggle("active", a.dataset.view === state.view));
  const list = $("#project-list");
  list.innerHTML = state.projects.length
    ? ""
    : '<div class="empty" style="color:#7d8aa5">暂无项目</div>';
  for (const p of state.projects) {
    const a = document.createElement("a");
    a.className = "side-proj" + (state.project?.id === p.id ? " active" : "");
    a.href = "#/project/" + p.id;
    a.innerHTML = `${esc(p.title)}<div class="sp-field">${esc(p.field || "未设置方向")}</div>`;
    list.appendChild(a);
  }
  const foot = $("#model-status");
  foot.className = "side-foot" + (state.meta.model_configured ? " ok" : "");
  foot.textContent = state.meta.model_configured ? "● 模型接口已配置" : "○ 未配置模型接口";
}

function mount(tplId) {
  const main = $("#main");
  main.innerHTML = "";
  main.appendChild($("#" + tplId).content.cloneNode(true));
}

function modal(html) {
  const root = $("#modal-root");
  root.innerHTML = `<div class="modal-mask"><div class="modal">${html}</div></div>`;
  $(".modal-mask").addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-mask")) root.innerHTML = "";
  });
  return root;
}
const closeModal = () => ($("#modal-root").innerHTML = "");

function askToken() {
  if ($("#modal-root .modal")) return;
  modal(`<h2>需要访问令牌</h2>
    <p class="muted small">本实例启用了访问保护（WORKBENCH_TOKEN）</p>
    <label>令牌<input id="tk-in" type="password" placeholder="输入部署时设置的访问令牌"></label>
    <div class="chat-actions"><button class="btn primary" id="tk-ok">确定</button></div>`);
  $("#tk-ok").onclick = () => {
    token.set($("#tk-in").value.trim());
    closeModal();
    route();
  };
}

function route() {
  const h = location.hash || "#/dashboard";
  const m = h.match(/^#\/project\/(\d+)/);
  if (m) return showProject(+m[1]);
  if (h.startsWith("#/prompts")) return showPrompts();
  if (h.startsWith("#/settings")) return showSettings();
  return showDashboard();
}

/* ---------- dashboard ---------- */

async function showDashboard() {
  state.view = "dashboard";
  state.project = null;
  renderSidebar();
  mount("tpl-dashboard");
  const wrap = $("#dash-projects");
  if (!state.projects.length) {
    wrap.innerHTML = '<div class="empty">还没有项目，点击右上角「新建研究项目」开始</div>';
  }
  for (const p of state.projects) {
    const c = document.createElement("div");
    c.className = "proj-card";
    c.innerHTML = `
      <h3>${esc(p.title)}</h3>
      <span class="tag">${esc(p.field || "未设置方向")}</span>
      <span class="tag stage-tag">${esc(stageLabel(p.stage))}</span>
      <p>${esc(p.problem || p.notes || "")}</p>`;
    c.onclick = () => (location.hash = "#/project/" + p.id);
    wrap.appendChild(c);
  }
  $("#btn-new-project").onclick = () => projectModal();
}

function projectModal(p) {
  const fields = state.meta.fields.map((f) => `<option ${p?.field === f ? "selected" : ""}>${esc(f)}</option>`).join("");
  const stages = state.meta.stages
    .filter((s) => s.key !== "general")
    .map((s) => `<option value="${s.key}" ${p?.stage === s.key ? "selected" : ""}>${s.label}</option>`)
    .join("");
  modal(`
    <h2>${p ? "编辑项目信息" : "新建研究项目"}</h2>
    <label>项目名称<input id="f-title" value="${esc(p?.title || "")}" placeholder="如：基于时空图神经网络的分布式光伏功率概率预测"></label>
    <label>研究方向<select id="f-field"><option value="">请选择</option>${fields}</select></label>
    <label>当前阶段<select id="f-stage">${stages}</select></label>
    <label>核心科学问题<textarea id="f-problem" rows="2" placeholder="要解决什么问题？">${esc(p?.problem || "")}</textarea></label>
    <label>研究假设<textarea id="f-hypo" rows="2" placeholder="可证伪的假设（可选）">${esc(p?.hypothesis || "")}</textarea></label>
    <label>可用数据集<input id="f-data" value="${esc(p?.dataset || "")}" placeholder="如 GEFCom2014、某省电网实测数据"></label>
    <label>备注<textarea id="f-notes" rows="2">${esc(p?.notes || "")}</textarea></label>
    <div class="chat-actions">
      <button class="btn" onclick="document.getElementById('modal-root').innerHTML=''">取消</button>
      <button class="btn primary" id="f-save">保存</button>
    </div>`);
  $("#f-save").onclick = async () => {
    const body = {
      title: $("#f-title").value.trim(),
      field: $("#f-field").value,
      stage: $("#f-stage").value,
      problem: $("#f-problem").value.trim(),
      hypothesis: $("#f-hypo").value.trim(),
      dataset: $("#f-data").value.trim(),
      notes: $("#f-notes").value.trim(),
    };
    if (!body.title) return alert("请填写项目名称");
    if (p) await api.patch("/api/projects/" + p.id, body);
    else {
      const np = await api.post("/api/projects", body);
      closeModal();
      await refreshProjects();
      location.hash = "#/project/" + np.id;
      return;
    }
    closeModal();
    await refreshProjects();
    route();
  };
}

/* ---------- project view ---------- */

async function showProject(id) {
  state.view = "project";
  state.project = await api.get("/api/projects/" + id);
  state.stage = state.project.stage || "investigate";
  state.doc = null;
  state.selectedPrompt = null;
  renderSidebar();
  mount("tpl-project");
  $("#pj-title").textContent = state.project.title;
  $("#pj-meta").textContent = `${state.project.field || "未设置方向"}`;
  $("#btn-edit-project").onclick = () => projectModal(state.project);
  $("#btn-export").onclick = () =>
    window.open(`/api/projects/${id}/export?token=${encodeURIComponent(token.get())}`, "_blank");
  renderStageBar();
  await renderStagePrompts();
  renderDocs();
  await loadMessages();
  $("#btn-send").onclick = sendChat;
  $("#btn-clear-chat").onclick = async () => {
    if (confirm("清空本项目的对话记录？")) {
      await api.del(`/api/projects/${id}/messages`);
      $("#chat-scroll").innerHTML = "";
    }
  };
  $("#btn-new-doc").onclick = () => openDocEditor(null);
  $("#btn-save-doc").onclick = saveDoc;
  $("#btn-del-doc").onclick = delDoc;
  const sec = $("#doc-section");
  sec.innerHTML = state.meta.sections.map((s) => `<option value="${s.key}">${s.label}</option>`).join("");
}

function renderStageBar() {
  const bar = $("#stage-bar");
  bar.innerHTML = "";
  for (const s of state.meta.stages) {
    if (s.key === "general") continue;
    const el = document.createElement("button");
    el.className = "stage-step" + (s.key === state.stage ? " active" : "");
    el.innerHTML = `<span class="dot"></span>${s.label}`;
    el.onclick = async () => {
      state.stage = s.key;
      renderStageBar();
      await renderStagePrompts();
    };
    bar.appendChild(el);
  }
}

async function renderStagePrompts() {
  state.prompts = await api.get("/api/prompts?stage=" + state.stage);
  const wrap = $("#stage-prompts");
  wrap.innerHTML = "";
  for (const p of state.prompts) {
    const el = document.createElement("div");
    el.className = "prompt-item" + (state.selectedPrompt?.id === p.id ? " selected" : "");
    el.innerHTML = `<b>${esc(p.title)}</b><span>${esc(p.summary)}</span>`;
    el.onclick = () => usePrompt(p);
    wrap.appendChild(el);
  }
}

async function usePrompt(p) {
  state.selectedPrompt = p;
  $$("#stage-prompts .prompt-item").forEach((el, i) =>
    el.classList.toggle("selected", state.prompts[i].id === p.id)
  );
  const r = await api.get(`/api/prompts/${p.id}/render?project_id=${state.project.id}`);
  const vars = r.unfilled.filter((v) => v !== "输入内容");
  let text = r.rendered;
  if (vars.length) {
    const inputs = vars
      .map((v) => `<label>${esc("{" + v + "}")}<input data-var="${esc(v)}" placeholder="填写内容"></label>`)
      .join("");
    modal(`<h2>填写：${esc(p.title)}</h2>
      <p class="muted small">以下内容将填入提示词对应位置，生成后可再编辑</p>
      ${inputs}
      <div class="chat-actions">
        <button class="btn" onclick="document.getElementById('modal-root').innerHTML=''">取消</button>
        <button class="btn primary" id="v-ok">生成</button>
      </div>`);
    $("#v-ok").onclick = () => {
      $$("#modal-root [data-var]").forEach((el) => {
        text = text.split("{" + el.dataset.var + "}").join(el.value.trim() || "{" + el.dataset.var + "}");
      });
      closeModal();
      $("#chat-text").value = text;
      $("#chat-text").focus();
    };
  } else {
    $("#chat-text").value = text;
    $("#chat-text").focus();
  }
}

async function loadMessages() {
  const msgs = await api.get(`/api/projects/${state.project.id}/messages`);
  const box = $("#chat-scroll");
  box.innerHTML = "";
  for (const m of msgs) addMsg(m.role, m.content, m.prompt_title, false);
  box.scrollTop = box.scrollHeight;
}

function addMsg(role, content, promptTitle, saveable = true) {
  const box = $("#chat-scroll");
  const el = document.createElement("div");
  el.className = "msg " + role;
  el.innerHTML = `<div class="role">${role === "user" ? "我" : "AI 助手"}</div>
    <div class="bubble">${promptTitle ? `<span class="ptag">[${esc(promptTitle)}]</span>\n` : ""}${esc(content)}
    ${role === "assistant" && saveable ? '<div class="save-doc"><button class="btn small">存为项目文档</button></div>' : ""}</div>`;
  const btn = $(".save-doc button", el);
  if (btn) btn.onclick = () => openDocEditor({ title: "AI 生成 - " + (promptTitle || "回复"), content });
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
  return el;
}

async function sendChat() {
  const ta = $("#chat-text");
  const text = ta.value.trim();
  if (!text) return;
  const promptTitle = state.selectedPrompt?.title || "";
  ta.value = "";
  addMsg("user", text, promptTitle);
  const thinking = addMsg("assistant", "思考中…", "", false);
  const bubble = $(".bubble", thinking);
  let acc = "";
  try {
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token.get() ? { "x-workbench-token": token.get() } : {}) },
      body: JSON.stringify({
        project_id: state.project.id,
        stage: state.stage,
        message: text,
        prompt_title: promptTitle,
      }),
    });
    const ctype = r.headers.get("content-type") || "";
    if (ctype.includes("event-stream")) {
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const ev = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const dataLine = ev.split("\n").find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          const data = JSON.parse(dataLine.slice(5));
          if (data.type === "delta") {
            acc += data.text;
            bubble.textContent = acc;
          } else if (data.type === "done") {
            acc = data.content || acc;
            bubble.innerHTML = esc(acc) + '<div class="save-doc"><button class="btn small">存为项目文档</button></div>';
            $(".save-doc button", bubble).onclick = () =>
              openDocEditor({ title: "AI 生成 - " + (promptTitle || "回复"), content: acc });
          } else if (data.type === "error") {
            bubble.textContent = "调用失败：" + data.detail;
          }
          $("#chat-scroll").scrollTop = $("#chat-scroll").scrollHeight;
        }
      }
    } else {
      const data = await r.json();
      bubble.textContent = data.detail || "未知错误";
    }
  } catch (e) {
    bubble.textContent = "请求失败：" + e.message;
  }
  state.selectedPrompt = null;
  $$("#stage-prompts .prompt-item").forEach((el) => el.classList.remove("selected"));
}

/* documents */

function renderDocs() {
  const list = $("#doc-list");
  const docs = state.project.documents || [];
  list.innerHTML = docs.length ? "" : '<div class="empty">暂无文档</div>';
  for (const d of docs) {
    const el = document.createElement("div");
    el.className = "doc-item" + (state.doc?.id === d.id ? " active" : "");
    const sec = state.meta.sections.find((s) => s.key === d.section_key);
    el.innerHTML = `<span>${esc(d.title || "未命名")}</span><span class="sec">${sec ? sec.label.split(" ")[0] : ""}</span>`;
    el.onclick = () => openDocEditor(d);
    list.appendChild(el);
  }
}

function openDocEditor(d) {
  state.doc = d;
  $("#doc-editor").hidden = false;
  $("#doc-title").value = d?.title || "";
  $("#doc-section").value = d?.section_key || "notes";
  $("#doc-content").value = d?.content || "";
  $("#btn-del-doc").style.display = d ? "" : "none";
  renderDocs();
}

async function saveDoc() {
  const body = {
    kind: "section",
    section_key: $("#doc-section").value,
    title: $("#doc-title").value.trim() || "未命名",
    content: $("#doc-content").value,
  };
  if (state.doc) await api.put("/api/documents/" + state.doc.id, body);
  else await api.post(`/api/projects/${state.project.id}/documents`, body);
  state.project = await api.get("/api/projects/" + state.project.id);
  renderDocs();
}

async function delDoc() {
  if (!state.doc || !confirm("删除该文档？")) return;
  await api.del("/api/documents/" + state.doc.id);
  state.doc = null;
  $("#doc-editor").hidden = true;
  state.project = await api.get("/api/projects/" + state.project.id);
  renderDocs();
}

/* ---------- prompts page ---------- */

async function showPrompts(stage) {
  state.view = "prompts";
  renderSidebar();
  mount("tpl-prompts");
  const bar = $("#prompt-stage-bar");
  const stages = [{ key: "", label: "全部" }, ...state.meta.stages];
  bar.innerHTML = "";
  let cur = stage || "";
  for (const s of stages) {
    const el = document.createElement("button");
    el.className = "stage-step" + (s.key === cur ? " active" : "");
    el.textContent = s.label;
    el.onclick = () => showPrompts(s.key);
    bar.appendChild(el);
  }
  const prompts = await api.get("/api/prompts" + (cur ? "?stage=" + cur : ""));
  const list = $("#prompt-list");
  list.innerHTML = "";
  for (const p of prompts) {
    const card = document.createElement("div");
    card.className = "p-card";
    card.innerHTML = `
      <h3>${esc(p.title)}${p.builtin ? '<span class="badge-builtin">内置</span>' : ""}
        <span class="tag stage-tag" style="font-size:11px">${esc(stageLabel(p.stage))}</span></h3>
      <div class="p-sum">${esc(p.summary)}</div>
      <pre>${esc(p.content)}</pre>
      <div class="p-actions">
        <button class="btn small a-toggle">展开/收起</button>
        <button class="btn small a-copy">复制</button>
        <button class="btn small a-edit">编辑</button>
        <button class="btn small danger a-del">删除</button>
      </div>`;
    $(".a-toggle", card).onclick = () => card.classList.toggle("open");
    $(".a-copy", card).onclick = () => {
      navigator.clipboard.writeText(p.content);
    };
    $(".a-edit", card).onclick = () => promptModal(p);
    $(".a-del", card).onclick = async () => {
      if (confirm("删除该提示词？")) {
        await api.del("/api/prompts/" + p.id);
        showPrompts(cur);
      }
    };
    list.appendChild(card);
  }
  $("#btn-new-prompt").onclick = () => promptModal(null);
}

function promptModal(p) {
  const stages = state.meta.stages
    .map((s) => `<option value="${s.key}" ${p?.stage === s.key ? "selected" : ""}>${s.label}</option>`)
    .join("");
  modal(`<h2>${p ? "编辑提示词" : "新建提示词"}</h2>
    <label>标题<input id="pf-title" value="${esc(p?.title || "")}"></label>
    <label>所属阶段<select id="pf-stage">${stages}</select></label>
    <label>简介<input id="pf-sum" value="${esc(p?.summary || "")}"></label>
    <label>提示词内容（用 {变量名} 表示占位符；{论文题目}{研究方向}{具体问题}{研究假设}{数据集} 会自动填入项目信息）<textarea id="pf-content" rows="12">${esc(p?.content || "")}</textarea></label>
    <div class="chat-actions">
      <button class="btn" onclick="document.getElementById('modal-root').innerHTML=''">取消</button>
      <button class="btn primary" id="pf-save">保存</button>
    </div>`);
  $("#pf-save").onclick = async () => {
    const body = {
      title: $("#pf-title").value.trim(),
      stage: $("#pf-stage").value,
      summary: $("#pf-sum").value.trim(),
      content: $("#pf-content").value,
    };
    if (!body.title || !body.content) return alert("标题和内容必填");
    if (p) await api.put("/api/prompts/" + p.id, body);
    else await api.post("/api/prompts", body);
    closeModal();
    showPrompts("");
  };
}

/* ---------- settings ---------- */

async function showSettings() {
  state.view = "settings";
  renderSidebar();
  mount("tpl-settings");
  const cfg = await api.get("/api/settings/model");
  $("#m-base").value = cfg.base_url;
  $("#m-model").value = cfg.model;
  $("#m-temp").value = cfg.temperature;
  $("#m-sysp").value = cfg.system_prompt;
  $("#m-key-hint").textContent = cfg.api_key_masked ? "已保存：" + cfg.api_key_masked : "未配置";
  $("#btn-save-model").onclick = async () => {
    await api.put("/api/settings/model", {
      base_url: $("#m-base").value.trim(),
      api_key: $("#m-key").value.trim(),
      model: $("#m-model").value.trim(),
      temperature: $("#m-temp").value,
      system_prompt: $("#m-sysp").value,
    });
    state.meta = await api.get("/api/meta");
    renderSidebar();
    alert("已保存");
  };
  $("#btn-test-model").onclick = async () => {
    $("#m-test-result").textContent = "测试中…";
    await api.put("/api/settings/model", {
      base_url: $("#m-base").value.trim(),
      api_key: $("#m-key").value.trim(),
      model: $("#m-model").value.trim(),
      temperature: $("#m-temp").value,
      system_prompt: $("#m-sysp").value,
    });
    const r = await api.post("/api/settings/model/test");
    $("#m-test-result").textContent = r.ok
      ? "✓ " + r.detail + (r.models?.length ? `；可用模型：${r.models.slice(0, 5).join(", ")}` : "")
      : "✗ " + r.detail;
    state.meta = await api.get("/api/meta");
    renderSidebar();
  };
}

boot();
