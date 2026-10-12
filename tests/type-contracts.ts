import type { SavedDesign, ModelCatalog, LivePbiInstance, MeasureWritePayload, MeasureWriteResult, ModelRequestSession, DesignSession, MeasureWriteTarget, MeasureWriteApproval, BridgeApiError } from '../dist/types.js';
import { fetchLivePbiModel, discoverLivePbi, injectMeasureToLivePbi } from '../dist/pbi-client.mjs';
import { beginModelRequest, matchesModelTarget } from '../dist/model-session.mjs';
import { captureDesignSession, isDesignSessionCurrent } from '../dist/state.mjs';
import { applyLiveMeasure } from '../dist/measure-write.mjs';

// Compile the consumer contract too: mismatched runtime field names must fail.
function consume(saved: SavedDesign, model: ModelCatalog, instance: LivePbiInstance, write: MeasureWritePayload) {
  const date: string | undefined = saved.date;
  const tables: string[] = model.tables;
  const expression: string | undefined = model.measures[0]?.expression;
  const columns: string[] = model.dateTables[0]?.dateColumns;
  const server: string = instance.server;
  const live: Promise<ModelCatalog> = fetchLivePbiModel(server, instance.database);
  const instances: Promise<LivePbiInstance[]> = discoverLivePbi();
  injectMeasureToLivePbi(write);
  // @ts-expect-error Catalogs expose measures, never the old allMeasures array.
  model.allMeasures;
  // @ts-expect-error Saved entries store an ISO date, not an optional numeric timestamp.
  saved.timestamp;
  // @ts-expect-error Measure expressions use expression, never dax.
  model.measures[0].dax;
  // @ts-expect-error Discovery uses database, never dbName.
  instance.dbName;
  // @ts-expect-error Optimistic concurrency requires the reviewed expression.
  injectMeasureToLivePbi({ server, database: 'db', tableName: 'KPIs', measureName: 'Card', daxExpression: '1' });
  return { date, tables, expression, columns, live, instances };
}
void consume;

function consumeOperation(model: ModelCatalog, target: MeasureWriteTarget, approval: MeasureWriteApproval, error: BridgeApiError, write: MeasureWritePayload) {
  const request: ModelRequestSession = beginModelRequest();
  const signal: AbortSignal = request.signal;
  const committed: boolean = request.commit(model, false);
  const current: boolean = request.isCurrent();
  const design: DesignSession = captureDesignSession();
  const sameDesign: boolean = isDesignSessionCurrent(design);
  const sameTarget: boolean = matchesModelTarget(model, target);
  const outcomeUnknown: boolean | undefined = error.outcomeUnknown;
  const result: Promise<MeasureWriteResult> = injectMeasureToLivePbi(write);
  applyLiveMeasure(write.configAnnotation, approval, target);
  // @ts-expect-error Reviewed approvals must include the exact expected expression.
  applyLiveMeasure(write.configAnnotation, { server: target.server, database: target.database, table: target.tableName });
  // @ts-expect-error A pinned destination cannot be mutated after submission.
  target.server = 'localhost:99999';
  // @ts-expect-error A model-session commit accepts a validated catalog shape.
  request.commit({ tables: [], measures: [], dateTables: [] });
  // @ts-expect-error An unknown write outcome is a boolean, not arbitrary text.
  error.outcomeUnknown = 'uncertain';
  // @ts-expect-error Session comparisons require the captured context and revision.
  isDesignSessionCurrent({ revision: 1 });
  request.finish();
  return { signal, committed, current, design, sameDesign, sameTarget, outcomeUnknown, result };
}
void consumeOperation;
