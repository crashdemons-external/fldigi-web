import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import createCore from '../web/fldigi-core.js';
import {defaults} from '../web/configuration.js';
import {rttyPresets} from '../web/rtty-presets.js';
import {createWorkflowFilter} from '../web/workflow.js';

const read = name => fs.readFileSync(new URL(name,import.meta.url),'utf8');
const workflow = JSON.parse(read('../web/workflow.json'));
const html = read('../web/index.html'), app = read('../web/app.js');
const knownIds = new Set(), staticIds = new Set();
const tags = new Set(['encode','decode','rig','util']);
for(const [id,values] of Object.entries(workflow)){
  assert.ok(values.length > 0,`${id}: missing workflow`);
  assert.equal(new Set(values).size,values.length,`${id}: duplicate tag`);
  assert.ok(values.every(tag => tags.has(tag)),`${id}: invalid tag`);
}
for(const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)){
  const [,tag,attrs] = match, id = /\bid="([^"]+)"/.exec(attrs)?.[1];
  if(id){assert.ok(!staticIds.has(id),`${id}: duplicate static ID`);staticIds.add(id);knownIds.add(id);}
  if(['button','input','select','textarea','a','output'].includes(tag)){
    assert.ok(id,`${tag} must have a stable ID: ${attrs}`);
    assert.ok(workflow[id],`${id}: missing static control`);
  }
}
for(const id of ['waterfall','scope','signal-meter','rx-raster','received-picture','radio-frequency','secondary-text','file-name','file-time','status1','status2','status-message','message-content']){
  assert.ok(workflow[id],`${id}: missing output field`);
}

// Execute the actual UI builders without a browser or a third-party DOM package.
// Walk each rendered page separately: config fields intentionally reuse IDs.
class Element {
  constructor(tag){
    this.tag=tag;this.children=[];this.dataset={};this.attributes={};this.className='';
    if(['button','input','select','textarea'].includes(tag))this.disabled=false;
    this.classList={toggle:(name,on)=>{const values=new Set(this.className.split(' ').filter(Boolean));if(on)values.add(name);else values.delete(name);this.className=[...values].join(' ');}};
  }
  append(...children){this.children.push(...children);for(const child of children)child.parentElement=this;}
  replaceChildren(...children){this.children=[];this.append(...children);}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name]??null;}
  removeAttribute(name){delete this.attributes[name];}
  querySelectorAll(selector){
    const selectors=selector.split(','),found=[];
    const walk=node=>{for(const child of node.children){if(selectors.some(value=>value.startsWith('.')?child.className.split(' ').includes(value.slice(1)):child.tag===value))found.push(child);walk(child);}};
    walk(this);return found;
  }
  addEventListener(){}
}
const roots = Object.fromEntries(['mode-options','config-tree','config-caption','config-fields','collapse-tree','channel-list'].map(id => [id,new Element('div')]));
const document=new Element('document');document.append(...Object.values(roots));
document.createElement=tag=>new Element(tag);
document.getElementById=id=>{
  if(roots[id])return roots[id];
  const find=node=>{if(node.id===id)return node;for(const child of node.children){const match=find(child);if(match)return match;}};
  return find(document);
};
const core = await createCore();
const modes = JSON.parse(core.UTF8ToString(core._web_modes()));
const context = vm.createContext({
  document, $:id => roots[id],workflowUI:createWorkflowFilter(workflow,'full',document),
  modes, defaults, rttyPresets, configDraft:{...defaults}, configPage:'Soundcard/Devices', devices:[], live:false,
  bindMenuBranches(){}, refreshDevices(){},
});
const between = (start,end) => app.slice(app.indexOf(start),app.indexOf(end));
vm.runInContext([
  between('const controlId =','// fldigi 4.2.13'),
  between('const sourceDisabledModes=','const dtmfSelected='),
  between('const speedPresetMenus=','function selectMode('),
  between('const channelRows=','const worker='),
  between('const configSections=','function openConfig('),
].join('\n'),context);
function inventory(root){
  const rendered = new Set();
  function walk(element){
    if(element.id){
      assert.ok(!rendered.has(element.id),`${element.id}: duplicate rendered ID`);
      assert.ok(!staticIds.has(element.id),`${element.id}: collides with static UI`);
      rendered.add(element.id);knownIds.add(element.id);
    }
    if(['button','input','select','textarea'].includes(element.tag)){
      assert.ok(element.id,`${element.tag}: missing dynamic ID`);
      assert.ok(workflow[element.id],`${element.id}: missing dynamic control`);
    }
    for(const child of element.children)walk(child);
  }
  walk(root);
}
vm.runInContext('buildModeMenu(); renderTree();',context);
inventory(roots['mode-options']);inventory(roots['config-tree']);inventory(roots['channel-list']);
const pages = vm.runInContext('configSections.map(([name])=>name)',context);
for(const page of pages){context.configPage=page;vm.runInContext('renderConfigPage()',context);inventory(roots['config-fields']);}
// Rebuilt controls must obey the profile too, including formerly disabled fields.
for(const profile of ['decode','encode','both','full']){
  context.workflowUI=createWorkflowFilter(workflow,profile,document);
  vm.runInContext('buildModeMenu(); renderTree();',context);
  const check=root=>{
    for(const element of root.querySelectorAll('button,input,select,textarea')){
      const allowed=profile==='full'||workflow[element.id].some(tag=>profile==='both'?['encode','decode'].includes(tag):tag===profile);
      assert.equal(element.disabled,!allowed,`${profile}: ${element.id}`);
    }
  };
  check(roots['mode-options']);check(roots['config-tree']);
  for(const page of pages){context.configPage=page;vm.runInContext('renderConfigPage()',context);check(roots['config-fields']);}
}
knownIds.add('rx-raster'); // Created before the UI builders at application startup.
for(const id of Object.keys(workflow))assert.ok(knownIds.has(id),`${id}: catalog entry has no UI counterpart`);

// Protect the distinctions that disabled/enabled state alone cannot establish.
for(const id of ['rx-id','kpsql','config-captureRate'])assert.deepEqual(workflow[id],['decode']);
for(const id of ['tx-id','tx-text','menu-generate-audio'])assert.deepEqual(workflow[id],['encode']);
for(const id of ['config-dtmfToneMs','config-dtmfGapMs'])assert.deepEqual(workflow[id],['encode']);
for(const id of ['config-ifkpLowercase','config-fsqLowercase','config-txColor','config-txVolume'])assert.deepEqual(workflow[id],['encode']);
for(const id of ['config-rxFont','config-rxWrap','config-page-Soundcard%2FSignal%20Level'])assert.deepEqual(workflow[id],['encode','decode']);
for(const id of ['config-callsign','config-page-Operator-Station','menu-config-operator'])assert.deepEqual(workflow[id],['encode','rig']);
assert.deepEqual(workflow['config-page-Misc%2FDTMF'],['encode','decode']);
for(const id of ['contact-call','qsy','config-useFSK','config-qsk'])assert.deepEqual(workflow[id],['rig']);
for(const id of ['help-command-line','config-portaudio'])assert.deepEqual(workflow[id],['util']);
for(const id of ['sideband','reverse','config-rttyBaud','config-dominoFec'])assert.deepEqual(workflow[id],['encode','decode']);
console.log(`Workflow catalog: ${Object.keys(workflow).length} entries; all static controls, configuration pages, modem menus, and channel rows covered.`);
