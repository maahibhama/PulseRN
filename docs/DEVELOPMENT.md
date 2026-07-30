# Development

Use Node 22 LTS and pnpm 10.14.

```bash
pnpm install
pnpm dev:desktop
pnpm --filter @pulse-rn/example-react-native dev
```

Workspace packages build before dependents through Turborepo. Persistence uses the `node:sqlite` API bundled with Electron, so contributors do not need to rebuild a third-party native addon.

The desktop database is stored under Electron's platform-specific `userData` directory, not in the repository.

Electron currently labels its bundled `node:sqlite` API experimental and may print that warning on startup. The database is local and disposable during Phase 1; schema access remains isolated behind `EventDatabase` so the implementation can be replaced without changing the transport or renderer.
