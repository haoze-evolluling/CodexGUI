const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process'); const path=require('path'); const fs=require('fs');
const { buildCodexArgs, buildSpawnOptions, createDiagnostics, createEventParser, eventToMessage } = require('./codex-runner.cjs');
const { RequestManager } = require('./request-manager.cjs');
const { loadCodexHistory, mergeSessions } = require('./codex-history.cjs');
const { buildArchiveArgs, removeArchivedSessions } = require('./codex-archive.cjs');
let win; const requests = new RequestManager(); const dataFile=()=>path.join(app.getPath('userData'),'sessions.json');
function load(){try{return JSON.parse(fs.readFileSync(dataFile(),'utf8'))}catch{return []}}
function save(v){fs.mkdirSync(path.dirname(dataFile()),{recursive:true});fs.writeFileSync(dataFile(),JSON.stringify(v,null,2))}
function create(){win=new BrowserWindow({width:1280,height:800,minWidth:900,minHeight:600,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false}}); if(!app.isPackaged)win.loadURL('http://127.0.0.1:5173');else win.loadFile(path.join(__dirname,'../dist/index.html'))}
app.whenReady().then(()=>{create(); ipcMain.handle('sessions:list',()=>mergeSessions(load(),loadCodexHistory(path.join(app.getPath('home'),'.codex')))); ipcMain.handle('sessions:history',()=>mergeSessions(load(),loadCodexHistory(path.join(app.getPath('home'),'.codex')))); ipcMain.handle('sessions:save',(_,s)=>{const all=load().filter(x=>x.id!==s.id);all.unshift(s);save(all);return all}); ipcMain.handle('sessions:archive',(_,session)=>{
  if (!session?.id) return { ok: false, error: '无效的会话。' };
  const removeLocalCopy = () => { const remaining = removeArchivedSessions(load(), session); save(remaining); return remaining; };
  if (!session.threadId) { removeLocalCopy(); return { ok: true }; }
  return new Promise(resolve => {
    const diagnostics = createDiagnostics();
    let settled = false;
    const finish = result => { if (!settled) { settled = true; resolve(result); } };
    let child;
    try { child = spawn('codex', buildArchiveArgs(session.threadId), buildSpawnOptions(session.cwd || process.cwd())); }
    catch (error) { finish({ ok: false, error: error.message }); return; }
    child.stderr.on('data', data => diagnostics.add(data.toString()));
    child.on('error', error => finish({ ok: false, error: error.message }));
    child.on('close', code => {
      const error = diagnostics.errorForExit(code);
      if (error) finish({ ok: false, error });
      else { removeLocalCopy(); finish({ ok: true }); }
    });
  });
}); ipcMain.handle('dialog:folder',async()=>{const r=await dialog.showOpenDialog(win,{properties:['openDirectory']});return r.canceled?null:r.filePaths[0]}); ipcMain.handle('cli:start',(_,o)=>{if(!o.sessionId || requests.isRunning(o.sessionId))return false; const cmd=o.command||'codex'; const diagnostics=createDiagnostics(); const parser=createEventParser(event=>{const parsed=eventToMessage(event);if(parsed.threadId)win.webContents.send('cli:thread',{sessionId:o.sessionId,threadId:parsed.threadId});if(parsed.text)win.webContents.send('cli:data',{sessionId:o.sessionId,stream:'stdout',text:parsed.text})},line=>diagnostics.add(line)); const child=spawn(cmd,buildCodexArgs(o.prompt,o.threadId),buildSpawnOptions(o.cwd||process.cwd())); requests.start(o.sessionId,child); child.stdout.on('data',d=>parser.push(d.toString()));child.stderr.on('data',d=>diagnostics.add(d.toString()));child.on('close',code=>{parser.end();const error=diagnostics.errorForExit(code);if(error)win.webContents.send('cli:error',{sessionId:o.sessionId,error});win.webContents.send('cli:exit',{sessionId:o.sessionId,code});requests.finish(o.sessionId,child)});child.on('error',e=>{win.webContents.send('cli:error',{sessionId:o.sessionId,error:e.message});requests.finish(o.sessionId,child)});return true}); ipcMain.handle('cli:stop',(_,sessionId)=>requests.stop(sessionId));}); app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});
