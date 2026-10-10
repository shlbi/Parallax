"""Actual loopback HTTP through Uvicorn plus the production Node gateway helper."""
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
import httpx
import pytest


def test_uvicorn_and_node_gateway_roundtrip(tmp_path, seed):
    node = shutil.which("node")
    if not node:
        pytest.skip("Node is required for the cross-runtime smoke test")
    db_path = tmp_path / "socket-test.sqlite3"
    shutil.copy2(seed[0], db_path)
    with socket.socket() as socket_:
        socket_.bind(("127.0.0.1", 0))
        port = socket_.getsockname()[1]
    environment = {**os.environ, "DATABASE_URL": "sqlite:///" + str(db_path),
                   "PARALLAX_PUBLIC_ORIGIN": "http://localhost:3000", "PARALLAX_RUNTIME": "local",
                   "PARALLAX_ALLOWED_HOSTS": "127.0.0.1", "PARALLAX_GATEWAY_SECRET": ""}
    process = subprocess.Popen([sys.executable, "-m", "uvicorn", "backend.case_service.api:create_app", "--factory",
        "--host", "127.0.0.1", "--port", str(port), "--no-access-log"], env=environment,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        with httpx.Client(trust_env=False, timeout=1) as client:
            for _ in range(100):
                if process.poll() is not None:
                    pytest.fail("Uvicorn exited before becoming ready")
                try:
                    if client.get(f"http://127.0.0.1:{port}/healthz").status_code == 200:
                        break
                except httpx.HTTPError:
                    pass
                time.sleep(0.05)
            else:
                pytest.fail("Uvicorn did not become ready")
        javascript = r'''
import assert from 'node:assert/strict';
import {caseGateway} from './lib/case-gateway.ts';
const settings={backend:process.env.SMOKE_BACKEND,origin:'http://localhost:3000',runtime:'local',secret:''};
let cookie='',csrf='';
async function call(path,method='GET',value,version){
  const headers={'Origin':settings.origin,'Content-Type':'application/json','Cookie':cookie,'X-Parallax-CSRF':csrf};
  if(version)headers['If-Match']=String(version);
  return caseGateway(new Request(settings.origin+'/api/core/'+path,{method,headers,body:method==='GET'?undefined:JSON.stringify(value??{})}),path.split('/'),settings);
}
let response=await call('session','POST',{username:'owner',password:'test-only-long-passphrase'});
assert.equal(response.status,200);cookie=response.headers.get('set-cookie').split(';')[0];csrf=(await response.json()).csrf_token;
response=await call('cases','POST',{title:'Socket smoke test',kind:'participant'});assert.equal(response.status,201);const c=await response.json();
response=await call('cases/'+c.id);assert.equal(response.status,200);assert.equal((await response.json()).title,c.title);
response=await call('cases/'+c.id+'/authorizations','POST',{participant_reference:'P-TEST',purpose:'Fixture records',source_scope:['supplied'],actions:['case_records']},c.version);
assert.equal(response.status,201);const grant=await response.json();assert.equal(grant.method,'written_consent_held_offline');
response=await call('cases/'+c.id+'/authorizations/'+grant.id+'/revoke','POST',{reason:'End of test'},grant.case_version);assert.equal(response.status,200);
response=await call('cases/'+c.id+'/audit');assert.equal(response.status,200);assert.equal((await response.json()).items.length,3);
response=await call('session','DELETE');assert.equal(response.status,204);
response=await call('cases');assert.equal(response.status,401);
console.log('Real HTTP gateway smoke: login, create, read, authorization, revocation, audit, logout PASS');
'''
        result = subprocess.run([node, "--experimental-strip-types", "--input-type=module", "-e", javascript],
            cwd=Path(__file__).resolve().parents[2], env={**environment, "SMOKE_BACKEND": f"http://127.0.0.1:{port}"},
            capture_output=True, text=True, timeout=30)
        assert result.returncode == 0, result.stderr
        assert "PASS" in result.stdout
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill(); process.wait(timeout=5)
