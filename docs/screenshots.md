# 📸 Datation Feature & UI Gallery

<p align="center">
  <a href="screenshots.md">English</a> | <a href="screenshots_zh.md">简体中文</a>
</p>

Welcome to the Datation Visual Gallery. Below is a highly accurate, slide-by-slide walkthrough of the 16 screenshot captures from the Datation multi-agent workspace.

---

### 01. Agent Trace Dashboard
The core interface of the Chat session displaying live execution traces. The Supervisor decides to route to `DataAnalyst` to analyze `Pokemon.csv`. The `Planner` lays out the tasks checklist, while the `Executor` reads the file and returns a structured markdown summary of the dataset.
![01_Workspace](screenshots/datation-img1.png)

---

### 02. Agent Workflow Interactive Graph
The visual topology diagram mapping the cooperative relationship of the LangGraph multi-agent network. It highlights the main orchestrator (`Supervisor`) and subgraphs representing worker agents (`SkillExecutor`, `QAAgent`, `ReportGenerator`, `RequirementsAnalyst`, and `DataAnalyst` with its nested ReAct loops).
![02_Requirements](screenshots/datation-img2.png)

---

### 03. Plan Checklist View
A detailed breakdown of the task execution plan, displaying a 100% completed progress bar and a step-by-step checklist. Completed operations include loading skills, reading the file schema, executing computation in the sandbox, and compiling the final markdown analysis chapter.
![03_DemoDB](screenshots/datation-img3.png)

---

### 04. Session File Manager & Image Preview
The workspace's file explorer showing structured generation directories (from `run_1` to `run_8`). Under `run_8`, a generated distribution chart `generation_analysis.png` is highlighted and rendered in the premium side preview panel, showcasing the distribution of weak Pokemon.
![04_Thinking](screenshots/datation-img4.png)

---

### 05. Multi-Agent Token Tracker
A granular token consumption budget dashboard. It highlights total Input/Output token statistics, LLM call counts, and a percentage breakdown grouped by agent components (Executor 73.5%, Generate_Chapter 12.1%, Reviewer 6.8%, Supervisor 3.7%, Planner 2.2%, etc.).
![05_Parsing](screenshots/datation-img5.png)

---

### 06. Renders & Live Streaming Logs Panel
On the left, a beautifully rendered HTML analytical report displaying statistical charts and structured summaries. On the right, the drawer is opened to show real-time stream logs containing the raw JSON payloads of LLM prompt calls and completion results.
![06_Suggestions](screenshots/datation-img6.png)

---

### 07. LLM Model System Configuration
The settings overlay under the "Model" tab. Users can configure the execution target model (e.g. `deepseek-v4-pro`), API endpoint bases, keys, temperature parameters, max token constraints, and toggle full API traffic debugging.
![07_Sandbox](screenshots/datation-img7.png)

---

### 08. Custom MCP Server Config Monaco Editor
The settings panel under the "MCP" tab. An integrated Monaco Code Editor allows developers to configure custom databases (e.g. mounting a PostgreSQL MCP server using `npx -y @modelcontextprotocol/server-postgres`) via a clean JSON config.
![08_Plan](screenshots/datation-img8.png)

---

### 09. Skills Management Dashboard
The settings view under the "Skills" tab. It lists scanned skills cards under `~/.datation/skills` (e.g. `ui-ux-pro-max`, `markdown-to-html`, `contract-review`, `find-skills`) ready to inject expert SOP instructions into the execution loop.
![09_Report](screenshots/datation-img9.png)

---

### 10. Community Skill Marketplace
A community marketplace displaying millions of available expert skills (e.g., `autoreview`, `channel-message-flows`, `clawdtributor` by `openclaw`). It provides a search console, multi-level category navigation, star counts, and one-click install buttons.
![10_Logs](screenshots/datation-img10.png)

---

### 11. General Application Settings
The display configurations view. Users can configure permanent database targets (e.g., PostgreSQL DB connection URIs), enable LangSmith agent tracing, and switch display languages via simple dropdown menus.
![11_Workflow](screenshots/datation-img11.png)

---

### 12. SkillExecutor PPTX Generation Output Trace
A real-world trace in the chat history showing `SkillExecutor` successfully executing a specialized presentation SOP. It outputs a `.pptx` slide deck and its corresponding page-by-page `.svg` source graphics saved under `outputs/`.
![12_Tokens](screenshots/datation-img12.png)

---

### 13. SkillExecutor Edge-TTS Audio Generation Trace
An trace showcasing the `SkillExecutor` utilizing a custom text-to-speech SOP card (`@sundial-org-edge-tts`). It successfully synthesizes the analytical conclusions into an audio file saved at `outputs/pokemon_analysis_tts.mp3` for voice playback.
![13_Settings](screenshots/datation-img13.png)

---

### 14. Command Autocomplete / Shortcut Menu
The chat box autocomplete popover triggered when typing `/` in the input field, allowing users to direct commands and mention specific workers (Supervisor, Requirements Analyst, Data Analyst, Report Generator, QA Agent, Skill Executor).
![14_Marketplace](screenshots/datation-img14.png)

---

### 15. File & Skill Autocomplete / Shortcut Menu
The chat box autocomplete popup triggered when typing `@` in the input field, enabling users to mention uploaded files or reference specialized skills dynamically in conversational prompts.
![15_RollbackRestart](screenshots/datation-img15.png)

---

### 16. Interactive Data Dashboard (HTML)
A fully interactive, standalone HTML data dashboard generated by the `dashboard-design` Agent Skill. Features dark-themed ECharts visualizations including monthly GMV trend charts, category donut breakdowns, customer segmentation panels, and real-time alert modules — all with working tab navigation, dropdown filters, and responsive layout.
![16_Dashboard](screenshots/datation-img16.png)
