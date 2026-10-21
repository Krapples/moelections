import type { CurrentData, ForecastRace, Office, PriorErrorHistory, RaceChange, RaceRetrospective, RaceRetrospectives, SnapshotComparison } from "./types";

export const OFFICE_ORDER: Office[] = ["House", "Senate", "Governor"];
const RETROSPECTIVE_VALIDATION_YEARS = new Set([2018, 2020, 2022, 2024]);
export const STATE_TILES: Array<[string, number, number]> = [
  ["WA",0,0],["MT",0,3],["ND",0,5],["MN",0,6],["WI",0,7],["MI",0,8],["VT",0,10],["NH",0,11],["ME",0,12],
  ["OR",1,0],["ID",1,2],["SD",1,4],["IA",1,5],["IL",1,6],["IN",1,7],["OH",1,8],["NY",1,9],["MA",1,10],
  ["CA",2,0],["NV",2,1],["WY",2,2],["NE",2,3],["MO",2,4],["KY",2,5],["WV",2,7],["VA",2,8],["NJ",2,9],["CT",2,10],["RI",2,11],["PA",2,12],
  ["AZ",3,1],["UT",3,2],["CO",3,3],["KS",3,4],["AR",3,5],["TN",3,6],["NC",3,7],["SC",3,8],["DE",3,9],["MD",3,10],
  ["NM",4,2],["OK",4,3],["LA",4,4],["MS",4,5],["AL",4,6],["GA",4,7],["FL",5,8],["TX",5,3],["AK",4,0],["HI",5,0]
];

export const STATE_NAMES: Record<string, string> = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",CT:"Connecticut",DE:"Delaware",FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming"
};

export function assetUrl(path: string): string {
  return new URL((import.meta.env.BASE_URL || "./") + path.replace(/^\//, ""), window.location.href).toString();
}

export async function loadCurrent(): Promise<CurrentData> {
  const response = await fetch(assetUrl("data/current.json"), { cache: "no-store" });
  if (!response.ok) throw new Error("Current forecast JSON could not be loaded (" + response.status + ").");
  const data = await response.json() as CurrentData;
  if (!Array.isArray(data.races) || data.races.length === 0 || !data.summary?.seat_outlooks || !data.historical_performance?.metrics) {
    throw new Error("The current forecast JSON is missing required dashboard data.");
  }
  return data;
}

export async function loadRaceRetrospectives(): Promise<RaceRetrospectives> {
  const response = await fetch(assetUrl("data/race-retrospectives.json"), { cache: "no-store" });
  if (!response.ok) throw new Error("Historical race context could not be loaded (" + response.status + ").");
  const data = await response.json() as RaceRetrospectives;
  if (data.schema_version !== 1 || !data.races || typeof data.races !== "object") {
    throw new Error("The race history file has an unsupported format.");
  }
  return data;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, character => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;" }[character] || character));
}

export function dateLabel(value: string | undefined): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "date unavailable";
  const date = new Date(value + "T00:00:00Z");
  return Number.isNaN(date.valueOf()) ? "date unavailable" : date.toLocaleDateString("en-US", { year:"numeric", month:"long", day:"numeric", timeZone:"UTC" });
}

export function pct(value: number): string {
  return (Number(value) * 100).toFixed(1) + "%";
}

export function marginLabel(value: number): string {
  const margin = Number(value);
  if (!Number.isFinite(margin)) return "—";
  if (Math.abs(margin) < 1e-10) return "Even";
  return (margin > 0 ? "D+" : "R+") + Math.abs(margin).toFixed(1);
}

export function raceName(race: ForecastRace): string {
  const state = STATE_NAMES[race.state] || race.state;
  if (race.office === "Senate") return state + " Senate";
  if (race.office === "Governor") return state + " Governor";
  const district = race.district === "0" || race.district === 0 || !race.district ? "At-large" : "District " + race.district;
  return state + " " + district;
}

// Ratings are probability bands, not office-specific margin predictions. Keep an
// explicit entry for each office so each label is routed through that office's
// own published probability stream. The cutoffs are shared because probability
// has the same meaning across offices; the calibrators that produce p are not.
const RATING_THRESHOLDS: Record<Office, { tossup: number; lean: number; likely: number }> = {
  House: { tossup:0.60, lean:0.80, likely:0.98 },
  Senate: { tossup:0.60, lean:0.80, likely:0.98 },
  Governor: { tossup:0.60, lean:0.80, likely:0.98 }
};

export function rating(probability: number, office: Office = "House"): string {
  const strongest = Math.max(probability, 1 - probability);
  const thresholds = RATING_THRESHOLDS[office];
  return strongest < thresholds.tossup ? "Toss-up" : strongest < thresholds.lean ? "Lean" : strongest < thresholds.likely ? "Likely" : "Safe";
}

export function ratingBandDescription(office: Office): string {
  const thresholds = RATING_THRESHOLDS[office];
  const percent = (value: number) => (value * 100).toFixed(0) + "%";
  return `Toss-up <${percent(thresholds.tossup)}; Lean ${percent(thresholds.tossup)}–<${percent(thresholds.lean)}; Likely ${percent(thresholds.lean)}–<${percent(thresholds.likely)}; Safe ≥${percent(thresholds.likely)}`;
}

export function signedCount(value: number): string {
  const count = Number(value);
  if (!Number.isFinite(count)) return "—";
  return (count > 0 ? "+" : count < 0 ? "−" : "") + Math.abs(count).toLocaleString() + " D";
}

export function houseDistrictKey(race: ForecastRace): string {
  const district = Number.parseInt(String(race.district), 10);
  return race.state + "-" + String(Number.isFinite(district) ? district : 0).padStart(2, "0");
}

export function priorErrorCell(race: ForecastRace, priorHistory: PriorErrorHistory): string {
  const history = race.office === "House"
    ? priorHistory.districts?.[houseDistrictKey(race)]
    : priorHistory.state_office_forecasts?.[race.office + "|" + race.state];
  const record = history?.prior_averages_by_target_election?.["2026"];
  const error = Number(record?.prior_average_absolute_error_pp);
  const cycles = Number(record?.prior_cycle_count ?? record?.prior_observation_count) || 0;
  const races = Number(record?.prior_race_count) || cycles;
  if (!Number.isFinite(error) || cycles === 0) return "<span class=\"muted\" title=\"No eligible earlier validation forecast is available for this race label\">—</span>";
  const signed = Number(record?.prior_average_signed_error_pp) || 0;
  const biasClass = Math.abs(signed) <= 0.05 ? "neutral" : signed > 0 ? "dem" : "rep";
  const peer = history?.history_basis === "state_peers";
  const basisLabel = peer ? "California peer average" : cycles + " prior elections";
  const signedText = Math.abs(signed) <= 0.05 ? "Mean error near zero" : "Mean error " + marginLabel(signed);
  const accessible = "Prior forecast error: " + error.toFixed(1) + " percentage points MAE; " + signedText + "; " + races + " race rows across " + cycles + " elections.";
  return "<div class=\"prior-error-summary\" role=\"group\" aria-label=\"" + escapeHtml(accessible) + "\" title=\"" + escapeHtml(accessible) + "\"><strong>" + error.toFixed(1) + " pp MAE</strong><span class=\"prior-error-bias " + biasClass + "\">" + escapeHtml(signedText) + "</span><small>" + escapeHtml(basisLabel) + "</small></div>";
}

function marginTone(value: number): string {
  return Math.abs(value) <= 0.05 ? "neutral" : value > 0 ? "dem" : "rep";
}

function marginValue(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "<span class=\"muted\">—</span>";
  const label = Math.abs(value) <= 0.05 ? "Even" : marginLabel(value);
  return "<span class=\"history-margin " + marginTone(value) + "\">" + escapeHtml(label) + "</span>";
}

function safeHttpLink(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function pollDetails(polls: RaceRetrospective["current_polling"]["polls"], label: string, final30Count = 0): string {
  if (!polls.length) return "<span class=\"muted\">No archived polls</span>";
  const rows = polls.map(poll => {
    const url = safeHttpLink(poll.source_url);
    const pollster = url
      ? "<a href=\"" + escapeHtml(url) + "\" target=\"_blank\" rel=\"noopener noreferrer\">" + escapeHtml(poll.pollster) + "</a>"
      : "<span>" + escapeHtml(poll.pollster) + "</span>";
    const flags = [poll.final_30_days ? "final 30 days" : "", poll.average_eligible ? "" : "race match unclear"].filter(Boolean).map(flag => "<small class=\"poll-tag\">" + escapeHtml(flag) + "</small>").join("");
    const sample = poll.sample_size ? " · n=" + escapeHtml(poll.sample_size) : "";
    const population = poll.population ? " · " + escapeHtml(poll.population) : "";
    return "<div class=\"poll-list-row\"><span class=\"poll-list-name\">" + pollster + "<small>" + escapeHtml(poll.field_start || "") + (poll.field_end && poll.field_end !== poll.field_start ? "–" + escapeHtml(poll.field_end) : "") + sample + population + "</small><small>" + escapeHtml(poll.source) + (poll.match_status !== "race" && poll.match_status !== "district" ? " · " + escapeHtml(poll.match_status) : "") + "</small></span><span class=\"poll-list-margin " + marginTone(Number(poll.margin_pp)) + "\">" + marginValue(poll.margin_pp) + flags + "</span></div>";
  }).join("");
  const windowNote = final30Count ? " · " + final30Count + " in final 30 days" : "";
  return "<details class=\"poll-archive\"><summary>" + escapeHtml(label) + " · " + polls.length.toLocaleString() + " polls" + windowNote + "</summary><div class=\"poll-archive-list\">" + rows + "</div></details>";
}

export function raceRetrospective(race: ForecastRace, retrospective: RaceRetrospectives): string {
  const details: RaceRetrospective | undefined = retrospective.races[race.race_id];
  if (!details) return "<p class=\"fine-print\">Detailed historical race context is not available for this race.</p>";

  const currentPolls = details.current_polling;
  const currentPollMarkup = currentPolls.polls.length
    ? "<div class=\"current-poll-archive\"><p class=\"eyebrow\">CURRENT POLL ARCHIVE</p>" + pollDetails(currentPolls.polls, "View current polls") + "</div>"
    : "<p class=\"current-poll-archive muted\">No current race-matched poll archive is available.</p>";
  const rows: string[] = [];
  for (const item of details.historical_rows.filter(row => RETROSPECTIVE_VALIDATION_YEARS.has(row.year))) {
    const peer = item.history_basis === "California peer average";
    const rowName = peer
      ? "California peer average (" + Number(item.peer_race_count || 0).toLocaleString() + " races)"
      : String(item.year);
    const pollSummary = item.poll_average_margin_pp === null
      ? item.poll_count === 0 ? "<span class=\"muted\">No archive</span>" : "<span class=\"muted\">No eligible poll average</span>"
      : marginValue(item.poll_average_margin_pp);
    const pollMissValue = typeof item.poll_average_margin_pp === "number" && typeof item.actual_margin_pp === "number"
      ? item.poll_average_margin_pp - item.actual_margin_pp
      : null;
    const pollMiss = pollMissValue === null
      ? "<span class=\"muted\">—</span>"
      : marginValue(pollMissValue);
    const pollHint = item.final_30_day_poll_count === 0
      ? item.poll_average_method === "exponential_recency_weighted" && item.poll_average_margin_pp !== null
        ? "<small class=\"cycle-poll-note\">No final-30-day average; using eligible pre-election polls weighted by recency</small>"
        : item.poll_count > 0
          ? "<small class=\"cycle-poll-note\">No usable final-30-day or recency-weighted pre-election average</small>"
          : ""
      : "";
    const archived = item.polls.length ? pollDetails(item.polls, "View poll details", item.final_30_day_poll_count) : "<span class=\"muted\">No poll archive</span>";
    const actual = peer ? "<span class=\"muted\">Peer result unavailable</span>" : marginValue(item.actual_margin_pp);
    const predicted = peer ? "<span class=\"muted\">Peer forecast unavailable</span>" : marginValue(item.predicted_margin_pp);
    const error = item.signed_error_pp === null
      ? "<span class=\"muted\">—</span>"
      : marginValue(item.signed_error_pp);
    const pollMeanLabel = item.poll_average_method === "equal_weight_final_30_days"
      ? "Final 30-day poll mean"
      : item.poll_average_method === "exponential_recency_weighted"
        ? "Pre-election recency-weighted mean"
        : "Poll mean";
    rows.push("<article class=\"history-cycle-card\"><div class=\"history-cycle-heading\"><h3>" + escapeHtml(rowName) + "</h3>" + archived + "</div><div class=\"history-cycle-stats\"><div><span>Actual</span>" + actual + "</div><div><span>Forecast</span>" + predicted + "</div><div><span>Forecast error</span>" + error + "</div><div><span>" + pollMeanLabel + "</span>" + pollSummary + "</div><div><span title=\"Poll mean minus actual two-party margin\">Poll average error</span>" + pollMiss + pollHint + "</div></div></article>");
  }
  const empty = rows.length ? "" : "<p class=\"muted\">No prior race-level validation rows are available for this race label.</p>";
  const historyNote = details.history_note ? "<p class=\"history-context-note\">" + escapeHtml(details.history_note) + "</p>" : "";
  const methodology = "<details class=\"history-method-details\"><summary>How to read the history</summary><p>" + escapeHtml(retrospective.margin_error_definition) + " " + escapeHtml(retrospective.poll_miss_definition) + " " + escapeHtml(retrospective.poll_note) + "</p><p>" + escapeHtml(retrospective.coverage_note) + "</p></details>";
  return historyNote + currentPollMarkup + "<div class=\"history-cycle-list\">" + (rows.join("") || empty) + "</div>" + methodology;
}

export function compareSnapshots(current: CurrentData, previous: CurrentData): SnapshotComparison {
  const previousById = new Map(previous.races.map(race => [race.race_id, race]));
  const currentById = new Map(current.races.map(race => [race.race_id, race]));
  const changed: RaceChange[] = [];
  const added: ForecastRace[] = [];
  const removed: ForecastRace[] = [];
  for (const race of current.races) {
    const oldRace = previousById.get(race.race_id);
    if (!oldRace) {
      added.push(race);
      continue;
    }
    const marginDelta = race.dem_margin_pp - oldRace.dem_margin_pp;
    const demDelta = (race.dem_probability - oldRace.dem_probability) * 100;
    const repDelta = (race.rep_probability - oldRace.rep_probability) * 100;
    if (Math.abs(marginDelta) > 1e-12 || Math.abs(demDelta) > 1e-10 || Math.abs(repDelta) > 1e-10) {
      changed.push({ current:race, previous:oldRace, margin_delta_pp:marginDelta, dem_probability_delta_pp:demDelta, rep_probability_delta_pp:repDelta });
    }
  }
  for (const race of previous.races) if (!currentById.has(race.race_id)) removed.push(race);
  return { changed, added, removed };
}

export function raceUrl(raceId: string): string {
  return "./race.html?id=" + encodeURIComponent(raceId);
}

export function getSummarySentence(current: CurrentData): string {
  return "Snapshot " + dateLabel(current.snapshot_date) + " · " + current.races.length.toLocaleString() + " published race rows";
}
