# Feature: Project infrastructure and hello world

> Set up the TypeScript + React build toolchain, dev server, GitHub Pages deployment, and a minimal hello world page to validate the full pipeline.

## What

Before building any features, we need the foundational infrastructure: a working TypeScript + React project with a dev server for local development and a production build that deploys to GitHub Pages. The goal is to go from zero to a page visible in a browser — both locally and at the GitHub Pages URL.

This is purely scaffolding. The hello world page just needs to prove the pipeline works end-to-end: write TypeScript + React, see it in the browser locally with hot reload, push to main, and have it show up on GitHub Pages.

## Acceptance Criteria

- [ ] Project has a `package.json` with TypeScript, React, and a bundler configured.
- [ ] `npm install` installs all dependencies.
- [ ] `npm run dev` starts a local dev server with live-reloading/hot module replacement.
- [ ] `npm run build` produces a static production bundle in an output directory.
- [ ] A GitHub Actions workflow builds and deploys the production bundle to GitHub Pages on push to `main`.
- [ ] Visiting the GitHub Pages URL shows a "Hello World" page rendered by React.
- [ ] The hello world page is viewable on a phone browser (no layout issues at mobile widths).

## Scope

### In scope
- Project scaffolding (package.json, tsconfig, bundler config)
- Dev server with hot reload
- Production build
- GitHub Actions workflow for GitHub Pages deployment
- A single React component that renders "Hello World"

### Out of scope
- Firebase setup and optional Google Calendar OAuth
- Any application UI or routing
- CSS framework or design system selection
- Testing infrastructure

## Notes

- The manifesto specifies TypeScript + React, bundled for production, live-transpiled in dev. The specific bundler choice (Vite, etc.) is an implementation detail — pick whatever gets us running fastest.
- Keep the config minimal. We can add linting, testing, and other tooling in later specs as needed.
