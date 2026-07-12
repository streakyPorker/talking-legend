# Talking Legend

An LLM-native game where your words shape the world. React frontend + TypeScript backend, with world evolution and NPC dialogue powered by large language models.

## Project Structure

```
talking-legend/
├── shared/          # Shared TypeScript types and utilities
│   └── src/
│       └── index.ts # Game state types, API contracts
├── backend/         # Express + TypeScript API server
│   └── src/
│       ├── index.ts          # Server entry point
│       ├── routes/           # API route handlers
│       ├── services/         # Business logic
│       ├── llm/              # LLM client abstraction
│       └── utils/            # Shared utilities
├── frontend/        # React + Vite + TypeScript
│   └── src/
│       ├── App.tsx           # Root component
│       ├── components/       # React components
│       ├── services/         # API client
│       └── index.css         # Base styles
└── package.json     # Workspace root
```

## Getting Started

### Prerequisites
- Node.js >= 18
- npm >= 9

### Install
```bash
npm install
```

### Development
```bash
# Start both frontend and backend
npm run dev

# Or start individually
npm run dev:backend   # http://localhost:3001
npm run dev:frontend  # http://localhost:3000
```

### Build
```bash
npm run build
```

### Test
```bash
npm run test
```

## Environment Variables

Create a `.env` file in the root with:

```env
LLM_PROVIDER=anthropic    # or openai
LLM_API_KEY=your-api-key
LLM_MODEL=claude-sonnet-4-6
LLM_BASE_URL=             # optional, for custom endpoints
PORT=3001                 # backend port
```
