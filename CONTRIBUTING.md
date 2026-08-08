# Contributing to PulseRN

Thank you for helping build PulseRN. Start with an issue for substantial features so the design can be discussed before implementation.

## Development workflow

1. Fork the repository and create a focused branch.
2. Install with `pnpm install` (normally under two minutes on a warm package cache).
3. Run `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm lint`, `pnpm test:e2e`, and
   `pnpm release:verify:sdk`.
4. Add tests for behavioral changes.
5. Keep pull requests limited to one user-visible concern.

Discuss substantial features before implementation. Never commit captured application data,
credentials, device identifiers, `.pulsern` archives, or analytics identifiers.

## Code standards

Use strict TypeScript, validated boundaries, small modules, and explicit types. Preserve renderer sandboxing. Avoid `any`, `eval`, and APIs that expose Node primitives to renderer code.

By contributing, you agree that your contribution is licensed under the MIT License.

New contributors can start with issues labeled `good first issue`. A useful first documentation
change can be verified with `pnpm exec prettier --check README.md docs CONTRIBUTING.md`; focused code
changes should run the nearest package test before the full repository checks.

See [compatibility](docs/COMPATIBILITY.md), [support](SUPPORT.md), and the
[security policy](docs/SECURITY.md) before changing a public interface or release boundary.
