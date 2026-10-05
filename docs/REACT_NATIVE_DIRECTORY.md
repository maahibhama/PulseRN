# React Native Directory evaluation

This document records the evidence used to evaluate `@pulse-rn/sdk` for submission to
[React Native Directory](https://github.com/react-native-community/directory#how-do-i-add-a-library).
It describes the proposed entry and local validation only. Directory acceptance remains an upstream
maintainer decision.

## Eligibility review

| Requirement                     | Result                | Evidence                                                                                                                                                                                                     |
| ------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Published npm package           | Pass                  | [`@pulse-rn/sdk@1.0.7`](https://www.npmjs.com/package/@pulse-rn/sdk) is public.                                                                                                                              |
| Public GitHub source            | Pass                  | The SDK source is in [`packages/sdk`](https://github.com/maahibhama/PulseRN/tree/main/packages/sdk).                                                                                                         |
| Package metadata                | Pass                  | The package declares its name, description, repository directory, homepage, bugs URL, MIT license, entry points, exports, files, keywords, and Node engine.                                                  |
| Repository package path         | Pass after correction | The monorepo root is private, so the proposed `githubUrl` targets `packages/sdk` rather than the root. `ci:validate` verifies that package path against npm.                                                 |
| Android and iOS                 | Pass                  | The SDK README documents React Native CLI and Expo development-build usage, and the repository includes an [Android/iOS example](https://github.com/maahibhama/PulseRN/tree/main/apps/example-react-native). |
| Development-tool classification | Pass                  | PulseRN is a local debugger, and production SDK connections remain disabled unless explicitly enabled.                                                                                                       |
| Example                         | Pass                  | The proposed entry links the maintained React Native example above.                                                                                                                                          |

The entry intentionally does not claim `expoGo`, web, Windows, macOS, tvOS, visionOS, Fire OS,
HarmonyOS, Horizon OS, or Vega OS support. It also omits `configPlugin`: the SDK has no Expo config
plugin. Although the compatibility guide documents New Architecture support, the Directory guidance
says to set `newArchitecture` manually only when automatic detection fails, so the proposal leaves
that field to the validator.

## Proposed upstream entry

```json
{
  "githubUrl": "https://github.com/maahibhama/PulseRN/tree/main/packages/sdk",
  "npmPkg": "@pulse-rn/sdk",
  "examples": ["https://github.com/maahibhama/PulseRN/tree/main/apps/example-react-native"],
  "ios": true,
  "android": true,
  "dev": true
}
```

## Validation

Run from a current checkout of `react-native-community/directory` after appending the entry to
`react-native-libraries.json`:

```sh
bun install --frozen-lockfile
bun data:validate
bun data:test
CI_CHECKS_TOKEN=<github-token> bun ci:validate
bun oxfmt react-native-libraries.json --check
bun lint
```

The schema, duplicate/format, new-entry npm/GitHub consistency, formatting, and repository lint
checks all pass. The first new-entry run against the monorepo root correctly failed because that
`package.json` is private; targeting `packages/sdk` resolved the failure without changing published
metadata.

## Upstream status

The package was submitted in
[react-native-community/directory#2758](https://github.com/react-native-community/directory/pull/2758).
Passing local validation and opening that pull request do not mean the package has been accepted.
Update this document only after the upstream result is known.
