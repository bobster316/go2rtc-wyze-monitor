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
  await vm.runInContext(`(async()=>{ for(let i=0;i<2;i++) { const pc={getTransceivers(){return this.transceivers;}}; const offer=await new VideoStream().createOffer(pc); if(offer.type!=='offer'||pc.transceivers[0].receiver.jitterBufferTarget!==1000||'jitterBufferTarget' in pc.transceivers[1].receiver) throw Error('incorrect receiver setup'); } })()`,ctx);
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
test('displayed FPS excludes dropped frames',async()=>{
  const ctx=context();
  const result=await vm.runInContext(`(async()=>{ const meter=newMeter();meter.lastTime=performance.now()-1000;await sampleMeter({video:{readyState:2,videoWidth:2560,getVideoPlaybackQuality(){return {totalVideoFrames:20,droppedVideoFrames:5};}}},meter);return meter.fps; })()`,ctx);
  assert.ok(result>14&&result<16);
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
