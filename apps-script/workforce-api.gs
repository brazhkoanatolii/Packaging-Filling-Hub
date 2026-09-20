/** Add this file to the SAME Apps Script project as scale-journal-api-v2.gs.
 * Requires https://www.googleapis.com/auth/spreadsheets (not currentonly).
 * Google Sheets owns the data. This API serializes program writers with one script lock.
 */
const WF_BOOKS = Object.freeze({
  personnel: '1r1opRywv4upVl4oMrUlOqmRsjAuETUu3-JFMUqjRu04',
  attendance: '1eJphWAgaxNb5N--tDrwv4uTzmiAs19NOLSAQlSn3dk0',
  vacations: '1zenc0sBGtD8KHQdrBxULsoA9jSaUcZeW83XIiz5YxSo'
});
const WF_YEARS = [2025, 2026, 2027, 2028, 2029];
const WF_ROLES = { 'head-of-area':'Начальник участка', 'production-manager':'Начальник производства', administrator:'Администратор', 'warehouse-manager':'Начальник склада', 'senior-mechanic':'Старший механик', 'mechanic-operator':'Механик-оператор', packer:'Упаковщик' };
const WF_STATUSES = ['Не запланирован','Запланирован','Согласован','Использован','Аннулирован'];

function getWorkforceSnapshot(options) {
  const master = SpreadsheetApp.openById(WF_BOOKS.personnel);
  const teams = wfRows_(master.getSheetByName('Смены'), 8).filter(r=>r.values[6]).map(r=>wfTeam_(r.values));
  const personnel = wfRows_(master.getSheetByName('Персонал'), 10).filter(r=>r.values[5]).map(r=>wfPerson_(r.values, teams));
  const attendance = [], vacations = [];
  const timeBook = SpreadsheetApp.openById(WF_BOOKS.attendance);
  WF_YEARS.forEach(year => wfRows_(timeBook.getSheetByName(String(year)),44).forEach(row => {
    const v=row.values, employee=personnel.find(p=>p.id===String(v[38]));
    if (!employee || !Number(v[0])) return;
    const team=teams.find(t=>t.name===String(v[2])), shiftTeamId=team?team.id:(String(v[43]||'')||employee.shiftTeamId);
    for(let day=1;day<=new Date(year,Number(v[0]),0).getDate();day++) {
      const value=String(v[day+2]===null?'':v[day+2]);
      if(!value || value==='—') continue;
      const date=year+'-'+('0'+v[0]).slice(-2)+'-'+('0'+day).slice(-2);
      const overtime=String(v[42]).split(',').includes(String(day));
      attendance.push({id:date+':'+shiftTeamId+':'+employee.id,date,employeeId:employee.id,shiftTeamId,value,overtime,revision:wfToken_([value,overtime]),updatedAt:wfIso_(v[40]),updatedBy:String(v[41]||'')});
    }
  }));
  if(options && options.role==='manager') {
    const book=SpreadsheetApp.openById(WF_BOOKS.vacations);
    WF_YEARS.forEach(year=>wfRows_(book.getSheetByName(String(year)),12).filter(r=>r.values[7]).forEach(r=>vacations.push(wfVacation_(r.values,year))));
  }
  return {ok:true,ready:true,personnel,shiftTeams:teams.filter(t=>t.id!=='office'),officeSchedule:teams.find(t=>t.id==='office'),attendance,vacations,years:WF_YEARS,timeZone:'Europe/Vilnius'};
}

function writeWorkforceOperation(operation) {
  const op=operation||{}, kind=op.kind, record=op.record||{}, actor=op.actor||{};
  if(!['personnel','shiftTeams','attendance','vacations'].includes(kind)) return {ok:false,status:400,message:'Неизвестный журнал'};
  if(!/^[a-zA-Z0-9-]{16,80}$/.test(String(op.requestId||''))) return {ok:false,status:400,message:'Некорректный номер операции'};
  if(op.role!=='manager' && !(op.role==='senior'&&kind==='attendance')) return {ok:false,status:403,message:'Недостаточно прав для этого журнала'};
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(30000)) return {ok:false,status:409,conflict:true,message:'Другой сотрудник сохраняет запись. Обновите журнал и повторите.'};
  try {
    const master=SpreadsheetApp.openById(WF_BOOKS.personnel);
    const log=wfLog_(master), prior=log.getRange(1,1,Math.max(1,log.getLastRow()),1).createTextFinder(op.requestId).matchEntireCell(true).findNext();
    const fingerprint=wfToken_([kind,record,actor,op.expectedRevision]);
    if(prior) {
      const saved=log.getRange(prior.getRow(),1,1,4).getValues()[0];
      if(saved[1]!==fingerprint) return {ok:false,status:400,message:'Номер операции уже использован для другой записи'};
      return JSON.parse(saved[2]);
    }
    const teams=wfRows_(master.getSheetByName('Смены'),8).filter(r=>r.values[6]).map(r=>wfTeam_(r.values));
    const people=wfRows_(master.getSheetByName('Персонал'),10).filter(r=>r.values[5]).map(r=>wfPerson_(r.values,teams));
    if(!people.some(p=>p.active&&p.fullName===String(actor.performer||''))) throw new Error('Выберите исполнителя из действующего персонала');
    let result;
    if(kind==='personnel') result=wfSavePerson_(master,teams,op);
    if(kind==='shiftTeams') result=wfSaveTeam_(master,op);
    if(kind==='attendance') result=wfSaveAttendance_(people,teams,op);
    if(kind==='vacations') result=wfSaveVacation_(people,teams,op);
    if(result.conflict) return result;
    SpreadsheetApp.flush();
    log.appendRow([op.requestId,fingerprint,JSON.stringify(result),new Date()]);
    return result;
  } catch(error) {
    return {ok:false,status:400,message:String(error.message||error)};
  } finally { lock.releaseLock(); }
}

function wfSavePerson_(master,teams,op) {
 const s=master.getSheetByName('Персонал'), p=op.record;
 if(!WF_ROLES[p.role] || !teams.some(t=>t.id===p.shiftTeamId) || String(p.fullName||'').trim().length<2) throw new Error('Проверьте ФИО, должность и смену');
 const found=wfRows_(s,10).find(r=>String(r.values[5])===p.id), current=found?wfPerson_(found.values,teams):null;
 if(!wfMatches_(current,op)) return wfConflict_();
 const row=found?found.row:Math.max(6,s.getLastRow()+1), team=teams.find(t=>t.id===p.shiftTeamId);
 const vals=[wfText_(p.fullName),WF_ROLES[p.role],team.name,p.active===false?'Не работает':'Работает',wfText_(p.note||current?.note||''),String(p.id),(Number(found?.values[6])||0)+1,new Date(),op.actor.performer,p.shiftTeamId];
 s.getRange(row,1,1,10).setValues([vals]);
 return {ok:true,record:wfPerson_(vals,teams)};
}
function wfSaveTeam_(master,op) {
 const s=master.getSheetByName('Смены'), t=op.record, found=wfRows_(s,8).find(r=>String(r.values[6])===t.id);
 if(!found) throw new Error('Смена не найдена');
 const current=wfTeam_(found.values);if(!wfMatches_(current,op)) return wfConflict_();
 if(!Number.isFinite(Number(t.accountingHours))||Number(t.accountingHours)<=0||Number(t.shiftDurationHours)<Number(t.accountingHours)||Number(t.shiftDurationHours)>24)throw new Error('Проверьте часы смены');
 const values=[wfText_(t.name),wfDate_(t.anchorDate),current.cycleLengthDays,current.workDayOffsets.join(','),Number(t.shiftDurationHours),Number(t.accountingHours),current.id,(Number(found.values[7])||0)+1];
 s.getRange(found.row,1,1,8).setValues([values]);s.getRange(found.row,2).setNumberFormat('dd.MM.yyyy');
 return {ok:true,record:wfTeam_(values)};
}
function wfSaveAttendance_(people,teams,op) {
 const p=op.record, date=String(p.date||''), parsed=wfDate_(date),year=Number(date.slice(0,4)),month=Number(date.slice(5,7)),day=Number(date.slice(8,10));
 if(!WF_YEARS.includes(year)) throw new Error('Табель подготовлен на 2025–2029 годы');
 const employee=people.find(e=>e.id===p.employeeId);if(!employee)throw new Error('Сотрудник не найден');
 if(!teams.some(t=>t.id===p.shiftTeamId))throw new Error('Смена не найдена');
 if(p.id!==date+':'+p.shiftTeamId+':'+p.employeeId)throw new Error('Некорректный ID табеля');
 const value=String(p.value||'');if(!/^(?:[1-9]|1[0-9]|2[0-4]|A|L|NA|M|PB|PV)$/.test(value))throw new Error('Недопустимое значение табеля');
 const s=SpreadsheetApp.openById(WF_BOOKS.attendance).getSheetByName(String(year));
 const found=wfRows_(s,44).find(r=>String(r.values[38])===p.employeeId&&Number(r.values[0])===month);
 const currentValue=found?String(found.values[day+2]||''):'', currentOvertime=found?String(found.values[42]).split(',').includes(String(day)):false;
 const revision=currentValue&&currentValue!=='—'?wfToken_([currentValue,currentOvertime]):'empty';
 if(revision!==op.expectedRevision)return wfConflict_();
 const row=found?found.row:Math.max(6,s.getLastRow()+1);
 if(!found){
   const vals=Array(44).fill('');vals[0]=month;vals[1]=employee.fullName;vals[2]=teams.find(t=>t.id===p.shiftTeamId).name;vals[38]=employee.id;vals[43]=p.shiftTeamId;
   for(let d=new Date(year,month,0).getDate()+1;d<=31;d++)vals[d+2]='—';
   s.getRange(row,1,1,44).setValues([vals]);
   s.getRange(row,35,1,3).setFormulas([['=SUM(D'+row+':AH'+row+')','=COUNTIF(D'+row+':AH'+row+',">0")',['A','L','NA','M','PB','PV'].map(c=>'COUNTIF(D'+row+':AH'+row+',"'+c+'")').join('+').replace(/^/,'=')]]);
 }
 s.getRange(row,day+3).setValue(/^\d+$/.test(value)?Number(value):value);
 const days=new Set(String(found?.values[42]||'').split(',').filter(Boolean));if(p.overtime===true)days.add(String(day));else days.delete(String(day));
 s.getRange(row,40,1,4).setValues([[(Number(found?.values[39])||0)+1,new Date(),op.actor.performer,Array.from(days).join(',')]]);
 return {ok:true,record:{...p,value,overtime:p.overtime===true,revision:wfToken_([value,p.overtime===true]),updatedBy:op.actor.performer,updatedAt:new Date().toISOString()}};
}
function wfSaveVacation_(people,teams,op) {
 const p=op.record,year=Number(p.year),person=people.find(e=>e.id===p.employeeId);
 if(!WF_YEARS.includes(year)||!person||!WF_STATUSES.includes(p.status))throw new Error('Проверьте сотрудника, год и статус');
 const start=p.startDate?wfDate_(p.startDate):'',end=p.endDate?wfDate_(p.endDate):'';
 if((start&&!end)||(!start&&end)||start>end)throw new Error('Укажите корректное начало и окончание отпуска');
 if(start&&(String(p.startDate).slice(0,4)!==String(year)||String(p.endDate).slice(0,4)!==String(year)))throw new Error('Период должен находиться в выбранном году. Переходящий отпуск разделите на две записи.');
 if(['Запланирован','Согласован','Использован'].includes(p.status)&&!start)throw new Error('Укажите даты отпуска');
 if(p.status==='Аннулирован'&&!String(p.note||'').trim())throw new Error('Укажите причину аннулирования');
 const s=SpreadsheetApp.openById(WF_BOOKS.vacations).getSheetByName(String(year)),found=wfRows_(s,12).find(r=>String(r.values[7])===p.id);
 const current=found?wfVacation_(found.values,year):null;if(!wfMatches_(current,op))return wfConflict_();
 const row=found?found.row:Math.max(6,s.getLastRow()+1),days=start&&end?Math.round((end-start)/86400000)+1:'';
 const values=[person.fullName,teams.find(t=>t.id===person.shiftTeamId)?.name||'',start,end,days,p.status,wfText_(p.note||''),p.id,p.employeeId,(Number(found?.values[9])||0)+1,new Date(),op.actor.performer];
 s.getRange(row,1,1,12).setValues([values]);s.getRange(row,3,1,2).setNumberFormat('dd.MM.yyyy');
 s.getRange(row,5).setFormula('=IF(AND(ISNUMBER(C'+row+'),ISNUMBER(D'+row+')),IF(D'+row+'>=C'+row+',D'+row+'-C'+row+'+1,"Проверьте даты"),"")');
 return {ok:true,record:wfVacation_(values,year)};
}
function wfRows_(sheet,width){if(!sheet)throw new Error('В Google отсутствует нужная вкладка');return sheet.getLastRow()<6?[]:sheet.getRange(6,1,sheet.getLastRow()-5,width).getValues().map((values,i)=>({row:i+6,values}));}
function wfPerson_(v,teams){return {id:String(v[5]),fullName:String(v[0]),role:Object.keys(WF_ROLES).find(k=>WF_ROLES[k]===v[1])||'',shiftTeamId:teams.find(t=>t.name===v[2])?.id||String(v[9]||''),active:v[3]==='Работает',note:String(v[4]||''),revision:wfToken_(v),updatedAt:wfIso_(v[7])};}
function wfTeam_(v){return {id:String(v[6]),name:String(v[0]),code:v[6]==='shift-team-a'?'A':v[6]==='shift-team-b'?'B':'5/2',anchorDate:wfDay_(v[1]),cycleLengthDays:Number(v[2]),workDayOffsets:String(v[3]).split(',').map(Number),shiftDurationHours:Number(v[4]),accountingHours:Number(v[5]),active:true,revision:wfToken_(v)};}
function wfVacation_(v,year){return {id:String(v[7]),employeeId:String(v[8]),year,startDate:wfDay_(v[2]),endDate:wfDay_(v[3]),days:typeof v[4]==='number'?v[4]:null,status:String(v[5]),note:String(v[6]||''),revision:wfToken_([v[0],v[1],wfDay_(v[2]),wfDay_(v[3]),v[5],v[6],v[7],v[8],v[9]]),updatedAt:wfIso_(v[10]),updatedBy:String(v[11]||'')};}
function wfMatches_(current,op){return (current?current.revision:'empty')===op.expectedRevision;}
function wfConflict_(){return {ok:false,status:409,conflict:true,message:'Эту запись уже изменили. Обновите данные и выберите, какие исправления сохранить.'};}
function wfToken_(v){return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(v),Utilities.Charset.UTF_8));}
function wfDay_(v){return v instanceof Date?Utilities.formatDate(v,'Europe/Vilnius','yyyy-MM-dd'):String(v||'');}
function wfIso_(v){return v instanceof Date?v.toISOString():String(v||'');}
function wfDate_(value){const s=String(value||''),d=new Date(s+'T12:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==s)throw new Error('Некорректная дата');return d;}
function wfText_(v){const s=String(v||'').trim();if(s.length>2000||/^[=+@]/.test(s))throw new Error('Некорректный текст');return s;}
function wfLog_(book){let s=book.getSheetByName('_Синхронизация');if(!s){s=book.insertSheet('_Синхронизация');s.appendRow(['Request ID','Содержимое','Результат','Время']);s.hideSheet();}return s;}
