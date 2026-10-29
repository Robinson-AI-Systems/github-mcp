import contextlib
import importlib.machinery
import importlib.util
import io
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

def load_cli():
    path=os.environ.get('RAS_GITHUB_TEST_SOURCE', str(Path(__file__).with_name('ras-github')))
    loader=importlib.machinery.SourceFileLoader('rasgh_test',path)
    spec=importlib.util.spec_from_loader(loader.name,loader)
    module=importlib.util.module_from_spec(spec);loader.exec_module(module);return module

class GitFixture(unittest.TestCase):
    def setUp(self):
        self.cli=load_cli();self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.git('init','-b','main');self.git('config','user.name','Fixture');self.git('config','user.email','fixture@example.test')
        (self.root/'base.txt').write_text('base\n');self.git('add','.');self.git('commit','-m','base');self.base=self.git('rev-parse','HEAD').strip()
        for n in range(29):(self.root/f'f{n}.txt').write_text(f'file {n}\n')
        self.git('add','.');self.git('commit','-m','files')
    def tearDown(self):self.tmp.cleanup()
    def git(self,*args):return subprocess.check_output(['git','-C',str(self.root),*args],stderr=subprocess.DEVNULL,text=True)
    def push_args(self):return ['push-branch','--owner','example-org','--repo','fixture','--branch','topic','--source-dir',str(self.root),'--base-ref',self.base,'--message','upload']
class HelperIntegrity(GitFixture):
    def test_unconfirmed_batch_never_exits_success_or_claims_all_files_delivered(self):
        state={'head':'a'*40,'batches':0,'delivered':0}
        def call(name,args):
            if name=='github_describe_tool':return {'arguments':{'properties':{'createFrom':{},'expectedFileCount':{},'files':{'maxItems':12}}}}
            if name=='github_commit_list':return {'items':[{'sha':state['head']}]}
            if name=='github_content_commit_git_data':
                if args.get('dryRun'):return {'status':'preview','done':False}
                state['batches']+=1
                if state['batches']==1:
                    state['head']='b'*40;state['delivered']+=len(args['files']);return {'status':'applied','done':True,'confirmed':True,'result':{'commit':state['head'],'branch_head':state['head'],'files':len(args['files']),'submitted_files':len(args['files']),'confirmed_files':len(args['files']),'manifest_complete':True}}
                return {'status':'unconfirmed','done':False,'confirmed':False,'warning':'Remote readback did not confirm the requested update.'}
            raise AssertionError(name)
        out,err=io.StringIO(),io.StringIO()
        with patch.object(self.cli,'call_tool',side_effect=call),contextlib.redirect_stdout(out),contextlib.redirect_stderr(err):code=self.cli.main(self.push_args())
        self.assertNotEqual(code,0,out.getvalue());self.assertNotIn('29 file change(s), 3 commit(s)',out.getvalue());self.assertEqual(state['delivered'],12)
    def test_execute_does_not_send_confirm_after_failed_preview(self):
        calls=[]
        def call(name,args):calls.append(args);return {'status':'preview','done':False,'preflight_failed':True,'warning':'Invalid input'}
        with patch.object(self.cli,'call_tool',side_effect=call):
            with self.assertRaises(self.cli.CliError):self.cli.execute('github_x_write',{})
        self.assertEqual(len(calls),1)
    def test_copied_path_does_not_delete_its_source(self):
        with patch.object(self.cli,'git',side_effect=lambda d,*a,**kw:b'C100\0source.txt\0copy.txt\0' if a[0]=='diff' else ''),patch.object(self.cli,'make_file_entry',return_value={'path':'copy.txt','content':'copy'}):
            entries=self.cli.collect_changes(str(self.root),self.base)
        self.assertEqual(entries,[{'path':'copy.txt','content':'copy'}])


class CompleteUploads(GitFixture):
    def test_success_checks_all_batches_and_full_remote_tree_once(self):
        state={'head':'a'*40,'batches':0};local_tree=self.git('rev-parse','HEAD^{tree}').strip()
        def call(name,args):
            if name=='github_describe_tool':return {'arguments':{'properties':{'createFrom':{},'expectedFileCount':{},'files':{'maxItems':12}}}}
            if name=='github_content_commit_git_data':
                self.assertNotIn('dryRun',args);self.assertEqual(args['expectedFileCount'],len(args['files']))
                if state['batches']:self.assertEqual(args['expectedHead'],state['head'])
                self.assertEqual(args['createFrom'],self.base)
                state['batches']+=1;state['head']=str(state['batches'])*40
                return {'status':'applied','done':True,'confirmed':True,'result':{'commit':state['head'],'branch_head':state['head'],'submitted_files':len(args['files']),'confirmed_files':len(args['files']),'manifest_complete':True}}
            if name=='github_commit_list':return {'items':[{'sha':state['head']}]}
            if name=='github_api_read':return {'data':{'sha':state['head'],'tree':{'sha':local_tree},'parents':[{'sha':'a'*40}]}}
            raise AssertionError(name)
        out=io.StringIO()
        with patch.object(self.cli,'call_tool',side_effect=call),contextlib.redirect_stdout(out),contextlib.redirect_stderr(io.StringIO()):code=self.cli.main(self.push_args())
        self.assertEqual(code,0);payload=__import__('json').loads(out.getvalue());self.assertEqual(payload['confirmed_files'],29);self.assertEqual(state['batches'],3)
    def test_escape_hatch_routes_unlisted_tools_through_one_stable_gateway(self):
        raw={'content':[{'type':'text','text':'{"done":true}'}]}
        with patch.object(self.cli,'run_helper',return_value=raw) as helper:
            self.cli.call_tool('github_content_commit_git_data',{'repo':'fixture'})
        helper.assert_called_once_with('github_call',{'name':'github_content_commit_git_data','args':{'repo':'fixture'}})
    def test_unconfirmed_result_without_error_is_a_failure(self):
        raw={'content':[{'type':'text','text':'{"done":false,"status":"unconfirmed","warning":"not verified"}'}]}
        with patch.object(self.cli,'run_helper',return_value=raw):
            with self.assertRaises(self.cli.CliError):self.cli.call_tool('github_x_write',{})
    def test_native_sync_preserves_conflict_workspace_and_never_pushes_or_closes(self):
        calls=[]
        def call(name,args):
            calls.append((name,args))
            if name=='github_commit_list':return {'items':[{'sha':'a'*40}]}
            if name=='github_git_workspace_open':return {'status':'applied','done':True,'result':{'workspace_id':'job_'+'a'*16,'generation':0}}
            if name=='github_git_workspace_run' and args['operation']=='fetch':return {'status':'applied','done':True,'result':{'workspace':{'generation':1}}}
            if name=='github_git_workspace_run' and args['operation']=='merge':return {'status':'unconfirmed','done':False,'warning':'conflict'}
            raise AssertionError(name)
        err=io.StringIO()
        with patch.object(self.cli,'call_tool',side_effect=call),contextlib.redirect_stderr(err):code=self.cli.main(['sync-branch','--repo','fixture','--branch','topic'])
        self.assertEqual(code,1);self.assertIn('retained',err.getvalue());self.assertFalse(any(a.get('operation')=='push' or n=='github_git_workspace_close' for n,a in calls))

class FleetInstallation(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        loader=importlib.machinery.SourceFileLoader('ras_install',str(Path(__file__).with_name('install.py')))
        spec=importlib.util.spec_from_loader(loader.name,loader);self.installer=importlib.util.module_from_spec(spec);loader.exec_module(self.installer)
    def tearDown(self):self.tmp.cleanup()
    def test_install_exact_bytes_idempotent_and_reversible(self):
        target=self.root/'tools'/'ras-github';target.parent.mkdir();original=b'print("old")\n';target.write_bytes(original)
        source=Path(__file__).with_name('ras-github');result=self.installer.install(target)
        self.assertEqual(target.read_bytes(),source.read_bytes());backup=Path(result['backup']);self.assertEqual(backup.read_bytes(),original)
        self.assertEqual(backup.stat().st_mode&0o777,0o600);self.assertEqual(target.stat().st_mode&0o777,0o755)
        same=self.installer.install(target);self.assertEqual(same['status'],'unchanged');self.assertEqual(len(list(target.parent.glob('*.backup-*'))),1)
        restored=self.installer.install(target,rollback=backup);self.assertEqual(restored['status'],'restored');self.assertEqual(target.read_bytes(),original)
        self.assertEqual(Path(restored['backup']).read_bytes(),source.read_bytes())
    def test_refuses_symlinks_wrong_backup_and_invalid_source_without_touching_target(self):
        target=self.root/'ras-github';target.write_text('print("old")\n');link=self.root/'link';link.symlink_to(target)
        with self.assertRaises(ValueError):self.installer.install(link)
        with self.assertRaises(ValueError):self.installer.install(target,rollback=target)
        broken=self.root/'broken';broken.write_text('not python !!!')
        with self.assertRaises(SyntaxError):self.installer.install(target,source=broken)
        self.assertEqual(target.read_text(),'print("old")\n')
    def test_interrupted_replace_retains_original_and_private_backup(self):
        target=self.root/'ras-github';target.write_text('print("old")\n')
        with patch.object(self.installer.os,'replace',side_effect=OSError('fixture failure')):
            with self.assertRaises(OSError):self.installer.install(target)
        self.assertEqual(target.read_text(),'print("old")\n');self.assertEqual(len(list(self.root.glob('ras-github.backup-*'))),1)
        self.assertEqual(list(self.root.glob('.ras-github.*')),[])
    def test_installed_doctor_uses_configured_fake_connector_without_touching_saved_login(self):
        target=self.root/'ras-github';self.installer.install(target)
        helper=self.root/'client.py';helper.write_text("""import argparse,json,os
p=argparse.ArgumentParser();p.add_argument('action');p.add_argument('--name');p.add_argument('--arguments-file');a=p.parse_args()
args=json.load(open(a.arguments_file));name=a.name
if name=='github_call':name=args['name'];args=args['args']
if name=='github_whoami':payload={'identity':'fixture'}
elif name=='github_describe_tool':payload={'arguments':{'properties':{'createFrom':{},'expectedFileCount':{}}}}
elif name=='github_git_workspace_read':payload={'worker':{'ready':True,'capacity_mode':'resource-aware','admission':{'allowed':not bool(os.environ.get('FAKE_NATIVE_PRESSURE'))}}}
else:raise SystemExit(2)
print(json.dumps({'content':[{'type':'text','text':json.dumps(payload)}],'structuredContent':payload}))
""")
        saved=self.root/'saved-login';saved.write_text('fixture untouched')
        env={**os.environ,'RAS_GITHUB_CONNECTOR_HELPER':str(helper)}
        result=subprocess.run(['python3',str(target),'doctor','--live'],env=env,capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr);payload=__import__('json').loads(result.stdout)
        self.assertTrue(payload['ready']);self.assertTrue(payload['connector_read_verified']);self.assertEqual(payload['capacity_mode'],'resource-aware')
        self.assertTrue(payload['native_git_ready']);self.assertEqual(saved.read_text(),'fixture untouched')
        env['FAKE_NATIVE_PRESSURE']='yes'
        pressured=subprocess.run(['python3',str(target),'doctor','--live'],env=env,capture_output=True,text=True)
        self.assertEqual(pressured.returncode,0);self.assertFalse(__import__('json').loads(pressured.stdout)['native_git_ready'])
        env['RAS_GITHUB_CONNECTOR_HELPER']=str(self.root/'missing-client.py')
        failed=subprocess.run(['python3',str(target),'doctor'],env=env,capture_output=True,text=True)
        self.assertEqual(failed.returncode,1);self.assertFalse(__import__('json').loads(failed.stdout)['ready'])

if __name__=='__main__':unittest.main()
