import fs from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(root, process.argv[2] || "build");
const basePath = process.env.BASE_PATH || "./";
const pages = ["index.html", "race.html", "methodology.html", "daily-changes.html", "performance.html", "gallery.html", "states.html", "site-guide.html"];
const required = [...pages, "favicon.png", "social-mascot.png", "data/current.json", "data/candidates.json", "data/generic-ballot-polls.json", "data/generic-ballot-history.json", "data/race-retrospectives.json", "data/snapshots/index.json", "data/senate-seat-distribution-2026.csv", "data/governor-seat-distribution-2026.csv", "artwork/manifest.json", "artwork/brand/logo.webp"];
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
  for (const anchor of html.matchAll(/<a\b[^>]*>/gi)) {
    if (/\bdownload(?:\s|=|>)/i.test(anchor[0]) || /\bhref=["'][^"']+\.csv(?:[?#][^"']*)?["']/i.test(anchor[0])) {
      throw new Error(page + " presents a downloadable CSV link.");
    }
  }
  for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    const target = localTarget(page, match[1]);
    if (target && fs.existsSync(path.join(output, ...target.split("/"))) === false) throw new Error(page + " points to missing local file " + match[1]);
  }
}

function inspectPublicData(value, file) {
  if (Array.isArray(value)) {
    for (const item of value) inspectPublicData(item, file);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      const privateMetadataKey = /model|feature|training|run_id|source_path|source_hash|sha256|provenance|audit|forecast_stream|source_forecast|source_snapshot|paired_prediction_stream|experiment|config/i.test(key);
      const unclassifiedPredictionParameter = /^(?!dem_|rep_|forecast_|poll_|actual_|predicted_|signed_)[a-z0-9]+_(?:probability|margin_pp|aligned_margin_pp|shared_offset_pp|bandwidth(?:_pp|_multiplier)?|residual_training_.+)$/i.test(key);
      if (privateMetadataKey || unclassifiedPredictionParameter) {
        throw new Error("Public data contains an internal metadata field in " + file + ": " + key);
      }
      inspectPublicData(item, file);
    }
    return;
  }
  if (typeof value === "string" && (/[A-Z]:\\|\/Users\/|\b[a-f0-9]{64}\b/i.test(value))) {
    throw new Error("Public data contains a local path or internal fingerprint in " + file + ".");
  }
}

function verifyPublicJson(directory) {
  for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      verifyPublicJson(target);
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      inspectPublicData(JSON.parse(fs.readFileSync(target, "utf8")), path.relative(output, target));
    }
  }
}
verifyPublicJson(path.join(output, "data"));

const current = JSON.parse(fs.readFileSync(path.join(output, "data/current.json"), "utf8"));
const priorReleaseIndex = JSON.parse(fs.readFileSync(path.join(output, "data/snapshots/index.json"), "utf8"));
const latestPriorSnapshot = priorReleaseIndex.snapshots?.[0];
if (!latestPriorSnapshot || latestPriorSnapshot.snapshot_date >= current.snapshot_date || !latestPriorSnapshot.path?.startsWith("data/snapshots/") || !fs.existsSync(path.join(output, ...latestPriorSnapshot.path.split("/")))) {
  throw new Error("The forecast archive must retain a prior snapshot for comparison with the current release.");
}
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
const governorPmfLines = fs.readFileSync(path.join(output, "data/governor-seat-distribution-2026.csv"), "utf8").trim().split(/\r?\n/);
if (governorPmfLines.length !== 38) throw new Error("The Governor seat distribution must contain one header and 37 win-count rows.");
const governorPmfMass = governorPmfLines.slice(1).reduce((sum, line) => sum + Number(line.split(",")[2]), 0);
if (!Number.isFinite(governorPmfMass) || Math.abs(governorPmfMass - 1) > 1e-10) throw new Error("The Governor seat distribution probabilities do not sum to one.");
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
const priorMetadata = priorHistory.metadata || {};
const currentStreamNote = priorMetadata.current_stream_note || "";
const priorSourceNote = priorMetadata.source_note || "";
if (priorMetadata.generated_on !== current.snapshot_date || !currentStreamNote.includes(current.snapshot_date) || !currentStreamNote.includes("Trial 14") || !currentStreamNote.includes("alpha=0.75") || !priorSourceNote.includes("Trial 14") || !priorSourceNote.includes("alpha=0.75") || /10\/20 snapshot|207\.435|margin stack retrained/.test(currentStreamNote + " " + priorSourceNote)) {
  throw new Error("Prior-error history date and stream notes must describe the current Trial 14-aligned alpha=0.75 House forecast.");
}
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
const sourceAuditPath = path.join(root, "dist/audit/race-retrospective-source-audit.json");
if (fs.existsSync(sourceAuditPath)) {
  const sourceAudit = JSON.parse(fs.readFileSync(sourceAuditPath, "utf8"));
  for (const office of ["House", "Senate", "Governor"]) {
    const allCutoffRows = sourceAudit.training_cutoff_audit?.[office];
    const cutoffRows = Array.isArray(allCutoffRows) ? allCutoffRows.filter(row => validationYearSet.has(Number(row.evaluation_year))) : null;
    if (!cutoffRows || JSON.stringify(cutoffRows.map(row => Number(row.evaluation_year)).sort((a, b) => a - b)) !== JSON.stringify(validationYears)) {
      throw new Error("The local source audit must retain prior-cycle checks for all four validation elections in " + office + ".");
    }
    for (const row of cutoffRows) {
      const year = Number(row.evaluation_year);
      const probabilityCutoffs = [...(row.probability_training_latest_cycles || []), ...(row.rating_calibration_training_latest_cycles || [])].map(Number);
      const sourceCutoffs = Object.values(row.training_by_rank_source || {});
      if (row.prior_only_cutoff_passed !== true || !sourceCutoffs.length || sourceCutoffs.some(source => !Number.isInteger(Number(source.training_latest_cycle)) || Number(source.training_latest_cycle) >= year || source.training_cutoff_exception) || probabilityCutoffs.some(value => !Number.isInteger(value) || value >= year)) {
        throw new Error("The local source audit contains missing or same-cycle training in " + office + " " + year + ".");
      }
    }
  }
} else {
  console.warn("Skipping local source-audit provenance checks: " + path.relative(root, sourceAuditPath) + " is absent. This audit is not included in the static site build.");
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
const genericHistory = JSON.parse(fs.readFileSync(path.join(output, "data/generic-ballot-history.json"), "utf8"));
const expectedGenericCycles = [2018, 2020, 2022, 2024];
if (genericHistory.schema_version !== 1 || !genericHistory.target?.includes("U.S. House popular vote") || !/^https:\/\//.test(genericHistory.poll_average_source_url) || !genericHistory.poll_average_method?.includes("seven days") || !genericHistory.timing_note?.includes("do not verify") || !genericHistory.validation_note?.includes("not an untouched test") || !Array.isArray(genericHistory.rows) || genericHistory.rows.length !== expectedGenericCycles.length || genericHistory.rows.some((row, index) => row.cycle !== expectedGenericCycles[index])) {
  throw new Error("The generic-ballot history must include the attributed 2018–2024 validation series and its timing limitations.");
}
for (const row of genericHistory.rows) {
  const firstOfNovember = new Date(Date.UTC(row.cycle, 10, 1));
  while (firstOfNovember.getUTCDay() !== 1) firstOfNovember.setUTCDate(firstOfNovember.getUTCDate() + 1);
  firstOfNovember.setUTCDate(firstOfNovember.getUTCDate() + 1 - 7);
  const expectedSnapshot = firstOfNovember.toISOString().slice(0, 10);
  if (row.snapshot_date !== expectedSnapshot || ![row.forecast_margin_pp, row.poll_average_margin_pp, row.actual_house_margin_pp].every(Number.isFinite) || Math.sign(row.actual_house_margin_pp) === 0) {
    throw new Error("Generic-ballot comparison values or seven-day snapshot dates are invalid for " + row.cycle + ".");
  }
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
  if (!Number.isFinite(margin) || !Number.isFinite(probability) || !Number.isFinite(repProbability) || probability < 0 || probability > 1 || Math.abs(probability + repProbability - 1) > 1e-10) {
    throw new Error("Published race values are invalid or internally inconsistent for " + row.race_id + ".");
  }
}
const publicSiteRoot = "https://krapples.github.io/moelections/";
const raceSharePages = current.races.map(row => "race-" + row.race_id + ".html");
const generatedRacePages = fs.readdirSync(output).filter(name => /^race-[a-z0-9-]+\.html$/.test(name));
const generatedRaceImages = fs.existsSync(path.join(output, "social")) ? fs.readdirSync(path.join(output, "social")).filter(name => /^race-[a-z0-9-]+\.png$/.test(name)) : [];
if (raceSharePages.length !== current.races.length || new Set(raceSharePages).size !== raceSharePages.length || generatedRacePages.length !== raceSharePages.length || generatedRaceImages.length !== raceSharePages.length) {
  throw new Error("Race-specific share pages and cards must be generated exactly once for every published race.");
}
const metaContent = (html, name, attribute = "name") => html.match(new RegExp("<meta\\s+" + attribute + "=\"" + name + "\"\\s+content=\"([^\"]*)\"\\s*>", "i"))?.[1] || "";
const homepage = fs.readFileSync(path.join(output, "index.html"), "utf8");
const homepageImage = "https://krapples.github.io/moelections/social-mascot-only.png";
const homepageImageAlt = "The Moelections ballot-box mascot with a checked ballot and gold star ornament on its right side.";
const homepageDescription = metaContent(homepage, "og:description", "property");
if (metaContent(homepage, "twitter:card") !== "summary" || metaContent(homepage, "og:image", "property") !== homepageImage || metaContent(homepage, "twitter:image") !== homepageImage || metaContent(homepage, "og:image:type", "property") !== "image/png" || metaContent(homepage, "og:image:width", "property") !== "1254" || metaContent(homepage, "og:image:height", "property") !== "1254" || metaContent(homepage, "og:image:alt", "property") !== homepageImageAlt || metaContent(homepage, "twitter:image:alt") !== homepageImageAlt || !homepageDescription || homepageDescription !== metaContent(homepage, "twitter:description")) {
  throw new Error("The homepage social preview must use the mascot image and matching descriptive metadata.");
}
const homepageImageBytes = fs.readFileSync(path.join(output, "social-mascot-only.png"));
if (homepageImageBytes.readUInt32BE(16) !== 1254 || homepageImageBytes.readUInt32BE(20) !== 1254 || !homepageImageBytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
  throw new Error("The homepage mascot preview image must be a valid 1254x1254 PNG.");
}
const shareTitles = new Set();
for (const race of current.races) {
  const page = "race-" + race.race_id + ".html";
  const image = "social/race-" + race.race_id + ".png";
  assertFile(page);
  assertFile(image);
  const html = fs.readFileSync(path.join(output, page), "utf8");
  const margin = Number(race.dem_margin_pp);
  const marginLabel = Math.abs(margin) < 0.05 ? "EVEN" : (margin > 0 ? "D+" : "R+") + Math.abs(margin).toFixed(1);
  const dem = (Number(race.dem_probability) * 100).toFixed(1) + "%";
  const rep = (Number(race.rep_probability) * 100).toFixed(1) + "%";
  const snapshotDateLabel = new Intl.DateTimeFormat("en-US", {year:"numeric", month:"long", day:"numeric", timeZone:"UTC"}).format(new Date(snapshotDate + "T00:00:00Z"));
  const canonicalUrl = publicSiteRoot + page;
  const imageUrl = publicSiteRoot + image;
  const title = metaContent(html, "og:title", "property");
  const description = metaContent(html, "og:description", "property");
  const imageAlt = metaContent(html, "og:image:alt", "property");
  if (!title || !title.includes("Moelections 2026 Forecast") || shareTitles.has(title)) throw new Error("Race share titles must be present and race-specific: " + race.race_id + ".");
  shareTitles.add(title);
  if (metaContent(html, "twitter:title") !== title || metaContent(html, "description") !== description || metaContent(html, "twitter:description") !== description) {
    throw new Error("Race share titles and descriptions must match across social and browser metadata for " + race.race_id + ".");
  }
  if (!description.includes("D-R margin " + marginLabel + " pp") || !description.includes("Democratic win chance " + dem) || !description.includes("Republican win chance " + rep) || !description.includes(snapshotDateLabel)) {
    throw new Error("Race share description is missing its public margin, win probabilities, or snapshot date for " + race.race_id + ".");
  }
  if (metaContent(html, "og:url", "property") !== canonicalUrl || !html.includes("<link rel=\"canonical\" href=\"" + canonicalUrl + "\">")) {
    throw new Error("Race share page canonical URL does not identify its static race route: " + race.race_id + ".");
  }
  if (metaContent(html, "og:image", "property") !== imageUrl || metaContent(html, "twitter:image") !== imageUrl || metaContent(html, "og:image:type", "property") !== "image/png" || metaContent(html, "og:image:width", "property") !== "1200" || metaContent(html, "og:image:height", "property") !== "630" || metaContent(html, "twitter:card") !== "summary_large_image") {
    throw new Error("Race share image metadata is incomplete or incompatible for " + race.race_id + ".");
  }
  if (!imageAlt.includes(marginLabel) || !imageAlt.includes(dem) || !imageAlt.includes(rep) || !imageAlt.includes(snapshotDateLabel) || !metaContent(html, "twitter:image:alt").includes(imageAlt)) {
    throw new Error("Race share image alt text must describe the card's forecast values and date for " + race.race_id + ".");
  }
  if (metaContent(html, "moelections:race-id") !== race.race_id || metaContent(html, "moelections:dem-margin-pp") !== String(margin) || metaContent(html, "moelections:dem-win-probability") !== dem || metaContent(html, "moelections:rep-win-probability") !== rep || metaContent(html, "moelections:snapshot-date") !== snapshotDate) {
    throw new Error("Race share page initial HTML does not preserve its public forecast values for " + race.race_id + ".");
  }
  if (!html.includes("<body data-page=\"race\" data-race-id=\"" + race.race_id + "\">")) throw new Error("Static race route does not select its own race on page load: " + race.race_id + ".");
  const imageBytes = fs.readFileSync(path.join(output, image));
  if (imageBytes.length > 5 * 1024 * 1024 || !imageBytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    throw new Error("Race share card is not a portable PNG or exceeds 5 MB: " + race.race_id + ".");
  }
  const idatChunks = [];
  let position = 8;
  let validHeader = false;
  let foundEnd = false;
  while (position + 12 <= imageBytes.length) {
    const chunkLength = imageBytes.readUInt32BE(position);
    const chunkEnd = position + 12 + chunkLength;
    if (chunkEnd > imageBytes.length) throw new Error("Race share PNG has a truncated chunk: " + race.race_id + ".");
    const chunkName = imageBytes.toString("ascii", position + 4, position + 8);
    const chunkData = imageBytes.subarray(position + 8, position + 8 + chunkLength);
    if (chunkName === "IHDR") validHeader = chunkLength === 13 && chunkData.readUInt32BE(0) === 1200 && chunkData.readUInt32BE(4) === 630 && chunkData[8] === 8 && chunkData[9] === 6;
    if (chunkName === "IDAT") idatChunks.push(chunkData);
    if (chunkName === "IEND") { foundEnd = true; break; }
    position = chunkEnd;
  }
  if (!validHeader || !foundEnd || !idatChunks.length || inflateSync(Buffer.concat(idatChunks)).length !== 630 * (1200 * 4 + 1)) {
    throw new Error("Race share card is not a decodable 1200x630 PNG: " + race.race_id + ".");
  }
  for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    const target = localTarget(page, match[1]);
    if (target && !fs.existsSync(path.join(output, ...target.split("/")))) throw new Error(page + " points to missing local file " + match[1]);
  }
  for (const anchor of html.matchAll(/<a\b[^>]*>/gi)) {
    if (/\bdownload(?:\s|=|>)/i.test(anchor[0]) || /href=["'][^"']+\.csv(?:[?#][^"']*)?["']/i.test(anchor[0])) throw new Error(page + " presents a downloadable CSV link.");
  }
  if (html.includes("__SNAPSHOT_") || !html.includes("datetime=\"" + snapshotDate + "\">" + snapshotDateLabel + "</time>")) {
    throw new Error(page + " does not show the current snapshot date in its initial HTML.");
  }
}
const hasDirectionConflict = (margin, probability) => probability === 0.5
  ? margin !== 0
  : probability > 0.5 ? margin <= 0 : margin >= 0;
const currentHouseDirectionConflicts = current.races
  .filter(row => row.office === "House" && hasDirectionConflict(Number(row.dem_margin_pp), Number(row.dem_probability)))
  .map(row => String(row.state).toUpperCase() + "-" + String(Number.parseInt(String(row.district || "0"), 10) || 0).padStart(2, "0"))
  .sort();
const activeSourceAuditPath = path.join(root, "dist/audit/active_forecast_source_audit.json");
const sourceAudit = fs.existsSync(activeSourceAuditPath) ? JSON.parse(fs.readFileSync(activeSourceAuditPath, "utf8")) : null;
const auditedHouseDirectionConflicts = sourceAudit?.rcp_refresh?.current_house_probability_margin_direction_conflicts;
const selectedHouseDirectionConflicts = sourceAudit?.forecasts?.House?.probability_margin_direction_conflicts;
const sameIds = value => Array.isArray(value) && JSON.stringify([...value].map(String).sort()) === JSON.stringify(currentHouseDirectionConflicts);
if (current.races.some(row => row.office !== "House" && hasDirectionConflict(Number(row.dem_margin_pp), Number(row.dem_probability))) || (sourceAudit && (!sameIds(auditedHouseDirectionConflicts) || !sameIds(selectedHouseDirectionConflicts)))) {
  throw new Error("Published House margin/probability direction exceptions must match the current forecast and its source audit.");
}
if (!sourceAudit && currentHouseDirectionConflicts.length) {
  console.warn("Skipping optional internal direction-conflict provenance check: " + path.relative(root, activeSourceAuditPath) + " is absent.");
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
if (/\bdownload(?:\s|=|>)/i.test(bundle) || /href\s*[:=]\s*["'][^"']+\.csv(?:[?#][^"']*)?["']/i.test(bundle)) {
  throw new Error("The built JavaScript presents a downloadable CSV link.");
}
const cachedPollSummary = current.summary?.generic_ballot;
const cachedPollForecast = current.summary?.generic_ballot_forecast;
if (!Number.isFinite(cachedPollSummary?.long_window?.margin_pp) || !Number.isFinite(cachedPollSummary?.long_window?.poll_count) || !Number.isFinite(cachedPollForecast?.margin_pp)) {
  throw new Error("The current snapshot must include cached generic-ballot polling and forecast numbers.");
}
if (!bundle.includes("-DAY POLLING AVERAGE") || bundle.includes("Loading verified poll sources") || bundle.includes("generic-ballot-polls.json") || !bundle.includes("generic-ballot-history.json") || !bundle.includes("Retrospective forecast")) {
  throw new Error("The built site must show cached generic-ballot numbers without waiting for poll-source loading, while retaining its historical comparison.");
}
for (const page of pages) if (!fs.statSync(path.join(output, page)).size) throw new Error("Empty page: " + page);
process.stdout.write("Verified " + pages.length + " physical HTML pages, local links, all " + artwork.images.length + " artwork files, snapshot paths, configured runtime base, validation-aligned race histories and polls, the four-cycle national generic-ballot comparison, static JSON, " + candidateData.races.length + " candidate listings, and all " + current.races.length + " race forecasts with valid probability sums and House direction parity checks where local provenance was available in " + output + ".\n");
