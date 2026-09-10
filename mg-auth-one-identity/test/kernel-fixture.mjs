import {createServer} from 'node:http';
import {once} from 'node:events';
export async function kernelFixture(initial) {
 const applications=new Map(initial.map(a=>[a.id,{enabled:true,...a}]));
 const key='kernel-test-fixture-key-'.repeat(3);
 const server=createServer((req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.headers['x-application-registry-key']!==key){res.writeHead(401);res.end('{}');return;}
  res.end(JSON.stringify({applications:[...applications.values()]}));
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 process.env.APPLICATION_REGISTRY_URL='http://127.0.0.1:'+server.address().port+'/internal/applications';process.env.APPLICATION_REGISTRY_KEY=key;
 return {applications,close:()=>new Promise(resolve=>server.close(resolve))};
}
