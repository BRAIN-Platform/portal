---
title: Using the BRAIN API
description: Programmatic access to BRAIN models via the OpenAI-compatible REST API
---

# Using the BRAIN API

**BRAIN — BRookhAven INference** provides programmatic access to open-weight
large language models (LLMs) and embedding models hosted on-site at Brookhaven
National Laboratory. The service exposes an OpenAI-compatible REST API, allowing
you to integrate BRAIN into scripts, notebooks, data pipelines, and custom
applications using standard HTTP requests or existing OpenAI client libraries.

This guide covers authentication, available endpoints and models, making
requests with `curl` and Python, and troubleshooting. For interactive
conversations, see the [chat guide](chat.md); for connecting coding assistants,
see the [coding agents guide](agents.md).

> **Access** — BRAIN is available only on the BNL network or through the BNL
> VPN. Sign in with your Brookhaven Lab account to manage API keys.
>
> **Data handling** — Prompts, inputs, and model outputs remain on BNL
> infrastructure and are never sent to external model providers.

### BRAIN endpoints

| Resource | URL |
|---|---|
| Chat Interface | [`https://chat.brain.bnl.gov`](https://chat.brain.bnl.gov) |
| API Service | [`https://api.brain.bnl.gov`](https://api.brain.bnl.gov) |
| API Key Manager | [`https://api.brain.bnl.gov/km/`](https://api.brain.bnl.gov/km/) |

---

## 1. Overview & Interactive API Documentation

The BRAIN API Service ([BRAIN Endpoints](#brain-endpoints)) is powered by **LiteLLM**
and serves an interactive **Swagger UI** when opened in a web browser. Using the
Swagger UI, you can browse endpoint schemas, inspect query parameters and request
bodies, and test API calls directly in your browser:

1. Open the **BRAIN API Service URL** ([BRAIN Endpoints](#brain-endpoints))
   in your browser (while on the BNL network or BNL VPN).
2. Select **Authorize** at the top right and enter your API key (`Bearer
   <your-brain-api-key>`).
3. Expand an endpoint — for example, `GET /v1/models` under 
   [**model management** in Swagger UI](https://api.brain.bnl.gov/#/model%20management)
   — and click **Try it out** → **Execute**.

### Core Endpoints

While the Swagger UI exposes the full LiteLLM proxy specification (including
administrative and pass-through routes), most client applications only need the
following core endpoints:

| Method &amp; Path | Purpose |
|---|---|
| `GET /v1/models` | List model IDs currently available to your key (OpenAI-compatible). |
| `GET /v1/model/info` | Return detailed model metadata (context window, mode, supported parameters). |
| `POST /v1/chat/completions` | Generate text, code, or multimodal chat responses (supports streaming). |
| `POST /v1/responses` | OpenAI Responses API endpoint (used by newer SDK workflows and tools such as Codex CLI). |
| `POST /v1/embeddings` | Generate vector embeddings for semantic search and retrieval-augmented generation (RAG). |

> **Base URL note** — OpenAI SDKs and compatible clients that append endpoint
> paths use `<brain-api-service-url>/v1` as their base URL. Raw HTTP requests
> use `<brain-api-service-url>` and include the full `/v1/...` path.

---

## 2. Obtain a BRAIN API Key

Generate an API key in the **BRAIN API Key Manager** ([BRAIN Endpoints](#brain-endpoints))
and export it as `BRAIN_API_KEY` in your shell environment. For step-by-step
setup, verification, and security guidelines, see
[Obtaining and Configuring a BRAIN API Key](api-key.md).

All HTTP requests to the BRAIN API authenticate with the `Authorization` header:

```text
Authorization: Bearer $BRAIN_API_KEY
```

---

## 3. Discover Available Models

### 3.1 List Available Models

Query the OpenAI-compatible `/v1/models` endpoint to see the exact `id` values
available to your key:

```bash
curl -sS https://api.brain.bnl.gov/v1/models \
  -H "Authorization: Bearer $BRAIN_API_KEY" | python3 -m json.tool
```

If `curl` fails with `SSL certificate problem` (`curl: (60)`) on an older Linux
distribution or Conda environment, update your local CA certificates (or pass
`-k` temporarily to test connectivity; see
[Troubleshooting](#7-troubleshooting)).

Example response structure:

```json
{
  "object": "list",
  "data": [
    {
        "id": "gemma-4-26b",
        "object": "model",
        "created": 1677610602,
        "owned_by": "openai",
        "max_input_tokens": 262144
    },
    {
        "id": "nemotron-3-ultra-550b-nvfp4",
        "object": "model",
        "created": 1677610602,
        "owned_by": "openai",
        "max_input_tokens": 524288
    },
  ]
}
```

The `/v1/models` endpoint also accepts optional query parameters documented in
the Swagger UI, such as:

- `include_metadata=true` — include fallback and routing metadata in the
  response (with optional `fallback_type` set to `general`, `context_window`, or
  `content_policy`).
- `healthy_only=true` — filter out models whose deployments are currently marked
  unhealthy by background health checks.
- `return_wildcard_routes` / `team_id` / `include_model_access_groups` — filter
  or annotate models by route or access group.

> **Important** — The available model set changes over time. For a summary of
> current models and capabilities by modality, see **Available models** on the
> BRAIN landing page, and always treat the live `/v1/models` response as the
> authoritative list of model IDs for API calls.

### 3.2 Detailed Model Information

As noted in the Swagger UI for `/v1/models` (which refers to the unprefixed
alias `/model/info`), use `/v1/model/info` or `/v2/model/info` when you need
detailed model configuration such as mode (`chat`, `embedding`), context window
limits, or supported parameters.

To list metadata for all available models, call `/v1/model/info` without query
parameters:

```bash
curl -sS https://api.brain.bnl.gov/v1/model/info \
  -H "Authorization: Bearer $BRAIN_API_KEY" | python3 -m json.tool
```

> **Note** — On `GET /v1/model/info` (and its unprefixed alias `/model/info`),
> the optional `litellm_model_id` parameter expects LiteLLM's internal
> deployment UUID (`model_info.id`), not the model name returned by
> `/v1/models`. Passing a model name to `litellm_model_id` returns a
> `not found on litellm proxy` error — leave `litellm_model_id` blank unless
> querying by internal UUID.

To inspect a specific model by its public name from `/v1/models`, use
`/v2/model/info` with the `model` query parameter:

```bash
curl -sS "https://api.brain.bnl.gov/v2/model/info?model=muse-glimmer-30b" \
  -H "Authorization: Bearer $BRAIN_API_KEY" | python3 -m json.tool
```

---

## 4. Making Requests with `curl`

### 4.1 Chat Completions

Send a `POST` request to `/v1/chat/completions` with the target `model` and a
`messages` array:

```bash
curl -sS https://api.brain.bnl.gov/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $BRAIN_API_KEY" \
  -d '{
    "model": "gemma-4-26b",
    "messages": [
      {
        "role": "system",
        "content": "You are a concise scientific computing assistant."
      },
      {
        "role": "user",
        "content": "Explain the difference between HDF5 and Zarr in three bullets."
      }
    ],
    "temperature": 0.2,
    "max_tokens": 512
  }' | python3 -m json.tool
```

The assistant reply text is returned in `choices[0].message.content`.

### 4.2 Streaming Responses

Set `"stream": true` and pass `-N` (`--no-buffer`) to `curl` to receive tokens
as Server-Sent Events (SSE) as they are generated:

```bash
curl -N -sS https://api.brain.bnl.gov/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $BRAIN_API_KEY" \
  -d '{
    "model": "nemotron-3-super-120b",
    "messages": [
      {
        "role": "user",
        "content": "Write a Python function to compute a moving average with NumPy."
      }
    ],
    "stream": true
  }'
```

Each line arrives prefixed with `data: ` followed by a JSON delta chunk, ending
with `data: [DONE]`.

### 4.3 Embeddings

Send text inputs to `/v1/embeddings` using the embedding model
`nomic-embed-text`:

```bash
curl -sS https://api.brain.bnl.gov/v1/embeddings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $BRAIN_API_KEY" \
  -d '{
    "model": "nomic-embed-text",
    "input": "Synchrotron X-ray diffraction beamline calibration"
  }' | python3 -m json.tool
```

The returned vector is located in `data[0].embedding`.

---

## 5. Using the Python OpenAI SDK

Because BRAIN exposes an OpenAI-compatible API, you can use the official
`openai` Python package by pointing `base_url` to
`https://api.brain.bnl.gov/v1`:

```bash
pip install openai
```

Create a reusable client that reads `BRAIN_API_KEY` from the environment:

```python
import os
from openai import OpenAI

client = OpenAI(
    base_url="https://api.brain.bnl.gov/v1",
    api_key=os.environ["BRAIN_API_KEY"],
)
```

### 5.1 Basic Chat Completion

```python
import os
from openai import OpenAI

client = OpenAI(
    base_url="https://api.brain.bnl.gov/v1",
    api_key=os.environ["BRAIN_API_KEY"],
)

response = client.chat.completions.create(
    model="nemotron-3-super-120b",
    messages=[
        {"role": "system", "content": "You are a helpful research assistant."},
        {"role": "user", "content": "Summarize how Bragg's law relates wavelength and angle."},
    ],
    temperature=0.2,
    max_tokens=512,
)

print(response.choices[0].message.content)
```

### 5.2 Streaming Output

Enable `stream=True` to print tokens incrementally — especially useful for
longer answers or reasoning models:

```python
import os
from openai import OpenAI

client = OpenAI(
    base_url="https://api.brain.bnl.gov/v1",
    api_key=os.environ["BRAIN_API_KEY"],
)

stream = client.chat.completions.create(
    model="nemotron-3-super-120b",
    messages=[
        {"role": "user", "content": "Draft a short docstring for a data loader class."},
    ],
    stream=True,
)

for chunk in stream:
    delta = chunk.choices[0].delta.content
    if delta:
        print(delta, end="", flush=True)
```

### 5.3 Multi-Turn Conversations

The API is stateless: maintain conversation history by appending each assistant
reply and subsequent user prompt to the `messages` list:

```python
import os
from openai import OpenAI

client = OpenAI(
    base_url="https://api.brain.bnl.gov/v1",
    api_key=os.environ["BRAIN_API_KEY"],
)

messages = [
    {"role": "system", "content": "You are a Python code reviewer."},
    {"role": "user", "content": "Why should I avoid mutable default arguments in Python?"},
]

first = client.chat.completions.create(model="gemma-4-26b", messages=messages)
assistant_reply = first.choices[0].message.content
print("Assistant:", assistant_reply)

messages.append({"role": "assistant", "content": assistant_reply})
messages.append({"role": "user", "content": "Show a brief before/after example."})

second = client.chat.completions.create(model="gemma-4-26b", messages=messages)
print("Assistant:", second.choices[0].message.content)
```

### 5.4 Vision (Image Analysis)

Vision-capable models such as `gemma-4-26b` and `muse-glimmer-30b` accept
base64-encoded images inside `image_url` content parts.

If you don't already have a local `plot.png` to test with, generate a sample
plot first (`pip install matplotlib`):

```bash
python3 -c '
import matplotlib.pyplot as plt
plt.plot([1, 2, 3, 4, 5], [2, 4, 7, 11, 16], marker="o")
plt.title("Detector Count Rate vs. Beam Current")
plt.xlabel("Beam Current (mA)")
plt.ylabel("Count Rate (kHz)")
plt.grid(True)
plt.savefig("plot.png", dpi=100, bbox_inches="tight")
'
```

Then send `plot.png` to a vision-capable model:

```python
import base64
import os
from pathlib import Path
from openai import OpenAI

client = OpenAI(
    base_url="https://api.brain.bnl.gov/v1",
    api_key=os.environ["BRAIN_API_KEY"],
)

image_bytes = Path("plot.png").read_bytes()
image_b64 = base64.b64encode(image_bytes).decode("utf-8")

response = client.chat.completions.create(
    model="gemma-4-26b",
    messages=[
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Describe the trend and axes shown in this plot."},
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{image_b64}"},
                },
            ],
        }
    ],
)

print(response.choices[0].message.content)
```

### 5.5 Generating Embeddings

Pass a single string or a list of strings to `client.embeddings.create` using
`nomic-embed-text`:

```python
import os
from openai import OpenAI

client = OpenAI(
    base_url="https://api.brain.bnl.gov/v1",
    api_key=os.environ["BRAIN_API_KEY"],
)

texts = [
    "Beamline detector calibration procedure",
    "Python asyncio task orchestration",
]

result = client.embeddings.create(
    model="nomic-embed-text",
    input=texts,
)

for idx, item in enumerate(result.data):
    print(f"Item {idx}: {len(item.embedding)} dimensions")
```

---

## 6. Common Request Parameters

The `/v1/chat/completions` endpoint supports standard OpenAI chat completion
parameters (check `supported_openai_params` via
[`/v1/model/info` or `/v2/model/info`](#32-detailed-model-information)
for per-model support):

| Parameter | Type | Description |
|---|---|---|
| `model` | `string` (required) | Exact model `id` returned by `/v1/models`. |
| `messages` | `array` (required) | Ordered list of message objects with `role` (`system`, `developer`, `user`, `assistant`, `tool`) and `content` (`string` or multimodal part `array`; optional on `assistant` tool-call turns). |
| `temperature` | `number` | Sampling randomness (typically `0.0`–`2.0`). Use lower values (e.g. `0.0`–`0.3`) for deterministic code or extraction tasks. |
| `top_p` | `number` | Nucleus sampling threshold (`0.0`–`1.0`); usually adjust either `temperature` or `top_p`, not both. |
| `max_tokens` / `max_completion_tokens` | `integer` | Maximum number of tokens to generate in the completion (including reasoning tokens on reasoning models). |
| `reasoning_effort` | `string` | Reasoning budget (`"low"`, `"medium"`, or `"high"`) on models that support adjustable reasoning effort (such as `gpt-oss-120b`). |
| `stream` | `boolean` | When `true`, streams incremental response chunks over SSE instead of waiting for the full completion. |
| `tools` / `tool_choice` | `array` / `string \| object` | `tools` defines JSON Schema functions for tool calling; `tool_choice` (`"auto"`, `"none"`, `"required"`, or a specific tool object) controls whether and which tool is called. |
| `response_format` | `object` | Structured output constraint such as `{"type": "json_object"}` or `{"type": "json_schema", "json_schema": ...}`, where supported by the model. |

> **Tip** — Reasoning models spend tokens thinking (often emitted in
> `reasoning_content`) before producing the final answer in `content`. If
> responses are truncated or `content` is empty (`finish_reason: "length"`),
> increase or omit `max_tokens` / `max_completion_tokens`. To avoid long waits
> or client timeouts while the model reasons, enable `stream=True`.

---

## 7. Troubleshooting

### Verify Connectivity and Authentication

Run this one-line status check to test network access and your API key:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://api.brain.bnl.gov/v1/models \
  -H "Authorization: Bearer $BRAIN_API_KEY"
```

- **200** — BRAIN is reachable and your API key is valid.
- **401 / 403** — The API key is missing, invalid, or expired. Verify
  `BRAIN_API_KEY` or generate a new key (see
  [Obtaining and Configuring a BRAIN API Key](api-key.md)).
- **404** — The endpoint path is wrong (for example, missing or duplicated
  `/v1`). Check your `base_url` configuration.
- **400 / 422** — Invalid request payload, unsupported parameter for the
  selected model, or prompt exceeding the model's context window.
- **`000` with `curl: (60) SSL certificate problem`** — Your local CA bundle is
  outdated and missing the server's root CA certificate (common on older Linux
  distributions or Conda environments). Update your system `ca-certificates`
  package (or point `CURL_CA_BUNDLE` / `SSL_CERT_FILE` to an updated bundle);
  pass `-k` (`--insecure`) to `curl` only as a temporary check to confirm
  connectivity.
- **No response / timeout** — You are likely outside the BNL network. Connect
  to the BNL VPN and try again.

### Common Client Issues

| Symptom | Likely Cause | Fix |
|---|---|---|
| `openai` SDK returns `404 Not Found` | `base_url` is missing `/v1` | Set `base_url="https://api.brain.bnl.gov/v1"` when initializing `OpenAI(...)`. |
| `401 Unauthorized` despite exporting key | Key was exported in a different shell or contains whitespace | Verify `[ -n "$BRAIN_API_KEY" ]` in the same shell running your script (see the [API key guide](api-key.md#2-set-brain_api_key-in-your-shell)). |
| SSL error (`CERTIFICATE_VERIFY_FAILED` or `curl: (60)`) | Outdated OS, Conda, or Python CA bundle missing a required root certificate | Update system `ca-certificates` and Python `certifi` (`pip install -U certifi`), or point `SSL_CERT_FILE` / `CURL_CA_BUNDLE` to an updated CA bundle (use `curl -k` only for temporary connectivity checks). |
| Model not found error | Model ID changed or is misspelled | Query `GET /v1/models` and copy the exact `id` field. |
| Image request fails | Model does not support vision inputs | Switch to a vision-capable model such as `gemma-4-26b` or `muse-glimmer-30b`. |
| Context length exceeded | Prompt plus `max_tokens` exceeds model limit | Shorten input, lower `max_tokens`, or choose a larger-context model via `/v1/model/info`. |
| Slow initial response | Reasoning model or large prompt | Enable `stream=True` to receive tokens progressively, or try a faster model like `gemma-4-26b`. |
| **Swagger UI**: `api_base is not allowed in request body` | Swagger UI pre-fills optional schema fields such as `"api_base": "string"` | Remove `api_base` (and other unused placeholder fields such as `api_key`) from the JSON request body. |
| **Swagger UI**: `LLM Provider NOT provided` | Swagger UI pre-fills `"custom_llm_provider": "string"`, overriding the proxy's configured provider | Remove `custom_llm_provider` from the JSON request body (or set it to the model's configured provider from `/v1/model/info`). |

### Reporting a Problem

If an API issue persists, use the **Contact Support** link in the footer of the
BRAIN landing page. Include the endpoint path, model `id`, HTTP status code,
error message, and a minimal reproducible request. **NEVER include your
`BRAIN_API_KEY` or any other sensitive data in your message.**

---

## Quick-Reference Checklist

Use this as a pre-flight check before making API requests:

- [ ] Connected to the BNL network (or BNL VPN)
- [ ] API key generated at the **BRAIN API Key Manager**
- [ ] `BRAIN_API_KEY` set securely in your shell ([API key guide](api-key.md#2-set-brain_api_key-in-your-shell))
- [ ] `base_url` configured to the **BRAIN API Service URL** ([BRAIN Endpoints](#brain-endpoints)), with `/v1` appended for OpenAI SDKs
- [ ] Model `id` verified against `GET /v1/models`
- [ ] Verified important generated code, citations, or scientific claims before use
