export interface DtcSection {
  heading: string | null;
  text: string;
}

export interface DtcFigure {
  ord: number | null;
  filename: string;
  caption: string | null;
}

/** One row of the code index (list view). */
export interface DtcCodeSummary {
  id: string;
  code: string;
  chart: string | null;
  part: string | null;
  summary: string | null;
}

/** Full detail for a single code (detail view). */
export interface DtcCodeDetail extends DtcCodeSummary {
  sections: DtcSection[];
  body: string | null;
  source_url: string | null;
  figures: DtcFigure[];
}

export interface DtcVehicle {
  id: string;
  slug: string;
  make: string;
  model: string;
  year: number;
  engine: string | null;
  source: string | null;
  page_count: number | null;
  code_count: number | null;
}
