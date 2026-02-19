# Contributing to perspective-core

Thank you for your interest in contributing! `perspective-core` is an open-source project and we welcome contributions of all kinds — bug fixes, new adapters, documentation improvements, tests, and feature ideas.

---

## How to Contribute

### 1. Fork & Clone

```bash
git clone https://github.com/<your-username>/perspective-core.git
cd perspective-core
npm install
```

### 2. Create a Branch

```bash
git checkout -b my-feature
```

### 3. Make Your Changes

- Write clear, well-typed TypeScript
- Follow existing code patterns and naming conventions
- Add or update tests for any new functionality
- Keep commits focused and atomic

### 4. Validate

```bash
# Run the test suite
npm test

# Type checking
npm run typecheck

# End-to-end learning loop
npm run test:e2e
```

### 5. Submit a Pull Request

Push your branch and open a PR against `main`. In the PR description:
- Describe **what** you changed and **why**
- Link any related issues
- Note if this is a breaking change

---

## What Can I Contribute?

### 🔌 New Adapters (highest impact)

The most valuable contribution is a new `IExecutionAdapter`. This extends the framework to a new domain. See [`docs/creating-an-adapter.md`](docs/creating-an-adapter.md) for the full guide.

Ideas:
- `LLMToolAdapter` — LLM function-calling as an execution engine
- `GitHubActionsAdapter` — wraps GitHub Actions workflow runs
- `AWSLambdaAdapter` — invoke Lambda functions with learning
- `DatabaseMigrationAdapter` — wrap migration tools (Flyway, Prisma, etc.)
- `KubernetesAdapter` — kubectl / helm operations with policy injection

### 🧪 Tests

More test coverage is always welcome. Current areas:
- `tests/memory/` — memory store operations
- `tests/learner/` — recipe extraction and policy promotion
- `tests/torque/` — strategy analysis

### 📖 Documentation

- Improve existing docs
- Add examples and tutorials
- Write adapter-specific guides

### 🐛 Bug Fixes

Check the [issue tracker](https://github.com/DDMX2022/perspective-core/issues) for open bugs. If you find a new one, please open an issue first so we can discuss.

### 💡 Feature Ideas

Open an issue with the `enhancement` label. Describe the use case and how it fits into the learning loop.

---

## Code Style

- **Language**: TypeScript (strict mode)
- **Module system**: ESM (`"type": "module"`)
- **Naming**: camelCase for variables/functions, PascalCase for types/classes, UPPER_SNAKE for constants
- **Interfaces**: prefix with `I` (e.g., `IExecutionAdapter`, `IMemoryStore`)
- **Exports**: each module has an `index.ts` barrel export
- **Error handling**: use structured error signatures, not raw throws
- **Dependencies**: minimal — avoid adding new deps unless essential

---

## Project Structure

```
src/
  adapters/      # Execution engine integrations
  cli/           # slc command-line interface
  config/        # Environment and runtime config
  learner/       # Fix recipe extraction + policy promotion
  memory/        # SQLite store (runs, events, errors, recipes, policies)
  orchestrator/  # Core run lifecycle
  telemetry/     # Structured event capture
  torque/        # Strategy analysis engine
  types/         # All shared interfaces
tests/           # Jest test suites
scripts/         # E2E and utility scripts
docs/            # Guides and documentation
```

---

## Commit Messages

Use clear, descriptive commit messages:

```
feat: add KubernetesAdapter with pod exec support
fix: error classifier now handles multi-line stack traces
docs: add adapter authoring tutorial
test: add policy promotion edge case tests
chore: update dependencies
```

---

## Reporting Issues

When opening an issue, include:
- **What happened** vs. **what you expected**
- Steps to reproduce
- Node.js and npm versions
- Any relevant error output or logs

---

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold it.

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
