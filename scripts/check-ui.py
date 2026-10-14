#!/usr/bin/env python3
"""Materialize every screen and dialog with gpui-shell, without user data."""
import json, os, pathlib, shutil, subprocess, tempfile
root=pathlib.Path(__file__).resolve().parent.parent
runtime=os.environ.get('GPUI_SHELL') or str(next((root/'.tools').glob('gpui-shell-*/gpui-shell')))
repo={'path':'/test/github.com/acme/projj','base':'/test','host':'github.com','owner':'acme','name':'projj','key':'github.com/acme/projj','shortKey':'acme/projj','url':'git@github.com:acme/projj.git'}
data={'initialized':True,'configPath':'/test/.projj/config.toml','configText':'base = "/test"','config':{'hooks':[{'event':'post_add','tasks':['zoxide'],'env':{}}]},'repos':[repo],'bases':['/test'],'tasks':[{'name':'status','kind':'script','command':'/test/status'}],'jobs':[]}
states={
 'loading':'this.data=null;',
 'onboarding':'this.data.initialized=false;this.data.defaultBase="/test/repos";',
 'empty':'this.data.repos=[];',
 'library':'',
 'details':f'this.selected={json.dumps(repo["path"])};this.detail={{status:"## main\\n M README.md"}};',
 'tasks':'this.page="tasks";',
 'active-job':'this.page="tasks";this.jobs=[{id:"example",state:"running",started:1,operation:"run",label:"status",log:"Hello\\nWorld"}];',
 'failed-job':'this.page="tasks";this.jobs=[{id:"example",state:"failed",started:1,operation:"run",label:"status",log:"Error",error:"Command failed",truncated:true}];',
 'hooks':'this.page="hooks";',
 'settings':'this.page="settings";',
 'repair':'this.data=null;this.page="settings";this.error="Invalid TOML";',
 'add':'this.modal="add";',
 'preview':'this.modal="add";this.preview={target:"/test/github.com/acme/project",exists:false};',
 'remove':f'this.modal="remove";this.selected={json.dumps(repo["path"])};',
 'script':'this.modal="script";',
 'clean':'this.modal="clean";this.scope="all";',
 'dark':'this.dark=true;applyTheme(true);',
}
with tempfile.TemporaryDirectory(prefix='projj-ui-') as tmp:
 tmp=pathlib.Path(tmp); app=tmp/'app';shutil.copytree(root/'app',app,ignore=shutil.ignore_patterns('bin','gpui-kit.d.ts'))
 (app/'environment.js').write_text(f'export const projjHome={json.dumps(str(tmp/"home"))};')
 manifest=json.loads((app/'gpui-shell.json').read_text());manifest['entry']='check.js';(app/'gpui-shell.json').write_text(json.dumps(manifest))
 for name, setup in states.items():
  # Override refresh and polling so checks never execute any backend operation.
  (app/'check.js').write_text('import Projj from "./main.js";\nimport {applyTheme} from "./theme.js";\nexport default class Check extends Projj {\nrefresh() {}\npoll() {}\ninit(props,cx) { super.init(props,cx); this.accept('+json.dumps(data)+');'+setup+'}\n}')
  result=subprocess.run([runtime,'check','-d',str(app)],capture_output=True,text=True)
  if result.returncode: raise SystemExit(f'{name}:\n{result.stdout}\n{result.stderr}')
  print(f'PASS {name}')
