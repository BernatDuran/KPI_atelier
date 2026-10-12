import test from 'node:test';
import assert from 'node:assert/strict';
import { BASE } from '../dist/model.mjs';
import {
  validateCardConfig,
  validateImportedJSON,
  validateElementCustomization,
  isCardConfig,
  isValidHexColor,
  validateModelCatalog, sanitizeModelCatalog,
  CONFIG_SCHEMA
} from '../dist/schema.mjs';

test('CONFIG_SCHEMA defines essential properties with rules', () => {
  assert.ok(CONFIG_SCHEMA.type);
  assert.ok(CONFIG_SCHEMA.width);
  assert.ok(CONFIG_SCHEMA.accent);
  assert.equal(CONFIG_SCHEMA.type.type, 'enum');
  assert.equal(CONFIG_SCHEMA.accent.type, 'color');
  assert.equal(CONFIG_SCHEMA.width.type, 'number');
});

test('isValidHexColor correctly identifies 6-character hex colors', () => {
  assert.equal(isValidHexColor('#ffffff'), true);
  assert.equal(isValidHexColor('#123456'), true);
  assert.equal(isValidHexColor('#ABCDEF'), true);
  assert.equal(isValidHexColor('#fff'), false);
  assert.equal(isValidHexColor('rgb(0,0,0)'), false);
  assert.equal(isValidHexColor(''), false);
  assert.equal(isValidHexColor(null), false);
});

test('validateCardConfig accepts standard BASE configuration', () => {
  const result = validateCardConfig(BASE);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
  assert.ok(result.data);
});

test('validateCardConfig catches out-of-bounds numbers and invalid enums', () => {
  const bad = {
    ...BASE,
    width: 9999, // limit is 800
    layout: 'invalid-layout',
    accent: 'not-a-color'
  };
  const result = validateCardConfig(bad);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('width')));
  assert.ok(result.errors.some(e => e.includes('layout')));
  assert.ok(result.errors.some(e => e.includes('accent')));
});

test('validateCardConfig detects legacy geometryVersion 1 with warning', () => {
  const legacy = { ...BASE, geometryVersion: 1 };
  const result = validateCardConfig(legacy);
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some(w => w.includes('versión 1')&&w.includes('geometría actual')));
});

test('validateCardConfig warns on unknown properties in strict mode', () => {
  const custom = { ...BASE, unexpectedProperty: 'hacked' };
  const resRelaxed = validateCardConfig(custom, { strictUnknown: false });
  assert.equal(resRelaxed.warnings.some(w => w.includes('unexpectedProperty')), false);

  const resStrict = validateCardConfig(custom, { strictUnknown: true });
  assert.ok(resStrict.warnings.some(w => w.includes('unexpectedProperty')));
});

test('validateElementCustomization rejects coordinates beyond limits', () => {
  const bad = { x: 5000, y: -2000, width: 900, color: '#xyz123' };
  const res = validateElementCustomization('title', bad);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some(e => e.includes('x')));
  assert.ok(res.errors.some(e => e.includes('y')));
  assert.ok(res.errors.some(e => e.includes('width')));
  assert.ok(res.errors.some(e => e.includes('color')));
});

test('validateImportedJSON validates envelope and raw JSON strings', () => {
  const validEnvelope = JSON.stringify({
    app: 'kpi-atelier',
    version: 1,
    config: BASE
  });
  const res1 = validateImportedJSON(validEnvelope);
  assert.equal(res1.valid, true);
  assert.equal(res1.metadata.app, 'kpi-atelier');

  const invalidJson = '{ bad json syntax :';
  const res2 = validateImportedJSON(invalidJson);
  assert.equal(res2.valid, false);
  assert.ok(res2.errors[0].includes('Invalid JSON payload'));
});

test('isCardConfig type guard identifies valid objects and rejects non-configs', () => {
  assert.equal(isCardConfig(BASE), true);
  assert.equal(isCardConfig({}), false);
  assert.equal(isCardConfig(null), false);
  assert.equal(isCardConfig('string'), false);
});


test('Schema shares editor size limits and validates integer fields without rejecting fractional styles',()=>{
 assert.equal(validateCardConfig({...BASE,valueSize:100,titleSize:70,trendHeight:200,lineWidth:2.4,radius:22.5}).valid,true);
 for(const key of ['width','height','maxPoints','decimals','geometryVersion'])assert.equal(validateCardConfig({...BASE,[key]:BASE[key]+.5}).valid,false,key);
 assert.equal(validateCardConfig({...BASE,width:'440'}).valid,false);
 assert.equal(validateCardConfig({...BASE,showTrend:'true'}).valid,false);
});

test('Element frame validation uses actual renderer coordinates and rejects invalid frame shapes',()=>{
 assert.equal(validateElementCustomization('value',{frame:{left:1.25,top:0,width:100,height:20}}).valid,true);
 for(const frame of [{x:1,y:2,w:100,h:20},{left:Infinity,top:0,width:20,height:10},{left:0,top:0,width:-1,height:10},[],{left:'1',top:0,width:20,height:10}])assert.equal(validateElementCustomization('value',{frame}).valid,false);
});

test('Malformed model caches fail closed while normalized metadata and references survive',()=>{
 const raw={modelName:'Ventas',server:'localhost:12345',database:'db',isLiveConnection:true,tables:['Medidas','Calendario'],measures:[{name:'Ventas',table:'Medidas',expression:'SUM ( Ventas[Importe] )'}],dateTables:[{name:'Calendario',dateColumns:['Fecha'],primaryDateColumn:'Fecha'}]};
 assert.equal(validateModelCatalog(raw).valid,true);
 const copy=sanitizeModelCatalog(raw);
 assert.equal(copy.server,raw.server);assert.equal(copy.measures[0].expression,raw.measures[0].expression);
 copy.dateTables[0].dateColumns.push('Otra');assert.equal(raw.dateTables[0].dateColumns.length,1);
 for(const bad of [null,[],{}, {...raw,measures:[{name:'Ventas'}]},{...raw,dateTables:[{name:'Calendar',dateColumns:'Fecha'}]}])assert.equal(sanitizeModelCatalog(bad),null);
});


test('Invalid wrappers and unrelated JSON cannot reset the editor as an empty configuration',()=>{
 for(const bad of ['null','[]','{}','{"config":null}','{"config":"broken"}','{"unrelated":42}'])assert.equal(validateImportedJSON(bad).valid,false,bad);
});
