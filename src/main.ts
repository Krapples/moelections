import "./styles.css";
import { renderSimulatedHistory } from "./simulatedHistory";
import { assetUrl, dateLabel, escapeHtml, loadCurrent, loadRaceRetrospectives, marginLabel, OFFICE_ORDER, pct, raceName, raceRetrospective, raceUrl, rating, ratingBandDescription, signedCount, STATE_NAMES, STATE_TILES } from "./data";
import type { ArtworkManifest, CandidateDataset, CurrentData, ForecastRace, GenericBallotHistory, GenericBallotHistoryRow, GenericBallotPoll, HistoricalMetric, Office, RaceRetrospectives, RatingAccuracy, SavedForecastSnapshot, SimulatedHistory, SnapshotIndex } from "./types";

const page = document.body.dataset.page || "home";
let current: CurrentData | null = null;
let selectedState = "";
let mapOffice: Office = "House";
let showMapFlips = false;
let raceSort = "competitive";
let artworkManifestPromise: Promise<ArtworkManifest> | null = null;
let candidateDatasetPromise: Promise<CandidateDataset> | null = null;

type ArtworkEntry = ArtworkManifest["images"][number];

function element<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function initThemeToggle(): void {
  const root = document.documentElement;
  let theme = "dark";
  try {
    theme = localStorage.getItem("moelections-theme") === "light" ? "light" : "dark";
  } catch { /* Dark remains the default when storage is unavailable. */ }
  root.dataset.theme = theme;
  const header = document.querySelector<HTMLElement>(".site-header");
  if (!header || header.querySelector(".theme-toggle")) return;
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "theme-toggle";
  const update = () => {
    const dark = root.dataset.theme !== "light";
    toggle.textContent = dark ? "☀ Light mode" : "☾ Dark mode";
    toggle.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
    toggle.setAttribute("aria-pressed", String(dark));
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", dark ? "#101827" : "#1b273d");
  };
  toggle.addEventListener("click", () => {
    root.dataset.theme = root.dataset.theme === "light" ? "dark" : "light";
    try { localStorage.setItem("moelections-theme", root.dataset.theme); } catch { /* The current page still switches themes. */ }
    update();
    if (current && page === "home") renderMap(current);
  });
  header.append(toggle);
  update();
}

function setImage(id: string, path: string, alt?: string): void {
  const image = element<HTMLImageElement>(id);
  if (!image) return;
  image.src = assetUrl(path);
  if (alt) image.alt = alt;
}

function setBrandAssets(): void {
  setImage("brand-logo", "artwork/brand/logo.webp", "Moelections ballot box logo");
}

function loadArtworkManifest(): Promise<ArtworkManifest> {
  if (!artworkManifestPromise) {
    artworkManifestPromise = fetch(assetUrl("artwork/manifest.json"), { cache:"no-cache" }).then(response => {
      if (!response.ok) throw new Error("The artwork manifest could not be loaded.");
      return response.json() as Promise<ArtworkManifest>;
    });
  }
  return artworkManifestPromise;
}

function loadCandidateDataset(): Promise<CandidateDataset> {
  if (!candidateDatasetPromise) {
    candidateDatasetPromise = fetch(assetUrl("data/candidates.json"), { cache: "force-cache" }).then(response => {
      if (!response.ok) throw new Error("The candidate reference data could not be loaded.");
      return response.json() as Promise<CandidateDataset>;
    });
  }
  return candidateDatasetPromise;
}

function chooseArtwork(pool: ArtworkEntry[], slot: string): ArtworkEntry | null {
  if (!pool.length) return null;
  let previous = "";
  try { previous = sessionStorage.getItem("moelections-art-" + slot) || ""; } catch { /* Storage can be disabled. */ }
  const choices = pool.length > 1 ? pool.filter(item => item.image !== previous) : pool;
  const image = choices[Math.floor(Math.random() * choices.length)];
  try { sessionStorage.setItem("moelections-art-" + slot, image.image); } catch { /* Random selection still works without storage. */ }
  return image;
}

function setArtworkImage(imageId: string, pool: ArtworkEntry[], slot: string, alt: string): ArtworkEntry | null {
  const image = element<HTMLImageElement>(imageId);
  const artwork = chooseArtwork(pool, slot);
  if (!image || !artwork) return null;
  image.src = assetUrl(artwork.image);
  image.alt = alt ? artwork.alt || artworkSeriesName(artwork) + " characters " + alt + " · " + humanArtName(artwork.filename) : "";
  return artwork;
}

function humanArtName(filename: string): string {
  return filename.replace(/\.[^.]+$/, "").replace(/^\d+_?/, "").replaceAll("_", " ").replaceAll("-", " ");
}

function artworkSeriesName(artwork: ArtworkEntry): string {
  if (artwork.series_key.startsWith("07_Kinos_Journey")) return "Kino’s Journey";
  if (artwork.series_key === "11_Vocaloid_SynthV") return "Vocaloid / SynthV";
  return artwork.series;
}

const SHOW_SERIES_ROOTS = new Set([
  "01_Lucky_Star", "02_Gabriel_DropOut", "03_Haruhi_Suzumiya", "04_Yuru_Camp",
  "05_Humanity_Has_Declined", "06_Girls_Last_Tour", "07_Kinos_Journey",
  "08_Frieren", "09_Fate_Carnival_Phantasm", "10_Konosuba", "11_Vocaloid_SynthV"
]);
const SUPPLEMENTAL_ROTATION_SERIES = new Set(["13_Spice_and_Wolf", "14_All_Characters"]);
const SUPPLEMENTAL_ROTATION_FILES = new Set(["07_golden_hour_roadside_reverie.png"]);

function crossShowArt(manifest: ArtworkManifest, patterns: RegExp[]): ArtworkEntry[] {
  return manifest.images.filter(item => {
    const root = item.series_key.split("/")[0];
    const supplementalRotationArt = SUPPLEMENTAL_ROTATION_SERIES.has(root) || SUPPLEMENTAL_ROTATION_FILES.has(item.filename);
    if ((!SHOW_SERIES_ROOTS.has(root) && !SUPPLEMENTAL_ROTATION_SERIES.has(root) && !SUPPLEMENTAL_ROTATION_FILES.has(item.filename)) || item.filename === "03_wide_homepage_banner_optimized.webp") return false;
    if (root === "07_Kinos_Journey" && !item.image.includes("/02_Election_Forecast_Extras/") && !SUPPLEMENTAL_ROTATION_FILES.has(item.filename)) return false;
    if (item.filename === "06_patriotic_washington_overlook.png") return false;
    return supplementalRotationArt || patterns.some(pattern => pattern.test(item.filename));
  });
}

const CHARACTER_SCENE_PATTERNS = {
  patriotic: [/^06_patriotic/i, /^01_original_patriotic_group/i, /^02_forecast_team/i, /^03_wide_homepage_banner\.png$/i],
  decision: [/^01_.*(?:election|mischief)/i, /^02_.*(?:decision|desk|ballot)/i],
  reactions: [/^03_.*(?:happy|celebration)/i, /^04_.*(?:crying|revision|revised)/i, /^05_.*(?:shock|shocked)/i],
  state: [/^01_.*(?:election|mischief)/i, /^02_.*(?:decision|desk|ballot)/i, /^03_.*(?:happy|celebration)/i, /^06_patriotic/i]
};

function kinoTravelArt(manifest: ArtworkManifest): ArtworkEntry[] {
  return manifest.images.filter(item => item.image.includes("/01_Travels_Across_America/") && ["01_gunslinging.png", "02_diner_stop.png", "03_desert_ride.png"].includes(item.filename));
}

function showError(error: unknown): void {
  const message = error instanceof Error ? error.message : "The static forecast data could not be loaded.";
  const errorPanel = element("load-error");
  if (errorPanel) {
    errorPanel.textContent = message;
    errorPanel.hidden = false;
    return;
  }
  const main = document.querySelector("main");
  if (main) {
    const notice = document.createElement("div");
    notice.className = "notice notice-error";
    notice.setAttribute("role", "alert");
    notice.textContent = message;
    main.prepend(notice);
  }
}

function renderSnapshotMetadata(data: CurrentData): void {
  const date = dateLabel(data.snapshot_date);
  for (const time of document.querySelectorAll<HTMLTimeElement>("time[data-snapshot-date]")) {
    time.dateTime = data.snapshot_date;
    time.textContent = date;
  }
  const description = document.querySelector<HTMLMetaElement>('meta[name="description"][data-snapshot-meta]');
  if (!description) return;
  if (description.dataset.snapshotMeta === "forecast") {
    description.content = "Browse the " + date + " Moelections House, Senate, and Governor forecasts, race probabilities, margins, and historical results.";
  } else if (description.dataset.snapshotMeta === "methodology") {
    description.content = "Definitions, source dates, and archive limits for the Moelections " + date + " snapshot.";
  }
}

function byCompetition(a: ForecastRace, b: ForecastRace): number {
  return Math.abs(a.dem_probability - 0.5) - Math.abs(b.dem_probability - 0.5) || raceName(a).localeCompare(raceName(b));
}

function raceCounts(data: CurrentData): Record<Office, number> {
  const counts: Record<Office, number> = { House:0, Senate:0, Governor:0 };
  for (const race of data.races) counts[race.office] += 1;
  return counts;
}

type SeatRanges = { central50: [number, number]; central90: [number, number] };
type FlipSide = "D" | "R";
type FlipSummary = { dem: number; rep: number; matched: number; total: number };
const seatRangeCache = new WeakMap<CurrentData, Partial<Record<Office, SeatRanges>>>();
const seatPmfCache = new WeakMap<CurrentData, Partial<Record<Office, number[]>>>();

function poissonBinomialPmf(probabilities: number[]): number[] {
  let pmf = [1];
  for (const probability of probabilities) {
    const next = Array<number>(pmf.length + 1).fill(0);
    for (let wins = 0; wins < pmf.length; wins += 1) {
      next[wins] += pmf[wins] * (1 - probability);
      next[wins + 1] += pmf[wins] * probability;
    }
    pmf = next;
  }
  return pmf;
}

function officeSeatPmf(data: CurrentData, office: Office): number[] {
  const cached = seatPmfCache.get(data)?.[office];
  if (cached) return cached;
  const probabilities = data.races.filter(race => race.office === office).map(race => {
    const probability = Number(race.dem_probability);
    return Number.isFinite(probability) ? Math.max(0, Math.min(1, probability)) : 0.5;
  });
  const fixedDemSeats = office === "Senate" ? Number(data.summary.senate_seat_distribution?.fixed_dem_caucus_seats ?? 34) : 0;
  const racePmf = poissonBinomialPmf(probabilities);
  const pmf = Array<number>(racePmf.length + fixedDemSeats).fill(0);
  racePmf.forEach((probability, wins) => { pmf[wins + fixedDemSeats] = probability; });
  const byOffice = seatPmfCache.get(data) || {};
  byOffice[office] = pmf;
  seatPmfCache.set(data, byOffice);
  return pmf;
}

function pmfQuantile(pmf: number[], quantile: number): number {
  let cumulative = 0;
  for (let wins = 0; wins < pmf.length; wins += 1) {
    cumulative += pmf[wins];
    if (cumulative + 1e-14 >= quantile) return wins;
  }
  return pmf.length - 1;
}

function probabilityTail(pmf: number[], firstIncludedSeat: number): number {
  return pmf.slice(firstIncludedSeat).reduce((sum, probability) => sum + probability, 0);
}

type ControlOdds = { dem: number; rep: number; tie: number };

function chamberControlOdds(data: CurrentData, office: "House" | "Senate"): ControlOdds {
  const pmf = officeSeatPmf(data, office);
  if (office === "House") {
    const dem = probabilityTail(pmf, 218);
    return { dem, rep: Math.max(0, 1 - dem), tie: 0 };
  }
  const dem = probabilityTail(pmf, 51);
  const tie = pmf[50] || 0;
  return { dem, rep: Math.max(0, 1 - dem), tie };
}

function formatLikelihood(probability: number): string {
  const percent = Math.max(0, Math.min(1, probability)) * 100;
  return percent > 0 && percent < 0.01 ? "<0.01%" : percent.toFixed(2) + "%";
}

function renderControlOdds(data: CurrentData, office: "House" | "Senate"): string {
  const odds = chamberControlOdds(data, office);
  const controlTarget = office === "House" ? "218+ seats" : "51+ seats";
  const repLabel = office === "Senate" ? "Republican incl. tie" : "Republican";
  const tieNote = office === "Senate" ? "<small class=\"control-tie-note\">50–50 tie: " + formatLikelihood(odds.tie) + "</small>" : "";
  return "<div class=\"control-outlook\"><p class=\"control-outlook-title\">Control likelihood <span>" + controlTarget + "</span></p><div class=\"control-outlook-grid\"><div class=\"control-odds-side dem\"><span>Democratic</span><b>" + formatLikelihood(odds.dem) + "</b></div><div class=\"control-odds-side rep\"><span>" + repLabel + "</span><b>" + formatLikelihood(odds.rep) + "</b></div></div>" + tieNote + "</div>";
}

function renderBothChamberOdds(data: CurrentData): void {
  const holder = element("joint-control-outlook");
  if (!holder) return;
  const house = chamberControlOdds(data, "House");
  const senate = chamberControlOdds(data, "Senate");
  const demBoth = house.dem * senate.dem;
  const repBoth = house.rep * senate.rep;
  const split = house.dem * senate.rep + house.rep * senate.dem;
  holder.innerHTML = "<div class=\"both-control-card\"><div class=\"both-control-heading\"><div><p class=\"eyebrow\">BOTH CHAMBERS</p><h3>Likelihood of the combined outcome</h3></div><span>Illustrative estimate</span></div><div class=\"both-control-grid\"><div class=\"both-control-item dem\"><span>Democrats control both</span><b>" + formatLikelihood(demBoth) + "</b></div><div class=\"both-control-item rep\"><span>Republicans control both</span><b>" + formatLikelihood(repBoth) + "</b></div><div class=\"both-control-item split\"><span>Split control</span><b>" + formatLikelihood(split) + "</b></div></div></div>";
}

function officeSeatRanges(data: CurrentData, office: Office): SeatRanges {
  const cached = seatRangeCache.get(data)?.[office];
  if (cached) return cached;
  const outlook = data.summary.seat_outlooks[office];
  let ranges: SeatRanges;
  if (office !== "House" && Array.isArray(outlook.core_range) && Array.isArray(outlook.outer_range)) {
    ranges = {
      central50: [Number(outlook.core_range[0]), Number(outlook.core_range[1])],
      central90: [Number(outlook.outer_range[0]), Number(outlook.outer_range[1])]
    };
  } else {
    const pmf = officeSeatPmf(data, office);
    ranges = {
      central50: [pmfQuantile(pmf, 0.25), pmfQuantile(pmf, 0.75)],
      central90: [pmfQuantile(pmf, 0.05), pmfQuantile(pmf, 0.95)]
    };
  }
  const byOffice = seatRangeCache.get(data) || {};
  byOffice[office] = ranges;
  seatRangeCache.set(data, byOffice);
  return ranges;
}

function priorContestWinner(race: ForecastRace, data: CurrentData): { side: FlipSide; year: number } | null {
  const result = data.previous_contest_results?.[race.race_id];
  return result && (result.winner === "D" || result.winner === "R")
    ? { side:result.winner, year:Number(result.year) }
    : null;
}

function projectedFlip(race: ForecastRace, data: CurrentData): { side: FlipSide; year: number } | null {
  const previous = priorContestWinner(race, data);
  if (!previous || Math.abs(race.dem_probability - 0.5) < 1e-10) return null;
  const forecastSide: FlipSide = race.dem_probability > 0.5 ? "D" : "R";
  return forecastSide === previous.side ? null : { side:forecastSide, year:previous.year };
}

function flipBadge(race: ForecastRace, data: CurrentData): string {
  const flip = projectedFlip(race, data);
  if (!flip) return "";
  const label = flip.side + " flip";
  const party = flip.side === "D" ? "Democratic" : "Republican";
  return "<span class=\"flip-badge " + (flip.side === "D" ? "dem" : "rep") + "\" title=\"Forecast favors " + party + ", different from the " + flip.year + " result for this seat label.\">" + label + "</span>";
}

function flipSummary(races: ForecastRace[], data: CurrentData): FlipSummary {
  const summary: FlipSummary = { dem:0, rep:0, matched:0, total:races.length };
  for (const race of races) {
    const previous = priorContestWinner(race, data);
    if (!previous) continue;
    summary.matched += 1;
    if (Math.abs(race.dem_probability - 0.5) < 1e-10) continue;
    const side: FlipSide = race.dem_probability > 0.5 ? "D" : "R";
    if (side !== previous.side) summary[side === "D" ? "dem" : "rep"] += 1;
  }
  return summary;
}

function renderHome(data: CurrentData): void {
  void renderHomeArtwork();
  const date = dateLabel(data.snapshot_date);
  const heroDate = element("hero-date");
  if (heroDate) heroDate.textContent = date;
  const footerDate = element("footer-date");
  if (footerDate) footerDate.textContent = date;
  const coverage = element("forecast-race-count");
  if (coverage) coverage.textContent = data.races.length.toLocaleString() + " PUBLISHED RACES · " + date.toUpperCase() + " SNAPSHOT";
  renderOutlooks(data);
  renderClosestPreview(data);
  renderGenericBallot(data);
  renderForecastControls(data);
}

async function renderHomeArtwork(): Promise<void> {
  try {
    const manifest = await loadArtworkManifest();
    const patriotic = crossShowArt(manifest, CHARACTER_SCENE_PATTERNS.patriotic);
    const panic = crossShowArt(manifest, [/panic|shock|shocked|crying/i]);
    const closeCalls = crossShowArt(manifest, [...CHARACTER_SCENE_PATTERNS.decision, ...CHARACTER_SCENE_PATTERNS.reactions]);
    const changes = crossShowArt(manifest, CHARACTER_SCENE_PATTERNS.reactions);
    const states = crossShowArt(manifest, CHARACTER_SCENE_PATTERNS.state).concat(kinoTravelArt(manifest));
    setArtworkImage("hero-art", patriotic, "home-hero", "in a patriotic illustration");
    setArtworkImage("generic-panic-art", panic, "home-generic-panic", "");
    setArtworkImage("panic-art", closeCalls, "home-closest", "in a close-election scene");
    setArtworkImage("history-art", changes, "home-history", "reviewing election history");
    setArtworkImage("travel-art", states, "home-states", "exploring a state-by-state forecast");
  } catch { /* Forecast data remains usable if optional artwork is unavailable. */ }
}

function renderOutlooks(data: CurrentData): void {
  const holder = element("outlook-grid");
  if (!holder) return;
  const outlooks = data.summary.seat_outlooks;
  const counts = raceCounts(data);
  const senateRaceCount = Number(outlooks.Senate.forecast_seats ?? counts.Senate);
  const senateFixedSeats = Number(outlooks.Senate.fixed_seats ?? Math.max(0, outlooks.Senate.total_seats - senateRaceCount));
  const entries: Array<{ office: Office; label: string; scope: string }> = [
    { office:"House", label:"House", scope:counts.House + " districts" },
    { office:"Senate", label:"Senate", scope:Number(outlooks.Senate.total_seats).toLocaleString() + " caucus seats" },
    { office:"Governor", label:"Governors", scope:counts.Governor + " races" }
  ];
  holder.innerHTML = entries.map(entry => {
    const row = outlooks[entry.office];
    const expectedLabel = entry.office === "Governor" ? "expected wins" : entry.office === "Senate" ? "expected caucus seats" : "expected seats";
    const ranges = officeSeatRanges(data, entry.office);
    const range = "<div class=\"outlook-range\"><span>Central 50% <b>" + ranges.central50[0] + "–" + ranges.central50[1] + " D</b></span><span>Central 90% <b>" + ranges.central90[0] + "–" + ranges.central90[1] + " D</b></span></div>";
    const primaryValue = entry.office === "Governor" ? Number(row.dem_favored_races) : Math.round(Number(row.expected_dem_seats));
    const primaryLabel = entry.office === "Governor" ? "D-favored races" : "D " + expectedLabel;
    const expectedPair = entry.office === "Governor"
      ? "<div class=\"outlook-pair\"><span>Expected D / R wins</span><b>" + Number(row.expected_dem_seats).toFixed(1) + " / " + Number(row.expected_rep_seats).toFixed(1) + "</b></div>"
      : "<div class=\"outlook-pair\"><span>Republican expected</span><b>" + Math.round(Number(row.expected_rep_seats)).toLocaleString() + "</b></div>";
    const note = entry.office === "House"
      ? "<small>" + Number(row.dem_favored_districts).toLocaleString() + " D-favored · " + Number(row.rep_favored_districts).toLocaleString() + " R-favored</small>"
      : entry.office === "Senate" ? "<small>" + senateRaceCount.toLocaleString() + " forecast races · " + senateFixedSeats.toLocaleString() + " fixed seats</small>" : "<small>Favored races: " + Number(row.dem_favored_races).toLocaleString() + " D · " + Number(row.rep_favored_races).toLocaleString() + " R</small>";
    const control = entry.office === "House" || entry.office === "Senate" ? renderControlOdds(data, entry.office) : "";
    return "<article class=\"outlook-card outlook-" + entry.office.toLowerCase() + "\"><p class=\"eyebrow\">" + entry.label.toUpperCase() + " · " + entry.scope.toUpperCase() + "</p><div class=\"expected-total\"><strong>" + primaryValue.toLocaleString() + "</strong><span>" + primaryLabel + "</span></div>" + expectedPair + note + range + control + "<span class=\"outlook-date\">Updated " + dateLabel(row.snapshot_date) + "</span></article>";
  }).join("");
  renderBothChamberOdds(data);
  const senate = outlooks.Senate;
  const note = element("outlook-note");
  if (note) note.innerHTML = "Seat ranges and combined control chances are approximate; outcomes can move together with shared national or state conditions. House covers " + counts.House.toLocaleString() + " districts. Senate includes " + senateRaceCount.toLocaleString() + " listed races plus " + senateFixedSeats.toLocaleString() + " fixed seats. A 50–50 Senate is assigned to Republicans under the <a href=\"https://www.whitehouse.gov/administration/jd-vance/\" target=\"_blank\" rel=\"noopener noreferrer\">current vice president's tie-break</a>. Governor covers " + counts.Governor.toLocaleString() + " on-ballot races.";
}

function renderClosestPreview(data: CurrentData): void {
  const holder = element("closest-preview");
  if (!holder) return;
  holder.innerHTML = data.races.slice().sort(byCompetition).slice(0, 5).map((race, index) => {
    return "<a class=\"mini-race\" href=\"" + raceUrl(race.race_id) + "\"><span class=\"mini-race-number\">0" + (index + 1) + "</span><span><b>" + escapeHtml(raceName(race)) + "</b><small>" + escapeHtml(race.office) + " · " + (race.dem_margin_pp === null ? "Not scored" : marginLabel(race.dem_margin_pp) + " margin") + "</small></span><strong>" + pct(race.dem_probability) + " D</strong></a>";
  }).join("");
}

function renderGenericBallot(data: CurrentData): void {
  const holder = element("generic-content");
  const description = element("generic-description");
  if (!holder) return;
  const generic = data.summary.generic_ballot;
  const forecast = data.summary.generic_ballot_forecast;
  const longWindow = generic.long_window;
  const shortWindow = generic.short_window;
  const averageMargin = Number(longWindow?.margin_pp ?? generic.margin_pp);
  const pollCount = Number(longWindow?.poll_count ?? 0);
  const shortMargin = Number(shortWindow?.margin_pp);
  const shortCount = Number(shortWindow?.poll_count ?? 0);
  if (!Number.isFinite(averageMargin) || !Number.isFinite(forecast?.margin_pp)) {
    holder.innerHTML = "<p class=\"generic-loading generic-loading-error\" role=\"status\">Cached polling or forecast numbers are unavailable. Forecast results remain available.</p>";
    return;
  }
  const marginGap = forecast.margin_pp - averageMargin;
  const gapSign = marginGap > 0 ? "+" : marginGap < 0 ? "−" : "";
  const gapMagnitude = Math.abs(marginGap).toFixed(1);
  const gapDescription = Math.abs(marginGap) < 1e-10
    ? "The forecast and polling average show the same margin."
    : "The forecast is " + gapMagnitude + " percentage points " + (marginGap > 0 ? "more Democratic" : "less Democratic") + " than the polling average.";
  const shortWindowMarkup = Number.isFinite(shortMargin)
    ? " · " + (shortWindow?.window_days ?? 7) + "-day " + escapeHtml(marginLabel(shortMargin)) + " (" + shortCount.toLocaleString() + " polls)"
    : "";
  const unknownPublicDateCount = Number(generic.unknown_first_public_date_polls_used ?? 0);
  const timingNote = generic.first_public_timing_verified
    ? "Publication dates were verified for all included polls."
    : unknownPublicDateCount > 0
      ? "The publication date is unverified for " + unknownPublicDateCount.toLocaleString() + " records, so we cannot confirm that every poll was public by then."
      : "Publication timing was not verified for every included poll.";
  const snapshotDate = dateLabel(generic.input_snapshot_date);
  if (description) description.textContent = "Cached poll averages and the separate published forecast.";
  holder.innerHTML = `
    <div class="generic-column generic-poll-average">
      <span class="eyebrow">${longWindow?.window_days ?? 30}-DAY POLLING AVERAGE</span>
      <strong>${marginLabel(averageMargin)}</strong>
      <small>Cached aggregate as of ${dateLabel(generic.input_snapshot_date)}</small>
      <span>${pollCount.toLocaleString()} poll records${shortWindowMarkup}</span>
    </div>
    <div class="generic-column generic-forecast-estimate">
      <span class="eyebrow">FORECAST ESTIMATE</span>
      <strong>${marginLabel(forecast.margin_pp)}</strong>
      <small>Cached estimate based on data through ${dateLabel(forecast.input_snapshot_date)}</small>
      <span>${escapeHtml(forecast.target)}</span>
    </div>
    <article class="generic-gap">
      <span class="eyebrow">FORECAST − POLL AVERAGE</span>
      <strong>${gapSign}${gapMagnitude} pp</strong>
      <small>${gapDescription}</small>
    </article>
    <details class="generic-poll-details">
      <summary><span>About these numbers</span><span class="generic-poll-count">${pollCount.toLocaleString()} 30-day poll records</span></summary>
      <div class="generic-poll-details-body">
        <p class="generic-context">
          The average uses eligible polls with fieldwork ending by ${escapeHtml(snapshotDate)}, weighted by sample size and recency in separate 7-day and 30-day windows. ${escapeHtml(timingNote)} The list shows the four latest poll releases with reported Democratic and Republican shares; screens and samples differ.
        </p>
        <div class="generic-poll-sources" aria-label="Four latest generic-ballot polls"></div>
      </div>
    </details>`;
  const pollList = holder.querySelector<HTMLElement>(".generic-poll-sources");
  if (!pollList) return;
  const dateKey = (value: string | null | undefined): string => value || "";
  const newest = (generic.latest_polls || []).slice().sort((a: GenericBallotPoll, b: GenericBallotPoll) =>
      dateKey(b.first_public_date || b.release_date || b.field_end).localeCompare(dateKey(a.first_public_date || a.release_date || a.field_end))
      || dateKey(b.field_end).localeCompare(dateKey(a.field_end))
      || a.source.localeCompare(b.source)
    ).slice(0, 4);
  if (newest.length < 4) {
    pollList.innerHTML = "<p class=\"generic-loading generic-loading-error\" role=\"status\">Fewer than four recent poll releases are available.</p>";
    return;
  }
  pollList.innerHTML = newest.map(poll => {
    const reportedDate = poll.first_public_date || poll.release_date || poll.field_end || undefined;
    const fieldDates = poll.field_start && poll.field_end
      ? poll.field_start === poll.field_end
        ? "Fielded " + dateLabel(poll.field_end || undefined)
        : "Fielded " + dateLabel(poll.field_start || undefined) + "–" + dateLabel(poll.field_end || undefined)
      : "Field dates unavailable";
    const dem = Number(poll.dem_pct);
    const rep = Number(poll.rep_pct);
    const share = (value: number): string => Number.isInteger(value) ? String(value) : value.toFixed(1);
    const link = /^https:\/\//i.test(poll.source_url)
      ? "<a class=\"poll-source-name\" href=\"" + escapeHtml(poll.source_url) + "\" target=\"_blank\" rel=\"noopener noreferrer\">" + escapeHtml(poll.source) + "</a>"
      : "<span class=\"poll-source-name\">" + escapeHtml(poll.source) + "</span>";
    return "<article class=\"poll-source-card\"><div class=\"poll-source-head\">" + link + "<strong>" + escapeHtml(marginLabel(dem - rep)) + "</strong></div><span class=\"poll-source-result\">D " + share(dem) + "% · R " + share(rep) + "%</span><small>" + escapeHtml(poll.population) + " · " + escapeHtml(fieldDates) + " · Released " + escapeHtml(dateLabel(reportedDate)) + "</small><small>" + escapeHtml(poll.sample_note) + "</small></article>";
  }).join("");
}

function renderRatingBar(data: CurrentData): void {
  const officeValue = element<HTMLSelectElement>("office-select")?.value || "House";
  const office: Office | "All" = officeValue === "All" ? "All" : OFFICE_ORDER.includes(officeValue as Office) ? officeValue as Office : "House";
  const races = office === "All" ? data.races : data.races.filter(race => race.office === office);
  const counts: Record<string, number> = { "d-safe":0, "d-likely":0, "d-leans":0, tossup:0, "r-leans":0, "r-likely":0, "r-safe":0 };
  const senateFixedDem = Number(data.summary.senate_seat_distribution?.fixed_dem_caucus_seats ?? 34);
  const senateFixedRep = Number(data.summary.senate_seat_distribution?.fixed_rep_seats ?? 31);
  if (office === "Senate") {
    counts["d-safe"] += senateFixedDem;
    counts["r-safe"] += senateFixedRep;
  }
  for (const race of races) {
    const probability = race.dem_probability;
    const band = rating(probability, race.office).toLowerCase();
    if (band === "toss-up") counts.tossup += 1;
    else counts[(probability > 0.5 ? "d-" : "r-") + band] += 1;
  }
  const categories = [
    { key:"d-safe", label:"Dem Safe" },{ key:"d-likely", label:"Dem Likely" },{ key:"d-leans", label:"Dem Leans" },{ key:"tossup", label:"Toss-up" },{ key:"r-leans", label:"Rep Leans" },{ key:"r-likely", label:"Rep Likely" },{ key:"r-safe", label:"Rep Safe" }
  ];
  const bar = element("rating-bar");
  const legend = element("rating-legend");
  const eyebrow = element("rating-eyebrow");
  const title = element("rating-title");
  const summaryHolder = element("rating-summary");
  const note = element("rating-note");
  const total = races.length + (office === "Senate" ? senateFixedDem + senateFixedRep : 0);
  const majority = office === "All" ? null : Math.floor(total / 2) + 1;
  const displayOffice = office === "All" ? "All offices" : office;
  if (eyebrow) eyebrow.textContent = displayOffice.toUpperCase() + " RATING SNAPSHOT";
  if (title) title.textContent = office === "All" ? total.toLocaleString() + " forecast races" : office === "House" ? total.toLocaleString() + " districts" : office === "Senate" ? total.toLocaleString() + " chamber seats" : total.toLocaleString() + " Governor races";
  if (bar) {
    const marker = majority === null ? "" : "<span class=\"majority-marker\" style=\"left:" + (majority / total * 100).toFixed(2) + "%\"><i></i><b>" + majority + "</b></span>";
    bar.innerHTML = categories.filter(row => counts[row.key] > 0).map(row => "<span class=\"rating-segment " + row.key + "\" style=\"flex-grow:" + counts[row.key] + "\" title=\"" + row.label + ": " + counts[row.key] + "\"></span>").join("") + marker;
    bar.setAttribute("aria-label", displayOffice + " rating counts: " + categories.map(row => row.label + ": " + counts[row.key]).join("; ") + (majority === null ? ". Combined race view; no single majority marker." : "; " + majority + " seats or races for a majority."));
  }
  if (legend) legend.innerHTML = categories.map(row => "<span><i class=\"rating-swatch " + row.key + "\"></i>" + row.label + " <b>" + counts[row.key] + "</b></span>").join("");
  const ranges = office === "All" ? null : officeSeatRanges(data, office);
  const outlook = office === "All" ? null : data.summary.seat_outlooks[office];
  const flips = flipSummary(races, data);
  const flipText = "Projected flips vs. prior result: <b class=\"dem\">D " + flips.dem + "</b> · <b class=\"rep\">R " + flips.rep + "</b> <small>" + flips.matched + "/" + flips.total + " contests matched</small>";
  const governorCallText = office === "Governor" ? "<span>Favored races: <b>" + Number(outlook?.dem_favored_races).toLocaleString() + " D</b> · <b>" + Number(outlook?.rep_favored_races).toLocaleString() + " R</b></span>" : "";
  if (summaryHolder) summaryHolder.innerHTML = office === "All"
    ? "<span>" + total.toLocaleString() + " forecast races across offices; Senate fixed seats are omitted from this combined view.</span><span>Choose one office for its expected total and 50% / 90% seat ranges.</span><span>" + flipText + "</span>"
    : "<span>Expected Democratic " + (office === "Governor" ? "wins" : office === "Senate" ? "caucus seats" : "seats") + ": <b>" + Number(outlook?.expected_dem_seats).toFixed(1) + " / " + total.toLocaleString() + "</b></span>" + governorCallText + "<span>Central 50%: <b>" + ranges?.central50[0] + "–" + ranges?.central50[1] + " D</b></span><span>Central 90%: <b>" + ranges?.central90[0] + "–" + ranges?.central90[1] + " D</b></span><span>" + flipText + "</span>";
  if (note) {
    const houseBands = ratingBandDescription("House");
    const senateBands = ratingBandDescription("Senate");
    const governorBands = ratingBandDescription("Governor");
    if (office === "House") note.textContent = "Rating bands: " + houseBands + ". The bar covers all 435 districts; the marker is the 218-seat majority line. Flip tags compare the favored party with the 2024 result for the same district label.";
    else if (office === "Senate") note.textContent = "Rating bands: " + senateBands + ". The bar covers 35 forecast races plus 65 fixed seats (34 Democratic-caucus and 31 Republican); the marker is 51 seats. Flip tags use the 2020 result for regular seats and the 2022 result for Florida and Ohio special contests.";
    else if (office === "Governor") note.textContent = "Rating bands: " + governorBands + ". The bar covers all 36 races; the marker is 19 wins. Flip tags compare with the prior contest result: 2022 for most states and 2024 for New Hampshire and Vermont.";
    else note.textContent = "Rating bands: " + houseBands + ". The combined bar counts race rows, not a unified seat total; Senate fixed seats are omitted. Select an office for its expected total, ranges, majority marker, and flip baseline.";
  }
}

function stateColor(probability: number): { fill:string; border:string; text:string } {
  const strength = Math.max(0, Math.min(1, Math.abs(probability - 0.5) * 2));
  if (document.documentElement.dataset.theme === "dark") {
    const hue = probability < 0.5 ? 4 : 211;
    const saturation = Math.round(17 + 67 * strength);
    const lightness = Math.round(25 + 17 * strength);
    return {
      fill:"hsl(" + hue + " " + saturation + "% " + lightness + "% )",
      border:"hsl(" + hue + " " + Math.min(92, saturation + 12) + "% " + Math.min(61, lightness + 14) + "% )",
      text:"#f7f9fc"
    };
  }
  const hue = probability < 0.5 ? 3 : 213;
  const saturation = Math.round(25 + 52 * strength);
  const lightness = Math.round(94 - 14 * strength);
  return { fill:"hsl(" + hue + " " + saturation + "% " + lightness + "% )", border:"hsl(" + hue + " " + Math.min(86, saturation + 10) + "% " + Math.max(57, lightness - 9) + "% )", text:"#202b40" };
}

function renderMap(data: CurrentData): void {
  const holder = element("tile-map");
  if (!holder) return;
  const officeRows = data.races.filter(race => race.office === mapOffice);
  const available = new Set(officeRows.map(race => race.state));
  const stats = new Map<string, { sum:number; races:number; dFlips:number; rFlips:number }>();
  for (const race of officeRows) {
    const entry = stats.get(race.state) || { sum:0, races:0, dFlips:0, rFlips:0 };
    entry.sum += race.dem_probability;
    entry.races += 1;
    const flip = projectedFlip(race, data);
    if (flip?.side === "D") entry.dFlips += 1;
    else if (flip?.side === "R") entry.rFlips += 1;
    stats.set(race.state, entry);
  }
  holder.setAttribute("aria-label", mapOffice + " race map; select a state to filter the race list");
  holder.innerHTML = "";
  for (const [abbr, row, col] of STATE_TILES) {
    const button = document.createElement("button");
    const stateName = STATE_NAMES[abbr] || abbr;
    const stateStats = stats.get(abbr);
    const enabled = available.has(abbr);
    const probability = stateStats ? stateStats.sum / stateStats.races : null;
    button.type = "button";
    button.className = "state-tile" + (enabled ? " available" : "") + (selectedState === abbr ? " selected" : "");
    button.dataset.state = abbr;
    button.style.gridRow = String(row + 1);
    button.style.gridColumn = String(col + 1);
    button.disabled = !enabled;
    let titleText = "";
    if (probability !== null && stateStats) {
      const colors = stateColor(probability);
      button.style.setProperty("--tile-fill", colors.fill);
      button.style.setProperty("--tile-border", colors.border);
      button.style.setProperty("--tile-text", colors.text);
      titleText = stateName + " · average D win chance " + pct(probability) + " across " + stateStats.races + " listed " + mapOffice + (stateStats.races === 1 ? " race" : " races");
      if (showMapFlips && (stateStats.dFlips || stateStats.rFlips)) {
        const flipParts = [];
        if (stateStats.dFlips) flipParts.push(stateStats.dFlips + " projected Democratic " + (stateStats.dFlips === 1 ? "flip" : "flips"));
        if (stateStats.rFlips) flipParts.push(stateStats.rFlips + " projected Republican " + (stateStats.rFlips === 1 ? "flip" : "flips"));
        titleText += " · " + flipParts.join(" · ");
      }
    } else titleText = stateName + " · no listed " + mapOffice + " race";
    button.title = titleText;
    const stateLabel = document.createElement("span");
    stateLabel.className = "state-tile-label";
    stateLabel.textContent = abbr;
    button.append(stateLabel);
    if (showMapFlips && stateStats && (stateStats.dFlips || stateStats.rFlips)) {
      const badges = document.createElement("span");
      badges.className = "map-tile-flips";
      for (const side of ["D", "R"] as const) {
        const flipCount = side === "D" ? stateStats.dFlips : stateStats.rFlips;
        if (!flipCount) continue;
        const badge = document.createElement("span");
        badge.className = "map-flip-chip " + (side === "D" ? "dem" : "rep");
        badge.textContent = mapOffice === "House" ? side + flipCount : side;
        badge.setAttribute("aria-hidden", "true");
        badges.append(badge);
      }
      button.append(badges);
    }
    button.setAttribute("aria-label", button.title);
    button.setAttribute("aria-pressed", String(selectedState === abbr));
    holder.append(button);
  }
  const caption = element("map-caption");
  const title = element("map-title");
  const clear = element<HTMLButtonElement>("clear-state");
  if (title) title.textContent = mapOffice + " win chances by state";
  if (caption) caption.textContent = selectedState
    ? (STATE_NAMES[selectedState] || selectedState) + " selected. Tile color averages the Democratic win chance across its listed " + mapOffice + (officeRows.filter(race => race.state === selectedState).length === 1 ? " race." : " races.") + (mapOffice === "House" ? " House map colors average district forecasts; they are not statewide election probabilities." : "")
    : "Each tile averages the Democratic win chance across that state's listed " + mapOffice + (mapOffice === "House" ? " districts. This is not a statewide election probability." : " races.") + " Select a state to filter the race list to this office.";
  if (caption && showMapFlips) caption.textContent += " Flip bubbles show the favored side: blue D is Democratic and red R is Republican. House bubbles include the number of flipped districts.";
  if (clear) clear.hidden = !selectedState;
}

function renderRaceList(data: CurrentData): void {
  const office = element<HTMLSelectElement>("office-select")?.value || "All";
  const search = (element<HTMLInputElement>("race-search")?.value || "").trim().toLowerCase();
  const officeRows = data.races.filter(race => office === "All" || race.office === office);
  renderRatingBar(data);
  renderMap(data);
  const rows = officeRows.filter(race => {
    const matchesState = !selectedState || race.state === selectedState;
    const name = (raceName(race) + " " + race.state + " " + race.office).toLowerCase();
    return matchesState && (!search || name.includes(search));
  }).sort((a, b) => raceSort === "state" ? raceName(a).localeCompare(raceName(b)) || OFFICE_ORDER.indexOf(a.office) - OFFICE_ORDER.indexOf(b.office) : byCompetition(a, b));
  const body = element("race-table-body");
  if (body) body.innerHTML = rows.map(race => {
    const dem = race.dem_probability;
    const rep = race.rep_probability;
    const favorite = Math.abs(dem - rep) < 1e-10 ? "Even" : dem > rep ? "Democratic · " + pct(dem) : "Republican · " + pct(rep);
    const favoriteClass = dem > rep ? "dem" : dem < rep ? "rep" : "neutral";
    const raceRating = race.forecast_rating || rating(dem, race.office);
    const ratingClass = raceRating.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const marginDirection = race.dem_margin_pp === null ? 0 : Math.sign(race.dem_margin_pp);
    const chanceDirection = Math.sign(Number(dem) - 0.5);
    const hasDirectionDifference = marginDirection !== 0 && chanceDirection !== 0 && marginDirection !== chanceDirection;
    const directionNote = hasDirectionDifference
      ? "The margin (" + marginLabel(race.dem_margin_pp) + ") favors " + (marginDirection > 0 ? "Democrats" : "Republicans") + "; the win chance favors " + (chanceDirection > 0 ? "Democrats" : "Republicans") + ". The rating follows the win chance."
      : "";
    const directionMarker = directionNote
      ? "<button class=\"forecast-direction-marker\" type=\"button\" title=\"" + escapeHtml(directionNote) + "\" aria-label=\"" + escapeHtml(directionNote) + "\">*</button>"
      : "";
    const scoringNote = race.accuracy_scoring_eligible === false
      ? "<small class=\"accuracy-exclusion-label\" title=\"" + escapeHtml(race.accuracy_exclusion_reason || "Excluded from 2026 accuracy scoring.") + "\">Excluded from 2026 scoring</small>"
      : "";
    return "<tr><th scope=\"row\"><a class=\"race-link\" href=\"" + raceUrl(race.race_id) + "\">" + escapeHtml(raceName(race)) + "<small>" + escapeHtml(race.office) + "</small></a></th><td><span class=\"margin-token " + (race.dem_margin_pp === null ? "neutral" : race.dem_margin_pp > 0 ? "dem" : race.dem_margin_pp < 0 ? "rep" : "neutral") + "\">" + marginLabel(race.dem_margin_pp) + "</span>" + directionMarker + "</td><td><span class=\"chance-value\">" + pct(dem) + "</span><span class=\"chance-track dem-track\"><i style=\"width:" + (dem * 100).toFixed(1) + "%\"></i></span></td><td><span class=\"chance-value\">" + pct(rep) + "</span><span class=\"chance-track rep-track\"><i style=\"width:" + (rep * 100).toFixed(1) + "%\"></i></span></td><td><span class=\"favorite-label " + favoriteClass + "\">" + favorite + "</span><span class=\"rating-pill " + ratingClass + " " + favoriteClass + "\" title=\"" + (race.forecast_rating ? "Published forecast rating" : "Rating derived from the published win chance") + "\">" + escapeHtml(raceRating) + "</span>" + scoringNote + flipBadge(race, data) + "</td></tr>";
  }).join("");
  const count = element("record-count");
  const title = element("table-title");
  const note = element("coverage-note");
  const empty = element("empty-state");
  const counts = raceCounts(data);
  const senate = data.summary.seat_outlooks.Senate;
  const senateRaces = Number(senate.forecast_seats ?? counts.Senate);
  const senateFixedSeats = Number(senate.fixed_seats ?? Math.max(0, senate.total_seats - senateRaces));
  if (count) count.textContent = rows.length.toLocaleString() + (rows.length === 1 ? " race" : " races") + (selectedState ? " · " + (STATE_NAMES[selectedState] || selectedState) : "");
  if (title) title.textContent = office === "All" ? "All covered races and districts" : office === "House" ? "House districts" : office + " races";
  if (note) note.textContent = selectedState ? "Filtering to " + (STATE_NAMES[selectedState] || selectedState) + "." : office === "House" ? "Forecasts are listed for all " + counts.House.toLocaleString() + " House districts." : office === "Senate" ? "All " + counts.Senate.toLocaleString() + " Senate races are listed, including Florida and Ohio." : office === "Governor" ? "All " + counts.Governor.toLocaleString() + " published Governor race rows are listed." : "Search, choose an office, or select a state. The Senate chamber summary combines " + senateRaces.toLocaleString() + " listed races and " + senateFixedSeats.toLocaleString() + " fixed seats.";
  if (empty) empty.hidden = rows.length > 0;
}

function renderForecastControls(data: CurrentData): void {
  const search = element<HTMLInputElement>("race-search");
  const office = element<HTMLSelectElement>("office-select");
  const sort = element<HTMLSelectElement>("race-sort");
  const flipToggle = element<HTMLInputElement>("show-map-flips");
  const params = new URLSearchParams(window.location.search);
  const requestedState = params.get("state") || "";
  const requestedOffice = params.get("office") || "House";
  selectedState = STATE_NAMES[requestedState] ? requestedState : "";
  mapOffice = OFFICE_ORDER.includes(requestedOffice as Office) ? requestedOffice as Office : "House";
  if (office && ["All", ...OFFICE_ORDER].includes(requestedOffice)) office.value = requestedOffice;
  if (search) search.addEventListener("input", () => { selectedState = ""; renderRaceList(data); });
  if (office) office.addEventListener("change", () => {
    mapOffice = office.value === "All" ? "House" : office.value as Office;
    if (selectedState && office.value !== "All" && !data.races.some(race => race.state === selectedState && race.office === office.value)) selectedState = "";
    renderRaceList(data);
  });
  if (sort) sort.addEventListener("change", () => { raceSort = sort.value; renderRaceList(data); });
  if (flipToggle) flipToggle.addEventListener("change", () => { showMapFlips = flipToggle.checked; renderMap(data); });
  element("reset-view")?.addEventListener("click", () => {
    if (office) office.value = "House";
    if (search) search.value = "";
    if (sort) sort.value = "competitive";
    mapOffice = "House";
    showMapFlips = false;
    if (flipToggle) flipToggle.checked = false;
    selectedState = "";
    raceSort = "competitive";
    renderRaceList(data);
    search?.focus();
  });
  element("tile-map")?.addEventListener("click", event => {
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLButtonElement>("button[data-state]");
    if (!button || button.disabled) return;
    selectedState = selectedState === button.dataset.state ? "" : (button.dataset.state || "");
    if (office) office.value = mapOffice;
    renderRaceList(data);
  });
  element("clear-state")?.addEventListener("click", () => { selectedState = ""; renderRaceList(data); });
  renderRaceList(data);
}

function renderStates(data: CurrentData): void {
  const holder = element("state-grid");
  if (!holder) return;
  const grouped = new Map<string, ForecastRace[]>();
  for (const race of data.races) grouped.set(race.state, [...(grouped.get(race.state) || []), race]);
  const search = element<HTMLInputElement>("state-search");
  const office = element<HTMLSelectElement>("state-office");
  const sort = element<HTMLSelectElement>("state-sort");
  const status = element("state-count");
  const empty = element("state-empty");
  const candidateNamesByRace = new Map<string, string[]>();
  let candidatesReady = false;
  let candidatesUnavailable = false;
  const matchingCandidate = (race: ForecastRace, query: string): string | undefined =>
    candidateNamesByRace.get(race.race_id)?.find(name => name.toLowerCase().includes(query));
  const raceMatches = (race: ForecastRace, query: string): boolean =>
    raceName(race).toLowerCase().includes(query) || Boolean(matchingCandidate(race, query));
  const render = () => {
    const query = search?.value.trim().toLowerCase() || "";
    const officeFilter = office?.value || "All";
    const states = [...grouped.entries()].map(([state, allRaces]) => ({
      state,
      name:STATE_NAMES[state] || state,
      allRaces,
      races:officeFilter === "All" ? allRaces : allRaces.filter(race => race.office === officeFilter)
    })).filter(row => row.races.length > 0 && (!query || row.name.toLowerCase().includes(query) || row.state.toLowerCase().includes(query) || row.races.some(race => raceMatches(race, query))));
    if (sort?.value === "races") states.sort((a, b) => b.races.length - a.races.length || a.name.localeCompare(b.name));
    else if (sort?.value === "competitive") states.sort((a, b) => byCompetition(a.races.slice().sort(byCompetition)[0], b.races.slice().sort(byCompetition)[0]) || a.name.localeCompare(b.name));
    else states.sort((a, b) => a.name.localeCompare(b.name));
    holder.innerHTML = states.map(({ state, name, allRaces, races }) => {
      const average = races.reduce((sum, race) => sum + race.dem_probability, 0) / races.length;
      const stateMatchesQuery = query && (name.toLowerCase().includes(query) || state.toLowerCase().includes(query));
      const match = query && !stateMatchesQuery ? races.slice().sort(byCompetition).find(race => raceMatches(race, query)) : undefined;
      const closest = match || races.slice().sort(byCompetition)[0];
      const candidateMatch = match ? matchingCandidate(match, query) : undefined;
      const closestLabel = candidateMatch
        ? "Candidate match: " + candidateMatch + " · " + raceName(closest)
        : match ? "Race match: " + raceName(closest) : "Closest: " + raceName(closest);
      const counts = OFFICE_ORDER.map(item => {
        const count = allRaces.filter(race => race.office === item).length;
        return "<span>" + item + " <b>" + count + "</b></span>";
      }).join("");
      const officeParam = officeFilter === "All" ? "" : "&office=" + encodeURIComponent(officeFilter);
      return "<article class=\"state-card\"><div class=\"state-card-heading\"><span class=\"state-abbr\">" + state + "</span><h2 class=\"state-name\">" + escapeHtml(name) + "</h2><strong class=\"state-average\">" + pct(average) + "</strong></div><p class=\"state-average-label\">average D win chance · " + escapeHtml(officeFilter === "All" ? "all offices" : officeFilter) + " · " + races.length + (races.length === 1 ? " race" : " races") + "</p><div class=\"state-card-counts\" aria-label=\"All office coverage counts\">" + counts + "</div><a class=\"state-closest\" href=\"" + raceUrl(closest.race_id) + "\">" + escapeHtml(closestLabel) + (candidateMatch ? "" : " · " + pct(closest.dem_probability) + " D") + "</a><a class=\"state-browse\" href=\"./index.html?state=" + encodeURIComponent(state) + officeParam + "#race-forecasts\">Browse " + races.length + (races.length === 1 ? " forecast" : " forecasts") + " <span aria-hidden=\"true\">↗</span></a></article>";
    }).join("");
    if (status) status.textContent = "Showing " + states.length + (states.length === 1 ? " state" : " states") + " with published " + (officeFilter === "All" ? "race rows" : officeFilter + " rows") + (query && !candidatesReady && !candidatesUnavailable ? ". Loading candidate names…" : query && candidatesUnavailable ? ". Candidate names are unavailable; state and district search still work." : ".");
    if (empty) {
      empty.hidden = states.length > 0 || Boolean(query && !candidatesReady && !candidatesUnavailable);
      if (query && !candidatesReady && !candidatesUnavailable) empty.textContent = "Searching candidate names…";
      else empty.textContent = "No states, districts, or candidates match these filters. Clear the search or choose another office.";
    }
  };
  search?.addEventListener("input", render);
  office?.addEventListener("change", render);
  sort?.addEventListener("change", render);
  element("state-reset")?.addEventListener("click", () => {
    if (search) search.value = "";
    if (office) office.value = "All";
    if (sort) sort.value = "name";
    render();
    search?.focus();
  });
  const footerDate = element("state-footer-date");
  if (footerDate) footerDate.textContent = dateLabel(data.snapshot_date);
  render();
  void loadCandidateDataset().then(candidates => {
    for (const race of candidates.races) candidateNamesByRace.set(race.race_id, race.candidates.map(candidate => candidate.name));
    candidatesReady = true;
    render();
  }).catch(() => {
    candidatesUnavailable = true;
    render();
  });
  void renderStatesArtwork();
}

async function renderStatesArtwork(): Promise<void> {
  try {
    const manifest = await loadArtworkManifest();
    const stateArt = crossShowArt(manifest, CHARACTER_SCENE_PATTERNS.state).concat(kinoTravelArt(manifest));
    setArtworkImage("states-art", stateArt, "states-banner", "exploring a state-by-state forecast");
  } catch { /* State forecasts remain available if optional artwork is unavailable. */ }
}

async function renderRaceDetail(data: CurrentData): Promise<void> {
  const holder = element("race-detail");
  if (!holder) return;
  const raceId = document.body.dataset.raceId || new URLSearchParams(window.location.search).get("id");
  const race = data.races.find(row => row.race_id === raceId);
  if (!race) {
    holder.innerHTML = "<section class=\"notice notice-error\"><h1>Race not found</h1><p>No published row matches the supplied race ID. <a href=\"./index.html#race-forecasts\">Return to all forecasts</a>.</p></section>";
    return;
  }
  let candidateListing: CandidateDataset["races"][number] | undefined;
  let candidateLookupFailed = false;
  let candidateRetrievedAt = "";
  try {
    const candidates = await loadCandidateDataset();
    candidateRetrievedAt = candidates.retrieved_at;
    candidateListing = candidates.races.find(row => row.race_id === race.race_id);
  } catch {
    candidateLookupFailed = true;
  }
  let retrospectives: RaceRetrospectives | null = null;
  try {
    retrospectives = await loadRaceRetrospectives();
  } catch {
    retrospectives = null;
  }
  const favorite = race.dem_probability === race.rep_probability ? "Even" : race.dem_probability > race.rep_probability ? "Democrats favored" : "Republicans favored";
  const classification = race.forecast_rating || rating(race.dem_probability, race.office);
  const detailStatsMarkup = raceDetailStatsMarkup(race, retrospectives, classification);
  const scoringNote = race.accuracy_scoring_eligible === false
    ? "<p class=\"accuracy-exclusion-label\">" + escapeHtml(race.accuracy_exclusion_reason || "Excluded from 2026 accuracy scoring.") + "</p>"
    : "";
  const candidateSourceUrl = safeHttpUrl(candidateListing?.source_url);
  const candidateRows = candidateListing?.candidates.length
    ? "<div class=\"candidate-roster\">" + candidateListing.candidates.map(candidate => "<article class=\"candidate-entry " + candidatePartyClass(candidate.party) + "\"><strong class=\"candidate-name\">" + escapeHtml(candidate.name) + "</strong><span class=\"candidate-party\">" + escapeHtml(candidate.party) + "</span></article>").join("") + "</div><p class=\"fine-print\">Candidate names are listed separately from the party-level forecast probabilities above.</p>" + (candidateSourceUrl ? "<p class=\"candidate-source\">Source: <a href=\"" + escapeHtml(candidateSourceUrl) + "\" target=\"_blank\" rel=\"noopener noreferrer\">2026 election candidate listing</a> · <a href=\"https://creativecommons.org/licenses/by-sa/4.0/\" target=\"_blank\" rel=\"noopener noreferrer\">CC BY-SA 4.0</a></p>" : "")
    : candidateLookupFailed
      ? "<p>Candidate reference data could not be loaded. The forecast remains available; try reloading this page.</p>"
      : "<p>No candidate names are currently listed for this race in the candidate reference.</p>";
  const candidateRetrievedMarkup = /^\d{4}-\d{2}-\d{2}/.test(candidateRetrievedAt)
    ? "<p class=\"fine-print\">Candidate reference retrieved " + escapeHtml(dateLabel(candidateRetrievedAt.slice(0, 10))) + " UTC.</p>"
    : "";
  const sourceMarkup = "<p>No per-race external source attribution is available in the published race file.</p>";
  const retrospectiveMarkup = retrospectives
    ? raceRetrospective(race, retrospectives)
    : "<p class=\"muted\">Historical race context could not be loaded. The current forecast remains available.</p>";
  const simulationParams = new URLSearchParams(window.location.search);
  const simulationDate = simulationParams.get("simulation_date") || "";
  const simulationOffice = simulationParams.get("simulation_office") || "";
  const simulatedRaceMarkup = await simulatedRaceDetailMarkup(race, simulationDate, simulationOffice);
  const simulatedHistoryUrl = "./daily-changes.html?view=simulated&office=" + encodeURIComponent(race.office) + "&race=" + encodeURIComponent(race.race_id);
  const simulatedHistoryLink = "<p class=\"simulated-history-page-link\"><a href=\"" + escapeHtml(simulatedHistoryUrl) + "\">View simulated history for this race</a></p>";
  holder.innerHTML = "<p class=\"eyebrow\">" + escapeHtml(race.office) + " · " + dateLabel(data.snapshot_date) + " SNAPSHOT</p><h1>" + escapeHtml(raceName(race)) + "</h1><p class=\"detail-subtitle\">" + favorite + "</p>" + simulatedHistoryLink + simulatedRaceMarkup + scoringNote + detailStatsMarkup + "<section class=\"content-panel candidate-panel\"><p class=\"eyebrow\">CANDIDATES</p><h2>Race field</h2>" + candidateRows + candidateRetrievedMarkup + "</section><section class=\"content-panel detail-history\"><p class=\"eyebrow\">PAST ELECTIONS</p><h2>Prior margins and polls</h2>" + retrospectiveMarkup + "</section><section class=\"content-panel detail-source-panel\"><p class=\"eyebrow\">REFERENCE</p><h2>Sources</h2>" + sourceMarkup + "<p>See <a href=\"./methodology.html\">About the data</a> for definitions and date limits.</p></section>";
  void renderRaceArtwork();
  const header = document.querySelector("title");
  if (header) header.textContent = raceName(race) + " — Moelections";
  const footerDate = element("race-footer-date");
  if (footerDate) footerDate.textContent = dateLabel(data.snapshot_date);
}

async function simulatedRaceDetailMarkup(race: ForecastRace, date: string, office: string): Promise<string> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !OFFICE_ORDER.includes(office as Office) || office !== race.office) return "";
  try {
    const response = await fetch(assetUrl("data/simulated-history.json"), { cache: "no-store" });
    if (!response.ok) throw new Error("The simulated race values could not be loaded.");
    const history = await response.json() as SimulatedHistory;
    const simulated = history.races[date]?.[race.office]?.find(row => row.id === race.race_id);
    if (!simulated) throw new Error("No simulated value is available for this race on the selected date.");
    const archiveUrl = "./daily-changes.html?view=simulated&date=" + encodeURIComponent(date) + "&office=" + encodeURIComponent(race.office) + "&race=" + encodeURIComponent(race.race_id);
    return "<section class=\"content-panel simulated-race-context\"><p class=\"eyebrow\">COUNTERFACTUAL SIMULATION · " + escapeHtml(dateLabel(date)) + "</p><h2>Simulated value for this date</h2><div class=\"simulated-race-stats\"><div><span>Democratic margin</span><strong>" + escapeHtml(marginLabel(simulated.margin)) + " pp</strong></div><div><span>Democratic win chance</span><strong>" + pct(simulated.chance) + "</strong></div></div><p>This reconstructed value is separate from the published forecast shown below.</p><a href=\"" + escapeHtml(archiveUrl) + "\">Back to this date in Simulated history</a></section>";
  } catch (error) {
    return "<section class=\"content-panel simulated-race-context\"><p class=\"eyebrow\">COUNTERFACTUAL SIMULATION · " + escapeHtml(dateLabel(date)) + "</p><p>" + escapeHtml(error instanceof Error ? error.message : "Simulated race values are unavailable.") + "</p><a href=\"./daily-changes.html?view=simulated\">Return to Simulated history</a></section>";
  }
}

function raceDetailStatsMarkup(race: ForecastRace, retrospectives: RaceRetrospectives | null, classification: string): string {
  const currentPolls = retrospectives?.races[race.race_id]?.current_polling;
  const pollMean = currentPolls?.poll_average_margin_pp ?? null;
  const pollSourceDate = currentPolls?.source_as_of ? " · source through " + dateLabel(currentPolls.source_as_of) : "";
  const forecastPollGap = pollMean === null || race.dem_margin_pp === null ? null : race.dem_margin_pp - pollMean;
  const gapClass = forecastPollGap === null || Math.abs(forecastPollGap) <= 0.05 ? "neutral" : forecastPollGap > 0 ? "dem" : "rep";
  const pollDetails = currentPolls
    ? pollMean === null
      ? "<small>" + currentPolls.poll_count.toLocaleString() + " poll records · no usable average" + escapeHtml(pollSourceDate) + "</small><small>Forecast-to-poll gap unavailable</small>"
      : forecastPollGap === null
        ? "<small>" + currentPolls.poll_count.toLocaleString() + " poll records · unweighted mean" + escapeHtml(pollSourceDate) + "</small><small>Forecast-to-poll gap unavailable because this race has no scored margin.</small>"
        : "<small>" + currentPolls.poll_count.toLocaleString() + " poll records · unweighted mean" + escapeHtml(pollSourceDate) + "</small><small>Forecast − poll mean: <b class=\"" + gapClass + "\">" + marginLabel(forecastPollGap) + "</b></small>"
    : "<small>Poll summary unavailable</small>";
  return "<section class=\"detail-metrics\" aria-label=\"Race forecast summary\"><article class=\"detail-stat\"><span>Forecast margin</span><strong class=\"" + (race.dem_margin_pp === null ? "neutral" : race.dem_margin_pp > 0 ? "dem" : race.dem_margin_pp < 0 ? "rep" : "neutral") + "\">" + marginLabel(race.dem_margin_pp) + "</strong><small>" + escapeHtml(classification) + " rating</small></article><article class=\"detail-stat detail-probability\"><span>Win probability</span><div class=\"detail-probability-values\"><b class=\"dem\">D " + pct(race.dem_probability) + "</b><b class=\"rep\">R " + pct(race.rep_probability) + "</b></div><div class=\"probability-split\" role=\"img\" aria-label=\"Democratic win probability " + pct(race.dem_probability) + ", Republican win probability " + pct(race.rep_probability) + "\"><i class=\"probability-dem\" style=\"width:" + (race.dem_probability * 100).toFixed(1) + "%\"></i><i class=\"probability-rep\" style=\"width:" + (race.rep_probability * 100).toFixed(1) + "%\"></i></div><small>Published race probabilities</small></article><article class=\"detail-stat\"><span>Current poll average</span><strong>" + (pollMean === null ? "No matched mean" : marginLabel(pollMean)) + "</strong>" + pollDetails + "</article></section>";
}

function safeHttpUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function candidatePartyClass(party: string): string {
  if (party.toLowerCase() === "democratic") return "candidate-democratic";
  if (party.toLowerCase() === "republican") return "candidate-republican";
  return "candidate-other";
}

async function renderRaceArtwork(): Promise<void> {
  const wrap = element<HTMLElement>("race-art-wrap");
  const image = element<HTMLImageElement>("race-art");
  if (!wrap || !image) return;
  try {
    const manifest = await loadArtworkManifest();
    const pool = crossShowArt(manifest, [...CHARACTER_SCENE_PATTERNS.decision, ...CHARACTER_SCENE_PATTERNS.reactions, ...CHARACTER_SCENE_PATTERNS.patriotic]);
    const art = chooseArtwork(pool, "race-banner");
    if (!art) return;
    image.src = assetUrl(art.image);
    image.alt = art.alt || artworkSeriesName(art) + " characters in " + humanArtName(art.filename) + " illustration";
    wrap.hidden = false;
  } catch {
    wrap.hidden = true;
  }
}

type HistoryMetricKey = "margin_mae_pp" | "accuracy" | "seat_count" | "expected_seats" | "brier_score";

const HISTORY_CHART_METRICS: Record<HistoryMetricKey, { label:string; note:string }> = {
  margin_mae_pp:{ label:"Margin error", note:"Average absolute difference between forecast and actual margins. Lower is closer." },
  accuracy:{ label:"Winner accuracy", note:"Share of covered races with the correct predicted winner. Higher is better." },
  seat_count:{ label:"Seat counts in covered races", note:"Predicted Democratic calls compared with actual Democratic wins on the same covered races." },
  expected_seats:{ label:"Expected Democratic seats", note:"Sum of House district win probabilities compared with actual Democratic wins on the same covered races. This expected-seat series is available for House." },
  brier_score:{ label:"Probability score", note:"How close the published win chances were to the outcomes, on a 0–1 scale. Lower is better." }
};

const HISTORY_COLORS: Record<Office, string> = { House:"#326eb8", Senate:"#b24f4f", Governor:"#bd8c30" };
const GENERIC_HISTORY_COLORS = { forecast:"#326eb8", polling:"#bd8c30", actual:"#5d6a7c" };

function historyMetricValue(row: HistoricalMetric, metric: HistoryMetricKey): number {
  if (metric === "seat_count") return Number(row.predicted_dem_seat_calls);
  if (metric === "expected_seats") return Number(row.expected_dem_seats);
  return Number(row[metric]);
}

function historyMetricLabel(value: number, metric: HistoryMetricKey): string {
  if (metric === "accuracy") return pct(value);
  if (metric === "brier_score") return value.toFixed(3);
  if (metric === "seat_count") return Math.round(value).toLocaleString();
  if (metric === "expected_seats") return value.toFixed(1);
  return value.toFixed(2) + " pp";
}

function historySeatCountChartMarkup(rows: HistoricalMetric[], years: number[], offices: Office[], expectedSeats = false): string {
  const width = 820;
  const panelHeight = 178;
  const height = offices.length * panelHeight + 8;
  const left = 72;
  const right = 34;
  const top = 30;
  const bottom = 34;
  const plotWidth = width - left - right;
  const xAt = (index:number):number => years.length === 1 ? left + plotWidth / 2 : left + index * plotWidth / (years.length - 1);
  const panels = offices.map((office, panelIndex) => {
    const officeRows = years.map(year => rows.find(row => row.office === office && Number(row.cycle) === year)).filter((row):row is HistoricalMetric => Boolean(row));
    if (!officeRows.length) return "";
    const forecastSeats = (row: HistoricalMetric): number => expectedSeats ? Number(row.expected_dem_seats) : Number(row.predicted_dem_seat_calls);
    const seatValues = officeRows.flatMap(row => [forecastSeats(row), Number(row.actual_dem_wins_covered)]).filter(Number.isFinite);
    const observedMin = Math.min(...seatValues);
    const observedMax = Math.max(...seatValues);
    const observedSpan = Math.max(1, observedMax - observedMin);
    const paddedMin = Math.max(0, observedMin - observedSpan * 0.15);
    const paddedMax = observedMax + observedSpan * 0.15;
    const rawStep = Math.max(1, (paddedMax - paddedMin) / 4);
    const stepPower = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const normalizedStep = rawStep / stepPower;
    const axisStep = Math.max(1, (normalizedStep <= 1 ? 1 : normalizedStep <= 2 ? 2 : normalizedStep <= 5 ? 5 : 10) * stepPower);
    const min = Math.max(0, Math.floor(paddedMin / axisStep) * axisStep);
    const max = Math.ceil(paddedMax / axisStep) * axisStep;
    const panelTop = panelIndex * panelHeight;
    const plotTop = panelTop + top;
    const plotBottom = panelTop + panelHeight - bottom;
    const plotHeight = plotBottom - plotTop;
    const yAt = (value:number):number => plotTop + (max - value) / (max - min) * plotHeight;
    const axis = Array.from({ length: 5 }, (_, index) => Math.round(max - (max - min) * index / 4))
      .filter((value, index, values) => index === 0 || value !== values[index - 1]);
    const guides = axis.map(value => {
      const y = yAt(value);
      return "<g><line x1=\"" + left + "\" y1=\"" + y.toFixed(1) + "\" x2=\"" + (width - right) + "\" y2=\"" + y.toFixed(1) + "\" class=\"history-grid-line\"/><text x=\"" + (left - 12) + "\" y=\"" + (y + 4).toFixed(1) + "\" text-anchor=\"end\" class=\"history-axis-label\">" + value + "</text></g>";
    }).join("");
    const xLabels = years.map((year, index) => "<text x=\"" + xAt(index).toFixed(1) + "\" y=\"" + (panelTop + panelHeight - 8) + "\" text-anchor=\"middle\" class=\"history-axis-label history-year-label\">" + year + "</text>").join("");
    const forecastPoints = officeRows.map(row => xAt(years.indexOf(Number(row.cycle))).toFixed(1) + "," + yAt(forecastSeats(row)).toFixed(1)).join(" ");
    const actualPoints = officeRows.map(row => xAt(years.indexOf(Number(row.cycle))).toFixed(1) + "," + yAt(Number(row.actual_dem_wins_covered)).toFixed(1)).join(" ");
    const markers = officeRows.map(row => {
      const x = xAt(years.indexOf(Number(row.cycle)));
      const forecastValue = forecastSeats(row);
      const forecastY = yAt(forecastValue);
      const actualY = yAt(Number(row.actual_dem_wins_covered));
      const forecastDescription = expectedSeats ? forecastValue.toFixed(1) + " expected Democratic seats" : Math.round(forecastValue).toLocaleString() + " Democratic calls";
      const title = office + " " + row.cycle + ": forecast " + forecastDescription + ", actual " + Number(row.actual_dem_wins_covered).toLocaleString() + " Democratic wins across " + Number(row.races).toLocaleString() + " covered races";
      return "<g><title>" + title + "</title><circle cx=\"" + x.toFixed(1) + "\" cy=\"" + forecastY.toFixed(1) + "\" r=\"5\" fill=\"" + HISTORY_COLORS[office] + "\" stroke=\"#fffefa\" stroke-width=\"2\"/><rect x=\"" + (x - 4).toFixed(1) + "\" y=\"" + (actualY - 4).toFixed(1) + "\" width=\"8\" height=\"8\" fill=\"#fffefa\" stroke=\"#5d6a7c\" stroke-width=\"2\"/></g>";
    }).join("");
    return "<g class=\"history-seat-panel\"><text x=\"" + left + "\" y=\"" + (panelTop + 16) + "\" class=\"history-panel-title\">" + office + " · " + officeRows.length + " cycles</text>" + guides + "<polyline points=\"" + forecastPoints + "\" fill=\"none\" stroke=\"" + HISTORY_COLORS[office] + "\" stroke-width=\"3\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><polyline points=\"" + actualPoints + "\" fill=\"none\" stroke=\"#5d6a7c\" stroke-width=\"2.5\" stroke-dasharray=\"6 5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>" + markers + xLabels + "</g>";
  }).join("");
  const metric = expectedSeats ? "expected_seats" : "seat_count";
  const title = HISTORY_CHART_METRICS[metric].label + " by election cycle";
  const forecastLabel = expectedSeats ? "Expected Democratic seats" : "Democratic seat calls";
  return "<svg class=\"history-chart-svg history-seat-chart-svg\" role=\"img\" aria-labelledby=\"history-svg-title history-svg-description\" viewBox=\"0 0 " + width + " " + height + "\"><title id=\"history-svg-title\">" + title + "</title><desc id=\"history-svg-description\">" + forecastLabel + " and actual Democratic wins in covered races for " + offices.join(", ") + ". Each office uses a separate vertical scale focused on its observed seat counts.</desc>" + panels + "</svg>";
}

function historyChartMarkup(rows: HistoricalMetric[], metric: HistoryMetricKey): string {
  const years = [...new Set(rows.map(row => Number(row.cycle)))].filter(Number.isFinite).sort((a, b) => a - b);
  const offices = OFFICE_ORDER.filter(office => rows.some(row => row.office === office));
  if (!years.length || !offices.length) return "<p class=\"chart-empty\">No historical results are available for this selection.</p>";
  if (metric === "seat_count") return historySeatCountChartMarkup(rows, years, offices);
  if (metric === "expected_seats") {
    const houseRows = rows.filter(row => row.office === "House" && Number.isFinite(Number(row.expected_dem_seats)));
    if (!houseRows.length) return "<p class=\"chart-empty\">Expected-seat history is available for the House only.</p>";
    return historySeatCountChartMarkup(houseRows, years, ["House"], true);
  }
  const values = rows.map(row => historyMetricValue(row, metric)).filter(Number.isFinite);
  if (!values.length) return "<p class=\"chart-empty\">No historical results are available for this selection.</p>";
  let min = Math.min(...values);
  let max = Math.max(...values);
  const span = Math.max(max - min, metric === "brier_score" ? 0.02 : metric === "accuracy" ? 0.04 : 0.5);
  const pad = span * 0.18;
  min = Math.max(0, min - pad);
  max += pad;
  if (metric === "accuracy") max = Math.min(1, max);
  if (max - min < 1e-9) max = min + 1;
  const width = 820;
  const height = 360;
  const left = 72;
  const right = 34;
  const top = 24;
  const bottom = 58;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const xAt = (index:number):number => years.length === 1 ? left + plotWidth / 2 : left + index * plotWidth / (years.length - 1);
  const yAt = (value:number):number => top + (max - value) / (max - min) * plotHeight;
  const axis = Array.from({length:5}, (_, index) => max - (max - min) * index / 4);
  const guides = axis.map(value => {
    const y = yAt(value);
    const label = metric === "accuracy" ? Math.round(value * 100) + "%" : metric === "brier_score" ? value.toFixed(2) : value.toFixed(1);
    return "<g><line x1=\"" + left + "\" y1=\"" + y.toFixed(1) + "\" x2=\"" + (width - right) + "\" y2=\"" + y.toFixed(1) + "\" class=\"history-grid-line\"/><text x=\"" + (left - 12) + "\" y=\"" + (y + 4).toFixed(1) + "\" text-anchor=\"end\" class=\"history-axis-label\">" + label + "</text></g>";
  }).join("");
  const xLabels = years.map((year, index) => "<text x=\"" + xAt(index).toFixed(1) + "\" y=\"" + (height - 20) + "\" text-anchor=\"middle\" class=\"history-axis-label history-year-label\">" + year + "</text>").join("");
  const series = offices.map(office => {
    const points = years.map(year => rows.find(row => row.office === office && Number(row.cycle) === year)).filter((row):row is HistoricalMetric => Boolean(row));
    const line = points.map(row => xAt(years.indexOf(Number(row.cycle))).toFixed(1) + "," + yAt(historyMetricValue(row, metric)).toFixed(1)).join(" ");
    const markers = points.map(row => {
      const x = xAt(years.indexOf(Number(row.cycle))).toFixed(1);
      const y = yAt(historyMetricValue(row, metric)).toFixed(1);
      return "<g><circle cx=\"" + x + "\" cy=\"" + y + "\" r=\"6\" fill=\"" + HISTORY_COLORS[office] + "\" stroke=\"#fffefa\" stroke-width=\"2\"><title>" + office + " " + row.cycle + ": " + historyMetricLabel(historyMetricValue(row, metric), metric) + " across " + Number(row.races).toLocaleString() + " covered races</title></circle><text x=\"" + x + "\" y=\"" + (Number(y) - 13).toFixed(1) + "\" text-anchor=\"middle\" class=\"history-point-label\">" + historyMetricLabel(historyMetricValue(row, metric), metric) + "</text></g>";
    }).join("");
    return "<g class=\"history-series\"><polyline points=\"" + line + "\" fill=\"none\" stroke=\"" + HISTORY_COLORS[office] + "\" stroke-width=\"3\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>" + markers + "</g>";
  }).join("");
  const title = HISTORY_CHART_METRICS[metric].label + " by election cycle";
  return "<svg class=\"history-chart-svg\" role=\"img\" aria-labelledby=\"history-svg-title history-svg-description\" viewBox=\"0 0 " + width + " " + height + "\"><title id=\"history-svg-title\">" + title + "</title><desc id=\"history-svg-description\">" + years.join(", ") + " election cycles. Each point shows " + HISTORY_CHART_METRICS[metric].label.toLowerCase() + " for covered " + offices.join(", ") + " races.</desc>" + guides + xLabels + series + "</svg>";
}

function renderHistoryRow(row: HistoricalMetric): string {
  const expectedSeats = row.expected_dem_seats === undefined || row.expected_dem_seats === null ? "—" : Number(row.expected_dem_seats).toFixed(1);
  const expectedSeatError = row.expected_seat_error === undefined || row.expected_seat_error === null ? "—" : (row.expected_seat_error > 0 ? "+" : row.expected_seat_error < 0 ? "−" : "") + Math.abs(row.expected_seat_error).toFixed(1) + " D";
  return "<tr><th scope=\"row\">" + escapeHtml(row.office) + "</th><td>" + escapeHtml(row.cycle) + "</td><td>" + Number(row.races).toLocaleString() + "</td><td>" + Number(row.margin_mae_pp).toFixed(2) + " pp</td><td>" + pct(row.accuracy) + "</td><td>" + expectedSeats + (row.expected_seat_error === undefined || row.expected_seat_error === null ? "" : " / " + Number(row.actual_dem_wins_covered).toLocaleString()) + "</td><td>" + Number(row.predicted_dem_seat_calls).toLocaleString() + " / " + Number(row.actual_dem_wins_covered).toLocaleString() + "</td><td>" + signedCount(row.signed_seat_error) + "</td><td>" + Number(row.brier_score).toFixed(3) + "</td><td>" + Number(row.log_loss).toFixed(3) + "</td></tr>";
}

async function renderRatingAccuracy(): Promise<void> {
  const table = element("rating-accuracy-table");
  if (!table) return;
  const summary = element("rating-accuracy-summary");
  const definition = element("rating-accuracy-definition");
  const caveat = element("rating-accuracy-caveat");
  const officeSelect = element<HTMLSelectElement>("rating-accuracy-office");
  try {
    const response = await fetch(assetUrl("data/category-accuracy.json"), {cache:"no-store"});
    if (!response.ok) throw new Error("The historical rating accuracy file could not be loaded.");
    const report = await response.json() as RatingAccuracy;
    if (report.schema_version !== 1 || !report.validation_years.length || !report.results["All offices"]) {
      throw new Error("The historical rating accuracy file has an unsupported format.");
    }
    if (definition) definition.textContent = report.rating_definition;
    if (caveat) caveat.textContent = report.validation_note;
    const render = (): void => {
      const scope = officeSelect?.value || "All offices";
      const result = report.results[scope];
      if (!result) {
        table.innerHTML = "<tr><td colspan=\"4\">No rating accuracy is available for this office.</td></tr>";
        if (summary) summary.textContent = "No historical rating accuracy is available.";
        return;
      }
      const rows = ["Toss-up", "Leans", "Likely", "Safe"].map(category => {
        const metric = result.categories[category];
        if (!metric) return "";
        return "<tr><th scope=\"row\">" + escapeHtml(category) + "</th><td>" + Number(metric.races).toLocaleString() + "</td><td>" + Number(metric.correct_calls).toLocaleString() + "</td><td><strong>" + (metric.accuracy === null ? "—" : pct(metric.accuracy)) + "</strong></td></tr>";
      });
      rows.push("<tr class=\"rating-accuracy-overall\"><th scope=\"row\">Overall</th><td>" + Number(result.overall.races).toLocaleString() + "</td><td>" + Number(result.overall.correct_calls).toLocaleString() + "</td><td><strong>" + (result.overall.accuracy === null ? "—" : pct(result.overall.accuracy)) + "</strong></td></tr>");
      table.innerHTML = rows.join("");
      if (summary) summary.textContent = scope + " · " + Number(result.overall.races).toLocaleString() + " historical races · " + report.validation_years.join(", ");
    };
    officeSelect?.addEventListener("change", render);
    render();
  } catch (error) {
    if (summary) summary.textContent = error instanceof Error ? error.message : "Historical rating accuracy is unavailable.";
    table.innerHTML = "<tr><td colspan=\"4\">Historical rating accuracy could not be loaded.</td></tr>";
  }
}

function renderPerformance(data: CurrentData): void {
  const history = data.historical_performance;
  const date = element("history-date");
  if (date) date.textContent = "Updated " + dateLabel(history.snapshot_date);
  const validationExplanation = element("history-validation-explanation");
  if (validationExplanation) validationExplanation.textContent = history.validation_explanation;
  const officeSelect = element<HTMLSelectElement>("history-office");
  const metricSelect = element<HTMLSelectElement>("history-metric");
  const render = (): void => {
    const office = officeSelect?.value || "All";
    const metric = (metricSelect?.value || "margin_mae_pp") as HistoryMetricKey;
    const filtered = history.metrics.filter(row => office === "All" || row.office === office);
    const annual = filtered.filter(row => row.cycle !== "Pooled").sort((a, b) => Number(a.cycle) - Number(b.cycle) || OFFICE_ORDER.indexOf(a.office) - OFFICE_ORDER.indexOf(b.office));
    const pooled = element("history-pooled");
    if (pooled) pooled.innerHTML = filtered.filter(row => row.cycle === "Pooled").sort((a, b) => OFFICE_ORDER.indexOf(a.office) - OFFICE_ORDER.indexOf(b.office)).map(row => {
      const expectedSeats = row.expected_dem_seats === undefined || row.expected_dem_seats === null || row.expected_seat_error === undefined || row.expected_seat_error === null ? "" : "<div class=\"history-card-pair\"><span>Expected D seats / covered wins <b>" + Number(row.expected_dem_seats).toFixed(1) + " / " + Number(row.actual_dem_wins_covered).toLocaleString() + "</b></span><span>Expected-seat error <b>" + (row.expected_seat_error > 0 ? "+" : row.expected_seat_error < 0 ? "−" : "") + Math.abs(row.expected_seat_error).toFixed(1) + " D</b></span></div>";
      return "<article class=\"history-card\"><span class=\"eyebrow\">" + escapeHtml(row.office) + " · ALL CYCLES</span><div class=\"history-primary-stat\"><span>Margin MAE</span><strong>" + Number(row.margin_mae_pp).toFixed(2) + " pp</strong></div><div class=\"history-card-pair\"><span>Winner accuracy <b>" + pct(row.accuracy) + "</b></span><span>Covered races <b>" + Number(row.races).toLocaleString() + "</b></span></div><div class=\"history-card-pair\"><span>Brier score <b>" + Number(row.brier_score).toFixed(3) + "</b></span><span>Log loss <b>" + Number(row.log_loss).toFixed(3) + "</b></span></div>" + expectedSeats + "<div class=\"history-card-pair\"><span>D calls / actual wins <b>" + Number(row.predicted_dem_seat_calls).toLocaleString() + " / " + Number(row.actual_dem_wins_covered).toLocaleString() + "</b></span><span>Seat-count error <b>" + signedCount(row.signed_seat_error) + "</b></span></div></article>";
    }).join("");
    const chartTitle = element("history-chart-title");
    const chartNote = element("history-chart-note");
    const chart = element("history-chart");
    const legend = element("history-chart-legend");
    if (chartTitle) chartTitle.textContent = HISTORY_CHART_METRICS[metric].label;
    if (chartNote) chartNote.textContent = HISTORY_CHART_METRICS[metric].note + ((metric === "seat_count" || metric === "expected_seats") ? " Each office uses its own vertical scale, focused around the observed range." : " The vertical scale follows the observed values.");
    if (chart) chart.innerHTML = historyChartMarkup(annual, metric);
    if (legend) legend.innerHTML = metric === "seat_count" || metric === "expected_seats"
      ? "<span><i class=\"history-legend-forecast\" style=\"--series-color:#326eb8\" aria-hidden=\"true\"></i>" + (metric === "expected_seats" ? "Expected Democratic seats" : "Forecast Democratic calls") + "</span><span><i class=\"history-legend-actual\" style=\"--series-color:#5d6a7c\" aria-hidden=\"true\"></i>Actual Democratic wins on covered races</span>"
      : OFFICE_ORDER.filter(item => annual.some(row => row.office === item)).map(item => "<span><i style=\"--series-color:" + HISTORY_COLORS[item] + "\" aria-hidden=\"true\"></i>" + item + "</span>").join("");
    const body = element("history-table");
    if (body) body.innerHTML = annual.map(row => renderHistoryRow(row)).join("");
    const count = element("history-count");
    if (count) count.textContent = [...new Set(annual.map(row => String(row.cycle)))].length + " cycles · " + annual.reduce((sum, row) => sum + row.races, 0).toLocaleString() + " covered race results";
  };
  officeSelect?.addEventListener("change", render);
  metricSelect?.addEventListener("change", render);
  render();
  void renderGenericBallotHistory();
  void renderRatingAccuracy();
}

function formatMarginPp(value: number): string {
  const prefix = value > 0 ? "+" : value < 0 ? "−" : "";
  return prefix + Math.abs(value).toFixed(2) + " pp";
}

function genericBallotHistoryChartMarkup(rows: GenericBallotHistoryRow[]): string {
  if (!rows.length) return "<p class=\"chart-empty\">No generic-ballot history is available.</p>";
  const width = 860;
  const height = 360;
  const left = 78;
  const right = 28;
  const top = 24;
  const bottom = 48;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const years = rows.map(row => row.cycle);
  const values = rows.flatMap(row => [row.forecast_margin_pp, row.poll_average_margin_pp, row.actual_house_margin_pp]);
  const observedMin = Math.min(0, ...values);
  const observedMax = Math.max(0, ...values);
  const rawStep = Math.max(1, (observedMax - observedMin) / 4);
  const stepPower = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalizedStep = rawStep / stepPower;
  const step = (normalizedStep <= 1 ? 1 : normalizedStep <= 2 ? 2 : normalizedStep <= 5 ? 5 : 10) * stepPower;
  const min = Math.floor((observedMin - step * 0.2) / step) * step;
  const max = Math.ceil((observedMax + step * 0.2) / step) * step;
  const ticks = Array.from({length:Math.round((max - min) / step) + 1}, (_, index) => min + index * step);
  const xAt = (index:number):number => years.length === 1 ? left + plotWidth / 2 : left + index * plotWidth / (years.length - 1);
  const yAt = (value:number):number => top + (max - value) / (max - min) * plotHeight;
  const guides = ticks.map(value => {
    const y = yAt(value);
    const label = value > 0 ? "+" + value : String(value);
    const lineClass = value === 0 ? "generic-history-zero-line" : "history-grid-line";
    return "<g><line x1=\"" + left + "\" y1=\"" + y.toFixed(1) + "\" x2=\"" + (width - right) + "\" y2=\"" + y.toFixed(1) + "\" class=\"" + lineClass + "\"/><text x=\"" + (left - 12) + "\" y=\"" + (y + 4).toFixed(1) + "\" text-anchor=\"end\" class=\"history-axis-label\">" + label + "</text></g>";
  }).join("");
  const xLabels = rows.map((row, index) => "<text x=\"" + xAt(index).toFixed(1) + "\" y=\"" + (height - 14) + "\" text-anchor=\"middle\" class=\"history-axis-label history-year-label\">" + row.cycle + "</text>").join("");
  const series = [
    {key:"poll_average_margin_pp" as const, label:"Polling average", color:GENERIC_HISTORY_COLORS.polling, marker:"poll"},
    {key:"actual_house_margin_pp" as const, label:"Actual House result", color:GENERIC_HISTORY_COLORS.actual, marker:"actual"},
    {key:"forecast_margin_pp" as const, label:"National estimate", color:GENERIC_HISTORY_COLORS.forecast, marker:"forecast"}
  ].map(item => {
    const points = rows.map((row, index) => ({row, x:xAt(index), y:yAt(row[item.key])}));
    const lineClass = item.marker === "actual" ? "generic-history-actual-line" : "";
    const line = "<polyline points=\"" + points.map(point => point.x.toFixed(1) + "," + point.y.toFixed(1)).join(" ") + "\" fill=\"none\" stroke=\"" + item.color + "\" stroke-width=\"" + (item.marker === "actual" ? "2.5" : "3") + "\" stroke-linecap=\"round\" stroke-linejoin=\"round\" class=\"" + lineClass + "\"/>";
    const markers = points.map(point => {
      const title = item.label + " · " + point.row.cycle + ": " + formatMarginPp(point.row[item.key]);
      const shape = item.marker === "poll"
        ? "<path d=\"M " + point.x.toFixed(1) + " " + (point.y - 6).toFixed(1) + " l 6 6 -6 6 -6 -6 Z\" class=\"generic-history-poll-marker\"/>"
        : item.marker === "actual"
          ? "<rect x=\"" + (point.x - 4).toFixed(1) + "\" y=\"" + (point.y - 4).toFixed(1) + "\" width=\"8\" height=\"8\" class=\"generic-history-actual-marker\"/>"
          : "<circle cx=\"" + point.x.toFixed(1) + "\" cy=\"" + point.y.toFixed(1) + "\" r=\"5.5\" fill=\"" + item.color + "\" stroke=\"#fffefa\" stroke-width=\"2\"/>";
      return "<g><title>" + escapeHtml(title) + "</title>" + shape + "</g>";
    }).join("");
    return line + markers;
  }).join("");
  return "<svg class=\"history-chart-svg\" role=\"img\" aria-labelledby=\"generic-history-svg-title generic-history-svg-description\" viewBox=\"0 0 " + width + " " + height + "\"><title id=\"generic-history-svg-title\">National House estimate, polling average, and actual House margin</title><desc id=\"generic-history-svg-description\">" + years.join(", ") + " national election cycles. Each point is a Democratic-minus-Republican House popular-vote margin in percentage points.</desc>" + guides + xLabels + series + "</svg>";
}

async function renderGenericBallotHistory(): Promise<void> {
  const chart = element("generic-history-chart");
  if (!chart) return;
  const summaryText = element("generic-history-summary-text");
  const legend = element("generic-history-legend");
  const table = element("generic-history-table");
  const methodNote = element("generic-history-method-note");
  try {
    const response = await fetch(assetUrl("data/generic-ballot-history.json"), {cache:"force-cache"});
    if (!response.ok) throw new Error("The generic-ballot history file could not be loaded.");
    const history = await response.json() as GenericBallotHistory;
    const expectedCycles = [2018, 2020, 2022, 2024];
    if (history.schema_version !== 1 || history.rows.length !== expectedCycles.length || history.rows.some((row, index) => row.cycle !== expectedCycles[index])) {
      throw new Error("The generic-ballot history file has an unexpected cycle series.");
    }
    const rows = history.rows;
    if (summaryText) summaryText.textContent = "Compare the national House vote estimate and polling average with the result in each election.";
    if (legend) legend.innerHTML = "<span><i style=\"--series-color:" + GENERIC_HISTORY_COLORS.forecast + "\" aria-hidden=\"true\"></i>National estimate</span><span><i style=\"--series-color:" + GENERIC_HISTORY_COLORS.polling + "\" aria-hidden=\"true\"></i>Polling average</span><span><i class=\"history-legend-actual\" style=\"--series-color:" + GENERIC_HISTORY_COLORS.actual + "\" aria-hidden=\"true\"></i>Actual House result</span>";
    chart.innerHTML = genericBallotHistoryChartMarkup(rows);
    if (table) table.innerHTML = rows.map(row => "<tr><th scope=\"row\">" + row.cycle + "</th><td>" + escapeHtml(dateLabel(row.snapshot_date)) + "</td><td>" + formatMarginPp(row.forecast_margin_pp) + "</td><td>" + formatMarginPp(row.poll_average_margin_pp) + "</td><td>" + formatMarginPp(row.actual_house_margin_pp) + "</td></tr>").join("");
    if (methodNote) {
      const sourceUrl = /^https:\/\/projects\.fivethirtyeight\.com\/polls\/generic-ballot\/?$/.test(history.poll_average_source_url) ? history.poll_average_source_url : "";
      const sourceLink = sourceUrl ? "<a href=\"" + escapeHtml(sourceUrl) + "\" target=\"_blank\" rel=\"noopener noreferrer\">FiveThirtyEight</a>" : escapeHtml(history.poll_average_source_label);
      methodNote.innerHTML = "Polling averages use archived records from " + sourceLink + ". Publication timing is unverified for some records, so these are historical comparisons rather than a day-by-day replay.";
    }
  } catch {
    if (summaryText) summaryText.textContent = "The generic-ballot history comparison is unavailable right now.";
    chart.innerHTML = "<p class=\"chart-empty\">Generic-ballot history could not be loaded.</p>";
  }
}

function renderArchiveSeatCards(snapshot: SavedForecastSnapshot | CurrentData, currentData: CurrentData): string {
  const counts = Object.fromEntries(OFFICE_ORDER.map(office => [office, snapshot.races.filter(race => race.office === office).length])) as Record<Office, number>;
  const senateFixedDem = Number(currentData.summary.senate_seat_distribution?.fixed_dem_caucus_seats);
  const senateFixedRep = Number(currentData.summary.senate_seat_distribution?.fixed_rep_seats);
  const senateBaselineIsUsable = Number.isFinite(senateFixedDem) && Number.isFinite(senateFixedRep) && senateFixedDem >= 0 && senateFixedRep >= 0;
  const offices: Array<{ office: Office; label: string; total: number; coverage: string; majority: number | null }> = [
    {office:"House", label:"House", total:counts.House, coverage:counts.House === 435 ? "All 435 districts" : counts.House + " forecast districts", majority:218},
    {office:"Senate", label:"Senate", total:counts.Senate + (senateBaselineIsUsable ? senateFixedDem + senateFixedRep : 0), coverage:senateBaselineIsUsable ? counts.Senate + " forecast races · " + (senateFixedDem + senateFixedRep) + " fixed seats" : counts.Senate + " forecast races", majority:senateBaselineIsUsable ? 51 : null},
    {office:"Governor", label:"Governor", total:counts.Governor, coverage:counts.Governor + " races on the ballot · not all 50 states", majority:null}
  ];
  return offices.map(entry => {
    const races = snapshot.races.filter(race => race.office === entry.office);
    const raceDem = races.reduce((sum, race) => sum + Number(race.dem_probability || 0), 0);
    const raceRep = races.reduce((sum, race) => sum + Number(race.rep_probability || 0), 0);
    const fixedDem = entry.office === "Senate" && senateBaselineIsUsable ? senateFixedDem : 0;
    const fixedRep = entry.office === "Senate" && senateBaselineIsUsable ? senateFixedRep : 0;
    const expectedDem = raceDem + fixedDem;
    const expectedRep = raceRep + fixedRep;
    const totalExpected = expectedDem + expectedRep;
    const denominator = totalExpected > 0 ? totalExpected : Math.max(entry.total, 1);
    const demShare = Math.max(0, Math.min(100, expectedDem / denominator * 100));
    const repShare = Math.max(0, Math.min(100, expectedRep / denominator * 100));
    const competitive = races.filter(race => Number(race.dem_probability) >= 0.35 && Number(race.dem_probability) <= 0.65).length;
    const net = expectedDem - expectedRep;
    const netLabel = Math.abs(net) < 0.05 ? "Expected seats even" : (net > 0 ? "Democrats" : "Republicans") + " lead by " + Math.abs(net).toFixed(1);
    const majorityMarker = entry.majority && entry.total ? "<span class=\"archive-majority-marker\" style=\"left:" + Math.min(100, entry.majority / entry.total * 100).toFixed(2) + "%\" aria-hidden=\"true\"></span>" : "";
    const majorityLabel = entry.majority ? "<p class=\"archive-majority-note\">" + entry.majority + " seats for a majority</p>" : "";
    const isCurrent = snapshot.snapshot_date === currentData.snapshot_date;
    let rangeNote = "<p class=\"archive-range-note\">Seat range not available for this saved release.</p>";
    if (isCurrent) {
      try {
        const range = officeSeatRanges(currentData, entry.office);
        rangeNote = "<p class=\"archive-range-note\">Central 50%: " + range.central50[0] + "–" + range.central50[1] + " Democratic " + (entry.office === "Governor" ? "wins" : "seats") + " · Central 90%: " + range.central90[0] + "–" + range.central90[1] + "</p>";
      } catch { /* A missing distribution does not hide the expected seat totals. */ }
    }
    const accessibleBar = escapeHtml(entry.label + ": expected Democratic " + expectedDem.toFixed(1) + ", Republican " + expectedRep.toFixed(1) + (entry.majority ? "; majority at " + entry.majority : ""));
    return "<article class=\"archive-seat-card archive-seat-" + entry.office.toLowerCase() + "\"><div class=\"archive-seat-card-head\"><div><p class=\"eyebrow\">" + escapeHtml(entry.coverage.toUpperCase()) + "</p><h3>" + escapeHtml(entry.label) + "</h3></div><span class=\"archive-net-pill\">" + escapeHtml(netLabel) + "</span></div><div class=\"archive-party-counts\"><div><span class=\"archive-party-label archive-dem-label\"><i aria-hidden=\"true\"></i>Democratic</span><strong>" + expectedDem.toFixed(1) + "</strong></div><div><span class=\"archive-party-label archive-rep-label\"><i aria-hidden=\"true\"></i>Republican</span><strong>" + expectedRep.toFixed(1) + "</strong></div></div><div class=\"archive-seat-bar\" role=\"img\" aria-label=\"" + accessibleBar + "\"><span class=\"archive-seat-bar-dem\" style=\"width:" + demShare.toFixed(2) + "%\"></span><span class=\"archive-seat-bar-rep\" style=\"width:" + repShare.toFixed(2) + "%\"></span>" + majorityMarker + "</div>" + majorityLabel + rangeNote + "<div class=\"archive-seat-footer\"><span><strong>" + competitive + "</strong> competitive races</span><small>35–65% chance for either party</small></div></article>";
  }).join("");
}

interface ArchiveTrendPoint {
  snapshot_date: string;
  generic_ballot_margin_pp: number | null;
  seats: Record<Office, { dem: number; rep: number; races: number }>;
}

interface ArchiveTrendSeries {
  label: string;
  color: "dem" | "rep" | "generic";
  value: (point: ArchiveTrendPoint) => number;
}

function archiveTrendDate(value: string): string {
  const date = new Date(value + "T00:00:00Z");
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString("en-US", {month:"short", day:"numeric", year:"2-digit", timeZone:"UTC"});
}

function archiveTrendChartMarkup(id: string, title: string, unit: string, points: ArchiveTrendPoint[], series: ArchiveTrendSeries[], formatter: (value: number) => string): string {
  if (!points.length || !series.length) return "<div class=\"archive-trend-chart chart-empty\">No saved forecast values are available.</div>";
  const width = 780;
  const height = 320;
  const left = 72;
  const right = 24;
  const top = 24;
  const bottom = 58;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const values = points.flatMap(point => series.map(item => item.value(point))).filter(Number.isFinite);
  if (!values.length) return "<div class=\"archive-trend-chart chart-empty\">No saved forecast values are available.</div>";
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const pad = Math.max((rawMax - rawMin) * 0.18, unit === "pp" ? 0.5 : 1);
  const min = rawMin - pad;
  const max = rawMax + pad;
  const xAt = (index: number): number => points.length === 1 ? left + plotWidth / 2 : left + index * plotWidth / (points.length - 1);
  const yAt = (value: number): number => top + (max - value) / (max - min) * plotHeight;
  const guides = Array.from({length:5}, (_, index) => {
    const value = min + (max - min) * index / 4;
    const y = yAt(value);
    return "<g><line x1=\"" + left + "\" y1=\"" + y.toFixed(1) + "\" x2=\"" + (width - right) + "\" y2=\"" + y.toFixed(1) + "\" class=\"history-grid-line\"/><text x=\"" + (left - 10) + "\" y=\"" + (y + 4).toFixed(1) + "\" text-anchor=\"end\" class=\"history-axis-label\">" + (unit === "pp" && value > 0 ? "+" : "") + value.toFixed(unit === "pp" ? 1 : 0) + "</text></g>";
  }).join("");
  const xLabels = points.map((point, index) => "<text x=\"" + xAt(index).toFixed(1) + "\" y=\"" + (height - 16) + "\" text-anchor=\"middle\" class=\"history-axis-label history-year-label\">" + escapeHtml(archiveTrendDate(point.snapshot_date)) + "</text>").join("");
  const plotted = series.map(item => {
    const coordinates = points.map(point => ({point, value:item.value(point)}));
    const line = coordinates.map((entry, index) => xAt(index).toFixed(1) + "," + yAt(entry.value).toFixed(1)).join(" ");
    const markers = coordinates.map((entry, index) => {
      const titleText = item.label + " · " + dateLabel(entry.point.snapshot_date) + ": " + formatter(entry.value);
      return "<g><title>" + escapeHtml(titleText) + "</title><circle class=\"archive-trend-point-" + item.color + "\" cx=\"" + xAt(index).toFixed(1) + "\" cy=\"" + yAt(entry.value).toFixed(1) + "\" r=\"5.5\"/></g>";
    }).join("");
    return "<g><polyline class=\"archive-trend-line-" + item.color + "\" points=\"" + line + "\" fill=\"none\" stroke-width=\"3\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>" + markers + "</g>";
  }).join("");
  const legend = series.map(item => "<span><i class=\"archive-trend-legend-" + item.color + "\" aria-hidden=\"true\"></i>" + escapeHtml(item.label) + "</span>").join("");
  const desc = points.map(point => archiveTrendDate(point.snapshot_date)).join(", ");
  return "<div class=\"history-chart-legend archive-trend-legend\">" + legend + "</div><div class=\"archive-trend-chart history-chart-scroll\" role=\"region\" aria-label=\"" + escapeHtml(title + " chart") + "\" tabindex=\"0\"><svg class=\"history-chart-svg archive-trend-svg\" role=\"img\" aria-labelledby=\"" + id + "-title " + id + "-description\" viewBox=\"0 0 " + width + " " + height + "\"><title id=\"" + id + "-title\">" + escapeHtml(title) + "</title><desc id=\"" + id + "-description\">" + escapeHtml(title + " across saved releases on " + desc + ". Vertical axis shows " + unit + " and is focused on the observed range.") + "</desc>" + guides + xLabels + plotted + "</svg></div>";
}

function archiveTrendPanelMarkup(id: string, eyebrow: string, title: string, note: string, points: ArchiveTrendPoint[], series: ArchiveTrendSeries[], unit: string, formatter: (value: number) => string): string {
  return "<article class=\"content-panel archive-trend-card\"><p class=\"eyebrow\">" + escapeHtml(eyebrow) + "</p><h3>" + escapeHtml(title) + "</h3><p class=\"archive-chart-note\">" + escapeHtml(note) + "</p>" + archiveTrendChartMarkup(id, title, unit, points, series, formatter) + "</article>";
}

function archiveTrendMarkup(snapshots: Array<SavedForecastSnapshot | CurrentData>, currentData: CurrentData): string {
  const senateFixedDem = Number(currentData.summary.senate_seat_distribution?.fixed_dem_caucus_seats);
  const senateFixedRep = Number(currentData.summary.senate_seat_distribution?.fixed_rep_seats);
  const points = snapshots.map(snapshot => {
    const genericValue = snapshot.summary?.generic_ballot_forecast?.margin_pp;
    const seats = Object.fromEntries(OFFICE_ORDER.map(office => {
      const races = snapshot.races.filter(race => race.office === office);
      const raceDem = races.reduce((sum, race) => sum + Number(race.dem_probability || 0), 0);
      const raceRep = races.reduce((sum, race) => sum + Number(race.rep_probability || 0), 0);
      return [office, {
        dem: raceDem + (office === "Senate" && Number.isFinite(senateFixedDem) ? senateFixedDem : 0),
        rep: raceRep + (office === "Senate" && Number.isFinite(senateFixedRep) ? senateFixedRep : 0),
        races: races.length
      }];
    })) as Record<Office, { dem: number; rep: number; races: number }>;
    return {
      snapshot_date: snapshot.snapshot_date,
      generic_ballot_margin_pp: typeof genericValue === "number" && Number.isFinite(genericValue) ? genericValue : null,
      seats
    };
  }).sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
  const genericPoints = points.filter(point => point.generic_ballot_margin_pp !== null);
  const genericNote = "Recorded Democratic-minus-Republican national House popular-vote forecast, in percentage points, for " + genericPoints.length + " of " + points.length + " saved releases. Historical values are reconstructed from the saved cutoff inputs using the current public forecasting method.";
  const seatNote = "Expected seats/wins sum each race’s party win probabilities. The Senate series adds 34 fixed Democratic-caucus seats and 31 fixed Republican seats, matching the seat cards. The vertical axis is focused on the observed range.";
  const genericPanel = archiveTrendPanelMarkup("archive-generic-trend", "NATIONAL HOUSE POPULAR VOTE", "Generic-ballot forecast", genericNote, genericPoints, [
    {label:"Forecast margin (D−R)", color:"generic", value:point => Number(point.generic_ballot_margin_pp)}
  ], "pp", formatMarginPp);
  const seatPanels = OFFICE_ORDER.map(office => archiveTrendPanelMarkup(
    "archive-" + office.toLowerCase() + "-trend",
    office === "House" ? "ALL 435 DISTRICTS" : office === "Senate" ? "35 RACES · 65 FIXED SEATS" : "RACES ON THE BALLOT",
    office + " expected seats",
    office === "Governor" ? "Expected Democratic and Republican wins among the " + points.at(-1)?.seats.Governor.races + " governor races on the ballot, not all 50 states. " + seatNote : seatNote,
    points,
    [
      {label:"Expected Democratic", color:"dem", value:point => point.seats[office].dem},
      {label:"Expected Republican", color:"rep", value:point => point.seats[office].rep}
    ],
    "seats",
    value => value.toFixed(1) + " seats"
  )).join("");
  return "<section class=\"content-panel archive-trend-panel\" aria-labelledby=\"archive-trend-title\"><div class=\"archive-section-heading\"><div><p class=\"eyebrow\">RELEASE TO RELEASE</p><h2 id=\"archive-trend-title\">Forecast trends</h2></div></div><p class=\"archive-intro\">Each point is a saved release. Historical releases are reconstructed from their saved cutoff inputs using the current public forecasting method; they are not the values originally shown on those dates. No daily values are interpolated.</p><div class=\"archive-trend-grid\">" + genericPanel + seatPanels + "</div></section>";
}

function archiveWinner(race: ForecastRace): "Democratic" | "Republican" | "Tie" {
  const dem = Number(race.dem_probability);
  const rep = Number(race.rep_probability);
  if (Math.abs(dem - rep) < 1e-12) return "Tie";
  return dem > rep ? "Democratic" : "Republican";
}

function archiveCategoryLabel(race: ForecastRace): string {
  const winner = archiveWinner(race);
  return rating(race.dem_probability, race.office) + " " + (winner === "Democratic" ? "D" : winner === "Republican" ? "R" : "Even");
}

function archiveCategoryPill(race: ForecastRace): string {
  const winner = archiveWinner(race);
  const lean = winner === "Democratic" ? "dem" : winner === "Republican" ? "rep" : "neutral";
  const label = archiveCategoryLabel(race);
  const accessibleLabel = winner === "Tie" ? label : (winner === "Democratic" ? "Democratic" : "Republican") + " " + rating(race.dem_probability, race.office);
  return `<span class="archive-category-pill ${lean}" aria-label="${escapeHtml(accessibleLabel)}">${escapeHtml(label)}</span>`;
}

function archiveDeltaLabel(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return sign + Math.abs(value).toFixed(2) + " pp";
}

type ArchiveSortKey = "impact" | "office" | "race" | "priorCall" | "newCall" | "flip" | "category" | "margin" | "probability";

function archiveSortValue(row: HTMLTableRowElement, key: ArchiveSortKey): string | number | null {
  if (key === "impact") return Number(row.dataset.impactScore);
  if (key === "office") return row.dataset.office || "";
  if (key === "race") return row.dataset.raceName || "";
  if (key === "priorCall") return row.dataset.priorCall || "";
  if (key === "newCall") return row.dataset.newCall || "";
  if (key === "flip") return row.dataset.callFlipped === "true" ? 1 : 0;
  if (key === "category") return row.dataset.categoryLabel || "";
  const raw = key === "margin" ? row.dataset.marginDelta : row.dataset.probabilityDelta;
  return raw === undefined || raw === "" || !Number.isFinite(Number(raw)) ? null : Number(raw);
}

function sortArchiveRaceRows(holder: HTMLElement, key: ArchiveSortKey, direction?: "asc" | "desc"): void {
  const table = holder.querySelector<HTMLTableElement>(".archive-change-table");
  const body = table?.tBodies[0];
  if (!table || !body) return;
  const currentKey = holder.dataset.sortKey as ArchiveSortKey | undefined;
  const currentDirection = holder.dataset.sortDirection === "asc" ? "asc" : "desc";
  let nextDirection = direction;
  if (!nextDirection) {
    nextDirection = currentKey === key
      ? currentDirection === "desc" ? "asc" : "desc"
      : ["impact", "flip", "margin", "probability"].includes(key) ? "desc" : "asc";
  }
  holder.dataset.sortKey = key;
  holder.dataset.sortDirection = nextDirection;
  const rows = [...body.querySelectorAll<HTMLTableRowElement>("tr[data-archive-race-row]")];
  rows.sort((a, b) => {
    const left = archiveSortValue(a, key);
    const right = archiveSortValue(b, key);
    if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
    const comparison = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right));
    return nextDirection === "asc" ? comparison : -comparison;
  });
  rows.forEach(row => body.append(row));
  table.querySelectorAll<HTMLTableCellElement>("thead th[data-sort-key]").forEach(cell => {
    const active = cell.dataset.sortKey === key;
    cell.setAttribute("aria-sort", active ? nextDirection === "asc" ? "ascending" : "descending" : "none");
    const indicator = cell.querySelector<HTMLElement>(".archive-sort-indicator");
    if (indicator) indicator.textContent = active ? nextDirection === "asc" ? "↑" : "↓" : "↕";
  });
  const status = holder.querySelector<HTMLElement>("#archive-change-sort-status");
  const label: Record<ArchiveSortKey, string> = { impact:"change impact", office:"office", race:"race name", priorCall:"prior call", newCall:"new call", flip:"call flip", category:"category", margin:"margin change", probability:"win chance change" };
  const ordering = key === "flip"
    ? nextDirection === "desc" ? ", flipped first." : ", unchanged first."
    : ["impact", "margin", "probability"].includes(key)
      ? nextDirection === "desc" ? ", largest first." : ", smallest first."
      : nextDirection === "desc" ? ", Z–A." : ", A–Z.";
  if (status) status.textContent = "Sorted by " + label[key] + ordering;
}

function filterArchiveRaceRows(holder: HTMLElement): void {
  const filter = holder.querySelector<HTMLSelectElement>("#archive-change-filter");
  const officeFilter = holder.querySelector<HTMLSelectElement>("#archive-office-filter");
  const rows = [...holder.querySelectorAll<HTMLTableRowElement>("tr[data-archive-race-row]")];
  const visibleCount = holder.querySelector<HTMLElement>("#archive-change-visible-count");
  if (!filter) return;
  let visible = 0;
  rows.forEach(row => {
    const flipped = row.dataset.callFlipped === "true";
    const categoryChanged = row.dataset.categoryChanged === "true";
    const numericLarge = row.dataset.numericLarge === "true";
    const officeMatches = !officeFilter || officeFilter.value === "all" || row.dataset.office?.toLowerCase() === officeFilter.value;
    const changeMatches = filter.value === "all"
      || (filter.value === "flips" && flipped)
      || (filter.value === "large" && (flipped || categoryChanged || numericLarge))
      || (filter.value === "numeric" && numericLarge)
      || (filter.value === "category" && categoryChanged)
      || (filter.value === "either" && (flipped || categoryChanged));
    row.hidden = !(officeMatches && changeMatches);
    if (!row.hidden) visible += 1;
  });
  if (visibleCount) visibleCount.textContent = "Showing " + visible.toLocaleString() + " of " + rows.length.toLocaleString() + " races";
}

function renderArchiveRaceChanges(newer: SavedForecastSnapshot | CurrentData, older: SavedForecastSnapshot | CurrentData | undefined): string {
  if (!older) {
    return "<section class=\"content-panel archive-change-panel\"><div class=\"archive-change-heading\"><div><p class=\"eyebrow\">RACE-BY-RACE</p><h2>Changes since the prior release</h2></div></div><p class=\"archive-intro\">No earlier saved release is available for comparison.</p></section>";
  }
  const newerById = new Map(newer.races.map(race => [race.race_id, race]));
  const olderById = new Map(older.races.map(race => [race.race_id, race]));
  const raceIds = [...new Set([...older.races.map(race => race.race_id), ...newer.races.map(race => race.race_id)])];
  const rows = raceIds.map(raceId => {
    const previous = olderById.get(raceId);
    const currentRace = newerById.get(raceId);
    const reference = currentRace || previous;
    if (!reference) return "";
    const callFlipped = Boolean(previous && currentRace && archiveWinner(previous) !== archiveWinner(currentRace));
    const previousCategory = previous ? archiveCategoryLabel(previous) : "";
    const currentCategory = currentRace ? archiveCategoryLabel(currentRace) : "";
    const categoryChanged = Boolean(previous && currentRace && previousCategory !== currentCategory);
    const marginDelta = previous && currentRace && typeof currentRace.dem_margin_pp === "number" && typeof previous.dem_margin_pp === "number" ? currentRace.dem_margin_pp - previous.dem_margin_pp : null;
    const probabilityDelta = previous && currentRace ? (Number(currentRace.dem_probability) - Number(previous.dem_probability)) * 100 : null;
    const numericLarge = (marginDelta !== null && Math.abs(marginDelta) >= 5) || (probabilityDelta !== null && Math.abs(probabilityDelta) >= 5);
    const status = !previous ? "Added" : !currentRace ? "Removed" : "Matched";
    const categoryLabel = previous && currentRace
      ? previousCategory === currentCategory ? previousCategory + " · same" : previousCategory + " → " + currentCategory
      : status;
    const categoryMarkup = previous && currentRace
      ? categoryChanged
        ? `<span class="archive-category-sequence">${archiveCategoryPill(previous)}<span class="archive-category-arrow" aria-hidden="true">→</span>${archiveCategoryPill(currentRace)}</span>`
        : `<span class="archive-category-sequence">${archiveCategoryPill(currentRace)}<span class="archive-category-same">same</span></span>`
      : `<span class="archive-category-sequence"><span class="archive-category-pill neutral">${escapeHtml(status)}</span></span>`;
    const hasNumericChange = (marginDelta !== null && Math.abs(marginDelta) >= 0.01) || (probabilityDelta !== null && Math.abs(probabilityDelta) >= 0.01);
    const impactLabel = callFlipped ? "Winner flipped" : numericLarge ? "Large shift" : categoryChanged ? "Category changed" : status !== "Matched" ? status : hasNumericChange ? "Smaller shift" : "No material change";
    const impactTier = callFlipped ? 4 : numericLarge ? 3 : categoryChanged ? 2 : status !== "Matched" ? 1 : 0;
    const impactScore = impactTier * 100000 + Math.round(Math.max(Math.abs(marginDelta || 0), Math.abs(probabilityDelta || 0)) * 100);
    const deltaClass = (value: number | null) => value === null || !Number.isFinite(value) ? "" : value > 0 ? " archive-delta-positive" : value < 0 ? " archive-delta-negative" : "";
    const priorCall = previous ? archiveWinner(previous) : "";
    const newCall = currentRace ? archiveWinner(currentRace) : "";
    const raceLabel = raceName(reference);
    const flipDirectionClass = !callFlipped ? "" : newCall === "Democratic" ? " dem" : newCall === "Republican" ? " rep" : " neutral";
    const impactClass = callFlipped ? " is-flipped" + flipDirectionClass : numericLarge || categoryChanged ? " is-major" : "";
    const changeClass = callFlipped ? " is-changed" + flipDirectionClass : "";
    return `<tr data-archive-race-row data-office="${escapeHtml(reference.office)}" data-race-name="${escapeHtml(raceLabel)}" data-prior-call="${escapeHtml(priorCall)}" data-new-call="${escapeHtml(newCall)}" data-call-flipped="${callFlipped}" data-category-changed="${categoryChanged}" data-numeric-large="${numericLarge}" data-category-label="${escapeHtml(categoryLabel)}" data-impact-score="${impactScore}" data-margin-delta="${marginDelta === null ? "" : marginDelta}" data-probability-delta="${probabilityDelta === null ? "" : probabilityDelta}">
      <td><span class="archive-impact-badge${impactClass}">${escapeHtml(impactLabel)}</span></td>
      <td>${escapeHtml(reference.office)}</td>
      <th scope="row"><a href="${escapeHtml(raceUrl(reference.race_id))}">${escapeHtml(raceLabel)}</a></th>
      <td>${previous ? escapeHtml(priorCall) : "—"}</td>
      <td>${currentRace ? escapeHtml(newCall) : "—"}</td>
      <td><span class="archive-change-badge${changeClass}">${previous && currentRace ? callFlipped ? "Flipped" : "No" : status}</span></td>
      <td>${categoryMarkup}</td>
      <td class="archive-delta${deltaClass(marginDelta)}">${archiveDeltaLabel(marginDelta)}</td>
      <td class="archive-delta${deltaClass(probabilityDelta)}">${archiveDeltaLabel(probabilityDelta)}</td>
    </tr>`;
  });
  const matched = raceIds.filter(id => olderById.has(id) && newerById.has(id));
  const flipped = matched.filter(id => archiveWinner(olderById.get(id)!) !== archiveWinner(newerById.get(id)!)).length;
  const categoryChanged = matched.filter(id => archiveCategoryLabel(olderById.get(id)!) !== archiveCategoryLabel(newerById.get(id)!)).length;
  const largeShifts = matched.filter(id => {
    const oldRace = olderById.get(id)!;
    const newRace = newerById.get(id)!;
    const marginLarge = typeof newRace.dem_margin_pp === "number" && typeof oldRace.dem_margin_pp === "number" && Math.abs(newRace.dem_margin_pp - oldRace.dem_margin_pp) >= 5;
    const probabilityLarge = Math.abs((Number(newRace.dem_probability) - Number(oldRace.dem_probability)) * 100) >= 5;
    return marginLarge || probabilityLarge;
  }).length;
  const added = raceIds.filter(id => !olderById.has(id) && newerById.has(id)).length;
  const removed = raceIds.filter(id => olderById.has(id) && !newerById.has(id)).length;
  const olderDate = dateLabel(older.snapshot_date);
  const newerDate = dateLabel(newer.snapshot_date);
  const lineage = "Archived releases can have different source dates and inputs; these are descriptive comparisons, not a day-by-day replay or attribution to newly added polls.";
  const releaseNotes = ["archive_note" in older ? older.archive_note : undefined, "archive_note" in newer ? newer.archive_note : undefined]
    .filter((note): note is string => Boolean(note))
    .map(note => note.replace(/,?\s*so this snapshot is not compared with later releases\.?/i, "."));
  const releaseNoteMarkup = releaseNotes.length ? "<p class=\"archive-change-lineage\">Release notes: " + releaseNotes.map(escapeHtml).join(" · ") + "</p>" : "";
  const summary = matched.length.toLocaleString() + " matched · " + flipped.toLocaleString() + " winner calls flipped · " + categoryChanged.toLocaleString() + " category changes · " + largeShifts.toLocaleString() + " shifts ≥5 pp · " + added.toLocaleString() + " added · " + removed.toLocaleString() + " removed";
  const sortHeader = (label: string, key: ArchiveSortKey) => "<th scope=\"col\" data-sort-key=\"" + key + "\" aria-sort=\"" + (key === "impact" ? "descending" : "none") + "\"><button class=\"archive-sort-button\" type=\"button\" data-sort-key=\"" + key + "\" aria-label=\"Sort by " + escapeHtml(label.toLowerCase()) + "\">" + escapeHtml(label) + " <span class=\"archive-sort-indicator\" aria-hidden=\"true\">" + (key === "impact" ? "↓" : "↕") + "</span></button></th>";
  return "<section class=\"content-panel archive-change-panel\"><div class=\"archive-change-heading\"><div><p class=\"eyebrow\">RACE-BY-RACE · " + escapeHtml(olderDate) + " → " + escapeHtml(newerDate) + "</p><h2>What changed since the prior release</h2></div><span class=\"archive-change-summary\">" + escapeHtml(summary) + "</span></div><p class=\"archive-intro\">" + escapeHtml(newerDate) + " is compared with the immediately older saved release, " + escapeHtml(olderDate) + ". Changes are newer minus older; margin and Democratic win-chance deltas are in percentage points. Winner calls use the higher party probability. Category labels use the site definitions: " + escapeHtml(ratingBandDescription("House")) + ".</p><p class=\"archive-change-sort-status\" id=\"archive-change-sort-status\" aria-live=\"polite\">Rows start with flipped calls, then large shifts and category changes. A large shift is at least 5 pp in margin or Democratic win chance.</p><p class=\"archive-change-lineage\">" + lineage + " Differences are descriptive because source dates and inputs may differ; they cannot be attributed to newly added polls alone.</p>" + releaseNoteMarkup + "<div class=\"archive-change-controls\"><label for=\"archive-office-filter\">Office <select id=\"archive-office-filter\"><option value=\"all\">All offices</option><option value=\"house\">House</option><option value=\"senate\">Senate</option><option value=\"governor\">Governor</option></select></label><label for=\"archive-change-filter\">Show <select id=\"archive-change-filter\"><option value=\"all\">All races</option><option value=\"flips\">Winner calls flipped</option><option value=\"large\">Large changes</option><option value=\"numeric\">Numeric shift ≥5 pp</option><option value=\"category\">Category changed</option><option value=\"either\">Winner or category changed</option></select></label><span id=\"archive-change-visible-count\" aria-live=\"polite\"></span></div><div class=\"archive-change-table-wrap\"><table class=\"archive-change-table\"><thead><tr>" + sortHeader("Change", "impact") + sortHeader("Office", "office") + sortHeader("Race", "race") + sortHeader("Prior call", "priorCall") + sortHeader("New call", "newCall") + sortHeader("Call flipped?", "flip") + sortHeader("Category, prior → new", "category") + sortHeader("Margin change", "margin") + sortHeader("D win chance change", "probability") + "</tr></thead><tbody>" + rows.join("") + "</tbody></table></div></section>";
}

async function renderSnapshotArchive(data: CurrentData): Promise<void> {
  const root = element("changes-content");
  if (!root) return;
  root.innerHTML = "<div class=\"archive-view-tabs\" role=\"tablist\" aria-label=\"Forecast archive views\"><button id=\"archive-published-tab\" type=\"button\" role=\"tab\" aria-selected=\"true\" aria-controls=\"archive-published-view\">Published forecasts</button><button id=\"archive-simulated-tab\" type=\"button\" role=\"tab\" aria-selected=\"false\" aria-controls=\"archive-simulated-view\" tabindex=\"-1\">Simulated history</button></div><div id=\"archive-published-view\" role=\"tabpanel\" aria-labelledby=\"archive-published-tab\"><section class=\"content-panel\"><p>Loading the published forecast archive…</p></section></div><div id=\"archive-simulated-view\" role=\"tabpanel\" aria-labelledby=\"archive-simulated-tab\" hidden><div id=\"simulated-history-content\"></div></div>";
  const holder = element("archive-published-view");
  const simulatedView = element("archive-simulated-view");
  if (!holder || !simulatedView) return;
  const publishedTab = element<HTMLButtonElement>("archive-published-tab");
  const simulatedTab = element<HTMLButtonElement>("archive-simulated-tab");
  const pageContext = element<HTMLElement>("archive-context");
  let simulatedReady = false;
  let publishedArchiveLoad: Promise<void> | null = null;
  const selectView = (view: "published" | "simulated"): void => {
    const isSimulated = view === "simulated";
    holder.hidden = isSimulated;
    simulatedView.hidden = !isSimulated;
    if (publishedTab && simulatedTab) {
      publishedTab.setAttribute("aria-selected", String(!isSimulated));
      simulatedTab.setAttribute("aria-selected", String(isSimulated));
      publishedTab.tabIndex = isSimulated ? -1 : 0;
      simulatedTab.tabIndex = isSimulated ? 0 : -1;
    }
    if (pageContext) pageContext.hidden = isSimulated;
    if (isSimulated && !simulatedReady) {
      simulatedReady = true;
      const target = element("simulated-history-content");
      if (target) void renderSimulatedHistory(target, data);
    } else if (!isSimulated) void loadPublishedArchive();
  };
  root.addEventListener("click", event => {
    const tab = (event.target as HTMLElement).closest<HTMLButtonElement>("button[role='tab']");
    if (tab === publishedTab) selectView("published");
    else if (tab === simulatedTab) selectView("simulated");
  });
  const initialView = new URLSearchParams(window.location.search).get("view") === "simulated" ? "simulated" : "published";
  const loadPublishedArchive = (): Promise<void> => {
    if (publishedArchiveLoad) return publishedArchiveLoad;
    publishedArchiveLoad = (async (): Promise<void> => {
      try {
    const response = await fetch(assetUrl("data/snapshots/index.json"), {cache:"no-store"});
    if (!response.ok) throw new Error("The saved forecast index could not be loaded.");
    const index = await response.json() as SnapshotIndex;
    const entries = index.schema_version === data.schema_version && index.series_id === data.series_id
      ? index.snapshots.filter(entry => entry.series_id === data.series_id && entry.schema_version === data.schema_version && entry.snapshot_date < data.snapshot_date).sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date))
      : [];
    const archivedOptions = entries.map(entry => {
      const pathIsLocalSnapshot = entry.path.startsWith("data/snapshots/") && !entry.path.split("/").includes("..");
      return "<button class=\"archive-release-choice\" type=\"button\" data-snapshot-id=\"" + escapeHtml(entry.snapshot_id) + "\" data-snapshot-path=\"" + escapeHtml(pathIsLocalSnapshot ? entry.path : "") + "\" aria-pressed=\"false\"" + (pathIsLocalSnapshot ? "" : " disabled") + "><span>" + escapeHtml(dateLabel(entry.snapshot_date)) + "</span><small>Reconstructed replay</small></button>";
    }).join("");
    holder.innerHTML = "<div id=\"archive-trends\"><section class=\"content-panel archive-trend-panel\"><p class=\"archive-loading\">Loading saved forecast trends…</p></section></div><section class=\"content-panel archive-release-panel\"><div class=\"section-title-row archive-section-heading\"><div><p class=\"eyebrow\">" + (entries.length + 1).toLocaleString() + " SAVED RELEASES</p><h2>Seat outlook by date</h2></div><span class=\"archive-current-tag\">Current: " + escapeHtml(dateLabel(data.snapshot_date)) + "</span></div><p class=\"archive-intro\">Select a release to see its seat estimates and race-by-race changes from the immediately older reconstructed release. Earlier values are rebuilt from saved cutoff inputs and may differ from the forecast originally shown on that date.</p><div class=\"archive-release-picker\" role=\"group\" aria-label=\"Choose a saved forecast release\"><button class=\"archive-release-choice is-selected\" type=\"button\" data-snapshot-id=\"current\" data-snapshot-path=\"current\" aria-pressed=\"true\"><span>" + escapeHtml(dateLabel(data.snapshot_date)) + "</span><small>Current forecast</small></button>" + archivedOptions + "</div><p id=\"archive-release-note\" class=\"archive-release-note\" aria-live=\"polite\">Current published forecast.</p><div id=\"archive-seat-overview\" class=\"archive-seat-overview\" aria-live=\"polite\">" + renderArchiveSeatCards(data, data) + "</div><p class=\"archive-seat-method\">Seat counts add the listed Democratic and Republican win chances. Senate totals include 65 seats already held. Seat ranges are estimates that may miss shared movement across races; they are not party-control probabilities.</p></section><div id=\"archive-race-changes\" aria-live=\"polite\"><section class=\"content-panel archive-change-panel\"><p class=\"archive-loading\">Loading race-by-race changes…</p></section></div>";
    const overview = element("archive-seat-overview");
    const note = element<HTMLParagraphElement>("archive-release-note");
    const changes = element("archive-race-changes");
    const choices = [...holder.querySelectorAll<HTMLButtonElement>("button[data-snapshot-path]")];
    const cache = new Map<string, SavedForecastSnapshot | CurrentData>([[data.snapshot_id, data]]);
    let selectionSequence = 0;
    const loadSnapshot = async (entry: SnapshotIndex["snapshots"][number]): Promise<SavedForecastSnapshot | CurrentData> => {
      const cached = cache.get(entry.snapshot_id);
      if (cached) return cached;
      if (!entry.path.startsWith("data/snapshots/") || entry.path.split("/").includes("..")) throw new Error("This saved release path is not available.");
      const snapshotResponse = await fetch(assetUrl(entry.path), {cache:"force-cache"});
      if (!snapshotResponse.ok) throw new Error("This saved release could not be loaded.");
      const snapshot = await snapshotResponse.json() as SavedForecastSnapshot;
      if (snapshot.schema_version !== data.schema_version || snapshot.series_id !== data.series_id || snapshot.snapshot_id !== entry.snapshot_id || !Array.isArray(snapshot.races)) throw new Error("This saved release does not match the current forecast series.");
      cache.set(entry.snapshot_id, snapshot);
      return snapshot;
    };
    const loadTrends = async (): Promise<void> => {
      const trendHolder = element("archive-trends");
      if (!trendHolder) return;
      const archived = await Promise.all(entries.map(async entry => {
        try { return await loadSnapshot(entry); } catch { return null; }
      }));
      const available = archived.filter((snapshot): snapshot is SavedForecastSnapshot | CurrentData => snapshot !== null);
      trendHolder.innerHTML = archiveTrendMarkup([data, ...available], data);
    };
    void loadTrends();
    const showRelease = async (button: HTMLButtonElement): Promise<void> => {
      const sequence = ++selectionSequence;
      const path = button.dataset.snapshotPath || "";
      const snapshotId = button.dataset.snapshotId || "";
      if (!path || !overview || !changes) return;
      choices.forEach(choice => {
        const selected = choice === button;
        choice.classList.toggle("is-selected", selected);
        choice.setAttribute("aria-pressed", String(selected));
      });
      button.disabled = true;
      overview.innerHTML = "<p class=\"archive-loading\">Loading saved seat outlook…</p>";
      changes.innerHTML = "<section class=\"content-panel archive-change-panel\"><p class=\"archive-loading\">Loading race-by-race changes…</p></section>";
      try {
        let snapshot: SavedForecastSnapshot | CurrentData = data;
        let releaseNote = "Current published forecast.";
        let selectedIndex = -1;
        if (path !== "current") {
          if (!path.startsWith("data/snapshots/") || path.split("/").includes("..")) throw new Error("This saved release path is not available.");
          const selectedEntry = entries.find(entry => entry.snapshot_id === snapshotId);
          if (!selectedEntry) throw new Error("This saved release is not listed in the current archive index.");
          selectedIndex = entries.findIndex(entry => entry.snapshot_id === snapshotId);
          snapshot = await loadSnapshot(selectedEntry);
          releaseNote = ("archive_note" in snapshot ? snapshot.archive_note : undefined) || selectedEntry.archive_note || "Reference release; source inputs are not fully comparable with the current forecast.";
        }
        const olderEntry = path === "current" ? entries[0] : entries[selectedIndex + 1];
        const olderSnapshot = olderEntry ? await loadSnapshot(olderEntry) : undefined;
        if (sequence !== selectionSequence) return;
        if (note) note.textContent = releaseNote;
        overview.innerHTML = renderArchiveSeatCards(snapshot, data);
        changes.innerHTML = renderArchiveRaceChanges(snapshot, olderSnapshot);
        sortArchiveRaceRows(changes, "impact", "desc");
        filterArchiveRaceRows(changes);
      } catch (error) {
        if (sequence !== selectionSequence) return;
        if (note) note.textContent = error instanceof Error ? error.message : "This saved release could not be loaded.";
        overview.innerHTML = "<p class=\"chart-empty\">Seat outlook unavailable for this release.</p>";
        changes.innerHTML = "<section class=\"content-panel archive-change-panel\"><h2>Race changes unavailable</h2><p>" + escapeHtml(error instanceof Error ? error.message : "The saved release could not be compared.") + "</p></section>";
      } finally {
        button.disabled = false;
      }
    };
    holder.addEventListener("click", async event => {
      const target = event.target as HTMLElement;
      const sortButton = target.closest<HTMLButtonElement>("button[data-sort-key]");
      if (sortButton && changes?.contains(sortButton)) {
        sortArchiveRaceRows(changes, sortButton.dataset.sortKey as ArchiveSortKey);
        return;
      }
      const button = target.closest<HTMLButtonElement>("button[data-snapshot-path]");
      if (button) await showRelease(button);
    });
    holder.addEventListener("change", event => {
      const target = event.target as HTMLElement;
      if ((target.closest("#archive-change-filter") || target.closest("#archive-office-filter")) && changes) filterArchiveRaceRows(changes);
    });
    const currentButton = choices.find(choice => choice.dataset.snapshotPath === "current");
    if (currentButton) await showRelease(currentButton);
      } catch (error) {
        holder.innerHTML = "<section class=\"content-panel\"><h2>Archive unavailable</h2><p>" + escapeHtml(error instanceof Error ? error.message : "The saved forecast index could not be read.") + "</p></section>";
      }
    })();
    return publishedArchiveLoad;
  };
  selectView(initialView);
}
async function renderGallery(): Promise<void> {
  const target = element("gallery-content");
  const seriesHolder = element("gallery-series");
  if (!target || !seriesHolder) return;
  const response = await fetch(assetUrl("artwork/manifest.json"), { cache:"no-cache" });
  if (!response.ok) throw new Error("The artwork manifest could not be loaded.");
  const manifest = await response.json() as ArtworkManifest;
  const galleryCount = element("gallery-count");
  if (galleryCount) galleryCount.textContent = manifest.images.length.toLocaleString() + " IMAGES · OPTIMIZED FOR THE WEB";
  const groups = new Map<string, ArtworkManifest["images"]>();
  for (const item of manifest.images) groups.set(item.series_key, [...(groups.get(item.series_key) || []), item]);
  seriesHolder.innerHTML = [...groups.entries()].map(([key, items]) => "<a class=\"series-chip\" href=\"#series-" + encodeURIComponent(key) + "\">" + escapeHtml(items[0]?.series || key) + " <small>" + items.length + "</small></a>").join("");
  target.innerHTML = [...groups.entries()].map(([key, items]) => "<section class=\"gallery-group\" id=\"series-" + encodeURIComponent(key) + "\"><div class=\"section-title-row\"><div><p class=\"eyebrow\">" + items.length + " CURATED IMAGES</p><h2>" + escapeHtml(items[0]?.series || key) + "</h2></div><a class=\"back-link\" href=\"#main\">Back to top ↑</a></div><div class=\"artwork-grid\">" + items.map(item => {
    const accessibleAlt = item.alt || item.series + " artwork: " + item.filename;
    return "<button class=\"artwork-card\" type=\"button\" aria-label=\"Preview " + escapeHtml(accessibleAlt) + "\" data-image=\"" + escapeHtml(item.image) + "\" data-alt=\"" + escapeHtml(accessibleAlt) + "\"><img src=\"" + assetUrl(item.image) + "\" alt=\"\" loading=\"lazy\"></button>";
  }).join("") + "</div></section>").join("");
  const dialog = element<HTMLDialogElement>("artwork-dialog");
  const dialogImage = element<HTMLImageElement>("dialog-image");
  target.addEventListener("click", event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-image]");
    if (!button || !dialog || !dialogImage) return;
    dialogImage.src = assetUrl(button.dataset.image || "");
    dialogImage.alt = button.dataset.alt || "Curated Moelections artwork";
    dialog.showModal();
  });
  element("close-artwork")?.addEventListener("click", () => dialog?.close());
  dialog?.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && dialog?.open) dialog.close(); });
}

async function start(): Promise<void> {
  initThemeToggle();
  setBrandAssets();
  if (page === "gallery") {
    await renderGallery();
    return;
  }
  current = await loadCurrent();
  renderSnapshotMetadata(current);
  if (page === "guide" || page === "methodology") return;
  if (page === "home") renderHome(current);
  else if (page === "race") await renderRaceDetail(current);
  else if (page === "states") renderStates(current);
  else if (page === "performance") renderPerformance(current);
  else if (page === "archive") await renderSnapshotArchive(current);
}

void start().catch(showError);
