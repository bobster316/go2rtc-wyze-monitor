const cp = require('child_process');
async function probe(stream) {
return new Promise(resolve=>{
let packets=0,bytes=0,done=false;const chunks=[];
const ws=new WebSocket('ws://192.168.1.93:18765/api/ws?src='+stream);ws.binaryType='arraybuffer';
function finish(){if(done)return;done=true;console.log(stream+' '+JSON.stringify({packets,bytes}));if(chunks.length){const p=cp.spawnSync('ffprobe',['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=codec_name,width,height,nb_read_frames','-of','json','-i','pipe:0'],{input:Buffer.concat(chunks),timeout:15000});console.log(p.stdout?.toString());console.log(p.stderr?.toString());}ws.close();resolve();}
const timer=setTimeout(finish,20000);
ws.onopen=()=>ws.send(JSON.stringify({type:'mse',value:'avc1.640029,avc1.64002A,avc1.640033'}));
ws.onmessage=e=>{if(done)return;if(typeof e.data==='string'){const m=JSON.parse(e.data);console.log(stream+' '+m.type+(m.type==='mse'?' '+m.value:''));}else{packets++;bytes+=e.data.byteLength;chunks.push(Buffer.from(e.data));}};
ws.onerror=()=>console.log(stream+' socket error');
ws.onclose=()=>{clearTimeout(timer);finish();};
});}
(async()=>{const streams=process.argv.slice(2);await Promise.all((streams.length?streams:['front_sub','front_main']).map(probe));process.exit(0);})();
