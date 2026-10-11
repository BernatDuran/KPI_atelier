// Query-scoped fixtures only: execute through the Power BI MCP query tool, never SaveChanges.
import {BASE,TEMPLATES,sanitizeConfig} from '../../dist/model.mjs';
import {generateDAXBody} from '../../dist/dax.mjs';
const defs = `DEFINE
 TABLE '__AuditCalendarA' = CALENDAR ( DATE ( 2023, 1, 1 ), DATE ( 2025, 12, 31 ) )
 TABLE '__AuditCalendarB' = CALENDAR ( DATE ( 2021, 1, 1 ), DATE ( 2022, 12, 31 ) )
 MEASURE '_Measures'[__AuditValue] = SUMX ( VALUES ( '__AuditCalendarA'[Date] ), DAY ( '__AuditCalendarA'[Date] ) )
 MEASURE '_Measures'[__AuditOtherValue] = SUMX ( VALUES ( '__AuditCalendarB'[Date] ), DAY ( '__AuditCalendarB'[Date] ) )
 MEASURE '_Measures'[__AuditTarget] = 2 * [__AuditValue]
 MEASURE '_Measures'[__AuditReference] = 0.5 * [__AuditValue]
 MEASURE '_Measures'[__AuditStatus] = IF ( ISEMPTY ( VALUES ( '__AuditCalendarA'[Date] ) ), BLANK (), DIVIDE ( COUNTROWS ( VALUES ( '__AuditCalendarA'[Date] ) ), 100 ) )
`;
const mapped = config => sanitizeConfig({...config,measureName:'__AuditHTML',measure:'__AuditValue',targetMeasure:'__AuditTarget',compareMeasure:'__AuditReference',dateTable:'__AuditCalendarA',dateColumn:'Date',maxPoints:12});
const dates = (start,end) => `DATESBETWEEN ( '__AuditCalendarA'[Date], DATE ( ${start.join(', ')} ), DATE ( ${end.join(', ')} ) )`;
const body = (config, assertion) => {
 const code=generateDAXBody(config);
 return assertion ? code.slice(0,code.lastIndexOf('\nRETURN\n'))+'\nRETURN '+assertion : code;
};
const check = (id,config,assertion,filter='',htmlAssert='LEN ( [__AuditHTML] ) > 0') => ({id,query:defs+` MEASURE '_Measures'[__AuditCheck] = ${body(config,assertion)}
 MEASURE '_Measures'[__AuditHTML] = ${body(config)}
 EVALUATE ROW ( "pass", ${filter?`CALCULATE ( [__AuditCheck] && (${htmlAssert}), ${filter} )`:`[__AuditCheck] && (${htmlAssert})`} )`});
export const engineQueries = [
 ...TEMPLATES.map(t=>check('template:'+t.id,mapped(t.config),'TRUE ()')),
 check('independent-copy-calendars',mapped({...BASE,elements:{trend_copy1:{measure:'__AuditOtherValue',dateTable:'__AuditCalendarB',dateColumn:'Date'}}}),`__Start = DATE ( 2025, 1, 1 ) && __End = DATE ( 2025, 12, 31 ) && __Start_trend_copy1 = DATE ( 2022, 1, 1 ) && __End_trend_copy1 = DATE ( 2022, 12, 31 ) && __Span_trend_copy1 = 365 && __N_trend_copy1 > 0`),
 check('default-window-goal-reference',mapped({...BASE,comparison:'custom'}),'__Current < [__AuditValue] && __Target = 2 * __Current && __Reference = 0.5 * __Current && __GoalRatio = 0.5'),
 check('same-period-goal-reference',mapped({...BASE,comparison:'custom'}),'__Current = 33 && __Target = 66 && __Reference = 16.5 && __GoalRatio = 0.5',dates([2024,1,10],[2024,1,12])),
 check('prior-period-complete',mapped({...BASE,comparison:'previous'}),'__ComparableDates && __Reference = 24',dates([2024,1,10],[2024,1,12])),
 check('prior-period-incomplete',mapped({...BASE,comparison:'previous'}),'NOT __ComparableDates && ISBLANK ( __Reference )',dates([2023,1,1],[2023,1,3])),
 check('prior-period-discontinuous',mapped({...BASE,comparison:'previous'}),'NOT __ComparableDates && ISBLANK ( __Reference )',`TREATAS ( { DATE ( 2024, 1, 10 ), DATE ( 2024, 1, 12 ) }, '__AuditCalendarA'[Date] )`),
 check('yoy-leap-day',mapped({...BASE,comparison:'yoy'}),'__ComparableDates && __Current = 57 && __Reference = 28',dates([2024,2,28],[2024,2,29])),
 ...[['good',3,'STATUS_COPY_GOOD'],['warn',4,'STATUS_COPY_WARN'],['bad',6,'STATUS_COPY_BAD'],['blank',0,'Sin datos']].map(([id,count,label])=>check('status-copy:'+id,mapped({...BASE,type:'status',comparison:'none',showTrend:false,showGoal:false,elements:{status_copy1:{measure:'__AuditStatus',direction:'down',goodThreshold:.03,warnThreshold:.05,statusGood:'STATUS_COPY_GOOD',statusWarn:'STATUS_COPY_WARN',statusBad:'STATUS_COPY_BAD'}}}),`__status_status_copy1 = "${label}"`,count?dates([2024,1,1],[2024,1,count]):dates([2030,1,1],[2030,1,1]),`CONTAINSSTRING ( [__AuditHTML], "${label}" )`))
];
