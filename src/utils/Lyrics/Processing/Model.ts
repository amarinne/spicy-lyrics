export type TextRange = {
  readonly startCp: number;
  readonly endCp: number;
};

export type ParagraphProvenance = "provider" | "lineBoundary" | "unavailable";
export type BoundaryKind = "explicitWhitespace" | "paragraph" | "script" | "inferred";
export type JoinRelation = "attached" | "boundary" | "unknown";
export type ReadingUnitKind = "transformed" | "passthrough" | "punctuation";
export type ReadingProvenance = "provider" | "local" | "remoteFallback";

export type SourceSpan = {
  readonly id: string;
  readonly rawText: string;
  readonly cleanText: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly providerPartOfWord?: boolean;
  readonly paragraphId?: string;
};

export type ParsedLine = {
  readonly id: string;
  readonly displayText: string;
  readonly spans: readonly SourceSpan[];
  readonly paragraphId?: string;
  readonly paragraphProvenance: ParagraphProvenance;
  readonly providerAnnotations?: Readonly<Record<string, unknown>>;
};

export type ParsedDocument = {
  readonly id: string;
  readonly language: string;
  readonly lines: readonly ParsedLine[];
};

export type CanonicalSpanMapping = {
  readonly spanId: string;
  readonly canonicalRange: TextRange;
};

export type Boundary = {
  readonly offsetCp: number;
  readonly kind: BoundaryKind;
  readonly confidence: number;
  readonly provenance: string;
};

export type SpanJoinEvidence = {
  readonly afterSpanId: string;
  readonly relation: JoinRelation;
  readonly confidence: number;
  readonly provenance: string;
};

export type CanonicalLine = {
  readonly lineId: string;
  readonly text: string;
  readonly spanMappings: readonly CanonicalSpanMapping[];
  readonly boundaries: readonly Boundary[];
  readonly joins: readonly SpanJoinEvidence[];
};

export type ScriptRun = {
  readonly script: string;
  readonly canonicalRange: TextRange;
};

export type ReadingUnit = {
  readonly canonicalRange: TextRange;
  readonly text: string;
  readonly kind: ReadingUnitKind;
  readonly logicalGroupId: string;
  readonly timingRefs: readonly string[];
};

export type ReadingAnnotation = {
  readonly processor: string;
  readonly mode: string;
  readonly provenance: ReadingProvenance;
  readonly units: readonly ReadingUnit[];
  readonly furigana?: readonly unknown[];
};

export type TimedReadingUnit = {
  readonly spanId: string;
  readonly canonicalRange: TextRange;
  readonly text: string;
  readonly logicalGroupId: string;
};

export type RenderPlan = {
  readonly lineId: string;
  readonly sourceUnits: readonly CanonicalSpanMapping[];
  readonly readingUnits: readonly ReadingUnit[];
  readonly timedReadingUnits: readonly TimedReadingUnit[];
  readonly joinedDisplayText: string;
  readonly translation?: string;
  readonly furigana?: readonly unknown[];
};

export type LanguageContext = {
  readonly language: string;
  readonly scripts?: readonly string[];
};

export type ReadingOptions = Readonly<Record<string, unknown>>;
export type ValidationResult = { readonly valid: boolean; readonly errors: readonly string[] };

export interface ProviderAdapter<Input = unknown> {
  parse(input: Input): ParsedDocument;
}

export interface CanonicalLineBuilder {
  build(line: ParsedLine): CanonicalLine;
}

export interface ScriptPartitioner {
  partition(line: CanonicalLine, context: LanguageContext): readonly ScriptRun[];
}

export interface ReadingProcessor {
  supports(run: ScriptRun, context: LanguageContext): boolean;
  annotate(
    line: CanonicalLine,
    run: ScriptRun,
    options: ReadingOptions
  ): ReadingAnnotation | Promise<ReadingAnnotation>;
}

export interface ReadingPlanValidator {
  validate(line: CanonicalLine, annotation: ReadingAnnotation): ValidationResult;
}

export interface RenderPlanBuilder {
  build(
    line: ParsedLine,
    canonical: CanonicalLine,
    annotations: readonly ReadingAnnotation[]
  ): RenderPlan;
}

// Phase-0 experimental model retained for corpus evidence only. Production has no caller.
export type NormalizedSpanRef = { readonly spanId: number; readonly source: TextRange };
export type NormalizedBoundary = {
  readonly offsetCp: number;
  readonly kind: "whitespace" | "paragraph" | "script" | "inferred";
};
export type NormalizedLine = {
  readonly text: string;
  readonly spans: readonly NormalizedSpanRef[];
  readonly boundaries: readonly NormalizedBoundary[];
};
export type ReadingGroup = {
  readonly source: TextRange;
  readonly spanIds: readonly number[];
  readonly text: string;
  readonly spaceBefore: boolean;
};
export type SpanReading = {
  readonly spanId: number;
  readonly source: TextRange;
  readonly text: string;
  readonly spaceBefore: boolean;
};
export type ReadingPlan = {
  readonly processor: string;
  readonly mode: string;
  readonly normalized: NormalizedLine;
  readonly displayText: string;
  readonly groups: readonly ReadingGroup[];
  readonly spanReadings: readonly SpanReading[];
};
