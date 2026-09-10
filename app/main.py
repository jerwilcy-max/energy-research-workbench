"""能源电力科研工作台 — FastAPI backend.

Serves the SPA in ../static and a JSON API for projects, documents,
prompt templates, model configuration, and chat (proxied to a
user-configured OpenAI-compatible endpoint).
"""
import json
import os
import re

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import db, model
from .prompts_seed import PROMPTS, STAGES, FIELDS, SECTION_KEYS

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = os.path.join(BASE_DIR, "static")

app = FastAPI(title="Energy Research Workbench")

ACCESS_TOKEN = os.environ.get("WORKBENCH_TOKEN", "").strip()


@app.middleware("http")
async def token_guard(request: Request, call_next):
    """When WORKBENCH_TOKEN is set, all /api/* calls need it (header or ?token=)."""
    if not ACCESS_TOKEN or not request.url.path.startswith("/api/"):
        return await call_next(request)
    provided = request.headers.get("x-workbench-token") or request.query_params.get("token", "")
    if provided != ACCESS_TOKEN:
        return JSONResponse({"detail": "需要访问令牌"}, status_code=401)
    return await call_next(request)

VAR_RE = re.compile(r"\{([^{}]+)\}")

PROJECT_VARS = {
    "论文题目": "title",
    "研究方向": "field",
    "具体问题": "problem",
    "研究假设": "hypothesis",
    "数据集": "dataset",
}


# ---------- setup ----------

@app.on_event("startup")
def startup():
    db.init()
    with db.connect() as conn:
        n = conn.execute("SELECT COUNT(*) c FROM prompts").fetchone()["c"]
        if n == 0:
            for p in PROMPTS:
                conn.execute(
                    "INSERT INTO prompts (stage, title, summary, content, variables, builtin, updated_at)"
                    " VALUES (?, ?, ?, ?, ?, 1, ?)",
                    (p["stage"], p["title"], p.get("summary", ""), p["content"], p.get("variables", ""), db.now()),
                )


# ---------- meta ----------

@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/meta")
def meta():
    return {
        "stages": [{"key": k, "label": v} for k, v in STAGES],
        "fields": FIELDS,
        "sections": [{"key": k, "label": v} for k, v in SECTION_KEYS],
        "model_configured": model.configured(),
        "auth_required": bool(ACCESS_TOKEN),
    }


# ---------- projects ----------

class ProjectIn(BaseModel):
    title: str
    field: str = ""
    stage: str = "investigate"
    problem: str = ""
    hypothesis: str = ""
    dataset: str = ""
    notes: str = ""


@app.get("/api/projects")
def list_projects():
    with db.connect() as conn:
        return db.rows(conn, "SELECT * FROM projects ORDER BY updated_at DESC")


@app.post("/api/projects", status_code=201)
def create_project(p: ProjectIn):
    with db.connect() as conn:
        cur = conn.execute(
            "INSERT INTO projects (title, field, stage, problem, hypothesis, dataset, notes, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (p.title, p.field, p.stage, p.problem, p.hypothesis, p.dataset, p.notes, db.now(), db.now()),
        )
        return db.row(conn, "SELECT * FROM projects WHERE id = ?", (cur.lastrowid,))


@app.get("/api/projects/{pid}")
def get_project(pid: int):
    with db.connect() as conn:
        proj = db.row(conn, "SELECT * FROM projects WHERE id = ?", (pid,))
        if not proj:
            raise HTTPException(404, "项目不存在")
        proj["documents"] = db.rows(
            conn, "SELECT * FROM documents WHERE project_id = ? ORDER BY updated_at DESC", (pid,)
        )
        return proj


@app.patch("/api/projects/{pid}")
def update_project(pid: int, p: ProjectIn):
    with db.connect() as conn:
        if not db.row(conn, "SELECT id FROM projects WHERE id = ?", (pid,)):
            raise HTTPException(404, "项目不存在")
        conn.execute(
            "UPDATE projects SET title=?, field=?, stage=?, problem=?, hypothesis=?, dataset=?, notes=?, updated_at=?"
            " WHERE id=?",
            (p.title, p.field, p.stage, p.problem, p.hypothesis, p.dataset, p.notes, db.now(), pid),
        )
        return db.row(conn, "SELECT * FROM projects WHERE id = ?", (pid,))


@app.delete("/api/projects/{pid}", status_code=204)
def delete_project(pid: int):
    with db.connect() as conn:
        conn.execute("DELETE FROM projects WHERE id = ?", (pid,))


# ---------- documents ----------

class DocIn(BaseModel):
    kind: str = "note"
    section_key: str = ""
    title: str = ""
    content: str = ""


@app.post("/api/projects/{pid}/documents", status_code=201)
def create_doc(pid: int, d: DocIn):
    with db.connect() as conn:
        if not db.row(conn, "SELECT id FROM projects WHERE id = ?", (pid,)):
            raise HTTPException(404, "项目不存在")
        cur = conn.execute(
            "INSERT INTO documents (project_id, kind, section_key, title, content, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (pid, d.kind, d.section_key, d.title, d.content, db.now()),
        )
        conn.execute("UPDATE projects SET updated_at=? WHERE id=?", (db.now(), pid))
        return db.row(conn, "SELECT * FROM documents WHERE id = ?", (cur.lastrowid,))


@app.put("/api/documents/{did}")
def update_doc(did: int, d: DocIn):
    with db.connect() as conn:
        if not db.row(conn, "SELECT id FROM documents WHERE id = ?", (did,)):
            raise HTTPException(404, "文档不存在")
        conn.execute(
            "UPDATE documents SET kind=?, section_key=?, title=?, content=?, updated_at=? WHERE id=?",
            (d.kind, d.section_key, d.title, d.content, db.now(), did),
        )
        return db.row(conn, "SELECT * FROM documents WHERE id = ?", (did,))


@app.delete("/api/documents/{did}", status_code=204)
def delete_doc(did: int):
    with db.connect() as conn:
        conn.execute("DELETE FROM documents WHERE id = ?", (did,))


# ---------- prompts ----------

class PromptIn(BaseModel):
    stage: str
    title: str
    summary: str = ""
    content: str
    variables: str = ""


@app.get("/api/prompts")
def list_prompts(stage: str = ""):
    with db.connect() as conn:
        if stage:
            return db.rows(conn, "SELECT * FROM prompts WHERE stage = ? ORDER BY id", (stage,))
        return db.rows(conn, "SELECT * FROM prompts ORDER BY id")


@app.post("/api/prompts", status_code=201)
def create_prompt(p: PromptIn):
    with db.connect() as conn:
        cur = conn.execute(
            "INSERT INTO prompts (stage, title, summary, content, variables, builtin, updated_at)"
            " VALUES (?, ?, ?, ?, ?, 0, ?)",
            (p.stage, p.title, p.summary, p.content, p.variables, db.now()),
        )
        return db.row(conn, "SELECT * FROM prompts WHERE id = ?", (cur.lastrowid,))


@app.put("/api/prompts/{prid}")
def update_prompt(prid: int, p: PromptIn):
    with db.connect() as conn:
        if not db.row(conn, "SELECT id FROM prompts WHERE id = ?", (prid,)):
            raise HTTPException(404, "提示词不存在")
        conn.execute(
            "UPDATE prompts SET stage=?, title=?, summary=?, content=?, variables=?, updated_at=? WHERE id=?",
            (p.stage, p.title, p.summary, p.content, p.variables, db.now(), prid),
        )
        return db.row(conn, "SELECT * FROM prompts WHERE id = ?", (prid,))


@app.delete("/api/prompts/{prid}", status_code=204)
def delete_prompt(prid: int):
    with db.connect() as conn:
        if not db.row(conn, "SELECT builtin FROM prompts WHERE id = ?", (prid,)):
            raise HTTPException(404, "提示词不存在")
        conn.execute("DELETE FROM prompts WHERE id = ?", (prid,))


@app.get("/api/prompts/{prid}/render")
def render_prompt(prid: int, project_id: int = 0):
    """Substitute {var} placeholders with project fields; leave the rest."""
    with db.connect() as conn:
        pr = db.row(conn, "SELECT * FROM prompts WHERE id = ?", (prid,))
        if not pr:
            raise HTTPException(404, "提示词不存在")
        proj = db.row(conn, "SELECT * FROM projects WHERE id = ?", (project_id,)) if project_id else None

    def repl(m):
        name = m.group(1).strip()
        if proj and name in PROJECT_VARS:
            val = (proj.get(PROJECT_VARS[name]) or "").strip()
            if val:
                return val
        return m.group(0)

    pr["rendered"] = VAR_RE.sub(repl, pr["content"])
    pr["unfilled"] = sorted(set(VAR_RE.findall(pr["rendered"])))
    return pr


# ---------- model settings ----------

class ModelCfg(BaseModel):
    base_url: str = ""
    api_key: str = ""
    model: str = ""
    temperature: str = "0.7"
    system_prompt: str = ""


@app.get("/api/settings/model")
def get_model_cfg():
    cfg = model.get_config()
    return {**cfg, "api_key_masked": ("****" + cfg["api_key"][-4:]) if cfg["api_key"] else "", "api_key": ""}


@app.put("/api/settings/model")
def put_model_cfg(cfg: ModelCfg):
    data = cfg.dict()
    if not data.get("api_key"):
        data.pop("api_key", None)  # keep existing key when blank
    model.save_config(data)
    return {"ok": True}


@app.post("/api/settings/model/test")
async def test_model():
    cfg = model.get_config()
    if not cfg["base_url"].strip():
        return {"ok": False, "detail": "尚未填写 Base URL"}
    try:
        return await model.ping(cfg)
    except Exception as e:
        return {"ok": False, "detail": str(e)}


# ---------- chat ----------

class ChatIn(BaseModel):
    project_id: int = 0
    stage: str = "general"
    message: str
    prompt_id: int = 0
    prompt_title: str = ""
    document_id: int = 0
    context: str = ""


def build_messages(payload: ChatIn):
    cfg_sys = model.get_config().get("system_prompt", "").strip()
    base = cfg_sys or (
        "你是科研工作台上的 AI 助手，服务对象是能源电力数据与人工智能方向的研究者。"
        "请用专业、准确、可执行的方式协助科研全流程：文献调研、选题设计、实验研究、论文写作与投稿。"
        "涉及文献结论时区分事实与推测；不确定的引用请标注[需核实]。"
    )

    with db.connect() as conn:
        proj = db.row(conn, "SELECT * FROM projects WHERE id = ?", (payload.project_id,)) if payload.project_id else None
        prompt = db.row(conn, "SELECT * FROM prompts WHERE id = ?", (payload.prompt_id,)) if payload.prompt_id else None
        doc = db.row(conn, "SELECT * FROM documents WHERE id = ?", (payload.document_id,)) if payload.document_id else None
        history = []
        if payload.project_id:
            history = db.rows(
                conn,
                "SELECT role, content FROM messages WHERE project_id = ? ORDER BY id DESC LIMIT 12",
                (payload.project_id,),
            )[::-1]

    sys_parts = [base]
    if proj:
        sys_parts.append(
            "当前研究项目：\n"
            f"- 题目：{proj['title']}\n- 研究方向：{proj['field']}\n"
            f"- 核心问题：{proj['problem']}\n- 研究假设：{proj['hypothesis']}\n- 可用数据：{proj['dataset']}"
        )
    if doc:
        sys_parts.append(f"相关文档《{doc['title']}》内容：\n{doc['content'][:4000]}")

    def repl(m):
        name = m.group(1).strip()
        if proj and name in PROJECT_VARS:
            val = (proj.get(PROJECT_VARS[name]) or "").strip()
            if val:
                return val
        if name == "输入内容":
            return payload.context or m.group(0)
        return m.group(0)

    user_text = payload.message
    if prompt:
        user_text = VAR_RE.sub(repl, prompt["content"])
        if payload.context:
            user_text += "\n\n补充材料：\n" + payload.context
        if payload.message.strip():
            user_text += "\n\n用户补充说明：\n" + payload.message

    messages = [{"role": "system", "content": "\n\n".join(sys_parts)}]
    messages += [{"role": h["role"], "content": h["content"]} for h in history]
    messages.append({"role": "user", "content": user_text})
    return messages, (prompt["title"] if prompt else payload.prompt_title)


@app.post("/api/chat")
async def chat(payload: ChatIn):
    cfg = model.get_config()
    if not model.configured(cfg):
        return {
            "ok": False,
            "detail": "尚未配置模型接口。请到「模型设置」填写 Base URL、API Key 与模型名（任何 OpenAI 兼容接口均可，如 OpenAI / DeepSeek / 通义 / 智谱 / Ollama / vLLM / One-API）。",
        }

    messages, prompt_title = build_messages(payload)

    async def gen():
        yield "data: " + json.dumps({"type": "start"}) + "\n\n"
        full = []
        try:
            async for delta in model.stream_chat(cfg, messages):
                full.append(delta)
                yield "data: " + json.dumps({"type": "delta", "text": delta}) + "\n\n"
        except Exception as e:
            yield "data: " + json.dumps({"type": "error", "detail": str(e)}) + "\n\n"
            return
        text = "".join(full)
        if payload.project_id:
            with db.connect() as conn:
                conn.execute(
                    "INSERT INTO messages (project_id, stage, role, content, prompt_title, created_at)"
                    " VALUES (?, ?, 'user', ?, ?, ?)",
                    (payload.project_id, payload.stage, payload.message, prompt_title, db.now()),
                )
                conn.execute(
                    "INSERT INTO messages (project_id, stage, role, content, prompt_title, created_at)"
                    " VALUES (?, ?, 'assistant', ?, ?, ?)",
                    (payload.project_id, payload.stage, text, prompt_title, db.now()),
                )
                conn.execute("UPDATE projects SET updated_at=? WHERE id=?", (db.now(), payload.project_id))
        yield "data: " + json.dumps({"type": "done", "content": text}) + "\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


@app.get("/api/projects/{pid}/messages")
def list_messages(pid: int):
    with db.connect() as conn:
        return db.rows(conn, "SELECT * FROM messages WHERE project_id = ? ORDER BY id", (pid,))


@app.delete("/api/projects/{pid}/messages", status_code=204)
def clear_messages(pid: int):
    with db.connect() as conn:
        conn.execute("DELETE FROM messages WHERE project_id = ?", (pid,))


# ---------- export ----------

@app.get("/api/projects/{pid}/export")
def export_project(pid: int):
    with db.connect() as conn:
        proj = db.row(conn, "SELECT * FROM projects WHERE id = ?", (pid,))
        if not proj:
            raise HTTPException(404, "项目不存在")
        docs = db.rows(conn, "SELECT * FROM documents WHERE project_id = ? ORDER BY section_key, title", (pid,))
    section_label = dict(SECTION_KEYS)
    parts = [
        f"# {proj['title']}\n",
        f"- 研究方向：{proj['field']}\n- 核心问题：{proj['problem']}\n- 研究假设：{proj['hypothesis']}\n- 数据集：{proj['dataset']}\n",
    ]
    for d in docs:
        label = section_label.get(d["section_key"], d["kind"])
        parts.append(f"\n\n## {d['title'] or label}  \n*[{label}]*\n\n{d['content']}")
    from fastapi.responses import Response

    return Response(
        "".join(parts),
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename=project-{pid}.md"},
    )


# ---------- static ----------

@app.get("/")
def index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
