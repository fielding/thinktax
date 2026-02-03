# Contributing to thinktax

Thanks for your interest in contributing! This document covers the development setup, code style, and PR process.

## Development Setup

### Prerequisites

- Node.js 20+
- npm

### Getting Started

```bash
# Clone the repo
git clone https://github.com/yourusername/thinktax.git
cd thinktax

# Install dependencies
npm install

# Build
npm run build

# Run in development (watch mode)
npm run dev
```

### Running Tests

```bash
npm test
```

### Project Structure

```
thinktax/
├── src/
│   ├── cli.ts              # Main CLI entry point
│   ├── cli/
│   │   └── utils.ts        # CLI formatting utilities
│   ├── collectors/
│   │   ├── claude.ts       # Claude Code collector
│   │   ├── codex.ts        # Codex CLI collector
│   │   └── cursor.ts       # Cursor collector
│   └── core/
│       ├── aggregate.ts    # Aggregation engine
│       ├── config.ts       # Config loading
│       ├── cost.ts         # Costing engine
│       ├── paths.ts        # XDG-compliant paths
│       ├── pricing.ts      # Pricing table loader
│       ├── state.ts        # Sync state management
│       └── storage.ts      # JSONL read/write
├── pricing/
│   └── models.json         # Model pricing data
├── sketchybar/
│   ├── items/              # Sketchybar item definitions
│   ├── plugins/            # Sketchybar plugin scripts
│   ├── install.sh          # Installation script
│   └── uninstall.sh        # Uninstallation script
├── tests/
│   └── *.test.ts           # Test files
└── config.sample.toml      # Sample configuration
```

## Code Style

### TypeScript

- Use TypeScript strict mode (enabled in `tsconfig.json`)
- Prefer `interface` over `type` for object shapes
- Use explicit return types for exported functions
- Avoid `any` - use `unknown` and narrow with type guards

### Formatting

- 2 spaces for indentation
- No semicolons (project uses no-semi style)
- Single quotes for strings

### Naming

- `camelCase` for variables and functions
- `PascalCase` for types and interfaces
- `SCREAMING_SNAKE_CASE` for constants

### Comments

- Use JSDoc for exported functions
- Inline comments for non-obvious logic
- No TODO comments in PRs (open issues instead)

## Making Changes

### Branch Naming

- `feat/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation
- `refactor/description` - Code refactoring

### Commit Messages

Use conventional commits:

```
feat: add support for GPT-5 pricing
fix: handle empty JSONL files gracefully
docs: update configuration examples
refactor: extract pricing lookup logic
```

### Pull Request Process

1. **Fork** the repository
2. **Create a branch** from `main`
3. **Make your changes** with tests
4. **Run tests** locally: `npm test`
5. **Push** to your fork
6. **Open a PR** against `main`

### PR Requirements

- [ ] Tests pass
- [ ] New code has tests (if applicable)
- [ ] Documentation updated (if applicable)
- [ ] No breaking changes (or clearly documented)

## Adding a New Collector

To add support for a new LLM provider:

1. Create `src/collectors/newprovider.ts`
2. Implement the collector function:
   ```typescript
   export async function collectNewProvider(config: Config): Promise<UsageEvent[]> {
     // Discover and parse usage data
     // Return normalized UsageEvent array
   }
   ```
3. Add to `src/cli.ts` refresh command
4. Add config options to `config.sample.toml`
5. Add pricing data to `pricing/models.json`
6. Add tests

## Updating Pricing

Model pricing is stored in `pricing/models.json`:

```json
{
  "provider-name": {
    "model-name": {
      "in": 0.001,
      "out": 0.002,
      "cache_read": 0.0001,
      "cache_write": 0.00025
    }
  }
}
```

Prices are per 1M tokens. To update:

1. Find official pricing from provider
2. Update `pricing/models.json`
3. Add a note in the PR about the source

## Questions?

Open an issue for questions about contributing. We're happy to help!
