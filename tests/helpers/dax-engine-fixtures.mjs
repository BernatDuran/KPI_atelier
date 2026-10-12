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
 MEASURE '_Measures'[__AuditHundred] = 100
 MEASURE '_Measures'[__AuditBlank] = BLANK ()
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
 check('inactive-copy-retains-main-context',mapped({...BASE,type:'basic',comparison:'none',showComparison:false,showTrend:false,showGoal:false,elements:{trend_copy1:{measure:'__AuditOtherValue',dateTable:'__AuditCalendarB',dateColumn:'Date'}}}),'__Current = [__AuditValue]'),
 check('copy-own-target-and-format',mapped({...BASE,comparison:'custom',elements:{delta_copy1:{measure:'__AuditValue',comparison:'target',targetMeasure:'100',deltaMode:'absolute',format:'number',unit:'none',decimals:0,direction:'down'}}}),'__Current = 33 && __Diff_delta_copy1 = -67 && __delta_delta_copy1 = "-67" && __deltaColor_delta_copy1 = __Cfg_ColorGood',dates([2024,1,10],[2024,1,12])),
 check('copy-same-reference-independent-format',mapped({...BASE,comparison:'custom',deltaMode:'absolute',format:'currency',currency:'EUR',elements:{delta_copy1:{measure:'__AuditValue',comparison:'custom',compareMeasure:'__AuditReference',deltaMode:'absolute',format:'number',unit:'none',decimals:0,suffix:'uds'}}}),'__Diff_delta_copy1 = 16.5 && CONTAINSSTRING ( __delta_delta_copy1, "uds" ) && NOT CONTAINSSTRING ( __delta_delta_copy1, "€" )',dates([2024,1,10],[2024,1,12])),
 ...TEMPLATES.map(t=>check('template:'+t.id,mapped(t.config),'TRUE ()')),
 check('shared-copy-calendar',mapped({...BASE,elements:{value_copy1:{measure:'__AuditOtherValue'},trend_copy1:{measure:'__AuditOtherValue',dateTable:'__AuditCalendarB',dateColumn:'Date'}}}),`__Start = DATE ( 2025, 1, 1 ) && __End = DATE ( 2025, 12, 31 ) && __Start_trend_copy1 = DATE ( 2025, 1, 1 ) && __End_trend_copy1 = DATE ( 2025, 12, 31 ) && __Span_trend_copy1 = 365 && __N_trend_copy1 > 0`),
 check('default-window-goal-reference',mapped({...BASE,comparison:'custom'}),'__Current < [__AuditValue] && __Target = 2 * __Current && __Reference = 0.5 * __Current && __GoalRatio = 0.5'),
 check('same-period-goal-reference',mapped({...BASE,comparison:'custom'}),'__Current = 33 && __Target = 66 && __Reference = 16.5 && __GoalRatio = 0.5',dates([2024,1,10],[2024,1,12])),
 check('prior-period-complete',mapped({...BASE,comparison:'previous'}),'__ComparableDates && __Reference = 24',dates([2024,1,10],[2024,1,12])),
 check('prior-period-incomplete',mapped({...BASE,comparison:'previous'}),'NOT __ComparableDates && ISBLANK ( __Reference )',dates([2023,1,1],[2023,1,3])),
 check('prior-period-discontinuous',mapped({...BASE,comparison:'previous'}),'NOT __ComparableDates && ISBLANK ( __Reference )',`TREATAS ( { DATE ( 2024, 1, 10 ), DATE ( 2024, 1, 12 ) }, '__AuditCalendarA'[Date] )`),
 check('yoy-leap-day',mapped({...BASE,comparison:'yoy'}),'__ComparableDates && __Current = 57 && __Reference = 28',dates([2024,2,28],[2024,2,29])),
 ...[['good',3,'STATUS_COPY_GOOD'],['warn',4,'STATUS_COPY_WARN'],['bad',6,'STATUS_COPY_BAD'],['blank',0,'Sin datos']].map(([id,count,label])=>check('status-copy:'+id,mapped({...BASE,type:'status',comparison:'none',showTrend:false,showGoal:false,elements:{status_copy1:{measure:'__AuditStatus',direction:'down',goodThreshold:.03,warnThreshold:.05,statusGood:'STATUS_COPY_GOOD',statusWarn:'STATUS_COPY_WARN',statusBad:'STATUS_COPY_BAD'}}}),`__status_status_copy1 = "${label}"`,count?dates([2024,1,1],[2024,1,count]):dates([2030,1,1],[2030,1,1]),`CONTAINSSTRING ( [__AuditHTML], "${label}" )`))
];
const constantGoal=patch=>sanitizeConfig({...mapped({...BASE,type:'target',comparison:'none',showTrend:false}),measure:'__AuditHundred',targetMeasure:'100',elements:{value_copy1:{measure:'__AuditHundred'},progress_copy1:{colorMode:'semantic'},progressLabel_copy1:{colorMode:'linked'}},...patch});
for(const direction of ['up','down','neutral']){
 const color=direction==='neutral'?'__Cfg_ColorAccent':'__Cfg_ColorGood';
 engineQueries.push(check('goal-equality:'+direction,constantGoal({direction}),`__Current = 100 && __Target = 100 && __GoalRatio = 1 && __goalColor = ${color} && __goalColor_progress_copy1 = ${color} && __goalColor_progressLabel_copy1 = ${color}`));
 if(direction!=='neutral')for(const target of [90,110]){
  const good=direction==='down'?100<=target:100>=target;
  const expected=good?'__Cfg_ColorGood':'__Cfg_ColorWarn';
  engineQueries.push(check(`goal-boundary:${direction}:${target}`,constantGoal({direction,targetMeasure:String(target)}),`__goalColor = ${expected} && __goalColor_progress_copy1 = ${expected} && __GoalRatio = DIVIDE ( 100, ${target} )`));
 }
}
engineQueries.push(check('goal-blank',constantGoal({measure:'__AuditBlank',elements:{progress_copy1:{measure:'__AuditBlank'}}}),'ISBLANK ( __GoalRatio ) && ISBLANK ( __GoalRatio_progress_copy1 ) && __goalColor = __Cfg_ColorMuted && __goalColor_progress_copy1 = __Cfg_ColorMuted'));
engineQueries.push(check('goal-zero-target',constantGoal({targetMeasure:'0'}),'ISBLANK ( __GoalRatio ) && ISBLANK ( __GoalRatio_progress_copy1 ) && __goalColor = __Cfg_ColorMuted && __goalColor_progress_copy1 = __Cfg_ColorMuted'));
engineQueries.push(check('linked-copy-label-color',constantGoal({direction:'up',targetMeasure:'90',elements:{progress:{colorMode:'semantic'},progress_copy1:{measure:'__AuditHundred',colorMode:'semantic',direction:'down'},progressLabel_copy1:{measure:'__AuditHundred',colorMode:'linked',direction:'up'}}}),'__goalColor = __Cfg_ColorGood && __goalColor_progress_copy1 = __Cfg_ColorWarn && __goalColor_progressLabel_copy1 = __Cfg_ColorGood','',`CONTAINSSTRING ( [__AuditHTML], "font-size:11px;color:${BASE.warning}" )`));
for(const showMax of [false,true]){
 const config=sanitizeConfig({...mapped({...BASE,showMin:true,showMax,elements:{trend_copy1:{measure:'__AuditHundred',showMin:true,showMax}}}),measure:'__AuditHundred'});
 engineQueries.push(check('flat-series-min:'+showMax,config,`${showMax?'NOT ':''}CONTAINSSTRING ( __chartAnnotations, "Mín." ) && ${showMax?'NOT ':''}CONTAINSSTRING ( __chartAnnotations_trend_copy1, "Mín." ) && __Range = 0 && __Range_trend_copy1 = 0`));
}
engineQueries.push(check('measure-name-equals-calendar-column',{...mapped(BASE),measureName:'Date'},'__Current = 33 && __HasDates',dates([2024,1,10],[2024,1,12])));
engineQueries.push(check('inactive-points-do-not-block',mapped({...BASE,type:'basic',comparison:'none',showComparison:false,showTrend:false,showGoal:false,deltaMode:'pp',format:'currency'}),'__Current = [__AuditValue] && ISBLANK ( __Reference ) && ISBLANK ( __Target )','',`NOT CONTAINSSTRING ( [__AuditHTML], " pp" )`));
// Deliberately bypass sanitization: runtime exports must also ignore old decorative bindings.
engineQueries.push(check('decorative-copy-has-no-measure-dependency',{...mapped(BASE),elements:{title_copy1:{text:'DECORATIVE_TITLE',measure:'__MissingDecorativeMetric',format:'number'}}},'__Current > 0','',`CONTAINSSTRING ( [__AuditHTML], "DECORATIVE_TITLE" )`));

const linkedFamily=mapped({...BASE,format:'number',decimals:1,unit:'none',elements:{value_copy1:{measure:'__AuditHundred'},trend_copy1:{measure:'__MustNotBeUsed'},goalLabel_copy1:{targetMeasure:'200'},progress_copy1:{},progressLabel_copy1:{},delta_copy1:{comparison:'target',deltaMode:'absolute'}}});
engineQueries.push(check('linked-family-independent-objective',linkedFamily,'__Current = 33 && __Cur_progress_copy1 = 100 && __Objective_goalLabel_copy1 = 200 && __GoalRatio_progress_copy1 = 0.5 && __Diff_delta_copy1 = -100 && __Start_trend_copy1 = __Start && __End_trend_copy1 = __End && MINX ( __Series_trend_copy1, [__YValue] ) = 100',dates([2024,1,10],[2024,1,12])));
engineQueries.push(check('linked-family-visible-versus-svg-locale',linkedFamily,'__val_value_copy1 = "100,0" && __progressWidth_progress_copy1 = "50.0" && __Svg_Locale = "en-US"',dates([2024,1,10],[2024,1,12])));

const independentCopies=mapped({...BASE,format:'number',unit:'none',elements:{trend_copy1:{measure:'__AuditHundred'},delta_copy1:{measure:'__AuditReference',comparison:'custom',compareMeasure:'__AuditValue',deltaMode:'absolute'},progress_copy1:{measure:'__AuditHundred',targetMeasure:'200'},progressLabel_copy1:{measure:'__AuditHundred'}}});
engineQueries.push(check('standalone-copy-explicit-measures',independentCopies,'__Current = 33 && MINX ( __Series_trend_copy1, [__YValue] ) = 100 && __Cur_delta_copy1 = 16.5 && __Diff_delta_copy1 = -16.5 && __Cur_progress_copy1 = 100 && __GoalRatio_progress_copy1 = 0.5',dates([2024,1,10],[2024,1,12])));
