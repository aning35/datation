---
name: contract-review
description: "提供标准化的合同与文档审查 SOP。当用户上传合同、协议或其他法律文件，要求审查风险、漏洞、合规性或提供修改建议时，必须严格遵从此流程读取并执行审查。"
---
# Contract Review Standard Operating Procedure (SOP)

This skill dictates how the Autonomous Agent should conduct deep contract reviews, identify risks, and suggest modifications.

## Workflow
When tasked with reviewing a contract or legal document, you MUST follow this sequence:

1. **Understand & Translate**: 
   - Identify the contract type (e.g., employment, NDA, service, lease).
   - Identify the user's role (e.g., employee, contractor, buyer, seller).
   - Determine the jurisdiction (if specified) and any specific concerns raised by the user.

2. **Context Gathering (Extraction)**: 
   - Use `LocalFileReader` to read the entire text of the provided contract document. If it is a PDF or Word document, the reader will automatically convert it to Markdown for you.
   
3. **Deep Dive & Clean (Risk Analysis)**:
   Review the contract against the following standard risk profiles. Pay close attention to red flags and missing elements.

   ### 🔴 High Risk (Red Flags)
   - **Unlimited Liability**: Look for "unlimited liability", "full indemnification", or no liability cap.
   - **Broad IP Assignment**: Look for "all intellectual property", "work product", "inventions" belonging to the company without carve-outs for pre-existing or personal time IP.
   - **Unilateral Termination**: Look for "at will", "unilateral termination", "sole discretion" favoring only one party.
   - **One-Sided Indemnification**: Look for obligations where only the user indemnifies the other party.
   - **Broad Rights Waiver**: Look for "waive all claims", "forever discharge".
   - **Missing Data Protection**: Absence of data protection/privacy clauses (GDPR/CCPA) where personal data is involved.

   ### 🟡 Medium Risk (Yellow Flags)
   - **Auto-Renewal Trap**: "automatically renew", "unless written notice" without a reasonable opt-out window.
   - **Excessive Penalty**: "liquidated damages" or "forfeit" that exceed reasonable damages.
   - **Broad Non-Compete**: Look for non-compete clauses that are too long (e.g., > 1 year) or broad geographically. (Note: Non-competes are largely void in California).
   - **Perpetual Confidentiality**: Obligations that never expire instead of standard 3-5 years.
   - **Unfavorable Jurisdiction/Payment Terms**: Far away arbitration venues, or net-90 payment cycles.

   ### 🟢 Low Risk (Worth Noting)
   - **Missing Audit Rights**: No right to inspect records or verify compliance.
   
   ### ✅ Completeness Check
   Verify presence of: Parties, Effective Date, Term/Duration, Scope, Compensation, Termination, Confidentiality, IP, Liability, Governing Law, Signatures.

4. **Identify Root Causes / Provide Recommendations**: 
   For every risk found, provide a concrete recommendation or negotiation strategy (e.g., "Add liability cap at 12 months of fees", "Limit non-compete to 1 year and specific state").

5. **Formulate Evidence Chain**: 
   Draft your response findings and cite the exact section numbers or quotes from the contract to back up your assessment. Report the findings to the Planner to proceed to the Report Generator phase.

## Guidelines
- **Always verify assumptions**: Do not hallucinate clauses. If you can't read the file, declare the step failed and request assistance.
- **Not Legal Advice**: Always include a disclaimer stating that your analysis is for informational purposes and does not constitute formal legal advice.
- **Fail Gracefully**: If the text extraction is garbled, use Self-Correction to try and extract it again or ask the user for a plaintext version.
