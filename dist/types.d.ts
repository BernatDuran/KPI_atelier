/**
 * KPI Atelier - Central TypeScript Type Definitions and Data Contracts
 * Defines comprehensive static typings for configuration, geometry, appearance,
 * themes, validation schemas, and external model integrations.
 */

export type CardType = 'basic' | 'comparison' | 'target' | 'status' | 'spark' | 'executive';
export type LayoutType = 'stacked' | 'chart-left' | 'chart-right';
export type ChartKind = 'trend' | 'donut';
export type TrendCurve = 'smooth' | 'linear' | 'step';
export type AreaFill = 'gradient' | 'solid';
export type TrendGrid = 'none' | 'horizontal' | 'dots';
export type TrendStyle = 'area' | 'line' | 'bars';
export type SurfaceEffect = 'solid' | 'glass' | 'aurora' | 'glow' | 'raised';
export type EffectColorMode = 'theme' | 'custom';
export type FormatType = 'currency' | 'number' | 'percent';
export type CurrencyCode = 'EUR' | 'USD' | 'GBP';
export type UnitScale = 'auto' | 'none' | 'k' | 'm';
export type LocaleCode = 'es-ES' | 'en-US' | 'ca-ES';
export type DirectionMode = 'up' | 'down' | 'neutral';
export type ComparisonMode = 'yoy' | 'mom' | 'previous' | 'target' | 'custom' | 'none';
export type DeltaMode = 'relative' | 'absolute' | 'pp';
export type ShadowType = 'none' | 'soft' | 'strong';
export type FontFamily = 'Segoe UI' | 'Arial' | 'Georgia' | string;
export type TextAlign = 'left' | 'center';
export type GranularityMode = 'auto' | 'day' | 'week' | 'month';
export type SampleScenario = 'normal' | 'zero' | 'empty' | 'negative';
export type ColorMode = 'theme' | 'semantic' | 'linked' | 'custom';
export type BackgroundMode = 'auto' | 'custom' | 'none';
export type FillMode = 'linked' | 'custom';
export type ElementKind = 'text' | 'icon' | 'chart' | 'bar';

export interface ElementFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ElementAppearance {
  colorMode?: ColorMode;
  color?: string;
  opacity?: number;
  backgroundMode?: BackgroundMode;
  backgroundColor?: string;
  backgroundOpacity?: number;
  fillMode?: FillMode;
  fillColor?: string;
}

export interface ElementCustomization extends ElementAppearance {
  x?: number;
  y?: number;
  width?: number;
  hidden?: boolean;
  deleted?: boolean;
  text?: string;
  icon?: string;
  size?: number;
  measure?: string;
  format?: FormatType;
  decimals?: number;
  suffix?: string;
  unit?: UnitScale;
  currency?: CurrencyCode;
  targetMeasure?: string;
  compareMeasure?: string;
  deltaMode?: DeltaMode;
  comparison?: ComparisonMode;
  direction?: DirectionMode;
  statusGood?: string;
  statusWarn?: string;
  statusBad?: string;
  goodThreshold?: number;
  warnThreshold?: number;
  dateTable?: string;
  dateColumn?: string;
  chartKind?: ChartKind;
  trendStyle?: TrendStyle;
  trendCurve?: TrendCurve;
  areaFill?: AreaFill;
  fillOpacity?: number;
  lineWidth?: number;
  showMax?: boolean;
  showMin?: boolean;
  showDot?: boolean;
  showMarkerGuides?: boolean;
  zeroBase?: boolean;
  trendGrid?: TrendGrid;
  donutThickness?: number;
  donutLabel?: boolean;
  frame?: ElementFrame;
}

export interface ElementDef {
  label: string;
  kind: ElementKind;
  sizeKey: string;
  defaultSize: number;
  contentKey?: string;
  toggle?: string;
  isDuplicate?: boolean;
  baseId?: string;
}

export interface ThemeConfig {
  name: string;
  background: string;
  text: string;
  muted: string;
  accent: string;
  borderColor: string;
  positive: string;
  negative: string;
  warning: string;
}

export interface CardConfig {
  // Identity & Family
  id: string;
  type: CardType;
  title: string;
  subtitle: string;
  eyebrow: string;
  footer: string;
  customThemeName?: string;

  // Measure and Model Data Bindings
  measure: string;
  measureName: string;
  dateTable: string;
  dateColumn: string;
  targetMeasure: string;
  compareMeasure: string;

  // Format & Semantics
  format: FormatType;
  currency: CurrencyCode;
  unit: UnitScale;
  decimals: number;
  locale: LocaleCode;
  suffix: string;
  direction: DirectionMode;
  comparison: ComparisonMode;
  deltaMode: DeltaMode;

  // Theme & Palette
  theme: string;
  accent: string;
  positive: string;
  negative: string;
  warning: string;
  background: string;
  text: string;
  muted: string;
  borderColor: string;

  // Dimensions & Geometry
  geometryVersion: 1 | 2 | number;
  layout: LayoutType;
  width: number;
  height: number;
  radius: number;
  padding: number;
  borderWidth: number;
  shadow: ShadowType;
  font: FontFamily;
  valueSize: number;
  titleSize: number;
  fontWeight: number;
  align: TextAlign;

  // Feature Toggles
  showIcon: boolean;
  icon: string;
  showSubtitle: boolean;
  showComparison: boolean;
  showTrend: boolean;
  showGoal: boolean;
  showFooter: boolean;

  // Chart & Visualization Options
  chartKind: ChartKind;
  trendCurve: TrendCurve;
  areaFill: AreaFill;
  showMin: boolean;
  showMax: boolean;
  trendGrid: TrendGrid;
  showMarkerGuides: boolean;
  donutThickness: number;
  donutLabel: boolean;
  trendStyle: TrendStyle;
  trendHeight: number;
  lineWidth: number;
  fillOpacity: number;
  showDot: boolean;
  granularity: GranularityMode;
  maxPoints: number;
  zeroBase: boolean;

  // Thresholds & Status Descriptions
  goodThreshold: number;
  warnThreshold: number;
  statusGood: string;
  statusWarn: string;
  statusBad: string;

  // Sample Mock Data
  sampleValue: number;
  samplePrevious: number;
  sampleTarget: number;
  sampleSeries: string;
  sampleScenario: SampleScenario;

  // Surface Effects
  surfaceEffect: SurfaceEffect;
  effectIntensity: number;
  glassOpacity: number;
  glassBlur: number;
  effectColorMode: EffectColorMode;
  effectColor: string;

  // Direct Manipulation & Elements Composition
  elements: Record<string, ElementCustomization>;
  layerOrder: string[];

  // Element Typography & Sizes
  eyebrowSize: number;
  iconSize: number;
  subtitleSize: number;
  deltaSize: number;
  compareLabelSize: number;
  goalSize: number;
  progressSize: number;
  progressHeight: number;
  statusSize: number;
  referenceSize: number;
  referenceValueSize: number;
  footerSize: number;
  periodSize: number;

  // Internal State Tracking
  _measureBound?: boolean;
  _targetCustomized?: boolean;
  _dateCustomized?: boolean;
}

export interface TemplateConfig {
  id: string;
  name: string;
  description: string;
  category: string;
  config: CardConfig;
}

export type ValidationSeverity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  level: ValidationSeverity;
  text: string;
  field?: string;
  elementId?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  data?: CardConfig;
}

export interface SavedDesign {
  id: string;
  name: string;
  timestamp?: number;
  config: CardConfig;
}

export interface MeasureCatalogEntry {
  name: string;
  table?: string;
  dataType?: string;
  dax?: string;
  description?: string;
}

export interface ColumnCatalogEntry {
  name: string;
  dataType?: string;
  isKey?: boolean;
  dataCategory?: string;
}

export interface TableCatalogEntry {
  name: string;
  isDateTable?: boolean;
  measures: MeasureCatalogEntry[];
  columns: ColumnCatalogEntry[];
}

export interface ModelCatalog {
  tables: Record<string, TableCatalogEntry>;
  dateTables: string[];
  allMeasures: string[];
}

export interface LivePbiInstance {
  port: number;
  dbName: string;
  modelName: string;
  source: string;
}

export interface AlignmentGuide {
  type: 'vertical' | 'horizontal';
  pos: number;
  elements: string[];
  isOverflow?: boolean;
}

declare global {
  interface EventTarget {
    value?: any;
    dataset?: DOMStringMap;
    closest?: (selector: string) => HTMLElement | null;
    matches?: (selector: string) => boolean;
    id?: string;
    focus?: (options?: any) => void;
    tagName?: string;
    isContentEditable?: boolean;
    disabled?: boolean;
  }
  interface Element {
    dataset?: DOMStringMap;
    style?: CSSStyleDeclaration;
    offsetHeight?: number;
    selectionStart?: number;
    selectionEnd?: number;
  }
  interface HTMLElement {
    value?: any;
    disabled?: boolean;
    select?: () => void;
    focus?: (options?: any) => void;
    setSelectionRange?: (...args: any[]) => void;
  }
  interface Window {
    showDirectoryPicker?: (options?: any) => Promise<any>;
  }
}
