import { assetUrl, dateLabel, escapeHtml, marginLabel, OFFICE_ORDER, pct, raceName, raceUrl } from "./data";
import type { CurrentData, Office, SimulatedHistory, SimulatedHistoryPoint, SimulatedHistoryRace } from "./types";

const VALUE_KEY: Record<Office, "h" | "s" | "g"> = { House: "h", Senate: "s", Governor: "g" };
const OFFICE_TOTAL: Record<Office, number> = { House: 435, Senate: 100, Governor: 36 };
const OFFICE_VALUE_LABEL: Record<Office, string> = {
  House: "expected Democratic House seats",
  Senate: "expected Democratic Senate seats",
  Governor: "expected Democratic wins"
};

function valueFor(point: SimulatedHistoryPoint, office: Office): number | null {
  return point[VALUE_KEY[office]];
}

function cleanHistory(value: unknown): value is SimulatedHistory {
  if (!value || typeof value !== "object") return false;
  const history = value as SimulatedHistory;
  return history.schema_version === 1
    && /^\d{4}-\d{2}-\d{2}$/.test(history.start_date)
    && /^\d{4}-\d{2}-\d{2}$/.test(history.cutoff_date_utc)
    && Array.isArray(history.daily)
    && history.daily.length > 0
    && Boolean(history.races && typeof history.races === "object");
}

function chartDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function formatAxis(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function coverageNote(history: SimulatedHistory, office: Office): string {
  const values = history.daily.filter(point => valueFor(point, office) !== null);
  const first = values[0]?.date;
  const last = values[values.length - 1]?.date;
  const count = values.length;
  return `<p>${office} forecasts appear at ${count.toLocaleString()} of ${history.daily.length.toLocaleString()} saved releases, from ${escapeHtml(dateLabel(first))} through ${escapeHtml(dateLabel(last))}. The chart follows release order; it does not show or interpolate the days between releases.</p>`;
}

function dateBounds(history: SimulatedHistory, office: Office): [number, number] {
  const indices = history.daily.flatMap((point, index) => valueFor(point, office) === null ? [] : [index]);
  return indices.length ? [indices[0], indices[indices.length - 1]] : [0, history.daily.length - 1];
}

function sliderBounds(history: SimulatedHistory, office: Office): [number, number] {
  return office === "House" ? dateBounds(history, office) : [0, history.daily.length - 1];
}

function chartMarkup(
  history: SimulatedHistory,
  office: Office,
  selectedDate: string,
  selectedRaceId: string,
  selectedRaceLabel: string
): string {
  const width = 960;
  const height = 340;
  const left = 62;
  const right = 24;
  const top = 22;
  const bottom = 48;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const [startIndex, endIndex] = dateBounds(history, office);
  const viewPoints = office === "House" ? history.daily.slice(startIndex, endIndex + 1) : history.daily;
  const available = viewPoints
    .map((point, index) => {
      const aggregate = valueFor(point, office);
      const race = selectedRaceId ? history.races[point.date]?.[office]?.find(row => row.id === selectedRaceId) : undefined;
      const value = selectedRaceId ? race?.chance === undefined ? null : race.chance * 100 : aggregate;
      return { point, index, value };
    })
    .filter((item): item is { point: SimulatedHistoryPoint; index: number; value: number } => item.value !== null);
  if (!available.length) return "<p class=\"chart-empty\">No forecast values are available for this office.</p>";

  const minimum = Math.min(...available.map(item => item.value));
  const maximum = Math.max(...available.map(item => item.value));
  const span = Math.max(maximum - minimum, 1);
  const yMin = selectedRaceId ? 0 : Math.max(0, minimum - span * 0.14);
  const yMax = selectedRaceId ? 100 : Math.min(OFFICE_TOTAL[office], maximum + span * 0.14);
  const ySpan = Math.max(yMax - yMin, 1);
  const xAt = (index: number) => left + index / Math.max(viewPoints.length - 1, 1) * plotWidth;
  const yAt = (value: number) => top + (yMax - value) / ySpan * plotHeight;
  const selectedIndex = viewPoints.findIndex(point => point.date === selectedDate);
  const selected = selectedIndex >= 0 ? viewPoints[selectedIndex] : undefined;
  const selectedRace = selectedRaceId ? selected?.date ? history.races[selected.date]?.[office]?.find(row => row.id === selectedRaceId) : undefined : undefined;
  const selectedValue = selectedRaceId ? selectedRace?.chance === undefined ? null : selectedRace.chance * 100 : selected ? valueFor(selected, office) : null;

  const ticks = Array.from({ length: 5 }, (_, index) => yMin + (ySpan * index) / 4);
  const guides = ticks.map(value => {
    const y = yAt(value).toFixed(1);
    return `<g><line class=\"sim-history-gridline\" x1=\"${left}\" x2=\"${width - right}\" y1=\"${y}\" y2=\"${y}\"/><text class=\"sim-history-axis-label\" x=\"${left - 9}\" y=\"${Number(y) + 4}\" text-anchor=\"end\">${formatAxis(value)}</text></g>`;
  }).join("");
  const xTickIndexes = [0, Math.round((viewPoints.length - 1) / 3), Math.round((viewPoints.length - 1) * 2 / 3), viewPoints.length - 1];
  const xLabels = [...new Set(xTickIndexes)].map(index => {
    const x = xAt(index).toFixed(1);
    return `<text class=\"sim-history-axis-label\" x=\"${x}\" y=\"${height - 15}\" text-anchor=\"middle\">${escapeHtml(chartDate(viewPoints[index].date))}</text>`;
  }).join("");

  const segments: string[] = [];
  let segment: string[] = [];
  const circles: string[] = [];
  viewPoints.forEach((point, index) => {
    const race = selectedRaceId ? history.races[point.date]?.[office]?.find(row => row.id === selectedRaceId) : undefined;
    const value = selectedRaceId ? race?.chance === undefined ? null : race.chance * 100 : valueFor(point, office);
    if (value === null) {
      if (segment.length) segments.push(segment.join(" "));
      segment = [];
      return;
    }
    segment.push(`${segment.length ? "L" : "M"}${xAt(index).toFixed(1)},${yAt(value).toFixed(1)}`);
    const isSelected = point.date === selectedDate;
    circles.push(`<circle class=\"sim-history-point${isSelected ? " is-selected" : ""}\" data-history-date=\"${point.date}\" cx=\"${xAt(index).toFixed(1)}\" cy=\"${yAt(value).toFixed(1)}\" r=\"${isSelected ? 5 : 2.2}\"><title>${escapeHtml(dateLabel(point.date))}: ${selectedRaceId ? value.toFixed(1) + "% Democratic win chance" : value.toFixed(1)}</title></circle>`);
  });
  if (segment.length) segments.push(segment.join(" "));
  const lines = segments.map(points => `<polyline class=\"sim-history-line\" points=\"${points.replaceAll("M", "").replaceAll("L", " ")}\"/>`).join("");
  const selectedMarker = selectedValue === null || selectedValue === undefined
    ? ""
    : `<line class=\"sim-history-selected-date\" x1=\"${xAt(selectedIndex).toFixed(1)}\" x2=\"${xAt(selectedIndex).toFixed(1)}\" y1=\"${top}\" y2=\"${height - bottom}\"/>`;
  const title = selectedRaceId ? `${selectedRaceLabel} Democratic win chance` : officeValueLabelForChart(office);
  const viewStartDate = viewPoints[0].date;
  const viewEndDate = viewPoints[viewPoints.length - 1].date;
  const description = `${title} across saved releases from ${dateLabel(viewStartDate)} through ${dateLabel(viewEndDate)}. One point represents each release; no daily values are interpolated.${selectedRaceId ? " The vertical axis spans zero to 100 percent." : " The vertical scale is focused on the observed range."}`;
  return `<div class=\"sim-history-chart-scroll\" role=\"region\" aria-label=\"${escapeHtml(title + " chart") }\" tabindex=\"0\"><svg class=\"sim-history-svg\" role=\"img\" aria-labelledby=\"sim-history-chart-title sim-history-chart-description\" viewBox=\"0 0 ${width} ${height}\"><title id=\"sim-history-chart-title\">${escapeHtml(title)}</title><desc id=\"sim-history-chart-description\">${escapeHtml(description)}</desc>${guides}${selectedMarker}${lines}${circles.join("")}${xLabels}<text class=\"sim-history-axis-caption\" transform=\"translate(17 ${top + plotHeight / 2}) rotate(-90)\" text-anchor=\"middle\">${selectedRaceId ? "D win chance (%)" : "Expected seats / wins"}</text></svg></div>`;
}

function officeValueLabelForChart(office: Office): string {
  return OFFICE_VALUE_LABEL[office];
}

function raceLabel(race: SimulatedHistoryRace, office: Office, currentRaces: Map<string, CurrentData["races"][number]>): string {
  const current = currentRaces.get(race.id);
  if (current) return raceName(current);
  if (office === "Senate") return `${race.state} Senate`;
  if (office === "Governor") return `${race.state} Governor`;
  const district = race.id.split("-")[1] || "00";
  return `${race.state} ${district === "00" ? "At-large" : `District ${Number.parseInt(district, 10) || district}`}`;
}

function raceLinkUrl(raceId: string, date: string, office: Office): string {
  const path = raceUrl(raceId);
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}simulation_date=${encodeURIComponent(date)}&simulation_office=${encodeURIComponent(office)}`;
}

export async function renderSimulatedHistory(target: HTMLElement, current: CurrentData): Promise<void> {
  let history: SimulatedHistory;
  try {
    const response = await fetch(assetUrl("data/simulated-history.json"), { cache: "no-store" });
    if (!response.ok) throw new Error("The simulated history data could not be loaded.");
    const candidate: unknown = await response.json();
    if (!cleanHistory(candidate)) throw new Error("The simulated history file has an unsupported format.");
    history = candidate;
  } catch (error) {
    target.innerHTML = `<section class="content-panel"><h2>Simulated history unavailable</h2><p>${escapeHtml(error instanceof Error ? error.message : "The simulated history data could not be loaded.")}</p></section>`;
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const requestedRaceId = params.get("race") || "";
  const currentRaces = new Map(current.races.map(race => [race.race_id, race]));
  const requestedOffice = OFFICE_ORDER.find(office => office === params.get("office"));
  let selectedOffice: Office = requestedOffice || currentRaces.get(requestedRaceId)?.office || "House";
  const raceMaps = new Map<Office, Map<string, SimulatedHistoryRace>>(OFFICE_ORDER.map(office => [office, new Map()]));
  for (const offices of Object.values(history.races)) {
    for (const office of OFFICE_ORDER) {
      for (const race of offices[office] || []) raceMaps.get(office)!.set(race.id, race);
    }
  }
  const racesByOffice = new Map<Office, SimulatedHistoryRace[]>(OFFICE_ORDER.map(office => [
    office,
    [...raceMaps.get(office)!.values()].sort((left, right) => raceLabel(left, office, currentRaces).localeCompare(raceLabel(right, office, currentRaces)))
  ]));
  let selectedRaceId = racesByOffice.get(selectedOffice)!.some(race => race.id === requestedRaceId) ? requestedRaceId : "";
  const requestedDate = params.get("date") || "";
  let selectedIndex = requestedDate ? history.daily.findIndex(point => point.date === requestedDate) : -1;
  const requestedDateMissing = Boolean(requestedDate && selectedIndex < 0);
  if (selectedIndex < 0) {
    selectedIndex = [...history.daily.keys()].reverse().find(index => selectedRaceId
      ? Boolean(history.races[history.daily[index].date]?.[selectedOffice]?.some(race => race.id === selectedRaceId))
      : valueFor(history.daily[index], selectedOffice) !== null) ?? history.daily.length - 1;
  }
  const [initialMinimum, initialMaximum] = sliderBounds(history, selectedOffice);
  let selectionNotice = requestedDateMissing
    ? `No replay date is available for ${/^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? dateLabel(requestedDate) : "that date"}. Showing the latest available date.`
    : "";
  if (selectedIndex < initialMinimum || selectedIndex > initialMaximum) {
    const requested = selectedIndex >= 0 ? history.daily[selectedIndex].date : requestedDate;
    selectedIndex = Math.max(initialMinimum, Math.min(initialMaximum, selectedIndex));
    selectionNotice = `No ${selectedOffice} forecast is available for ${dateLabel(requested)}. Showing dates from ${dateLabel(history.daily[initialMinimum].date)}.`;
  }

  const currentForecastDate = dateLabel(current.snapshot_date);
  const replayCutoffDate = dateLabel(history.cutoff_date_utc);
  const publishedOutlookCards = OFFICE_ORDER.map(office => {
    const outlook = current.summary.seat_outlooks[office];
    const expectedDem = Number(outlook.expected_dem_seats).toFixed(1);
    const expectedRep = Number(outlook.expected_rep_seats).toFixed(1);
    const demLabel = office === "House" ? "expected Democratic seats" : office === "Senate" ? "expected Democratic-caucus seats" : "expected Democratic wins";
    const repLabel = office === "House" ? "expected Republican seats" : office === "Senate" ? "expected Republican seats" : "expected Republican wins";
    return `<article class="archive-seat-card"><div class="archive-seat-card-head"><div><p class="eyebrow">${escapeHtml(office.toUpperCase())} · ${escapeHtml(dateLabel(outlook.snapshot_date))}</p><h3>${expectedDem}</h3><p>${escapeHtml(demLabel)}</p></div></div><p class="sim-current-release-republican">${expectedRep} ${escapeHtml(repLabel)}</p></article>`;
  }).join("");
  const inputDateNote = `Forecast data dates vary by office; the current snapshot is dated ${currentForecastDate}.`;
  const releaseDetails = "";
  const publishedReferenceMarkup = `<section class="sim-current-release" aria-label="Latest published forecast reference"><div class="archive-section-heading"><div><p class="eyebrow">CURRENT PUBLIC FORECAST</p><h3>${escapeHtml(currentForecastDate)} release</h3></div><span class="archive-current-tag">Release reference</span></div><div class="archive-seat-overview">${publishedOutlookCards}</div><p class="archive-intro">${escapeHtml(inputDateNote)} These totals match the current public forecast shown elsewhere on the site.</p>${releaseDetails}</section>`;
  target.innerHTML = `<section class="content-panel sim-history-panel" aria-labelledby="sim-history-title"><div class="archive-section-heading"><div><p class="eyebrow">SAVED RELEASES · 2026</p><h2 id="sim-history-title">Simulated release history</h2></div><span class="archive-current-tag">Through ${escapeHtml(replayCutoffDate)} UTC</span></div><p class="archive-intro sim-history-warning">The sequence contains one point for each of eight distinct saved releases, from ${escapeHtml(dateLabel(history.start_date))} through ${escapeHtml(replayCutoffDate)}. Historical releases are reconstructed from saved cutoff inputs using the current public forecasting method; they are not the values originally shown on those dates.</p>${publishedReferenceMarkup}<div class="sim-history-controls"><label for="sim-history-office">Office <select id="sim-history-office">${OFFICE_ORDER.map(office => `<option value="${office}">${office}</option>`).join("")}</select></label><label class="sim-history-date-control" for="sim-history-date">Release <input id="sim-history-date" type="range" min="${initialMinimum}" max="${initialMaximum}" step="1" value="${selectedIndex}" aria-describedby="sim-history-date-help"><output id="sim-history-date-output" for="sim-history-date"></output></label><label for="sim-history-race">Race series <select id="sim-history-race"><option value="">All ${selectedOffice} races</option>${racesByOffice.get(selectedOffice)!.map(race => `<option value="${escapeHtml(race.id)}">${escapeHtml(raceLabel(race, selectedOffice, currentRaces))}</option>`).join("")}</select></label></div><p id="sim-history-selection-notice" class="sim-history-selection-notice" aria-live="polite"${selectionNotice ? "" : " hidden"}>${escapeHtml(selectionNotice)}</p><p id="sim-history-date-help" class="sim-history-help">Move the slider or select a release point on the chart.</p><div id="sim-history-chart" class="sim-history-chart"></div><p id="sim-history-selected-value" class="sim-history-selected-value" aria-live="polite"></p><div id="sim-history-race-controls" class="sim-history-race-controls"><a id="sim-history-race-link" class="button-quiet sim-history-race-link" href="#" hidden>Open race detail</a><span id="sim-history-race-help" class="fine-print" aria-live="polite"></span></div><details class="sim-history-disclosure"><summary>Coverage and timing</summary><div id="sim-history-coverage"></div><p>The sequence contains only saved releases; no values are estimated between them. Releases are spaced in order on the chart, regardless of the number of days between snapshots. Senate totals include 65 fixed seats; governor totals cover 36 races on the ballot.</p><p>The chamber chart's vertical scale is focused on its forecast values; a selected race's win-chance chart uses a 0–100% scale.</p><p>This reconstructed series is for comparing saved releases, not scoring historical accuracy. It does not represent the forecast as originally shown on each earlier date.</p><p>Poll publication timing is unknown for many source rows. Fieldwork dates and archive dates do not prove when a poll became public. Current district boundaries and candidate metadata are held fixed, and some historical predictor revisions are unavailable.</p></details></section>`;

  const officeSelect = target.querySelector<HTMLSelectElement>("#sim-history-office")!;
  const dateSlider = target.querySelector<HTMLInputElement>("#sim-history-date")!;
  const dateOutput = target.querySelector<HTMLOutputElement>("#sim-history-date-output")!;
  const chart = target.querySelector<HTMLElement>("#sim-history-chart")!;
  const selectedValue = target.querySelector<HTMLElement>("#sim-history-selected-value")!;
  const raceSelect = target.querySelector<HTMLSelectElement>("#sim-history-race")!;
  const raceLink = target.querySelector<HTMLAnchorElement>("#sim-history-race-link")!;
  const raceHelp = target.querySelector<HTMLElement>("#sim-history-race-help")!;
  const coverage = target.querySelector<HTMLElement>("#sim-history-coverage")!;
  const notice = target.querySelector<HTMLElement>("#sim-history-selection-notice")!;
  officeSelect.value = selectedOffice;
  raceSelect.value = selectedRaceId;

  const updateOfficeBounds = (preferredIndex: number): void => {
    const [minimum, maximum] = sliderBounds(history, selectedOffice);
    dateSlider.min = String(minimum);
    dateSlider.max = String(maximum);
    if (preferredIndex < minimum || preferredIndex > maximum) {
      const requested = history.daily[Math.max(0, Math.min(history.daily.length - 1, preferredIndex))].date;
      selectedIndex = Math.max(minimum, Math.min(maximum, preferredIndex));
      selectionNotice = `No ${selectedOffice} forecast is available for ${dateLabel(requested)}. Showing dates from ${dateLabel(history.daily[minimum].date)}.`;
    } else {
      selectedIndex = preferredIndex;
      selectionNotice = "";
    }
    dateSlider.value = String(selectedIndex);
    notice.textContent = selectionNotice;
    notice.hidden = !selectionNotice;
  };

  const refresh = (): void => {
    selectedIndex = Math.max(0, Math.min(history.daily.length - 1, Number(dateSlider.value)));
    const selected = history.daily[selectedIndex];
    const selectedDate = selected.date;
    const selectedRace = selectedRaceId ? history.races[selectedDate]?.[selectedOffice]?.find(race => race.id === selectedRaceId) : undefined;
    const selectedRaceRecord = selectedRaceId ? raceMaps.get(selectedOffice)!.get(selectedRaceId) : undefined;
    const selectedRaceLabel = selectedRaceRecord ? raceLabel(selectedRaceRecord, selectedOffice, currentRaces) : "";
    dateOutput.value = dateLabel(selectedDate);
    dateOutput.textContent = dateLabel(selectedDate);
    chart.innerHTML = chartMarkup(history, selectedOffice, selectedDate, selectedRaceId, selectedRaceLabel);
    const value = valueFor(selected, selectedOffice);
    if (selectedRaceId) {
      selectedValue.textContent = selectedRace
        ? `${selectedRaceLabel}: ${pct(selectedRace.chance)} Democratic win chance · ${marginLabel(selectedRace.margin)} margin on ${dateLabel(selectedDate)}.`
        : `No ${selectedRaceLabel} forecast is available for ${dateLabel(selectedDate)}.`;
      if (selectedRace) {
        raceLink.href = raceLinkUrl(selectedRace.id, selectedDate, selectedOffice);
        raceLink.hidden = false;
      } else {
        raceLink.removeAttribute("href");
        raceLink.hidden = true;
      }
      raceHelp.textContent = "This chart follows one race's Democratic win chance over time.";
    } else {
      selectedValue.textContent = value === null
        ? `No ${selectedOffice} forecast is available for ${dateLabel(selectedDate)}.`
        : `${value.toFixed(1)} ${OFFICE_VALUE_LABEL[selectedOffice]} out of ${OFFICE_TOTAL[selectedOffice]}.`;
      raceLink.removeAttribute("href");
      raceLink.hidden = true;
      raceHelp.textContent = "Choose a race to follow its win chance over time.";
    }
    coverage.innerHTML = coverageNote(history, selectedOffice);
  };

  refresh();
  officeSelect.addEventListener("change", () => {
    const preferredIndex = selectedIndex;
    selectedOffice = OFFICE_ORDER.find(office => office === officeSelect.value) || "House";
    selectedRaceId = racesByOffice.get(selectedOffice)!.some(race => race.id === selectedRaceId) ? selectedRaceId : "";
    raceSelect.innerHTML = `<option value="">All ${selectedOffice} races</option>${racesByOffice.get(selectedOffice)!.map(race => `<option value="${escapeHtml(race.id)}">${escapeHtml(raceLabel(race, selectedOffice, currentRaces))}</option>`).join("")}`;
    raceSelect.value = selectedRaceId;
    updateOfficeBounds(preferredIndex);
    refresh();
  });
  dateSlider.addEventListener("input", () => {
    selectionNotice = "";
    notice.hidden = true;
    refresh();
  });
  raceSelect.addEventListener("change", () => {
    selectedRaceId = raceSelect.value;
    refresh();
  });
  chart.addEventListener("click", event => {
    const point = (event.target as HTMLElement).closest<SVGCircleElement>("[data-history-date]");
    const index = history.daily.findIndex(row => row.date === point?.dataset.historyDate);
    if (index < 0) return;
    dateSlider.value = String(index);
    selectionNotice = "";
    notice.hidden = true;
    refresh();
  });
}
