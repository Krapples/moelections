import "./styles.css";
import { assetUrl, dateLabel, escapeHtml, houseDistrictKey, loadCurrent, loadRaceRetrospectives, marginLabel, OFFICE_ORDER, pct, priorErrorCell, raceName, raceRetrospective, raceUrl, rating, ratingBandDescription, signedCount, STATE_NAMES, STATE_TILES } from "./data";
import type { ArtworkManifest, CandidateDataset, CurrentData, ForecastRace, GenericBallotHistory, GenericBallotHistoryRow, HistoricalMetric, Office, RaceRetrospectives, SavedForecastSnapshot, SnapshotIndex } from "./types";

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
  holder.innerHTML = "<div class=\"both-control-card\"><div class=\"both-control-heading\"><div><p class=\"eyebrow\">BOTH CHAMBERS</p><h3>Likelihood of the combined outcome</h3></div><span>Independent-chamber estimate</span></div><div class=\"both-control-grid\"><div class=\"both-control-item dem\"><span>Democrats control both</span><b>" + formatLikelihood(demBoth) + "</b></div><div class=\"both-control-item rep\"><span>Republicans control both</span><b>" + formatLikelihood(repBoth) + "</b></div><div class=\"both-control-item split\"><span>Split control</span><b>" + formatLikelihood(split) + "</b></div></div></div>";
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

function priorContestYear(race: ForecastRace): number {
  if (race.office === "House") return 2024;
  if (race.office === "Senate") return race.state === "FL" || race.state === "OH" ? 2022 : 2020;
  return race.state === "NH" || race.state === "VT" ? 2024 : 2022;
}

function priorContestWinner(race: ForecastRace, data: CurrentData): { side: FlipSide; year: number } | null {
  const series = race.office === "House"
    ? data.prior_error_history.districts?.[houseDistrictKey(race)]
    : data.prior_error_history.state_office_forecasts?.[race.office + "|" + race.state];
  if (!series || series.history_basis === "state_peers") return null;
  const year = priorContestYear(race);
  const row = series.errors_by_cycle?.find(item => Number(item.year) === year);
  if (!row) return null;
  const winner = row.actual_dem_winner === "Democratic" ? "D" : row.actual_dem_winner === "Republican" ? "R" : null;
  if (winner) return { side:winner, year };
  const margin = Number(row.actual_margin_pp);
  if (!Number.isFinite(margin) || Math.abs(margin) < 1e-10) return null;
  return { side:margin > 0 ? "D" : "R", year };
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
    const primaryLabel = entry.office === "Governor" ? "D-favored calls" : "D " + expectedLabel;
    const expectedPair = entry.office === "Governor"
      ? "<div class=\"outlook-pair\"><span>Expected D / R wins</span><b>" + Number(row.expected_dem_seats).toFixed(1) + " / " + Number(row.expected_rep_seats).toFixed(1) + "</b></div>"
      : "<div class=\"outlook-pair\"><span>Republican expected</span><b>" + Math.round(Number(row.expected_rep_seats)).toLocaleString() + "</b></div>";
    const note = entry.office === "House"
      ? "<small>" + Number(row.dem_favored_districts).toLocaleString() + " D-favored · " + Number(row.rep_favored_districts).toLocaleString() + " R-favored</small>"
      : entry.office === "Senate" ? "<small>" + senateRaceCount.toLocaleString() + " forecast races · " + senateFixedSeats.toLocaleString() + " fixed seats</small>" : "<small>Raw-margin calls: " + Number(row.dem_favored_races).toLocaleString() + " D-favored · " + Number(row.rep_favored_races).toLocaleString() + " R-favored</small>";
    const control = entry.office === "House" || entry.office === "Senate" ? renderControlOdds(data, entry.office) : "";
    return "<article class=\"outlook-card outlook-" + entry.office.toLowerCase() + "\"><p class=\"eyebrow\">" + entry.label.toUpperCase() + " · " + entry.scope.toUpperCase() + "</p><div class=\"expected-total\"><strong>" + primaryValue.toLocaleString() + "</strong><span>" + primaryLabel + "</span></div>" + expectedPair + note + range + control + "<span class=\"outlook-date\">Updated " + dateLabel(row.snapshot_date) + "</span></article>";
  }).join("");
  renderBothChamberOdds(data);
  const senate = outlooks.Senate;
  const note = element("outlook-note");
  if (note) note.innerHTML = "Seat ranges assume races are independent; the both-chamber outlook also treats House and Senate outcomes as independent. These are illustrative ranges, not direct probabilities of party control. House covers " + counts.House.toLocaleString() + " districts. Senate includes " + senateRaceCount.toLocaleString() + " listed races plus " + senateFixedSeats.toLocaleString() + " fixed seats. A 50–50 Senate is assigned to Republicans under the <a href=\"https://www.whitehouse.gov/administration/jd-vance/\" target=\"_blank\" rel=\"noopener noreferrer\">current vice president's tie-break</a>. Governor covers " + counts.Governor.toLocaleString() + " on-ballot races.";
}

function renderClosestPreview(data: CurrentData): void {
  const holder = element("closest-preview");
  if (!holder) return;
  holder.innerHTML = data.races.slice().sort(byCompetition).slice(0, 5).map((race, index) => {
    return "<a class=\"mini-race\" href=\"" + raceUrl(race.race_id) + "\"><span class=\"mini-race-number\">0" + (index + 1) + "</span><span><b>" + escapeHtml(raceName(race)) + "</b><small>" + escapeHtml(race.office) + " · " + marginLabel(race.dem_margin_pp) + " margin</small></span><strong>" + pct(race.dem_probability) + " D</strong></a>";
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
      <summary><span>About these polling numbers</span><span class="generic-poll-count">${pollCount.toLocaleString()} poll records</span></summary>
      <div class="generic-poll-details-body">
        <p class="generic-context">
          Polls with fieldwork ending by ${escapeHtml(snapshotDate)} are included. ${escapeHtml(timingNote)} Margins show Democratic minus Republican two-party support. These values come from the saved snapshot.
        </p>
      </div>
    </details>`;
}

function renderRatingBar(data: CurrentData): void {
  const officeValue = element<HTMLSelectElement>("office-select")?.value || "House";
  const office: Office | "All" = officeValue === "All" ? "All" : OFFICE_ORDER.includes(officeValue as Office) ? officeValue as Office : "House";
  const races = office === "All" ? data.races : data.races.filter(race => race.office === office);
  const counts: Record<string, number> = { "d-safe":0, "d-likely":0, "d-lean":0, tossup:0, "r-lean":0, "r-likely":0, "r-safe":0 };
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
    { key:"d-safe", label:"Dem Safe" },{ key:"d-likely", label:"Dem Likely" },{ key:"d-lean", label:"Dem Lean" },{ key:"tossup", label:"Toss-up" },{ key:"r-lean", label:"Rep Lean" },{ key:"r-likely", label:"Rep Likely" },{ key:"r-safe", label:"Rep Safe" }
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
  const governorCallText = office === "Governor" ? "<span>Raw-margin calls: <b>" + Number(outlook?.dem_favored_races).toLocaleString() + " D</b> · <b>" + Number(outlook?.rep_favored_races).toLocaleString() + " R</b></span>" : "";
  if (summaryHolder) summaryHolder.innerHTML = office === "All"
    ? "<span>" + total.toLocaleString() + " forecast races across offices; Senate fixed seats are omitted from this combined view.</span><span>Choose one office for its expected total and 50% / 90% seat ranges.</span><span>" + flipText + "</span>"
    : "<span>Expected Democratic " + (office === "Governor" ? "wins" : office === "Senate" ? "caucus seats" : "seats") + ": <b>" + Number(outlook?.expected_dem_seats).toFixed(1) + " / " + total.toLocaleString() + "</b></span>" + governorCallText + "<span>Central 50%: <b>" + ranges?.central50[0] + "–" + ranges?.central50[1] + " D</b></span><span>Central 90%: <b>" + ranges?.central90[0] + "–" + ranges?.central90[1] + " D</b></span><span>" + flipText + "</span>";
  if (note) {
    const houseBands = ratingBandDescription("House");
    const senateBands = ratingBandDescription("Senate");
    const governorBands = ratingBandDescription("Governor");
    if (office === "House") note.textContent = "Rating bands: " + houseBands + ". The bar covers all 435 districts; the marker is the 218-seat majority line. Seat ranges treat district outcomes as independent. Flip tags compare the favored party with the 2024 result for the same district label.";
    else if (office === "Senate") note.textContent = "Rating bands: " + senateBands + ". The bar covers 35 forecast races plus 65 fixed seats (34 Democratic-caucus and 31 Republican); the marker is 51 seats. Flip tags use the 2020 result for regular seats and the 2022 result for Florida and Ohio special contests.";
    else if (office === "Governor") note.textContent = "Rating bands: " + governorBands + ". The bar covers all 36 races; the marker is 19 wins. Flip tags compare with the prior contest result: 2022 for most states and 2024 for New Hampshire and Vermont.";
    else note.textContent = "Rating bands: " + houseBands + ". The combined bar counts race rows, not a unified seat total; Senate fixed seats are omitted. Select an office for its expected total, ranges, majority marker, and flip baseline.";
  }
}

function stateColor(probability: number): { fill:string; border:string } {
  const strength = Math.max(0, Math.min(1, Math.abs(probability - 0.5) * 2));
  const hue = probability < 0.5 ? 3 : 213;
  const saturation = Math.round(14 + 50 * strength);
  const lightness = Math.round(96 - 15 * strength);
  return { fill:"hsl(" + hue + " " + saturation + "% " + lightness + "% )", border:"hsl(" + hue + " " + Math.min(78, saturation + 8) + "% " + Math.max(57, lightness - 9) + "% )" };
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
    return "<tr><th scope=\"row\"><a class=\"race-link\" href=\"" + raceUrl(race.race_id) + "\">" + escapeHtml(raceName(race)) + "<small>" + escapeHtml(race.office) + "</small></a></th><td><span class=\"margin-token " + (race.dem_margin_pp > 0 ? "dem" : race.dem_margin_pp < 0 ? "rep" : "neutral") + "\">" + marginLabel(race.dem_margin_pp) + "</span></td><td class=\"prior-cell\">" + priorErrorCell(race, data.prior_error_history) + "</td><td><span class=\"chance-value\">" + pct(dem) + "</span><span class=\"chance-track dem-track\"><i style=\"width:" + (dem * 100).toFixed(1) + "%\"></i></span></td><td><span class=\"chance-value\">" + pct(rep) + "</span><span class=\"chance-track rep-track\"><i style=\"width:" + (rep * 100).toFixed(1) + "%\"></i></span></td><td><span class=\"favorite-label " + favoriteClass + "\">" + favorite + "</span><span class=\"rating-pill " + ratingClass + "\" title=\"" + (race.forecast_rating ? "Published forecast rating" : "Rating derived from the published win chance") + "\">" + escapeHtml(raceRating) + "</span>" + flipBadge(race, data) + "</td></tr>";
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
    element("race-forecasts")?.scrollIntoView({ behavior:"smooth", block:"start" });
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
  const render = () => {
    const query = search?.value.trim().toLowerCase() || "";
    const officeFilter = office?.value || "All";
    const states = [...grouped.entries()].map(([state, allRaces]) => ({
      state,
      name:STATE_NAMES[state] || state,
      allRaces,
      races:officeFilter === "All" ? allRaces : allRaces.filter(race => race.office === officeFilter)
    })).filter(row => row.races.length > 0 && (!query || row.name.toLowerCase().includes(query) || row.state.toLowerCase().includes(query) || row.races.some(race => raceName(race).toLowerCase().includes(query))));
    if (sort?.value === "races") states.sort((a, b) => b.races.length - a.races.length || a.name.localeCompare(b.name));
    else if (sort?.value === "competitive") states.sort((a, b) => byCompetition(a.races.slice().sort(byCompetition)[0], b.races.slice().sort(byCompetition)[0]) || a.name.localeCompare(b.name));
    else states.sort((a, b) => a.name.localeCompare(b.name));
    holder.innerHTML = states.map(({ state, name, allRaces, races }) => {
      const average = races.reduce((sum, race) => sum + race.dem_probability, 0) / races.length;
      const closest = races.slice().sort(byCompetition)[0];
      const counts = OFFICE_ORDER.map(item => {
        const count = allRaces.filter(race => race.office === item).length;
        return "<span>" + item + " <b>" + count + "</b></span>";
      }).join("");
      const officeParam = officeFilter === "All" ? "" : "&office=" + encodeURIComponent(officeFilter);
      return "<article class=\"state-card\"><div class=\"state-card-heading\"><span class=\"state-abbr\">" + state + "</span><h2 class=\"state-name\">" + escapeHtml(name) + "</h2><strong class=\"state-average\">" + pct(average) + "</strong></div><p class=\"state-average-label\">average D win chance · " + escapeHtml(officeFilter === "All" ? "all offices" : officeFilter) + " · " + races.length + (races.length === 1 ? " race" : " races") + "</p><div class=\"state-card-counts\" aria-label=\"All office coverage counts\">" + counts + "</div><a class=\"state-closest\" href=\"" + raceUrl(closest.race_id) + "\">Closest: " + escapeHtml(raceName(closest)) + " · " + pct(closest.dem_probability) + " D</a><a class=\"state-browse\" href=\"./index.html?state=" + encodeURIComponent(state) + officeParam + "#race-forecasts\">Browse " + races.length + (races.length === 1 ? " forecast" : " forecasts") + " <span aria-hidden=\"true\">↗</span></a></article>";
    }).join("");
    if (status) status.textContent = "Showing " + states.length + (states.length === 1 ? " state" : " states") + " with published " + (officeFilter === "All" ? "race rows" : officeFilter + " rows") + ".";
    if (empty) empty.hidden = states.length > 0;
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
  const raceId = new URLSearchParams(window.location.search).get("id");
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
  const detailStatsMarkup = raceDetailStatsMarkup(race, data, retrospectives, classification);
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
  holder.innerHTML = "<p class=\"eyebrow\">" + escapeHtml(race.office) + " · " + dateLabel(data.snapshot_date) + " SNAPSHOT</p><h1>" + escapeHtml(raceName(race)) + "</h1><p class=\"detail-subtitle\">" + favorite + "</p>" + detailStatsMarkup + "<section class=\"content-panel candidate-panel\"><p class=\"eyebrow\">CANDIDATES</p><h2>Race field</h2>" + candidateRows + candidateRetrievedMarkup + "</section><section class=\"content-panel detail-history\"><p class=\"eyebrow\">PAST ELECTIONS</p><h2>Prior margins and polls</h2>" + retrospectiveMarkup + "</section><section class=\"content-panel detail-source-panel\"><p class=\"eyebrow\">REFERENCE</p><h2>Sources</h2>" + sourceMarkup + "<p>See <a href=\"./methodology.html\">About the data</a> for definitions and date limits.</p></section>";
  void renderRaceArtwork();
  const header = document.querySelector("title");
  if (header) header.textContent = raceName(race) + " — Moelections";
  const footerDate = element("race-footer-date");
  if (footerDate) footerDate.textContent = dateLabel(data.snapshot_date);
}

function raceDetailStatsMarkup(race: ForecastRace, data: CurrentData, retrospectives: RaceRetrospectives | null, classification: string): string {
  const history = race.office === "House"
    ? data.prior_error_history.districts?.[houseDistrictKey(race)]
    : data.prior_error_history.state_office_forecasts?.[race.office + "|" + race.state];
  const prior = history?.prior_averages_by_target_election?.["2026"];
  const mae = Number(prior?.prior_average_absolute_error_pp);
  const signedError = Number(prior?.prior_average_signed_error_pp);
  const cycles = Number(prior?.prior_cycle_count ?? prior?.prior_observation_count) || 0;
  const rows = Number(prior?.prior_race_count) || 0;
  const isPeerAverage = history?.history_basis === "state_peers";
  const currentPolls = retrospectives?.races[race.race_id]?.current_polling;
  const pollMean = currentPolls?.poll_average_margin_pp ?? null;
  const pollSourceDate = currentPolls?.source_as_of ? " · source through " + dateLabel(currentPolls.source_as_of) : "";
  const forecastPollGap = pollMean === null ? null : race.dem_margin_pp - pollMean;
  const errorClass = !Number.isFinite(signedError) || Math.abs(signedError) <= 0.05 ? "neutral" : signedError > 0 ? "dem" : "rep";
  const errorText = !Number.isFinite(signedError) || Math.abs(signedError) <= 0.05 ? "Mean error near zero" : "Mean error " + marginLabel(signedError);
  const gapClass = forecastPollGap === null || Math.abs(forecastPollGap) <= 0.05 ? "neutral" : forecastPollGap > 0 ? "dem" : "rep";
  const pollDetails = currentPolls
    ? pollMean === null
      ? "<small>" + currentPolls.poll_count.toLocaleString() + " poll records · no usable average" + escapeHtml(pollSourceDate) + "</small><small>Forecast-to-poll gap unavailable</small>"
      : "<small>" + currentPolls.poll_count.toLocaleString() + " poll records · unweighted mean" + escapeHtml(pollSourceDate) + "</small><small>Forecast − poll mean: <b class=\"" + gapClass + "\">" + marginLabel(forecastPollGap as number) + "</b></small>"
    : "<small>Poll summary unavailable</small>";
  const priorDetails = Number.isFinite(mae) && cycles > 0
    ? "<strong>" + mae.toFixed(1) + " pp MAE</strong><small class=\"" + errorClass + "\">" + escapeHtml(errorText) + "</small><small>" + cycles + " elections · " + rows.toLocaleString() + (isPeerAverage ? " peer rows" : " race rows") + "</small>"
    : "<strong>No prior average</strong><small>No historical comparison is available</small>";
  return "<section class=\"detail-metrics\" aria-label=\"Race forecast statistics\"><article class=\"detail-stat\"><span>Forecast margin</span><strong class=\"" + (race.dem_margin_pp > 0 ? "dem" : race.dem_margin_pp < 0 ? "rep" : "neutral") + "\">" + marginLabel(race.dem_margin_pp) + "</strong><small>" + escapeHtml(classification) + " rating</small></article><article class=\"detail-stat detail-probability\"><span>Win probability</span><div class=\"detail-probability-values\"><b class=\"dem\">D " + pct(race.dem_probability) + "</b><b class=\"rep\">R " + pct(race.rep_probability) + "</b></div><div class=\"probability-split\" role=\"img\" aria-label=\"Democratic win probability " + pct(race.dem_probability) + ", Republican win probability " + pct(race.rep_probability) + "\"><i class=\"probability-dem\" style=\"width:" + (race.dem_probability * 100).toFixed(1) + "%\"></i><i class=\"probability-rep\" style=\"width:" + (race.rep_probability * 100).toFixed(1) + "%\"></i></div><small>Published race probabilities</small></article><article class=\"detail-stat\"><span>Current poll average</span><strong>" + (pollMean === null ? "No matched mean" : marginLabel(pollMean)) + "</strong>" + pollDetails + "</article><article class=\"detail-stat\"><span>Past forecast error</span>" + priorDetails + "</article></section>";
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

type HistoryMetricKey = "margin_mae_pp" | "accuracy" | "seat_count" | "brier_score";

const HISTORY_CHART_METRICS: Record<HistoryMetricKey, { label:string; note:string }> = {
  margin_mae_pp:{ label:"Margin error", note:"Average absolute margin error in percentage points. Lower is closer." },
  accuracy:{ label:"Winner accuracy", note:"Share of covered races with the correct predicted winner. Higher is better." },
  seat_count:{ label:"Seat counts in covered races", note:"Predicted Democratic calls compared with actual Democratic wins on the same covered races." },
  brier_score:{ label:"Probability score", note:"How close the published win chances were to the outcomes, on a 0–1 scale. Lower is better." }
};

const HISTORY_COLORS: Record<Office, string> = { House:"#326eb8", Senate:"#b24f4f", Governor:"#bd8c30" };
const GENERIC_HISTORY_COLORS = { forecast:"#326eb8", polling:"#bd8c30", actual:"#5d6a7c" };

function historyMetricValue(row: HistoricalMetric, metric: HistoryMetricKey): number {
  return metric === "seat_count" ? Number(row.predicted_dem_seat_calls) : Number(row[metric]);
}

function historyMetricLabel(value: number, metric: HistoryMetricKey): string {
  if (metric === "accuracy") return pct(value);
  if (metric === "brier_score") return value.toFixed(3);
  if (metric === "seat_count") return Math.round(value).toLocaleString();
  return value.toFixed(2) + " pp";
}

function historySeatCountChartMarkup(rows: HistoricalMetric[], years: number[], offices: Office[]): string {
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
    const seatValues = officeRows.flatMap(row => [Number(row.predicted_dem_seat_calls), Number(row.actual_dem_wins_covered)]).filter(Number.isFinite);
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
    const forecastPoints = officeRows.map(row => xAt(years.indexOf(Number(row.cycle))).toFixed(1) + "," + yAt(Number(row.predicted_dem_seat_calls)).toFixed(1)).join(" ");
    const actualPoints = officeRows.map(row => xAt(years.indexOf(Number(row.cycle))).toFixed(1) + "," + yAt(Number(row.actual_dem_wins_covered)).toFixed(1)).join(" ");
    const markers = officeRows.map(row => {
      const x = xAt(years.indexOf(Number(row.cycle)));
      const forecastY = yAt(Number(row.predicted_dem_seat_calls));
      const actualY = yAt(Number(row.actual_dem_wins_covered));
      const title = office + " " + row.cycle + ": forecast " + Number(row.predicted_dem_seat_calls).toLocaleString() + " Democratic calls, actual " + Number(row.actual_dem_wins_covered).toLocaleString() + " Democratic wins across " + Number(row.races).toLocaleString() + " covered races";
      return "<g><title>" + title + "</title><circle cx=\"" + x.toFixed(1) + "\" cy=\"" + forecastY.toFixed(1) + "\" r=\"5\" fill=\"" + HISTORY_COLORS[office] + "\" stroke=\"#fffefa\" stroke-width=\"2\"/><rect x=\"" + (x - 4).toFixed(1) + "\" y=\"" + (actualY - 4).toFixed(1) + "\" width=\"8\" height=\"8\" fill=\"#fffefa\" stroke=\"#5d6a7c\" stroke-width=\"2\"/></g>";
    }).join("");
    return "<g class=\"history-seat-panel\"><text x=\"" + left + "\" y=\"" + (panelTop + 16) + "\" class=\"history-panel-title\">" + office + " · " + officeRows.length + " cycles</text>" + guides + "<polyline points=\"" + forecastPoints + "\" fill=\"none\" stroke=\"" + HISTORY_COLORS[office] + "\" stroke-width=\"3\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><polyline points=\"" + actualPoints + "\" fill=\"none\" stroke=\"#5d6a7c\" stroke-width=\"2.5\" stroke-dasharray=\"6 5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>" + markers + xLabels + "</g>";
  }).join("");
  const title = HISTORY_CHART_METRICS.seat_count.label + " by election cycle";
  return "<svg class=\"history-chart-svg history-seat-chart-svg\" role=\"img\" aria-labelledby=\"history-svg-title history-svg-description\" viewBox=\"0 0 " + width + " " + height + "\"><title id=\"history-svg-title\">" + title + "</title><desc id=\"history-svg-description\">Democratic seat calls and actual Democratic wins in covered races for " + offices.join(", ") + ". Each office uses a separate vertical scale focused on its observed seat counts.</desc>" + panels + "</svg>";
}

function historyChartMarkup(rows: HistoricalMetric[], metric: HistoryMetricKey): string {
  const years = [...new Set(rows.map(row => Number(row.cycle)))].filter(Number.isFinite).sort((a, b) => a - b);
  const offices = OFFICE_ORDER.filter(office => rows.some(row => row.office === office));
  if (!years.length || !offices.length) return "<p class=\"chart-empty\">No historical results are available for this selection.</p>";
  if (metric === "seat_count") return historySeatCountChartMarkup(rows, years, offices);
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
  const fullHouse = row.full_house_actual_dem_seats_context === undefined || row.full_house_actual_dem_seats_context === null ? "—" : Number(row.full_house_actual_dem_seats_context).toLocaleString();
  return "<tr><th scope=\"row\">" + escapeHtml(row.office) + "</th><td>" + escapeHtml(row.cycle) + "</td><td>" + Number(row.races).toLocaleString() + "</td><td>" + Number(row.margin_mae_pp).toFixed(2) + " pp</td><td>" + pct(row.accuracy) + "</td><td>" + Number(row.predicted_dem_seat_calls).toLocaleString() + " / " + Number(row.actual_dem_wins_covered).toLocaleString() + "</td><td>" + signedCount(row.signed_seat_error) + "</td><td>" + Number(row.false_dem_calls).toLocaleString() + " / " + Number(row.false_rep_calls).toLocaleString() + "</td><td>" + fullHouse + "</td><td>" + Number(row.brier_score).toFixed(3) + "</td><td>" + Number(row.log_loss).toFixed(3) + "</td></tr>";
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
      return "<article class=\"history-card\"><span class=\"eyebrow\">" + escapeHtml(row.office) + " · ALL CYCLES</span><div class=\"history-primary-stat\"><span>Margin error</span><strong>" + Number(row.margin_mae_pp).toFixed(2) + " pp</strong></div><div class=\"history-card-pair\"><span>Winner accuracy <b>" + pct(row.accuracy) + "</b></span><span>Covered races <b>" + Number(row.races).toLocaleString() + "</b></span></div><div class=\"history-card-pair\"><span>D calls / actual wins <b>" + Number(row.predicted_dem_seat_calls).toLocaleString() + " / " + Number(row.actual_dem_wins_covered).toLocaleString() + "</b></span><span>Seat error <b>" + signedCount(row.signed_seat_error) + "</b></span></div></article>";
    }).join("");
    const chartTitle = element("history-chart-title");
    const chartNote = element("history-chart-note");
    const chart = element("history-chart");
    const legend = element("history-chart-legend");
    if (chartTitle) chartTitle.textContent = HISTORY_CHART_METRICS[metric].label;
    if (chartNote) chartNote.textContent = HISTORY_CHART_METRICS[metric].note + (metric === "seat_count" ? " Each office uses its own vertical scale, focused around the observed range." : " The vertical scale follows the observed values.");
    if (chart) chart.innerHTML = historyChartMarkup(annual, metric);
    if (legend) legend.innerHTML = metric === "seat_count"
      ? "<span><i class=\"history-legend-forecast\" style=\"--series-color:#326eb8\" aria-hidden=\"true\"></i>Forecast Democratic calls</span><span><i class=\"history-legend-actual\" aria-hidden=\"true\"></i>Actual Democratic wins</span>"
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
    {key:"forecast_margin_pp" as const, label:"Retrospective forecast", color:GENERIC_HISTORY_COLORS.forecast, marker:"forecast"}
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
  return "<svg class=\"history-chart-svg\" role=\"img\" aria-labelledby=\"generic-history-svg-title generic-history-svg-description\" viewBox=\"0 0 " + width + " " + height + "\"><title id=\"generic-history-svg-title\">Generic-ballot forecast, polling average, and actual House margin</title><desc id=\"generic-history-svg-description\">" + years.join(", ") + " national election cycles. Each point is a Democratic-minus-Republican House popular-vote margin in percentage points.</desc>" + guides + xLabels + series + "</svg>";
}

async function renderGenericBallotHistory(): Promise<void> {
  const chart = element("generic-history-chart");
  if (!chart) return;
  const summaryText = element("generic-history-summary-text");
  const summary = element("generic-history-summary");
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
    const meanAbsoluteError = (key:"forecast_margin_pp" | "poll_average_margin_pp"):number => rows.reduce((sum, row) => sum + Math.abs(row[key] - row.actual_house_margin_pp), 0) / rows.length;
    const directionCount = (key:"forecast_margin_pp" | "poll_average_margin_pp"):number => rows.filter(row => Math.sign(row[key]) === Math.sign(row.actual_house_margin_pp)).length;
    const forecastMae = meanAbsoluteError("forecast_margin_pp");
    const pollingMae = meanAbsoluteError("poll_average_margin_pp");
    if (summaryText) summaryText.textContent = "Across the same four cycles, forecast MAE was " + forecastMae.toFixed(2) + " pp and polling-average MAE was " + pollingMae.toFixed(2) + " pp. Correct national winner direction: forecast " + directionCount("forecast_margin_pp") + "/4; polling average " + directionCount("poll_average_margin_pp") + "/4.";
    if (summary) summary.innerHTML = "<article class=\"history-card\"><span class=\"eyebrow\">SAME FOUR ELECTIONS</span><div class=\"history-primary-stat\"><span>Forecast MAE</span><strong>" + forecastMae.toFixed(2) + " pp</strong></div><div class=\"history-card-pair\"><span>Polling-average MAE<b>" + pollingMae.toFixed(2) + " pp</b></span><span>Cycles<b>" + rows.length + "</b></span></div></article><article class=\"history-card\"><span class=\"eyebrow\">DIRECTION CALLS</span><div class=\"history-primary-stat\"><span>Forecast</span><strong>" + directionCount("forecast_margin_pp") + "/4</strong></div><div class=\"history-card-pair\"><span>Polling average<b>" + directionCount("poll_average_margin_pp") + "/4</b></span><span>Target<b>House D−R margin</b></span></div></article>";
    if (legend) legend.innerHTML = "<span><i style=\"--series-color:" + GENERIC_HISTORY_COLORS.forecast + "\" aria-hidden=\"true\"></i>Retrospective forecast</span><span><i style=\"--series-color:" + GENERIC_HISTORY_COLORS.polling + "\" aria-hidden=\"true\"></i>Polling average</span><span><i class=\"history-legend-actual\" style=\"--series-color:" + GENERIC_HISTORY_COLORS.actual + "\" aria-hidden=\"true\"></i>Actual House result</span>";
    chart.innerHTML = genericBallotHistoryChartMarkup(rows);
    if (table) table.innerHTML = rows.map(row => {
      const forecastError = Math.abs(row.forecast_margin_pp - row.actual_house_margin_pp);
      const pollingError = Math.abs(row.poll_average_margin_pp - row.actual_house_margin_pp);
      return "<tr><th scope=\"row\">" + row.cycle + "</th><td>" + escapeHtml(dateLabel(row.snapshot_date)) + "</td><td>" + formatMarginPp(row.forecast_margin_pp) + "</td><td>" + formatMarginPp(row.poll_average_margin_pp) + "</td><td>" + formatMarginPp(row.actual_house_margin_pp) + "</td><td>" + forecastError.toFixed(2) + " pp</td><td>" + pollingError.toFixed(2) + " pp</td></tr>";
    }).join("");
    if (methodNote) {
      const sourceUrl = /^https:\/\/projects\.fivethirtyeight\.com\/polls\/generic-ballot\/?$/.test(history.poll_average_source_url) ? history.poll_average_source_url : "";
      const sourceLink = sourceUrl ? "<a href=\"" + escapeHtml(sourceUrl) + "\" target=\"_blank\" rel=\"noopener noreferrer\">FiveThirtyEight</a>" : escapeHtml(history.poll_average_source_label);
      methodNote.innerHTML = "Polling averages use archived records from " + sourceLink + ". Publication timing is unverified for some records, so these are historical comparisons rather than a day-by-day replay. " + escapeHtml(history.validation_note);
    }
  } catch {
    if (summaryText) summaryText.textContent = "The generic-ballot history comparison is unavailable right now.";
    chart.innerHTML = "<p class=\"chart-empty\">Generic-ballot history could not be loaded.</p>";
  }
}

async function renderSnapshotArchive(data: CurrentData): Promise<void> {
  const holder = element("changes-content");
  if (!holder) return;
  try {
    const response = await fetch(assetUrl("data/snapshots/index.json"), { cache:"no-store" });
    if (!response.ok) throw new Error("The local snapshot index could not be loaded.");
    const index = await response.json() as SnapshotIndex;
    const entries = index.schema_version === data.schema_version && index.series_id === data.series_id
      ? index.snapshots.filter(entry => entry.series_id === data.series_id && entry.schema_version === data.schema_version && entry.snapshot_date < data.snapshot_date).sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date))
      : [];
    const currentCard = "<li class=\"archive-item archive-current\"><span class=\"archive-marker\" aria-hidden=\"true\"></span><div><time datetime=\"" + escapeHtml(data.snapshot_date) + "\">" + escapeHtml(dateLabel(data.snapshot_date)) + "</time><h2>Current forecast</h2><p>" + data.races.length.toLocaleString() + " listed race forecasts</p></div><span class=\"archive-status current-status\">Current</span><button class=\"archive-open-button\" type=\"button\" data-snapshot-id=\"current\" data-snapshot-path=\"current\" aria-controls=\"archive-detail\">View predictions</button></li>";
    const archivedCards = entries.map(entry => {
      const raceCount = Number(entry.race_count || 0);
      const countLabel = raceCount ? raceCount.toLocaleString() + " saved race forecasts" : "Saved race forecasts";
      const description = entry.archive_note || "Preserved as a reference; this release is not used to calculate forecast movement.";
      const pathIsLocalSnapshot = entry.path.startsWith("data/snapshots/") && !entry.path.split("/").includes("..");
      const action = pathIsLocalSnapshot
        ? "<button class=\"archive-open-button\" type=\"button\" data-snapshot-id=\"" + escapeHtml(entry.snapshot_id) + "\" data-snapshot-path=\"" + escapeHtml(entry.path) + "\" aria-controls=\"archive-detail\">View predictions</button>"
        : "<span class=\"archive-status\">File unavailable</span>";
      return "<li class=\"archive-item\"><span class=\"archive-marker\" aria-hidden=\"true\"></span><div><time datetime=\"" + escapeHtml(entry.snapshot_date) + "\">" + escapeHtml(dateLabel(entry.snapshot_date)) + "</time><h2>Saved forecast</h2><p>" + escapeHtml(countLabel) + " · " + escapeHtml(description) + "</p></div><span class=\"archive-status\">Reference only</span>" + action + "</li>";
    }).join("");
    const empty = entries.length ? "" : "<p class=\"archive-empty\">No earlier dated snapshots are listed for this forecast series.</p>";
    holder.innerHTML = "<section class=\"content-panel archive-card\"><div class=\"section-title-row\"><div><p class=\"eyebrow\">" + (entries.length + 1).toLocaleString() + " DATED RELEASES</p><h2>Saved forecast dates</h2></div><a class=\"text-link\" href=\"./performance.html\">Explore election history ↗</a></div><p class=\"archive-intro\">Open a release to browse its saved Democratic–Republican margin estimates and win chances. These are historical records, not a claim that two releases are directly comparable.</p>" + empty + "<ol class=\"snapshot-timeline\">" + currentCard + archivedCards + "</ol></section><section class=\"content-panel archive-detail\" id=\"archive-detail\" hidden></section>";

    const detail = element<HTMLDivElement>("archive-detail");
    let lastOpenedButton: HTMLButtonElement | null = null;
    const openSnapshot = async (snapshot: SavedForecastSnapshot | CurrentData, snapshotDate: string, archiveNote: string, opener: HTMLButtonElement) => {
      if (!detail) return;
      lastOpenedButton = opener;
      detail.hidden = false;
      detail.innerHTML = "<p class=\"eyebrow\">" + escapeHtml(dateLabel(snapshotDate)) + " SNAPSHOT</p><h2>Race predictions</h2><p class=\"archive-intro\">" + escapeHtml(archiveNote) + "</p><p class=\"archive-loading\">Loading saved race predictions…</p>";
      const officeOptions = OFFICE_ORDER.map(office => "<option value=\"" + escapeHtml(office) + "\">" + escapeHtml(office) + "</option>").join("");
      detail.innerHTML = "<div class=\"section-title-row archive-detail-heading\"><div><p class=\"eyebrow\">" + escapeHtml(dateLabel(snapshotDate)) + " SNAPSHOT</p><h2>Race predictions</h2></div><button class=\"archive-close-button\" type=\"button\">Close</button></div><p class=\"archive-intro\">" + escapeHtml(archiveNote) + "</p><div class=\"archive-toolbar\"><label for=\"archive-office\">Office<select id=\"archive-office\"><option value=\"all\">All offices</option>" + officeOptions + "</select></label><label for=\"archive-search\">Find a race<input id=\"archive-search\" type=\"search\" autocomplete=\"off\" placeholder=\"State or district\"></label><p class=\"archive-row-count\" id=\"archive-row-count\" aria-live=\"polite\"></p></div><div class=\"archive-table-wrap\"><table class=\"archive-forecast-table\"><caption class=\"visually-hidden\">Race forecasts saved on " + escapeHtml(dateLabel(snapshotDate)) + "</caption><thead><tr><th scope=\"col\">Race</th><th scope=\"col\">D–R margin</th><th scope=\"col\">D win chance</th><th scope=\"col\">R win chance</th></tr></thead><tbody id=\"archive-race-rows\"></tbody></table></div><nav class=\"archive-pager\" aria-label=\"Forecast archive pages\"><button type=\"button\" id=\"archive-previous\">Previous</button><span id=\"archive-page-label\"></span><button type=\"button\" id=\"archive-next\">Next</button></nav>";

      const officeSelect = element<HTMLSelectElement>("archive-office");
      const searchInput = element<HTMLInputElement>("archive-search");
      const rowCount = element<HTMLParagraphElement>("archive-row-count");
      const tableRows = element<HTMLTableSectionElement>("archive-race-rows");
      const previous = element<HTMLButtonElement>("archive-previous");
      const next = element<HTMLButtonElement>("archive-next");
      const pageLabel = element<HTMLSpanElement>("archive-page-label");
      const pageSize = 50;
      let archivePage = 0;
      const races = [...snapshot.races].sort((a, b) => OFFICE_ORDER.indexOf(a.office) - OFFICE_ORDER.indexOf(b.office) || a.state.localeCompare(b.state) || String(a.district).localeCompare(String(b.district)));
      const updateRows = () => {
        if (!officeSelect || !searchInput || !rowCount || !tableRows || !previous || !next || !pageLabel) return;
        const query = searchInput.value.trim().toLowerCase();
        const filtered = races.filter(race => (officeSelect.value === "all" || race.office === officeSelect.value) && (!query || raceName(race).toLowerCase().includes(query) || race.state.toLowerCase().includes(query) || String(race.district).toLowerCase().includes(query)));
        const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
        archivePage = Math.min(archivePage, pageCount - 1);
        const start = archivePage * pageSize;
        const visible = filtered.slice(start, start + pageSize);
        tableRows.innerHTML = visible.length
          ? visible.map(race => "<tr><th scope=\"row\">" + escapeHtml(raceName(race)) + "</th><td>" + escapeHtml(formatMarginPp(Number(race.dem_margin_pp))) + "</td><td>" + pct(Number(race.dem_probability)) + "</td><td>" + pct(Number(race.rep_probability)) + "</td></tr>").join("")
          : "<tr><td class=\"archive-no-results\" colspan=\"4\">No races match this filter.</td></tr>";
        rowCount.textContent = filtered.length ? "Showing " + (start + 1).toLocaleString() + "–" + Math.min(start + pageSize, filtered.length).toLocaleString() + " of " + filtered.length.toLocaleString() + " races" : "No matching races";
        pageLabel.textContent = "Page " + (archivePage + 1).toLocaleString() + " of " + pageCount.toLocaleString();
        previous.disabled = archivePage === 0;
        next.disabled = archivePage >= pageCount - 1;
      };
      officeSelect?.addEventListener("change", () => { archivePage = 0; updateRows(); });
      searchInput?.addEventListener("input", () => { archivePage = 0; updateRows(); });
      previous?.addEventListener("click", () => { archivePage = Math.max(0, archivePage - 1); updateRows(); });
      next?.addEventListener("click", () => { archivePage += 1; updateRows(); });
      detail.querySelector<HTMLButtonElement>(".archive-close-button")?.addEventListener("click", () => {
        detail.hidden = true;
        lastOpenedButton?.focus();
      });
      updateRows();
      detail.scrollIntoView({ behavior:"smooth", block:"start" });
    };

    holder.addEventListener("click", async event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-snapshot-path]");
      if (!button) return;
      button.disabled = true;
      try {
        const snapshotPath = button.dataset.snapshotPath || "";
        const snapshotId = button.dataset.snapshotId || "";
        let snapshot: SavedForecastSnapshot | CurrentData;
        let note = "Current published forecast.";
        if (snapshotPath === "current") {
          snapshot = data;
        } else {
          if (!snapshotPath.startsWith("data/snapshots/") || snapshotPath.split("/").includes("..")) throw new Error("The saved forecast path is invalid.");
          const snapshotResponse = await fetch(assetUrl(snapshotPath), { cache:"force-cache" });
          if (!snapshotResponse.ok) throw new Error("This saved forecast could not be loaded.");
          snapshot = await snapshotResponse.json() as SavedForecastSnapshot;
          if (snapshot.schema_version !== data.schema_version || snapshot.series_id !== data.series_id || snapshot.snapshot_id !== snapshotId || !Array.isArray(snapshot.races)) throw new Error("This saved forecast does not match the current archive series.");
          note = snapshot.archive_note || entries.find(entry => entry.snapshot_id === snapshotId)?.archive_note || "Preserved as a reference; this release is not used to calculate forecast movement.";
        }
        await openSnapshot(snapshot, snapshot.snapshot_date, note, button);
      } catch (error) {
        if (detail) {
          detail.hidden = false;
          detail.textContent = error instanceof Error ? error.message : "This saved forecast could not be opened.";
        }
      } finally {
        button.disabled = false;
      }
    });
  } catch (error) {
    holder.innerHTML = "<section class=\"content-panel\"><h2>Archive unavailable</h2><p>" + escapeHtml(error instanceof Error ? error.message : "The local snapshot index could not be read.") + "</p></section>";
  }
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
