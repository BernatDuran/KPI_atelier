import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scanFileList, scanDirectoryHandle, PBIP_LIMITS,
  parseTmdl,
  parseBim,
  buildModelCatalog,
  isLikelyCalendarTable,
  sortDateTables
} from '../dist/pbip.mjs';

test('isLikelyCalendarTable recognizes standard date dimensions and ignores transaction tables', () => {
  assert.equal(isLikelyCalendarTable('Calendario'), true);
  assert.equal(isLikelyCalendarTable('calendario'), true);
  assert.equal(isLikelyCalendarTable('DimDate'), true);
  assert.equal(isLikelyCalendarTable('dim_date'), true);
  assert.equal(isLikelyCalendarTable('Calendar'), true);
  assert.equal(isLikelyCalendarTable('Fechas'), true);
  assert.equal(isLikelyCalendarTable('Fecha'), true);
  assert.equal(isLikelyCalendarTable('DimTiempo'), true);

  assert.equal(isLikelyCalendarTable('Ventas'), false);
  assert.equal(isLikelyCalendarTable('FactOrders'), false);
  assert.equal(isLikelyCalendarTable('Clientes'), false);
  assert.equal(isLikelyCalendarTable(''), false);
  assert.equal(isLikelyCalendarTable(null), false);
});

test('sortDateTables prioritizes marked date tables, then calendar tables, then transaction tables', () => {
  const tables = [
    { name: 'FactVentas', dateColumns: ['FechaPedido'] },
    { name: 'DimDate', dateColumns: ['DateKey', 'FullDate'] },
    { name: 'Envios', dateColumns: ['FechaEnvio'] },
    { name: 'CustomCalendar', dateColumns: ['FechaKey', 'Fecha'], isMarkedDateTable: true, primaryDateColumn: 'Fecha' },
    { name: 'Calendario', dateColumns: ['Fecha'] }
  ];
  const sorted = sortDateTables(tables);
  // Level 1: Marked date table first (even if custom name)
  assert.equal(sorted[0].name, 'CustomCalendar');
  assert.equal(sorted[0].isMarkedDateTable, true);

  // Level 2: Likely calendar tables next (alphabetical)
  assert.equal(sorted[1].name, 'Calendario');
  assert.equal(sorted[2].name, 'DimDate');

  // Level 3: Transaction tables
  assert.equal(sorted[3].name, 'Envios');
  assert.equal(sorted[4].name, 'FactVentas');
});

test('parseTmdl extracts quoted/unquoted table, multiline measures and dateTime columns', () => {
  const sampleTmdl = `table 'Ventas Online'
	lineageTag: e422fcb8-f2f5-46aa-bf73-9a73e44ce10e

	measure 'Total Ventas' = 
			SUM('Ventas Online'[Importe])
		formatString: #,##0.00 €
		lineageTag: c370a256-4cfd-4a11-b0db-6a2c2068aa87

	measure 'Margen %' = 
			DIVIDE([Total Margen], [Total Ventas])
		formatString: 0.0 %

	measure SimpleTarget = 100000

	column 'Fecha Pedido'
		dataType: dateTime
		formatString: Short Date
		lineageTag: a09d431c-3b99-4c12-8924-f365d9565e3d
		summarizeBy: none
		sourceColumn: FechaPedido

	column 'Fecha Entrega'
		dataType: date
		summarizeBy: none

	column Cantidad
		dataType: int64
		summarizeBy: sum
		sourceColumn: Cantidad

	column 'Canal Venta'
		dataType: string
		summarizeBy: none
`;

  const result = parseTmdl(sampleTmdl);

  assert.equal(result.table, 'Ventas Online');
  assert.equal(result.isMarkedDateTable, false);
  assert.equal(result.primaryDateColumn, null);
  assert.equal(result.measures.length, 3);
  assert.deepEqual(result.measures.map(m => m.name), ['Total Ventas', 'Margen %', 'SimpleTarget']);
  assert.equal(result.measures[0].table, 'Ventas Online');
  assert.equal(result.measures[1].table, 'Ventas Online');
  assert.equal(result.measures[2].table, 'Ventas Online');

  assert.equal(result.columns.length, 4);
  assert.deepEqual(result.dateColumns, ['Fecha Pedido', 'Fecha Entrega']);
});

test('parseTmdl recognizes dataCategory: Time and isKey column as official date table', () => {
  const sampleTmdl = `table Calendario
	lineageTag: 76f921ab-271c-4b68-b7ae-1234567890ab
	dataCategory: Time

	column Fecha
		dataType: dateTime
		isKey
		formatString: Short Date
		lineageTag: 89012345-6789-abcd-ef01-234567890abc
		summarizeBy: none
		sourceColumn: Fecha

	column Año
		dataType: int64
		summarizeBy: none

	column Mes
		dataType: string
		summarizeBy: none

	column 'Fecha Inicio Mes'
		dataType: dateTime
		summarizeBy: none
`;

  const result = parseTmdl(sampleTmdl);

  assert.equal(result.table, 'Calendario');
  assert.equal(result.isMarkedDateTable, true);
  assert.equal(result.primaryDateColumn, 'Fecha');
  assert.equal(result.dateColumns[0], 'Fecha', 'Primary key date column should be placed first');
  assert.equal(result.dateColumns[1], 'Fecha Inicio Mes');
});

test('parseTmdl handles escaped quotes and fallback table name', () => {
  const sampleTmdl = `
	measure 'Ventas ''Special''' = 42

	column 'Date ''Col'''
		dataType: dateTime
`;

  const result = parseTmdl(sampleTmdl, 'FallbackTable');

  assert.equal(result.table, 'FallbackTable');
  assert.equal(result.measures.length, 1);
  assert.equal(result.measures[0].name, "Ventas 'Special'");
  assert.equal(result.measures[0].table, 'FallbackTable');
  assert.deepEqual(result.dateColumns, ["Date 'Col'"]);
});

test('parseBim parses Tabular TMSL JSON format correctly including dataCategory and isKey', () => {
  const sampleBim = {
    name: 'VentasModel',
    compatibilityLevel: 1600,
    model: {
      tables: [
        {
          name: 'Ventas',
          columns: [
            { name: 'FechaKey', dataType: 'int64' },
            { name: 'FechaVenta', dataType: 'dateTime' },
            { name: 'Importe', dataType: 'double' }
          ],
          measures: [
            { name: 'Total Ventas', expression: "SUM(Ventas[Importe])" },
            { name: 'Margen', expression: "[Total Ventas] * 0.2" }
          ]
        },
        {
          name: 'Calendario',
          dataCategory: 'Time',
          columns: [
            { name: 'Fecha', dataType: 'dateTime', isKey: true },
            { name: 'Año', dataType: 'int64' },
            { name: 'Mes', dataType: 'string' }
          ],
          measures: []
        },
        {
          name: 'Clientes',
          columns: [
            { name: 'ClienteID', dataType: 'int64' },
            { name: 'Nombre', dataType: 'string' }
          ]
        }
      ]
    }
  };

  const catalog = parseBim(JSON.stringify(sampleBim));

  assert.equal(catalog.modelName, 'VentasModel');
  assert.deepEqual(catalog.tables, ['Calendario', 'Clientes', 'Ventas']);
  assert.equal(catalog.measures.length, 2);
  assert.deepEqual(catalog.measures.map(m => m.name), ['Margen', 'Total Ventas']);

  // Date tables check
  assert.equal(catalog.dateTables.length, 2);
  assert.equal(catalog.dateTables[0].name, 'Calendario');
  assert.equal(catalog.dateTables[0].isMarkedDateTable, true);
  assert.equal(catalog.dateTables[0].primaryDateColumn, 'Fecha');
  assert.equal(catalog.dateTables[0].isLikelyCalendar, true);
  assert.deepEqual(catalog.dateTables[0].dateColumns, ['Fecha']);

  assert.equal(catalog.dateTables[1].name, 'Ventas');
  assert.equal(catalog.dateTables[1].isMarkedDateTable, false);
  assert.equal(catalog.dateTables[1].isLikelyCalendar, false);
  assert.deepEqual(catalog.dateTables[1].dateColumns, ['FechaVenta']);
});

test('buildModelCatalog aggregates multiple TMDL parsed tables into sorted catalog with hierarchy', () => {
  const table1 = {
    table: 'FactVentas',
    measures: [{ name: 'Ventas Netas', table: 'FactVentas' }],
    dateColumns: ['Fecha']
  };
  const table2 = {
    table: 'DimDate',
    isMarkedDateTable: true,
    primaryDateColumn: 'CalendarDate',
    measures: [{ name: 'Dias Habiles', table: 'DimDate' }],
    dateColumns: ['DateKey', 'CalendarDate']
  };

  const catalog = buildModelCatalog({
    modelName: 'Retail.SemanticModel',
    parsedTables: [table1, table2]
  });

  assert.equal(catalog.modelName, 'Retail.SemanticModel');
  assert.deepEqual(catalog.tables, ['DimDate', 'FactVentas']);
  assert.equal(catalog.measures.length, 2);
  assert.deepEqual(catalog.measures.map(m => m.name), ['Dias Habiles', 'Ventas Netas']);

  // DimDate is marked as official date table
  assert.equal(catalog.dateTables[0].name, 'DimDate');
  assert.equal(catalog.dateTables[0].isMarkedDateTable, true);
  assert.equal(catalog.dateTables[0].primaryDateColumn, 'CalendarDate');
  assert.equal(catalog.dateTables[0].dateColumns[0], 'CalendarDate', 'Primary date column is first');

  assert.equal(catalog.dateTables[1].name, 'FactVentas');
  assert.equal(catalog.dateTables[1].isMarkedDateTable, false);
});


const modelFile = (path, content, size=content.length) => ({name:path.split('/').pop(),webkitRelativePath:path,size,text:async()=>content});
test('Folder parser isolates one model and ignores non-table TMDL metadata',async()=>{
 const files=[modelFile('Project/Ventas.SemanticModel/definition/tables/Medidas.tmdl','table Medidas\n\tmeasure Ingresos = 1'),modelFile('Project/Ventas.SemanticModel/definition/database.tmdl','database Model'),modelFile('Project/Ventas.SemanticModel/definition/model.tmdl','model Model')];
 const catalog=await scanFileList(files);
 assert.equal(catalog.modelName,'Ventas');assert.deepEqual(catalog.tables,['Medidas']);assert.equal(catalog.measures[0].name,'Ingresos');
 await assert.rejects(scanFileList([...files,modelFile('Project/Otro.SemanticModel/definition/tables/Medidas.tmdl','table Otra')]),/varios modelos/);
});

test('PBIP scans enforce file budgets and respect cancellation before reading',async()=>{
 let reads=0;
 const oversized={...modelFile('Ventas.SemanticModel/model.bim','{}',PBIP_LIMITS.maxFileBytes+1),text:async()=>{reads++;return '{}';}};
 await assert.rejects(scanFileList([oversized]),/10 MB/);assert.equal(reads,0);
 const controller=new AbortController();controller.abort();
 await assert.rejects(scanFileList([oversized],{signal:controller.signal}),{name:'AbortError'});
 await assert.rejects(scanFileList(Array(PBIP_LIMITS.maxEntries+1).fill(oversized)),/demasiados/);
});

test('Directory picker shares the same isolated catalog parsing as file-list fallback',async()=>{
 const table=modelFile('Medidas.tmdl','table Medidas\n\tmeasure Ventas = 42');
 const directory={name:'Ventas.SemanticModel',async *values(){yield {kind:'file',name:table.name,getFile:async()=>table};}};
 assert.deepEqual((await scanDirectoryHandle(directory)).measures,[{name:'Ventas',table:'Medidas'}]);
 await assert.rejects(scanFileList([modelFile('model.bim','null')]),/BIM/);
});
