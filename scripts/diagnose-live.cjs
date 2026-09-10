const fs = require('fs');
const cp = require('child_process');
const YAML = require('yaml');
const { loadConfig } = require('./generate-go2rtc-config');
const sshArgs = ['-i', require('path').join(require('os').homedir(), '.ssh', 'id_ed25519_pi'), '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', 'pi@192.168.1.93'];
const local = loadConfig();
const remoteText = cp.execFileSync('ssh', [...sshArgs, 'cat /home/pi/go2rtc-wyze-monitor/cameras.yaml'], {encoding:'utf8'});
const remote = YAML.parse(remoteText);
const l = local.cameras.find(c=>c.id==='front');
const r = remote.cameras.find(c=>c.id==='front');
console.log(JSON.stringify({comparison: {userMatches:l.user===r.user,passwordMatches:l.password===r.password,ipMatches:l.ip===r.ip,localPort:local.port,remotePort:remote.port,localTls:local.tls,remoteTls:remote.tls,localStreams:local.streams,remoteStreams:remote.streams}}));
const secrets = [l.password,r.password,encodeURIComponent(l.password),encodeURIComponent(r.password)];
function redact(s) { s=s.replace(/rtsps?:\/\/\S+/g,'[REDACTED_STREAM_URL]'); for(const v of secrets) if(v) s=s.split(v).join('[REDACTED]');return s; }
async function wsProbe(stream) {
  return new Promise(resolve=>{
    const ws=new WebSocket('ws://192.168.1.93:18765/api/ws?src='+stream);
    const timer=setTimeout(()=>{console.log(stream+' timeout');ws.close();resolve();},18000);
    ws.onopen=()=>{console.log(stream+' websocket OPEN');ws.send(JSON.stringify({type:'mse',value:'avc1.640029,avc1.64002A,avc1.640033,avc1.4D0029,avc1.4D002A,avc1.4D0033,avc1.420029,avc1.42002A,avc1.420033'}));};
    ws.onmessage=e=>{if(typeof e.data==='string') console.log(stream+' '+redact(e.data));else {console.log(stream+' received media bytes '+e.data.size);clearTimeout(timer);ws.close();resolve();}};
    ws.onerror=()=>console.log(stream+' websocket error');
    ws.onclose=e=>{clearTimeout(timer);console.log(stream+' closed '+e.code);resolve();};
  });
}
(async()=>{await wsProbe('front_sub');await wsProbe('front_main');})();
