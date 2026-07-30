# Contributing to PulseRN

Thank you for helping build PulseRN. Start with an issue for substantial features so the design can be discussed before implementation.

## Development workflow

1. Fork the repository and create a focused branch.
2. Install with `pnpm install`.
3. Run `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm lint`.
4. Add tests for behavioral changes.
5. Keep pull requests limited to one phase or concern.

Do not add instrumentation from a future roadmap phase to a current-phase change without an accepted design. Never commit captured application data, credentials, device identifiers, or `.rndebug` files.

## Code standards

Use strict TypeScript, validated boundaries, small modules, and explicit types. Preserve renderer sandboxing. Avoid `any`, `eval`, and APIs that expose Node primitives to renderer code.

By contributing, you agree that your contribution is licensed under the MIT License.
