# PHAROS frontend

Frontend foundation using React, Vite, TypeScript, and Tailwind CSS. No PHAROS features or backend integration are implemented yet.

## Development

Use Node.js 24 LTS and npm.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. On Windows PowerShell, use `npm.cmd` instead of `npm` if script execution policy blocks `npm.ps1`.

```sh
npm run build
npm run preview
```

The build command checks TypeScript and creates a production build in `dist/`.

## Structure

- `src/main.tsx`: React entry point
- `src/App.tsx`: minimal foundation placeholder
- `src/index.css`: Tailwind import and base styles
- `vite.config.ts`: React and Tailwind plugins
- `tsconfig*.json`: application and Vite configuration type checking

Work on `feature/pharos-frontend`. The existing StudySpace project is preserved on `master`; do not merge its unrelated history into this branch. Backend and student tools are developed separately.
