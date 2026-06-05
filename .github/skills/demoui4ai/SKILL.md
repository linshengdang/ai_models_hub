---
name: demoui4ai
description: "AI Model Hub full-stack project skill. USE FOR: iterating on the AI provider management UI, chat interface, adding new API formats, modifying provider/model CRUD, updating CSS layout/theme, adding new default providers, extending chat features (streaming, file upload), debugging frontend/backend issues. Covers React+Vite frontend, Node.js+Express backend, file-based JSON config, multi-provider multi-model architecture."
---

# AI Model Hub (demoui4ai) — Project Skill

## Project Overview

Full-stack AI model management + multi-provider chat service. Users configure AI providers (OpenAI, Anthropic, Google, etc.), set API keys (global or per-model), manage models, and chat through a unified interface.

## Tech Stack

| Layer | Tech | Details |
|-------|------|---------|
| Backend | Node.js + Express | ES modules (`"type": "module"`), port 3001 |
| Frontend | React 18 + Vite 5 | Port 5173, proxy `/api` and `/uploads` to backend |
| Storage | File-based JSON | `server/data/config.json` |
| Icons | lucide-react | All icons from this library |
| Styling | Plain CSS | Single `App.css`, CSS variables for theming, light theme |
| Dev runner | concurrently | `npm run dev` starts both server + client |

## Directory Structure

```
demoui4ai/
├── package.json              # Root: concurrently, express, multer, uuid, cors, mime-types
├── server/
│   ├── index.js              # Express app setup, static files, route mounting
│   ├── defaultProviders.js   # 12 default provider templates with real model lists
│   │                         # OpenAI, Anthropic, Google, DeepSeek, Zhipu, Moonshot, Qwen, Baidu, MiniMax, StepFun, Doubao, SiliconFlow, Mistral
│   ├── data/
│   │   └── config.json       # Runtime storage (providers + keys)
│   ├── uploads/              # File uploads for chat
│   └── routes/
│       ├── providers.js      # Provider CRUD, model CRUD, API key management
│       ├── chat.js           # Chat completion → routes to OpenAI/Anthropic/Google/Baidu formats
│       ├── auth.js           # OAuth2 flow: login redirect, callback, token refresh, logout
│       └── files.js          # File upload via multer
├── client/
│   ├── package.json          # React, Vite, react-markdown, remark-gfm, react-syntax-highlighter
│   └── src/
│       ├── main.jsx          # React entry point
│       ├── App.jsx           # Root: 3-page navigation (home/chat/settings), provider+model selectors
│       ├── App.css            # All styles, CSS variables, light theme
│       ├── api.js            # API client functions
│       └── components/
│           ├── WelcomePage.jsx      # Landing page with provider status
│           ├── ProviderManager.jsx  # Left-right split: provider list + detail config
│           ├── ChatView.jsx         # Chat messages + streaming
│           ├── InputBar.jsx         # Message input with file attachment
│           ├── MessageBubble.jsx    # Markdown rendering + code highlighting
│           └── MediaPreview.jsx     # Image/file preview in chat
```

## API Endpoints

### Auth (`/api/auth`) — OAuth/Subscription
| Method | Path | Description |
|--------|------|-------------|
| GET | `/login/:providerId` | Start OAuth flow → redirect to provider login page |
| GET | `/callback/:providerId` | OAuth callback → exchange code for token, store |
| POST | `/refresh/:providerId` | Refresh expired access token |
| DELETE | `/logout/:providerId` | Clear OAuth tokens (revoke auth) |
| GET | `/status/:providerId` | Check OAuth authentication status |
| PUT | `/oauth-config/:providerId` | Save OAuth config (clientId, clientSecret, URLs) |

### Providers (`/api/providers`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/defaults` | Get 10 default provider templates |
| GET | `/` | Get all configured providers (keys masked) |
| POST | `/` | Save/update a provider (preserves modelKeys) |
| PUT | `/:id/key` | Update provider-level API key |
| PUT | `/:id/model-key` | Update model-level API key (`{ modelId, apiKey }`) |
| POST | `/:id/models` | Add model (`{ modelId, name, type }`) |
| DELETE | `/:id/models/:modelId` | Remove a model |
| DELETE | `/:id` | Delete entire provider |
| POST | `/:id/verify` | Verify provider connection |

### Chat (`/api/chat`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/completions` | Send message, routes to correct API format |

### Files (`/api/files`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/upload` | Upload file (multer) |

## Data Model

### Provider (in config.json)
```json
{
  "id": "openai",
  "name": "OpenAI",
  "baseUrl": "https://api.openai.com/v1",
  "authType": "bearer",         // bearer | custom-header | query-key | query-token
  "authHeader": "Authorization", // only for custom-header
  "apiFormat": "openai",        // openai | anthropic | google | baidu
  "billingType": "apikey",      // apikey | subscription | both
  "accessModes": ["apikey", "oauth"],  // supported auth methods
  "apiKey": "sk-xxx...",
  "loginUrl": "https://...",
  "docsUrl": "https://...",
  "subscriptionUrl": "https://...",
  "models": [
    { "id": "gpt-4o", "name": "GPT-4o", "type": "text" }
  ],
  "modelKeys": {
    "gpt-4o": "sk-specific-key..."
  },
  "oauth": {
    "authorizeUrl": "https://...",
    "tokenUrl": "https://...",
    "clientId": "xxx",
    "clientSecret": "xxx",
    "scope": "basic"
  },
  "oauthTokens": {
    "accessToken": "...",
    "refreshToken": "...",
    "expiresAt": 1234567890
  }
}
```

### Model types: `text`, `image`, `video`, `audio`

## Chat Flow

1. Frontend sends `{ providerId, modelId, messages, files }` to `/api/chat/completions`
2. Backend resolves effective auth: model-specific key > provider-level key > OAuth access token
3. Routes to format handler based on `provider.apiFormat`:
   - **openai**: SSE streaming (`text/event-stream`)
   - **anthropic**: SSE streaming with `anthropic-version` header
   - **google**: Non-streaming JSON (`generateContent`)
   - **baidu**: Non-streaming JSON
4. Response streamed/sent back to frontend

## UI Architecture

### Pages (controlled by `page` state in App.jsx)
- **home** → `WelcomePage` — Welcome + provider status chips
- **chat** → `ChatView` — Message list + input bar, provider/model selector in header
- **settings** → `ProviderManager` — Left-right split layout

### ProviderManager Layout
- **Left panel** (280px): Quick add/remove defaults list + configured providers list
- **Right panel** (flex): Selected provider detail — config fields, global API key, auth links, model management with per-model keys

### CSS Convention
- CSS variables in `:root` for theming (e.g. `--accent`, `--bg-primary`, `--border-color`)
- Class prefix `.pm-` for Provider Manager layout
- Class prefix `.pc-` for provider card/detail sections
- All styles in single `App.css` file

## Development Commands

```bash
# Install all dependencies (root + client)
npm run install:all
# If npm cache permission issues:
npm install --cache /tmp/npm-cache-demoui && cd client && npm install --cache /tmp/npm-cache-demoui

# Development (starts both server:3001 + client:5173)
npm run dev

# Production build
npm run build   # builds client to client/dist
npm run start   # builds + starts server serving static files
```

## Key Implementation Notes

1. **API keys are masked** in GET responses — only `****` + last 4 chars sent to frontend
2. **Model-specific keys** take priority over provider-level keys in chat routing
3. **Vite proxy** in `client/vite.config.js` forwards `/api` and `/uploads` to `localhost:3001`
4. **No database** — all data in `server/data/config.json`, read/write with `fs`
5. **No auth** — single-user local tool, no login system
6. **Streaming** uses native `fetch` + `ReadableStream` on frontend for SSE
7. **File uploads** stored in `server/uploads/`, served as static files

## Common Iteration Patterns

### Adding a new default provider
Edit `server/defaultProviders.js`, add a new entry to `defaultProviders` object with all required fields.

### Adding a new API format
1. Add format handler in `server/routes/chat.js` (new function like `handleXxxFormat`)
2. Add routing case in the main completions handler
3. Add `<option>` in ProviderManager's API format `<select>`

### Adding a new feature to the settings page
Edit `client/src/components/ProviderManager.jsx` — the `ProviderDetail` sub-component handles the right panel.

### Modifying styles
All in `client/src/App.css`. Use existing CSS variables. Provider manager styles use `.pm-*` and `.pc-*` prefixes.

### Adding a new API endpoint
1. Add route in the appropriate file under `server/routes/`
2. Add API client function in `client/src/api.js`
3. Call from the relevant component
