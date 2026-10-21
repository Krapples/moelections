import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(root, process.argv[2] || "build");
const basePath = process.env.BASE_PATH || "./";
const pages = ["index.html", "race.html", "methodology.html", "daily-changes.html", "performance.html", "gallery.html", "states.html", "site-guide.html"];
const required = [...pages, "favicon.png", "data/current.json", "data/candidates.json", "data/generic-ballot-polls.json", "data/race-retrospectives.json", "data/snapshots/index.json", "artwork/manifest.json", "artwork/brand/logo.webp"];
const assertFile = relative => {
  const target = path.resolve(output, relative);
  if (!target.startsWith(output + path.sep) && target !== output) throw new Error("Build path escapes output directory: " + relative);
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) throw new Error("Build is missing " + relative);
};
for (const relative of required) assertFile(relative);

function localTarget(page, raw) {
  if (!raw || raw.startsWith("#") || /^(?:https?:|mailto:|tel:|data:|javascript:)/i.test(raw)) return null;
  let value = raw.split(/[?#]/, 1)[0];
  if (!value) return null;
  if (value.startsWith("/")) {
    const prefix = basePath.startsWith("/") ? basePath : "";
    value = prefix && value.startsWith(prefix) ? value.slice(prefix.length) : value.replace(/^\/+/, "");
  }
  else value = path.posix.normalize(path.posix.join(path.posix.dirname(page), value));
  return value;
}

for (const page of pages) {
  const html = fs.readFileSync(path.join(output, page), "utf8");
  for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    const target = localTarget(page, match[1]);
    if (target && fs.existsSync(path.join(output, ...target.split("/"))) === false) throw new Error(page + " points to missing local file " + match[1]);
  }
}

const current = JSON.parse(fs.readFileSync(path.join(output, "data/current.json"), "utf8"));
const governorDistribution = current.summary?.governor_seat_distribution;
if (!governorDistribution || governorDistribution.race_count !== 36 || !Array.isArray(governorDistribution.central_50_range) || !Array.isArray(governorDistribution.central_90_range) || !governorDistribution.interpretation?.includes("independent")) {
  throw new Error("The built Governor outlook is missing its 36-race distribution and interpretation.");
}
const governorCalls = current.races.filter(race => race.office === "Governor");
const rawDemCalls = governorCalls.filter(race => Number(race.dem_margin_pp) > 0).length;
const rawRepCalls = governorCalls.length - rawDemCalls;
if (governorCalls.length !== 36 || governorDistribution.raw_margin_dem_favored_races !== rawDemCalls || governorDistribution.raw_margin_rep_favored_races !== rawRepCalls || current.summary?.seat_outlooks?.Governor?.dem_favored_races !== rawDemCalls || current.summary?.seat_outlooks?.Governor?.rep_favored_races !== rawRepCalls || !governorDistribution.interpretation?.includes("not a party-control probability")) {
  throw new Error("The built Governor hard-call totals must match margin signs, and its seat range must be described as a race-count range rather than a control probability.");
}
const candidateData = JSON.parse(fs.readFileSync(path.join(output, "data/candidates.json"), "utf8"));
if (candidateData.schema_version !== 1 || candidateData.license?.spdx !== "CC-BY-SA-4.0" || !candidateData.attribution || !Array.isArray(candidateData.races)) {
  throw new Error("Built candidate data is missing its schema, attribution, license, or race entries.");
}
const candidatesByRace = new Map(candidateData.races.map(race => [race.race_id, race]));
if (candidatesByRace.size !== current.races.length || candidateData.races.length !== current.races.length) {
  throw new Error("Candidate data must contain exactly one entry for every published race.");
}
for (const race of current.races) {
  const listing = candidatesByRace.get(race.race_id);
  if (!listing || listing.office !== race.office || listing.state !== race.state || !Array.isArray(listing.candidates) || !listing.candidates.length || !/^https:\/\//.test(listing.source_url)) {
    throw new Error("Candidate data is missing a valid listing for " + race.race_id + ".");
  }
  if (!listing.candidates.every(candidate => typeof candidate.name === "string" && candidate.name.trim() && typeof candidate.party === "string" && candidate.party.trim())) {
    throw new Error("Candidate data contains an incomplete name or party for " + race.race_id + ".");
  }
}
const priorHistory = current.prior_error_history || {};
const validationYears = [2018, 2020, 2022, 2024];
const validationYearSet = new Set(validationYears);
const historical = current.historical_performance || {};
if (historical.snapshot_date !== current.snapshot_date || JSON.stringify(historical.cycles) !== JSON.stringify(validationYears) || !Array.isArray(historical.metrics)) {
  throw new Error("The public historical scorecard must match the current snapshot and four validation cycles.");
}
const expectedPooledRaces = {House:1598, Senate:122, Governor:94};
for (const office of ["House", "Senate", "Governor"]) {
  const officeRows = historical.metrics.filter(row => row.office === office);
  const cycles = officeRows.map(row => String(row.cycle));
  if (JSON.stringify(cycles) !== JSON.stringify([...validationYears.map(String), "Pooled"])) {
    throw new Error("The public scorecard must include each validation year and a pooled row for " + office + ".");
  }
  for (const row of officeRows) {
    if (!Number.isInteger(Number(row.races)) || Number(row.races) <= 0 || ![row.margin_mae_pp, row.brier_score, row.log_loss, row.accuracy].every(value => Number.isFinite(Number(value)))) {
      throw new Error("The public scorecard has incomplete metrics for " + office + " " + row.cycle + ".");
    }
  }
  const pooled = officeRows.find(row => row.cycle === "Pooled");
  if (Number(pooled?.races) !== expectedPooledRaces[office]) throw new Error("The public pooled scorecard has unexpected race coverage for " + office + ".");
}
for (const [office, seriesMap] of [["House", priorHistory.districts || {}], ["Senate/Governor", priorHistory.state_office_forecasts || {}]]) {
  for (const [raceKey, series] of Object.entries(seriesMap)) {
    const errorRows = series.errors_by_cycle || [];
    for (const row of errorRows) {
      const year = Number(row.year);
      if (!validationYearSet.has(year)) throw new Error("Prior-error history includes a nonvalidation year for " + office + " " + raceKey + ": " + row.year + ".");
      if (row.history_basis === "California peer average") {
        if (office !== "House" || raceKey !== "CA-34" || row.actual_margin_pp !== null || row.predicted_margin_pp !== null || !Number.isInteger(row.peer_race_count) || row.peer_race_count <= 0 || !Number.isFinite(row.signed_error_pp) || !Number.isFinite(row.absolute_error_pp) || row.absolute_error_pp < 0) {
          throw new Error("The CA-34 peer-average error must remain a validated peer summary without district outcomes.");
        }
        continue;
      }
      if (![row.actual_margin_pp, row.predicted_margin_pp, row.signed_error_pp, row.absolute_error_pp].every(Number.isFinite) || Math.abs(row.predicted_margin_pp - row.actual_margin_pp - row.signed_error_pp) > 1e-8 || Math.abs(Math.abs(row.signed_error_pp) - row.absolute_error_pp) > 1e-8) {
        throw new Error("Prior-error history margins and errors do not reconcile for " + office + " " + raceKey + " " + year + ".");
      }
    }
    const priorRows = errorRows.filter(row => Number(row.year) < 2026 && validationYearSet.has(Number(row.year)));
    const priorAverage = series.prior_averages_by_target_election?.["2026"];
    if (priorRows.length) {
      const expectedMae = priorRows.reduce((sum, row) => sum + Number(row.absolute_error_pp), 0) / priorRows.length;
      const expectedBias = priorRows.reduce((sum, row) => sum + Number(row.signed_error_pp), 0) / priorRows.length;
      const expectedRaceCount = priorRows.reduce((sum, row) => sum + Number(row.peer_race_count || row.race_count || 1), 0);
      const observationCount = Number(priorAverage?.prior_observation_count ?? priorAverage?.prior_cycle_count);
      if (!priorAverage || Math.abs(Number(priorAverage.prior_average_absolute_error_pp) - expectedMae) > 1e-8 || Math.abs(Number(priorAverage.prior_average_signed_error_pp) - expectedBias) > 1e-8 || observationCount !== priorRows.length || Number(priorAverage.prior_race_count) !== expectedRaceCount) {
        throw new Error("Prior-error averages do not match the validation-only rows for " + office + " " + raceKey + ".");
      }
    } else if (priorAverage && (Number(priorAverage.prior_observation_count ?? priorAverage.prior_cycle_count) !== 0 || priorAverage.prior_average_absolute_error_pp !== null || priorAverage.prior_average_signed_error_pp !== null)) {
      throw new Error("Prior-error averages include data when there are no eligible validation rows for " + office + " " + raceKey + ".");
    }
  }
}
const retrospective = JSON.parse(fs.readFileSync(path.join(output, "data/race-retrospectives.json"), "utf8"));
if (retrospective.schema_version !== 1 || retrospective.snapshot_date !== current.snapshot_date || !retrospective.races || Object.keys(retrospective.races).length !== current.races.length) {
  throw new Error("Race retrospective coverage does not match the current snapshot.");
}
for (const race of current.races) {
  const history = retrospective.races[race.race_id];
  if (!history || history.office !== race.office || history.state !== race.state || !Array.isArray(history.historical_rows) || !history.current_polling) {
    throw new Error("Race retrospective is missing structured history for " + race.race_id + ".");
  }
  for (const row of history.historical_rows) {
    const year = Number(row.year);
    if (!validationYearSet.has(year)) throw new Error("Race retrospective includes a nonvalidation year for " + race.race_id + " " + row.year + ".");
    if (race.office !== "House" && row.forecast_error_status !== "validation") throw new Error("Senate/Governor race history is not marked as validation for " + race.race_id + " " + row.year + ".");
    if (row.history_basis === "California peer average") {
      if (row.actual_margin_pp !== null || row.predicted_margin_pp !== null || !Number.isInteger(row.peer_race_count)) {
        throw new Error("Peer history must not present individual CA-34 outcomes or forecasts.");
      }
    } else {
      if (![row.actual_margin_pp, row.predicted_margin_pp, row.signed_error_pp].every(Number.isFinite) || Math.abs(row.predicted_margin_pp - row.actual_margin_pp - row.signed_error_pp) > 1e-8) {
        throw new Error("Historical forecast margins and signed errors do not reconcile for " + race.race_id + " " + row.year + ".");
      }
    }
    if (row.poll_average_margin_pp !== null && !Number.isFinite(row.poll_average_margin_pp)) throw new Error("A historical poll mean is not finite for " + race.race_id + ".");
    if (row.poll_miss_pp !== null && (!Number.isFinite(row.poll_miss_pp) || row.poll_average_margin_pp === null || Math.abs(row.poll_average_margin_pp - row.actual_margin_pp - row.poll_miss_pp) > 1e-8)) {
      throw new Error("A historical poll average error does not reconcile for " + race.race_id + " " + row.year + ".");
    }
  }
}
const genericPolls = JSON.parse(fs.readFileSync(path.join(output, "data/generic-ballot-polls.json"), "utf8"));
if (!Array.isArray(genericPolls.polls) || genericPolls.polls.length < 2 || new Set(genericPolls.polls.map(poll => poll.source)).size !== genericPolls.polls.length) {
  throw new Error("The built generic-ballot polling data must include at least two distinct polling sources.");
}
if (!genericPolls.polls.every(poll => Number.isFinite(poll.dem_pct) && Number.isFinite(poll.rep_pct) && /^https:\/\//.test(poll.source_url))) {
  throw new Error("The built generic-ballot polling data contains an invalid topline or source URL.");
}
const snapshotDate = current.snapshot_date;
if (typeof snapshotDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) throw new Error("Built current data is missing a valid snapshot date.");
const snapshotLabel = new Intl.DateTimeFormat("en-US", { year:"numeric", month:"long", day:"numeric", timeZone:"UTC" }).format(new Date(snapshotDate + "T00:00:00Z"));
for (const page of pages) {
  const html = fs.readFileSync(path.join(output, page), "utf8");
  if (html.includes("__SNAPSHOT_")) throw new Error(page + " contains an unexpanded snapshot date placeholder.");
  const dateTags = [...html.matchAll(/<time\b[^>]*data-snapshot-date[^>]*datetime="([^"]+)"[^>]*>([^<]*)<\/time>/g)];
  if (!dateTags.length || dateTags.some(match => match[1] !== snapshotDate || match[2] !== snapshotLabel)) {
    throw new Error(page + " does not show the current JSON snapshot date consistently.");
  }
  const datedMetadata = [...html.matchAll(/<meta\b[^>]*data-snapshot-meta="[^"]+"[^>]*content="([^"]*)"/g)];
  if (datedMetadata.some(match => !match[1].includes(snapshotLabel))) {
    throw new Error(page + " contains metadata that does not match the current snapshot date.");
  }
}
const expectedRaceCounts = {House:435, Senate:35, Governor:36};
const raceCounts = Object.fromEntries(Object.keys(expectedRaceCounts).map(office => [office, current.races.filter(row => row.office === office).length]));
const raceIds = new Set(current.races.map(row => row.race_id));
if (current.races.length !== 506 || raceIds.size !== current.races.length || Object.entries(expectedRaceCounts).some(([office, count]) => raceCounts[office] !== count)) {
  throw new Error("Built current data must contain 435 House, 35 Senate, and 36 Governor races with unique IDs.");
}
for (const row of current.races) {
  const district = Number.parseInt(String(row.district || "0"), 10);
  const expectedId = row.office === "House"
    ? "house-" + String(row.state).toLowerCase() + "-" + String(Number.isFinite(district) ? district : 0).padStart(2, "0")
    : String(row.office).toLowerCase() + "-" + String(row.state).toLowerCase();
  if (row.race_id !== expectedId) throw new Error("Built race ID is not stable for " + row.office + " " + row.state + ".");
  const margin = Number(row.dem_margin_pp);
  const probability = Number(row.dem_probability);
  const repProbability = Number(row.rep_probability);
  const aligned = probability === 0.5 ? margin === 0 : probability > 0.5 ? margin > 0 : margin < 0;
  if (!Number.isFinite(margin) || !Number.isFinite(probability) || !Number.isFinite(repProbability) || probability < 0 || probability > 1 || Math.abs(probability + repProbability - 1) > 1e-10 || !aligned) {
    throw new Error("Published race values are invalid or internally inconsistent for " + row.race_id + ".");
  }
}
const artwork = JSON.parse(fs.readFileSync(path.join(output, "artwork/manifest.json"), "utf8"));
for (const image of artwork.images) assertFile(image.image);
const snapshotIndex = JSON.parse(fs.readFileSync(path.join(output, "data/snapshots/index.json"), "utf8"));
for (const entry of snapshotIndex.snapshots) assertFile(entry.path);
const indexHtml = fs.readFileSync(path.join(output, "index.html"), "utf8");
if (!["id=\"office-select\"", "<option value=\"House\" selected>", "<option value=\"Senate\">", "<option value=\"Governor\">", "id=\"rating-summary\""].every(value => indexHtml.includes(value))) {
  throw new Error("The homepage is missing the shared office selector or dynamic rating summary.");
}
if (indexHtml.includes("Interactive rating experiment") || indexHtml.includes("Temporarily show the closest House districts as Toss-up") || !indexHtml.includes("Display-only ratings; probabilities and published expected-seat totals are unchanged.")) {
  throw new Error("The removed Toss-up rating experiment is still present or the display-only rating explanation is missing.");
}
const mainScript = [...indexHtml.matchAll(/<script[^>]+src="([^"]+)"/g)].map(match => localTarget("index.html", match[1])).find(target => target?.endsWith(".js"));
if (!mainScript) throw new Error("The built homepage does not reference a JavaScript bundle.");
const bundle = fs.readFileSync(path.join(output, ...mainScript.split("/")), "utf8");
if (!bundle.includes(JSON.stringify(basePath))) throw new Error("The built JavaScript bundle does not contain the configured BASE_PATH " + basePath + ".");
if (!bundle.includes("generic-ballot-polls.json") || !bundle.includes("SOURCE POLLING AVERAGE")) {
  throw new Error("The built homepage does not load and label its multi-source polling average.");
}
for (const page of pages) if (!fs.statSync(path.join(output, page)).size) throw new Error("Empty page: " + page);
process.stdout.write("Verified " + pages.length + " physical HTML pages, local links, all " + artwork.images.length + " artwork files, snapshot archive index, configured runtime base, validation-aligned race histories and polls, static JSON, " + candidateData.races.length + " candidate listings, and all " + current.races.length + " internally consistent race forecasts in " + output + ".\n");
