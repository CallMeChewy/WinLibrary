# Repository Guidelines

## Project Structure & Module Organization
The active sources live in `AppSource/`: `main.js` hosts the Electron main process, `preload.js` exposes approved APIs, `new-desktop-library.html` and `web-shim.js` handle the renderer UI. Packaging assets and the bundled runtime live under `FrameworkAndDependencies/`, mirroring the AppImage layout; avoid editing binaries there unless you are rebuilding the distribution. User-facing configuration defaults are stored in `FrameworkAndDependencies/squashfs-root/resources/Config/`, and runtime data is expected at `~/OurLibrary/...`.

## Build, Test, and Development Commands
Run `npm install` inside `AppSource/` to install `sqlite3`. For local debugging, launch the app with `npx electron .` from `AppSource/` (Electron must be installed globally or added as a dev dependency). The packaged AppImage can be exercised by executing `FrameworkAndDependencies/squashfs-root/thelibrary`. Regenerate static assets before packaging to keep `resources/` in sync.

## Coding Style & Naming Conventions
Use 2-space indentation in JavaScript and keep statements terminated with semicolons, following the existing sources. Favor `const` and `let` with descriptive camelCase names. Renderer components reside in plain HTML/CSS/JS—group UI helpers near their usages and keep preload bridges minimal. When expanding IPC channels, centralize handlers in `main.js` and expose only whitelisted functions in `preload.js`.

## Testing Guidelines
There are no automated tests yet; prioritize manual smoke checks. After changes, verify startup against a populated `~/OurLibrary` directory and exercise key flows: database status check, book search, file open, and external link handling. Document any new manual test cases in the pull request. If you add automated coverage, colocate tests in `AppSource/__tests__/` and run them via `npm test`.

## Commit & Pull Request Guidelines
Commits use concise, imperative subjects (`Add reader toolbar`). Group related changes and avoid bundling packaging artifacts unless required. PRs should describe the user impact, call out config or schema updates, and attach screenshots/video for UI tweaks. Link to tracking issues and list manual test evidence so reviewers can reproduce your validation.

## Local Configuration Tips
The app expects an `~/OurLibrary` tree with `database/OurLibrary.db` and `user_data/config.json`. Keep sample templates in `resources/Config/` updated, and never commit real credentials; use the `.template` files when new keys are required.
