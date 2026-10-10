import {test} from 'node:test';
import assert from 'node:assert/strict';
import {caseGateway} from '../lib/case-gateway.ts';
const settings = {backend:'http://127.0.0.1:8000',origin:'http://localhost:3000',secret:'',runtime:'local'};
const ID='a'.repeat(32);
const req=(path,method='GET',body,headers={})=>new Request(`http://localhost:3000/api/core/${path}`,{method,headers:{Origin:settings.origin,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
const ok=async()=>Response.json({ok:true});
for(const path of ['cases','session',`cases/${ID}`,`cases/${ID}/members`,`cases/${ID}/authorizations`,`cases/${ID}/audit`]){
 test(`forwards allowed GET ${path}`,async()=>assert.equal((await caseGateway(req(path),path.split('/'),settings,ok)).status,200));
}
for(const path of ['../../secrets','session/../../admin',`cases/${ID}/uploads`,'healthz','https://evil.example','cases/%2e%2e','cases/not-an-id']){
 test(`rejects route ${path}`,async()=>assert.equal((await caseGateway(req('cases'),path.split('/'),settings,ok)).status,404));
}
test('rejects unsupported method',async()=>assert.equal((await caseGateway(req('cases','PUT',{}),['cases'],settings,ok)).status,405));
test('exact origin required',async()=>assert.equal((await caseGateway(req('cases','POST',{}, {Origin:'https://evil.example'}),['cases'],settings,ok)).status,403));
test('JSON required',async()=>assert.equal((await caseGateway(req('cases','POST',{}, {'Content-Type':'text/plain'}),['cases'],settings,ok)).status,415));
test('oversize rejected before forwarding',async()=>assert.equal((await caseGateway(req('cases','POST',{text:'x'.repeat(33000)}),['cases'],settings,()=>{throw Error('must not forward')})).status,413));
for(const query of ['url=https://evil.example','limit=100&limit=1','limit=-1','after=secret']){
 test(`rejects query ${query}`,async()=>assert.equal((await caseGateway(req('cases?'+query),['cases'],settings,ok)).status,422));
}
for(const extra of [{backend:''},{backend:'http://public.example'},{backend:'https://user:pass@api.example'},{backend:'https://api.example/base'},{runtime:'cloud'},{origin:'http://public.example'}]){
 test(`configuration fails closed ${JSON.stringify(extra)}`,async()=>assert.equal((await caseGateway(req('cases'),['cases'],{...settings,...extra},ok)).status,503));
}
test('forwards only session cookie and selected headers',async()=>{
 const raw='a'.repeat(43);let called=false;
 const r=await caseGateway(req('cases','POST',{title:'Test'}, {Cookie:`secret_app=private; parallax_session=${raw}`,Authorization:'Bearer private','X-Forwarded-Host':'evil','X-Parallax-CSRF':'csrf'}),['cases'],settings,async(url,options)=>{
  called=true;assert.equal(url.href,'http://127.0.0.1:8000/v1/cases');assert.equal(options.headers.get('Cookie'),`parallax_session=${raw}`);
  assert.equal(options.headers.get('Authorization'),null);assert.equal(options.headers.get('X-Forwarded-Host'),null);assert.equal(options.headers.get('X-Parallax-CSRF'),'csrf');
  assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.equal(options.body,JSON.stringify({title:'Test'}));
  return Response.json({id:ID},{status:201,headers:{'Set-Cookie':`parallax_session=${raw}; HttpOnly; Path=/; SameSite=Strict`}});
 });
 assert(called);assert.equal(r.status,201);assert(r.headers.get('set-cookie').includes('HttpOnly'));assert.equal(r.headers.get('cache-control'),'no-store');
});
test('drops ambiguous duplicate cookies',async()=>{
 await caseGateway(req('session','GET',undefined,{Cookie:`parallax_session=${'a'.repeat(43)}; parallax_session=${'b'.repeat(43)}`}),['session'],settings,async(_,o)=>{assert.equal(o.headers.get('Cookie'),null);return Response.json({});});
});
test('cloud gateway injects server secret without echoing it',async()=>{
 const cloud={backend:'https://api.example',origin:'https://app.example',runtime:'cloud',secret:'x'.repeat(32)};
 const r=await caseGateway(req('session'),['session'],cloud,async(_,options)=>{assert.equal(options.headers.get('X-Parallax-Gateway'),cloud.secret);return Response.json({ok:true});});
 assert.equal(r.status,200);assert(!(await r.text()).includes(cloud.secret));
});
test('upstream failures redacted',async()=>{const r=await caseGateway(req('cases'),['cases'],settings,async()=>new Response('database password exposed',{status:500}));assert.equal(r.status,502);assert(!(await r.text()).includes('password'));});
test('network failure handled',async()=>assert.equal((await caseGateway(req('cases'),['cases'],settings,async()=>{throw Error('network')})).status,502));
test('HTML upstream rejected',async()=>assert.equal((await caseGateway(req('cases'),['cases'],settings,async()=>new Response('<html>login</html>',{headers:{'Content-Type':'text/html'}}))).status,502));
test('empty logout response retains clear-cookie',async()=>{const r=await caseGateway(req('session','DELETE',{}),['session'],settings,async()=>new Response(null,{status:204,headers:{'Set-Cookie':'parallax_session=""; Max-Age=0; Path=/'}}));assert.equal(r.status,204);assert.equal(await r.text(),'');assert(r.headers.get('set-cookie').includes('Max-Age=0'));});
