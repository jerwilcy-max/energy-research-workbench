# 能源电力科研工作台 (Energy × AI Research Workbench)

面向**能源电力数据 + AI**研究方向的全流程科研工作平台。灵感来自 [OpenScience](https://github.com/synthetic-sciences/openscience)（开源 AI 科研工作台）的产品形态：一个项目贯穿 文献调研 → 选题设计 → 实验研究 → 论文写作 → 修改投稿 的完整科研生命周期。

## 功能

- **项目管理**：新建研究项目，填写研究方向、核心科学问题、研究假设与可用数据集；项目按科研阶段推进。
- **全流程提示词库**：内置 **39 条**专业提示词，覆盖：
  - 前期调研：领域全景扫描、文献检索策略、文献精读对比矩阵、研究空白识别、数据集与基准调研、文献综述写作、政策产业背景、技术成熟度评估
  - 选题与设计：选题凝练、科学问题与假设、技术路线图、创新点打磨、方案评审自查、论文故事线
  - 实验研究：实验方案设计、电力数据预处理、结果解读、误差与案例分析、可视化设计、实验卡住诊断、实验记录整理
  - 论文写作：摘要、引言、相关工作、方法、实验设置、结果分析、讨论与局限、结论、题目与关键词、全文一致性审校
  - 修改与投稿：学术润色、期刊选择、Cover Letter、审稿意见回复、图表格式终审、影响力延伸
- **提示词已嵌入领域知识**：GEFCom/ETT/PJM/ENTSO-E 等基准数据集、PatchTST/iTransformer/TimesNet 等时序 SOTA 基线、MAE/RMSE/MAPE/Pinball/PICP/PINAW 指标体系、尖峰/爬坡/极端天气场景分析、IEEE TSG/TPWRS/Applied Energy 及电力系统自动化/电网技术/中国电机工程学报等投稿阵地。
- **自定义模型接口**：在「模型设置」填入任意 **OpenAI 兼容**接口（Base URL + API Key + 模型名）即可，支持流式输出。兼容 OpenAI / DeepSeek / 通义千问 / Moonshot / 智谱 / Ollama / vLLM / One-API 等。
- **提示词变量自动填充**：`{论文题目}` `{研究方向}` `{具体问题}` `{研究假设}` `{数据集}` 自动带入项目信息，其余变量在使用时填参。
- **项目文档**：AI 回答一键存为文档（按 摘要/引言/方法/结果/结论 等章节归类），整项导出 Markdown。
- **对话历史**：每个项目的对话按项目归档，新对话自动携带最近上下文。

## 快速开始

```bash
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

打开 http://localhost:8000 → 「模型设置」配置模型 → 「工作台」新建项目。

## 配置项（环境变量）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `WORKBENCH_DB` | `data/workbench.db` | SQLite 数据库路径 |
| `WORKBENCH_TOKEN` | （空=不启用） | 设置后所有 `/api/*` 需要 `x-workbench-token` 头或 `?token=` 参数，公开部署时建议启用 |

## 目录结构

```
app/main.py          FastAPI 应用与 API
app/model.py         OpenAI 兼容接口客户端（流式）
app/db.py            SQLite 持久层
app/prompts_seed.py  内置提示词库（领域知识核心）
static/              单页应用（原生 JS，无构建步骤）
```

## 提示词自定义

在「提示词库」页可新建/编辑/删除提示词。正文中用 `{变量名}` 定义占位符；`{论文题目}` `{研究方向}` `{具体问题}` `{研究假设}` `{数据集}` `{输入内容}` 为约定变量。
