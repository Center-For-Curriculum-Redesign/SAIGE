Okay, here's an executive summary focusing on the novel and impressive aspects, suitable for a README.md and geared towards highlighting innovation for potential reviewers:

---

## Executive Summary: SAIGE - AI Education Research Assistant

SAIGE is a specialized AI assistant framework designed to support educators and researchers by providing high-fidelity, research-backed insights. Operating under the Center for Curriculum Redesign, its primary goal is to bridge the gap between educational practice and peer-reviewed research findings.

**Key Features:**

1.  **Multi-Stage Retrieval-Augmented Generation (RAG) with LLM Curation and scaffolded reasoning:**  SAIGE employs a novel, scalable, multi-stage retrieval and reasoning process. The LLM is first leveraged to generate multiple *hypothetical relevant text excerpts* for nuanced vector searching across a large corpus (100k+ articles via PostgreSQL/pgvector). Retrieved results are then pre-ranked based on relevance, cross-query/granularity consistency, and recency. Critically, *multiple followup (user-outlined or LLM-driven) curation steps* evaluate each result's contextual relevance and utility (`KEEP-3/2/1`, `EXPAND`, `INVESTIGATE`, `DISCARD`) before deciding whether to continue investigating or synthesize the final, research-informed response. This multi-layered approach significantly enhances the quality and reliability of the retrieved information presented to the user. Work is ongoing in letting the LLM define its own epistemically appropriate scaffolding based on context.

2.  **In-Stream Structured Reasoning & Tool Use:** SAIGE utilizes a system of XML-like `meta-tags` (e.g., `<meta-search>`, `<meta-thought>`, `<meta-decision>`, `<meta-citation>`) embedded directly within the LLM's conversational flow. These tags are parsed in real-time by a `FilteredFeed` system, allowing early branching whenever the assistant signals intention to perform searches or reason in parallel. The tag system is modular and extensible, so as to provide robust control over tool use and complex reasoning patterns without strict reliance on specific model function-calling APIs, offering greater flexibility.

3.  **Modular & Stateful Reasoning Engine:** The core logic is managed by a `PromptCoordinator` orchestrating `AnalysisNode` components. These nodes represent distinct stages of reasoning or action (e.g., determining search necessity, generating queries, curating results, formulating the final response). This modular architecture enables the implementation of complex, stateful workflows that adapt based on the conversational context and intermediate results, moving beyond simple prompt-response cycles.

4.  **Integrated "Thought" Processes:** The system explicitly models internal reasoning steps as `ThoughtHistories`, linked to the main conversation messages but distinct from the user-visible dialogue. This allows the AI to maintain an internal scratchpad (via `<meta-thought>` or dedicated `AnalysisNode` outputs), fostering more complex problem-solving and providing potential for greater transparency into the AI's process, which can be optionally surfaced in the UI.

5.  **Branching Conversation Model & Real-time UI:** The underlying `Convo` and `MessageHistories` structure supports branching dialogues, allowing exploration of alternative responses or AI reasoning paths. The frontend (EJS/JS) utilizes Server-Sent Events (SSE) for real-time updates, reflecting AI generation progress, state changes (e.g., "thinking," "searching"), and the dynamic structure of the conversation, including thought visibility toggles.

**System Architecture:**

Built on Node.js with Express, SAIGE interfaces with external language models and a PostgreSQL/pgvector database for its research corpus. The frontend uses vanilla JavaScript and EJS templates, communicating with the backend via SSE for a dynamic user experience.

In essence, SAIGE demonstrates a novel approach to building specialized AI assistants by combining advanced RAG techniques with sophisticated prompt engineering, modular reasoning, and transparent internal state management, specifically targeting the high-stakes domain of educational research support.
