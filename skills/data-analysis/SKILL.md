---
name: data-analysis
description: "提供标准化、深度的业务数据洞察分析SOP体系。当用户提出需要从数据中寻找原因或总结规律(如'为何流失率较高')时，智能体必须严格遵从此流程去指挥执行层抽取、清洗并推理结论。"
---
# Data Analysis Standard Operating Procedure (SOP)

This skill dictates how the Autonomous Agent should conduct deep data analysis and root cause inference.

## Workflow
When tasked with a data analysis objective, you MUST follow this sequence:
1. **Understand & Translate**: Define the core business metric in question (e.g. churn rate, order volume).
2. **Context Gathering (Extraction)**: Use `PostgreSQL_MCP_Query` to fetch the macro trends. If necessary, use `LocalFileReader` to read supplemental configuration or logs to form a complete context.
3. **Deep Dive & Clean**: Use the `DataComputationSandbox` to perform calculations, aggregations, and correlations. Ensure your calculations are verifiable and logically sound.
4. **Identify Root Causes**: Do not just present data. Cross-reference internal metrics (e.g. user engagement drops) with external proxy factors. 
5. **Formulate Evidence Chain**: Summarize your insights mapped directly to the extracted facts.

## Guidelines
- **Always verify assumptions**: No "Hallucinations". If data is empty or missing, explicitly declare that step failed and report back to Planner for recovery.
- **Provide Actionable Insights**: Ensure your final report gives concise, step-by-step remediation plans based on the numbers discovered.
- **Fail Gracefully**: If a specific column does not exist, use Self-Correction mechanism to issue another schema fetch command rather than giving up completely.
