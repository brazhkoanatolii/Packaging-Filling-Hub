import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { MaintenanceService, maintenanceStatistics } from "../src/services/maintenance-service.js";
import { MaintenanceGatewayProvider } from "../src/providers/maintenance-gateway-provider.js";

test("ТО: статистика включает все годы и сотрудников, исключает очередь", () => {
  const records = [{machine:"01",date:"2024-01-10",performer:"A",syncState:"synced"},
    {machine:"02",date:"2026-02-10",performer:"B",syncState:"synced"},
    {machine:"02",date:"2026-02-11",performer:"B",syncState:"pending"}];
  const stats = maintenanceStatistics(records,2026,[{id:"01"},{id:"02"},{id:"03"}]);
  assert.equal(stats.all,2); assert.equal(stats.total,1);
  assert.deepEqual(stats.years,[[2024,1],[2026,1]]);
  assert.equal(stats.machines[0].year,0); assert.equal(stats.machines[2].total,0);
  assert.equal(stats.people.find(p=>p.name==="A").total,1);
});

test("ТО: форма проверяет станок, роль, дату и справочник исполнителей", async () => {
  let saved;
  const service = new MaintenanceService({machines:async()=>[{id:"01"}],performers:async()=>["A"],create:async r=>(saved=r)});
  const input={machine:"01",date:"2026-01-15",performer:"A",note:"Работы выполнены"};
  await assert.rejects(service.create({...input,machine:"17"},{role:"manager"},["A"]));
  await assert.rejects(service.create({...input,date:"2026-02-30"},{role:"manager"},["A"]));
  await assert.rejects(service.create({...input,performer:"B"},{role:"manager"},["A","B"]));
  await assert.rejects(service.create(input,{role:"guest"},["A"]));
  await service.create(input,{role:"senior"},["A"]);
  assert.equal(saved.note,input.note); assert.equal(saved.machine,"01"); assert.equal(saved.date,input.date);
});

test("ТО: запрос сохраняет станок и примечание, отказ не считается сохранением", async () => {
  const record={id:"maintenance-test",machine:"02",date:"2026-01-15",performer:"A",note:"=literal"};
  const provider=new MaintenanceGatewayProvider({fetchImpl:async function(url,options){
    assert.equal(this,globalThis); assert.equal(url,"/api/maintenance-records");
    const body=JSON.parse(options.body); assert.equal(body.machine,"02");assert.equal(body.note,"=literal");
    return {ok:true,json:async()=>({ok:true,record})};
  }});
  assert.equal((await provider.write({record,requestId:"request-test"})).syncState,"synced");
  const rejected=new MaintenanceGatewayProvider({fetchImpl:async()=>({ok:false,json:async()=>({message:"Disabled"})})});
  await assert.rejects(rejected.write({record}),/Disabled/);
});

test("Apps Script ТО: чтение всех существующих листов не меняет строки; запись выключена", () => {
  let writes=0;
  const sheet=(name,id)=>({getName:()=>name,getSheetId:()=>id,getLastRow:()=>5,
    getRange:(row,col)=>({getDisplayValues:()=>[["Дата","Имя, Фамилия","Примечания"]],
      getValues:()=>[[new Date("2026-01-15T12:00:00Z"),"A","note"]],getNotes:()=>[[""]]})});
  const sheets=[sheet("ТО 01",1),sheet("ТО 16",16),sheet("Статистика",99)];
  const context=vm.createContext({Date,SpreadsheetApp:{openById:()=>({getSheets:()=>sheets,getSheetByName:()=>({getMaxRows:()=>1000,getRange:()=>({getDisplayValues:()=>[["A"]]})})})},
    PropertiesService:{getScriptProperties:()=>({getProperty:()=>"false"})},Sheets:{Spreadsheets:{batchUpdate:()=>writes++}},
    Utilities:{formatDate:d=>d.toISOString().slice(0,10)}});
  vm.runInContext(readFileSync(new URL("../apps-script/maintenance-journal-api.gs",import.meta.url),"utf8"),context);
  const result=context.listMaintenanceRecords();
  assert.equal(result.records.length,2);assert.equal(result.records[1].machine,"16");
  assert.throws(()=>context.createMaintenanceRecord({}),/выключена/);assert.equal(writes,0);
});

test("Apps Script ТО: повтор не дублирует строку, сохраняет дату и буквальный текст", () => {
  const rows=[[new Date("2024-01-01T12:00:00Z"),"A","old"]],notes=[""];
  let writes=0;
  const sheet={getName:()=>"ТО 01",getSheetId:()=>17,getLastRow:()=>rows.length+4,getMaxRows:()=>1000,
    getRange:()=>({getDisplayValues:()=>[["Дата","Имя, Фамилия","Примечания"]],getValues:()=>rows,getNotes:()=>notes.map(n=>[n])})};
  const book={getSheets:()=>[sheet],getSheetByName:()=>({getMaxRows:()=>1000,getRange:()=>({getDisplayValues:()=>[["A"]]})})};
  const context=vm.createContext({Date,SpreadsheetApp:{openById:()=>book},PropertiesService:{getScriptProperties:()=>({getProperty:()=>"true"})},
    LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},listPersonnel:()=>({personnel:[{fullName:"A",active:true}]}),
    Utilities:{formatDate:d=>d.toISOString().slice(0,10)},Sheets:{Spreadsheets:{batchUpdate:({requests})=>{
      writes++; const cells=requests.find(r=>r.updateCells).updateCells;
      assert.equal(cells.start.rowIndex,5);
      const v=cells.rows[0].values;
      rows.push([new Date(Date.UTC(1899,11,30)+v[0].userEnteredValue.numberValue*86400000),v[1].userEnteredValue.stringValue,v[2].userEnteredValue.stringValue]);
      notes.push(v[0].note);
    }}}});
  vm.runInContext(readFileSync(new URL("../apps-script/maintenance-journal-api.gs",import.meta.url),"utf8"),context);
  const payload={role:"manager",machine:"01",recordId:"maintenance-test",requestId:"request-test",date:"2026-02-10",performer:"A",note:"=literal"};
  const first=context.createMaintenanceRecord(payload),replayed=context.createMaintenanceRecord(payload);
  assert.equal(writes,1);assert.equal(rows.length,2);assert.equal(rows[0][2],"old");
  assert.equal(replayed.record.id,first.record.id);assert.equal(replayed.record.date,payload.date);assert.equal(replayed.record.note,"=literal");
  assert.throws(()=>context.createMaintenanceRecord({...payload,note:"different"}),/другой записи/);
});
