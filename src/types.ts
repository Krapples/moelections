export type Office = "House" | "Senate" | "Governor";

export interface ForecastRace {
  race_id: string;
  office: Office;
  state: string;
  district: string | number;
  dem_margin_pp: number | null;
  dem_probability: number;
  rep_probability: number;
  accuracy_scoring_eligible?: boolean;
  accuracy_exclusion_reason?: string;
  /** Optional editorial probability band; current snapshot derives display bands from probability. */
  forecast_rating?: string;
  forecast_as_of?: string;
}

export interface CandidateListing {
  race_id: string;
  state: string;
  office: Office;
  candidates: Array<{ name: string; party: string }>;
  source_url: string;
}

export interface CandidateDataset {
  schema_version: number;
  election_year: number;
  retrieved_at: string;
  license: { name: string; spdx: string; url: string };
  attribution: string;
  notes: string;
  sources: Array<{ office: Office; label: string; url: string }>;
  races: CandidateListing[];
}

export interface SeatOutlook {
  snapshot_date: string;
  total_seats: number;
  expected_dem_seats: number;
  expected_rep_seats: number;
  rounded_dem_seats: number;
  rounded_rep_seats: number;
  dem_favored_districts?: number;
  rep_favored_districts?: number;
  dem_favored_races?: number;
  rep_favored_races?: number;
  forecast_seats?: number;
  fixed_seats?: number;
  core_range?: number[] | null;
  outer_range?: number[] | null;
  expected_label?: string;
  coverage_note?: string;
  scope_label?: string;
}

export interface ForecastSummary {
  generic_ballot: {
    margin_pp: number;
    input_snapshot_date: string;
    source_label: string;
    source_url: string;
    display_type: string;
    external_poll: {
      release_date: string;
      field_dates: string;
      likely_voter_margin_pp: number;
      registered_voter_margin_pp: number;
      source_url: string;
      status: string;
    };
    short_window?: {
      margin_pp: number;
      poll_count: number;
      window_days: number;
    };
    long_window?: {
      margin_pp: number;
      poll_count: number;
      window_days: number;
    };
    margin_definition?: string;
    timing_rule?: string;
    unknown_first_public_date_polls_used?: number;
    first_public_timing_verified?: boolean;
  };
  generic_ballot_forecast: {
    margin_pp: number;
    input_snapshot_date: string;
    target: string;
  };
  seat_outlooks: Record<Office, SeatOutlook>;
  senate_seat_distribution?: {
    median_dem_seats: number;
    fixed_dem_caucus_seats?: number;
    fixed_rep_seats?: number;
    central_50_range: number[];
    central_80_range: number[];
    central_90_range: number[];
    interpretation?: string;
    pmf_file?: string;
  };
  governor_seat_distribution?: {
    median_dem_wins: number;
    central_50_range: number[];
    central_80_range: number[];
    central_90_range: number[];
    interpretation?: string;
    pmf_file?: string;
  };
  seat_range_note?: string;
}

export interface HistoricalMetric {
  office: Office;
  cycle: number | "Pooled";
  races: number;
  margin_mae_pp: number;
  brier_score: number;
  log_loss: number;
  accuracy: number;
  predicted_dem_seat_calls: number;
  actual_dem_wins_covered: number;
  signed_seat_error: number;
  expected_dem_seats?: number | null;
  expected_seat_error?: number | null;
}

export interface HistoricalPerformance {
  snapshot_date: string;
  cycles: number[];
  validation_explanation: string;
  metrics: HistoricalMetric[];
}

export interface RatingAccuracyMetric {
  races: number;
  correct_calls: number;
  accuracy: number | null;
}

export type RatingAccuracyCategory = RatingAccuracyMetric;

export interface RatingAccuracyScope {
  overall: RatingAccuracyMetric;
  categories: Record<string, RatingAccuracyCategory>;
}

export interface RatingAccuracy {
  schema_version: number;
  snapshot_date: string;
  validation_years: number[];
  call_rule: string;
  rating_definition: string;
  validation_note: string;
  results: Record<string, RatingAccuracyScope>;
}

export interface GenericBallotHistoryRow {
  cycle: number;
  snapshot_date: string;
  forecast_margin_pp: number;
  poll_average_margin_pp: number;
  actual_house_margin_pp: number;
}

export interface GenericBallotHistory {
  schema_version: number;
  target: string;
  poll_average_source_label: string;
  poll_average_source_url: string;
  poll_average_method: string;
  timing_note: string;
  validation_note: string;
  rows: GenericBallotHistoryRow[];
}

export interface RetrospectivePoll {
  pollster: string;
  question?: string;
  field_start: string;
  field_end: string;
  margin_pp: number | null;
  source: string;
  source_url: string | null;
  sample_size: string | null;
  population: string | null;
  match_status: string;
  final_30_days: boolean;
  average_eligible: boolean;
  poll_id: string | null;
  licence?: string;
}

export interface RetrospectiveHistoryRow {
  year: number;
  actual_margin_pp: number | null;
  predicted_margin_pp: number | null;
  dem_win_probability?: number | null;
  poll_count: number;
  final_30_day_poll_count: number;
  poll_average_margin_pp: number | null;
  polls: RetrospectivePoll[];
}

export interface RaceRetrospective {
  office: Office;
  state: string;
  historical_rows: RetrospectiveHistoryRow[];
  current_polling: {
    poll_count: number;
    poll_average_margin_pp: number | null;
    source_as_of?: string;
    polls: RetrospectivePoll[];
  };
}

export interface RaceRetrospectives {
  schema_version: number;
  snapshot_date: string;
  coverage_note: string;
  races: Record<string, RaceRetrospective>;
}

export interface CurrentData {
  schema_version: number;
  series_id: string;
  snapshot_id: string;
  snapshot_date: string;
  races: ForecastRace[];
  summary: ForecastSummary;
  historical_performance: HistoricalPerformance;
  previous_contest_results: Record<string, { year: number; winner: "D" | "R" }>;
}

export interface SnapshotIndex {
  schema_version: number;
  series_id: string;
  snapshots: Array<{
    snapshot_id: string;
    snapshot_date: string;
    series_id: string;
    schema_version: number;
    path: string;
    status: string;
    archive_note?: string;
    race_count?: number;
    office_counts?: Partial<Record<Office, number>>;
  }>;
  schema_note?: string;
}

export interface SavedForecastSnapshot {
  schema_version: number;
  series_id: string;
  snapshot_id: string;
  snapshot_date: string;
  archive_note?: string;
  summary?: Pick<ForecastSummary, "generic_ballot_forecast">;
  races: ForecastRace[];
}

export interface SimulatedHistoryPoint {
  date: string;
  h: number | null;
  s: number | null;
  g: number | null;
}

export interface SimulatedHistoryRace {
  id: string;
  state: string;
  margin: number;
  chance: number;
}

export interface SimulatedHistory {
  schema_version: number;
  start_date: string;
  cutoff_date_utc: string;
  daily: SimulatedHistoryPoint[];
  races: Record<string, Partial<Record<Office, SimulatedHistoryRace[]>>>;
}

export interface ArtworkManifest {
  schema_version: number;
  images: Array<{
    series_key: string;
    series: string;
    filename: string;
    image: string;
    width: number;
    height: number;
    alt?: string;
  }>;
}

export interface RaceChange {
  current: ForecastRace;
  previous: ForecastRace;
  margin_delta_pp: number | null;
  dem_probability_delta_pp: number;
  rep_probability_delta_pp: number;
}

export interface SnapshotComparison {
  changed: RaceChange[];
  added: ForecastRace[];
  removed: ForecastRace[];
}
