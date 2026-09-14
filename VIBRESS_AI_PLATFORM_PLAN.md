# VIBRESS — CONTENT-AWARE AI PLATFORM EVOLUTION PLAN
## From Isolated Prompt Proxy to Coherent Publishing Intelligence

---

## 1. Audit of Current AI Implementation

### Architecture Overview
Vibress currently implements an AI gateway in `packages/domains/ai`:
- **Provider Interface**: `AiProvider` interface with unified methods:
  - `generateCompletion(prompt, options)`
  - `streamCompletion(prompt, options)`
  - `generateJson(prompt, schema, options)`
- **Supported Providers**:
  - `OpenAiProvider` (OpenAI API / compatible endpoints)
  - `AnthropicProvider` (Claude Messages API)
  - `GeminiProvider` (Google Gemini REST API)
  - `DeepSeekProvider` (DeepSeek chat completions)
  - `OllamaProvider` (Local self-hosted LLM endpoints)
  - `DeterministicTestProvider` (Mock provider for reproducible integration testing)
- **Circuit Breaker**: `AiGatewayService` tracks consecutive provider failures. If a provider fails 5 times within 60 seconds, the breaker trips to open state for 60 seconds.
- **Audit Logging**: Persists request timestamp, actor ID, provider, model, input token estimate, output token count, and duration into the `ai_audit_logs` PostgreSQL table.

### Deficiencies & Architectural Limits
1. **Isolated Features vs Platform**: Current AI features are fragmented prompt wrappers (`apps/api/src/routes/ai.ts`) executing one-off text transformations (`inline`, `summary`, `title`, `translate`). There is no overarching publishing intelligence platform.
2. **Zero Content Awareness**: The AI engine has no awareness of:
   - The publication's editorial guidelines or brand voice.
   - The publication's custom content models and schemas.
   - Existing post taxonomy, related articles, or internal link graph.
   - Multilingual glossaries and translation memory.
3. **Transient In-Memory State**: Rate limits (`userRequestTimestamps`) and monthly token budgets (`totalUsedTokens`) are stored in JavaScript heap variables. Replicating API pods or restarting the container wipes all budget counters to zero.
4. **No Publication-Scoped Key Management**: All AI requests use global environment variables (`OPENAI_API_KEY`, etc.). Individual publications cannot provide their own API keys or configure custom models.

---

## 2. Target Architecture: Content-Aware Publishing Platform

```
┌────────────────────────────────────────────────────────────────────────┐
│                          STUDIO / ADMIN / API                          │
│   Inline Assist  •  Metadata Gen  •  Translation  •  Social Adaptor   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   CONTENT AWARENESS CONTEXT ENGINE                     │
│                                                                        │
│   ┌───────────────────────┐             ┌──────────────────────────┐   │
│   │ Publication Context   │             │ Document Context Engine  │   │
│   │ • Brand Voice / Tone  │             │ • Full Lexical Tree      │   │
│   │ • Editorial Rules     │             │ • Content Model Schema   │   │
│   │ • Prohibited Words    │             │ • Current Heading State  │   │
│   └───────────┬───────────┘             └─────────────┬────────────┘   │
│               │                                       │                │
│               ├───────────────────────────────────────┤                │
│               │                                       │                │
│   ┌───────────▼───────────┐             ┌─────────────▼────────────┐   │
│   │ Knowledge Graph       │             │ Multilingual Memory      │   │
│   │ • Internal Link Graph │             │ • Publication Glossary   │   │
│   │ • Related Entity Tags │             │ • Translation Memory TM  │   │
│   └───────────────────────┘             └──────────────────────────┘   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Hydrated Prompt Context
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        AI GATEWAY & GOVERNANCE                         │
│  • Redis Rate Limiter & Token Budgeting per Publication                │
│  • Provider Failover & Cost Router (Ollama → OpenAI → Anthropic)       │
│  • Streaming SSE Output to Studio Editor                               │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                          EXTERNAL LLM PROVIDERS                        │
│             Anthropic  •  OpenAI  •  Gemini  •  Ollama / Local         │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Database Design for AI Governance & Context

```sql
-- 1. Publication AI Configuration & Quotas
CREATE TABLE publication_ai_settings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  default_provider TEXT NOT NULL DEFAULT 'openai', -- 'openai' | 'anthropic' | 'gemini' | 'ollama'
  default_model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  custom_api_key_encrypted TEXT, -- Encrypted via @vibress/security
  monthly_token_budget INTEGER NOT NULL DEFAULT 500000,
  monthly_tokens_consumed INTEGER NOT NULL DEFAULT 0,
  budget_reset_at TIMESTAMPTZ NOT NULL,
  brand_voice_prompt TEXT, -- e.g. "Authoritative, clear, journalistic tone. No marketing fluff."
  editorial_rules JSONB DEFAULT '[]', -- Array of custom rules
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pub_ai_settings_unique UNIQUE (publication_id)
);

-- 2. Prompt Template Registry
CREATE TABLE ai_prompt_templates (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type TEXT NOT NULL, -- 'seo_meta', 'summary', 'social_snippet', 'alt_text', 'inline_expand'
  system_prompt TEXT NOT NULL,
  user_template TEXT NOT NULL,
  model_params JSONB DEFAULT '{"temperature": 0.3, "maxTokens": 1000}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 4. Content-Aware Capabilities Roadmap

### 4.1 Document Context Engine
- Instead of passing raw unformatted strings, the context engine parses the active Lexical document tree:
  - Extracts the main title, excerpt, preceding paragraphs, and target block location.
  - Determines section depth and headings hierarchy.
  - Generates completions that match the stylistic rhythm and formatting conventions of the document.

### 4.2 Brand Voice & Editorial Compliance
- Administrators define the publication's brand voice in Settings:
  - E.g., *"Write in an objective, concise, Bloomberg-style journalistic tone. Avoid hyperbolic adjectives (revolutionary, game-changing). Address readers professionally."*
- Every prompt automatically injects this persona into the LLM system instructions.

### 4.3 Automated SEO & Structured Content Intelligence
- **Automatic Alt Text**: AI vision model inspects uploaded images in `MediaLibrary` and generates WCAG 2.2-compliant accessible alt descriptions.
- **Smart Excerpts & Meta Descriptions**: Extracts key thesis points to craft optimal 155-character meta descriptions.
- **Internal Link Recommendations**: Matches document topics against existing published articles in PostgreSQL and suggests contextual internal hyperlinks to boost SEO authority.

### 4.4 Social Media & Newsletter Adaptation
- One-click transformation: Converts a long-form article into:
  - An engaging Twitter/X thread with appropriate hooks.
  - A LinkedIn executive brief.
  - An email newsletter edition formatted with personalized subscriber tokens.

---

## 5. Distributed Rate Limiting & Cost Controls

1. **Redis Token Bucket**:
   - Every request increments `vibress:ai:tokens:<publicationId>:<YYYY-MM>` in Redis atomically.
   - If `tokens_used > monthly_budget`, the gateway rejects with HTTP 402 `AI_BUDGET_EXCEEDED` before invoking external APIs.
2. **Provider Failover Waterfall**:
   - Primary: Fast/efficient model (e.g. `gpt-4o-mini` or local `ollama`).
   - Secondary (if primary rate-limited or trips circuit breaker): Automatic fallback to Claude 3.5 Sonnet or Gemini 1.5 Pro.
3. **Prompt Injection Hardening**:
   - User inputs are framed inside strict delimiters (`<user_content>...</user_content>`).
   - System instructions explicitly forbid executing directives found within document text.
