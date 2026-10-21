import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const base = process.env.BASE_PATH || "./";
const outputDirectory = process.env.OUT_DIR || "build";
const projectRoot = dirname(fileURLToPath(import.meta.url));

function currentSnapshotDatePlugin() {
  return {
    name: "moelections-current-snapshot-date",
    transformIndexHtml(html: string) {
      const currentPath = resolve(projectRoot, "public/data/current.json");
      const current = JSON.parse(readFileSync(currentPath, "utf8")) as { snapshot_date?: unknown };
      const snapshotDate = typeof current.snapshot_date === "string" ? current.snapshot_date : "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) {
        throw new Error("public/data/current.json must include snapshot_date in YYYY-MM-DD format.");
      }
      const date = new Date(snapshotDate + "T00:00:00Z");
      if (Number.isNaN(date.valueOf())) throw new Error("The current forecast snapshot_date is invalid.");
      const formattedDate = new Intl.DateTimeFormat("en-US", {
        year: "numeric", month: "long", day: "numeric", timeZone: "UTC"
      }).format(date);
      return html
        .replaceAll("__SNAPSHOT_DATE__", formattedDate)
        .replaceAll("__SNAPSHOT_ISO_DATE__", snapshotDate);
    }
  };
}

export default defineConfig({
  base,
  publicDir: "public",
  plugins: [currentSnapshotDatePlugin()],
  build: {
    outDir: outputDirectory,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(projectRoot, "index.html"),
        race: resolve(projectRoot, "race.html"),
        methodology: resolve(projectRoot, "methodology.html"),
        dailyChanges: resolve(projectRoot, "daily-changes.html"),
        performance: resolve(projectRoot, "performance.html"),
        gallery: resolve(projectRoot, "gallery.html"),
        states: resolve(projectRoot, "states.html"),
        guide: resolve(projectRoot, "site-guide.html")
      }
    }
  }
});
