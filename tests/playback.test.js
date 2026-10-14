const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/../src/renderer.js', 'utf8').replace(/^import .*;\r?\n/gm, '');
function context() {
  const node = () => ({ innerHTML:'',textContent:'',classList:{add(){},remove(){},toggle(){}},setAttribute(){},addEventListener(){},querySelector(){return node();} });
  const context = vm.createContext({
    console, performance, Intl, Date, clearTimeout, setInterval(){}, setTimeout(){},
    window:{addEventListener(){}},
    VideoRTC: class { async createOffer(pc) { pc.transceivers = [{receiver:{track:{kind:'video'},jitterBufferTarget:null}},{receiver:{track:{kind:'audio'}}}]; return {type:'offer'}; } },
    customElements:{define(){}}, document:{getElementById:node,addEventListener(){},querySelectorAll(){return [];}},
    localStorage:{getItem(){return 'main';}}, fetch:()=>new Promise(()=>{}),
  });
  vm.runInContext(source,context);
  return context;
}
test('every new peer receives the buffer target on video only', async()=>{
  const ctx=context();
  await vm.runInContext(`(async()=>{ for(let i=0;i<2;i++) { const pc={getTransceivers(){return this.transceivers;}}; const offer=await new VideoStream().createOffer(pc); if(offer.type!=='offer'||pc.transceivers[0].receiver.jitterBufferTarget!==300||'jitterBufferTarget' in pc.transceivers[1].receiver) throw Error('incorrect receiver setup'); } })()`,ctx);
});
test('focus closes all grid peers, creates one peer, and restores grid on close',()=>{
  const ctx=context();
  const result=vm.runInContext(`
    var closed=0, created=0, rendered=0;
    var player=()=>({remove(){},ondisconnect(){closed++;}});
    config={qualities:{main:{label:'HD'}}};
    for(let i=0;i<4;i++) players.set(i,{el:player()});
    makePlayer=()=>{created++;return player();};
    render=()=>{rendered++;};
    openFocus({id:'front',name:'Front',ip:'local'});
    var focused={closed,created,gridPeers:players.size};
    closeFocus();
    ({focused,closed,rendered,focusCleared:focusEntry===null});
  `,ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(result)),{focused:{closed:4,created:1,gridPeers:0},closed:5,rendered:1,focusCleared:true});
});
test('playback delay comes from recent jitter-buffer samples',async()=>{
  const ctx=context();
  const result=await vm.runInContext(`(async()=>{
    const meter=newMeter();
    const stats=[{jitterBufferDelay:10,jitterBufferEmittedCount:100},{jitterBufferDelay:16,jitterBufferEmittedCount:120}];
    const el={video:{readyState:2,videoWidth:1},pc:{connectionState:'connected',getReceivers(){return [];},async getStats(){return [{type:'inbound-rtp',kind:'video',...stats.shift()}];}}};
    await sampleMeter(el,meter); const first=meter.delay;
    await sampleMeter(el,meter);
    return {first,second:meter.delay};
  })()`,ctx);
  assert.equal(result.first,null);
  assert.ok(Math.abs(result.second-0.3)<1e-9);
});
test('a camera reconnects only after its delay stays high, then waits for the cooldown',()=>{
  const ctx=context();
  const result=vm.runInContext(`
    var reconnects=[];
    reconnectCamera=id=>{reconnects.push(id);players.get(id).meter=newMeter();};
    var entry={camera:{id:'front',name:'Front'},meter:newMeter()};
    players.set('front',entry);
    var slow=()=>{entry=players.get('front');entry.meter.ready=true;entry.meter.fps=20;entry.meter.delay=5;checkPlaybackDelay(entry);};
    for(let i=0;i<9;i++) slow();
    var afterNine=reconnects.length;
    slow();
    var afterTen=reconnects.length;
    for(let i=0;i<20;i++) slow();
    entry.meter.delay=0.2; checkPlaybackDelay(entry);
    ({afterNine,afterTen,total:reconnects.length,reset:entry.meter.slowTicks});
  `,ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(result)),{afterNine:0,afterTen:1,total:1,reset:0});
});
test('a frozen picture reconnects even when the buffer looks normal',()=>{
  const ctx=context();
  const result=vm.runInContext(`
    var reconnects=0;
    reconnectCamera=()=>{reconnects++;};
    var entry={camera:{id:'front',name:'Front'},meter:newMeter()};
    players.set('front',entry);
    for(let i=0;i<10;i++){entry.meter.ready=true;entry.meter.fps=0;entry.meter.delay=0.2;checkPlaybackDelay(entry);}
    reconnects;
  `,ctx);
  assert.equal(result,1);
});
test('displayed FPS excludes dropped frames',async()=>{
  const ctx=context();
  const result=await vm.runInContext(`(async()=>{ const meter=newMeter();meter.lastTime=performance.now()-1000;await sampleMeter({video:{readyState:2,videoWidth:2560,getVideoPlaybackQuality(){return {totalVideoFrames:20,droppedVideoFrames:5};}}},meter);return meter.fps; })()`,ctx);
  assert.ok(result>14&&result<16);
});

test('camera visibility persists independently of configuration and new cameras remain visible', () => {
  const ctx = context();
  const result = vm.runInContext(`
    config={cameras:[{id:'front'},{id:'printer'},{id:'garage'}]};
    var saved, renders=[];
    localStorage.setItem=(key,value)=>{saved={key,value};};
    render=preserve=>renders.push(preserve);
    setCameraVisible('printer',false);
    var selected=visibleCameras().map(c=>c.id);
    var preference=JSON.parse(saved.value);
    config.cameras.push({id:'new_camera'});
    var withNew=visibleCameras().map(c=>c.id);
    setCameraVisible('printer',true);
    ({selected,preference,withNew,restored:visibleCameras().length,configured:config.cameras.length,renders});
  `, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    selected:['front','garage'], preference:['printer'], withNew:['front','garage','new_camera'],
    restored:4, configured:4, renders:[true,true],
  });
});

test('grid recording letterboxes a 4:3 source without stretching into a 16:9 tile', () => {
  const ctx = context();
  const result = vm.runInContext(`
    var draw;
    recorder={};
    recordingCanvas={width:1920,height:1080,getContext(){return {fillRect(){},drawImage(...args){draw=args.slice(1);}};}};
    focusEntry={el:{video:{readyState:2,videoWidth:640,videoHeight:480}}};
    drawRecordingFrame();
    draw;
  `, ctx);
  assert.deepEqual(Array.from(result), [240,0,1440,1080]);
});

test('grid follows the selected camera count through one, two, four and six views', () => {
  const ctx = context();
  const result = vm.runInContext(`
    config={cameras:Array.from({length:6},(_,i)=>({id:'cam'+i}))};
    grid.clientWidth=1920; grid.clientHeight=970;
    var layout={};
    grid.style={setProperty(key,value){layout[key]=value;}};
    localStorage.setItem=()=>{};
    render=()=>applyGridLayout();
    var layouts=[];
    for (const count of [6,4,2,1,0,3,5,6]) {
      for(let i=0;i<6;i++) setCameraVisible('cam'+i,i<count);
      layouts.push([visibleCameras().length,layout['--cols'],layout['--rows']]);
    }
    layouts;
  `, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), [
    [6,3,2], [4,2,2], [2,2,1], [1,1,1], [0,1,1], [3,2,2], [5,3,2], [6,3,2],
  ]);
});

test('header distinguishes mixed source resolutions', async () => {
  const ctx = context();
  const result = await vm.runInContext(`(async()=>{
    var nodes={};
    document.getElementById=id=>nodes[id]||(nodes[id]={});
    diagnosticsView.classList.contains=()=>true;
    fetch=async()=>({});
    for(const [id,w,h] of [['front',2560,1440],['garage',640,480]]) {
      players.set(id,{camera:{id},el:{video:{readyState:2,videoWidth:w,videoHeight:h}},meter:newMeter()});
    }
    await tick();
    return {text:nodes.resText.textContent,title:nodes.resText.title};
  })()`, ctx);
  assert.equal(result.text, 'Mixed');
  assert.equal(result.title, '2560x1440, 640x480');
});

test('browser saves a native MP4 without sending it to the Pi',async()=>{
  const ctx=context();
  const result=await vm.runInContext(`(async()=>{
    var offered;
    offerRecordingDownload=(blob,name)=>{offered={type:blob.type,name};};
    fetch=()=>{throw Error('native MP4 must not be uploaded');};
    await saveBrowserRecording({type:'video/mp4'},'test.mp4');return offered;
  })()`,ctx);
  assert.equal(result.type,'video/mp4');assert.equal(result.name,'test.mp4');
});

test('failed Pi conversion retains a correctly labelled WebM backup',async()=>{
  const ctx=context();
  const result=await vm.runInContext(`(async()=>{
    config={recording:{mp4:true,maxBytes:1000}};
    var offered,error;
    offerRecordingDownload=(blob,name)=>{offered=name;};
    fetch=async()=>({ok:false,json:async()=>({error:'Server busy'})});
    try {await saveBrowserRecording({type:'video/webm',size:100},'test.mp4');}catch(e){error=e.message;}
    return {offered,error};
  })()`,ctx);
  assert.equal(result.offered,'test.webm');assert.equal(result.error,'Server busy');
});
