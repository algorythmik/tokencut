# tokencut — Product & Technical Design

## Part 1: Product

### Summary

LLM-powered coding tools repeatedly send the same or nearly the same requests during normal development workflows. tokencut exists to intercept those requests, recognize when they are effectively asking for something already asked before, and reuse prior work when it is safe to do so.

The goal is simple: lower cost, lower latency, and better consistency for coding agents without degrading answer quality.

### Problem

Coding agents are expensive in part because they are repetitive.

In practice, an agent often:
- retries the same operation with slightly different wording
- asks repeated repo-specific questions across sessions
- reformulates the same debugging or explanation request
- re-reads similar code contexts to answer closely related questions
- burns tokens on loops that a middleware layer could detect

This creates three immediate problems:
- unnecessary token spend
- slower response times
- repeated low-value traffic to the model

Most coding tools currently treat every request as fresh. That is simple, but wasteful.

### Why Coding First

Coding workflows are a strong first use case because they are naturally iterative and repetitive. A developer or coding agent tends to ask:
- variants of the same bug diagnosis
- repeated file or symbol explanations
- common project questions like how to build, test, or run
- narrow refinements of a prior request

That pattern makes coding a better starting point than general chat. The repetition is more obvious, the intent is often narrower, and the savings are easier to measure.

### Users

Initial users:
- individual developers using coding agents locally
- builders experimenting with OpenAI-compatible model APIs
- power users who want more control over cost and observability

Later users:
- teams running shared coding agent infrastructure
- internal developer platforms
- organizations wanting policy and cost controls across agents

### Jobs To Be Done

Users want to:
- reduce repeated LLM spend during coding
- speed up agent responses when the same intent appears again
- maintain answer quality while avoiding obviously redundant calls
- understand where waste is happening in agent workflows
- preserve privacy by keeping the first version local

### Value Proposition

tokencut should provide:
- lower token usage for repetitive development workflows
- faster answers on repeated or near-duplicate prompts
- more consistent responses to recurring questions
- visibility into repeated prompt patterns
- a path to optimization without requiring changes to the agent itself

The key product promise is not to replace the model. It is to stop paying full price for the same work over and over.

### Why Local-First

Local-first is the right starting point for both product and trust reasons.

It keeps the MVP:
- simpler to build
- easier to adopt
- safer for code privacy
- easier to inspect and debug

It also matches the first user naturally: a single developer already using a coding agent on their own machine.

The long-term product may become a shared team service, but the first product should prove value in the smallest credible environment.

### Example Use Cases

Examples of waste tokencut should target early:
- repeated "explain this error" prompts with minor wording changes
- recurring "how do I run tests or build this repo" questions
- repeated requests to summarize the same file or component
- agent retries that differ only by formatting or phrasing
- repeated questions about the same symbol or stack trace pattern

For VS Code and GitHub Copilot specifically, the safest early use cases are:
- explain the current selection
- summarize the current file or symbol
- diagnose a repeated error or diagnostic pattern
- answer recurring repo questions like build, test, or run commands

These tasks are narrow, repetitive, and easier to scope with editor metadata than fully general chat.

### MVP Scope

The MVP should do a small number of things well:
- run as a local tokencut service with a VS Code extension for GitHub Copilot workflows
- optionally run as a local proxy in front of an OpenAI-compatible API where the client supports custom endpoints
- normalize incoming requests
- detect exact and near-exact duplicate prompts
- search for semantically similar prior requests
- decide conservatively whether to reuse a prior answer
- fall back to the upstream model when confidence is low
- record metrics on savings and match behavior

The MVP is useful even if it only catches obvious repetition.

### Non-Goals

The MVP should not try to:
- become a full agent memory system
- rewrite prompts aggressively
- fabricate responses without a high-confidence basis
- support every model provider on day one
- solve organization-wide multi-tenant deployment immediately
- infer correctness beyond simple freshness and similarity checks

### Success Metrics

Early success should be measured by:
- token savings percentage
- cache hit rate
- semantic reuse hit rate
- latency reduction
- rate of safe fallbacks to live model calls
- false positive rate for reused answers
- number of repeated prompt clusters discovered

### Risks And Assumptions

Core assumptions:
- coding agent workflows are repetitive enough to justify a middleware layer
- semantic reuse can save meaningful tokens without harming output quality
- local-first deployment lowers trust barriers enough for adoption

Core risks:
- false positives produce stale or misleading answers
- request context changes too often for reuse to be safe
- semantic matching adds enough complexity to offset the value
- agents may rely on hidden context that makes prompts look more similar than they really are

### Product Thesis

The thesis behind tokencut is that coding agents waste money in highly patterned ways, and a carefully designed proxy layer can capture a meaningful fraction of that waste before it reaches the model.

The first version does not need to be perfect. It only needs to prove that safe reuse is common enough to matter.

### Open Product Questions

- how visible should reuse be to the user or calling agent?
- should tokencut return reused answers directly, or annotate that a response was reused?
- should users be able to force a fresh answer on any request?
- how much control should users have over reuse thresholds?
- when should tokencut operate silently versus expose a dashboard or logs?

---

## Part 2: Technical Architecture

### System Overview

tokencut is an optimization and policy layer that can be integrated in two ways:

- as a companion VS Code extension plus local service for GitHub Copilot workflows
- as a local proxy for OpenAI-compatible clients that support custom endpoints

At a high level:
1. a client or extension sends a request envelope to tokencut
2. tokencut normalizes and fingerprints the request
3. tokencut checks exact-match and near-match layers
4. tokencut evaluates whether a prior answer is safe to reuse
5. tokencut either returns reused output or requests a live model call
6. the caller either returns reused output directly or invokes the upstream model
7. tokencut stores the result for future matching and analysis

tokencut is an optimization and policy layer, not a model provider.

### Why VS Code Companion Extension First For Copilot

GitHub Copilot inside VS Code is not best treated as a raw OpenAI-compatible endpoint that tokencut can transparently intercept.

For this environment, tokencut should use the supported VS Code extension surface:
- gather editor and workspace context from VS Code
- ask tokencut whether a prior answer is reusable
- call a Copilot-backed model through the VS Code language model APIs only on a miss or unsafe match

This design is stronger than a plain proxy because the extension can attach metadata that an HTTP middleware layer usually cannot infer reliably.

Examples of useful metadata:
- workspace folder
- git revision or dirty state
- active file paths
- selection hash
- symbol names
- diagnostics and error codes
- request kind such as explain, summarize, diagnose, or repo-question

That extra context is what makes safe reuse practical in coding workflows.

### Why OpenAI-Compatible APIs First

OpenAI-compatible APIs are the right MVP integration target because they offer:
- a common wire format
- broad ecosystem compatibility
- a smaller implementation surface
- easier testing against existing agent tools

That lets tokencut focus on matching, reuse, and observability instead of adapter sprawl.

### Why Local-First Architecture

The first architecture should run fully on a developer machine.

Benefits:
- simplest deployment
- lowest privacy friction
- no multi-tenant concerns
- easy inspection of prompts and decisions
- direct fit for solo-agent workflows

The design should still preserve a future path to:
- remote cache storage
- shared indexes
- org-level policy layers
- team-wide reuse analytics

### Request Lifecycle

A request should move through the system roughly like this:

1. Receive a request envelope from the VS Code extension or proxy.
2. Extract prompt content and stable metadata.
3. Normalize the prompt content.
4. Compute an exact-match key.
5. Search the exact cache.
6. If there is no exact hit, run semantic similarity search.
7. Apply reuse policy and freshness checks.
8. If safe, return a reused response with decision metadata.
9. Otherwise, return a miss decision to the caller.
10. The caller invokes the live model path.
11. Store request, response, metadata, and usage outcomes.

For the VS Code path, the caller is the tokencut extension. For the proxy path, the caller is tokencut itself.

### Core Components

The MVP likely needs these components.

#### 1. VS Code Extension

Collects editor context, sends request envelopes to tokencut, renders reused answers, and falls back to a Copilot-backed model call when needed.

#### 2. Local tokencut Service

Owns normalization, matching, reuse decisions, storage, and observability.

#### 3. Optional API Proxy

Accepts OpenAI-compatible requests and forwards them when needed for clients that support custom endpoints.

#### 4. Normalization Pipeline

Transforms prompts into a more matchable form by removing irrelevant variation.

Examples:
- whitespace normalization
- stable serialization of message arrays
- stripping obviously non-semantic noise
- extracting a canonical prompt body

#### 5. Exact Cache

Handles literal or normalized duplicates cheaply and predictably.

#### 6. Semantic Matcher

Finds prior prompts with similar meaning even when wording differs.

#### 7. Reuse Policy Engine

Decides whether a semantic match is safe enough to reuse.

#### 8. Storage Layer

Stores prompts, responses, metadata, and matching statistics.

#### 9. Metrics And Logging Layer

Tracks savings, misses, reuse rates, and decision outcomes.

### VS Code Extension Architecture

The extension should stay thin. It is an integration layer, not the main decision engine.

Recommended responsibilities for the extension:
- register editor commands for high-confidence use cases
- optionally register a chat participant later
- gather workspace and editor metadata
- construct a request envelope for tokencut
- render reuse annotations and fallback results
- provide a force-fresh escape hatch

Recommended first commands:
- explain current selection
- summarize current file
- diagnose current diagnostic or error
- answer how to build, test, or run this repo

Recommended responsibilities for the tokencut service:
- canonicalize prompt and metadata
- perform exact lookup and semantic lookup
- evaluate freshness against repo and file signals
- return either a reusable answer or a miss
- store metrics and inspection logs

This split keeps the extension simple while concentrating the reusable logic in a local service that can later support other clients.

### Request Envelope For VS Code

For the extension path, tokencut should not key only on prompt text. It should key on prompt plus coding context.

Suggested request envelope fields:
- request id
- timestamp
- request kind
- raw user prompt
- normalized prompt
- workspace identifier
- git commit or dirty-state marker
- active file paths
- selected text hash
- symbol identifiers if available
- diagnostics or stack trace fingerprints if available
- model identifier
- force-fresh flag

The envelope should be explicit and inspectable. That makes reuse decisions debuggable.

### Matching Strategy

The matching strategy should be hybrid.

#### Layer 1: Exact Match

Use normalized request text plus selected metadata to detect duplicates.

This is:
- cheap
- easy to reason about
- low risk
- likely valuable immediately

#### Layer 2: Semantic Match

Use embeddings over normalized prompt content to detect near-duplicates and repeated intent.

This catches:
- phrasing differences
- minor reformulations
- repeated agent retries
- common recurring repo questions

#### Layer 3: Metadata-Aware Filtering

Semantic matches should be scoped using metadata such as:
- project or repo identifier
- model name
- file references if known
- session or tool identity
- codebase revision or git commit when available

This reduces bad matches across unrelated contexts.

### Reuse Policy

tokencut should be conservative by default.

A previous answer should only be reused when:
- similarity is above threshold
- the prompt intent appears stable
- referenced code context has not materially changed
- the prior answer is recent enough
- there is no explicit signal requiring freshness

Fallback to upstream should be the default whenever confidence is ambiguous.

A good MVP principle:
- exact matches may be reused directly
- semantic matches should require stricter checks

For the VS Code extension path, the reuse policy should also consider:
- whether the referenced file content hash still matches
- whether the git revision changed since the prior answer
- whether the request kind is stable enough for reuse
- whether diagnostics or runtime output fingerprints still match

In practice, repo questions and static explanations should have looser freshness rules than debugging requests tied to runtime output.

### Safety And Freshness Rules

tokencut should avoid reuse when:
- the request depends on changing source files
- the request contains unique runtime logs or ephemeral state
- the repo has changed significantly since the cached answer
- the prompt references current execution results
- the semantic similarity score is only marginal
- the user or client asks for a fresh result

Freshness matters more in coding than in generic chat because codebases evolve quickly.

### Data Model

The MVP storage model should likely capture the following.

For requests:
- request id
- timestamp
- raw request body
- normalized prompt
- prompt hash
- model identifier
- repo or project identifier
- session identifier if available

For semantic matching:
- embedding vector
- similarity score history
- cluster or grouping metadata

For responses:
- response text
- whether it was reused or upstream-generated
- source request id for reused answers
- token usage if available
- latency

For safety:
- file references if derivable
- codebase version marker such as git commit
- confidence score
- reuse decision reason

### Storage And Indexing

A practical MVP storage stack could be:
- SQLite for structured metadata and request/response records
- a local vector index for embeddings
- filesystem-based logs for debugging if needed

This keeps the first build inspectable and portable. The MVP should avoid requiring a database server.

### Observability

tokencut should expose enough information to answer:
- how many requests were exact hits?
- how many were semantic hits?
- how many were forwarded upstream?
- how many tokens were saved?
- which prompts repeat most often?
- where are false positives happening?

Useful outputs:
- structured logs
- a local metrics endpoint
- a simple CLI or web inspection page later

### Privacy And Security

Because tokencut sees prompts and responses, privacy is central.

The MVP should assume:
- local storage by default
- clear retention settings
- optional disablement of prompt persistence
- explicit awareness that code and outputs may be cached

Future versions may need:
- encryption at rest
- redaction of secrets
- team-level access controls
- policy enforcement around sensitive repos

### MVP Technical Design

The minimal credible architecture is:

1. Local tokencut service with normalization, cache, semantic lookup, and reuse policy.
2. VS Code extension that gathers coding context and calls the local service.
3. Copilot-backed live fallback via the VS Code language model APIs.
4. Exact-match cache backed by SQLite.
5. Embedding generation for cached prompts.
6. Conservative reuse decision logic.
7. Visible reuse annotations and a force-fresh control.
8. Metrics and request inspection logs.

This is enough to validate the thesis without overbuilding.

For non-Copilot clients that support custom endpoints, an OpenAI-compatible proxy remains a useful secondary integration mode.

### Evolution To Team Service

If the local-first MVP works, the next step is not a rewrite but a decomposition.

Local components that can later become shared services:
- vector index
- request history store
- analytics
- policy engine
- admin and observability surface

A future team deployment could support:
- shared prompt reuse across a codebase
- org-level token analytics
- central policy controls
- role-based visibility into reuse and storage

None of that should be required to prove the initial product.

### Design Principles

The architecture should follow a few principles:
- safe reuse beats aggressive reuse
- exact wins before semantic
- local-first before distributed
- transparent decisions beat opaque magic
- fall back to the live model whenever in doubt
- build for coding workflows first, then generalize later

### Open Technical Questions

- what is the best first extension surface: editor commands, code actions, or a chat participant?
- how should the extension expose reused-answer annotations without adding UI noise?
- which VS Code metadata is reliable enough to include by default in the request envelope?
- when should the extension bypass tokencut entirely and force a live model call?
- what exact request shape should tokencut support first: chat completions, responses API, or both?
- should embeddings be generated locally or via an upstream model API?
- how should repo identity be derived reliably?
- how much file-aware context can tokencut infer without deep agent integration?
- what is the right default TTL for reused answers in active codebases?
- should semantic reuse return the old answer directly, or synthesize a compact prompt from prior answers and still call upstream?
