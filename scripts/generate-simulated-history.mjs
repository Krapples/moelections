import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";

const args = process.argv.slice(2);
const inputIndex = args.indexOf("--input");
const inputDirectory = inputIndex >= 0 ? args[inputIndex + 1] : "";
const append = args.includes("--append");

if (!inputDirectory || inputDirectory.startsWith("--")) {
  console.error("Usage: node scripts/generate-simulated-history.mjs --input <replay-directory> [--append]");
  process.exit(2);
}

const outputPath = path.resolve("public/data/simulated-history.json");
const replayPath = path.resolve(inputDirectory);
const officeKeys = { House: "h", Senate: "s", Governor: "g" };
const expectedRaces = { House: 435, Senate: 35, Governor: 36 };

function parseCsvLine(line) {
  const fields = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quoted && character === '"' && line[index + 1] === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      fields.push(field);
      field = "";
    } else {
      field += character;
    }
  }
  fields.push(field);
  if (quoted) throw new Error("Encountered an unterminated quoted CSV field.");
  return fields;
}

async function readCsv(filePath, compressed = false) {
  const buffer = await readFile(filePath);
  const text = (compressed ? gunzipSync(buffer) : buffer).toString("utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) throw new Error(`CSV is empty: ${filePath}`);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function finiteNumber(value) {
  if (value === "" || value === undefined || value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function rounded(value, digits) {
  if (value === null) return null;
  return Number(value.toFixed(digits));
}

function required(row, key, source) {
  if (!(key in row)) throw new Error(`${source} is missing the ${key} column.`);
  return row[key];
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function websiteRaceId(office, state, replayId) {
  const lowerState = state.toLowerCase();
  if (office === "House") {
    const match = replayId.match(/^([A-Z]{2})-(\d{2})$/);
    if (!match || match[1] !== state) throw new Error(`Unexpected House race identifier: ${replayId}`);
    return `house-${lowerState}-${match[2]}`;
  }
  const expected = office === "Senate" ? `SENATE-${state}-2026` : `GOVERNOR-${state}-2026`;
  if (replayId !== expected) throw new Error(`Unexpected ${office} race identifier: ${replayId}`);
  return `${office.toLowerCase()}-${lowerState}`;
}

function fillCalendarDays(points) {
  const sorted = [...points].sort((left, right) => left.date.localeCompare(right.date));
  const byDate = new Map(sorted.map(point => [point.date, point]));
  const dates = [];
  for (let date = sorted[0].date; date <= sorted[sorted.length - 1].date;) {
    dates.push(byDate.get(date) || { date, h: null, s: null, g: null });
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    date = next.toISOString().slice(0, 10);
  }
  return dates;
}

async function readReplay() {
  const summaryPath = path.join(replayPath, "daily_summary.csv");
  const racePath = path.join(replayPath, "race_history.csv.gz");
  const summaryRows = await readCsv(summaryPath);
  const raceRows = await readCsv(racePath, true);
  const daily = [];
  const dates = new Set();

  for (const row of summaryRows) {
    if (required(row, "timing_policy", "daily_summary.csv") !== "primary") continue;
    const date = required(row, "cutoff", "daily_summary.csv");
    if (!validDate(date) || dates.has(date)) throw new Error(`Invalid or duplicate daily cutoff: ${date}`);
    dates.add(date);
    daily.push({
      date,
      h: rounded(finiteNumber(required(row, "house_expected_dem_seats", "daily_summary.csv")), 3),
      s: rounded(finiteNumber(required(row, "senate_expected_dem_seats", "daily_summary.csv")), 3),
      g: rounded(finiteNumber(required(row, "governor_expected_dem_wins", "daily_summary.csv")), 3)
    });
  }
  daily.sort((left, right) => left.date.localeCompare(right.date));
  if (!daily.length) throw new Error("No primary-policy daily summary rows were found.");
  const dailyByDate = new Map(daily.map(point => [point.date, point]));

  const races = {};
  for (const row of raceRows) {
    if (required(row, "timing_policy", "race_history.csv.gz") !== "primary" || row.status !== "predicted") continue;
    const office = required(row, "office", "race_history.csv.gz");
    if (!(office in officeKeys)) throw new Error(`Unsupported office in replay: ${office}`);
    const date = required(row, "cutoff", "race_history.csv.gz");
    const replayRaceId = required(row, "race_id", "race_history.csv.gz");
    const state = required(row, "state", "race_history.csv.gz");
    const margin = finiteNumber(required(row, "predicted_margin_pp", "race_history.csv.gz"));
    const probability = finiteNumber(required(row, "dem_win_probability", "race_history.csv.gz"));
    if (!dates.has(date) || !/^[A-Z]{2}$/.test(state) || margin === null || probability === null || probability < 0 || probability > 1) {
      throw new Error(`Invalid predicted race row: ${date} ${replayRaceId}`);
    }
    const raceId = websiteRaceId(office, state, replayRaceId);
    const point = dailyByDate.get(date);
    if (point?.[officeKeys[office]] === null || point?.[officeKeys[office]] === undefined) {
      throw new Error(`Race prediction exists on an unavailable office/date: ${date} ${office}`);
    }
    const byOffice = (races[date] ||= {});
    const officeRaces = (byOffice[office] ||= []);
    officeRaces.push({ id: raceId, state, margin: rounded(margin, 3), chance: rounded(probability, 5) });
  }
  for (const offices of Object.values(races)) {
    for (const officeRaces of Object.values(offices)) officeRaces.sort((left, right) => left.id.localeCompare(right.id));
  }
  for (const point of daily) {
    for (const [office, key] of Object.entries(officeKeys)) {
      const raceCount = races[point.date]?.[office]?.length || 0;
      if (point[key] === null && raceCount !== 0) throw new Error(`Unexpected ${office} rows on unavailable date ${point.date}.`);
      if (point[key] !== null && raceCount !== expectedRaces[office]) {
        throw new Error(`Incomplete ${office} predictions on ${point.date}: ${raceCount}/${expectedRaces[office]}.`);
      }
    }
  }

  return {
    schema_version: 1,
    start_date: daily[0].date,
    cutoff_date_utc: daily[daily.length - 1].date,
    daily,
    races
  };
}

async function mergeHistory(incoming) {
  let existing;
  try {
    existing = JSON.parse(await readFile(outputPath, "utf8"));
  } catch {
    throw new Error("--append requires an existing public/data/simulated-history.json.");
  }
  if (existing.schema_version !== 1 || !Array.isArray(existing.daily) || !existing.races) {
    throw new Error("The existing simulated-history file has an unsupported shape.");
  }

  const dailyByDate = new Map(existing.daily.map(point => [point.date, point]));
  for (const point of incoming.daily) {
    const prior = dailyByDate.get(point.date);
    if (prior && JSON.stringify(prior) !== JSON.stringify(point)) {
      throw new Error(`Append stopped: existing daily values differ for ${point.date}.`);
    }
    dailyByDate.set(point.date, prior || point);
  }
  const mergedDaily = fillCalendarDays([...dailyByDate.values()]);

  const mergedRaces = structuredClone(existing.races);
  for (const [date, offices] of Object.entries(incoming.races)) {
    const targetOffices = (mergedRaces[date] ||= {});
    for (const [office, rows] of Object.entries(offices)) {
      const targetRows = targetOffices[office];
      if (targetRows) {
        if (JSON.stringify(targetRows) !== JSON.stringify(rows)) {
          throw new Error(`Append stopped: existing ${office} race values differ for ${date}.`);
        }
      } else {
        targetOffices[office] = rows;
      }
    }
  }

  return {
    schema_version: 1,
    start_date: mergedDaily[0].date,
    cutoff_date_utc: mergedDaily[mergedDaily.length - 1].date,
    daily: mergedDaily,
    races: mergedRaces
  };
}

const incoming = await readReplay();
const history = append ? await mergeHistory(incoming) : incoming;
await writeFile(outputPath, JSON.stringify(history));
const counts = Object.fromEntries(Object.entries(officeKeys).map(([office, key]) => [
  office,
  history.daily.filter(point => point[key] !== null).length
]));
const raceCount = Object.values(history.races).reduce((dateTotal, offices) => dateTotal + Object.values(offices).reduce((officeTotal, rows) => officeTotal + rows.length, 0), 0);
console.log(JSON.stringify({ output: outputPath, start_date: history.start_date, cutoff_date_utc: history.cutoff_date_utc, daily_dates: history.daily.length, forecast_dates_by_office: counts, race_rows: raceCount }));
