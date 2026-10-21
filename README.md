# Moelections

A static website for published election forecasts, race details, historical context, and artwork. The repository contains the site source and the static files used by the site.

## Run locally

Requirements: Node.js 20.19+ or 22.12+ and npm.

```sh
npm ci
npm run dev
```

Run the type check and build with:

```sh
npm run check
npm run build
```

## GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds and deploys the site when a commit is pushed to `main`, and it can also be run manually. In the repository settings, select **GitHub Actions** as the Pages source.

The default relative path works with a custom domain or a GitHub Pages repository URL. If a fixed repository prefix is needed, set the `PAGES_BASE_PATH` repository variable to a slash-terminated path, such as `/moelections/`.

The static site reads its displayed information from `public/data/` and does not fetch live forecast data when opened.
